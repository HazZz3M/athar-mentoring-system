# نظام أثر للمنتورينج ومتابعة أداء المشروعات

**Athar Integrated Mentoring & Business Performance Management System**: قاعدة البيانات Google Sheets، والتطبيق Google Apps Script (قائمة داخل الشيت + Web App للمنتورين).

- **الشيت:** [Athar_Mentoring_System](https://docs.google.com/spreadsheets/d/1l8b-gdD37ia5_VUoKaWjvha1kT8IVMygbjiKXLCvS0Q/edit)
- **مشروع Apps Script المربوط بالشيت:** `1N3eVDXTxawOH4GTf9G5Rlu2dB7oHE99jbEP0gC2rmngk8YoJoCVn1mTv`
- **رابط المنتورين (Web App، حسابات athareg.com فقط):**
  https://script.google.com/a/macros/athareg.com/s/AKfycbxUQNJLkmCIMxjdPmpX9T7hOQCJ1_J7n-EWUJYvPfWEe_PlgpctQlptozMqmK2FpdmV5A/exec

## محتوى الريبو

| المسار | المحتوى |
|---|---|
| `src/` | كود Apps Script كما يُرفع للشيت: `Code.gs` (القائمة، الـ Web App، PDF، الإعداد)، `Core.gs` (منطق الجلسات والتشخيص والمؤشرات)، `SheetDb.gs` (القراءة والكتابة في الشيت + القفل)، `Schema.gs`، `TestData.gs`، `Index.html` (واجهة المنتور)، `appsscript.json` |
| `tests/` | اختبارات تشتغل بـ Node بدون Google: منطق النظام كامل (47 اختبار) + محاكاة الشيت والقفل (19 اختبار) |
| `template/` | ملف Excel الأصلي (المكتبة + البيانات التجريبية) ونسخة Demo تعمل بدون إنترنت |
| `.github/workflows/deploy.yml` | أي تعديل على `main` بيتختبر، ولو الاختبارات نجحت بيترفع على الشيت ويتحدث الـ Web App بنفس الرابط |

## الربط بين GitHub والشيت

```
push على main ← GitHub Actions: npm test ← clasp push (الكود للشيت) ← clasp deploy (نسخة جديدة لنفس الرابط)
```

لو أي اختبار فشل، **مافيش حاجة بتترفع**، والشيت يفضل على آخر نسخة سليمة.

### الإعداد لمرة واحدة

1. **Secret اسمه `CLASPRC_JSON`** (Settings ← Secrets and variables ← Actions ← Secrets): محتوى ملف `~/.clasprc.json` بعد تسجيل الدخول بحساب hazem@athareg.com:
   ```bash
   npm install -g @google/clasp@2.4.2
   clasp login            # يفتح المتصفح للموافقة
   # Windows:  type %USERPROFILE%\.clasprc.json
   # Mac/Linux: cat ~/.clasprc.json
   # انسخ المحتوى كله في الـ secret
   ```
2. معرف الـ Web App موجود جوه ملف الـ workflow نفسه (`DEPLOYMENT_ID`)، ومش محتاج إعداد.
3. لازم يكون **Google Apps Script API** مفعّل في https://script.google.com/home/usersettings، وهو مفعّل بالفعل.

> ملف `.clasprc.json` فيه صلاحية الدخول على حسابك. ماينفعش يترفع على الريبو (موجود في `.gitignore`)، ومكانه الـ Secret بس.

### تعديل الكود

- **الطريقة الأساسية:** عدّل في `src/` واعمل push على `main`.
- **لو عدّلت مباشرة في محرر Apps Script:** الـ push الجاي من GitHub هيكتب فوق تعديلك. انقل التعديل للريبو الأول، أو اسحبه بـ `clasp pull`.

## الاستخدام المتزامن (حوالي 20 منتور في نفس الوقت)

الحماية المعمولة في الكود:

- **كل كتابة في الشيت بتعدّي على قفل واحد** (`LockService.getScriptLock`) في `SheetDb.withLock`. الحفظات بتتنفذ واحدة ورا التانية، والحفظة الواحدة بتاخد ثواني. لو القفل ماتحررش خلال 45 ثانية، المستخدم بيشوف رسالة «النظام مشغول… حاول مرة أخرى» بدل ما البيانات تبوظ.
- **قراءة جديدة بعد أخذ القفل:** أول ما القفل يتاخد، البيانات المخزنة مؤقتًا بتتمسح وتتقرا من الشيت تاني. ده بيمنع إن مستخدمين ياخدوا نفس المعرف (مثلًا `ASG-000123` مرتين)، أو حد يكتب في صف اتحرك بعد حذف مسودة.
- **أي كتابة من غير قفل بتترفض** (`requireLock_`)، فمستحيل كود جديد يكتب في الشيت من غير حماية بالغلط.
- **الحفظ التلقائي للمسودة** (كل 45 ثانية لو فيه تغيير) بقى جوه القفل، وبيتأكد إن الجلسة لسه مسودة. ماينفعش يرجّع جلسة اتحفظت نهائيًا لحالة «مسودة».
- **رابط الـ PDF:** ملف الخطة بيتعمل برّه القفل، والقفل بس على كتابة الرابط في الشيت. كده الـ PDF البطيء مايوقفش باقي المنتورين.

حدود لازم تعرفها:

- الـ Web App بيشتغل باسم صاحب النشر (`USER_DEPLOYING`)، وجوجل بتسمح بحوالي 30 تنفيذ متزامن للحساب الواحد. 20 مستخدم جوه الحد ده.
- **ماحدش يعدّل أو يحذف صفوف أوراق `DB_` بإيده** والمنتورين شغالين. الكتابة اليدوية مابتعدّيش على القفل. التصحيح بيتعمل من التطبيق في الجلسة التالية.
- لو عدد السجلات كبر جدًا (عشرات الآلاف من الصفوف)، فتح الشاشات هيبطأ لأن كل طلب بيقرا الجداول اللي محتاجها.

## تشغيل الاختبارات محليًا

```bash
npm test
```
