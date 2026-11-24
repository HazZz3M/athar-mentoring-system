/**
 * Google Sheets implementation of the DB adapter.
 * Every table is a sheet: row 1 = Arabic labels, row 2 = technical keys, data from row 3.
 * Reads are cached for the duration of one server call.
 */
var SHEETDB_HEADER_ROWS = 2;

function getSpreadsheet_() {
  var ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ss = null; }
  if (!ss) {
    var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    if (!id) throw AppError('لم يتم إعداد النظام بعد: افتح ملف Google Sheets وشغّل «إعداد النظام» من قائمة أثر.');
    ss = SpreadsheetApp.openById(id);
  }
  return ss;
}

function SheetDb_() {
  var ss = getSpreadsheet_();
  var tz = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'Africa/Cairo';
  var cache = {};
  var sheets = {};
  var lockDepth = 0;
  function requireLock_(op, t) {   // every write must happen inside withLock (multi-user safety)
    if (lockDepth === 0) throw AppError('خطأ داخلي: محاولة ' + op + ' في ' + t + ' بدون قفل.');
  }
  function sheet(t) {
    if (!sheets[t]) { sheets[t] = ss.getSheetByName(t); if (!sheets[t]) throw AppError('الورقة غير موجودة: ' + t + ' — شغّل «إعداد النظام».'); }
    return sheets[t];
  }
  function fromCell(k, v) {
    if (v instanceof Date) {
      if (TIMESTAMP_FIELDS.indexOf(k) >= 0) return Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm');
      return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    }
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'نعم' : 'لا';
    if (typeof v === 'number') return NUMBER_FIELDS.indexOf(k) >= 0 ? v : String(v);
    return String(v);
  }
  function toCell(k, v) {
    if (v === null || v === undefined) return '';
    if (DATE_FIELDS.indexOf(k) >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(String(v))) { var p = String(v).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
    if (NUMBER_FIELDS.indexOf(k) >= 0) { if (v === '') return ''; var n = Number(v); return isNaN(n) ? String(v) : n; }
    if (typeof v === 'boolean') return v ? 'نعم' : 'لا';
    var s = String(v);
    if (s.length > 49000) s = s.slice(0, 49000);   // Google Sheets cell limit is 50,000 characters
    return s;
  }
  function load(t) {   // ONE sheet read per table: row 2 = keys, data from row 3
    if (cache[t]) return cache[t];
    var sh = sheet(t);
    var all = sh.getDataRange().getValues();
    var keys = (all[SHEETDB_HEADER_ROWS - 1] || []).map(function (k) { return String(k).trim(); });
    while (keys.length && !keys[keys.length - 1]) keys.pop();
    var rows = [];
    if (all.length > SHEETDB_HEADER_ROWS) {
      var vals = all.slice(SHEETDB_HEADER_ROWS);
      vals.forEach(function (r, i) {
        if (r[0] === '' || r[0] === null) return;
        var o = { _row: i + SHEETDB_HEADER_ROWS + 1 };
        keys.forEach(function (k, j) { if (k) o[k] = fromCell(k, r[j]); });
        rows.push(o);
      });
    }
    cache[t] = { keys: keys, rows: rows };
    return cache[t];
  }
  function strip(r) { var o = {}; Object.keys(r).forEach(function (k) { if (k !== '_row') o[k] = r[k]; }); return o; }
  /** Library tables change rarely: kept in the script cache (refreshed on any edit of a LIB_ sheet, on setup, or after 6 h). */
  function libTables(list) {
    var ver = libVersion_(), key = 'athar_lib_' + ver, hit = libCacheGet_(key);
    if (hit) { list.forEach(function (t) { if (hit[t]) cache[t] = { keys: hit[t].keys, rows: hit[t].rows.map(function (r) { var o = {}; hit[t].keys.forEach(function (k, j) { if (k) o[k] = r[j]; }); return o; }) }; }); return hit; }
    var out = {};
    list.forEach(function (t) { try { var c = load(t); out[t] = { keys: c.keys, rows: c.rows.map(function (o) { return c.keys.map(function (k) { return k ? o[k] : ''; }); }) }; } catch (e) { out[t] = { keys: [], rows: [] }; } });
    libCachePut_(key, out);
    return out;
  }
  return {
    libTables: libTables,
    libVersion: function () { return libVersion_(); },
    all: function (t) { return load(t).rows.map(strip); },
    lib: function (t) { return load(t).rows.map(strip); },
    insert: function (t, rows) {
      if (!rows.length) return;
      requireLock_('إضافة', t);
      var c = load(t), sh = sheet(t);
      var start = Math.max(sh.getLastRow(), SHEETDB_HEADER_ROWS) + 1;
      var vals = rows.map(function (r) { return c.keys.map(function (k) { return toCell(k, r[k]); }); });
      sh.getRange(start, 1, vals.length, c.keys.length).setValues(vals);
      rows.forEach(function (r, i) { var o = { _row: start + i }; c.keys.forEach(function (k, j) { o[k] = fromCell(k, vals[i][j]); }); c.rows.push(o); });
    },
    update: function (t, key, val, patch) {
      requireLock_('تعديل', t);
      var c = load(t), sh = sheet(t);
      var r = c.rows.filter(function (x) { return x[key] === val; })[0];
      if (!r) throw AppError('لم يتم العثور على السجل ' + val + ' في ' + t);
      Object.keys(patch).forEach(function (k) { if (c.keys.indexOf(k) >= 0) r[k] = patch[k]; });
      var vals = [c.keys.map(function (k) { return toCell(k, r[k]); })];
      sh.getRange(r._row, 1, 1, c.keys.length).setValues(vals);
    },
    remove: function (t, key, val) {   // used only for discarding an unsaved draft session
      requireLock_('حذف', t);
      var c = load(t), sh = sheet(t);
      var r = c.rows.filter(function (x) { return x[key] === val; })[0];
      if (!r) return;
      sh.deleteRow(r._row);
      delete cache[t];
    },
    /**
     * Serialises every write across all users (~20 mentors at once).
     * On entry the read cache is dropped so that IDs, row numbers and statuses are re-read
     * AFTER the lock is held — otherwise two users could read the same "last ID" or write
     * to a row that moved. Nested calls (a locked function calling another) reuse the lock.
     */
    withLock: function (fn) {
      if (lockDepth > 0) { lockDepth++; try { return fn(); } finally { lockDepth--; } }
      var lock = LockService.getScriptLock();
      if (!lock.tryLock(45000)) throw AppError('النظام مشغول بحفظ آخر؛ حاول مرة أخرى بعد لحظات.');
      lockDepth = 1; cache = {};
      try { var res = fn(); SpreadsheetApp.flush(); return res; } finally { lockDepth = 0; lock.releaseLock(); }
    },
    now: function () { return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm'); },
    today: function () { return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'); },
    user: function () { if (typeof WEB_REQUEST_ !== 'undefined' && WEB_REQUEST_) return REQUEST_USER_ || 'منتور (بدون اسم)';
      try { return Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || ''; } catch (e) { return ''; } },
    invalidate: function (t) { if (t) delete cache[t]; else cache = {}; }
  };
}

/* ---------------- library cache (CacheService: ≤100 KB per value → chunked) ---------------- */
function libVersion_() {
  var props = PropertiesService.getScriptProperties(), v = props.getProperty('LIB_VERSION');
  if (!v) { v = String(Date.now()); props.setProperty('LIB_VERSION', v); }
  return v;
}
function invalidateLibCache_() { PropertiesService.getScriptProperties().setProperty('LIB_VERSION', String(Date.now())); }
function libCacheGet_(key) {
  try {
    var c = CacheService.getScriptCache(), n = +c.get(key + ':n');
    if (!n) return null;
    var ks = []; for (var i = 0; i < n; i++) ks.push(key + ':' + i);
    var got = c.getAll(ks), parts = [];
    for (var j = 0; j < n; j++) { if (got[ks[j]] === undefined || got[ks[j]] === null) return null; parts.push(got[ks[j]]); }
    return JSON.parse(parts.join(''));
  } catch (e) { return null; }
}
function libCachePut_(key, obj) {
  try {
    var s = JSON.stringify(obj), size = 25000, map = {}, n = Math.ceil(s.length / size);   // 25k chars ≤ 100 KB even for 3-byte Arabic UTF-8
    for (var i = 0; i < n; i++) map[key + ':' + i] = s.substr(i * size, size);
    var c = CacheService.getScriptCache(); c.putAll(map, 21600); c.put(key + ':n', String(n), 21600);
  } catch (e) { /* cache is an optimisation only */ }
}
