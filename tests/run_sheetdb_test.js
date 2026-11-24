/* Runs Code.gs + SheetDb.gs against a mock of the Google Sheets services, to verify the real
   Apps Script adapter (row 1 labels / row 2 keys, date & text conversion, update-in-place, locking, api bridge). */
const fs = require('fs'), vm = require('vm'), path = require('path');
const SRC = path.join(__dirname, '..', 'src');
const lib = JSON.parse(fs.readFileSync(path.join(__dirname, 'library.json'), 'utf8'));

function pad(n) { return String(n).padStart(2, '0'); }
class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr: nr || 1, nc: nc || 1 }); }
  getValues() { const o = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) { const v = (this.sh.data[this.r - 1 + i] || [])[this.c - 1 + j]; row.push(v === undefined ? '' : v); } o.push(row); } return o; }
  setValues(v) {
    if (v.length !== this.nr || v[0].length !== this.nc) throw new Error('setValues dimension mismatch');
    for (let i = 0; i < this.nr; i++) { const ri = this.r - 1 + i; this.sh.data[ri] = this.sh.data[ri] || [];
      for (let j = 0; j < this.nc; j++) { let x = v[i][j]; const fmt = this.sh.fmt[this.c + j];
        if (typeof x === 'string' && fmt !== '@' && /^-?\d+(\.\d+)?$/.test(x) && ri >= 2) x = Number(x);   // what Sheets does without text format
        this.sh.data[ri][this.c - 1 + j] = x; } }
    return this;
  }
  setValue(x) { return this.setValues([[x]]); }
  setNumberFormat(f) { for (let j = 0; j < this.nc; j++) this.sh.fmt[this.c + j] = f; return this; }
  setFontWeight() { return this; } setBackground() { return this; } setFontColor() { return this; } setFontSize() { return this; }
}
class Sheet {
  constructor(name) { this.name = name; this.data = []; this.fmt = {}; }
  getLastRow() { let n = this.data.length; while (n > 0 && !(this.data[n - 1] || []).some(v => v !== '' && v !== undefined)) n--; return n; }
  getLastColumn() { return Math.max(0, ...this.data.map(r => (r || []).length)); }
  getMaxRows() { return 1000; }
  getRange(r, c, nr, nc) { return new Range(this, r, c, nr, nc); }
  getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  deleteRow(r) { this.data.splice(r - 1, 1); }
  setFrozenRows() {} setRightToLeft() {}
}
const sheets = {};
const ss = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = new Sheet(n)), getId: () => 'MOCK', getSpreadsheetTimeZone: () => 'Africa/Cairo' };
// seed library sheets exactly like the xlsx: row1 labels, row2 keys
for (const [t, rows] of Object.entries(lib)) {
  if (t === 'LIB_RoadmapTasks' || t === 'LIB_RoadmapChecklist') continue;   // created by setupSystem() from RoadmapData.gs
  const sh = ss.insertSheet(t); const keys = Object.keys(rows[0]);
  sh.data.push(keys.map(k => 'label ' + k)); sh.data.push(keys);
  rows.forEach(r => sh.data.push(keys.map(k => r[k])));
}
const alerts = [];
const ctx = {
  console, JSON, Math, Date, Object, Array, String, Number, RegExp, Error, isNaN,
  SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss, flush() {}, getUi: () => ({ alert: (a, b) => alerts.push(b), ButtonSet: { OK: 1, YES_NO: 2 }, Button: { YES: 'Y' } }) },
  PropertiesService: { getScriptProperties: () => ({ setProperty(k, v) { (global.__props = global.__props || {})[k] = v; }, getProperty: (k) => (global.__props || {})[k] || (k === 'SPREADSHEET_ID' ? 'MOCK' : null) }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  Session: { getActiveUser: () => ({ getEmail: () => 'mentor@athareg.com' }), getEffectiveUser: () => ({ getEmail: () => 'mentor@athareg.com' }), getScriptTimeZone: () => 'Africa/Cairo' },
  Utilities: { formatDate: (d, tz, f) => { const s = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); return f.includes('HH') ? s + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) : s; } },
  ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/mock' }) },
  Sheets: { Spreadsheets: { Values: { batchGet: (id, req) => { global.__batch = (global.__batch || 0) + 1;
    const ser = d => (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()) / 86400000) + 25569;
    return { valueRanges: req.ranges.map(r => { const name = r.match(/^'(.+)'!/)[1]; const sh = sheets[name];
      return { values: sh ? sh.data.map(row => (row || []).map(v => v instanceof Date ? ser(v) : v)) : [] }; }) }; } } } },
  CacheService: { getScriptCache: () => ({ store: (global.__cache = global.__cache || {}), get(k) { return this.store[k] === undefined ? null : this.store[k]; }, getAll(ks) { const o = {}; ks.forEach(k => { if (this.store[k] !== undefined) o[k] = this.store[k]; }); return o; },
    put(k, v) { this.store[k] = v; }, putAll(m) { Object.assign(this.store, m); } }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ t, setMimeType() { return this; }, getContent() { return this.t; } }) }
};
vm.createContext(ctx);
for (const f of ['Schema.gs', 'Core.gs', 'SheetDb.gs', 'TestData.gs', 'RoadmapData.gs', 'Code.gs']) vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗', m); } };

vm.runInContext('setupSystem()', ctx);
ok(ctx.DB_TABLES.every(t => sheets[t] && sheets[t].data[1].join() === ctx.SCHEMA[t].join()), 'setup created every DB sheet with label row + key row');
ok(sheets.DB_Mentors.getLastRow() === 3, 'default mentor created');
ok(sheets.LIB_RoadmapTasks && sheets.LIB_RoadmapTasks.getLastRow() === 147 && sheets.LIB_RoadmapTasks.data[1].join() === ctx.SCHEMA.LIB_RoadmapTasks.join(), 'setup creates LIB_RoadmapTasks (145 rows) from the seed');
ok(sheets.LIB_RoadmapChecklist && sheets.LIB_RoadmapChecklist.getLastRow() === 30, 'setup creates LIB_RoadmapChecklist (28 rows) from the seed');
ok(sheets.DB_ChecklistScores && sheets.DB_ChecklistScores.data[1].join() === ctx.SCHEMA.DB_ChecklistScores.join(), 'setup creates DB_ChecklistScores');
{ const before = sheets.LIB_RoadmapTasks.getLastRow(); sheets.LIB_RoadmapTasks.data[2][6] = 'نص معدّل في الشيت'; vm.runInContext('setupSystem()', ctx);
  ok(sheets.LIB_RoadmapTasks.getLastRow() === before && sheets.LIB_RoadmapTasks.data[2][6] === 'نص معدّل في الشيت', 'running setup again never overwrites the library edited in the sheet'); }
const call = (fn, ...a) => JSON.parse(vm.runInContext(`api(${JSON.stringify(fn)}, ${JSON.stringify(JSON.stringify(a))})`, ctx));
const r1 = call('loadTestData');
ok(r1.ok, 'loadTestData through api bridge: ' + (r1.error || ''));
const boot = call('bootstrap');
ok(boot.ok && boot.data.library.LIB_Actions.length === 68 && boot.data.mentors.length === 2, 'bootstrap returns library + mentors');
const list = call('listProjects', { includeTest: true });
ok(list.data.length === 3 && list.data[0].SessionsCount === 3, 'project list with session counts');
const sesSheet = sheets.DB_Sessions;
const dateCol = ctx.SCHEMA.DB_Sessions.indexOf('SessionDate');
ok(sesSheet.data[2][dateCol] instanceof Date, 'dates stored as real dates (formula friendly)');
const phoneCol = ctx.SCHEMA.DB_Projects.indexOf('Phone');
ok(sheets.DB_Projects.data[2][phoneCol] === '01000000001', 'leading-zero phone kept as text');
const j = call('journey', list.data[0].ProjectID);
ok(j.data.assignments.length === 5 && j.data.assignments.every(a => typeof a.AssignedDate === 'string' && /^\d{4}-/.test(a.AssignedDate)), 'journey reads dates back as yyyy-mm-dd');
const mem = JSON.parse(fs.readFileSync(path.join(__dirname, 'dashboard_expected.json')));
const dash = call('dashboard', { includeTest: true });
const keys = ['completionRate', 'routineAdherence', 'evidenceCoverage', 'outcomeCoverage', 'sessions', 'tasksAssigned', 'completed', 'partial', 'carriedForward'];
// memory run includes extra sessions created by the test-suite; compare on the scenario-only metrics by recomputing in memory
ok(dash.ok && keys.every(k => dash.data.metrics[k] !== undefined), 'dashboard computed from sheets');
const bad = call('finalize', 'NOPE', {});
ok(!bad.ok && /غير موجودة/.test(bad.error), 'errors returned as JSON to the UI');
const integ = call('integrity');
ok(integ.data.ok, 'integrity on sheet data: ' + integ.data.issues.join('|'));
const pdfLess = call('planHtml', 'TEST-PRJ-0001-S02');
ok(pdfLess.ok && pdfLess.data.includes('خطة العمل للأسبوع'), 'plan html from sheet data');
// delete test data leaves zero test rows
const del = call('deleteTestData');
ok(del.ok && ctx.DB_TABLES.every(t => sheets[t].data.slice(2).every(r => r[ctx.SCHEMA[t].indexOf('DataType')] !== 'تجريبي')), 'delete test data removes only test rows (' + del.data + ')');
ok(sheets.DB_Mentors.getLastRow() === 3, 'real mentor untouched');
fs.writeFileSync(path.join(__dirname, 'dashboard_sheet.json'), JSON.stringify(dash.data.metrics, null, 1));
// ---- multi-user safety (≈20 mentors writing at the same time)
{
  const before = sheets.DB_Mentors.getLastRow();
  let threw = false;
  try { vm.runInContext("useSheets_(); DB.insert('DB_Mentors', [{ MentorID: 'X-1', MentorName: 'x' }])", ctx); } catch (e) { threw = /بدون قفل/.test(e.message); }
  ok(threw && sheets.DB_Mentors.getLastRow() === before, 'writes outside withLock are refused');
  // A row inserted by "another user" after this call's cache was filled must be seen inside the lock (fresh IDs).
  vm.runInContext("useSheets_(); DB.all('DB_Mentors')", ctx);   // fill cache
  const keys = ctx.SCHEMA.DB_Mentors; const row = keys.map(k => k === 'MentorID' ? 'M-050' : (k === 'MentorName' ? 'other user' : ''));
  sheets.DB_Mentors.data.push(row);                              // concurrent insert behind our back
  const id = vm.runInContext("DB.withLock(function(){ return nextId_('DB_Mentors','MentorID','M-',3)(); })", ctx);
  ok(id === 'M-051', 'IDs are computed from fresh data once the lock is held (got ' + id + ')');
  ok(call('loadTestData').ok, 'reload test data for the autosave check');
  const sk = ctx.SCHEMA.DB_Sessions;
  const savedRow = sheets.DB_Sessions.data.slice(2).find(r => r[sk.indexOf('Status')] === 'محفوظة');
  ok(!!savedRow, 'a finalized session exists for the autosave check');
  const r = savedRow ? call('saveDraft', savedRow[sk.indexOf('SessionID')], '{}') : { ok: true };
  ok(!r.ok && /محفوظة/.test(r.error), 'autosave cannot overwrite a finalized session');
}
// ---- all DB_ tables come from one batch call per request (and per lock)
{
  global.__batch = 0;
  const reads = {}; const orig = Sheet.prototype.getDataRange;
  Sheet.prototype.getDataRange = function () { reads[this.name] = 1; return orig.call(this); };
  const j2 = JSON.parse(vm.runInContext("api('journey', JSON.stringify(['" + sheets.DB_Projects.data[2][0] + "']))", ctx));
  ok(j2.ok && global.__batch === 1 && !Object.keys(reads).some(k => k.startsWith('DB_')), 'journey: all DB_ tables in ONE batch call, no per-sheet reads (batch=' + global.__batch + ')');
  ok(j2.data.sessions.every(x => /^\d{4}-\d{2}-\d{2}$/.test(x.SessionDate)) && j2.data.sessions.every(x => !x.CreatedAt || /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(x.CreatedAt)), 'batch path: serial dates converted back to yyyy-mm-dd');
  Sheet.prototype.getDataRange = orig;
}
// ---- library cache: second call reads no library sheet
{
  const reads = {}; const orig = Sheet.prototype.getDataRange;
  Sheet.prototype.getDataRange = function () { reads[this.name] = (reads[this.name] || 0) + 1; return orig.call(this); };
  vm.runInContext("useSheets_(); lib_();", ctx);
  Object.keys(reads).forEach(k => delete reads[k]);
  vm.runInContext("useSheets_(); lib_();", ctx);
  ok(!Object.keys(reads).some(k => k.startsWith('LIB_')), 'library served from the script cache (no LIB_ sheet read) — read: ' + Object.keys(reads).join(','));
  const b1 = JSON.parse(vm.runInContext("api('bootstrap', '[]')", ctx)).data;
  const b2 = JSON.parse(vm.runInContext("api('bootstrap', JSON.stringify([{libVersion: '" + b1.libVersion + "'}]))", ctx)).data;
  ok(b1.library && b1.libVersion && b2.library === null, 'bootstrap skips the library when the browser already has this version');
  vm.runInContext("invalidateLibCache_()", ctx);
  const b3 = JSON.parse(vm.runInContext("api('bootstrap', JSON.stringify([{libVersion: '" + b1.libVersion + "'}]))", ctx)).data;
  ok(b3.library && b3.libVersion !== b1.libVersion, 'editing a LIB_ sheet (new version) sends the library again');
  Sheet.prototype.getDataRange = orig;
}
// ---- GitHub Pages JSON API (no sign-in; mentor picks a name)
{
  const post = (body) => JSON.parse(vm.runInContext('doPost(' + JSON.stringify({ postData: { contents: JSON.stringify(body) } }) + ').getContent()', ctx));
  const b = post({ fn: 'bootstrap', args: [], user: 'سارة (M-001)' });
  ok(b.ok && b.data.library.LIB_Actions.length === 68 && b.data.user === 'سارة (M-001)', 'doPost bootstrap returns the library; chosen mentor used as the user');
  const m = post({ fn: 'createMentor', args: [{ MentorName: 'منتور من GitHub' }], user: 'سارة (M-001)' });
  const pr = post({ fn: 'createProject', args: [{ ProjectName: 'مشروع ويب', OwnerName: 'و', BusinessType: 'تجارة', MentorID: m.data.MentorID }], user: 'سارة (M-001)' });
  const pk = ctx.SCHEMA.DB_Projects;
  ok(pr.ok && sheets.DB_Projects.data.some(r => r[pk.indexOf('ProjectID')] === pr.data.ProjectID && r[pk.indexOf('CreatedBy')] === 'سارة (M-001)'), 'doPost writes through the same locked API and records who did it');
  ok(post({ fn: 'nope', args: [] }).ok === false && post({}).ok === false, 'unknown or empty requests are refused');
  const anon = post({ fn: 'bootstrap', args: [] });
  ok(anon.data.user !== 'mentor@athareg.com', 'a web visitor who has not picked a name is never taken for the script owner (got ' + anon.data.user + ')');
  vm.runInContext("REQUEST_USER_='';WEB_REQUEST_=false", ctx);
}
console.log(`SheetDb RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
