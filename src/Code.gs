/**
 * Athar Integrated Mentoring & Business Performance Management System
 * Google Apps Script entry points: menu, web app, API bridge, setup, PDF, test-data tools.
 * Files: Code.gs, Core.gs, SheetDb.gs, Schema.gs, TestData.gs, Index.html, appsscript.json
 */
var DB = null;
var APP_TITLE = 'أثر — نظام المنتورينج ومتابعة الأداء';

function useSheets_() { DB = SheetDb_(); resetLibCache_(); return DB; }

/* ---------------- menu ---------------- */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('🟢 أثر — المنتورينج')
    .addItem('فتح مساحة عمل المنتور', 'openApp')
    .addSeparator()
    .addItem('إعداد / فحص النظام (أول مرة)', 'setupSystem')
    .addItem('فحص سلامة البيانات', 'menuIntegrity')
    .addSeparator()
    .addItem('تحميل البيانات التجريبية (3 مشروعات)', 'menuLoadTestData')
    .addItem('حذف البيانات التجريبية فقط', 'menuDeleteTestData')
    .addToUi();
}

function openApp() {
  var html = HtmlService.createHtmlOutputFromFile('Index').setWidth(1280).setHeight(860).setTitle(APP_TITLE);
  SpreadsheetApp.getUi().showModalDialog(html, APP_TITLE);
}

/* ---------------- web app ---------------- */
function doGet(e) {
  if (e && e.parameter && e.parameter.plan) {
    useSheets_();
    return HtmlService.createHtmlOutput(apiPlanHtml(e.parameter.plan)).setTitle('خطة الأسبوع')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  return HtmlService.createHtmlOutputFromFile('Index').setTitle(APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Single bridge used by the UI: google.script.run.api(fn, JSON.stringify(args)) */
function api(fn, argsJson) {
  try {
    useSheets_();
    var args = argsJson ? JSON.parse(argsJson) : [];
    var ext = { savePlanPdf: savePlanPdf_, loadTestData: loadTestData_, deleteTestData: deleteTestData_, webAppUrl: webAppUrl_ };
    var data = ext[fn] ? ext[fn].apply(null, args) : dispatch_(fn, args);
    return JSON.stringify({ ok: true, data: data });
  } catch (err) {
    console.error(fn, err && err.stack);
    return JSON.stringify({ ok: false, error: String(err && err.message || err), details: err && err.details || null });
  }
}

function webAppUrl_() { try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; } }

/* ---------------- PDF plan ---------------- */
function savePlanPdf_(sessionId) {
  var plan = apiGetPlan(sessionId);
  var html = apiPlanHtml(sessionId);
  var name = 'خطة ' + plan.header.ProjectName + ' - جلسة ' + plan.header.SessionNo + ' - ' + plan.header.SessionDate;
  var pdf = Utilities.newBlob(html, 'text/html', name + '.html').getAs('application/pdf').setName(name + '.pdf');
  var root = getOrCreateFolder_(DriveApp.getRootFolder(), 'Athar Mentoring Plans');
  var folder = getOrCreateFolder_(root, plan.header.ProjectName);
  var file = folder.createFile(pdf);
  DB.withLock(function () { DB.update('DB_Sessions', 'SessionID', sessionId, { PlanUrl: file.getUrl() }); });   // PDF built outside the lock; only the write is locked
  return { url: file.getUrl(), name: file.getName() };
}
function getOrCreateFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/* ---------------- setup ---------------- */
function setupSystem() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  var report = [];
  LIB_TABLES.forEach(function (t) {
    var sh = ss.getSheetByName(t);
    if (!sh) report.push('⚠ ورقة المكتبة مفقودة: ' + t + ' (استورد ملف Athar_Mentoring_System.xlsx كاملًا)');
    else report.push('✓ ' + t + ': ' + Math.max(0, sh.getLastRow() - 2) + ' صف');
  });
  DB_TABLES.forEach(function (t) {
    var keys = SCHEMA[t], labels = SCHEMA_LABELS[t];
    var sh = ss.getSheetByName(t);
    if (!sh) {
      sh = ss.insertSheet(t);
      sh.getRange(1, 1, 1, keys.length).setValues([labels]).setFontWeight('bold').setBackground('#145a63').setFontColor('#ffffff');
      sh.getRange(2, 1, 1, keys.length).setValues([keys]).setFontColor('#8a9599').setFontSize(8);
      sh.setFrozenRows(2); sh.setRightToLeft(true);
      report.push('➕ أنشئت ورقة ' + t);
    } else {
      var have = sh.getRange(2, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(String);
      keys.forEach(function (k, i) {
        if (have.indexOf(k) < 0) { var col = sh.getLastColumn() + 1; sh.getRange(1, col).setValue(labels[i]); sh.getRange(2, col).setValue(k); report.push('➕ عمود جديد ' + k + ' في ' + t); }
      });
      report.push('✓ ' + t + ': ' + Math.max(0, sh.getLastRow() - 2) + ' سجل');
    }
    // text format for every non-date/non-number column so codes like 0101... are not converted
    keys.forEach(function (k, i) {
      var rng = sh.getRange(3, i + 1, sh.getMaxRows() - 2, 1);
      if (DATE_FIELDS.indexOf(k) >= 0) rng.setNumberFormat('yyyy-mm-dd');
      else if (TIMESTAMP_FIELDS.indexOf(k) >= 0) rng.setNumberFormat('@');
      else if (NUMBER_FIELDS.indexOf(k) < 0) rng.setNumberFormat('@');
    });
  });
  useSheets_();
  if (!DB.all('DB_Mentors').filter(function (m) { return m.DataType !== C.TEST; }).length) {
    var me = Session.getActiveUser().getEmail();
    apiCreateMentor({ MentorName: me ? me.split('@')[0] : 'المنتور 1', Email: me });
    report.push('➕ أضيف منتور افتراضي (عدّل الاسم من ورقة DB_Mentors)');
  }
  SpreadsheetApp.getUi().alert('إعداد النظام', report.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

function menuIntegrity() {
  useSheets_();
  var r = apiIntegrityCheck();
  SpreadsheetApp.getUi().alert('فحص سلامة البيانات', r.ok ? '✓ لا توجد مشكلات.' : r.issues.slice(0, 40).join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}
function menuLoadTestData() {
  useSheets_();
  var out = DB.withLock(function () { return loadTestData_(); });
  SpreadsheetApp.getUi().alert('البيانات التجريبية', 'تم تحميل 3 مشروعات تجريبية (معرفاتها تبدأ بـ TEST-):\n' + out.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}
function menuDeleteTestData() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('حذف البيانات التجريبية', 'سيتم حذف كل الصفوف المعلّمة «تجريبي» فقط. البيانات الفعلية لن تتأثر. متابعة؟', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  useSheets_();
  var n = deleteTestData_();
  ui.alert('تم', 'حُذف ' + n + ' صفًا تجريبيًا.', ui.ButtonSet.OK);
}

/** Removes ONLY rows marked «تجريبي». Real data is never deleted by the system. */
function deleteTestData_() {
  var ss = getSpreadsheet_(), removed = 0;
  DB.withLock(function () {
    DB_TABLES.forEach(function (t) {
      var sh = ss.getSheetByName(t); if (!sh || sh.getLastRow() < 3) return;
      var keys = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
      var col = keys.indexOf('DataType'); if (col < 0) return;
      var vals = sh.getRange(3, 1, sh.getLastRow() - 2, keys.length).getValues();
      for (var i = vals.length - 1; i >= 0; i--) {
        if (String(vals[i][col]) === C.TEST) { sh.deleteRow(i + 3); removed++; }
      }
    });
  });
  DB.invalidate();
  return removed;
}
