/**
 * Athar Mentoring System — core business logic.
 * Platform-independent: all storage goes through the global DB adapter
 * (SheetDb in Google Apps Script, MemoryDb in tests and in the offline demo).
 * Historical records are append-only: reviews, occurrences, KPI values, diagnoses and logs are never edited.
 * Assignment rows keep the original assignment unchanged; only the clearly-labelled "(محسوب)" cache columns are refreshed.
 */

var C = {
  YES: 'نعم', NO: 'لا', REAL: 'فعلي', TEST: 'تجريبي',
  ST_DONE: 'مكتملة', ST_PART: 'مكتملة جزئيًا', ST_PROG: 'قيد التنفيذ', ST_NOT: 'لم تبدأ', ST_BLOCK: 'متعثرة', ST_NEW: 'جديدة',
  DEC_DONE: 'تم الإنجاز', DEC_CONT: 'استمرار كما هو', DEC_CARRY: 'ترحيل بموعد جديد', DEC_MOD: 'تعديل/تبسيط',
  DEC_SPLIT: 'تقسيم لمهام أصغر', DEC_PAUSE: 'إيقاف مؤقت', DEC_CANCEL: 'إلغاء لعدم الملاءمة', DEC_ESC: 'تصعيد/دعم إضافي',
  R_CONT: 'استمرار', R_MOD: 'تعديل', R_PAUSE: 'إيقاف مؤقت', R_END: 'إنهاء', R_RESUME: 'إعادة تفعيل',
  RS_ACTIVE: 'نشط', RS_PAUSED: 'متوقف مؤقتًا', RS_ENDED: 'منتهي',
  OCC_DONE: 'تم', OCC_PART: 'جزئي', OCC_MISS: 'لم يتم', OCC_NA: 'غير مستحق/إجازة',
  SES_DRAFT: 'مسودة', SES_SAVED: 'محفوظة',
  T_IMPROVE: 'تحسين', T_CORE: 'روتين أساسي', T_LINKED: 'روتين مرتبط بالاستراتيجية',
  DIAG_CONF: 'مؤكد بدليل', DIAG_LIKELY: 'مرجح ويحتاج تحقق', DIAG_NA: 'غير منطبق',
  WEEKEND: [5],          // Friday (0=Sunday). Change if the business rests on another day.
  MAX_DAILY_SLOTS: 31,
  NEW_TASKS_SOFT_LIMIT: 3,
  // ---- Assiut roadmap (مكتبة خريطة الطريق + تشيك ليست الروتينات)
  ROADMAP_GOVS: ['أسيوط'],          // default scope; override with LIB_Lists «محافظات خريطة الطريق»
  ROADMAP_GOVS_LIST: 'محافظات خريطة الطريق',
  T_ROADMAP: 'مهمة خريطة الطريق',
  CL_DOES: 'بيعملها', CL_SOME: 'ساعات', CL_NO: 'لأ', CL_NA: 'مش بيخصه',
  MODE_PRODUCE: 'بينتج', MODE_TRADE: 'بيشتري ويبيع', MODE_BOTH: 'الاتنين',
  ROADMAP_NEW_LIMIT: 2               // warning only (not enforced): «مفيش أكتر من روتينين جداد في الجلسة»
};
C.CL_VALUES = [C.CL_DOES, C.CL_SOME, C.CL_NO, C.CL_NA];
C.CL_SCORE = {}; C.CL_SCORE[C.CL_DOES] = 2; C.CL_SCORE[C.CL_SOME] = 1; C.CL_SCORE[C.CL_NO] = 0;
C.MODES = [C.MODE_PRODUCE, C.MODE_TRADE, C.MODE_BOTH];
C.CLOSING_DECISIONS = [C.DEC_DONE, C.DEC_CANCEL, C.DEC_SPLIT];
C.TASK_STATUSES = [C.ST_DONE, C.ST_PART, C.ST_PROG, C.ST_NOT, C.ST_BLOCK];
C.TASK_DECISIONS = [C.DEC_DONE, C.DEC_CONT, C.DEC_CARRY, C.DEC_MOD, C.DEC_SPLIT, C.DEC_PAUSE, C.DEC_CANCEL, C.DEC_ESC];
C.ROUTINE_DECISIONS = [C.R_CONT, C.R_MOD, C.R_PAUSE, C.R_END, C.R_RESUME];
C.OCC_STATUSES = [C.OCC_DONE, C.OCC_PART, C.OCC_MISS, C.OCC_NA];
C.BARRIERS = ['ضيق الوقت', 'نقص الموارد', 'نقص المعرفة أو المهارة', 'المهمة صعبة', 'ظروف خارجية', 'لم تكن أولوية لصاحب المشروع', 'الاستراتيجية غير مناسبة', 'أخرى'];

/* ------------------------------------------------------------------ helpers */
function AppError(msg) { var e = new Error(msg); e.isAppError = true; return e; }
function str_(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function num_(v) { if (v === '' || v === null || v === undefined) return null; var n = Number(String(v).replace(/,/g, '')); return isNaN(n) ? null : n; }
function ids_(s) { return str_(s).split(/[,،;؛|\s]+/).filter(function (x) { return x; }); }
function uniq_(a) { var s = {}, o = []; a.forEach(function (x) { if (x && !s[x]) { s[x] = 1; o.push(x); } }); return o; }
function index_(arr, key) { var m = {}; arr.forEach(function (r) { m[r[key]] = r; }); return m; }
function group_(arr, key) { var m = {}; arr.forEach(function (r) { (m[r[key]] = m[r[key]] || []).push(r); }); return m; }
function pad_(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }
function dParse_(s) { var p = str_(s).slice(0, 10).split('-'); if (p.length < 3) return null; return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
function dFmt_(t) { var d = new Date(t); return d.getUTCFullYear() + '-' + pad_(d.getUTCMonth() + 1, 2) + '-' + pad_(d.getUTCDate(), 2); }
function dAdd_(s, n) { return dFmt_(dParse_(s) + n * 86400000); }
function dDiff_(a, b) { return Math.round((dParse_(b) - dParse_(a)) / 86400000); }
function dow_(s) { return new Date(dParse_(s)).getUTCDay(); }
function isDate_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(str_(s)) && dParse_(s) !== null; }
function maxDate_(a, b) { if (!a) return b; if (!b) return a; return a > b ? a : b; }
var DAY_NAMES_ = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

function nextId_(table, field, prefix, width) {
  var max = 0, re = new RegExp('^' + prefix.replace(/[-]/g, '\\-') + '(\\d+)$');
  DB.all(table).forEach(function (r) { var m = re.exec(str_(r[field])); if (m) max = Math.max(max, +m[1]); });
  return function () { max++; return prefix + pad_(max, width || 5); };
}
function log_(gen, projectId, sessionId, action, entity, entityId, details, dataType) {
  return { LogID: gen(), Timestamp: DB.now(), User: DB.user(), ProjectID: projectId, SessionID: sessionId || '', Action: action,
    Entity: entity, EntityID: entityId || '', Details: details || '', DataType: dataType || C.REAL };
}

/* ------------------------------------------------------------------ library */
var LIBX_ = null;
function lib_() {
  if (LIBX_) return LIBX_;
  var L = {};
  LIB_TABLES.forEach(function (t) { L[t] = DB.lib(t); });
  L.area = index_(L.LIB_Areas, 'AreaID');
  L.problem = index_(L.LIB_Problems, 'ProblemID');
  L.cause = index_(L.LIB_Causes, 'CauseID');
  L.strategy = index_(L.LIB_Strategies, 'StrategyID');
  L.action = index_(L.LIB_Actions, 'TaskID');
  L.routine = index_(L.LIB_Routines, 'RoutineID');
  L.kpi = index_(L.LIB_KPIs, 'KPIID');
  L.steps = group_(L.LIB_ActionSteps, 'TaskID');
  L.rsteps = group_(L.LIB_RoutineSteps, 'RoutineID');
  Object.keys(L.steps).forEach(function (k) { L.steps[k].sort(function (a, b) { return a.StepNo - b.StepNo; }); });
  Object.keys(L.rsteps).forEach(function (k) { L.rsteps[k].sort(function (a, b) { return a.StepNo - b.StepNo; }); });
  // roadmap library: indexed on its own AND exposed as routines, so assignment/occurrence tracking is shared
  L.roadmap = index_((L.LIB_RoadmapTasks || []).filter(function (r) { return r.RoadmapID && r.Active !== C.NO; }), 'RoadmapID');
  L.checklist = (L.LIB_RoadmapChecklist || []).filter(function (r) { return r.ItemID; }).sort(function (a, b) { return (+a.SortOrder || 0) - (+b.SortOrder || 0); });
  L.checkItem = index_(L.checklist, 'ItemID');
  Object.keys(L.roadmap).forEach(function (id) { if (!L.routine[id]) L.routine[id] = roadmapAsRoutine_(L.roadmap[id]); });
  LIBX_ = L;
  return L;
}
function resetLibCache_() { LIBX_ = null; }
function roadmapAsRoutine_(t) {
  return { RoutineID: t.RoadmapID, AreaID: t.AreaID, RoutineName: t.TaskText, Purpose: t.ExpectedResult, RoutineType: C.T_ROADMAP,
    FrequencyCode: t.FrequencyCode, TimesPerPeriod: 1, FrequencyText: t.FrequencyText, Responsible: 'صاحب المشروع', Output: t.ExpectedResult,
    Evidence: t.Indicator, AdherenceMeasure: t.Indicator, SummaryEg: t.ExpectedResult, Code: t.Code, Domain: t.Domain, ProgramDay: t.ProgramDay,
    AppliesTo: t.AppliesTo, IsRoadmap: true };
}
function normAr_(s) { return str_(s).replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim(); }
function roadmapGovs_() {
  var custom = (lib_().LIB_Lists || []).filter(function (r) { return r.ListName === C.ROADMAP_GOVS_LIST && str_(r.Value); }).map(function (r) { return r.Value; });
  return custom.length ? custom : C.ROADMAP_GOVS;
}
/** The roadmap (checklist + 145-task library) applies only to projects in the configured governorates (Assiut by default). */
function isRoadmapProject_(p) {
  var g = normAr_(p && p.Governorate);
  return !!g && roadmapGovs_().some(function (x) { return normAr_(x) === g; });
}
/** «لمين» column: كل المشاريع / اللي بينتج / اللي بيشتري ويبيع. Unknown project type shows everything. */
function appliesToMode_(appliesTo, mode) {
  var a = str_(appliesTo);
  if (!a || a === 'كل المشاريع' || !mode || mode === C.MODE_BOTH) return true;
  if (a.indexOf('بينتج') >= 0) return mode === C.MODE_PRODUCE;
  if (a.indexOf('بيشتري') >= 0) return mode === C.MODE_TRADE;
  return true;
}
function checklistPct_(rows) {   // rows: [{Value}] → {pct, applicable, sum}
  var scored = rows.filter(function (r) { return C.CL_SCORE[r.Value] !== undefined; });
  var sum = scored.reduce(function (s, r) { return s + C.CL_SCORE[r.Value]; }, 0);
  return { pct: scored.length ? Math.round(sum / (2 * scored.length) * 1000) / 10 : null, applicable: scored.length, sum: sum,
    does: rows.filter(function (r) { return r.Value === C.CL_DOES; }).length, some: rows.filter(function (r) { return r.Value === C.CL_SOME; }).length,
    no: rows.filter(function (r) { return r.Value === C.CL_NO; }).length };
}
function stepsText_(taskId) {
  var s = lib_().steps[taskId] || [];
  return s.map(function (x) { return x.StepNo + '. ' + x.StepTitle + ': ' + x.Instruction; }).join('\n');
}

/* ------------------------------------------------------------------ bootstrap & projects */
function apiBootstrap() {
  var L = lib_();
  var library = {};
  ['LIB_Areas', 'LIB_Problems', 'LIB_Causes', 'LIB_Strategies', 'LIB_Actions', 'LIB_ActionSteps', 'LIB_Routines',
    'LIB_RoutineSteps', 'LIB_KPIs', 'LIB_Sources', 'LIB_Lists', 'LIB_RoadmapTasks', 'LIB_RoadmapChecklist'].forEach(function (t) { library[t] = L[t] || []; });
  return { library: library, mentors: DB.all('DB_Mentors').filter(function (m) { return m.Active !== C.NO; }),
    user: DB.user(), today: DB.today(), constants: { barriers: C.BARRIERS, statuses: C.TASK_STATUSES, decisions: C.TASK_DECISIONS,
      routineDecisions: C.ROUTINE_DECISIONS, occStatuses: C.OCC_STATUSES, newTasksSoftLimit: C.NEW_TASKS_SOFT_LIMIT,
      roadmapGovs: roadmapGovs_(), checklistValues: C.CL_VALUES, modes: C.MODES, roadmapNewLimit: C.ROADMAP_NEW_LIMIT, roadmapType: C.T_ROADMAP } };
}

function apiListProjects(opts) {
  opts = opts || {};
  var mentors = index_(DB.all('DB_Mentors'), 'MentorID');
  var sessions = group_(DB.all('DB_Sessions'), 'ProjectID');
  var asg = group_(DB.all('DB_TaskAssignments'), 'ProjectID');
  return DB.all('DB_Projects').filter(function (p) { return opts.includeTest || p.DataType !== C.TEST; }).map(function (p) {
    var ss = (sessions[p.ProjectID] || []);
    var saved = ss.filter(function (s) { return s.Status === C.SES_SAVED; }).sort(function (a, b) { return a.SessionNo - b.SessionNo; });
    var draft = ss.filter(function (s) { return s.Status === C.SES_DRAFT; })[0];
    var last = saved[saved.length - 1];
    var open = (asg[p.ProjectID] || []).filter(function (a) { return a.IsOpen === C.YES; }).length;
    return { ProjectID: p.ProjectID, ProjectName: p.ProjectName, OwnerName: p.OwnerName, BusinessType: p.BusinessType, Governorate: p.Governorate,
      ProjectMode: p.ProjectMode || '', IsRoadmap: isRoadmapProject_(p),
      Round: p.Round, Status: p.Status, DataType: p.DataType, MentorID: p.MentorID, MentorName: (mentors[p.MentorID] || {}).MentorName || '',
      SessionsCount: saved.length, LastSessionNo: last ? last.SessionNo : 0, LastSessionDate: last ? last.SessionDate : '',
      NextSessionDate: last ? last.PlanEnd : '', OpenTasks: open, DraftSessionID: draft ? draft.SessionID : '',
      LastProblem: last && last.FocusProblemID ? (lib_().problem[last.FocusProblemID] || {}).ProblemName : '' };
  });
}

function apiCreateProject(p) {
  p = p || {};
  ['ProjectName', 'OwnerName', 'BusinessType', 'MentorID'].forEach(function (f) {
    if (!str_(p[f])) throw AppError('الحقل مطلوب: ' + SCHEMA_LABELS.DB_Projects[SCHEMA.DB_Projects.indexOf(f)]);
  });
  return DB.withLock(function () {
    var all = DB.all('DB_Projects');
    var dup = all.filter(function (x) { return str_(x.ProjectName) === str_(p.ProjectName) && str_(x.OwnerName) === str_(p.OwnerName); });
    if (dup.length) throw AppError('يوجد مشروع بنفس الاسم وصاحب المشروع: ' + dup[0].ProjectID);
    var isTest = p.DataType === C.TEST;
    var gen = nextId_('DB_Projects', 'ProjectID', isTest ? 'TEST-PRJ-' : 'PRJ-', 4);
    var row = { ProjectID: gen(), ProjectName: str_(p.ProjectName), OwnerName: str_(p.OwnerName), Phone: str_(p.Phone),
      BusinessType: str_(p.BusinessType), Governorate: str_(p.Governorate), Location: str_(p.Location), Round: str_(p.Round),
      MentorID: str_(p.MentorID), StartDate: isDate_(p.StartDate) ? p.StartDate : DB.today(), Status: str_(p.Status) || 'نشط',
      Description: str_(p.Description), ProjectMode: C.MODES.indexOf(str_(p.ProjectMode)) >= 0 ? str_(p.ProjectMode) : '',
      DataType: isTest ? C.TEST : C.REAL, CreatedAt: DB.now(), CreatedBy: DB.user() };
    DB.insert('DB_Projects', [row]);
    var lg = nextId_('DB_SessionHistory', 'LogID', 'LOG-', 6);
    DB.insert('DB_SessionHistory', [log_(lg, row.ProjectID, '', 'إنشاء مشروع', 'Project', row.ProjectID, row.ProjectName, row.DataType)]);
    return row;
  });
}

function apiCreateMentor(m) {
  if (!str_(m && m.MentorName)) throw AppError('اسم المنتور مطلوب');
  return DB.withLock(function () {
    var gen = nextId_('DB_Mentors', 'MentorID', m.DataType === C.TEST ? 'TEST-M-' : 'M-', 3);
    var row = { MentorID: gen(), MentorName: str_(m.MentorName), Email: str_(m.Email), Phone: str_(m.Phone), Active: C.YES,
      DataType: m.DataType === C.TEST ? C.TEST : C.REAL, CreatedAt: DB.now() };
    DB.insert('DB_Mentors', [row]);
    return row;
  });
}

/* ------------------------------------------------------------------ journey */
function routineStats_(ra, occs) {
  var mine = occs.filter(function (o) { return o.RAID === ra.RAID; });
  var planned = mine.filter(function (o) { return o.IsPlanned === C.YES; }).length;
  var done = mine.filter(function (o) { return o.IsDone === C.YES; }).length;
  return { planned: planned, done: done, rate: planned ? Math.round(done / planned * 1000) / 10 : null, occurrences: mine };
}

/** «الروتين يتحسب ثابت لما يبان دليله في جلستين ورا بعض»: the last two sessions that reviewed it both saw evidence. */
function routineStability_(ra, occs) {
  var bySes = {};
  occs.filter(function (o) { return o.IsPlanned === C.YES || o.EvidenceSeen === C.YES; }).forEach(function (o) {
    var k = +o.SessionNo; bySes[k] = bySes[k] || { seen: false }; if (o.EvidenceSeen === C.YES) bySes[k].seen = true; });
  var nos = Object.keys(bySes).map(Number).sort(function (a, b) { return a - b; });
  var ev = nos.filter(function (n) { return bySes[n].seen; });
  var last2 = nos.slice(-2);
  return { stable: last2.length === 2 && last2.every(function (n) { return bySes[n].seen; }), evidenceSessions: ev, reviewedSessions: nos };
}

function apiGetJourney(projectId) {
  var L = lib_();
  var p = DB.all('DB_Projects').filter(function (x) { return x.ProjectID === projectId; })[0];
  if (!p) throw AppError('المشروع غير موجود: ' + projectId);
  var mentors = index_(DB.all('DB_Mentors'), 'MentorID');
  var sessions = DB.all('DB_Sessions').filter(function (s) { return s.ProjectID === projectId; }).sort(function (a, b) { return a.SessionNo - b.SessionNo; });
  var asg = DB.all('DB_TaskAssignments').filter(function (a) { return a.ProjectID === projectId; });
  var revs = DB.all('DB_TaskReviews').filter(function (r) { return r.ProjectID === projectId; });
  var revBy = group_(revs, 'AssignmentID');
  var ras = DB.all('DB_RoutineAssignments').filter(function (r) { return r.ProjectID === projectId; });
  var occs = DB.all('DB_RoutineOccurrences').filter(function (o) { return o.ProjectID === projectId; });
  var diags = DB.all('DB_Diagnoses').filter(function (d) { return d.ProjectID === projectId; });
  var pk = DB.all('DB_ProjectKPIs').filter(function (k) { return k.ProjectID === projectId; });
  var kv = DB.all('DB_KPIValues').filter(function (k) { return k.ProjectID === projectId; });
  var evid = DB.all('DB_Evidence').filter(function (e) { return e.ProjectID === projectId; });
  var cls = DB.all('DB_ChecklistScores').filter(function (c) { return c.ProjectID === projectId; });

  asg.forEach(function (a) {
    a.reviews = (revBy[a.AssignmentID] || []).sort(function (x, y) { return x.SessionNo - y.SessionNo; });
    var act = L.action[a.TaskID] || {};
    a.Purpose = act.Purpose || ''; a.SummaryEg = act.SummaryEg || '';
    a.ProblemName = (L.problem[a.ProblemID] || {}).ProblemName || '';
    a.StrategyName = (L.strategy[a.StrategyID] || {}).StrategyName || '';
    a.AreaName = (L.area[a.AreaID] || {}).AreaName || '';
    a.ReviewQuestion = act.ReviewQuestion || 'ماذا نُفذ فعليًا؟ وما النتيجة؟';
    a.ResultMetrics = act.ResultMetrics || '';
    a.everCarried = a.reviews.some(function (r) { return r.Decision === C.DEC_CARRY; });
  });
  ras.forEach(function (r) {
    var st = routineStats_(r, occs);
    r.planned = st.planned; r.done = st.done; r.rate = st.rate;
    r.occurrences = st.occurrences.sort(function (a, b) { return a.DueDate < b.DueDate ? -1 : 1; });
    var lr = L.routine[r.RoutineID] || {};
    r.Purpose = lr.Purpose || ''; r.FrequencyText = lr.FrequencyText || '';
    r.AreaName = (L.area[r.AreaID] || {}).AreaName || '';
    r.StrategyName = (L.strategy[r.StrategyID] || {}).StrategyName || '';
    var stab = routineStability_(r, st.occurrences);
    r.stable = stab.stable; r.evidenceSessions = stab.evidenceSessions; r.reviewedSessions = stab.reviewedSessions;
    if (lr.IsRoadmap) { r.IsRoadmap = true; r.Code = r.RoadmapCode || lr.Code; r.Indicator = lr.Evidence; r.Domain = lr.Domain; }
  });
  sessions.forEach(function (s) {
    s.MentorName = (mentors[s.MentorID] || {}).MentorName || '';
    s.ProblemName = (L.problem[s.FocusProblemID] || {}).ProblemName || '';
    s.StrategyName = (L.strategy[s.PrimaryStrategyID] || {}).StrategyName || '';
    s.SupportingStrategyName = (L.strategy[s.SupportingStrategyID] || {}).StrategyName || '';
    s.diagnoses = diags.filter(function (d) { return d.SessionID === s.SessionID; }).map(function (d) {
      d.CauseText = (L.cause[d.CauseID] || {}).CauseText || ''; return d; });
    s.checklist = cls.filter(function (c) { return c.SessionID === s.SessionID; });
    delete s.DraftJSON;
  });
  var kpis = pk.map(function (k) {
    var lk = L.kpi[k.KPIID] || {};
    var vals = kv.filter(function (v) { return v.KPIID === k.KPIID; }).sort(function (a, b) { return a.SessionNo - b.SessionNo || (a.PeriodEnd < b.PeriodEnd ? -1 : 1); });
    var first = vals[0], last = vals[vals.length - 1];
    var change = (first && last && vals.length > 1) ? last.Value - first.Value : null;
    return { KPIID: k.KPIID, KPIName: lk.KPIName, Unit: lk.Unit, Direction: lk.Direction, BaselineValue: k.BaselineValue, TargetValue: k.TargetValue,
      Active: k.Active, values: vals, change: change,
      changePct: (change !== null && first.Value) ? Math.round(change / Math.abs(first.Value) * 1000) / 10 : null };
  });
  var improvement = asg.filter(function (a) { return a.TaskType === C.T_IMPROVE; });
  var stats = {
    sessions: sessions.filter(function (s) { return s.Status === C.SES_SAVED; }).length,
    assigned: improvement.length,
    completed: improvement.filter(function (a) { return a.CurrentDecision === C.DEC_DONE; }).length,
    partial: improvement.filter(function (a) { return a.IsOpen === C.YES && a.CurrentStatus === C.ST_PART; }).length,
    notDone: improvement.filter(function (a) { return a.IsOpen === C.YES && (a.CurrentStatus === C.ST_NOT || a.CurrentStatus === C.ST_BLOCK); }).length,
    inProgress: improvement.filter(function (a) { return a.IsOpen === C.YES && a.CurrentStatus === C.ST_PROG; }).length,
    carried: improvement.filter(function (a) { return a.everCarried; }).length,
    open: improvement.filter(function (a) { return a.IsOpen === C.YES; }).length,
    cancelled: improvement.filter(function (a) { return a.CurrentDecision === C.DEC_CANCEL; }).length,
    routinesActive: ras.filter(function (r) { return r.Status === C.RS_ACTIVE; }).length,
    routinePlanned: occs.filter(function (o) { return o.IsPlanned === C.YES; }).length,
    routineDone: occs.filter(function (o) { return o.IsDone === C.YES; }).length,
    evidenceCount: evid.length
  };
  p.MentorName = (mentors[p.MentorID] || {}).MentorName || '';
  p.IsRoadmap = isRoadmapProject_(p);
  var savedS = sessions.filter(function (s) { return s.Status === C.SES_SAVED; });
  var clHist = savedS.filter(function (s) { return s.checklist.length; }).map(function (s) {
    var c = checklistPct_(s.checklist); return { SessionID: s.SessionID, SessionNo: s.SessionNo, SessionDate: s.SessionDate, pct: c.pct, does: c.does, some: c.some, no: c.no, applicable: c.applicable }; });
  var lastCl = clHist.length ? savedS.filter(function (s) { return s.SessionID === clHist[clHist.length - 1].SessionID; })[0].checklist : [];
  stats.stableRoutines = ras.filter(function (r) { return r.stable && r.Status === C.RS_ACTIVE; }).length;
  return { project: p, sessions: sessions, assignments: asg, routines: ras, kpis: kpis, stats: stats, evidence: evid,
    checklist: { history: clHist, latest: index_(lastCl, 'ItemID') } };
}

/* ------------------------------------------------------------------ session start / draft */
function routineSlots_(ra, from, to, allOccs) {
  // returns due occurrence slots for the review period [from, to] (inclusive)
  var start = maxDate_(ra.StartDate, from);
  if (!start || !to || start > to) return [];
  var already = {};
  allOccs.filter(function (o) { return o.RAID === ra.RAID; }).forEach(function (o) { already[o.DueDate + '|' + o.PeriodLabel] = 1; });
  var slots = [], days = dDiff_(start, to) + 1, times = Math.max(1, num_(ra.TimesPerPeriod) || 1), i, k;
  if (ra.FrequencyCode === 'DAILY') {
    var s0 = days > C.MAX_DAILY_SLOTS ? dAdd_(to, -(C.MAX_DAILY_SLOTS - 1)) : start;
    for (i = 0; i <= dDiff_(s0, to); i++) {
      var d = dAdd_(s0, i);
      slots.push({ DueDate: d, PeriodLabel: DAY_NAMES_[dow_(d)] + ' ' + d.slice(5), defaultStatus: C.WEEKEND.indexOf(dow_(d)) >= 0 ? C.OCC_NA : '' });
    }
  } else if (ra.FrequencyCode === 'WEEKLY') {
    var weeks = Math.max(1, Math.round(days / 7));
    for (i = 0; i < weeks; i++) for (k = 1; k <= times; k++) {
      var due = dAdd_(start, Math.min(days - 1, i * 7 + 6));
      slots.push({ DueDate: due, PeriodLabel: 'أسبوع ' + (i + 1) + (times > 1 ? ' — مرة ' + k : ''), defaultStatus: '' });
    }
  } else if (ra.FrequencyCode === 'MONTHLY' || ra.FrequencyCode === 'BIWEEKLY') {
    var len = ra.FrequencyCode === 'MONTHLY' ? 28 : 14, lbl = ra.FrequencyCode === 'MONTHLY' ? 'شهر ' : 'أسبوعين ';
    var prev = allOccs.filter(function (o) { return o.RAID === ra.RAID && o.IsPlanned === C.YES; }).map(function (o) { return o.DueDate; }).sort();
    var anchor = prev.length ? dAdd_(prev[prev.length - 1], 1) : ra.StartDate;
    var n = Math.floor((dDiff_(anchor, to) + 1) / len);
    for (i = 1; i <= n; i++) slots.push({ DueDate: dAdd_(anchor, Math.min(i * len - 1, dDiff_(anchor, to))), PeriodLabel: lbl + i, defaultStatus: '' });
  } else { // PERIODIC / event-based
    slots.push({ DueDate: to, PeriodLabel: 'عند الحدث (' + from + ' → ' + to + ')', defaultStatus: '' });
  }
  return slots.filter(function (s) { return !already[s.DueDate + '|' + s.PeriodLabel]; });
}

function sessionContext_(session) {
  var L = lib_();
  var j = apiGetJourney(session.ProjectID);
  var open = j.assignments.filter(function (a) { return a.IsOpen === C.YES && a.SessionID !== session.SessionID; })
    .sort(function (a, b) { return a.SessionNo - b.SessionNo; });
  var allOccs = DB.all('DB_RoutineOccurrences');
  var reviewTo = dAdd_(session.SessionDate, -1);
  var routines = j.routines.filter(function (r) { return r.Status === C.RS_ACTIVE || r.Status === C.RS_PAUSED; }).map(function (r) {
    r.slots = r.Status === C.RS_ACTIVE ? routineSlots_(r, session.ReviewFrom, reviewTo, allOccs) : [];
    r.steps = L.rsteps[r.RoutineID] || [];
    return r;
  });
  var saved = j.sessions.filter(function (s) { return s.Status === C.SES_SAVED; });
  var prev = saved[saved.length - 1] || null;
  var isRm = isRoadmapProject_(j.project);
  return { session: session, project: j.project, openAssignments: open, routines: routines, previousSession: prev,
    journey: j, isFirstSession: saved.length === 0, isRoadmap: isRm,
    checklistItems: isRm ? L.checklist : [], previousChecklist: isRm ? j.checklist.latest : {} };
}

function apiStartSession(projectId, mentorId, sessionDate) {
  return DB.withLock(function () {
    var p = DB.all('DB_Projects').filter(function (x) { return x.ProjectID === projectId; })[0];
    if (!p) throw AppError('المشروع غير موجود');
    var ss = DB.all('DB_Sessions').filter(function (s) { return s.ProjectID === projectId; });
    var draft = ss.filter(function (s) { return s.Status === C.SES_DRAFT; })[0];
    if (draft) return sessionContext_(draft);   // resume, never create a second draft
    var saved = ss.filter(function (s) { return s.Status === C.SES_SAVED; }).sort(function (a, b) { return a.SessionNo - b.SessionNo; });
    var last = saved[saved.length - 1];
    var date = isDate_(sessionDate) ? sessionDate : DB.today();
    if (last && date < last.SessionDate) throw AppError('تاريخ الجلسة لا يمكن أن يسبق آخر جلسة محفوظة (' + last.SessionDate + ')');
    var no = (last ? +last.SessionNo : 0) + 1;
    var s = { SessionID: projectId + '-S' + pad_(no, 2), ProjectID: projectId, SessionNo: no, SessionDate: date,
      MentorID: str_(mentorId) || p.MentorID, Round: p.Round, ReviewFrom: last ? last.SessionDate : p.StartDate,
      PlanStart: date, PlanEnd: dAdd_(date, 7), Status: C.SES_DRAFT, DataType: p.DataType, CreatedAt: DB.now(), DraftJSON: '' };
    DB.insert('DB_Sessions', [s]);
    var lg = nextId_('DB_SessionHistory', 'LogID', 'LOG-', 6);
    DB.insert('DB_SessionHistory', [log_(lg, projectId, s.SessionID, 'بدء جلسة', 'Session', s.SessionID, 'جلسة رقم ' + no, p.DataType)]);
    return sessionContext_(s);
  });
}

function apiSaveDraft(sessionId, draft) {
  // Locked + re-read: an autosave must never overwrite a session that another call has just
  // finalized or discarded, and must never write to a row that moved after a draft was deleted.
  var json = typeof draft === 'string' ? draft : JSON.stringify(draft || {});
  return DB.withLock(function () {
    var s = DB.all('DB_Sessions').filter(function (x) { return x.SessionID === sessionId; })[0];
    if (!s) throw AppError('الجلسة غير موجودة');
    if (s.Status !== C.SES_DRAFT) throw AppError('الجلسة محفوظة بالفعل ولا يمكن تعديلها');
    DB.update('DB_Sessions', 'SessionID', sessionId, { DraftJSON: json });
    return { ok: true, savedAt: DB.now() };
  });
}
function apiGetDraft(sessionId) {
  var s = DB.all('DB_Sessions').filter(function (x) { return x.SessionID === sessionId; })[0];
  if (!s) throw AppError('الجلسة غير موجودة');
  var ctx = sessionContext_(s);
  ctx.draft = s.DraftJSON ? JSON.parse(s.DraftJSON) : null;
  return ctx;
}
function apiDiscardDraft(sessionId) {
  return DB.withLock(function () {
    var s = DB.all('DB_Sessions').filter(function (x) { return x.SessionID === sessionId; })[0];
    if (!s || s.Status !== C.SES_DRAFT) throw AppError('لا توجد مسودة بهذا المعرف');
    DB.remove('DB_Sessions', 'SessionID', sessionId);   // a draft holds no history yet
    var lg = nextId_('DB_SessionHistory', 'LogID', 'LOG-', 6);
    DB.insert('DB_SessionHistory', [log_(lg, s.ProjectID, sessionId, 'حذف مسودة', 'Session', sessionId, '', s.DataType)]);
    return { ok: true };
  });
}

/* ------------------------------------------------------------------ suggestions used by the UI */
function apiSuggest(problemId, causeIds) {
  var L = lib_();
  var pr = L.problem[problemId];
  if (!pr) throw AppError('مشكلة غير معروفة');
  var sel = ids_(causeIds);
  var strategies = ids_(pr.StrategyIDs).map(function (sid) {
    var s = L.strategy[sid]; var c = ids_(s.CauseIDs);
    var matched = c.filter(function (x) { return sel.indexOf(x) >= 0; });
    return { StrategyID: sid, matched: matched.length, matchedCauses: matched };
  }).sort(function (a, b) { return b.matched - a.matched; });
  return { strategies: strategies, kpis: ids_(pr.KPIIDs) };
}

/* ------------------------------------------------------------------ finalize */
function validateFinalize_(ctx, P) {
  var errs = [], L = lib_();
  var rv = index_(P.reviews || [], 'AssignmentID');
  ctx.openAssignments.forEach(function (a) {
    var r = rv[a.AssignmentID], nm = '«' + a.TaskName + '»';
    if (!r) { errs.push('لم تتم مراجعة المهمة ' + nm); return; }
    if (C.TASK_STATUSES.indexOf(r.Status) < 0) errs.push('حدد حالة تنفيذ المهمة ' + nm);
    if (C.TASK_DECISIONS.indexOf(r.Decision) < 0) errs.push('حدد قرار المنتور للمهمة ' + nm);
    if (r.Decision === C.DEC_DONE && r.Status !== C.ST_DONE) errs.push('لا يمكن اعتماد الإنجاز والحالة ليست «مكتملة»: ' + nm);
    if ((r.Decision === C.DEC_CARRY || r.Decision === C.DEC_MOD) && !isDate_(r.NewDeadline)) errs.push('حدد الموعد الجديد للمهمة ' + nm);
    if (r.NewDeadline && isDate_(r.NewDeadline) && r.NewDeadline < P.sessionDate) errs.push('الموعد الجديد يسبق تاريخ الجلسة: ' + nm);
    if ((r.Decision === C.DEC_MOD || r.Decision === C.DEC_ESC) && !str_(r.Adjustment)) errs.push('اكتب التعديل أو الدعم المطلوب للمهمة ' + nm);
    if (r.Decision === C.DEC_SPLIT && !(r.SubTasks || []).filter(function (x) { return str_(x.name); }).length) errs.push('أضف مهمة فرعية واحدة على الأقل عند تقسيم ' + nm);
    if ([C.ST_NOT, C.ST_BLOCK, C.ST_PART].indexOf(r.Status) >= 0 && !(r.Barriers || []).length) errs.push('اختر سبب عدم الإنجاز للمهمة ' + nm);
    if (r.Status !== C.ST_NOT && !str_(r.ImplementationNote)) errs.push('اكتب ماذا نُفذ فعليًا في المهمة ' + nm);
  });
  ctx.routines.forEach(function (r) {
    var rr = (P.routineReviews || []).filter(function (x) { return x.RAID === r.RAID; })[0];
    if (!rr || C.ROUTINE_DECISIONS.indexOf(rr.Decision) < 0) { errs.push('حدد قرار الروتين «' + r.RoutineName + '»'); return; }
    (rr.occurrences || []).forEach(function (o) { if (C.OCC_STATUSES.indexOf(o.Status) < 0) errs.push('حدد حالة كل مرة مستحقة في روتين «' + r.RoutineName + '» (' + o.PeriodLabel + ')'); });
    if (r.slots.length && (rr.occurrences || []).length !== r.slots.length) errs.push('سجل كل المرات المستحقة لروتين «' + r.RoutineName + '»');
    if (r.IsRoadmap && r.slots.length && [C.YES, C.NO].indexOf(rr.EvidenceSeen) < 0) errs.push('حدد هل الدليل اتشاف لروتين «' + r.RoutineName + '»');
  });
  var D = P.diagnosis || {};
  if (!L.problem[D.ProblemID]) errs.push('اختر المشكلة ذات الأولوية');
  else {
    var valid = (D.causes || []).filter(function (c) { return L.cause[c.CauseID] && L.cause[c.CauseID].ProblemID === D.ProblemID && (c.Classification === C.DIAG_CONF || c.Classification === C.DIAG_LIKELY); });
    if (!valid.length) errs.push('صنّف سببًا واحدًا على الأقل كمؤكد أو مرجح');
  }
  var S = P.strategy || {};
  var ps = L.strategy[S.PrimaryStrategyID];
  if (!ps) errs.push('اختر الاستراتيجية الأساسية');
  else if (L.problem[D.ProblemID] && ps.ProblemID !== D.ProblemID) errs.push('الاستراتيجية الأساسية لا تخص المشكلة المختارة');
  if (S.SupportingStrategyID) {
    if (!L.strategy[S.SupportingStrategyID]) errs.push('الاستراتيجية المساندة غير معروفة');
    if (S.SupportingStrategyID === S.PrimaryStrategyID) errs.push('الاستراتيجية المساندة يجب أن تختلف عن الأساسية');
    if (!str_(S.SupportJustification)) errs.push('اكتب مبرر الاستراتيجية المساندة');
  }
  var chosen = [S.PrimaryStrategyID, S.SupportingStrategyID].filter(function (x) { return x; });
  // tasks that will remain open after this session's decisions
  var stillOpen = {};
  ctx.openAssignments.forEach(function (a) { var r = rv[a.AssignmentID]; if (r && C.CLOSING_DECISIONS.indexOf(r.Decision) < 0 && a.TaskID !== 'CUSTOM') stillOpen[a.TaskID] = a; });
  var seen = {};
  (P.newTasks || []).forEach(function (t) {
    var act = L.action[t.TaskID];
    if (t.TaskID === 'CUSTOM') { if (!str_(t.TaskName)) errs.push('اكتب اسم المهمة المخصصة'); if (!str_(t.CustomInstructions)) errs.push('اكتب خطوات تنفيذ المهمة المخصصة «' + str_(t.TaskName) + '»'); }
    else if (!act) { errs.push('مهمة غير معروفة: ' + t.TaskID); return; }
    var nm = '«' + (act ? act.TaskName : t.TaskName) + '»';
    if (t.TaskID !== 'CUSTOM') {
      if (seen[t.TaskID]) errs.push('المهمة مكررة في الخطة: ' + nm);
      seen[t.TaskID] = 1;
      if (stillOpen[t.TaskID]) errs.push('المهمة ' + nm + ' مسندة بالفعل ومفتوحة (' + stillOpen[t.TaskID].AssignmentID + ')؛ استخدم قرار الاستمرار بدل إسنادها مرة أخرى');
      var inStrategy = ids_(act.StrategyIDs).some(function (x) { return chosen.indexOf(x) >= 0; });
      if (!inStrategy && !str_(t.OffStrategyReason)) errs.push('المهمة ' + nm + ' ليست ضمن الاستراتيجية المختارة؛ اكتب مبرر الإسناد');
    } else if (!str_(t.OffStrategyReason)) errs.push('اكتب سبب إضافة المهمة المخصصة «' + str_(t.TaskName) + '»');
    if (!isDate_(t.Deadline)) errs.push('حدد موعد تسليم المهمة ' + nm);
    else if (t.Deadline < P.sessionDate) errs.push('موعد المهمة يسبق تاريخ الجلسة: ' + nm);
  });
  var activeAfter = {};
  ctx.routines.forEach(function (r) {
    var rr = (P.routineReviews || []).filter(function (x) { return x.RAID === r.RAID; })[0] || {};
    var willBe = rr.Decision === C.R_END ? C.RS_ENDED : rr.Decision === C.R_PAUSE ? C.RS_PAUSED : rr.Decision === C.R_RESUME ? C.RS_ACTIVE : r.Status;
    if (willBe !== C.RS_ENDED) activeAfter[r.RoutineID] = r;
  });
  var seenR = {};
  (P.newRoutines || []).forEach(function (r) {
    var lr = L.routine[r.RoutineID];
    if (!lr) { errs.push('روتين غير معروف: ' + r.RoutineID); return; }
    if (lr.IsRoadmap && !ctx.isRoadmap) errs.push('مكتبة خريطة الطريق متاحة لمشروعات ' + roadmapGovs_().join('، ') + ' فقط: «' + lr.RoutineName + '»');
    if (lr.IsRoadmap && !str_(r.WhenWhere)) errs.push('اكتب «إمتى وفين» لروتين ' + lr.Code + ' «' + lr.RoutineName + '»');
    if (seenR[r.RoutineID]) errs.push('الروتين مكرر: «' + lr.RoutineName + '»');
    seenR[r.RoutineID] = 1;
    if (activeAfter[r.RoutineID]) errs.push('الروتين «' + lr.RoutineName + '» مسند بالفعل لهذا المشروع؛ عدّله أو أعد تفعيله بدل تكراره');
  });
  var rd = num_(P.readiness);
  if (!(rd >= 1 && rd <= 5)) errs.push('سجّل درجة استعداد صاحب المشروع من 1 إلى 5');
  else if (rd <= 2 && (P.newTasks || []).length > 1 && !str_(P.workloadNote)) errs.push('الاستعداد منخفض: قلّل المهام أو اكتب سبب الإبقاء عليها');
  if (!isDate_(P.planEnd) || P.planEnd <= P.sessionDate) errs.push('حدد موعد الجلسة التالية بعد تاريخ هذه الجلسة');
  if (!ctx.isFirstSession && !str_(P.businessResultNote)) errs.push('اكتب النتيجة الفعلية للأعمال منذ الجلسة السابقة (حتى لو: لا تغيير بعد)');
  (P.kpiValues || []).forEach(function (k) { if (!L.kpi[k.KPIID]) errs.push('مؤشر غير معروف: ' + k.KPIID); else if (num_(k.Value) === null) errs.push('قيمة غير رقمية للمؤشر «' + L.kpi[k.KPIID].KPIName + '»'); });
  if (ctx.isRoadmap) {
    var mode = str_(P.projectMode) || str_(ctx.project.ProjectMode);
    if (C.MODES.indexOf(mode) < 0) errs.push('حدد نوع المشروع: بينتج / بيشتري ويبيع / الاتنين (لتشيك ليست الروتينات)');
    var cl = index_(P.checklist || [], 'ItemID');
    var missing = ctx.checklistItems.filter(function (it) { return C.CL_VALUES.indexOf((cl[it.ItemID] || {}).Value) < 0; });
    if (missing.length) errs.push('قيّم كل بنود تشيك ليست الروتينات (ناقص ' + missing.length + ' من ' + ctx.checklistItems.length + '): ' + missing.slice(0, 3).map(function (it) { return '«' + it.RoutineText + '»'; }).join('، ') + (missing.length > 3 ? '…' : ''));
    (P.checklist || []).forEach(function (c) { if (!L.checkItem[c.ItemID]) errs.push('بند غير معروف في التشيك ليست: ' + c.ItemID); });
  } else if ((P.checklist || []).length) errs.push('تشيك ليست الروتينات خاصة بمشروعات ' + roadmapGovs_().join('، '));
  return errs;
}

function apiFinalizeSession(sessionId, P) {
  return DB.withLock(function () {
    var L = lib_();
    var s = DB.all('DB_Sessions').filter(function (x) { return x.SessionID === sessionId; })[0];
    if (!s) throw AppError('الجلسة غير موجودة');
    if (s.Status !== C.SES_DRAFT) throw AppError('هذه الجلسة محفوظة بالفعل؛ لا يتم تعديل السجلات التاريخية');
    P = P || {};
    P.sessionDate = isDate_(P.sessionDate) ? P.sessionDate : s.SessionDate;
    if (P.sessionDate !== s.SessionDate) { s.SessionDate = P.sessionDate; s.PlanStart = P.sessionDate; }
    var ctx = sessionContext_(s);
    var errs = validateFinalize_(ctx, P);
    if (errs.length) { var e = AppError('لا يمكن حفظ الجلسة قبل استكمال ما يلي:\n• ' + errs.join('\n• ')); e.details = errs; throw e; }

    var p = ctx.project, dt = p.DataType, now = DB.now(), user = DB.user(), date = P.sessionDate;
    var common = { MentorID: s.MentorID, Round: s.Round, DataType: dt };
    var gRev = nextId_('DB_TaskReviews', 'ReviewID', 'REV-', 6), gAsg = nextId_('DB_TaskAssignments', 'AssignmentID', 'ASG-', 6),
        gEv = nextId_('DB_Evidence', 'EvidenceID', 'EVD-', 6), gOcc = nextId_('DB_RoutineOccurrences', 'OccurrenceID', 'OCC-', 7),
        gRA = nextId_('DB_RoutineAssignments', 'RAID', 'RA-', 5), gKV = nextId_('DB_KPIValues', 'ValueID', 'KV-', 6),
        gPK = nextId_('DB_ProjectKPIs', 'PKID', 'PK-', 5), gDx = nextId_('DB_Diagnoses', 'DiagnosisID', 'DX-', 6),
        gLog = nextId_('DB_SessionHistory', 'LogID', 'LOG-', 6), gCS = nextId_('DB_ChecklistScores', 'ScoreID', 'CS-', 7);
    var reviews = [], evidence = [], newAsg = [], occRows = [], logs = [], asgUpdates = [], raUpdates = [], clRows = [];
    var rv = index_(P.reviews || [], 'AssignmentID');

    // 1) review of previous tasks (append-only) + refresh of derived cache columns
    ctx.openAssignments.forEach(function (a) {
      var r = rv[a.AssignmentID];
      var metrics = r.Metrics || {};
      var mText = Object.keys(metrics).filter(function (k) { return str_(metrics[k]) !== ''; }).map(function (k) { return k + ': ' + metrics[k]; }).join(' | ');
      var before = num_(r.BeforeValue), after = num_(r.AfterValue);
      var change = (before !== null && after !== null) ? after - before : null;
      var pct = (change !== null && before) ? Math.round(change / Math.abs(before) * 1000) / 10 : null;
      var hasEv = (str_(r.EvidenceLink) || str_(r.EvidenceNote)) && r.EvidenceType !== 'لا يوجد' ? C.YES : C.NO;
      var completed = r.Status === C.ST_DONE;
      var due = a.CurrentDeadline || a.OriginalDeadline;
      var applicable = !(r.Decision === C.DEC_CANCEL && !completed) && !(r.Decision === C.DEC_PAUSE && !completed);
      var countsDue = applicable && (completed || (due && due <= date));
      var outcomeDue = r.Status === C.ST_DONE || r.Status === C.ST_PART;
      var outcomeRec = outcomeDue && (str_(r.ActualResult) || after !== null || mText) ? C.YES : C.NO;
      var rid = gRev();
      reviews.push({ ReviewID: rid, AssignmentID: a.AssignmentID, ProjectID: p.ProjectID, SessionID: s.SessionID, SessionNo: s.SessionNo,
        ReviewDate: date, TaskID: a.TaskID, AreaID: a.AreaID, MentorID: s.MentorID, Round: s.Round, DueDate: due, Status: r.Status,
        ImplementationNote: str_(r.ImplementationNote), MetricsJSON: JSON.stringify(metrics), MetricsText: mText,
        ExpectedResult: str_(r.ExpectedResult) || a.ExpectedResult, ActualResult: str_(r.ActualResult), BeforeValue: before, AfterValue: after,
        ChangeValue: change, ChangePct: pct, MentorObservation: str_(r.MentorObservation), EvidenceType: str_(r.EvidenceType),
        EvidenceLink: str_(r.EvidenceLink), EvidenceNote: str_(r.EvidenceNote), HasEvidence: hasEv,
        BarrierCategories: (r.Barriers || []).join('، '), BarrierNote: str_(r.BarrierNote), Decision: r.Decision,
        NewDeadline: C.CLOSING_DECISIONS.indexOf(r.Decision) >= 0 ? '' : (isDate_(r.NewDeadline) ? r.NewDeadline : ((due && due >= date) ? due : P.planEnd)), Adjustment: str_(r.Adjustment),
        CountsAsDue: countsDue ? C.YES : C.NO, IsCompleted: completed ? C.YES : C.NO, OutcomeDue: outcomeDue ? C.YES : C.NO,
        OutcomeRecorded: outcomeRec, DataType: dt, CreatedAt: now, CreatedBy: user });
      if (hasEv === C.YES) evidence.push({ EvidenceID: gEv(), ProjectID: p.ProjectID, SessionID: s.SessionID, LinkedType: 'مراجعة مهمة',
        LinkedID: rid, EvidenceType: str_(r.EvidenceType), Link: str_(r.EvidenceLink), Description: str_(r.EvidenceNote) || a.TaskName,
        EvidenceDate: date, DataType: dt, CreatedAt: now });
      var closing = C.CLOSING_DECISIONS.indexOf(r.Decision) >= 0;
      var newDeadline = isDate_(r.NewDeadline) ? r.NewDeadline : ((due && due >= date) ? due : P.planEnd);
      asgUpdates.push([a.AssignmentID, { CurrentStatus: r.Status, CurrentDecision: r.Decision, CurrentDeadline: closing ? due : newDeadline,
        IsOpen: closing ? C.NO : C.YES, LastReviewSessionNo: s.SessionNo, ReviewCount: (num_(a.ReviewCount) || 0) + 1, ClosedDate: closing ? date : '' }]);
      logs.push(log_(gLog, p.ProjectID, s.SessionID, 'مراجعة مهمة', 'Assignment', a.AssignmentID, r.Status + ' ← ' + r.Decision, dt));
      if (r.Decision === C.DEC_SPLIT) {
        (r.SubTasks || []).filter(function (x) { return str_(x.name); }).forEach(function (st) {
          var id = gAsg();
          newAsg.push(Object.assign({ AssignmentID: id, ProjectID: p.ProjectID, SessionID: s.SessionID, SessionNo: s.SessionNo, AssignedDate: date,
            TaskID: 'CUSTOM', TaskName: str_(st.name), TaskType: C.T_IMPROVE, AreaID: a.AreaID, ProblemID: a.ProblemID, StrategyID: a.StrategyID,
            Priority: a.Priority, FrequencyCode: 'ONCE', OriginalDeadline: isDate_(st.deadline) ? st.deadline : P.planEnd, Responsible: a.Responsible,
            CustomInstructions: str_(st.instructions) || ('جزء من المهمة الأصلية: ' + a.TaskName), ExpectedResult: '', Deliverable: str_(st.deliverable),
            EvidenceRequired: a.EvidenceRequired, TargetNote: '', OffStrategyReason: '', ParentAssignmentID: a.AssignmentID,
            Origin: 'مقسّمة من ' + a.AssignmentID, StepsSnapshot: a.StepsSnapshot, CreatedAt: now, CurrentStatus: C.ST_NEW, CurrentDecision: '',
            CurrentDeadline: isDate_(st.deadline) ? st.deadline : P.planEnd, IsOpen: C.YES, LastReviewSessionNo: '', ReviewCount: 0, ClosedDate: '' }, common));
        });
      }
    });

    // 2) routines: one execution record per due occurrence + status decisions on the single ongoing assignment
    ctx.routines.forEach(function (r) {
      var rr = (P.routineReviews || []).filter(function (x) { return x.RAID === r.RAID; })[0];
      (rr.occurrences || []).forEach(function (o) {
        occRows.push({ OccurrenceID: gOcc(), RAID: r.RAID, ProjectID: p.ProjectID, RoutineID: r.RoutineID, SessionID: s.SessionID, SessionNo: s.SessionNo,
          DueDate: o.DueDate, PeriodLabel: o.PeriodLabel, Status: o.Status, IsPlanned: o.Status === C.OCC_NA ? C.NO : C.YES,
          IsDone: o.Status === C.OCC_DONE ? C.YES : C.NO, Note: str_(rr.Note), EvidenceLink: str_(rr.EvidenceLink), AreaID: r.AreaID,
          EvidenceSeen: [C.YES, C.NO].indexOf(rr.EvidenceSeen) >= 0 ? rr.EvidenceSeen : '',
          MentorID: s.MentorID, Round: s.Round, DataType: dt, CreatedAt: now });
      });
      if (str_(rr.EvidenceLink)) evidence.push({ EvidenceID: gEv(), ProjectID: p.ProjectID, SessionID: s.SessionID, LinkedType: 'روتين', LinkedID: r.RAID,
        EvidenceType: 'رابط', Link: str_(rr.EvidenceLink), Description: r.RoutineName, EvidenceDate: date, DataType: dt, CreatedAt: now });
      var patch = null;
      if (rr.Decision === C.R_PAUSE && r.Status !== C.RS_PAUSED) patch = { Status: C.RS_PAUSED, StatusSessionID: s.SessionID, EndDate: date };
      if (rr.Decision === C.R_END) patch = { Status: C.RS_ENDED, StatusSessionID: s.SessionID, EndDate: date };
      if (rr.Decision === C.R_RESUME && r.Status !== C.RS_ACTIVE) patch = { Status: C.RS_ACTIVE, StatusSessionID: s.SessionID, EndDate: '', StartDate: date };
      if (rr.Decision === C.R_MOD) patch = { CustomNote: str_(rr.NewNote) || r.CustomNote, StatusSessionID: s.SessionID, Responsible: str_(rr.Responsible) || r.Responsible };
      if (patch) raUpdates.push([r.RAID, patch]);
      logs.push(log_(gLog, p.ProjectID, s.SessionID, 'مراجعة روتين', 'Routine', r.RAID, rr.Decision + ' — ' + (rr.occurrences || []).filter(function (o) { return o.Status === C.OCC_DONE; }).length + '/' +
        (rr.occurrences || []).filter(function (o) { return o.Status !== C.OCC_NA; }).length, dt));
    });

    // 3) KPIs
    var pkExisting = DB.all('DB_ProjectKPIs').filter(function (k) { return k.ProjectID === p.ProjectID; });
    var pkIds = pkExisting.map(function (k) { return k.KPIID; });
    var pkRows = [];
    (P.newProjectKPIs || []).forEach(function (k) {
      if (L.kpi[k.KPIID] && pkIds.indexOf(k.KPIID) < 0) { pkIds.push(k.KPIID);
        pkRows.push({ PKID: gPK(), ProjectID: p.ProjectID, KPIID: k.KPIID, BaselineValue: num_(k.BaselineValue), TargetValue: num_(k.TargetValue),
          AddedSessionID: s.SessionID, Active: C.YES, DataType: dt, CreatedAt: now }); }
    });
    var kvRows = (P.kpiValues || []).filter(function (k) { return num_(k.Value) !== null; }).map(function (k) {
      if (pkIds.indexOf(k.KPIID) < 0) { pkIds.push(k.KPIID); pkRows.push({ PKID: gPK(), ProjectID: p.ProjectID, KPIID: k.KPIID, BaselineValue: num_(k.Value),
        TargetValue: null, AddedSessionID: s.SessionID, Active: C.YES, DataType: dt, CreatedAt: now }); }
      return { ValueID: gKV(), ProjectID: p.ProjectID, SessionID: s.SessionID, SessionNo: s.SessionNo, KPIID: k.KPIID,
        PeriodStart: isDate_(k.PeriodStart) ? k.PeriodStart : s.ReviewFrom, PeriodEnd: isDate_(k.PeriodEnd) ? k.PeriodEnd : date,
        Value: num_(k.Value), Source: str_(k.Source) || 'سجل المشروع', Note: str_(k.Note), AreaID: (L.kpi[k.KPIID] || {}).AreaID,
        MentorID: s.MentorID, Round: s.Round, DataType: dt, CreatedAt: now };
    });

    // 4) diagnosis
    var D = P.diagnosis;
    var dxRows = (D.causes || []).filter(function (c) { return L.cause[c.CauseID] && L.cause[c.CauseID].ProblemID === D.ProblemID && c.Classification; }).map(function (c) {
      return { DiagnosisID: gDx(), SessionID: s.SessionID, ProjectID: p.ProjectID, AreaID: L.problem[D.ProblemID].AreaID, ProblemID: D.ProblemID,
        CauseID: c.CauseID, Classification: c.Classification, EvidenceNote: str_(c.EvidenceNote), MentorID: s.MentorID, Round: s.Round, DataType: dt, CreatedAt: now };
    });

    // 5) new improvement tasks (snapshot of instructions at assignment time keeps the original even if the library changes later)
    var S = P.strategy;
    (P.newTasks || []).forEach(function (t) {
      var act = L.action[t.TaskID] || {};
      var custom = t.TaskID === 'CUSTOM';
      var sid = str_(t.StrategyID) || (ids_(act.StrategyIDs).filter(function (x) { return x === S.PrimaryStrategyID || x === S.SupportingStrategyID; })[0]) || S.PrimaryStrategyID;
      var id = gAsg();
      newAsg.push(Object.assign({ AssignmentID: id, ProjectID: p.ProjectID, SessionID: s.SessionID, SessionNo: s.SessionNo, AssignedDate: date,
        TaskID: t.TaskID, TaskName: custom ? str_(t.TaskName) : act.TaskName, TaskType: C.T_IMPROVE, AreaID: custom ? L.problem[D.ProblemID].AreaID : act.AreaID,
        ProblemID: custom ? D.ProblemID : act.ProblemID, StrategyID: sid, Priority: custom ? 'مخصص' : act.Priority, FrequencyCode: custom ? 'ONCE' : act.FrequencyCode,
        OriginalDeadline: t.Deadline, Responsible: str_(t.Responsible) || act.Responsible || 'صاحب المشروع', CustomInstructions: str_(t.CustomInstructions),
        ExpectedResult: str_(t.ExpectedResult) || act.OutcomeIndicator || '', Deliverable: str_(t.Deliverable) || act.Deliverable || '',
        EvidenceRequired: str_(t.EvidenceRequired) || act.Evidence || '', TargetNote: str_(t.TargetNote), OffStrategyReason: str_(t.OffStrategyReason),
        ParentAssignmentID: '', Origin: custom ? 'مخصصة' : 'جديدة', StepsSnapshot: custom ? str_(t.CustomInstructions) : stepsText_(t.TaskID),
        CreatedAt: now, CurrentStatus: C.ST_NEW, CurrentDecision: '', CurrentDeadline: t.Deadline, IsOpen: C.YES, LastReviewSessionNo: '', ReviewCount: 0, ClosedDate: '' }, common));
      logs.push(log_(gLog, p.ProjectID, s.SessionID, 'إسناد مهمة', 'Assignment', id, (custom ? t.TaskName : act.TaskName), dt));
    });

    // 6) new routines — one ongoing assignment each (no weekly duplicates)
    var raRows = (P.newRoutines || []).map(function (r) {
      var lr = L.routine[r.RoutineID];
      var id = gRA();
      logs.push(log_(gLog, p.ProjectID, s.SessionID, 'إسناد روتين', 'Routine', id, (lr.IsRoadmap ? lr.Code + ' ' : '') + lr.RoutineName, dt));
      return Object.assign({ RAID: id, ProjectID: p.ProjectID, RoutineID: r.RoutineID, RoutineName: lr.RoutineName, RoutineType: lr.RoutineType, AreaID: lr.AreaID,
        StrategyID: lr.RoutineType === C.T_LINKED ? (str_(r.StrategyID) || S.PrimaryStrategyID) : str_(r.StrategyID), FrequencyCode: lr.FrequencyCode,
        TimesPerPeriod: num_(lr.TimesPerPeriod) || 1, StartDate: isDate_(r.StartDate) ? r.StartDate : date, StartSessionID: s.SessionID,
        Responsible: str_(r.Responsible) || lr.Responsible, CustomNote: str_(r.CustomNote), Status: C.RS_ACTIVE, StatusSessionID: s.SessionID,
        EndDate: '', WhenWhere: str_(r.WhenWhere), RoadmapCode: lr.IsRoadmap ? lr.Code : '', CreatedAt: now }, common);
    });

    // 6b) Assiut roadmap: routine checklist scored every session (append-only) + project type
    var clStat = null, projPatch = null;
    if (ctx.isRoadmap) {
      var clBy = index_(P.checklist || [], 'ItemID');
      clRows = ctx.checklistItems.map(function (it) {
        var c = clBy[it.ItemID], v = c.Value;
        return { ScoreID: gCS(), ProjectID: p.ProjectID, SessionID: s.SessionID, SessionNo: s.SessionNo, ItemID: it.ItemID, Value: v,
          Score: C.CL_SCORE[v] === undefined ? '' : C.CL_SCORE[v], Note: str_(c.Note), AreaID: it.AreaID, MentorID: s.MentorID, Round: s.Round, DataType: dt, CreatedAt: now };
      });
      clStat = checklistPct_(clRows);
      logs.push(log_(gLog, p.ProjectID, s.SessionID, 'تشيك ليست الروتينات', 'Session', s.SessionID, 'الدرجة ' + (clStat.pct === null ? '—' : clStat.pct + '%') +
        ' (بيعملها ' + clStat.does + '، ساعات ' + clStat.some + '، لأ ' + clStat.no + ')', dt));
      var mode = str_(P.projectMode);
      if (C.MODES.indexOf(mode) >= 0 && mode !== str_(p.ProjectMode)) {
        projPatch = { ProjectMode: mode };
        logs.push(log_(gLog, p.ProjectID, s.SessionID, 'تعديل نوع المشروع', 'Project', p.ProjectID, (p.ProjectMode || '—') + ' ← ' + mode, dt));
      }
    }

    // 7) session record
    var continuing = ctx.openAssignments.filter(function (a) { return C.CLOSING_DECISIONS.indexOf(rv[a.AssignmentID].Decision) < 0; }).length;
    var activeRoutines = ctx.routines.filter(function (r) { var d = ((P.routineReviews || []).filter(function (x) { return x.RAID === r.RAID; })[0] || {}).Decision;
      return d === C.R_RESUME || ((d === C.R_CONT || d === C.R_MOD) && r.Status === C.RS_ACTIVE); }).length + raRows.length;
    var sp = { SessionDate: date, PlanStart: date, PlanEnd: P.planEnd, Status: C.SES_SAVED, FocusAreaID: L.problem[D.ProblemID].AreaID, FocusProblemID: D.ProblemID,
      PrimaryStrategyID: S.PrimaryStrategyID, SupportingStrategyID: str_(S.SupportingStrategyID), SupportJustification: str_(S.SupportJustification),
      ContinuedFocus: D.ContinuedFocus ? C.YES : C.NO, Readiness: num_(P.readiness), WorkloadNote: str_(P.workloadNote),
      NewTasksCount: (P.newTasks || []).length + newAsg.filter(function (a) { return a.ParentAssignmentID; }).length,
      ContinuingTasksCount: continuing, ActiveRoutinesCount: activeRoutines, BusinessResultNote: str_(P.businessResultNote),
      MentorSummary: str_(P.mentorSummary), DraftJSON: '', SavedAt: now, AfterTrainingDay: str_(P.afterTrainingDay),
      ChecklistScorePct: clStat ? clStat.pct : '', ChecklistApplicable: clStat ? clStat.applicable : '' };
    logs.push(log_(gLog, p.ProjectID, s.SessionID, 'حفظ جلسة', 'Session', s.SessionID, 'مراجعة ' + reviews.length + ' مهمة، ' + newAsg.length + ' مهمة جديدة، ' + raRows.length + ' روتين جديد', dt));

    // writes (all validated above)
    if (reviews.length) DB.insert('DB_TaskReviews', reviews);
    asgUpdates.forEach(function (u) { DB.update('DB_TaskAssignments', 'AssignmentID', u[0], u[1]); });
    if (newAsg.length) DB.insert('DB_TaskAssignments', newAsg);
    if (occRows.length) DB.insert('DB_RoutineOccurrences', occRows);
    raUpdates.forEach(function (u) { DB.update('DB_RoutineAssignments', 'RAID', u[0], u[1]); });
    if (raRows.length) DB.insert('DB_RoutineAssignments', raRows);
    if (pkRows.length) DB.insert('DB_ProjectKPIs', pkRows);
    if (kvRows.length) DB.insert('DB_KPIValues', kvRows);
    if (dxRows.length) DB.insert('DB_Diagnoses', dxRows);
    if (evidence.length) DB.insert('DB_Evidence', evidence);
    if (clRows.length) DB.insert('DB_ChecklistScores', clRows);
    if (projPatch) DB.update('DB_Projects', 'ProjectID', p.ProjectID, projPatch);
    DB.update('DB_Sessions', 'SessionID', s.SessionID, sp);
    DB.insert('DB_SessionHistory', logs);
    return { ok: true, sessionId: s.SessionID, reviews: reviews.length, newTasks: newAsg.length, newRoutines: raRows.length, occurrences: occRows.length,
      checklistPct: clStat ? clStat.pct : null };
  });
}

/* ------------------------------------------------------------------ weekly plan */
function apiGetPlan(sessionId) {
  var L = lib_();
  var s = DB.all('DB_Sessions').filter(function (x) { return x.SessionID === sessionId; })[0];
  if (!s) throw AppError('الجلسة غير موجودة');
  if (s.Status !== C.SES_SAVED) throw AppError('احفظ الجلسة أولًا لتوليد الخطة');
  var p = DB.all('DB_Projects').filter(function (x) { return x.ProjectID === s.ProjectID; })[0];
  var mentor = DB.all('DB_Mentors').filter(function (m) { return m.MentorID === s.MentorID; })[0] || {};
  var asg = DB.all('DB_TaskAssignments').filter(function (a) { return a.ProjectID === s.ProjectID; });
  var revs = DB.all('DB_TaskReviews').filter(function (r) { return r.SessionID === s.SessionID; });
  var revBy = index_(revs, 'AssignmentID');
  var dx = DB.all('DB_Diagnoses').filter(function (d) { return d.SessionID === s.SessionID && d.Classification !== C.DIAG_NA; });
  var strat = L.strategy[s.PrimaryStrategyID] || {};
  var newTasks = asg.filter(function (a) { return a.SessionID === s.SessionID; }).map(function (a) {
    var act = L.action[a.TaskID] || {};
    var steps = a.TaskID === 'CUSTOM' ? [] : (L.steps[a.TaskID] || []);
    return { AssignmentID: a.AssignmentID, TaskID: a.TaskID, TaskName: a.TaskName, Why: act.Purpose || a.CustomInstructions, Summary: act.SummaryEg || '',
      Steps: steps.map(function (x) { return { no: x.StepNo, title: x.StepTitle, text: x.Instruction }; }),
      Snapshot: a.TaskID === 'CUSTOM' ? a.StepsSnapshot : '', CustomInstructions: a.CustomInstructions, Deadline: a.OriginalDeadline,
      Responsible: a.Responsible, Deliverable: a.Deliverable, Evidence: a.EvidenceRequired, Target: a.TargetNote, Alternative: act.LowResourceAlternative || '',
      Cautions: act.Cautions || '', Origin: a.Origin, Time: act.EstimatedTime || '' };
  });
  // reproduced from this session's own review records, so an old plan always shows what was decided at that time
  var continuing = asg.filter(function (a) { var r = revBy[a.AssignmentID]; return r && C.CLOSING_DECISIONS.indexOf(r.Decision) < 0; }).map(function (a) {
    var r = revBy[a.AssignmentID];
    return { AssignmentID: a.AssignmentID, TaskName: a.TaskName, AssignedSessionNo: a.SessionNo, PreviousStatus: r.Status, Decision: r.Decision,
      Deadline: r.NewDeadline, Adjustment: r.Adjustment, Paused: r.Decision === C.DEC_PAUSE, Summary: (L.action[a.TaskID] || {}).SummaryEg || a.CustomInstructions };
  });
  var ras = DB.all('DB_RoutineAssignments').filter(function (r) {
    return r.ProjectID === s.ProjectID && r.StartDate <= s.PlanEnd && (r.Status === C.RS_ACTIVE || (r.EndDate && r.EndDate > s.SessionDate)); });
  var groups = { DAILY: [], WEEKLY: [], BIWEEKLY: [], MONTHLY: [], PERIODIC: [] };
  ras.forEach(function (r) {
    var lr = L.routine[r.RoutineID] || {};
    (groups[r.FrequencyCode] || groups.PERIODIC).push({ RAID: r.RAID, RoutineName: r.RoutineName, RoutineType: r.RoutineType, Frequency: lr.FrequencyText,
      IsRoadmap: !!lr.IsRoadmap, Code: r.RoadmapCode || lr.Code || '', WhenWhere: r.WhenWhere || '', Indicator: lr.IsRoadmap ? lr.Evidence : '',
      Summary: lr.SummaryEg, Steps: (L.rsteps[r.RoutineID] || []).map(function (x) { return { no: x.StepNo, title: x.StepTitle, text: x.Instruction }; }),
      Output: lr.Output, Evidence: lr.Evidence, Responsible: r.Responsible, CustomNote: r.CustomNote, Paper: lr.PaperAlternative, IsNew: r.StartSessionID === s.SessionID });
  });
  return {
    header: { ProjectName: p.ProjectName, OwnerName: p.OwnerName, BusinessType: p.BusinessType, MentorName: mentor.MentorName || '', Round: s.Round,
      SessionNo: s.SessionNo, SessionDate: s.SessionDate, PlanStart: s.PlanStart, PlanEnd: s.PlanEnd, DataType: p.DataType, Readiness: s.Readiness },
    focus: { Area: (L.area[s.FocusAreaID] || {}).AreaName, Problem: (L.problem[s.FocusProblemID] || {}).ProblemName,
      Causes: dx.map(function (d) { return { text: (L.cause[d.CauseID] || {}).CauseText, cls: d.Classification }; }),
      Strategy: strat.StrategyName, StrategyAim: strat.Aim, Expected: strat.ExpectedResults,
      Supporting: (L.strategy[s.SupportingStrategyID] || {}).StrategyName || '', Continued: s.ContinuedFocus === C.YES },
    newTasks: newTasks, continuing: continuing.filter(function (c) { return !c.Paused; }), paused: continuing.filter(function (c) { return c.Paused; }),
    routines: groups, mentorSummary: s.MentorSummary, nextSession: s.PlanEnd,
    checklist: planChecklist_(s), businessResult: s.BusinessResultNote, afterTrainingDay: s.AfterTrainingDay || ''
  };
}
/** Checklist summary for a saved session: score now vs first session, and the items still «لأ/ساعات». */
function planChecklist_(s) {
  var L = lib_();
  var all = DB.all('DB_ChecklistScores').filter(function (c) { return c.ProjectID === s.ProjectID; });
  var mine = all.filter(function (c) { return c.SessionID === s.SessionID; });
  if (!mine.length) return null;
  var nos = uniq_(all.map(function (c) { return String(c.SessionNo); })).map(Number).sort(function (a, b) { return a - b; });
  var first = all.filter(function (c) { return +c.SessionNo === nos[0]; });
  var now = checklistPct_(mine), base = checklistPct_(first);
  var gaps = mine.filter(function (c) { return c.Value === C.CL_NO || c.Value === C.CL_SOME; }).map(function (c) {
    var it = L.checkItem[c.ItemID] || {}; return { text: it.RoutineText, domain: it.Domain, value: c.Value }; });
  return { pct: now.pct, does: now.does, some: now.some, no: now.no, applicable: now.applicable, firstPct: base.pct, firstSessionNo: nos[0], gaps: gaps };
}

function esc_(t) { return str_(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function apiPlanHtml(sessionId) {
  var P = apiGetPlan(sessionId), h = P.header, f = P.focus;
  var o = [];
  o.push('<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">');
  o.push('<title>خطة الأسبوع — ' + esc_(h.ProjectName) + ' — جلسة ' + h.SessionNo + '</title><style>' +
    'body{font-family:"Noto Naskh Arabic","Segoe UI",Tahoma,Arial,sans-serif;color:#1d2a30;margin:0;padding:16px;line-height:1.7;font-size:15px;background:#fff}' +
    '.wrap{max-width:820px;margin:0 auto}h1{font-size:22px;margin:0 0 4px;color:#145a63}h2{font-size:17px;margin:22px 0 8px;padding:6px 10px;background:#e8f2f3;color:#145a63;border-radius:6px}' +
    '.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:4px 16px;font-size:13.5px;border:1px solid #d5e3e5;border-radius:8px;padding:10px 12px}' +
    '.meta b{color:#145a63}.card{border:1px solid #d5e3e5;border-radius:8px;padding:10px 12px;margin:10px 0;page-break-inside:avoid}' +
    '.card h3{margin:0 0 6px;font-size:16px}.tag{display:inline-block;font-size:12px;padding:1px 8px;border-radius:10px;background:#f3ead7;color:#7a5b16;margin-inline-start:6px}' +
    '.eg{background:#f6faf6;border-right:4px solid #3d8b5a;padding:6px 10px;border-radius:4px;margin:6px 0}' +
    'ol{margin:6px 0;padding-inline-start:22px}li{margin:3px 0}.kv{font-size:13.5px;margin:2px 0}.kv b{color:#145a63}' +
    '.muted{color:#5d6b70;font-size:13px}.test{background:#fff3cd;border:1px dashed #b38600;padding:4px 10px;border-radius:6px;font-size:13px;margin:6px 0}' +
    'table{width:100%;border-collapse:collapse;font-size:13.5px}td,th{border:1px solid #d5e3e5;padding:5px 7px;text-align:right;vertical-align:top}th{background:#f2f7f8}' +
    '@media print{body{padding:0}h2{break-after:avoid}.noprint{display:none}}</style></head><body><div class="wrap">');
  o.push('<h1>خطة العمل للأسبوع</h1><div class="muted">برنامج أثر لتسريع الأعمال — Athar Business Accelerator</div>');
  if (h.DataType === C.TEST) o.push('<div class="test">⚠ بيانات تجريبية للاختبار — ليست مشروعًا حقيقيًا</div>');
  o.push('<div class="meta"><div><b>المشروع:</b> ' + esc_(h.ProjectName) + '</div><div><b>صاحب المشروع:</b> ' + esc_(h.OwnerName) + '</div><div><b>المنتور:</b> ' + esc_(h.MentorName) +
    '</div><div><b>الدورة:</b> ' + esc_(h.Round) + '</div><div><b>رقم الجلسة:</b> ' + h.SessionNo + '</div><div><b>الفترة:</b> ' + esc_(h.PlanStart) + ' ← ' + esc_(h.PlanEnd) + '</div></div>');
  o.push('<h2>🎯 تركيزنا الفترة دي</h2><div class="card"><div class="kv"><b>المشكلة:</b> ' + esc_(f.Problem) + ' <span class="tag">' + esc_(f.Area) + '</span></div>');
  if (f.Causes.length) o.push('<div class="kv"><b>السبب:</b> ' + f.Causes.map(function (c) { return esc_(c.text) + ' <span class="muted">(' + esc_(c.cls) + ')</span>'; }).join('؛ ') + '</div>');
  o.push('<div class="kv"><b>الطريقة اللي هنشتغل بيها:</b> ' + esc_(f.Strategy) + (f.Supporting ? ' + ' + esc_(f.Supporting) : '') + '</div><div class="kv"><b>هدفها:</b> ' + esc_(f.StrategyAim) +
    '</div><div class="kv"><b>التحسن المتوقع:</b> ' + esc_(f.Expected) + '</div></div>');
  o.push('<h2>✅ المهام الجديدة (' + P.newTasks.length + ')</h2>');
  if (!P.newTasks.length) o.push('<div class="muted">لا توجد مهام جديدة هذا الأسبوع؛ التركيز على استكمال المهام المستمرة والروتينات.</div>');
  P.newTasks.forEach(function (t, i) {
    o.push('<div class="card"><h3>' + (i + 1) + '. ' + esc_(t.TaskName) + (t.Origin && t.Origin.indexOf('مقسّمة') === 0 ? '<span class="tag">جزء من مهمة سابقة</span>' : '') + '</h3>');
    if (t.Why) o.push('<div class="kv"><b>ليه المهمة دي مهمة؟</b> ' + esc_(t.Why) + '</div>');
    if (t.Summary) o.push('<div class="eg">' + esc_(t.Summary) + '</div>');
    if (t.CustomInstructions) o.push('<div class="kv"><b>ملاحظة المنتور:</b> ' + esc_(t.CustomInstructions) + '</div>');
    if (t.Steps.length) o.push('<div class="kv"><b>تعمل إيه خطوة بخطوة:</b></div><ol>' + t.Steps.map(function (x) { return '<li><b>' + esc_(x.title) + ':</b> ' + esc_(x.text) + '</li>'; }).join('') + '</ol>');
    else if (t.Snapshot) o.push('<div class="kv"><b>الخطوات:</b><br>' + esc_(t.Snapshot).replace(/\n/g, '<br>') + '</div>');
    o.push('<div class="kv"><b>آخر ميعاد:</b> ' + esc_(t.Deadline) + ' &nbsp; <b>المسؤول:</b> ' + esc_(t.Responsible) + (t.Time ? ' &nbsp; <b>الوقت التقريبي:</b> ' + esc_(t.Time) : '') + '</div>');
    o.push('<div class="kv"><b>المطلوب في الآخر:</b> ' + esc_(t.Deliverable) + '</div><div class="kv"><b>الدليل اللي تجيبه الجلسة الجاية:</b> ' + esc_(t.Evidence) + '</div>');
    if (t.Target) o.push('<div class="kv"><b>الرقم المستهدف:</b> ' + esc_(t.Target) + '</div>');
    if (t.Alternative) o.push('<div class="kv"><b>لو الإمكانيات محدودة:</b> ' + esc_(t.Alternative) + '</div>');
    if (t.Cautions) o.push('<div class="muted">⚠ ' + esc_(t.Cautions) + '</div>');
    o.push('</div>');
  });
  o.push('<h2>🔁 مهام سابقة مستمرة (' + P.continuing.length + ')</h2>');
  if (!P.continuing.length) o.push('<div class="muted">لا توجد مهام سابقة مستمرة.</div>');
  else o.push('<table><tr><th>المهمة الأصلية</th><th>من جلسة</th><th>الحالة السابقة</th><th>القرار</th><th>الموعد الجديد</th><th>التعديل المطلوب</th></tr>' +
    P.continuing.map(function (c) { return '<tr><td>' + esc_(c.TaskName) + '</td><td>' + c.AssignedSessionNo + '</td><td>' + esc_(c.PreviousStatus) + '</td><td>' + esc_(c.Decision) +
      '</td><td>' + esc_(c.Deadline) + '</td><td>' + esc_(c.Adjustment) + '</td></tr>'; }).join('') + '</table>');
  var groupNames = { DAILY: 'كل يوم', WEEKLY: 'كل أسبوع', BIWEEKLY: 'كل أسبوعين', MONTHLY: 'كل شهر', PERIODIC: 'عند الحاجة / عند الحدث' };
  var rc = 0; Object.keys(P.routines).forEach(function (k) { rc += P.routines[k].length; });
  o.push('<h2>📅 الروتين المستمر (' + rc + ')</h2>');
  ['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'PERIODIC'].forEach(function (k) {
    if (!P.routines[k].length) return;
    o.push('<div class="kv" style="margin-top:8px"><b>' + groupNames[k] + ':</b></div>');
    P.routines[k].forEach(function (r) {
      o.push('<div class="card"><h3>' + (r.Code ? '<span class="tag">' + esc_(r.Code) + '</span> ' : '') + esc_(r.RoutineName) + (r.IsNew ? '<span class="tag">جديد</span>' : '') + '<span class="tag">' + esc_(r.Frequency) + '</span></h3>');
      if (r.Summary) o.push('<div class="eg">' + esc_(r.Summary) + '</div>');
      if (r.WhenWhere) o.push('<div class="kv"><b>إمتى وفين:</b> ' + esc_(r.WhenWhere) + '</div>');
      if (r.Indicator) o.push('<div class="kv"><b>هنتابعه بـ:</b> ' + esc_(r.Indicator) + '</div>');
      if (r.CustomNote) o.push('<div class="kv"><b>ملاحظة المنتور:</b> ' + esc_(r.CustomNote) + '</div>');
      o.push('<ol>' + r.Steps.map(function (x) { return '<li><b>' + esc_(x.title) + ':</b> ' + esc_(x.text) + '</li>'; }).join('') + '</ol>');
      o.push('<div class="kv"><b>المسؤول:</b> ' + esc_(r.Responsible) + ' &nbsp; <b>الدليل:</b> ' + esc_(r.Evidence) + '</div>');
      if (r.Paper) o.push('<div class="kv"><b>بديل بسيط:</b> ' + esc_(r.Paper) + '</div>');
      o.push('</div>');
    });
  });
  if (P.checklist) {
    var ck = P.checklist;
    o.push('<h2>📋 تشيك ليست الروتينات</h2><div class="card"><div class="kv"><b>الدرجة النهارده:</b> ' + (ck.pct === null ? '—' : ck.pct + '%') +
      ' (بيعملها ' + ck.does + ' · ساعات ' + ck.some + ' · لأ ' + ck.no + ')' + (ck.firstSessionNo !== h.SessionNo && ck.firstPct !== null ? ' &nbsp; <b>في أول جلسة:</b> ' + ck.firstPct + '%' : '') + '</div>' +
      (ck.gaps.length ? '<div class="kv"><b>روتينات لسه محتاجة شغل:</b> ' + ck.gaps.map(function (g) { return esc_(g.text) + ' <span class="muted">(' + esc_(g.value) + ')</span>'; }).join('؛ ') + '</div>' : '') + '</div>');
  }
  if (P.paused.length) o.push('<h2>⏸ مهام موقوفة مؤقتًا</h2><div class="muted">' + P.paused.map(function (c) { return esc_(c.TaskName); }).join('، ') + '</div>');
  o.push('<h2>📌 الجلسة الجاية</h2><div class="card"><div class="kv"><b>الميعاد:</b> ' + esc_(P.nextSession) + '</div><div class="kv">هات معاك الأدلة المطلوبة (صور، الدفتر، لقطات شاشة) وأرقام الأسبوع، وهنراجع كل مهمة مع بعض.</div>' +
    (P.mentorSummary ? '<div class="kv"><b>كلمة المنتور:</b> ' + esc_(P.mentorSummary) + '</div>' : '') + '</div>');
  o.push('<p class="muted">تم إنشاء الخطة من نظام أثر لإدارة المنتورينج — ' + esc_(DB.today()) + '</p></div></body></html>');
  return o.join('');
}

function apiPlanText(sessionId) {
  var P = apiGetPlan(sessionId), h = P.header, f = P.focus, o = [];
  o.push('*خطة الأسبوع — ' + h.ProjectName + '*');
  o.push('جلسة رقم ' + h.SessionNo + ' | من ' + h.PlanStart + ' لـ ' + h.PlanEnd);
  o.push('🎯 التركيز: ' + f.Problem + ' — بطريقة: ' + f.Strategy);
  o.push('');
  o.push('*✅ المهام الجديدة:*');
  P.newTasks.forEach(function (t, i) {
    o.push((i + 1) + ') *' + t.TaskName + '* — آخر ميعاد ' + t.Deadline);
    if (t.Summary) o.push('   ' + t.Summary);
    o.push('   المطلوب: ' + t.Deliverable);
    o.push('   الدليل: ' + t.Evidence);
  });
  if (P.continuing.length) { o.push(''); o.push('*🔁 مهام مستمرة:*'); P.continuing.forEach(function (c) { o.push('• ' + c.TaskName + ' — ' + c.Decision + ' — ' + c.Deadline + (c.Adjustment ? ' (' + c.Adjustment + ')' : '')); }); }
  var names = { DAILY: 'كل يوم', WEEKLY: 'كل أسبوع', BIWEEKLY: 'كل أسبوعين', MONTHLY: 'كل شهر', PERIODIC: 'عند الحاجة' };
  var any = false;
  ['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'PERIODIC'].forEach(function (k) { if (P.routines[k].length) { if (!any) { o.push(''); o.push('*📅 الروتين:*'); any = true; }
    o.push(names[k] + ': ' + P.routines[k].map(function (r) { return (r.Code ? r.Code + ' ' : '') + r.RoutineName + (r.WhenWhere ? ' (' + r.WhenWhere + ')' : ''); }).join('، ')); } });
  if (P.checklist && P.checklist.pct !== null) { o.push(''); o.push('📋 تشيك ليست الروتينات: ' + P.checklist.pct + '%' + (P.checklist.firstSessionNo !== h.SessionNo && P.checklist.firstPct !== null ? ' (أول جلسة ' + P.checklist.firstPct + '%)' : '')); }
  o.push(''); o.push('📌 الجلسة الجاية: ' + P.nextSession + ' — هات الأدلة والأرقام معاك.');
  return o.join('\n');
}

/* ------------------------------------------------------------------ one-page A4 session summary */
/** Everything that matters to the project from one saved session, for a single printed A4 page. */
function apiSessionSheet(sessionId) {
  var P = apiGetPlan(sessionId), L = lib_();
  var s = DB.all('DB_Sessions').filter(function (x) { return x.SessionID === sessionId; })[0];
  var asg = index_(DB.all('DB_TaskAssignments').filter(function (a) { return a.ProjectID === s.ProjectID; }), 'AssignmentID');
  var reviews = DB.all('DB_TaskReviews').filter(function (r) { return r.SessionID === sessionId; }).map(function (r) {
    var a = asg[r.AssignmentID] || {};
    return { TaskName: a.TaskName || r.TaskID, Status: r.Status, Decision: r.Decision, Result: r.ActualResult || r.ImplementationNote, NewDeadline: r.NewDeadline,
      Barriers: r.BarrierCategories, HasEvidence: r.HasEvidence === C.YES };
  });
  var allKv = DB.all('DB_KPIValues').filter(function (v) { return v.ProjectID === s.ProjectID; });
  var kpis = allKv.filter(function (v) { return v.SessionID === sessionId; }).map(function (v) {
    var k = L.kpi[v.KPIID] || {};
    var prev = allKv.filter(function (x) { return x.KPIID === v.KPIID && +x.SessionNo < +s.SessionNo; }).sort(function (a, b) { return a.SessionNo - b.SessionNo; });
    var pv = prev.length ? prev[prev.length - 1].Value : null;
    return { name: k.KPIName || v.KPIID, unit: k.Unit || '', value: v.Value, prev: pv, direction: k.Direction || '' };
  });
  P.reviews = reviews; P.kpis = kpis;
  P.readiness = s.Readiness; P.workloadNote = s.WorkloadNote; P.isFirst = +s.SessionNo === 1;
  return P;
}

/** First sentence / clause of an instruction, cut at a word boundary — used only when the full text does not fit on the page. */
function shortText_(t, max) {
  t = str_(t); max = max || 90;
  var cut = t.split(/[.؛\n]/)[0];
  if (cut.length > max) { cut = cut.slice(0, max); var sp = cut.lastIndexOf(' '); if (sp > max * 0.6) cut = cut.slice(0, sp); return cut + '…'; }
  return cut.length < t.length ? cut + '…' : cut;
}

/**
 * Fit configurations, tried in order until the page fits one A4 sheet. Words are cut before type shrinks; deadlines,
 * deliverables and evidence are never hidden. Classes: l1 short step text · l2 step titles only · l3 steps in two columns ·
 * f1/f2 10.5/10pt · mK at most K steps per task · r lists cut to 4 items · tK at most K new tasks (rest: «in the full plan»).
 */
var SHEET_FITS_ = ['', 'l1', 'l1 l3', 'l2 l3', 'l2 l3 f1', 'l2 l3 f2', 'l2 l3 f2 m4', 'l2 l3 f2 m3', 'l2 l3 f2 m3 r', 'l2 l3 f2 m2 r', 'l2 l3 f2 m2 r t4', 'l2 l3 f2 m2 r t3'];
var SHEET_MAX_LINES_ = 46;   // one A4 page (273 mm ≈ 1031 px); worst case measured 21.9 px per estimated line in Chrome print layout

/** Estimated height in 11pt lines for a fit configuration (the Drive PDF runs no JavaScript, so the server picks the configuration). */
function sheetLines_(P, cfg) {
  var has = function (c) { return (' ' + cfg + ' ').indexOf(' ' + c + ' ') >= 0; };
  var lvl = has('l2') ? 2 : has('l1') ? 1 : 0, two = has('l3'), cut = has('r');
  var maxSteps = has('m2') ? 2 : has('m3') ? 3 : has('m4') ? 4 : 99, maxTasks = has('t3') ? 3 : has('t4') ? 4 : 99;
  var ln = function (t, cpl) { t = str_(t); return t ? Math.max(1, Math.ceil(t.length / cpl)) : 0; };
  var n = 3.6;   // title, meta line, spacing
  var box = function (parts) { return parts.reduce(function (a, t) { return a + ln(t, 32); }, 1.2); };
  var res = [P.businessResult].concat(P.kpis.map(function (k) { return k.name + k.value + k.unit + '  كان  '; })).concat(P.checklist ? ['تشيك ليست الروتينات 00% (أول جلسة 00%)'] : []);
  var foc = [P.focus.Problem, P.focus.Causes.map(function (c) { return c.text; }).join('؛ '), P.focus.Strategy + P.focus.Supporting].concat(lvl < 2 ? [P.focus.Expected] : []);
  var dec = P.reviews.map(function (r) { return r.TaskName + r.Status + r.Decision + '  ←  دليل'; });
  if (cut && dec.length > 4) dec = dec.slice(0, 4).concat(['+']);
  n += Math.max(box(res), box(foc), box(dec.length ? dec : ['-'])) + 1.4;
  P.newTasks.slice(0, maxTasks).forEach(function (t) {
    n += 0.9 + ln(t.TaskName + t.Deadline + t.Responsible + t.Target + '   آخر ميعاد   ', 100) + ln(t.Deliverable + t.Evidence + '  المطلوب  الدليل  ', 104);
    if (t.CustomInstructions && t.Steps.length) n += ln('ملاحظة المنتور: ' + t.CustomInstructions, 104);
    if (!t.Steps.length) n += ln(t.Snapshot || t.CustomInstructions, 104);
    var st = t.Steps.slice(0, maxSteps), sl = st.reduce(function (a, x) { return a + ln(x.title + (lvl === 0 ? ': ' + x.text : lvl === 1 ? ': ' + shortText_(x.text) : ''), two ? 46 : 98); }, 0);
    n += two ? Math.ceil(sl / 2) : sl;
    if (t.Steps.length > maxSteps) n += 1;
    if (t.Alternative && lvl < 2) n += ln('لو الإمكانيات محدودة: ' + t.Alternative, 104);
  });
  if (P.newTasks.length > maxTasks) n += 1;
  var rl = []; Object.keys(P.routines).forEach(function (k) { P.routines[k].forEach(function (r) { rl.push((r.Code || '') + r.RoutineName + ' (كل أسبوعين) ' + (r.WhenWhere || '') + '  □□□□□□□'); }); });
  var cl = P.continuing.map(function (c) { return c.TaskName + c.Deadline + (c.Adjustment || '') + ' — '; });
  if (cut) { rl = rl.slice(0, 4).concat(rl.length > 4 ? ['+'] : []); cl = cl.slice(0, 4).concat(cl.length > 4 ? ['+'] : []); }
  var left = 1.2 + cl.reduce(function (a, t) { return a + ln(t, 46); }, 0) + (cl.length ? 0 : 1) + (P.paused.length ? 1 : 0);
  var right = 1.2 + rl.reduce(function (a, t) { return a + ln(t, 56); }, 0) + (rl.length ? 0 : 1);
  n += Math.max(left, right) + 1.2;
  n += 1.2 + ln(P.mentorSummary ? 'كلمة المنتور: ' + P.mentorSummary : '', 104) + ln(P.workloadNote ? 'اتفقنا على: ' + P.workloadNote : '', 104) +
    (P.checklist && P.checklist.gaps.length && lvl < 2 ? ln(P.checklist.gaps.slice(0, 6).map(function (g) { return g.text; }).join('؛ ') + ' روتينات لسه محتاجة شغل', 104) : 0) +
    ln('الجلسة الجاية 0000-00-00 — هات معاك: ' + uniq_(P.newTasks.map(function (t) { return str_(t.Evidence); })).join('؛ ') + '، وأرقام الفترة ودليل الروتين (الكارت أو الدفتر أو صور). استعداد 0/5', 104);
  return n * (has('f2') ? 10 / 11 : has('f1') ? 10.5 / 11 : 1);
}
function sheetFitConfig_(P) {
  for (var i = 0; i < SHEET_FITS_.length; i++) if (sheetLines_(P, SHEET_FITS_[i]) <= SHEET_MAX_LINES_) return SHEET_FITS_[i];
  return SHEET_FITS_[SHEET_FITS_.length - 1];
}
function sheetFitLevel_(P) { return SHEET_FITS_.indexOf(sheetFitConfig_(P)); }

function dt_(d) { return '<bdi dir="ltr">' + esc_(d) + '</bdi>'; }
function apiSessionSheetHtml(sessionId, forPdf) {
  var P = apiSessionSheet(sessionId), h = P.header, f = P.focus, o = [];
  var cfg = forPdf ? sheetFitConfig_(P) : '';
  var cb = '<span class="cb"></span>';
  var hideAfter = function (prefix, from, to) { var a = []; for (var i = from; i <= to; i++) a.push('.' + prefix + i); return a.join(','); };
  o.push('<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>ملخص الجلسة ' + h.SessionNo + ' — ' + esc_(h.ProjectName) + '</title><style>' +
    '@page{size:A4;margin:12mm}*{box-sizing:border-box}html,body{margin:0;background:#fff}bdi{white-space:nowrap}' +
    'body{font-family:"Noto Sans Arabic","Noto Naskh Arabic","Segoe UI",Tahoma,Arial,sans-serif;color:#2b3a40;font-size:11pt;line-height:1.5}' +
    'body.f1{font-size:10.5pt}body.f2{font-size:10pt}.page{width:186mm;margin:0 auto}' +
    '.hd{margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #d9e3e5}.hd .ttl{font-size:1.35em;font-weight:700;color:#1f5f68}.hd .ttl small{font-size:.7em;font-weight:400;color:#6b7a7f;margin-inline-start:6px}' +
    '.hd .m{color:#56666b;font-size:.92em}.hd .m b{color:#2b3a40;font-weight:600}' +
    '.sec{margin-top:9px}.st{font-size:.95em;font-weight:700;color:#1f5f68;border-bottom:1px solid #e3eaeb;padding-bottom:1px;margin-bottom:3px}' +
    'table.cols{width:100%;border-collapse:collapse;table-layout:fixed}table.cols td{vertical-align:top;padding:0 0 0 18px}table.cols td:last-child{padding-left:0}' +
    '.lbl{color:#56666b}.val{font-weight:600}.mut{color:#7a878b}.pill{font-size:.85em;color:#56666b;border:1px solid #d9e3e5;border-radius:9px;padding:0 6px;white-space:nowrap}' +
    '.good{color:#2f7a4f}.bad{color:#a8463f}.nw{white-space:nowrap}' +
    'ul.pl{list-style:none;margin:0;padding:0}ul.pl li{margin:1px 0;padding-inline-start:1.3em;text-indent:-1.3em}' +
    '.cb{display:inline-block;width:.8em;height:.8em;border:1.3px solid #8a979b;border-radius:2px;margin-inline-end:.45em;vertical-align:-.05em;text-indent:0}' +
    '.days{white-space:nowrap;margin-inline-start:4px}.days .cb{width:.68em;height:.68em;margin-inline-end:2px}' +
    '.task{margin:5px 0 7px;page-break-inside:avoid}.task .tn{font-weight:700}.task .meta{color:#56666b;font-size:.92em;margin-inline-start:4px}' +
    '.task ul.steps{list-style:none;margin:2px 0 1px;padding:0 1.3em 0 0}.task ul.steps li{margin:0;padding-inline-start:1.3em;text-indent:-1.3em;break-inside:avoid}' +
    '.task .dl{padding-inline-start:1.3em;font-size:.95em}.short,.mx,.tx,.rx{display:none}' +
    'body.l1 .full{display:none}body.l1 .short{display:inline}body.l2 .full,body.l2 .short,body.l2 .opt{display:none}body.l3 .task ul.steps{columns:2;column-gap:18px}' +
    'body.m4 ' + hideAfter('k', 5, 15).split(',').join(',body.m4 ') + ',body.m3 ' + hideAfter('k', 4, 15).split(',').join(',body.m3 ') + ',body.m2 ' + hideAfter('k', 3, 15).split(',').join(',body.m2 ') + '{display:none}' +
    'body.m4 .mx4,body.m3 .mx3,body.m2 .mx2,body.r .rx,body.t4 .tx4,body.t3 .tx3{display:block}' +
    'body.r ' + hideAfter('q', 5, 40).split(',').join(',body.r ') + ',body.t4 ' + hideAfter('tk', 5, 20).split(',').join(',body.t4 ') + ',body.t3 ' + hideAfter('tk', 4, 20).split(',').join(',body.t3 ') + '{display:none}' +
    '.reco{margin-top:9px;padding:5px 9px;border-inline-start:3px solid #c9a35a;background:#fbf8f1}' +
    '.over{display:none}body.toolong .over{display:block;border:1px dashed #b38600;padding:4px 8px;margin-bottom:6px;font-size:10pt}@media print{.over{display:none!important}}' +
    '</style></head><body class="' + cfg + '"><div class="page" id="pg">');
  o.push('<div class="over">المحتوى أطول من صفحة حتى بعد الاختصار؛ التفاصيل الكاملة في الخطة الكاملة.</div>');
  o.push('<div class="hd"><div class="ttl">' + esc_(h.ProjectName) + '<small>ملخص الجلسة رقم ' + h.SessionNo + (h.DataType === C.TEST ? ' · بيانات تجريبية' : '') + '</small></div>' +
    '<div class="m"><b>صاحب المشروع:</b> ' + esc_(h.OwnerName) + ' &nbsp;·&nbsp; <b>المنتور:</b> ' + esc_(h.MentorName) + ' &nbsp;·&nbsp; <b>تاريخ الجلسة:</b> ' + dt_(h.SessionDate) +
    ' &nbsp;·&nbsp; <b>الجلسة الجاية:</b> ' + dt_(P.nextSession) + (P.afterTrainingDay ? ' &nbsp;·&nbsp; <b>بعد يوم التدريب:</b> ' + esc_(P.afterTrainingDay) : '') + '</div></div>');
  // results · focus · previous tasks
  var res = [];
  if (P.businessResult) res.push('<div>' + esc_(P.businessResult) + '</div>');
  if (P.kpis.length) res.push('<ul class="pl">' + P.kpis.map(function (k) {
    var ch = k.prev !== null && k.value !== null ? k.value - k.prev : null;
    var good = ch === null || ch === 0 ? '' : (k.direction === 'أعلى أفضل' ? (ch > 0 ? 'good' : 'bad') : k.direction === 'أقل أفضل' ? (ch < 0 ? 'good' : 'bad') : '');
    return '<li><span class="lbl">' + esc_(k.name) + ':</span> <span class="val">' + esc_(k.value) + '</span> ' + esc_(k.unit) + (k.prev !== null ? ' <span class="mut nw ' + good + '">(كان ' + esc_(k.prev) + ')</span>' : '') + '</li>'; }).join('') + '</ul>');
  if (P.checklist && P.checklist.pct !== null) res.push('<div><span class="lbl">تشيك ليست الروتينات:</span> <span class="val">' + P.checklist.pct + '%</span>' +
    (P.checklist.firstSessionNo !== h.SessionNo && P.checklist.firstPct !== null ? ' <span class="mut">(أول جلسة ' + P.checklist.firstPct + '%)</span>' : '') + '</div>');
  if (!res.length) res.push('<div class="mut">' + (P.isFirst ? 'جلسة التشخيص الأولى — خط الأساس.' : 'لم تُسجل أرقام.') + '</div>');
  var foc = '<div><span class="lbl">المشكلة:</span> ' + esc_(f.Problem) + '</div>' +
    (f.Causes.length ? '<div><span class="lbl">السبب:</span> ' + f.Causes.map(function (c) { return esc_(c.text); }).join('؛ ') + '</div>' : '') +
    '<div><span class="lbl">الطريقة:</span> ' + esc_(f.Strategy) + (f.Supporting ? ' + ' + esc_(f.Supporting) : '') + '</div>' +
    (f.Expected ? '<div class="opt"><span class="lbl">المتوقع:</span> ' + esc_(f.Expected) + '</div>' : '');
  var dec = P.reviews.length ? '<ul class="pl">' + P.reviews.map(function (r, i) {
    var cls = r.Status === C.ST_DONE ? 'good' : (r.Status === C.ST_NOT || r.Status === C.ST_BLOCK) ? 'bad' : '';
    return '<li class="q' + (i + 1) + '">' + esc_(r.TaskName) + ' — <span class="' + cls + '">' + esc_(r.Status) + '</span>، ' + esc_(r.Decision) + (r.HasEvidence ? ' <span class="mut">(بدليل)</span>' : '') + '</li>'; }).join('') + '</ul>' +
      (P.reviews.length > 4 ? '<div class="mut rx">+ ' + (P.reviews.length - 4) + ' كمان في الخطة الكاملة</div>' : '')
    : '<div class="mut">' + (P.isFirst ? 'أول جلسة — لا توجد مهام سابقة.' : 'لا توجد مهام سابقة للمراجعة.') + '</div>';
  o.push('<table class="cols"><tr><td><div class="st">اللي حصل</div>' + res.join('') + '</td><td><div class="st">تركيزنا</div>' + foc + '</td><td><div class="st">المهام اللي فاتت</div>' + dec + '</td></tr></table>');
  // new tasks as a checklist
  o.push('<div class="sec"><div class="st">المهام الجديدة (' + P.newTasks.length + ')</div>');
  if (!P.newTasks.length) o.push('<div class="mut">لا توجد مهام جديدة؛ التركيز على المهام المستمرة والروتين.</div>');
  P.newTasks.forEach(function (t, i) {
    o.push('<div class="task tk' + (i + 1) + '"><div>' + cb + '<span class="tn">' + esc_(t.TaskName) + '</span><span class="meta">آخر ميعاد ' + dt_(t.Deadline) +
      (t.Responsible ? ' · ' + esc_(t.Responsible) : '') + (t.Target ? ' · الهدف: ' + esc_(t.Target) : '') + '</span></div>');
    if (t.CustomInstructions && t.Steps.length) o.push('<div class="dl"><span class="lbl">ملاحظة المنتور:</span> ' + esc_(t.CustomInstructions) + '</div>');
    if (t.Steps.length) {
      o.push('<ul class="steps">' + t.Steps.map(function (x, k) { return '<li class="k' + (k + 1) + '">' + cb + (k + 1) + '. <b>' + esc_(x.title) + '</b><span class="full">: ' + esc_(x.text) + '</span><span class="short">: ' + esc_(shortText_(x.text)) + '</span></li>'; }).join('') + '</ul>');
      [4, 3, 2].forEach(function (m) { if (t.Steps.length > m) o.push('<div class="dl mut mx mx' + m + '">+ ' + (t.Steps.length - m) + ' خطوات كمان في الخطة الكاملة</div>'); });
    } else if (t.Snapshot || t.CustomInstructions) o.push('<div class="dl">' + esc_(t.Snapshot || t.CustomInstructions).replace(/\n/g, ' · ') + '</div>');
    o.push('<div class="dl"><span class="lbl">المطلوب:</span> ' + esc_(t.Deliverable) + ' &nbsp;·&nbsp; <span class="lbl">الدليل:</span> ' + esc_(t.Evidence) + '</div>');
    if (t.Alternative) o.push('<div class="dl mut opt">لو الإمكانيات محدودة: ' + esc_(t.Alternative) + '</div>');
    o.push('</div>');
  });
  [4, 3].forEach(function (m) { if (P.newTasks.length > m) o.push('<div class="mut tx tx' + m + '">+ ' + (P.newTasks.length - m) + ' مهام كمان في الخطة الكاملة: ' + P.newTasks.slice(m).map(function (t) { return esc_(t.TaskName); }).join('، ') + '</div>'); });
  o.push('</div>');
  // continuing tasks · routines
  var names = { DAILY: 'يومي', WEEKLY: 'أسبوعي', BIWEEKLY: 'كل أسبوعين', MONTHLY: 'شهري', PERIODIC: 'عند الحاجة' };
  var boxes = function (k) { var n = k === 'DAILY' ? 7 : 1, a = ''; for (var i = 0; i < n; i++) a += '<span class="cb"></span>'; return '<span class="days">' + a + '</span>'; };
  var rlist = [];
  ['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'PERIODIC'].forEach(function (k) { P.routines[k].forEach(function (r) {
    rlist.push('<li class="q' + (rlist.length + 1) + '">' + esc_(r.RoutineName) + (r.Code ? ' <span class="pill">' + esc_(r.Code) + '</span>' : '') + ' <span class="mut">' + names[k] + (r.IsNew ? '، جديد' : '') + (r.WhenWhere ? ' — ' + esc_(r.WhenWhere) : '') + '</span>' + boxes(k) + '</li>'); }); });
  var cont = P.continuing.map(function (c, i) { return '<li class="q' + (i + 1) + '">' + cb + esc_(c.TaskName) + ' <span class="mut">— لحد ' + dt_(c.Deadline) + (c.Adjustment ? '، ' + esc_(c.Adjustment) : '') + '</span></li>'; });
  var more = function (arr) { return arr.length > 4 ? '<div class="mut rx">+ ' + (arr.length - 4) + ' كمان في الخطة الكاملة</div>' : ''; };
  o.push('<table class="cols sec"><tr><td style="width:44%"><div class="st">مهام مستمرة (' + P.continuing.length + ')</div>' + (cont.length ? '<ul class="pl">' + cont.join('') + '</ul>' + more(cont) : '<div class="mut">لا توجد.</div>') +
    (P.paused.length ? '<div class="mut">موقوفة مؤقتًا: ' + P.paused.map(function (c) { return esc_(c.TaskName); }).join('، ') + '</div>' : '') + '</td>' +
    '<td style="width:56%"><div class="st">الروتين المستمر (' + rlist.length + ')</div>' + (rlist.length ? '<ul class="pl">' + rlist.join('') + '</ul>' + more(rlist) : '<div class="mut">لا يوجد.</div>') + '</td></tr></table>');
  // recommendations + next session
  var reco = [];
  if (P.mentorSummary) reco.push('<div><span class="lbl">كلمة المنتور:</span> ' + esc_(P.mentorSummary) + '</div>');
  if (P.workloadNote) reco.push('<div><span class="lbl">اتفقنا على:</span> ' + esc_(P.workloadNote) + '</div>');
  if (P.checklist && P.checklist.gaps.length) reco.push('<div class="opt"><span class="lbl">روتينات لسه محتاجة شغل:</span> ' + P.checklist.gaps.slice(0, 6).map(function (g) { return esc_(g.text); }).join('؛ ') + (P.checklist.gaps.length > 6 ? '…' : '') + '</div>');
  var bring = uniq_(P.newTasks.map(function (t) { return str_(t.Evidence); }));
  reco.push('<div><span class="lbl">الجلسة الجاية ' + dt_(P.nextSession) + ' — هات معاك:</span> ' + (bring.length ? bring.map(esc_).join('؛ ') + '، و' : '') + 'أرقام الفترة ودليل الروتين (الكارت أو الدفتر أو صور).' +
    (h.Readiness ? ' <span class="mut">(استعداد صاحب المشروع: ' + esc_(h.Readiness) + '/5)</span>' : '') + '</div>');
  o.push('<div class="reco">' + reco.join('') + '</div>');
  o.push('</div>');
  if (!forPdf) o.push('<script>(function(){var pg=document.getElementById("pg"),b=document.body,A4=Math.floor(273*96/25.4),F=' + JSON.stringify(SHEET_FITS_) + ';' +
    'for(var i=0;i<F.length;i++){b.className=F[i];if(pg.scrollHeight<=A4)return;}b.className=F[F.length-1]+" toolong";})();</script>');
  o.push('</body></html>');
  return o.join('');
}

/* ------------------------------------------------------------------ dashboard */
function inRange_(d, from, to) { return d && (!from || d >= from) && (!to || d <= to); }
function rate_(a, b) { return b ? Math.round(a / b * 1000) / 10 : null; }

function apiDashboard(F) {
  F = F || {};
  var L = lib_();
  var projects = DB.all('DB_Projects').filter(function (p) {
    return (F.includeTest || p.DataType !== C.TEST) && (!F.projectId || p.ProjectID === F.projectId) && (!F.mentorId || p.MentorID === F.mentorId) && (!F.round || str_(p.Round) === str_(F.round));
  });
  var pset = {}; projects.forEach(function (p) { pset[p.ProjectID] = 1; });
  var okRow = function (r, dateField, areaField) {
    return pset[r.ProjectID] && (!F.mentorId || !r.MentorID || r.MentorID === F.mentorId) && (!F.round || !r.Round || str_(r.Round) === str_(F.round)) &&
      (!F.areaId || !areaField || r[areaField] === F.areaId) && (!F.sessionNo || !('SessionNo' in r) || +r.SessionNo === +F.sessionNo) &&
      (!dateField || inRange_(r[dateField], F.dateFrom, F.dateTo));
  };
  var sessions = DB.all('DB_Sessions').filter(function (s) { return s.Status === C.SES_SAVED && okRow(s, 'SessionDate', 'FocusAreaID'); });
  var asg = DB.all('DB_TaskAssignments').filter(function (a) { return a.TaskType === C.T_IMPROVE && okRow(a, 'AssignedDate', 'AreaID'); });
  var revs = DB.all('DB_TaskReviews').filter(function (r) { return okRow(r, 'ReviewDate', 'AreaID'); });
  var occ = DB.all('DB_RoutineOccurrences').filter(function (o) { return okRow(o, 'DueDate', 'AreaID'); });
  var diag = DB.all('DB_Diagnoses').filter(function (d) { return okRow(d, null, 'AreaID'); });
  var sesIds = {}; sessions.forEach(function (s) { sesIds[s.SessionID] = 1; });
  diag = diag.filter(function (d) { return sesIds[d.SessionID]; });

  var due = revs.filter(function (r) { return r.CountsAsDue === C.YES; });
  var completed = revs.filter(function (r) { return r.Status === C.ST_DONE; });
  var m = {
    activeProjects: projects.filter(function (p) { return p.Status === 'نشط'; }).length,
    projects: projects.length,
    sessions: sessions.length,
    tasksAssigned: asg.length,
    reviews: revs.length,
    completed: completed.length,
    partial: revs.filter(function (r) { return r.Status === C.ST_PART; }).length,
    inProgress: revs.filter(function (r) { return r.Status === C.ST_PROG; }).length,
    notImplemented: revs.filter(function (r) { return r.Status === C.ST_NOT || r.Status === C.ST_BLOCK; }).length,
    carriedForward: revs.filter(function (r) { return r.Decision === C.DEC_CARRY; }).length,
    dueCount: due.length,
    dueCompleted: due.filter(function (r) { return r.IsCompleted === C.YES; }).length,
    routinePlanned: occ.filter(function (o) { return o.IsPlanned === C.YES; }).length,
    routineDone: occ.filter(function (o) { return o.IsDone === C.YES; }).length,
    completedWithEvidence: completed.filter(function (r) { return r.HasEvidence === C.YES; }).length,
    outcomeDue: revs.filter(function (r) { return r.OutcomeDue === C.YES; }).length,
    outcomeRecorded: revs.filter(function (r) { return r.OutcomeRecorded === C.YES; }).length
  };
  m.completionRate = rate_(m.dueCompleted, m.dueCount);
  m.routineAdherence = rate_(m.routineDone, m.routinePlanned);
  m.evidenceCoverage = rate_(m.completedWithEvidence, m.completed);
  m.outcomeCoverage = rate_(m.outcomeRecorded, m.outcomeDue);

  var barriers = {};
  revs.forEach(function (r) { str_(r.BarrierCategories).split('، ').forEach(function (b) { if (b) barriers[b] = (barriers[b] || 0) + 1; }); });
  var countBy = function (arr, key, nameFn) { var o = {}; arr.forEach(function (x) { if (x[key]) o[x[key]] = (o[x[key]] || 0) + 1; });
    return Object.keys(o).map(function (k) { return { id: k, name: nameFn(k), count: o[k] }; }).sort(function (a, b) { return b.count - a.count; }); };
  var topProblems = countBy(sessions, 'FocusProblemID', function (k) { return (L.problem[k] || {}).ProblemName || k; });
  var topStrategies = countBy(sessions, 'PrimaryStrategyID', function (k) { return (L.strategy[k] || {}).StrategyName || k; });
  var topCauses = countBy(diag.filter(function (d) { return d.Classification !== C.DIAG_NA; }), 'CauseID', function (k) { return (L.cause[k] || {}).CauseText || k; });

  var kv = DB.all('DB_KPIValues').filter(function (v) { return okRow(v, 'PeriodEnd', 'AreaID'); });
  var pname = index_(projects, 'ProjectID');
  var byPK = {};
  kv.forEach(function (v) { var k = v.ProjectID + '|' + v.KPIID; (byPK[k] = byPK[k] || []).push(v); });
  var perf = Object.keys(byPK).map(function (k) {
    var vals = byPK[k].sort(function (a, b) { return a.PeriodEnd < b.PeriodEnd ? -1 : a.PeriodEnd > b.PeriodEnd ? 1 : a.SessionNo - b.SessionNo; });
    var f = vals[0], l = vals[vals.length - 1], kp = L.kpi[f.KPIID] || {};
    var ch = vals.length > 1 ? l.Value - f.Value : null;
    var good = ch === null || ch === 0 ? null : (kp.Direction === 'أعلى أفضل' ? ch > 0 : kp.Direction === 'أقل أفضل' ? ch < 0 : null);
    return { ProjectID: f.ProjectID, ProjectName: (pname[f.ProjectID] || {}).ProjectName, KPIID: f.KPIID, KPIName: kp.KPIName, Unit: kp.Unit,
      first: f.Value, firstDate: f.PeriodEnd, last: l.Value, lastDate: l.PeriodEnd, points: vals.length, change: ch,
      changePct: ch !== null && f.Value ? Math.round(ch / Math.abs(f.Value) * 1000) / 10 : null, improved: good,
      series: vals.map(function (v) { return v.Value; }) };
  }).sort(function (a, b) { return (a.ProjectName || '') < (b.ProjectName || '') ? -1 : 1; });

  var mentors = DB.all('DB_Mentors');
  var byMentor = mentors.map(function (mm) {
    var r = due.filter(function (x) { return x.MentorID === mm.MentorID; });
    var o = occ.filter(function (x) { return x.MentorID === mm.MentorID; });
    return { MentorID: mm.MentorID, MentorName: mm.MentorName, projects: projects.filter(function (p) { return p.MentorID === mm.MentorID; }).length,
      sessions: sessions.filter(function (s) { return s.MentorID === mm.MentorID; }).length,
      completionRate: rate_(r.filter(function (x) { return x.IsCompleted === C.YES; }).length, r.length),
      routineAdherence: rate_(o.filter(function (x) { return x.IsDone === C.YES; }).length, o.filter(function (x) { return x.IsPlanned === C.YES; }).length) };
  }).filter(function (x) { return x.projects || x.sessions; });

  // Assiut roadmap: checklist score first vs latest per project, stable roadmap routines
  var rmProjects = projects.filter(isRoadmapProject_);
  var cls = DB.all('DB_ChecklistScores').filter(function (c) { return okRow(c, null, null); });
  var raAll = DB.all('DB_RoutineAssignments').filter(function (r) { return pset[r.ProjectID]; });
  var occAll = DB.all('DB_RoutineOccurrences').filter(function (o) { return pset[o.ProjectID]; });
  var occByRA = group_(occAll, 'RAID');
  var rmRows = rmProjects.map(function (p) {
    var mine = cls.filter(function (c) { return c.ProjectID === p.ProjectID; });
    var nos = uniq_(mine.map(function (c) { return String(c.SessionNo); })).map(Number).sort(function (a, b) { return a - b; });
    var at = function (n) { return checklistPct_(mine.filter(function (c) { return +c.SessionNo === n; })).pct; };
    var ras = raAll.filter(function (r) { return r.ProjectID === p.ProjectID && r.RoadmapCode; });
    var active = ras.filter(function (r) { return r.Status === C.RS_ACTIVE; });
    return { ProjectID: p.ProjectID, ProjectName: p.ProjectName, ProjectMode: p.ProjectMode || '', sessions: nos.length,
      first: nos.length ? at(nos[0]) : null, last: nos.length ? at(nos[nos.length - 1]) : null,
      roadmapRoutines: active.length, stable: active.filter(function (r) { return routineStability_(r, occByRA[r.RAID] || []).stable; }).length };
  });
  rmRows.forEach(function (r) { r.change = r.first !== null && r.last !== null && r.sessions > 1 ? Math.round((r.last - r.first) * 10) / 10 : null; });
  var avg = function (k) { var v = rmRows.filter(function (r) { return r[k] !== null && r.sessions; }).map(function (r) { return r[k]; });
    return v.length ? Math.round(v.reduce(function (a, b) { return a + b; }, 0) / v.length * 10) / 10 : null; };
  var itemGaps = {};
  rmRows.forEach(function (r) {
    var mine = cls.filter(function (c) { return c.ProjectID === r.ProjectID; });
    var lastNo = Math.max.apply(null, [0].concat(mine.map(function (c) { return +c.SessionNo; })));
    mine.filter(function (c) { return +c.SessionNo === lastNo && (c.Value === C.CL_NO || c.Value === C.CL_SOME); }).forEach(function (c) { itemGaps[c.ItemID] = (itemGaps[c.ItemID] || 0) + 1; });
  });
  var roadmap = rmProjects.length ? { projects: rmRows.length, scored: rmRows.filter(function (r) { return r.sessions; }).length,
    avgFirst: avg('first'), avgLast: avg('last'), roadmapRoutines: rmRows.reduce(function (a, r) { return a + r.roadmapRoutines; }, 0),
    stable: rmRows.reduce(function (a, r) { return a + r.stable; }, 0), rows: rmRows,
    gaps: Object.keys(itemGaps).map(function (k) { return { id: k, name: (L.checkItem[k] || {}).RoutineText || k, count: itemGaps[k] }; }).sort(function (a, b) { return b.count - a.count; }) } : null;

  return { filters: F, metrics: m, roadmap: roadmap, barriers: Object.keys(barriers).map(function (k) { return { name: k, count: barriers[k] }; }).sort(function (a, b) { return b.count - a.count; }),
    topProblems: topProblems, topStrategies: topStrategies, topCauses: topCauses.slice(0, 10), performance: perf, byMentor: byMentor,
    rounds: uniq_(DB.all('DB_Projects').map(function (p) { return str_(p.Round); })) };
}

/* ------------------------------------------------------------------ integrity */
function apiIntegrityCheck() {
  var issues = [];
  var dupCheck = function (t, k) { var s = {}; DB.all(t).forEach(function (r) { if (s[r[k]]) issues.push(t + ': معرف مكرر ' + r[k]); s[r[k]] = 1; }); };
  DB_TABLES.forEach(function (t) { dupCheck(t, SCHEMA[t][0]); });
  var asg = DB.all('DB_TaskAssignments'), asgI = index_(asg, 'AssignmentID');
  var revs = DB.all('DB_TaskReviews');
  revs.forEach(function (r) { if (!asgI[r.AssignmentID]) issues.push('مراجعة بدون تكليف: ' + r.ReviewID); });
  var lastRev = {};
  revs.forEach(function (r) { if (!lastRev[r.AssignmentID] || +r.SessionNo > +lastRev[r.AssignmentID].SessionNo) lastRev[r.AssignmentID] = r; });
  asg.forEach(function (a) {
    var l = lastRev[a.AssignmentID];
    var shouldOpen = !l || C.CLOSING_DECISIONS.indexOf(l.Decision) < 0;
    if ((a.IsOpen === C.YES) !== shouldOpen) issues.push('حالة الفتح لا تطابق آخر قرار: ' + a.AssignmentID);
  });
  var open = {};
  asg.filter(function (a) { return a.IsOpen === C.YES && a.TaskID !== 'CUSTOM'; }).forEach(function (a) {
    var k = a.ProjectID + '|' + a.TaskID; if (open[k]) issues.push('مهمة مفتوحة مكررة لنفس المشروع: ' + a.TaskID + ' (' + a.ProjectID + ')'); open[k] = 1; });
  var act = {};
  DB.all('DB_RoutineAssignments').filter(function (r) { return r.Status !== C.RS_ENDED; }).forEach(function (r) {
    var k = r.ProjectID + '|' + r.RoutineID; if (act[k]) issues.push('روتين مكرر غير منتهٍ: ' + r.RoutineID + ' (' + r.ProjectID + ')'); act[k] = 1; });
  var sn = {};
  DB.all('DB_Sessions').forEach(function (s) { var k = s.ProjectID + '|' + s.SessionNo; if (sn[k]) issues.push('رقم جلسة مكرر: ' + k); sn[k] = 1; });
  var occK = {};
  DB.all('DB_RoutineOccurrences').forEach(function (o) { var k = o.RAID + '|' + o.DueDate + '|' + o.PeriodLabel; if (occK[k]) issues.push('تكرار روتين مسجل مرتين: ' + k); occK[k] = 1; });
  var projs = index_(DB.all('DB_Projects'), 'ProjectID');
  ['DB_Sessions', 'DB_TaskAssignments', 'DB_TaskReviews', 'DB_RoutineAssignments', 'DB_RoutineOccurrences', 'DB_KPIValues'].forEach(function (t) {
    DB.all(t).forEach(function (r) { var p = projs[r.ProjectID]; if (!p) issues.push(t + ': مشروع غير موجود ' + r.ProjectID);
      else if (p.DataType !== r.DataType) issues.push(t + ': نوع البيانات لا يطابق المشروع ' + r[SCHEMA[t][0]]); });
  });
  return { ok: issues.length === 0, issues: issues, checkedAt: DB.now() };
}

/* ------------------------------------------------------------------ API dispatcher */
var API_ = { bootstrap: apiBootstrap, listProjects: apiListProjects, createProject: apiCreateProject, createMentor: apiCreateMentor,
  journey: apiGetJourney, startSession: apiStartSession, saveDraft: apiSaveDraft, getDraft: apiGetDraft, discardDraft: apiDiscardDraft,
  suggest: apiSuggest, finalize: apiFinalizeSession, plan: apiGetPlan, planHtml: apiPlanHtml, planText: apiPlanText,
  sessionSheet: apiSessionSheet, sessionSheetHtml: apiSessionSheetHtml,
  dashboard: apiDashboard, integrity: apiIntegrityCheck };

function dispatch_(fn, args) {
  if (!API_[fn]) throw AppError('عملية غير معروفة: ' + fn);
  return API_[fn].apply(null, args || []);
}
