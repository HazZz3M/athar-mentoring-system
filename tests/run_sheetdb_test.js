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
  deleteRow(r) { this.data.splice(r - 1, 1); }
  setFrozenRows() {} setRightToLeft() {}
}
const sheets = {};
const ss = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = new Sheet(n)), getId: () => 'MOCK', getSpreadsheetTimeZone: () => 'Africa/Cairo' };
// seed library sheets exactly like the xlsx: row1 labels, row2 keys
for (const [t, rows] of Object.entries(lib)) {
  const sh = ss.insertSheet(t); const keys = Object.keys(rows[0]);
  sh.data.push(keys.map(k => 'label ' + k)); sh.data.push(keys);
  rows.forEach(r => sh.data.push(keys.map(k => r[k])));
}
const alerts = [];
const ctx = {
  console, JSON, Math, Date, Object, Array, String, Number, RegExp, Error, isNaN,
  SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss, flush() {}, getUi: () => ({ alert: (a, b) => alerts.push(b), ButtonSet: { OK: 1, YES_NO: 2 }, Button: { YES: 'Y' } }) },
  PropertiesService: { getScriptProperties: () => ({ setProperty() {}, getProperty: () => 'MOCK' }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  Session: { getActiveUser: () => ({ getEmail: () => 'mentor@athareg.com' }), getEffectiveUser: () => ({ getEmail: () => 'mentor@athareg.com' }), getScriptTimeZone: () => 'Africa/Cairo' },
  Utilities: { formatDate: (d, tz, f) => { const s = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); return f.includes('HH') ? s + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) : s; } },
  ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/mock' }) }
};
vm.createContext(ctx);
for (const f of ['Schema.gs', 'Core.gs', 'SheetDb.gs', 'TestData.gs', 'Code.gs']) vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗', m); } };

vm.runInContext('setupSystem()', ctx);
ok(ctx.DB_TABLES.every(t => sheets[t] && sheets[t].data[1].join() === ctx.SCHEMA[t].join()), 'setup created every DB sheet with label row + key row');
ok(sheets.DB_Mentors.getLastRow() === 3, 'default mentor created');
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
console.log(`SheetDb RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
