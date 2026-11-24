import json, sys, openpyxl
src, out_json = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(src)
AR = str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789')
PFX = {'ي': 'D', 'أس': 'W', 'أب': 'B', 'ش': 'M'}
FREQ = {'يومي': 'DAILY', 'أسبوعي': 'WEEKLY', 'كل أسبوعين': 'BIWEEKLY', 'شهري': 'MONTHLY'}
AREA = {'التكاليف والمالية': 'FN', 'التسعير والربحية': 'FN', 'خارطة الطريق وخطة النمو': 'FN',
        'المبيعات والعملاء': 'MK', 'التسويق والترويج': 'MK', 'السوق والمنافسين': 'MK', 'التوزيع وقنوات البيع': 'MK', 'النمو والشراكات': 'MK',
        'المنتج والجودة': 'OP', 'المخزون والمشتريات': 'OP', 'الإنتاج والتشغيل': 'OP', 'المعدات والصيانة': 'OP', 'إدارة المخاطر': 'OP',
        'الفلوس': 'FN', 'التكلفة والتسعير والشرا': 'FN', 'البيع': 'MK', 'التخطيط': 'FN'}
def rid(code):
    p, n = code.strip().split('-')
    return 'RM-' + PFX[p] + n.translate(AR).zfill(2)
ws = wb['مكتبة اسيوط (محدثة)']
tasks = []
for r in ws.iter_rows(min_row=5, values_only=True):
    r = r[1:]
    if not r[5] or r[0] == 'التكرار': continue
    freq, dom, text, res, ind, code, day, who, orig = [str(x).strip() if x is not None else '' for x in r[:9]]
    tasks.append({'RoadmapID': rid(code), 'Code': code, 'FrequencyCode': FREQ[freq], 'FrequencyText': freq, 'Domain': dom,
                  'AreaID': AREA[dom], 'TaskText': text, 'ExpectedResult': res, 'Indicator': ind, 'ProgramDay': day,
                  'AppliesTo': who, 'Origin': orig, 'Active': 'نعم'})
ids = [t['RoadmapID'] for t in tasks]
assert len(ids) == len(set(ids)) == 145, (len(ids), len(set(ids)))
ws = wb['تشيك ليست الروتينات']
items = []
for r in ws.iter_rows(min_row=9, max_row=36, values_only=True):
    no, dom, freq, text, ask, who = [str(x).strip() if x is not None else '' for x in r[1:7]]
    codes = str(r[11] or '').strip()
    links = [] if codes in ('', '—') else [rid(c) for c in codes.split('·')]
    for l in links: assert l in ids, (text, l)
    items.append({'ItemID': 'RC-%02d' % int(no.translate(AR)), 'Domain': dom, 'AreaID': AREA[dom], 'FrequencyText': freq,
                  'RoutineText': text, 'EvidenceToAsk': ask, 'AppliesTo': who, 'RoadmapIDs': ', '.join(links), 'SortOrder': int(no.translate(AR))})
assert len(items) == 28
json.dump({'LIB_RoadmapTasks': tasks, 'LIB_RoadmapChecklist': items}, open(out_json, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print(len(tasks), len(items)); print(items[5]); print(tasks[0])
