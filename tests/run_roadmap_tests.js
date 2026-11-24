/* Assiut roadmap integration tests: routine checklist every session, 145-task roadmap library as routines,
   every-two-weeks scheduling, «ثابت» after evidence in two sessions in a row, warnings (not blocks), dashboard. */
const fs = require('fs'), vm = require('vm'), path = require('path');
const SRC = path.join(__dirname, '..', 'src');
const lib = JSON.parse(fs.readFileSync(path.join(__dirname, 'library.json'), 'utf8'));
const X = { console, JSON, Math, Date, Object, Array, String, Number, RegExp, Error, isNaN };
vm.createContext(X);
for (const f of ['Schema.gs', 'Core.gs', 'TestData.gs']) vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), X, { filename: f });
vm.runInContext(fs.readFileSync(path.join(__dirname, 'MemoryDb.js'), 'utf8'), X, { filename: 'MemoryDb.js' });
X.DB = X.MemoryDb(JSON.parse(JSON.stringify(lib)), { clock: () => new Date('2026-11-16T10:00:00Z') });
const run = code => vm.runInContext(code, X);
const J = v => JSON.stringify(v);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const throws = (fn, re, m) => { try { fn(); fail++; console.log('  ✗ FAIL (no error):', m); } catch (e) { if (re.test(e.message)) pass++; else { fail++; console.log('  ✗ FAIL (wrong error):', m, '\n    ', e.message); } } };

console.log('== Library');
const L = run('lib_()');
ok(Object.keys(L.roadmap).length === 145, '145 roadmap tasks loaded');
ok(L.checklist.length === 28 && L.checklist[0].ItemID === 'RC-01' && L.checklist[27].ItemID === 'RC-28', '28 checklist items in order');
ok(L.routine['RM-D01'] && L.routine['RM-D01'].IsRoadmap && L.routine['RM-D01'].Code === 'ي-٠١', 'roadmap tasks are available as routines with their Arabic code');
ok(L.routine['RM-B01'].FrequencyCode === 'BIWEEKLY' && L.routine['RM-M05'].FrequencyCode === 'MONTHLY', 'frequencies mapped (أب = every two weeks)');
ok(L.checklist.every(it => it.RoadmapIDs === '' || it.RoadmapIDs.split(', ').every(id => L.roadmap[id])), 'every checklist link points to an existing roadmap task');

console.log('== Scope: Assiut only');
const mentor = run(`apiCreateMentor({MentorName:'م'})`);
const pA = run(`apiCreateProject({ProjectName:'ورشة',OwnerName:'أ',BusinessType:'تجارة',MentorID:'${mentor.MentorID}',Governorate:'اسيوط',Round:'R',StartDate:'2026-10-01'})`);
const pB = run(`apiCreateProject({ProjectName:'محل',OwnerName:'ب',BusinessType:'تجارة',MentorID:'${mentor.MentorID}',Governorate:'سوهاج',Round:'R',StartDate:'2026-10-01'})`);
ok(run(`isRoadmapProject_(${J(pA)})`) === true, '«اسيوط» without hamza still counts as Assiut');
ok(run(`isRoadmapProject_(${J(pB)})`) === false, 'Sohag project is not a roadmap project');
const cB = run(`apiStartSession('${pB.ProjectID}','','2026-10-05')`);
ok(cB.isRoadmap === false && cB.checklistItems.length === 0, 'non-Assiut session has no checklist');
const base = (extra) => Object.assign({ planEnd: '', readiness: 4, diagnosis: { ProblemID: 'P-FN01', causes: [{ CauseID: 'C-FN01-1', Classification: 'مؤكد بدليل' }] },
  strategy: { PrimaryStrategyID: 'S-FN01' }, reviews: [], routineReviews: [] }, extra);
throws(() => run(`apiFinalizeSession('${cB.session.SessionID}', ${J(base({ planEnd: '2026-10-12', newRoutines: [{ RoutineID: 'RM-D01', WhenWhere: 'بالليل' }] }))})`),
  /متاحة لمشروعات/, 'roadmap library refused for a non-Assiut project');

console.log('== Session 1 (diagnosis): checklist required, type required, when/where required');
const c1 = run(`apiStartSession('${pA.ProjectID}','','2026-10-05')`);
ok(c1.isRoadmap && c1.checklistItems.length === 28, 'Assiut session carries the 28-item checklist');
const allNo = c1.checklistItems.map(it => ({ ItemID: it.ItemID, Value: 'لأ' }));
throws(() => run(`apiFinalizeSession('${c1.session.SessionID}', ${J(base({ planEnd: '2026-10-12' }))})`), /نوع المشروع[\s\S]*تشيك ليست/, 'type + checklist both required');
throws(() => run(`apiFinalizeSession('${c1.session.SessionID}', ${J(base({ planEnd: '2026-10-12', projectMode: 'بيشتري ويبيع', checklist: allNo,
  newRoutines: [{ RoutineID: 'RM-D01' }] }))})`), /إمتى وفين/, '«إمتى وفين» required for a new roadmap routine');
// trader: RC-13 (اللي بينتج) is not applicable → مش بيخصه; 3 new roadmap routines = over the soft limit of 2 but only a warning
const cl1 = c1.checklistItems.map((it, i) => ({ ItemID: it.ItemID, Value: it.ItemID === 'RC-13' ? 'مش بيخصه' : (i < 2 ? 'ساعات' : i === 8 ? 'بيعملها' : 'لأ') }));
const r1 = run(`apiFinalizeSession('${c1.session.SessionID}', ${J(base({ planEnd: '2026-10-12', projectMode: 'بيشتري ويبيع', checklist: cl1, afterTrainingDay: '١ الفلوس',
  newRoutines: [{ RoutineID: 'RM-D01', WhenWhere: 'كل يوم قبل النوم، على الترابيزة' }, { RoutineID: 'RM-B01', WhenWhere: 'كل تاني خميس' }, { RoutineID: 'RM-W06', WhenWhere: 'الجمعة الصبح' }] }))})`);
ok(r1.ok && r1.newRoutines === 3, 'session saved with 3 roadmap routines (more than 2 is a warning, not a block)');
// score: 27 scored items (RC-13 excluded): 2×ساعات + 1×بيعملها = 4 points of 54 → 7.4%
ok(r1.checklistPct === 7.4, 'checklist % = points ÷ (2 × applicable items), «مش بيخصه» excluded — got ' + r1.checklistPct);
const T = X.DB.tables;
ok(T.DB_ChecklistScores.length === 28 && T.DB_ChecklistScores.every(r => r.SessionNo === 1), '28 append-only score rows for session 1');
const s1row = T.DB_Sessions.find(s => s.SessionID === c1.session.SessionID);
ok(s1row.ChecklistScorePct === 7.4 && s1row.ChecklistApplicable === 27 && s1row.AfterTrainingDay === '١ الفلوس', 'session row keeps score, applicable count, training day');
ok(T.DB_Projects.find(p => p.ProjectID === pA.ProjectID).ProjectMode === 'بيشتري ويبيع', 'project type saved on the project');
const raD = T.DB_RoutineAssignments.find(r => r.RoutineID === 'RM-D01');
ok(raD.RoadmapCode === 'ي-٠١' && raD.WhenWhere === 'كل يوم قبل النوم، على الترابيزة' && raD.RoutineType === 'مهمة خريطة الطريق', 'roadmap routine stored with code and «إمتى وفين»');

console.log('== Session 2: every-two-weeks not due yet; evidence seen required');
const c2 = run(`apiStartSession('${pA.ProjectID}','','2026-10-12')`);
ok(c2.previousChecklist['RC-01'].Value === 'ساعات', 'previous checklist values offered to the mentor');
const bi = c2.routines.find(r => r.RoutineID === 'RM-B01'), dl = c2.routines.find(r => r.RoutineID === 'RM-D01'), wk = c2.routines.find(r => r.RoutineID === 'RM-W06');
ok(bi.slots.length === 0, 'every-two-weeks routine has no due slot after one week');
ok(dl.slots.length === 7 && wk.slots.length === 1, 'daily = 7 slots, weekly = 1 slot');
const rr = (r, seen) => ({ RAID: r.RAID, Decision: 'استمرار', EvidenceSeen: seen, occurrences: r.slots.map(s => ({ DueDate: s.DueDate, PeriodLabel: s.PeriodLabel, Status: s.defaultStatus || 'تم' })) });
const cl2 = cl1.map(c => c.ItemID === 'RC-01' ? { ItemID: 'RC-01', Value: 'بيعملها' } : c);
throws(() => run(`apiFinalizeSession('${c2.session.SessionID}', ${J(base({ planEnd: '2026-10-19', businessResultNote: 'x', checklist: cl2,
  routineReviews: [rr(dl, ''), rr(wk, 'نعم'), rr(bi, '')] }))})`), /الدليل اتشاف/, '«الدليل اتشاف؟» required for a due roadmap routine');
const r2 = run(`apiFinalizeSession('${c2.session.SessionID}', ${J(base({ planEnd: '2026-10-19', businessResultNote: 'سجّل 6 أيام من 7', checklist: cl2,
  routineReviews: [rr(dl, 'نعم'), rr(wk, 'لا'), rr(bi, '')] }))})`);
ok(r2.ok && r2.checklistPct === 9.3, 'session 2 saved; score rises with one more «بيعملها» — got ' + r2.checklistPct);
let j = run(`apiGetJourney('${pA.ProjectID}')`);
ok(j.routines.find(r => r.RoutineID === 'RM-D01').stable === false, 'one session with evidence is not yet «ثابت»');

console.log('== Session 3: evidence two sessions in a row → stable; biweekly now due');
const c3 = run(`apiStartSession('${pA.ProjectID}','','2026-10-19')`);
const bi3 = c3.routines.find(r => r.RoutineID === 'RM-B01');
ok(bi3.slots.length === 1 && /أسبوعين/.test(bi3.slots[0].PeriodLabel), 'every-two-weeks routine due once after two weeks');
const r3 = run(`apiFinalizeSession('${c3.session.SessionID}', ${J(base({ planEnd: '2026-10-26', businessResultNote: 'x', checklist: cl2,
  routineReviews: c3.routines.map(r => rr(r, r.RoutineID === 'RM-W06' ? 'لا' : 'نعم')) }))})`);
ok(r3.ok, 'session 3 saved');
j = run(`apiGetJourney('${pA.ProjectID}')`);
ok(j.routines.find(r => r.RoutineID === 'RM-D01').stable === true, 'daily routine «ثابت» after evidence in sessions 2 and 3');
ok(j.routines.find(r => r.RoutineID === 'RM-W06').stable === false, 'weekly routine without evidence is not stable');
ok(j.routines.find(r => r.RoutineID === 'RM-B01').stable === false, 'biweekly routine reviewed once is not stable yet');
ok(j.checklist.history.length === 3 && j.checklist.history[0].pct === 7.4 && j.checklist.history[2].pct === 9.3, 'checklist history per session');
ok(j.stats.stableRoutines === 1, 'journey counts stable routines');

console.log('== Plan + dashboard');
const plan = run(`apiGetPlan('${c3.session.SessionID}')`);
ok(plan.checklist && plan.checklist.pct === 9.3 && plan.checklist.firstPct === 7.4 && plan.checklist.gaps.length === 25, 'plan shows checklist score now vs first session and the remaining gaps');
ok(plan.routines.BIWEEKLY.length === 1 && plan.routines.DAILY[0].Code === 'ي-٠١' && plan.routines.DAILY[0].WhenWhere, 'plan groups every-two-weeks routines and shows code + «إمتى وفين»');
const html = run(`apiPlanHtml('${c3.session.SessionID}')`);
ok(html.includes('تشيك ليست الروتينات') && html.includes('كل أسبوعين') && html.includes('ي-٠١'), 'plan HTML includes checklist, biweekly group and codes');
ok(run(`apiPlanText('${c3.session.SessionID}')`).includes('📋 تشيك ليست الروتينات: 9.3% (أول جلسة 7.4%)'), 'WhatsApp text includes the score change');
const d = run(`apiDashboard({})`);
ok(d.roadmap && d.roadmap.projects === 1 && d.roadmap.avgFirst === 7.4 && d.roadmap.avgLast === 9.3 && d.roadmap.stable === 1 && d.roadmap.roadmapRoutines === 3,
  'dashboard: Assiut projects, first vs latest checklist score, stable routines');
ok(d.roadmap.rows[0].change === 1.9, 'dashboard change per project');
ok(run(`apiIntegrityCheck()`).ok, 'integrity check still clean');

console.log(`ROADMAP RESULT: ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
