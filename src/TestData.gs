/**
 * Test scenarios (fictional data, clearly marked «تجريبي»).
 * Runs the real API functions end-to-end — exactly what a mentor would do in the UI —
 * so it doubles as an automated acceptance test. Test projects get IDs starting with TEST-.
 */
function testFill_(ctx, spec) {
  // build review payload for every open assignment + every routine, from a compact spec
  var reviews = ctx.openAssignments.map(function (a) {
    var r = (spec.reviews || {})[a.TaskID] || (spec.reviews || {})[a.TaskName];
    if (!r) throw new Error('scenario missing review for ' + a.TaskID + ' ' + a.TaskName);
    return Object.assign({ AssignmentID: a.AssignmentID }, r);
  });
  var routineReviews = ctx.routines.map(function (r) {
    var rs = (spec.routines || {})[r.RoutineID] || { pattern: '1', Decision: C.R_CONT };
    var pat = rs.pattern || '1', i = 0;
    var occ = r.slots.map(function (s) {
      if (s.defaultStatus === C.OCC_NA) return { DueDate: s.DueDate, PeriodLabel: s.PeriodLabel, Status: C.OCC_NA };
      var ch = pat.charAt(i++ % pat.length);
      return { DueDate: s.DueDate, PeriodLabel: s.PeriodLabel, Status: ch === '1' ? C.OCC_DONE : ch === 'p' ? C.OCC_PART : ch === 'n' ? C.OCC_NA : C.OCC_MISS };
    });
    return { RAID: r.RAID, occurrences: occ, Decision: rs.Decision || C.R_CONT, Note: rs.Note || '', EvidenceLink: rs.EvidenceLink || '', NewNote: rs.NewNote || '' };
  });
  return Object.assign({}, spec.payload, { reviews: reviews, routineReviews: routineReviews });
}

function testScenarios_() {
  return [
    { project: { ProjectName: 'ورشة النور للملابس الحريمي (تجريبي)', OwnerName: 'منى عبد الرحيم (تجريبي)', Phone: '01000000001', BusinessType: 'ملابس وتفصيل',
        Governorate: 'سوهاج', Location: 'أخميم', Round: 'دورة تجريبية 2026', StartDate: '2026-10-01', Description: 'تفصيل عبايات وطرح؛ استفسارات كثيرة على واتساب وشراء قليل.' },
      sessions: [
        { date: '2026-10-05', payload: { planEnd: '2026-10-12',
            diagnosis: { ProblemID: 'P-MK03', causes: [
              { CauseID: 'C-MK03-2', Classification: C.DIAG_CONF, EvidenceNote: 'مراجعة 20 محادثة: 14 منها سألت عن السعر والمقاس لأن الصور بلا بيانات.' },
              { CauseID: 'C-MK03-3', Classification: C.DIAG_CONF, EvidenceNote: '11 استفسارًا الأسبوع الماضي لم يُرجع لها.' },
              { CauseID: 'C-MK03-1', Classification: C.DIAG_LIKELY, EvidenceNote: 'الرد يتأخر أحيانًا ليوم كامل؛ يحتاج قياس.' },
              { CauseID: 'C-MK03-4', Classification: C.DIAG_NA, EvidenceNote: '' }] },
            strategy: { PrimaryStrategyID: 'S-MK06', SupportingStrategyID: 'S-MK05', SupportJustification: 'العرض غير الواضح سبب مؤكد بجانب غياب المتابعة.' },
            newTasks: [
              { TaskID: 'MK-A08', Deadline: '2026-10-09', Responsible: 'منى', TargetNote: 'تسجيل كل استفسار جاد ومتابعة 15 على الأقل' },
              { TaskID: 'MK-A07', Deadline: '2026-10-11', Responsible: 'منى وابنتها (الرد على واتساب)' },
              { TaskID: 'MK-A10', Deadline: '2026-10-11', OffStrategyReason: 'الصور الحالية مظلمة وبلا مقاسات؛ تحسين العرض جزء من نفس المشكلة.', CustomInstructions: 'ابدئي بالعباية الأكثر طلبًا.' }],
            newRoutines: [{ RoutineID: 'R-MK01', Responsible: 'منى' }, { RoutineID: 'R-MK03', Responsible: 'منى' }, { RoutineID: 'R-MK02' }],
            kpiValues: [{ KPIID: 'K03', Value: 40, Source: 'عد يدوي لمحادثات واتساب' }, { KPIID: 'K04', Value: 4 }, { KPIID: 'K02', Value: 9 }, { KPIID: 'K01', Value: 5400 }],
            newProjectKPIs: [{ KPIID: 'K04', TargetValue: 10 }],
            readiness: 4, mentorSummary: 'البداية بتنظيم المتابعة وتحسين بطاقة منتج واحد.' } },
        { date: '2026-10-12', reviews: {
            'MK-A08': { Status: C.ST_DONE, ImplementationNote: 'عملت كشف في كراسة وسجلت كل الاستفسارات من 6 أكتوبر.', Metrics: { 'عدد الاستفسارات المسجلة': 32, 'عدد المتابعات المنفذة': 18, 'طلبات ناتجة عن المتابعة': 5 },
              ActualResult: '5 طلبات جاءت من متابعة استفسارات قديمة', BeforeValue: 0, AfterValue: 5, EvidenceType: 'صورة', EvidenceLink: 'https://drive.google.com/test-evidence-mk-a08', EvidenceNote: 'صورة الكشف بعد إخفاء الأرقام', Decision: C.DEC_DONE },
            'MK-A07': { Status: C.ST_PART, ImplementationNote: 'كتبت ردود 6 أسئلة من 10 (السعر، المقاسات، التوصيل، الدفع، الخامة، الاستبدال).', Metrics: { 'عدد الأسئلة التي لها رد جاهز': 6 },
              ActualResult: 'الرد على السعر والمقاس بقى أسرع', Barriers: ['ضيق الوقت'], BarrierNote: 'موسم المدارس وضغط الشغل', EvidenceType: 'لقطة شاشة', EvidenceNote: 'ملاحظة على الموبايل بالردود', Decision: C.DEC_CARRY, NewDeadline: '2026-10-18' },
            'MK-A10': { Status: C.ST_NOT, ImplementationNote: '', Barriers: ['نقص الموارد', 'نقص المعرفة أو المهارة'], BarrierNote: 'لا توجد إضاءة مناسبة ولا تعرف ترتيب الصورة', Decision: C.DEC_MOD,
              NewDeadline: '2026-10-18', Adjustment: 'تصوير عباية واحدة بنور الشباك الصبح على قماشة سادة، والمنتور أرسل مثالًا.' } },
          routines: { 'R-MK01': { pattern: '111101', Decision: C.R_CONT }, 'R-MK03': { pattern: '10', Decision: C.R_CONT, Note: 'المتابعة الثانية فاتت بسبب الضغط' }, 'R-MK02': { pattern: '1p1011' } },
          payload: { planEnd: '2026-10-19', businessResultNote: 'الطلبات زادت من 9 إلى 12 والاستفسارات المتحولة من 4 إلى 7؛ التحسن مرتبط بالمتابعة وليس بعد بتحسين العرض.',
            diagnosis: { ProblemID: 'P-MK03', ContinuedFocus: true, causes: [{ CauseID: 'C-MK03-2', Classification: C.DIAG_CONF }, { CauseID: 'C-MK03-4', Classification: C.DIAG_LIKELY, EvidenceNote: 'عدة عميلات اعترضن على السعر.' }] },
            strategy: { PrimaryStrategyID: 'S-MK05' },
            newTasks: [{ TaskID: 'MK-A19', Deadline: '2026-10-18', Responsible: 'منى' }],
            kpiValues: [{ KPIID: 'K03', Value: 38 }, { KPIID: 'K04', Value: 7 }, { KPIID: 'K02', Value: 12 }, { KPIID: 'K01', Value: 7100 }],
            readiness: 3, workloadNote: 'تم تبسيط مهمة التصوير لمنتج واحد.' } },
        { date: '2026-10-19', reviews: {
            'MK-A07': { Status: C.ST_DONE, ImplementationNote: 'استكملت 10 ردود وحفظتها ردودًا سريعة.', Metrics: { 'عدد الأسئلة التي لها رد جاهز': 10 }, ActualResult: 'وقت الرد قل لأقل من ساعة في أغلب المحادثات',
              EvidenceType: 'لقطة شاشة', EvidenceLink: 'https://drive.google.com/test-evidence-mk-a07', Decision: C.DEC_DONE },
            'MK-A10': { Status: C.ST_DONE, ImplementationNote: 'صورت العباية الأكثر طلبًا 4 صور وكتبت المقاسات والسعر.', Metrics: { 'عدد المنتجات التي أُعدت لها بطاقة عرض': 1 },
              ActualResult: 'سؤال المقاس قل في محادثات العباية دي', EvidenceType: 'صورة', EvidenceLink: 'https://drive.google.com/test-evidence-mk-a10', Decision: C.DEC_DONE },
            'MK-A19': { Status: C.ST_PROG, ImplementationNote: 'سألت 3 من 5 ولقت أن السعر والتوصيل أكثر سببين.', Metrics: { 'عدد من تم سؤالهم': 3 }, Barriers: ['ضيق الوقت'], Decision: C.DEC_CONT } },
          routines: { 'R-MK01': { pattern: '1' }, 'R-MK03': { pattern: '11' }, 'R-MK02': { pattern: '111110' } },
          payload: { planEnd: '2026-10-26', businessResultNote: 'الطلبات وصلت 15 والمبيعات 8,900 جنيه؛ نسبة التحويل تتحسن تدريجيًا.',
            diagnosis: { ProblemID: 'P-MK03', ContinuedFocus: true, causes: [{ CauseID: 'C-MK03-4', Classification: C.DIAG_CONF, EvidenceNote: 'نتائج سؤال 3 عميلات.' }] },
            strategy: { PrimaryStrategyID: 'S-MK05' }, newTasks: [{ TaskID: 'MK-A25', Deadline: '2026-10-24' }],
            kpiValues: [{ KPIID: 'K03', Value: 41 }, { KPIID: 'K04', Value: 10 }, { KPIID: 'K02', Value: 15 }, { KPIID: 'K01', Value: 8900 }],
            readiness: 4 } }
      ] },
    { project: { ProjectName: 'مزرعة الخير لإنتاج البيض (تجريبي)', OwnerName: 'حسن عبد الله (تجريبي)', Phone: '01000000002', BusinessType: 'دواجن وبيض',
        Governorate: 'أسيوط', Location: 'أبنوب', Round: 'دورة تجريبية 2026', StartDate: '2026-10-01', Description: '1200 دجاجة بياضة؛ لا يعرف تكلفة الكرتونة ولا هل يكسب.' },
      sessions: [
        { date: '2026-10-06', payload: { planEnd: '2026-10-13',
            diagnosis: { ProblemID: 'P-FN02', causes: [
              { CauseID: 'C-FN02-2', Classification: C.DIAG_CONF, EvidenceNote: 'لا يحسب النفوق والبيض المكسور ولا الكراتين.' },
              { CauseID: 'C-FN02-4', Classification: C.DIAG_CONF, EvidenceNote: 'يحسب العلف بسعر الشهر الماضي.' },
              { CauseID: 'C-FN02-1', Classification: C.DIAG_LIKELY }] },
            strategy: { PrimaryStrategyID: 'S-FN03' },
            newTasks: [{ TaskID: 'FN-A04', Deadline: '2026-10-12', Responsible: 'حسن مع المنتور', CustomInstructions: 'الوحدة: كرتونة 30 بيضة؛ الدفعة: إنتاج أسبوع.' }],
            newRoutines: [{ RoutineID: 'R-FN01' }, { RoutineID: 'R-FN02', CustomNote: 'سجّل شكاير العلف والأدوية يومًا بيوم.' }],
            kpiValues: [{ KPIID: 'K10', Value: 15200, Source: 'تقدير صاحب المشروع' }, { KPIID: 'K11', Value: 13900, Source: 'تقدير صاحب المشروع' }],
            readiness: 4 } },
        { date: '2026-10-13', reviews: {
            'FN-A04': { Status: C.ST_DONE, ImplementationNote: 'حسب العلف والأدوية والكراتين والعمالة والنفوق والمكسور لأسبوع.', Metrics: { 'تكلفة الوحدة المحسوبة (جنيه)': 78, 'سعر البيع الحالي (جنيه)': 85 },
              ActualResult: 'تكلفة الكرتونة 78 جنيه مقابل سعر بيع 85 — الهامش حوالي 8%', AfterValue: 78, EvidenceType: 'مستند', EvidenceLink: 'https://drive.google.com/test-evidence-fn-a04', Decision: C.DEC_DONE } },
          routines: { 'R-FN01': { pattern: '1101' }, 'R-FN02': { pattern: '1001' } },
          payload: { planEnd: '2026-10-20', businessResultNote: 'لأول مرة يعرف أن هامشه 8% فقط؛ لا تغير في المبيعات بعد.',
            diagnosis: { ProblemID: 'P-FN02', ContinuedFocus: true, causes: [{ CauseID: 'C-FN02-5', Classification: C.DIAG_CONF, EvidenceNote: 'السعر محدد بسعر التاجر المجاور.' }] },
            strategy: { PrimaryStrategyID: 'S-FN04' }, newTasks: [{ TaskID: 'FN-A05', Deadline: '2026-10-19' }],
            kpiValues: [{ KPIID: 'K13', Value: 78 }, { KPIID: 'K14', Value: 8.2 }, { KPIID: 'K10', Value: 15800 }, { KPIID: 'K11', Value: 14600 }],
            readiness: 4 } }
      ] },
    { project: { ProjectName: 'مطبخ أم يوسف للمخبوزات (تجريبي)', OwnerName: 'سعاد محمود (تجريبي)', Phone: '01000000003', BusinessType: 'تصنيع وتجهيز أغذية',
        Governorate: 'المنيا', Location: 'ملوي', Round: 'دورة تجريبية 2026', StartDate: '2026-10-01', Description: 'مخبوزات وفطير؛ تأخير طلبات المناسبات ونفاد الدقيق والسمن.' },
      sessions: [
        { date: '2026-10-07', payload: { planEnd: '2026-10-14',
            diagnosis: { ProblemID: 'P-OP02', causes: [
              { CauseID: 'C-OP02-1', Classification: C.DIAG_CONF, EvidenceNote: 'لا يوجد أي سجل للدقيق والسمن والعبوات.' },
              { CauseID: 'C-OP02-2', Classification: C.DIAG_CONF, EvidenceNote: 'الشراء يتم عند بدء الطلب.' },
              { CauseID: 'C-OP02-4', Classification: C.DIAG_NA }] },
            strategy: { PrimaryStrategyID: 'S-OP03', SupportingStrategyID: 'S-OP01', SupportJustification: 'التأخير مرتبط أيضًا بغياب خطة إنتاج مرتبطة بالطلبات.' },
            newTasks: [{ TaskID: 'OP-A05', Deadline: '2026-10-10' }, { TaskID: 'OP-A02', Deadline: '2026-10-13', TargetNote: 'كل طلبات الأسبوع داخل الخطة' }],
            newRoutines: [{ RoutineID: 'R-OP03' }, { RoutineID: 'R-OP04' }, { RoutineID: 'R-OP10' }],
            kpiValues: [{ KPIID: 'K23', Value: 4 }, { KPIID: 'K22', Value: 6 }, { KPIID: 'K18', Value: 900 }],
            readiness: 5 } },
        { date: '2026-10-14', reviews: {
            'OP-A05': { Status: C.ST_DONE, ImplementationNote: 'عملت 5 بطاقات (دقيق، سمن، سكر، عبوات، بيض) وعلقتها على الرف.', Metrics: { 'عدد الأصناف التي لها بطاقة': 5, 'حركات مسجلة في نفس اليوم': 21 },
              ActualResult: 'عرفت أن العبوات تكفي 3 أيام فقط فاشترت قبل النفاد', EvidenceType: 'صورة', EvidenceLink: 'https://drive.google.com/test-evidence-op-a05', Decision: C.DEC_DONE },
            'OP-A02': { Status: C.ST_PART, ImplementationNote: 'عملت خطة الأسبوع على ورقة لكن لم تحدثها منتصف الأسبوع.', Metrics: { 'طلبات مدرجة في الخطة': 14, 'طلبات أُنجزت في موعدها': 11 },
              ActualResult: '3 طلبات تأخرت بدل 6', BeforeValue: 6, AfterValue: 3, Barriers: ['ضيق الوقت'], EvidenceType: 'صورة', EvidenceNote: 'صورة الخطة', Decision: C.DEC_CONT } },
          routines: { 'R-OP03': { pattern: '110111' }, 'R-OP04': { pattern: '1' }, 'R-OP10': { pattern: '1', Decision: C.R_MOD, NewNote: 'الجرد يوم الخميس قبل التخطيط.' } },
          payload: { planEnd: '2026-10-21', businessResultNote: 'نفاد الخامات قل من 4 مرات إلى مرة واحدة، والطلبات المتأخرة من 6 إلى 3.',
            diagnosis: { ProblemID: 'P-OP02', ContinuedFocus: true, causes: [{ CauseID: 'C-OP02-3', Classification: C.DIAG_CONF, EvidenceNote: 'السمن نفد مرة رغم البطاقة لأن الطلب يتم عند النفاد.' }] },
            strategy: { PrimaryStrategyID: 'S-OP03' }, newTasks: [{ TaskID: 'OP-A06', Deadline: '2026-10-20' }],
            kpiValues: [{ KPIID: 'K23', Value: 1 }, { KPIID: 'K22', Value: 3 }, { KPIID: 'K18', Value: 1050 }],
            readiness: 4 } }
      ] }
  ];
}

function loadTestData_() {
  var existing = DB.all('DB_Projects').filter(function (p) { return p.DataType === C.TEST; });
  if (existing.length) throw AppError('البيانات التجريبية محملة بالفعل؛ احذفها أولًا من القائمة.');
  var mentor = apiCreateMentor({ MentorName: 'منتورة تجريبية — سارة (تجريبي)', Email: '', DataType: C.TEST });
  var out = [];
  testScenarios_().forEach(function (sc) {
    var p = apiCreateProject(Object.assign({ MentorID: mentor.MentorID, DataType: C.TEST }, sc.project));
    sc.sessions.forEach(function (ss) {
      var ctx = apiStartSession(p.ProjectID, mentor.MentorID, ss.date);
      var payload = testFill_(ctx, ss);
      payload.sessionDate = ss.date;
      var res = apiFinalizeSession(ctx.session.SessionID, payload);
      out.push(p.ProjectID + ' S' + ctx.session.SessionNo + ': ' + JSON.stringify(res));
    });
  });
  return out;
}
