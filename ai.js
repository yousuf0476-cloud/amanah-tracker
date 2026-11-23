/* =========================================================================
   ai.js — الذكاء الاصطناعي في نظام متابعة البلاغات (يعمل داخل المتصفح بالكامل)
   1) معالجة النص العربي (تطبيع + تقطيع + تجذيع خفيف)
   2) مصنِّف بايز الساذج (Naive Bayes) يقترح: الجهة المختصة + الأولوية، مع شرح السبب
   3) كشف البلاغات المتشابهة باستخدام TF-IDF وتشابه جيب التمام (Cosine Similarity)
   4) المساعد الذكي: يحلل البلاغات ويستخرج ملاحظات وتوصيات تلقائية
   لا يحتاج إنترنت ولا مفتاح API، ولا يرسل أي بيانات لأي جهة.
   ========================================================================= */
(function (global) {
  "use strict";

  /* ---------- 1) معالجة النص العربي ---------- */
  const STOPWORDS = new Set([
    "في", "من", "على", "الي", "الى", "عن", "مع", "هذا", "هذه", "ذلك", "تلك", "تم", "او", "ثم", "قد",
    "كل", "بعد", "قبل", "عند", "لدي", "لدى", "به", "بها", "فيه", "فيها", "التي", "الذي", "ما", "هو", "هي",
    "يوجد", "توجد", "يرجي", "يرجى", "نرجو", "الرجاء", "رجاء", "منذ", "حتي", "حتى", "كان", "كانت", "يكون",
    "اي", "أي", "جدا", "ايضا", "لكن", "بين", "حول", "داخل", "خلال", "الان", "اليوم", "امس", "و", "ب", "ل",
    "مكتب", "قسم", "اداره", "اداريه", "الاداريه", "الموظف", "موظف", "بلاغ", "مشكله", "عمل",
    "الثاني", "الثالث", "الاول", "الرابع", "ثاني", "ثالث", "اول"
  ]);
  const PREFIXES = ["وبال", "وال", "بال", "كال", "فال", "لل", "ال"];

  function normalize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[\u064B-\u0652\u0640]/g, "")        // حذف التشكيل والتطويل
      .replace(/[أإآٱ]/g, "ا")
      .replace(/ى/g, "ي")
      .replace(/ة/g, "ه")
      .replace(/ؤ/g, "و")
      .replace(/ئ/g, "ي")
      .replace(/[^\u0621-\u064Aa-z0-9\s]/g, " ");   // إبقاء الحروف والأرقام فقط
  }

  function stem(word) {
    let w = word;
    for (const p of PREFIXES) {
      if (w.startsWith(p) && w.length - p.length >= 3) { w = w.slice(p.length); break; }
    }
    if (w.length > 4 && (w.endsWith("ات") || w.endsWith("ين") || w.endsWith("ون"))) w = w.slice(0, -2);
    else if (w.length > 3 && w.endsWith("ه")) w = w.slice(0, -1);
    return w;
  }

  function tokenize(text) {
    return normalize(text)
      .split(/\s+/)
      .filter(t => t.length > 1 && !STOPWORDS.has(t))
      .map(stem)
      .filter(t => t.length > 1 && !STOPWORDS.has(t));
  }

  /* ---------- 2) مصنِّف بايز الساذج ---------- */
  class NaiveBayes {
    constructor(alpha = 1, ignore = new Set()) { this.alpha = alpha; this.ignore = ignore; }
    tokens(text) { return tokenize(text).filter(t => !this.ignore.has(t)); }

    train(examples) { // examples: [{ text, label }]
      this.classes = {};
      this.vocab = new Set();
      for (const { text, label } of examples) {
        const c = this.classes[label] || (this.classes[label] = { docs: 0, words: {}, total: 0 });
        c.docs++;
        for (const t of this.tokens(text)) {
          c.words[t] = (c.words[t] || 0) + 1;
          c.total++;
          this.vocab.add(t);
        }
      }
      this.totalDocs = examples.length;
      return this;
    }

    logLikelihood(c, t) {
      return Math.log(((c.words[t] || 0) + this.alpha) / (c.total + this.alpha * this.vocab.size));
    }

    predict(text, boost = null) {
      const tokens = this.tokens(text).filter(t => this.vocab.has(t));
      if (!tokens.length) return null; // لا توجد كلمات معروفة: لا نخمّن
      const scores = Object.entries(this.classes).map(([label, c]) => {
        let s = Math.log(c.docs / this.totalDocs);
        for (const t of tokens) s += this.logLikelihood(c, t);
        if (boost && boost[label]) s += boost[label];
        return { label, s };
      });
      // تحويل الدرجات إلى احتمالات (softmax)
      const max = Math.max(...scores.map(x => x.s));
      const sum = scores.reduce((a, x) => a + Math.exp(x.s - max), 0);
      const ranked = scores
        .map(x => ({ label: x.label, p: Math.exp(x.s - max) / sum }))
        .sort((a, b) => b.p - a.p);
      const best = ranked[0].label;
      return { label: best, confidence: ranked[0].p, ranked, reasons: this.explain(tokens, best) };
    }

    // أكثر الكلمات التي رجّحت هذا التصنيف مقارنة بباقي التصنيفات
    explain(tokens, label) {
      const c = this.classes[label];
      const others = Object.entries(this.classes).filter(([l]) => l !== label).map(([, o]) => o);
      const seen = new Set();
      return tokens
        .filter(t => !seen.has(t) && seen.add(t))
        .map(t => {
          const avgOther = others.reduce((a, o) => a + this.logLikelihood(o, t), 0) / others.length;
          return { word: t, weight: this.logLikelihood(c, t) - avgOther };
        })
        .filter(x => x.weight > 0.4)
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 3)
        .map(x => x.word);
    }
  }

  // كلمات عامة تصف العطل ولا تدل على الجهة (تُستبعد من نموذج الجهة فقط)
  const GENERIC = new Set(["لا", "يعمل", "تعمل", "يعملان", "تعطل", "متوقف", "توقف", "بالكامل", "كامل",
    "جديد", "تحتاج", "يحتاج", "يستطيع", "استطيع", "جميع", "عاجل", "صوت", "غريب", "الدور", "دور", "اول", "ثاني"]);

  // قواعد الاستعجال: كلمات ترفع أو تخفض الأولوية (تُدمج مع نموذج التعلم الآلي)
  const URGENT = ["انقطاع", "متوقف", "توقف", "بالكامل", "جميع", "خطر", "خطرا", "حريق", "دخان", "شرار", "تسرب",
    "عالق", "عاجل", "فيروس", "ازدحام", "غاضب", "فقدان", "مخالف", "سلام", "خادم", "اعاق"].map(stem);
  const MINOR = ["طلب", "تحديث", "استفسار", "مقترح", "اشتراك", "نسخ", "دهان", "ستاير", "ترتيب", "لوح", "دليل"].map(stem);
  function urgencyBoost(text) {
    const toks = tokenize(text);
    const u = toks.filter(t => URGENT.includes(t)).length;
    const m = toks.filter(t => MINOR.includes(t)).length;
    const words = toks.filter(t => URGENT.includes(t) || MINOR.includes(t));
    return { boost: { "عالية": 3 * u, "منخفضة": 2 * m }, words };
  }

  /* ---------- بيانات التدريب الأساسية (أمثلة افتراضية) ---------- */
  // [نص البلاغ, الجهة المختصة, الأولوية]
  const IT = "تقنية المعلومات", MAINT = "الخدمات والصيانة", ADMIN = "الشؤون الإدارية",
        PROJ = "المشاريع", BEN = "خدمة المستفيدين";
  const H = "عالية", M = "متوسطة", L = "منخفضة";
  const TRAINING = [
    ["الطابعة لا تطبع وتظهر رسالة خطأ", IT, M],
    ["نفاد حبر الطابعة في المكتب", IT, L],
    ["الطابعة المشتركة متوقفة عن العمل بالكامل والقسم كله لا يستطيع الطباعة", IT, H],
    ["الجهاز بطيء جدا عند التشغيل", IT, L],
    ["الكمبيوتر لا يعمل ولا تظهر الشاشة", IT, M],
    ["انقطاع الإنترنت عن الدور الثاني بالكامل", IT, H],
    ["انقطاع الشبكة عن جميع أجهزة الإدارة", IT, H],
    ["نقطة الشبكة في المكتب لا تعمل", IT, M],
    ["الواي فاي ضعيف في قاعة الاجتماعات", IT, L],
    ["نسيت كلمة المرور ولا أستطيع الدخول إلى النظام", IT, M],
    ["الحساب مقفل في نظام الموارد البشرية", IT, M],
    ["البريد الإلكتروني لا يرسل الرسائل", IT, M],
    ["توقف نظام المعاملات الإلكترونية عن جميع الموظفين", IT, H],
    ["الماسح الضوئي لا يتعرف عليه الجهاز", IT, L],
    ["تعطل جهاز المسح الضوئي في الاستقبال", IT, M],
    ["طلب تثبيت برنامج أوفيس على جهاز جديد", IT, L],
    ["تحديث نظام التشغيل في الجهاز", IT, L],
    ["الشاشة الثانية لا تعمل", IT, L],
    ["فيروس في الجهاز ورسائل غريبة تظهر", IT, H],
    ["الخادم متوقف والأنظمة لا تفتح", IT, H],
    ["جهاز البصمة لا يقرأ البصمات", IT, M],
    ["طلب جهاز حاسب محمول لموظف جديد", IT, L],
    ["الهاتف الشبكي لا يعمل في المكتب", IT, M],
    ["مشكلة في الدخول على البوابة الإلكترونية", IT, M],
    ["الكاميرا والميكروفون لا يعملان في الاجتماعات المرئية", IT, M],
    ["لوحة المفاتيح والفأرة لا تعمل", IT, L],
    ["تعذر الاتصال بالشبكة الداخلية بعد التحديث", IT, M],
    ["طلب صلاحية دخول على نظام الأرشفة الإلكترونية", IT, L],
    ["رسائل احتيال تصل إلى بريد الموظفين", IT, H],
    ["الطابعة تسحب الورق بشكل خاطئ", IT, L],
    ["البرنامج يغلق فجأة أثناء العمل", IT, M],
    ["جهاز العرض البروجكتور لا يتصل بالحاسب", IT, M],
    ["كابل الشبكة مقطوع في المكتب", IT, M],
    ["نسخ احتياطي للملفات قبل تغيير الجهاز", IT, L],
    ["تعطل نظام البصمة عن جميع الموظفين", IT, H],

    ["المكيف لا يبرد في المكتب", MAINT, M],
    ["تعطل التكييف المركزي في المبنى بالكامل", MAINT, H],
    ["تسرب مياه من السقف في الممر", MAINT, H],
    ["تسرب ماء في دورة المياه", MAINT, M],
    ["انقطاع الكهرباء عن الدور الأول", MAINT, H],
    ["إضاءة الممر محترقة وتحتاج استبدال", MAINT, L],
    ["لمبة المكتب لا تعمل", MAINT, L],
    ["الباب الرئيسي لا يقفل", MAINT, M],
    ["كرسي المكتب مكسور", MAINT, L],
    ["طلب نقل أثاث إلى المكتب الجديد", MAINT, L],
    ["المصعد متوقف والموظفون عالقون بداخله", MAINT, H],
    ["المصعد يصدر صوتا غريبا", MAINT, M],
    ["رائحة دخان قريبة من غرفة الكهرباء", MAINT, H],
    ["انسداد مغسلة دورة المياه", MAINT, M],
    ["طلب تنظيف قاعة الاجتماعات قبل الاجتماع", MAINT, L],
    ["الفيش الكهربائي يصدر شرارة", MAINT, H],
    ["تلف في بلاط الأرضية عند المدخل", MAINT, L],
    ["طلب صيانة دورية للمكيفات", MAINT, L],
    ["النافذة مكسورة في المكتب", MAINT, M],
    ["مضخة المياه متوقفة ولا يوجد ماء في المبنى", MAINT, H],
    ["طلب دهان جدران المكتب", MAINT, L],
    ["إنذار الحريق يعمل بدون سبب", MAINT, H],
    ["الستائر تالفة في القاعة", MAINT, L],
    ["طاولة الاجتماعات مكسورة", MAINT, L],
    ["تعطل سخان الماء في المطبخ", MAINT, L],
    ["المكيف يقطر ماء على الأرض", MAINT, M],
    ["كهرباء الأفياش مقطوعة في الغرفة", MAINT, M],
    ["طلب سباك لإصلاح الحنفية", MAINT, L],
    ["قفل باب المستودع مكسور", MAINT, M],
    ["ماس كهربائي في لوحة الكهرباء", MAINT, H],
    ["حرارة شديدة في المبنى بسبب توقف التكييف", MAINT, H],
    ["طلب تركيب رفوف في المكتب", MAINT, L],
    ["شق في جدار المبنى", MAINT, M],
    ["حشرات في المطبخ تحتاج رش مبيد", MAINT, M],
    ["مولد الكهرباء الاحتياطي لا يشتغل", MAINT, H],

    ["طلب أدوات مكتبية أوراق وأقلام", ADMIN, L],
    ["نفاد ورق الطباعة من المستودع", ADMIN, M],
    ["طلب ختم رسمي للإدارة", ADMIN, L],
    ["تأخر وصول المعاملات الورقية من الصادر والوارد", ADMIN, M],
    ["طلب ترتيب ملفات الأرشيف", ADMIN, L],
    ["فقدان ملف معاملة من الأرشيف", ADMIN, H],
    ["طلب سيارة للمهمة الرسمية غدا", ADMIN, M],
    ["تعديل سجل الحضور والانصراف لموظف", ADMIN, M],
    ["طلب إجازة لم يتم اعتمادها في الموعد", ADMIN, M],
    ["طلب تجهيز قاعة لاجتماع رسمي مع ضيافة", ADMIN, M],
    ["طلب بطاقات عمل للموظفين الجدد", ADMIN, L],
    ["توزيع التعاميم على الإدارات", ADMIN, L],
    ["خطاب عاجل يحتاج توقيع المدير اليوم", ADMIN, H],
    ["طلب مستلزمات ضيافة للمكتب", ADMIN, L],
    ["تأخر صرف العهدة المالية", ADMIN, M],
    ["طلب تصوير مستندات بكميات كبيرة", ADMIN, L],
    ["طلب اشتراك صحيفة للإدارة", ADMIN, L],
    ["خطأ في بيانات موظف في السجلات", ADMIN, M],
    ["طلب تجديد بطاقة دخول المبنى", ADMIN, L],
    ["ترتيب مواعيد اجتماعات المدير", ADMIN, L],
    ["وثائق رسمية مطلوبة للجهة الرقابية اليوم", ADMIN, H],
    ["طلب ظروف ومغلفات رسمية", ADMIN, L],
    ["طلب سجل الصادر والوارد للشهر", ADMIN, L],
    ["نقص في ملفات حفظ المعاملات", ADMIN, L],
    ["طلب تحديث دليل الهاتف الداخلي", ADMIN, L],
    ["طلب حبر للختم وأدوات مكتبية", ADMIN, L],
    ["معاملة واردة لم تسجل في نظام الصادر والوارد", ADMIN, M],
    ["طلب خطاب تعريف بالراتب لموظف", ADMIN, L],
    ["تأخر وصول البريد الرسمي للإدارة", ADMIN, M],
    ["طلب حجز قاعة للتدريب", ADMIN, L],
    ["نقص في مستلزمات المستودع", ADMIN, M],
    ["طلب سائق لتوصيل خطابات رسمية", ADMIN, M],
    ["إتلاف وثائق قديمة من الأرشيف", ADMIN, L],
    ["تعميم إداري يجب توزيعه قبل نهاية الدوام", ADMIN, H],
    ["طلب مكتب لموظف منقول", ADMIN, L],

    ["تأخر المقاول في تسليم المشروع", PROJ, H],
    ["طلب مخططات مشروع الحديقة العامة", PROJ, M],
    ["مراجعة تقرير الإشراف على مشروع الطريق", PROJ, M],
    ["طلب زيارة ميدانية لموقع المشروع", PROJ, M],
    ["ملاحظات على جودة الأعمال في موقع المشروع", PROJ, H],
    ["تحديث نسبة الإنجاز في مشروع السفلتة", PROJ, M],
    ["طلب اعتماد مستخلص المقاول", PROJ, H],
    ["حفرية مفتوحة في موقع المشروع تشكل خطرا على المارة", PROJ, H],
    ["طلب نسخة من عقد مشروع الإنارة", PROJ, L],
    ["طلب اجتماع مع الاستشاري بخصوص التصاميم", PROJ, M],
    ["تعارض في مخططات مشروع تصريف الأمطار", PROJ, H],
    ["طلب جدول زمني محدث للمشاريع", PROJ, L],
    ["أعمال الرصف متوقفة في المشروع", PROJ, H],
    ["طلب تقرير شهري عن مشاريع البلدية", PROJ, L],
    ["استلام ابتدائي لمشروع الممشى", PROJ, M],
    ["طلب كميات المواد لمشروع الأرصفة", PROJ, L],
    ["طلب تمديد مدة عقد المشروع", PROJ, M],
    ["صور الموقع لمشروع تطوير الواجهة", PROJ, L],
    ["طلب تعديل التصميم بعد ملاحظات الإدارة", PROJ, M],
    ["مخالفة المقاول لشروط السلامة في الموقع", PROJ, H],
    ["ضرورة إصدار أمر تغيير للمشروع", PROJ, M],
    ["طلب بيانات المشاريع المتعثرة", PROJ, M],
    ["مراجعة كراسة الشروط للمنافسة الجديدة", PROJ, M],
    ["طلب مساحة الأرض المخصصة للمشروع", PROJ, L],
    ["تأخر وصول المعدات إلى الموقع", PROJ, M],
    ["طلب محضر استلام نهائي للمشروع", PROJ, M],
    ["ملاحظات الاستشاري على تنفيذ الخرسانة", PROJ, H],
    ["طلب عرض أسعار لمشروع جديد", PROJ, L],
    ["تعثر مشروع الحديقة بسبب المقاول", PROJ, H],
    ["طلب مخطط الموقع العام", PROJ, L],
    ["متابعة أعمال الإنارة في الطريق الجديد", PROJ, M],
    ["طلب ترسية المنافسة على المقاول", PROJ, M],
    ["سقوط سياج موقع المشروع على الرصيف", PROJ, H],
    ["طلب تقرير الجودة لمواد البناء", PROJ, M],
    ["تحديث خطة المشاريع للسنة القادمة", PROJ, L],

    ["شكوى مستفيد من تأخر معاملته", BEN, M],
    ["جهاز تذاكر الانتظار في صالة المراجعين لا يعمل", BEN, H],
    ["ازدحام كبير في صالة المراجعين", BEN, H],
    ["شكوى من سوء التعامل في الاستقبال", BEN, M],
    ["طلب مستفيد معرفة حالة رخصة البناء", BEN, L],
    ["الكراسي غير كافية في صالة الانتظار", BEN, L],
    ["مستفيد من ذوي الإعاقة يحتاج مساعدة عند المدخل", BEN, H],
    ["شاشة عرض الأرقام في الصالة متوقفة", BEN, M],
    ["رقم خدمة العملاء لا يرد على المراجعين", BEN, H],
    ["طلب لوحات إرشادية للمراجعين", BEN, L],
    ["شكوى من طول مدة الانتظار", BEN, M],
    ["استفسار مراجع عن رسوم الخدمة", BEN, L],
    ["ملاحظة مستفيد على موقع البلدية الإلكتروني", BEN, L],
    ["مراجع غاضب في الاستقبال ويحتاج مسؤول", BEN, H],
    ["طلب استبيان رضا المراجعين", BEN, L],
    ["تعطل جهاز تقييم الخدمة في الصالة", BEN, L],
    ["شكوى بلاغ مستفيد على منصة بلدي لم يرد عليها", BEN, M],
    ["موعد مستفيد لم يتم الالتزام به", BEN, M],
    ["طلب ترجمة لمراجع لا يتحدث العربية", BEN, M],
    ["مقترح من مستفيد لتحسين الخدمة", BEN, L],
    ["توقف كاونتر الخدمة رقم ثلاثة عن استقبال المراجعين", BEN, H],
    ["شكوى من نظافة صالة المراجعين", BEN, M],
    ["طلب كتيب الخدمات للمراجعين", BEN, L],
    ["مستفيد يطلب مقابلة المدير", BEN, M],
    ["تأخر الرد على شكاوى المستفيدين", BEN, H],
    ["مراجع لم يستلم رخصته في الموعد", BEN, M],
    ["طلب كرسي متحرك لمراجع كبير في السن", BEN, H],
    ["شكوى من عدم وضوح الإجراءات للمراجعين", BEN, L],
    ["المراجعين يشتكون من حرارة صالة الانتظار", BEN, M],
    ["طلب موظف إضافي في الاستقبال وقت الذروة", BEN, M],
    ["مستفيد يسأل عن موعد زيارة المراقب", BEN, L],
    ["شكوى على تطبيق بلدي من مستفيد", BEN, M],
    ["مراجعة متكررة لمستفيد بدون حل", BEN, H],
    ["طلب تحديث بيانات مستفيد في الاستقبال", BEN, L],
    ["طابور طويل أمام نافذة الخدمة", BEN, H]
  ];

  /* ---------- 3) كشف البلاغات المتشابهة (TF-IDF + Cosine) ---------- */
  function tfidfVectors(docs) {
    const tokenized = docs.map(tokenize);
    const df = {};
    tokenized.forEach(toks => new Set(toks).forEach(t => (df[t] = (df[t] || 0) + 1)));
    const N = docs.length;
    return tokenized.map(toks => {
      const tf = {};
      toks.forEach(t => (tf[t] = (tf[t] || 0) + 1));
      const v = {};
      for (const t in tf) v[t] = (tf[t] / toks.length) * (Math.log((N + 1) / (df[t] + 1)) + 1);
      return v;
    });
  }
  function cosine(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (const t in a) { na += a[t] * a[t]; if (b[t]) dot += a[t] * b[t]; }
    for (const t in b) nb += b[t] * b[t];
    return na && nb ? dot / Math.sqrt(na * nb) : 0;
  }
  // يرجع البلاغات المفتوحة الأقرب للنص الجديد (أعلى من حد التشابه)
  function findSimilar(text, tickets, threshold = 0.35, limit = 3) {
    const open = tickets.filter(t => t.status !== "منجز");
    if (!open.length || !tokenize(text).length) return [];
    const vecs = tfidfVectors([text, ...open.map(t => t.title + " " + t.description)]);
    return open
      .map((t, i) => ({ ticket: t, score: cosine(vecs[0], vecs[i + 1]) }))
      .filter(x => x.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /* ---------- النموذج الذكي: يتدرب على الأمثلة + بلاغات المستخدم (يتعلم) ---------- */
  function buildModels(userTickets = []) {
    const base = TRAINING.map(([text, dept, pr]) => ({ text, dept, pr }));
    const learned = userTickets
      .filter(t => t.title)
      .map(t => ({ text: t.title + " " + (t.description || ""), dept: t.department, pr: t.priority }));
    const all = base.concat(learned);
    return {
      dept: new NaiveBayes(1, GENERIC).train(all.map(x => ({ text: x.text, label: x.dept }))),
      priority: new NaiveBayes().train(all.map(x => ({ text: x.text, label: x.pr }))),
      size: all.length,
      learned: learned.length
    };
  }

  // يرجّع الكلمة كما كتبها المستخدم بدل جذرها (للشرح)
  function surface(text, stems) {
    const words = String(text).split(/[\s،,.]+/).filter(Boolean);
    return stems.map(st => words.find(w => tokenize(w)[0] === st) || st);
  }
  // صياغة العدد بالعربي: بلاغ واحد، بلاغان، 3 بلاغات، 11 بلاغاً
  function count(n) {
    return n === 1 ? "بلاغ واحد" : n === 2 ? "بلاغان" : n <= 10 ? `${n} بلاغات` : `${n} بلاغاً`;
  }

  // اقتراح كامل: الجهة + الأولوية (تعلم آلي + قواعد الاستعجال) مع الأسباب
  function suggest(models, text) {
    const dept = models.dept.predict(text);
    const u = urgencyBoost(text);
    const priority = models.priority.predict(text, u.boost);
    if (priority && u.words.length) priority.reasons = [...new Set([...u.words, ...priority.reasons])].slice(0, 3);
    if (dept) dept.reasons = surface(text, dept.reasons);
    if (priority) priority.reasons = surface(text, priority.reasons);
    return { dept, priority };
  }

  /* ---------- 4) المساعد الذكي: ملاحظات وتوصيات تلقائية ---------- */
  const DAY = 86400000;
  function ageDays(t, now) { return Math.floor((now - new Date(t.createdAt).getTime()) / DAY); }

  function insights(tickets, now = Date.now()) {
    const out = [];
    if (!tickets.length) return [{ type: "info", text: "لا توجد بلاغات بعد. أضف أول بلاغ وسيبدأ المساعد بالتحليل." }];
    const open = tickets.filter(t => t.status !== "منجز");
    const done = tickets.filter(t => t.status === "منجز" && t.resolvedAt);

    // بلاغات عالية الأولوية متأخرة (أكثر من يومين)
    const lateHigh = open.filter(t => t.priority === "عالية" && ageDays(t, now) >= 2);
    if (lateHigh.length) out.push({ type: "danger", text: `يوجد ${count(lateHigh.length)} عالي الأولوية مفتوح منذ يومين أو أكثر. يُنصح بمعالجته فوراً.` });

    // بلاغات جديدة لم تبدأ معالجتها منذ 3 أيام
    const stale = open.filter(t => t.status === "جديد" && ageDays(t, now) >= 3);
    if (stale.length) out.push({ type: "warn", text: `${count(stale.length)} بحالة "جديد" منذ 3 أيام أو أكثر ولم تبدأ معالجته.` });

    // أكثر جهة عليها بلاغات مفتوحة
    const byDept = {};
    open.forEach(t => (byDept[t.department] = (byDept[t.department] || 0) + 1));
    const topDept = Object.entries(byDept).sort((a, b) => b[1] - a[1])[0];
    if (topDept && topDept[1] >= 2) out.push({ type: "info", text: `أكثر جهة عليها بلاغات مفتوحة: ${topDept[0]} (${count(topDept[1])}). قد تحتاج دعماً إضافياً.` });

    // كلمة متكررة تدل على مشكلة عامة
    const counts = {};
    open.forEach(t => new Set(tokenize(t.title)).forEach(w => (counts[w] = (counts[w] || 0) + 1)));
    const repeated = Object.entries(counts).filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1])[0];
    if (repeated) out.push({ type: "warn", text: `كلمة "${repeated[0]}" تكررت في ${repeated[1]} من البلاغات المفتوحة، وقد تدل على مشكلة عامة واحدة.` });

    // متوسط وقت الإنجاز
    if (done.length) {
      const avgH = done.reduce((a, t) => a + (new Date(t.resolvedAt) - new Date(t.createdAt)), 0) / done.length / 3600000;
      out.push({ type: "ok", text: `متوسط وقت إنجاز البلاغ: ${avgH < 48 ? Math.round(avgH) + " ساعة" : (avgH / 24).toFixed(1) + " يوم"} (${count(done.length)} منجزة).` });
    }

    // دقة اقتراحات الذكاء الاصطناعي في الاستخدام الفعلي (هل وافق المستخدم على الجهة المقترحة؟)
    const withAI = tickets.filter(t => t.ai && t.ai.dept);
    if (withAI.length) {
      const agree = withAI.filter(t => t.ai.dept === t.department).length;
      out.push({ type: "ai", text: `وافق المستخدمون على الجهة التي اقترحها الذكاء الاصطناعي في ${agree} من أصل ${withAI.length} من البلاغات (${Math.round((agree / withAI.length) * 100)}%).` });
    }

    // نسبة الإنجاز
    const rate = Math.round((tickets.filter(t => t.status === "منجز").length / tickets.length) * 100);
    out.push({ type: rate >= 50 ? "ok" : "info", text: `نسبة الإنجاز الحالية ${rate}%.` });
    return out;
  }

  const API = { normalize, tokenize, stem, NaiveBayes, TRAINING, GENERIC, urgencyBoost, suggest, buildModels, findSimilar, insights, cosine, tfidfVectors };
  if (typeof module !== "undefined" && module.exports) module.exports = API; // للاختبار في Node
  else global.SmartAI = API;
})(typeof window !== "undefined" ? window : globalThis);
