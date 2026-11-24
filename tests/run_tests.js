/* End-to-end acceptance tests: loads the real .gs files into a sandbox with an in-memory DB,
   runs the three scenarios through the public API and checks the acceptance criteria. */
const fs = require('fs'), vm = require('vm'), path = require('path');
const SRC = path.join(__dirname, '..', 'src');
function makeContext(dbFactory) {
  const ctx = { console, JSON, Math, Date, Object, Array, String, Number, RegExp, Error, isNaN };
  vm.createContext(ctx);
  for (const f of ['Schema.gs', 'Core.gs', 'TestData.gs', 'MemoryDb.js']) vm.runInContext(fs.readFileSync(path.join(f==='MemoryDb.js'?__dirname:SRC, f), 'utf8'), ctx, { filename: f });
  ctx.DB = dbFactory(ctx);
  return ctx;
}
const lib = JSON.parse(fs.readFileSync(path.join(__dirname, 'library.json'), 'utf8'));
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('  ✗ FAIL:', msg); } }
function throws(fn, re, msg) { try { fn(); fail++; console.log('  ✗ FAIL (no error):', msg); } catch (e) { if (re.test(e.message)) pass++; else { fail++; console.log('  ✗ FAIL (wrong error):', msg, '\n    ', e.message); } } }

function freshTables() { const t = JSON.parse(JSON.stringify(lib)); return t; }

const X = makeContext(c => c.MemoryDb(freshTables(), { clock: () => new Date('2026-11-16T10:00:00Z') }));
const run = (code) => vm.runInContext(code, X);
console.log('== Load scenarios through the real API');
const out = run('loadTestData_()');
out.forEach(l => console.log('  ', l));
const T = X.DB.tables;
const C = run('C');

console.log('== A. Continuity');
const projects = T.DB_Projects;
ok(projects.length === 3 && projects.every(p => p.DataType === 'تجريبي' && p.ProjectID.startsWith('TEST-')), 'three test projects, clearly marked');
const pA = projects[0].ProjectID;
const jA = run(`apiGetJourney('${pA}')`);
ok(jA.sessions.length === 3, 'scenario A has 3 saved sessions');
ok(jA.assignments.length === 5, 'scenario A: every task ever assigned stays in history (5) — got ' + jA.assignments.length);
const a08 = jA.assignments.find(a => a.TaskID === 'MK-A08');
ok(a08 && a08.IsOpen === 'لا' && a08.CurrentDecision === 'تم الإنجاز' && a08.reviews.length === 1, 'completed task remains visible with its review');
const a07 = jA.assignments.find(a => a.TaskID === 'MK-A07');
ok(a07.reviews.length === 2 && a07.reviews[0].Decision === 'ترحيل بموعد جديد' && a07.reviews[1].Status === 'مكتملة', 'carried-forward task keeps both reviews (history not overwritten)');
ok(a07.OriginalDeadline === '2026-10-11' && a07.StepsSnapshot.length > 50, 'original deadline and instruction snapshot preserved');
ok(a07.everCarried === true && jA.stats.carried >= 1, 'carried-forward tasks counted');
const a19 = jA.assignments.find(a => a.TaskID === 'MK-A19');
ok(a19.IsOpen === 'نعم' && a19.CurrentStatus === 'قيد التنفيذ', 'in-progress task stays open after "استمرار"');

console.log('== B. Next session retrieves previous tasks + routines; no auto carry-forward');
const ctx4 = run(`apiStartSession('${pA}', '', '2026-10-26')`);
const openIds = ctx4.openAssignments.map(a => a.TaskID).sort();
ok(JSON.stringify(openIds) === JSON.stringify(['MK-A19', 'MK-A25']), 'session 4 review list = exactly the open tasks (MK-A19 carried, MK-A25 new) — got ' + openIds);
ok(ctx4.routines.length === 3 && ctx4.routines.every(r => r.slots.length > 0), 'all 3 active routines retrieved with due occurrence slots');
const daily = ctx4.routines.find(r => r.RoutineID === 'R-MK01');
ok(daily.slots.length === 7 && daily.slots.filter(s => s.defaultStatus === 'غير مستحق/إجازة').length === 1, 'daily routine: 7 slots for the week, Friday pre-marked as off');
const twice = ctx4.routines.find(r => r.RoutineID === 'R-MK03');
ok(twice.slots.length === 2, 'twice-weekly routine: 2 slots');
const again = run(`apiStartSession('${pA}', '', '2026-10-27')`);
ok(again.session.SessionID === ctx4.session.SessionID, 'opening a project with an open draft resumes it (no duplicate session)');
throws(() => run(`apiFinalizeSession('${ctx4.session.SessionID}', {planEnd:'2026-11-02', readiness:4, businessResultNote:'x', diagnosis:{ProblemID:'P-MK03',causes:[{CauseID:'C-MK03-4',Classification:'مؤكد بدليل'}]}, strategy:{PrimaryStrategyID:'S-MK05'}, reviews:[], routineReviews:[]})`),
  /لم تتم مراجعة المهمة/, 'cannot save without reviewing every previous task (incomplete tasks never auto-copied)');
throws(() => run(`apiFinalizeSession('${ctx4.session.SessionID}', {planEnd:'2026-11-02', readiness:4, businessResultNote:'x', diagnosis:{ProblemID:'P-MK03',causes:[{CauseID:'C-MK03-4',Classification:'مؤكد بدليل'}]}, strategy:{PrimaryStrategyID:'S-MK05'},
   reviews:[{AssignmentID:'${ctx4.openAssignments[0].AssignmentID}', Status:'متعثرة', Decision:'تم الإنجاز'}], routineReviews:[]})`),
  /لا يمكن اعتماد الإنجاز|اختر سبب عدم الإنجاز/, 'inconsistent status/decision rejected');

console.log('== C. Diagnosis → strategy → tasks, and duplicate prevention');
const sug = run(`apiSuggest('P-MK03', 'C-MK03-1,C-MK03-3')`);
ok(sug.strategies[0].StrategyID === 'S-MK06' && sug.strategies[0].matched === 2, 'selecting causes ranks the matching strategy first');
const L = run('lib_()');
ok(L.LIB_Strategies.every(s => s.TaskIDs.split(',').every(t => L.action[t])), 'every strategy maps to existing tasks');
ok(L.LIB_Causes.every(c => c.StrategyIDs), 'every cause maps to at least one strategy');
const base = (extra) => `Object.assign({planEnd:'2026-11-02', readiness:4, businessResultNote:'x', diagnosis:{ProblemID:'P-MK03',causes:[{CauseID:'C-MK03-4',Classification:'مؤكد بدليل'}]}, strategy:{PrimaryStrategyID:'S-MK05'},
   reviews:${JSON.stringify(ctx4.openAssignments.map(a => ({ AssignmentID: a.AssignmentID, Status: 'قيد التنفيذ', ImplementationNote: 'جاري', Decision: 'استمرار كما هو' })))},
   routineReviews:${JSON.stringify(ctx4.routines.map(r => ({ RAID: r.RAID, Decision: 'استمرار', occurrences: r.slots.map(s => ({ DueDate: s.DueDate, PeriodLabel: s.PeriodLabel, Status: s.defaultStatus || 'تم' })) })))}}, ${extra})`;
throws(() => run(`apiFinalizeSession('${ctx4.session.SessionID}', ${base("{newTasks:[{TaskID:'MK-A19',Deadline:'2026-11-01'}]}")})`), /مسندة بالفعل ومفتوحة/, 'assigning an already-open task is blocked');
throws(() => run(`apiFinalizeSession('${ctx4.session.SessionID}', ${base("{newTasks:[{TaskID:'FN-A04',Deadline:'2026-11-01'}]}")})`), /ليست ضمن الاستراتيجية/, 'off-strategy task requires a justification');
throws(() => run(`apiFinalizeSession('${ctx4.session.SessionID}', ${base("{newRoutines:[{RoutineID:'R-MK01'}]}")})`), /مسند بالفعل/, 'duplicate routine assignment blocked');
throws(() => run(`apiFinalizeSession('${ctx4.session.SessionID}', ${base("{readiness:2,newTasks:[{TaskID:'MK-A11',Deadline:'2026-11-01'},{TaskID:'MK-A15',Deadline:'2026-11-01',OffStrategyReason:'x'}]}")})`), /الاستعداد منخفض/, 'low readiness with several tasks requires a workload note');
const res4 = run(`apiFinalizeSession('${ctx4.session.SessionID}', ${base("{newTasks:[{TaskID:'MK-A11',Deadline:'2026-11-01',OffStrategyReason:'العميلات يشترين عباية وطرحة معًا'}]}")})`);
ok(res4.ok && res4.newTasks === 1 && res4.reviews === 2, 'valid session 4 saves');
throws(() => run(`apiFinalizeSession('${ctx4.session.SessionID}', ${base('{}')})`), /محفوظة بالفعل/, 'a saved session can never be overwritten');
throws(() => run(`apiSaveDraft('${ctx4.session.SessionID}', {})`), /محفوظة بالفعل/, 'drafts cannot touch saved sessions');
ok(T.DB_RoutineAssignments.filter(r => r.ProjectID === pA).length === 3, 'routines are one ongoing assignment each — not duplicated per week');
ok(T.DB_RoutineOccurrences.filter(o => o.ProjectID === pA && o.RoutineID === 'R-MK01').length === 7 * 3, 'daily routine has one execution record per day across 3 review periods (21)');

console.log('== D. Split / pause / cancel decisions');
const pC = projects[2].ProjectID;
const ctxC = run(`apiStartSession('${pC}', '', '2026-10-21')`);
const opC = ctxC.openAssignments;
ok(opC.map(a => a.TaskID).sort().join() === 'OP-A02,OP-A06', 'scenario C session 3 retrieves OP-A02 (continuing) + OP-A06');
const revC = opC.map(a => a.TaskID === 'OP-A02'
  ? { AssignmentID: a.AssignmentID, Status: 'متعثرة', ImplementationNote: 'لم تحدث الخطة', Barriers: ['المهمة صعبة'], Decision: 'تقسيم لمهام أصغر', SubTasks: [{ name: 'كتابة طلبات الأسبوع فقط في ورقة', deadline: '2026-10-24' }, { name: 'تحديث الورقة يوم الثلاثاء', deadline: '2026-10-27' }] }
  : { AssignmentID: a.AssignmentID, Status: 'لم تبدأ', Barriers: ['ظروف خارجية'], Decision: 'إيقاف مؤقت' });
const routC = ctxC.routines.map(r => ({ RAID: r.RAID, Decision: r.RoutineID === 'R-OP10' ? 'إنهاء' : 'استمرار', occurrences: r.slots.map(s => ({ DueDate: s.DueDate, PeriodLabel: s.PeriodLabel, Status: s.defaultStatus || 'لم يتم' })) }));
run(`apiFinalizeSession('${ctxC.session.SessionID}', ${JSON.stringify({ planEnd: '2026-10-28', readiness: 3, businessResultNote: 'لا تغيير', diagnosis: { ProblemID: 'P-OP02', causes: [{ CauseID: 'C-OP02-3', Classification: 'مؤكد بدليل' }] }, strategy: { PrimaryStrategyID: 'S-OP03' }, reviews: revC, routineReviews: routC })})`);
const asgC = T.DB_TaskAssignments.filter(a => a.ProjectID === pC);
const parent = asgC.find(a => a.TaskID === 'OP-A02');
ok(parent.IsOpen === 'لا' && asgC.filter(a => a.ParentAssignmentID === parent.AssignmentID).length === 2, 'split closes the parent and creates 2 linked sub-tasks');
ok(asgC.find(a => a.TaskID === 'OP-A06').IsOpen === 'نعم', 'paused task stays visible for the next review');
ok(T.DB_RoutineAssignments.find(r => r.ProjectID === pC && r.RoutineID === 'R-OP10').Status === 'منتهي', 'ended routine marked ended (history kept)');
const planC = run(`apiGetPlan('${ctxC.session.SessionID}')`);
ok(planC.newTasks.length === 2 && planC.paused.length === 1 && planC.routines.DAILY.length === 1 && planC.routines.WEEKLY.length === 1, 'plan lists sub-tasks as new, paused separately, ended routine excluded');

console.log('== E. Weekly plan content');
const sA2 = T.DB_Sessions.find(s => s.ProjectID === pA && s.SessionNo === 2);
const planA2 = run(`apiGetPlan('${sA2.SessionID}')`);
ok(planA2.newTasks.length === 1 && planA2.newTasks[0].Steps.length >= 4, 'new task has full step-by-step instructions');
ok(planA2.continuing.length === 2 && planA2.continuing.every(c => c.Deadline === '2026-10-18' && c.Decision), 'previous tasks requiring continuation show decision + updated deadline');
ok(planA2.routines.DAILY.length === 2 && planA2.routines.WEEKLY.length === 1, 'continuing routines grouped by frequency');
const html = run(`apiPlanHtml('${sA2.SessionID}')`);
ok(html.includes('dir="rtl"') && html.includes('بيانات تجريبية') && html.includes('تعمل إيه خطوة بخطوة'), 'printable Arabic RTL plan, test data flagged');
fs.writeFileSync(path.join(__dirname, 'plan_sample.html'), html);
const txt = run(`apiPlanText('${sA2.SessionID}')`);
ok(txt.includes('خطة الأسبوع') && txt.length < 4000, 'WhatsApp text version generated');

console.log('== F. Dashboard definitions (verified by hand-count from raw tables)');
const d = run(`apiDashboard({includeTest:true})`);
const R = T.DB_TaskReviews, O = T.DB_RoutineOccurrences;
const dueR = R.filter(r => r.CountsAsDue === 'نعم');
ok(d.metrics.completionRate === Math.round(dueR.filter(r => r.Status === 'مكتملة').length / dueR.length * 1000) / 10, 'task completion rate = completed due ÷ applicable due');
ok(d.metrics.routineAdherence === Math.round(O.filter(o => o.Status === 'تم').length / O.filter(o => o.Status !== 'غير مستحق/إجازة').length * 1000) / 10, 'routine adherence = done ÷ planned (off-days excluded)');
const comp = R.filter(r => r.Status === 'مكتملة');
ok(d.metrics.evidenceCoverage === Math.round(comp.filter(r => r.HasEvidence === 'نعم').length / comp.length * 1000) / 10, 'evidence coverage = completed with evidence ÷ completed');
const od = R.filter(r => r.Status === 'مكتملة' || r.Status === 'مكتملة جزئيًا');
ok(d.metrics.outcomeCoverage === Math.round(od.filter(r => r.OutcomeRecorded === 'نعم').length / od.length * 1000) / 10, 'outcome coverage = outcomes recorded ÷ outcomes due');
ok(run('apiDashboard({}).metrics.projects') === 0, 'test data excluded from the dashboard by default');
const dA = run(`apiDashboard({includeTest:true, projectId:'${pA}'})`);
ok(dA.performance.find(p => p.KPIID === 'K04').first === 4 && dA.performance.find(p => p.KPIID === 'K04').last === 10, 'KPI trend: first vs latest value per project');
const dMK = run(`apiDashboard({includeTest:true, areaId:'FN'})`);
ok(dMK.metrics.reviews === R.filter(r => r.AreaID === 'FN').length, 'area filter applied to reviews');
const dDate = run(`apiDashboard({includeTest:true, dateFrom:'2026-10-13', dateTo:'2026-10-13'})`);
ok(dDate.metrics.sessions === 1, 'date-range filter on sessions');
fs.writeFileSync(path.join(__dirname, 'dashboard_expected.json'), JSON.stringify(run('apiDashboard({includeTest:true})').metrics, null, 1));

console.log('== G. Integrity');
const integ = run('apiIntegrityCheck()');
ok(integ.ok, 'integrity check clean: ' + integ.issues.join(' | '));
const ids = new Set(); let dup = false; T.DB_TaskReviews.forEach(r => { if (ids.has(r.ReviewID)) dup = true; ids.add(r.ReviewID); });
ok(!dup, 'review IDs unique');

fs.writeFileSync(path.join(__dirname, 'db_after_tests.json'), JSON.stringify(Object.fromEntries(Object.entries(T).filter(([k]) => k.startsWith('DB_'))), null, 0));
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
