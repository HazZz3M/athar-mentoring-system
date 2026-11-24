/* In-memory implementation of the DB adapter — used by automated tests and by the offline demo.
   Mirrors SheetDb semantics: every value read back is a string or a number ('' for empty). */
function MemoryDb(tables, opts) {
  opts = opts || {};
  var T = tables || {};
  var clock = opts.clock || null;
  function norm(table, row) {
    var o = {};
    (SCHEMA[table] || Object.keys(row)).forEach(function (k) {
      var v = row[k];
      if (v === null || v === undefined) v = '';
      else if (NUMBER_FIELDS.indexOf(k) >= 0 && v !== '') { var n = Number(v); v = isNaN(n) ? String(v) : n; }
      else if (typeof v === 'boolean') v = v ? 'نعم' : 'لا';
      else if (typeof v !== 'number') v = String(v);
      o[k] = v;
    });
    return o;
  }
  var api = {
    tables: T,
    all: function (t) { return (T[t] || []).map(function (r) { return Object.assign({}, r); }); },
    lib: function (t) { return T[t] || []; },
    insert: function (t, rows) { T[t] = T[t] || []; rows.forEach(function (r) { T[t].push(norm(t, r)); }); },
    update: function (t, key, val, patch) {
      var r = (T[t] || []).filter(function (x) { return x[key] === val; })[0];
      if (!r) throw new Error('update: row not found ' + t + ' ' + val);
      var n = norm(t, Object.assign({}, r, patch));
      Object.keys(n).forEach(function (k) { r[k] = n[k]; });
    },
    remove: function (t, key, val) { T[t] = (T[t] || []).filter(function (x) { return x[key] !== val; }); },
    withLock: function (fn) { return fn(); },
    now: function () { var d = clock ? clock() : new Date(); return d.toISOString().slice(0, 16).replace('T', ' '); },
    today: function () { var d = clock ? clock() : new Date(); return d.toISOString().slice(0, 10); },
    user: function () { return opts.user || 'demo@athar'; }
  };
  return api;
}
if (typeof module !== 'undefined') module.exports = MemoryDb;
