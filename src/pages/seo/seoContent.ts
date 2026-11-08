/**
 * Content for KSA SEO landing pages.
 * Targets keywords with measured low difficulty and real volume in the Semrush `sa` database.
 * Each entry maps to a public, indexable route.
 */

export type SeoPage = {
  slug: string;
  path: string;
  lang: "en" | "ar";
  dir: "ltr" | "rtl";
  /** ISO hreflang code (e.g. en, ar-SA) */
  hreflang: string;
  /** Slug of the mirror in the other language for hreflang alternate. */
  alternateSlug: string;
  title: string;
  description: string;
  heroEyebrow: string;
  heroHeadline: string;
  heroSub: string;
  primaryCta: string;
  secondaryCta: string;
  features: Array<{ title: string; body: string }>;
  proofTitle: string;
  proofPoints: string[];
  faq: Array<{ q: string; a: string }>;
};

export type HelpArticle = {
  slug: string;
  path: string;
  lang: "ar";
  dir: "rtl";
  title: string;
  description: string;
  heroEyebrow: string;
  heroHeadline: string;
  heroSub: string;
  sections: Array<{ title: string; body: string[] }>;
  faq: Array<{ q: string; a: string }>;
};

export const SEO_PAGES: SeoPage[] = [
  // ───────────────────────── ENGLISH ─────────────────────────
  {
    slug: "restaurant-pos",
    path: "/sa/restaurant-pos",
    lang: "en",
    dir: "ltr",
    hreflang: "en-SA",
    alternateSlug: "كاشير-مطاعم",
    title: "Restaurant POS in Saudi Arabia | ZATCA-ready | Matbex",
    description:
      "Cloud restaurant POS built for KSA. ZATCA Phase 2 e-invoicing, Arabic receipts, offline-first, kitchen display, and live COGS — from SAR 149 per branch.",
    heroEyebrow: "Restaurant POS · Saudi Arabia",
    heroHeadline: "The restaurant POS Saudi operators actually trust.",
    heroSub:
      "ZATCA Phase 2 compliant. Fully Arabic. Offline-first. Built on the same operating system that runs your accounting, payroll, and inventory.",
    primaryCta: "Start free",
    secondaryCta: "See pricing",
    features: [
      {
        title: "ZATCA Phase 2 — out of the box",
        body: "QR-coded simplified invoices, XML clearance, cryptographic stamps. No third-party plug-in.",
      },
      {
        title: "Bilingual receipts (AR/EN)",
        body: "Right-to-left layout, Arabic numerals, and bilingual line items printed on the same ticket.",
      },
      {
        title: "Offline-first",
        body: "Sells, prints, and queues invoices when the internet drops. Syncs and clears with ZATCA on reconnect.",
      },
      {
        title: "Kitchen & bar routing",
        body: "Send drinks to the bar, food to the kitchen. Configurable per menu item.",
      },
      {
        title: "Live COGS, not month-end guesses",
        body: "Recipes deplete inventory as you sell. Food cost % updates in real time on the dashboard.",
      },
      {
        title: "Hardware freedom",
        body: "Runs on any iPad, Android tablet, or Windows till. Works with thermal printers, cash drawers, and barcode scanners you already own.",
      },
    ],
    proofTitle: "Why KSA restaurants pick Matbex over Toast and Foodics",
    proofPoints: [
      "Toast does not operate in Saudi Arabia — Matbex is licensed locally.",
      "Cheaper than Foodics on the same feature surface, with deeper accounting.",
      "One platform for POS, COGS, payroll, and ZATCA — not four contracts.",
      "Riyal-first pricing, no FX surprises.",
    ],
    faq: [
      {
        q: "Is Matbex ZATCA Phase 2 compliant?",
        a: "Yes. Every invoice is cryptographically stamped, QR-coded, and cleared with ZATCA's Fatoora portal in real time.",
      },
      {
        q: "Does the POS work without internet?",
        a: "Yes. Matbex is offline-first: sales, prints, and ZATCA queue locally and sync automatically when you're back online.",
      },
      {
        q: "How much does the restaurant POS cost?",
        a: "Plans start at SAR 149 per branch per month (ZATCA included from SAR 349), with a 14-day free trial — no per-transaction percentage.",
      },
      {
        q: "Do I need new hardware?",
        a: "No. Matbex runs on any modern iPad, Android tablet, or Windows touchscreen, with thermal printers and cash drawers you likely already own.",
      },
    ],
  },
  {
    slug: "zatca-e-invoicing",
    path: "/sa/zatca-e-invoicing",
    lang: "en",
    dir: "ltr",
    hreflang: "en-SA",
    alternateSlug: "zatca",
    title: "ZATCA E-Invoicing for Restaurants | Phase 2 Ready | Matbex",
    description:
      "Phase 2 ZATCA e-invoicing built into the POS. Cryptographic stamps, QR codes, XML clearance, and audit-ready archive. No bolt-on integrator.",
    heroEyebrow: "ZATCA E-Invoicing · Phase 2",
    heroHeadline: "ZATCA Phase 2 e-invoicing — done at the till.",
    heroSub:
      "Cryptographic stamping, QR codes, and real-time clearance with ZATCA's Fatoora portal — for every receipt, automatically. Zero plug-ins.",
    primaryCta: "Start free",
    secondaryCta: "Talk to compliance",
    features: [
      {
        title: "Real-time clearance",
        body: "Every simplified invoice clears with ZATCA's Fatoora portal before the customer leaves the table.",
      },
      {
        title: "Cryptographic stamp",
        body: "ECDSA signing keys managed for you. Stamps stored immutably for audit.",
      },
      {
        title: "TLV-encoded QR",
        body: "Standards-compliant TLV payload on every printed and digital receipt.",
      },
      {
        title: "Audit-ready archive",
        body: "Seven-year retention with searchable filters by date, table, cashier, and amount.",
      },
      {
        title: "Auto-fallback queue",
        body: "If ZATCA is briefly unreachable, invoices queue locally and clear automatically when service returns.",
      },
      {
        title: "Verifiable receipts",
        body: "Every QR resolves to a public verification page so customers can confirm the invoice is genuine.",
      },
    ],
    proofTitle: "What ZATCA Phase 2 actually requires (and how Matbex covers it)",
    proofPoints: [
      "Integration with ZATCA's Fatoora portal — built-in, not bolted on.",
      "Cryptographic stamping with managed keys — no IT setup.",
      "Standards-compliant XML and TLV QR — validated against ZATCA's schema.",
      "Storage and retention for 7 years — included, no extra storage fees.",
    ],
    faq: [
      {
        q: "Do I need a separate ZATCA integrator?",
        a: "No. Matbex is a full ZATCA Phase 2 solution. Clearance, stamping, QR, and archival are all included.",
      },
      {
        q: "What happens if ZATCA's portal is down?",
        a: "Invoices are stamped locally and queued. When the portal returns, they clear automatically in order with no manual work.",
      },
      {
        q: "Does Matbex support B2B tax invoices?",
        a: "Yes. Both simplified (B2C) and tax (B2B) invoices follow Phase 2 specs.",
      },
      {
        q: "Can I verify a printed receipt later?",
        a: "Yes. Every QR resolves to a public verification page hosted on matbex.com that shows invoice details.",
      },
    ],
  },
  {
    slug: "kitchen-display-system",
    path: "/sa/kitchen-display-system",
    lang: "en",
    dir: "ltr",
    hreflang: "en-SA",
    alternateSlug: "kds",
    title: "Kitchen Display System (KDS) for KSA Restaurants | Matbex",
    description:
      "Replace printer chits with a real kitchen display. Route by station, track prep times, and cut order errors. Works on any tablet.",
    heroEyebrow: "Kitchen Display System",
    heroHeadline: "Stop losing tickets. Run the kitchen on a screen.",
    heroSub:
      "Multi-station routing, color-coded timers, recall, and bump-bar support. Orders flow from POS to chef without paper.",
    primaryCta: "Start free",
    secondaryCta: "See it in action",
    features: [
      {
        title: "Station routing",
        body: "Hot line, cold line, bar, dessert — each station sees only what it needs to cook.",
      },
      {
        title: "Color-coded timers",
        body: "Green → amber → red as tickets age. SLA breaches surface instantly.",
      },
      {
        title: "Recall & re-fire",
        body: "Bring back the last 50 bumped tickets with one tap. Re-fire missed sides without re-keying.",
      },
      {
        title: "Course pacing",
        body: "Hold starters until mains are ready. Bump together for synchronized service.",
      },
      {
        title: "Bump-bar ready",
        body: "Standard USB bump bars supported. Or use any touchscreen tablet.",
      },
      {
        title: "Prep-time analytics",
        body: "Average and 95th-percentile prep time per item, station, and shift — feeding the daily report.",
      },
    ],
    proofTitle: "Why a KDS beats printer chits",
    proofPoints: [
      "No lost or smudged tickets at peak service.",
      "Real prep-time data feeds menu engineering and labor scheduling.",
      "Quieter kitchen — no continuous printer chatter.",
      "Recall and re-fire prevent comps and remakes.",
    ],
    faq: [
      {
        q: "What hardware do I need for the KDS?",
        a: "Any tablet or all-in-one touchscreen with a modern browser. Optional USB bump bars are supported.",
      },
      {
        q: "Can I still print to the kitchen as a backup?",
        a: "Yes. Matbex can mirror tickets to a kitchen printer as a fallback while the team adopts the screen.",
      },
      {
        q: "Does it support multiple stations?",
        a: "Yes — unlimited stations. Each menu item is routed by station tag, so the bar only sees drinks and the hot line only sees food.",
      },
    ],
  },
  {
    slug: "foodics-alternative",
    path: "/sa/foodics-alternative",
    lang: "en",
    dir: "ltr",
    hreflang: "en-SA",
    alternateSlug: "بديل-فودكس",
    title: "Best Foodics Alternative in Saudi Arabia | Matbex",
    description:
      "Looking for a Foodics alternative in Saudi Arabia? Compare Matbex on ZATCA, accounting depth, hardware flexibility, and Riyal-first pricing.",
    heroEyebrow: "Comparison · Saudi Arabia",
    heroHeadline: "A Foodics alternative built for operators who want deeper control.",
    heroSub:
      "Matbex gives Saudi restaurants POS, ZATCA, inventory, payroll, and accounting in one operating system — without stitching together extra tools.",
    primaryCta: "Start free",
    secondaryCta: "Compare pricing",
    features: [
      { title: "Built-in accounting", body: "Matbex posts operational activity into the ledger automatically, so finance is not an afterthought." },
      { title: "Live COGS", body: "Recipes reduce inventory as you sell, so food cost moves with service instead of waiting for month-end." },
      { title: "ZATCA-native", body: "Phase 2 invoicing, QR, clearance, and receipt verification are all part of the core product." },
      { title: "Open hardware choice", body: "Use iPad, Android tablets, or Windows tills with the printers and cash drawers you already own." },
      { title: "Riyal-first pricing", body: "Pricing is designed for Saudi operators with clear local billing and fewer surprise add-ons." },
      { title: "Role-based operations", body: "Owners, managers, cashiers, and accountants each see the right workflows for their role." },
    ],
    proofTitle: "Where Matbex wins for Saudi restaurants evaluating Foodics",
    proofPoints: [
      "Deeper finance and cost control for operators who want profit visibility, not just POS reporting.",
      "One stack for POS, inventory, payroll, reporting, and ZATCA.",
      "Cleaner fit for multi-branch restaurants that want operational and financial data together.",
      "Designed around Arabic/English workflows and Riyal-denominated operations.",
    ],
    faq: [
      { q: "Is Matbex a direct Foodics alternative?", a: "Yes. Matbex covers POS, ZATCA, kitchen operations, inventory, and reporting, with stronger accounting depth for operators who need tighter control." },
      { q: "Can I migrate from another POS?", a: "Yes. Menu, users, and core setup can be recreated during onboarding so branches can switch with minimal disruption." },
      { q: "Is Matbex better for finance teams?", a: "Yes. Finance and operations live in the same system, so teams do not have to reconcile multiple disconnected tools." },
    ],
  },
  // ───────────────────────── ARABIC ─────────────────────────
  {
    slug: "كاشير-مطاعم",
    path: "/ar/كاشير-مطاعم",
    lang: "ar",
    dir: "rtl",
    hreflang: "ar-SA",
    alternateSlug: "restaurant-pos",
    title: "كاشير مطاعم سحابي | متوافق مع زاتكا | Matbex",
    description:
      "نظام كاشير مطاعم متكامل في السعودية. متوافق مع زاتكا المرحلة الثانية، فواتير بالعربي، يعمل بدون إنترنت، وشاشة مطبخ ذكية.",
    heroEyebrow: "كاشير مطاعم · المملكة العربية السعودية",
    heroHeadline: "نظام الكاشير الذي تثق به مطاعم السعودية.",
    heroSub:
      "متوافق مع زاتكا المرحلة الثانية. واجهة عربية كاملة. يعمل بدون إنترنت. كل ذلك مع المحاسبة والرواتب والمخزون في منصة واحدة.",
    primaryCta: "ابدأ مجاناً",
    secondaryCta: "عرض الأسعار",
    features: [
      {
        title: "زاتكا المرحلة الثانية — جاهزة",
        body: "فواتير مبسطة برمز QR، إرسال XML، ختم تشفيري. بدون أي إضافات خارجية.",
      },
      {
        title: "فواتير ثنائية اللغة",
        body: "تنسيق من اليمين لليسار، أرقام عربية، وأصناف بالعربي والإنجليزي على نفس الفاتورة.",
      },
      {
        title: "يعمل بدون إنترنت",
        body: "يبيع ويطبع ويحفظ الفواتير عند انقطاع الإنترنت، ويزامنها مع زاتكا تلقائياً عند العودة.",
      },
      {
        title: "توجيه المطبخ والبار",
        body: "أرسل المشروبات للبار والطعام للمطبخ. قابل للتخصيص لكل صنف.",
      },
      {
        title: "تكلفة البضاعة لحظياً",
        body: "الوصفات تنقص المخزون مع كل بيع. نسبة تكلفة الطعام تظهر مباشرة في لوحة التحكم.",
      },
      {
        title: "بدون قيود على الأجهزة",
        body: "يعمل على أي آيباد أو تابلت أندرويد أو شاشة ويندوز. يدعم الطابعات الحرارية والأدراج وقارئات الباركود التي تملكها.",
      },
    ],
    proofTitle: "لماذا تختار المطاعم السعودية Matbex بدل توست وفودكس",
    proofPoints: [
      "توست لا يعمل في السعودية — Matbex مرخص محلياً.",
      "أرخص من فودكس لنفس المزايا، مع محاسبة أعمق.",
      "منصة واحدة: كاشير، تكلفة، رواتب، وزاتكا — بدل أربعة عقود.",
      "أسعار بالريال السعودي، بدون مفاجآت صرف عملات.",
    ],
    faq: [
      {
        q: "هل النظام متوافق مع زاتكا المرحلة الثانية؟",
        a: "نعم. كل فاتورة مختومة تشفيرياً وبرمز QR وتُرسل لمنصة فاتورة الخاصة بزاتكا فوراً.",
      },
      {
        q: "هل يعمل بدون إنترنت؟",
        a: "نعم. النظام يعمل أوفلاين أولاً: المبيعات والطباعة وزاتكا تُحفظ محلياً وتُزامن تلقائياً عند العودة للإنترنت.",
      },
      {
        q: "كم سعر نظام الكاشير؟",
        a: "الباقات تبدأ من 149 ريال للفرع شهرياً (زاتكا مشمولة من 349 ريال) مع تجربة مجانية 14 يوماً — بدون عمولة على المعاملات.",
      },
      {
        q: "هل أحتاج أجهزة جديدة؟",
        a: "لا. يعمل على أي آيباد أو تابلت أندرويد أو شاشة ويندوز حديثة، مع الطابعات والأدراج التي تملكها.",
      },
    ],
  },
  {
    slug: "نقاط-البيع",
    path: "/ar/نقاط-البيع",
    lang: "ar",
    dir: "rtl",
    hreflang: "ar-SA",
    alternateSlug: "restaurant-pos",
    title: "نقاط البيع للمطاعم في السعودية | Matbex",
    description:
      "نظام نقاط بيع سحابي للمطاعم في السعودية. متوافق مع زاتكا، عربي بالكامل، يعمل أوفلاين، ومحاسبة متكاملة.",
    heroEyebrow: "نقاط البيع · المملكة العربية السعودية",
    heroHeadline: "نقاط بيع مطاعم بمعايير عالمية وسعر سعودي.",
    heroSub:
      "نظام POS كامل، متوافق مع زاتكا، يربط البيع بالمخزون والمحاسبة لحظياً. صُمم لمطاعم المملكة.",
    primaryCta: "ابدأ مجاناً",
    secondaryCta: "احجز عرض تجريبي",
    features: [
      {
        title: "زاتكا في كل فاتورة",
        body: "ختم تشفيري ورمز QR وإرسال XML تلقائي لكل عملية بيع.",
      },
      {
        title: "متعدد الفروع",
        body: "أدِر فروعك من لوحة واحدة. التقارير والمخزون والموظفون موحدون.",
      },
      {
        title: "متعدد العملات والضرائب",
        body: "الريال افتراضياً، مع دعم العملات الأخرى. ضريبة القيمة المضافة محسوبة تلقائياً.",
      },
      {
        title: "تكامل مع المحاسبة",
        body: "كل بيع يدخل دفتر الأستاذ تلقائياً. لا حاجة لتصدير CSV أو إعادة إدخال.",
      },
      {
        title: "مراقبة الورديات",
        body: "بدء وإغلاق الورديات مع تسوية الكاش وتحليل الفروقات تلقائياً.",
      },
      {
        title: "تطبيق جوال",
        body: "النادل يأخذ الطلب على التابلت ويرسله للمطبخ مباشرة. لا أوراق ولا أخطاء.",
      },
    ],
    proofTitle: "نقاط البيع التي تنمو مع مطعمك",
    proofPoints: [
      "من فرع واحد إلى سلسلة كاملة بنفس النظام.",
      "صفر رسوم نسبة على المبيعات.",
      "بيانات مستضافة في منطقة سحابية متوافقة مع متطلبات الإقامة.",
      "دعم فني باللغة العربية على مدار الساعة.",
    ],
    faq: [
      {
        q: "هل يدعم النظام عدة فروع؟",
        a: "نعم. تدير جميع فروعك من حساب واحد، مع تقارير موحدة وصلاحيات لكل فرع.",
      },
      {
        q: "هل البيانات تُخزن داخل السعودية؟",
        a: "نعم. تستضاف البيانات في منطقة سحابية تلبي متطلبات الإقامة الرقمية في المملكة.",
      },
      {
        q: "هل يمكن تجربة النظام مجاناً؟",
        a: "نعم. توجد خطة مجانية بدون بطاقة ائتمان، مع جميع المزايا الأساسية.",
      },
    ],
  },
  {
    slug: "zatca",
    path: "/ar/zatca",
    lang: "ar",
    dir: "rtl",
    hreflang: "ar-SA",
    alternateSlug: "zatca-e-invoicing",
    title: "الفوترة الإلكترونية زاتكا للمطاعم | المرحلة الثانية | Matbex",
    description:
      "حل فوترة إلكترونية متوافق مع زاتكا المرحلة الثانية للمطاعم. ختم تشفيري، رموز QR، إرسال XML، وأرشيف جاهز للتدقيق.",
    heroEyebrow: "زاتكا · المرحلة الثانية",
    heroHeadline: "فوترة زاتكا المرحلة الثانية — تتم عند الكاشير.",
    heroSub:
      "ختم تشفيري ورمز QR وإرسال فوري لمنصة فاتورة، لكل عملية بيع. بدون إضافات أو وسطاء.",
    primaryCta: "ابدأ مجاناً",
    secondaryCta: "تحدث مع متخصص",
    features: [
      {
        title: "إرسال فوري لفاتورة",
        body: "كل فاتورة مبسطة تُرسل لمنصة فاتورة قبل أن يغادر العميل الطاولة.",
      },
      {
        title: "ختم تشفيري",
        body: "مفاتيح ECDSA تُدار نيابة عنك. الأختام محفوظة بشكل غير قابل للتعديل.",
      },
      {
        title: "رمز QR بصيغة TLV",
        body: "حمولة TLV مطابقة للمعايير على كل فاتورة مطبوعة أو رقمية.",
      },
      {
        title: "أرشيف جاهز للتدقيق",
        body: "حفظ لمدة 7 سنوات مع بحث بالتاريخ والطاولة والكاشير والمبلغ.",
      },
      {
        title: "طابور احتياطي تلقائي",
        body: "إذا تعذّر الوصول لزاتكا، تُحفظ الفواتير محلياً وتُرسل تلقائياً عند عودة الخدمة.",
      },
      {
        title: "فواتير قابلة للتحقق",
        body: "كل رمز QR يفتح صفحة تحقق عامة يستطيع العميل من خلالها التأكد من صحة الفاتورة.",
      },
    ],
    proofTitle: "ماذا تتطلب زاتكا المرحلة الثانية فعلاً (وكيف يغطيها Matbex)",
    proofPoints: [
      "تكامل مع منصة فاتورة — مدمج، ليس إضافة.",
      "ختم تشفيري بمفاتيح مُدارة — بدون إعداد تقني.",
      "XML ورمز TLV متوافقان مع مخطط زاتكا — مُختبران.",
      "تخزين 7 سنوات — مشمول، بدون رسوم إضافية.",
    ],
    faq: [
      {
        q: "هل أحتاج لمزود زاتكا منفصل؟",
        a: "لا. Matbex حل زاتكا كامل للمرحلة الثانية. الإرسال والختم وQR والأرشفة كلها مشمولة.",
      },
      {
        q: "ماذا يحدث إذا توقفت منصة زاتكا؟",
        a: "تُختم الفواتير محلياً وتُحفظ في طابور. عند عودة المنصة، تُرسل تلقائياً بالترتيب بدون أي تدخل.",
      },
      {
        q: "هل يدعم النظام الفواتير الضريبية B2B؟",
        a: "نعم. الفواتير المبسطة (B2C) والضريبية (B2B) كلتاهما متوافقتان مع المرحلة الثانية.",
      },
    ],
  },
  {
    slug: "بديل-فودكس",
    path: "/ar/بديل-فودكس",
    lang: "ar",
    dir: "rtl",
    hreflang: "ar-SA",
    alternateSlug: "foodics-alternative",
    title: "بديل فودكس للمطاعم في السعودية | Matbex",
    description:
      "تبحث عن بديل فودكس؟ قارن Matbex من حيث زاتكا، المحاسبة، إدارة المخزون، مرونة الأجهزة، والتسعير بالريال السعودي.",
    heroEyebrow: "مقارنة · السعودية",
    heroHeadline: "بديل فودكس للمطاعم التي تريد تحكماً أعمق في التشغيل والربحية.",
    heroSub:
      "يجمع Matbex بين الكاشير، زاتكا، المخزون، الرواتب، والمحاسبة في منصة واحدة بدل الاعتماد على أدوات متفرقة.",
    primaryCta: "ابدأ مجاناً",
    secondaryCta: "قارن الأسعار",
    features: [
      { title: "محاسبة مدمجة", body: "كل العمليات اليومية تنعكس مباشرة على الدفاتر، بدون تصدير يدوي أو حلول منفصلة." },
      { title: "تكلفة بضاعة لحظية", body: "الوصفات تخصم المخزون مع البيع، فتظهر نسب تكلفة الطعام بشكل حي." },
      { title: "زاتكا ضمن الأساس", body: "المرحلة الثانية، QR، الإرسال، والتحقق العام كلها ضمن المنتج نفسه." },
      { title: "مرونة في الأجهزة", body: "يعمل على آيباد وأندرويد وويندوز مع أغلب الطابعات والأدراج الشائعة." },
      { title: "تسعير سعودي أوضح", body: "هيكل تسعير مناسب للسوق السعودي وبالريال مع إضافات أقل." },
      { title: "صلاحيات تشغيل دقيقة", body: "المالك والمدير والكاشير والمحاسب يحصل كل منهم على واجهته المناسبة." },
    ],
    proofTitle: "متى يكون Matbex خياراً أقوى من فودكس؟",
    proofPoints: [
      "عندما تحتاج ربطاً أقوى بين التشغيل والمحاسبة والربحية.",
      "عندما تريد منصة واحدة بدلاً من تجميع عدة أدوات معاً.",
      "عندما تحتاج رؤية حيّة لتكلفة الطعام والمخزون والفروع.",
      "عندما يكون السوق السعودي واحتياجات زاتكا والعربية أولوية رئيسية.",
    ],
    faq: [
      { q: "هل Matbex بديل مباشر لفودكس؟", a: "نعم. يغطي Matbex الكاشير وزاتكا والمطبخ والمخزون والتقارير، مع عمق أكبر في الجانب المالي والتشغيلي." },
      { q: "هل أستطيع الانتقال من نظام آخر؟", a: "نعم. يمكن إعداد القوائم والمستخدمين والبنية التشغيلية الأساسية أثناء التهيئة الأولية." },
      { q: "هل يفيد فرق المالية أكثر؟", a: "نعم. لأن البيانات التشغيلية والمالية موجودة في نفس المنصة، تقل الحاجة للمطابقة اليدوية بين الأنظمة." },
    ],
  },
  {
    slug: "zatca-phase-2-guide",
    path: "/sa/zatca-phase-2-guide",
    lang: "ar",
    dir: "rtl",
    hreflang: "ar-SA",
    alternateSlug: "zatca-e-invoicing",
    title: "دليل زاتكا المرحلة الثانية للمطاعم في السعودية | Matbex",
    description:
      "دليل عملي لفهم متطلبات زاتكا المرحلة الثانية للمطاعم: الفاتورة المبسطة، QR، الختم التشفيري، الإرسال، والأرشفة.",
    heroEyebrow: "دليل عملي · زاتكا المرحلة الثانية",
    heroHeadline: "دليل زاتكا المرحلة الثانية للمطاعم — بدون تعقيد تقني.",
    heroSub:
      "إذا كنت تدير مطعماً في السعودية، فهذا الدليل يشرح ما الذي تطلبه زاتكا فعلاً، وما الذي يجب أن يكون موجوداً في نظام الكاشير قبل الاعتماد النهائي.",
    primaryCta: "ابدأ مجاناً",
    secondaryCta: "تحدث مع متخصص",
    features: [
      { title: "ما هي الفاتورة المبسطة؟", body: "الفاتورة المبسطة هي فاتورة B2C التي يجب أن تحمل حقولاً واضحة ورمز QR مطابقاً لمواصفات زاتكا." },
      { title: "الختم التشفيري", body: "كل فاتورة تحتاج توقيعاً تشفيرياً يثبت سلامة البيانات وعدم التلاعب بها بعد إصدارها." },
      { title: "الإرسال والربط", body: "يجب أن يكون النظام قادراً على إنشاء التنسيق المطلوب وإرساله أو مزامنته حسب سيناريو الفاتورة." },
      { title: "رمز QR", body: "رمز QR ليس مجرد صورة على الإيصال؛ يجب أن يحتوي البيانات الإلزامية بصيغة TLV الصحيحة." },
      { title: "الأرشفة والرجوع", body: "الاحتفاظ بالفواتير وسجلها جزء أساسي من الجاهزية للتدقيق والمراجعة." },
      { title: "العمل عند انقطاع الإنترنت", body: "أفضل الأنظمة تحفظ الفواتير محلياً وتُكمل المزامنة تلقائياً عند عودة الاتصال." },
    ],
    proofTitle: "ما الذي يجب أن تتحقق منه قبل اختيار نظام زاتكا؟",
    proofPoints: [
      "هل زاتكا مدمجة فعلاً داخل النظام أم تعتمد على طرف ثالث؟",
      "هل رمز QR والختم التشفيري يصدران تلقائياً مع كل فاتورة؟",
      "هل يمكن البحث في الفواتير واسترجاعها بسهولة عند المراجعة؟",
      "هل يواصل المطعم العمل عند ضعف الإنترنت أو انقطاعه؟",
    ],
    faq: [
      { q: "هل كل نظام POS جاهز للمرحلة الثانية؟", a: "لا. بعض الأنظمة تحتاج إضافات أو تكاملات خارجية، لذلك يجب التأكد من الجاهزية الفعلية قبل التعاقد." },
      { q: "هل يكفي وجود QR فقط؟", a: "لا. الامتثال يشمل عناصر أخرى مثل الختم التشفيري، بنية البيانات، وحفظ السجلات بالشكل الصحيح." },
      { q: "لماذا هذا الموضوع مهم للمطاعم؟", a: "لأن المطاعم تصدر عدداً كبيراً من الفواتير يومياً، وأي خلل في الامتثال يؤثر مباشرة على التشغيل والالتزام النظامي." },
    ],
  },
  {
    slug: "بديل-ريوا",
    path: "/ar/بديل-ريوا",
    lang: "ar",
    dir: "rtl",
    hreflang: "ar-SA",
    alternateSlug: "foodics-alternative",
    title: "بديل ريوا (Rewaa) للمطاعم في السعودية | Matbex",
    description:
      "تبحث عن بديل ريوا لإدارة المطعم؟ قارن Matbex من حيث زاتكا، تكلفة البضاعة اللحظية، إدارة الفروع، المحاسبة المدمجة، والتسعير بالريال.",
    heroEyebrow: "مقارنة · السعودية",
    heroHeadline: "بديل ريوا مصمم خصيصاً للمطاعم — لا للتجزئة العامة.",
    heroSub:
      "ريوا منصة قوية لتجار التجزئة، لكن المطاعم تحتاج وصفات وتكلفة طعام وشاشة مطبخ وورديات كاش. Matbex بُني لهذه الاحتياجات منذ اليوم الأول.",
    primaryCta: "ابدأ مجاناً",
    secondaryCta: "قارن الأسعار",
    features: [
      { title: "مصمم للمطاعم", body: "وصفات، تكلفة الطبق، شاشة مطبخ، ورديات نادل، وتوجيه الطلبات للمحطات — كلها جزء من النواة وليست إضافات." },
      { title: "تكلفة بضاعة لحظية", body: "كل بيع يخصم المكونات من المخزون فوراً، فترى نسبة تكلفة الطعام (Food Cost %) لحظياً بدل انتظار نهاية الشهر." },
      { title: "زاتكا المرحلة الثانية مدمجة", body: "ختم تشفيري، QR، وإرسال XML تلقائي لمنصة فاتورة — بدون وسيط أو إضافات خارجية." },
      { title: "محاسبة كاملة، لا تقارير فقط", body: "دفتر أستاذ مزدوج القيد، حسابات الموردين، الذمم، والقوائم المالية تُنشأ تلقائياً من العمليات اليومية." },
      { title: "إدارة فروع موحدة", body: "تقارير مجمّعة، نقل مخزون بين الفروع، وأسعار خاصة بكل فرع من لوحة واحدة." },
      { title: "تسعير بالريال أوضح", body: "اشتراك ثابت بالريال، بدون رسوم على المعاملات، وبدون ربط إجباري بأجهزة معينة." },
    ],
    proofTitle: "متى يكون Matbex خياراً أقوى من ريوا للمطاعم؟",
    proofPoints: [
      "عندما تحتاج تكلفة الطبق ونسبة الفاقد ومحرّك الوصفات، لا مجرد جرد منتجات.",
      "عندما تريد شاشة مطبخ حقيقية وتوجيهاً للمحطات بدل طابعات منفصلة.",
      "عندما تحتاج محاسبة متكاملة (P&L، موردين، أرصدة) بدل تقارير مبيعات فقط.",
      "عندما تدير عدة فروع وتحتاج صلاحيات دقيقة لكل دور (مالك، مدير، كاشير، محاسب).",
    ],
    faq: [
      { q: "هل ريوا مناسبة للمطاعم؟", a: "ريوا قوية في التجزئة والمتاجر، لكنها لم تُبنَ أصلاً للمطاعم. Matbex مصمم للمطاعم منذ البداية: وصفات، تكلفة طعام، شاشة مطبخ، وورديات." },
      { q: "هل أستطيع الانتقال من ريوا إلى Matbex؟", a: "نعم. يمكن استيراد المنتجات والقوائم والموظفين أثناء التهيئة، مع دعم فني مباشر لتقليل التعطيل." },
      { q: "هل Matbex متوافق مع زاتكا مثل ريوا؟", a: "نعم، ومتوافق تماماً مع المرحلة الثانية، مع إرسال فوري وأرشيف 7 سنوات وتحقق علني من الفواتير." },
      { q: "ما الفرق الأساسي بين Matbex وريوا؟", a: "ريوا منصة بيع وتجزئة عامة. Matbex منصة تشغيل مطاعم متكاملة تشمل المحاسبة والمخزون والمطبخ والكاشير في نظام واحد." },
    ],
  },
  {
    slug: "بديل-مرن",
    path: "/ar/بديل-مرن",
    lang: "ar",
    dir: "rtl",
    hreflang: "ar-SA",
    alternateSlug: "foodics-alternative",
    title: "بديل مرن (Marn) للمطاعم في السعودية | Matbex",
    description:
      "تبحث عن بديل مرن لنظام الكاشير؟ قارن Matbex من حيث المحاسبة المدمجة، إدارة المخزون والوصفات، زاتكا المرحلة الثانية، ومرونة الأجهزة.",
    heroEyebrow: "مقارنة · السعودية",
    heroHeadline: "بديل مرن لمطاعم تريد أكثر من مجرد نقطة بيع.",
    heroSub:
      "مرن نظام كاشير جيد، لكن المطاعم الجادة تحتاج محاسبة ومخزوناً ورواتب وزاتكا في نفس المنصة. Matbex يجمعها كلها بدل توزيعها على أنظمة منفصلة.",
    primaryCta: "ابدأ مجاناً",
    secondaryCta: "قارن الأسعار",
    features: [
      { title: "نظام تشغيل كامل، لا كاشير فقط", body: "POS، KDS، مخزون، رواتب، محاسبة، وتقارير مالية — كلها في منصة واحدة بنفس الاشتراك." },
      { title: "محاسبة بمعايير دولية", body: "قيود مزدوجة، شجرة حسابات سعودية، قائمة دخل وميزانية عمومية تتولد تلقائياً من البيع والشراء." },
      { title: "إدارة مخزون بالوصفات", body: "اربط كل صنف في القائمة بمكوناته. النظام يحسب التكلفة، يخصم المخزون، ويُنبّه عند انخفاض الكميات." },
      { title: "زاتكا المرحلة الثانية ضمن السعر", body: "ختم تشفيري، QR، إرسال XML، وأرشفة 7 سنوات — بدون رسوم إضافية أو وسيط معتمد." },
      { title: "مرونة كاملة في الأجهزة", body: "آيباد، تابلت أندرويد، أو ويندوز — مع الطابعات والأدراج وقارئات الباركود التي تملكها." },
      { title: "ورديات وكاش بشكل صحيح", body: "فتح وإغلاق وردية، تسوية كاش، تحليل الفروقات، وتقرير يومي للملاك على البريد." },
    ],
    proofTitle: "متى تختار Matbex بدل مرن؟",
    proofPoints: [
      "عندما تريد تقريراً يومياً عن الربح الصافي وليس فقط إجمالي المبيعات.",
      "عندما تحتاج إدارة موردين وفواتير شراء ودفتر أستاذ كامل.",
      "عندما تدير مطبخاً معقداً يحتاج شاشة KDS وتوجيهاً للمحطات.",
      "عندما تريد رؤية تكلفة الطعام لحظياً بدلاً من حسابها يدوياً نهاية الشهر.",
    ],
    faq: [
      { q: "ما الفرق الجوهري بين Matbex ومرن؟", a: "مرن يركّز على نقطة البيع. Matbex منصة تشغيل مطاعم كاملة تشمل المحاسبة والمخزون والرواتب والتقارير المالية، إضافة للكاشير." },
      { q: "هل التحوّل من مرن سهل؟", a: "نعم. فريق Matbex يساعدك في نقل القوائم والمنتجات والمستخدمين أثناء فترة التهيئة، مع تشغيل تجريبي قبل الإطلاق الفعلي." },
      { q: "هل أحتاج لمحاسب خارجي مع Matbex؟", a: "Matbex يولّد القوائم المالية الأساسية تلقائياً، لكنه يبقى أداة بيد فريقك المالي أو محاسبك الخارجي لإدارة الإقرارات والمراجعة." },
      { q: "هل الأسعار أعلى من مرن؟", a: "Matbex يقدم خطة مجانية، وخطط مدفوعة بأسعار تنافسية بالريال — مع شمول ميزات تحتاج بدائلها اشتراكات إضافية في أنظمة أخرى." },
    ],
  },
  // ───────── Sapaad-gap feature pages — ENGLISH ─────────
  {
    slug: "qr-ordering",
    path: "/sa/qr-ordering",
    lang: "en",
    dir: "ltr",
    hreflang: "en-SA",
    alternateSlug: "ar-qr-ordering",
    title: "QR Code Ordering & Payment for Restaurants in Saudi Arabia | Matbex",
    description:
      "Let guests scan, order, and pay from their phone. ZATCA-compliant receipts, Arabic-first menu, and direct push to your kitchen — no third-party fees.",
    heroEyebrow: "QR Ordering · Saudi Arabia",
    heroHeadline: "Guests scan, order, and pay — your kitchen just cooks.",
    heroSub:
      "A QR ordering flow built into the same platform as your POS, KDS, and accounting. No separate vendor, no per-order cut, no extra reconciliation.",
    primaryCta: "Start free",
    secondaryCta: "See it on a table",
    features: [
      { title: "Scan to order", body: "Table-bound QR opens an Arabic/English menu instantly — no app install." },
      { title: "Pay at the table", body: "Card, Apple Pay, mada, or cash on collection. ZATCA-compliant receipt every time." },
      { title: "Direct to kitchen", body: "Orders land on your Kitchen Display System the moment the guest confirms — no waiter relay." },
      { title: "Live menu sync", body: "86'd items disappear in real time so guests never order what you can't serve." },
      { title: "Bilingual by default", body: "Full Arabic RTL and English LTR menus from the same item record." },
      { title: "No aggregator fees", body: "Your guests order direct, so you keep the full ticket — not 70% of it." },
    ],
    proofTitle: "Why operators move dine-in to QR ordering",
    proofPoints: [
      "Faster table turn — guests don't wait to flag a server.",
      "Higher average ticket — upsells and modifiers shown on every item.",
      "Lower labour cost per cover — one server can cover more tables.",
      "Cleaner cash control — every order is logged before it hits the kitchen.",
    ],
    faq: [
      { q: "Do guests need to install an app?", a: "No. The menu opens in the phone browser the moment they scan." },
      { q: "Is the receipt ZATCA-compliant?", a: "Yes. Every QR order produces the same Phase 2-compliant simplified invoice as a counter sale." },
      { q: "Can the kitchen still confirm before the guest pays?", a: "Yes — you choose: pay-first, pay-after, or staff-confirms-then-fire." },
    ],
  },
  {
    slug: "restaurant-inventory-management-software",
    path: "/sa/restaurant-inventory-management-software",
    lang: "en",
    dir: "ltr",
    hreflang: "en-SA",
    alternateSlug: "",
    title: "Restaurant Inventory Management Software in Saudi Arabia | Matbex",
    description:
      "Stop losing margin to waste and theft. Recipe-level stock control, live food cost %, supplier invoices, and variance reports built for Saudi restaurant owners.",
    heroEyebrow: "Inventory Management · Saudi Arabia",
    heroHeadline: "Know your true food cost before the month ends.",
    heroSub:
      "Matbex depletes stock recipe by recipe as you sell, prices every purchase invoice into COGS, and shows the exact riyals lost to waste, over-portioning, and theft — per branch, per day.",
    primaryCta: "Start free",
    secondaryCta: "See a food cost report",
    features: [
      {
        title: "Live food cost %, not month-end guesses",
        body: "Every sale deducts its recipe ingredients instantly, so your food cost percentage is current at any hour of any day.",
      },
      {
        title: "Theoretical vs actual variance",
        body: "Compare what your recipes say you should have used against your physical stocktake. The gap is your waste, over-portioning, and shrinkage — in riyals.",
      },
      {
        title: "Supplier invoices straight into COGS",
        body: "Log a purchase invoice once: it updates stock, accounts payable, and the general ledger together. No double entry, no spreadsheet.",
      },
      {
        title: "Branch-level stock control",
        body: "Separate counts, prices, suppliers, and variance per branch — with one consolidated profitability view for the owner.",
      },
      {
        title: "Menu engineering built in",
        body: "See contribution margin per item and spot the Stars, Plowhorses, Puzzles, and Dogs on your menu before you reprint it.",
      },
      {
        title: "Weekly and monthly stocktakes",
        body: "Fast count sheets for high-turn items like chicken and vegetables weekly, everything else monthly — on phone or tablet.",
      },
      {
        title: "Purchase price alerts",
        body: "When a supplier raises a price, the affected recipes and their new margins are flagged immediately.",
      },
      {
        title: "Waste and spoilage logged separately",
        body: "Waste posts to its own account instead of hiding inside COGS, so you can see exactly what it costs you each month.",
      },
    ],
    proofTitle: "What owners get out of tighter inventory control",
    proofPoints: [
      "Food cost visible daily instead of 30 days late, so a bad week can be fixed while it is still happening.",
      "Variance reporting turns 'we think there's waste' into a number you can act on per item.",
      "Purchases, payables, and COGS post from one entry, cutting the bookkeeping your accountant re-does each month.",
      "Margin per menu item makes pricing and menu decisions evidence-based, not instinct.",
      "Branch-by-branch comparison shows which kitchen is really running tight and which is leaking.",
    ],
    faq: [
      {
        q: "How is this different from stock control inside a normal POS?",
        a: "Most POS stock modules count units. Matbex costs them: purchases price into inventory, recipes deplete on sale, and the result flows to your profit and loss automatically.",
      },
      {
        q: "Do I need to build recipes for every menu item?",
        a: "For accurate food cost, yes — but you can start with your top sellers, get the biggest share of your cost covered, and add the rest over time.",
      },
      {
        q: "Can I run stocktakes weekly for some items and monthly for others?",
        a: "Yes. Categories can be set to weekly or monthly frequency, so fast-moving items are counted often without recounting everything.",
      },
      {
        q: "Does it handle multiple branches?",
        a: "Yes. Stock, suppliers, categories, and costs are scoped per branch, with consolidated reporting for the owner.",
      },
      {
        q: "Is it connected to the accounting side?",
        a: "Yes. Purchases, waste, and consumption post to the general ledger, so inventory and your financial statements never disagree.",
      },
    ],
  },
  {
    slug: "self-ordering-kiosk",
    path: "/sa/self-ordering-kiosk",
    lang: "en",
    dir: "ltr",
    hreflang: "en-SA",
    alternateSlug: "ar-self-ordering-kiosk",
    title: "Self-Ordering Kiosk for Saudi Restaurants | ZATCA-Ready | Matbex",
    description:
      "Cut queue time, raise ticket size, and serve more covers per hour with a self-ordering kiosk that prints ZATCA invoices and pushes straight to your KDS.",
    heroEyebrow: "Self-Ordering Kiosk · Saudi Arabia",
    heroHeadline: "Shorter queues. Bigger tickets. Same kitchen.",
    heroSub:
      "A bilingual kiosk experience that runs on any modern Android or Windows touchscreen, fires to your KDS, and stamps every invoice with ZATCA Phase 2.",
    primaryCta: "Start free",
    secondaryCta: "Talk to sales",
    features: [
      { title: "Bilingual, RTL-native", body: "Arabic-first interface guests can navigate without staff help." },
      { title: "Visual modifiers", body: "Photo-driven upsells lift average ticket without pushy staff." },
      { title: "ZATCA receipts on the spot", body: "Prints a Phase 2 simplified tax invoice with QR code at checkout." },
      { title: "Push to KDS", body: "Orders fire to the right station instantly — no re-entry at the till." },
      { title: "Hardware freedom", body: "Runs on any Elo, Sunmi, or off-the-shelf Android tablet — bring your own screen." },
      { title: "Offline-tolerant", body: "Keeps taking orders if the network drops, then syncs and clears with ZATCA." },
    ],
    proofTitle: "Where kiosks pay back in Saudi QSR",
    proofPoints: [
      "Average ticket lifts of 10–25% are typical once visual upsells run.",
      "One cashier can supervise three kiosks during peak.",
      "Frees front-line staff to handle drive-thru and delivery handoff.",
      "Solves the labour-shortage pressure without raising payroll.",
    ],
    faq: [
      { q: "Which hardware does it run on?", a: "Any modern Android tablet (10\"+ recommended), Sunmi kiosk, or Windows touchscreen. We don't lock you to a vendor." },
      { q: "Does it accept mada and Apple Pay?", a: "Yes, via any of our supported terminal partners or a card-present terminal beside the kiosk." },
      { q: "Can the same kiosk show two languages?", a: "Yes. Guests pick AR or EN on the first screen; the menu, modifiers, and receipt all switch." },
    ],
  },
  {
    slug: "loyalty-program",
    path: "/sa/loyalty-program",
    lang: "en",
    dir: "ltr",
    hreflang: "en-SA",
    alternateSlug: "ar-loyalty-program",
    title: "Restaurant Loyalty & CRM for Saudi Arabia | Matbex",
    description:
      "Track guests, run points-based loyalty, and trigger WhatsApp re-engagement — built into the same platform as your POS and accounting.",
    heroEyebrow: "Loyalty & CRM · Saudi Arabia",
    heroHeadline: "Turn first-time guests into regulars — without a separate CRM bill.",
    heroSub:
      "Capture every guest at the till or QR menu, reward repeat visits, and bring them back with WhatsApp campaigns — all inside Matbex.",
    primaryCta: "Start free",
    secondaryCta: "See loyalty in action",
    features: [
      { title: "Points per Riyal", body: "Configurable earn/burn ratios that fit shawarma stands and fine dining alike." },
      { title: "Tier-based perks", body: "Silver, Gold, Platinum — automatic uplift based on rolling 90-day spend." },
      { title: "Mobile-number capture", body: "Cashier prompts for phone at checkout; guest gets an instant SMS confirmation." },
      { title: "WhatsApp re-engagement", body: "Win-back campaigns triggered when a guest hasn't visited in N days." },
      { title: "POS redemption", body: "Cashier sees available points the moment a guest is identified — one-tap redeem." },
      { title: "Unified guest record", body: "Same guest profile across dine-in, delivery, and online orders." },
    ],
    proofTitle: "Why loyalty pays back in Saudi F&B",
    proofPoints: [
      "Returning guests spend 30–40% more per visit than first-timers — true across QSR and casual dining.",
      "WhatsApp open rates in KSA routinely exceed 90% — far above email.",
      "Owning the guest list breaks dependence on aggregator marketing.",
      "No separate CRM contract — it's part of Matbex.",
    ],
    faq: [
      { q: "Do guests need an app?", a: "No. Phone number is the loyalty ID. They get SMS or WhatsApp confirmations directly." },
      { q: "Can I run promotions on specific menu items?", a: "Yes — earn multipliers, item-level redemptions, and category-specific rewards are all supported." },
      { q: "Is guest data tenant-isolated?", a: "Yes. Every guest record is scoped to your tenant with strict row-level security." },
    ],
  },
  {
    slug: "delivery-aggregators",
    path: "/sa/delivery-aggregators",
    lang: "en",
    dir: "ltr",
    hreflang: "en-SA",
    alternateSlug: "ar-delivery-aggregators",
    title: "HungerStation, Jahez, Mrsool & Talabat Integration | Matbex",
    description:
      "Receive HungerStation, Jahez, Mrsool, and Talabat orders straight into your POS and KDS — one unified queue, one set of ZATCA invoices, one P&L.",
    heroEyebrow: "Aggregator Integration · Saudi Arabia",
    heroHeadline: "All your aggregator orders in one screen — no more tablet wall.",
    heroSub:
      "Matbex pulls HungerStation, Jahez, Mrsool, and Talabat orders into your POS and Kitchen Display. One queue. One menu source. One revenue report.",
    primaryCta: "Start free",
    secondaryCta: "See the unified queue",
    features: [
      { title: "Unified order queue", body: "Every aggregator order arrives in the same screen as your dine-in and direct online orders." },
      { title: "One menu, every channel", body: "Edit a price or 86 an item once — it syncs to every aggregator automatically." },
      { title: "Auto-accept windows", body: "Set per-aggregator auto-accept rules so kitchen prep starts the moment an order lands." },
      { title: "Channel-tagged P&L", body: "Every order is tagged by source so you see net margin per aggregator after commission." },
      { title: "ZATCA-compliant", body: "Aggregator orders post Phase 2 simplified invoices like every other sale." },
      { title: "No tablet wall", body: "Retire the row of vendor tablets — Matbex consolidates them all in one app." },
    ],
    proofTitle: "Why Saudi operators want one unified queue",
    proofPoints: [
      "Fewer missed orders during peak — one screen, one alert sound.",
      "Menu mistakes drop because pricing is edited in one place.",
      "True per-aggregator margin visibility informs which channel is worth promoting.",
      "Faster onboarding for new staff — only one app to learn.",
    ],
    faq: [
      { q: "Which aggregators are supported?", a: "HungerStation, Jahez, Mrsool, and Talabat are on the roadmap; reach out if you need a specific one prioritized." },
      { q: "Do I keep my existing aggregator contracts?", a: "Yes. Matbex sits on top of your existing aggregator accounts — your contracts and commissions stay with them." },
      { q: "What happens if an aggregator API is down?", a: "Matbex queues the order locally and reconciles automatically when the aggregator API recovers." },
    ],
  },
  // ───────── Sapaad-gap feature pages — ARABIC mirrors ─────────
  {
    slug: "ar-qr-ordering",
    path: "/ar/qr-ordering",
    lang: "ar",
    dir: "rtl",
    hreflang: "ar-SA",
    alternateSlug: "qr-ordering",
    title: "طلب ودفع عبر QR للمطاعم في السعودية | Matbex",
    description:
      "اترك العميل يمسح ويطلب ويدفع من جواله. فواتير متوافقة مع زاتكا، قائمة عربية أولاً، وإرسال مباشر إلى المطبخ بدون عمولات وسطاء.",
    heroEyebrow: "طلب عبر QR · السعودية",
    heroHeadline: "العميل يطلب من جواله، والمطبخ فقط يطبخ.",
    heroSub:
      "تجربة طلب QR مدمجة داخل نفس النظام الذي يدير الكاشير وشاشة المطبخ والمحاسبة. بدون مزود خارجي، بدون عمولة على الطلب، بدون تسويات مكررة.",
    primaryCta: "ابدأ مجاناً",
    secondaryCta: "شاهدها على طاولة",
    features: [
      { title: "مسح وطلب فوري", body: "QR مربوط بالطاولة يفتح القائمة عربية/إنجليزية فوراً — بدون تثبيت تطبيق." },
      { title: "الدفع من الطاولة", body: "بطاقة أو Apple Pay أو مدى أو نقد. فاتورة زاتكا متوافقة في كل عملية." },
      { title: "مباشر إلى المطبخ", body: "الطلب يصل إلى شاشة المطبخ لحظة تأكيد العميل — بدون وسيط." },
      { title: "مزامنة قائمة لحظية", body: "الأصناف المنتهية تختفي تلقائياً، فلا يطلب العميل ما لا تستطيع تقديمه." },
      { title: "ثنائي اللغة افتراضياً", body: "قائمة كاملة بالعربية RTL والإنجليزية LTR من نفس السجل." },
      { title: "بدون عمولات تطبيقات", body: "العميل يطلب مباشرة منك، فتحتفظ بكامل قيمة الفاتورة بدلاً من 70% منها." },
    ],
    proofTitle: "لماذا ينقل المشغلون الطلبات داخل الصالة إلى QR",
    proofPoints: [
      "تسارع دوران الطاولات — العميل لا ينتظر النادل.",
      "ارتفاع متوسط الفاتورة — الإضافات تظهر على كل صنف.",
      "تكلفة عمالة أقل لكل عميل — نادل واحد يخدم طاولات أكثر.",
      "ضبط نقدي أنظف — كل طلب مسجّل قبل وصوله للمطبخ.",
    ],
    faq: [
      { q: "هل يحتاج العميل تنزيل تطبيق؟", a: "لا. القائمة تفتح في متصفح الجوال لحظة المسح." },
      { q: "هل الفاتورة متوافقة مع زاتكا؟", a: "نعم. كل طلب QR يصدر فاتورة مبسّطة المرحلة الثانية مثل أي بيع من الكاشير." },
      { q: "هل يمكن للمطبخ التأكيد قبل الدفع؟", a: "نعم — أنت تختار: دفع أولاً، أو دفع لاحق، أو تأكيد الموظف ثم الإطلاق." },
    ],
  },
  {
    slug: "ar-self-ordering-kiosk",
    path: "/ar/self-ordering-kiosk",
    lang: "ar",
    dir: "rtl",
    hreflang: "ar-SA",
    alternateSlug: "self-ordering-kiosk",
    title: "كشك طلب ذاتي للمطاعم السعودية | متوافق مع زاتكا | Matbex",
    description:
      "قلّل الطابور، ارفع متوسط الفاتورة، وقدّم لعملاء أكثر في الساعة بكشك طلب ذاتي يطبع فواتير زاتكا ويرسل مباشرة إلى شاشة المطبخ.",
    heroEyebrow: "كشك طلب ذاتي · السعودية",
    heroHeadline: "طوابير أقصر. فواتير أكبر. نفس المطبخ.",
    heroSub:
      "تجربة كشك ثنائية اللغة تعمل على أي شاشة لمس أندرويد أو ويندوز حديثة، تطلق إلى شاشة المطبخ، وتختم كل فاتورة بختم زاتكا المرحلة الثانية.",
    primaryCta: "ابدأ مجاناً",
    secondaryCta: "تواصل مع المبيعات",
    features: [
      { title: "عربي أولاً، RTL أصلي", body: "واجهة عربية يستطيع العميل التنقّل فيها بدون مساعدة موظف." },
      { title: "إضافات بصرية", body: "صور الإضافات ترفع متوسط الفاتورة بدون ضغط الموظفين." },
      { title: "فاتورة زاتكا فورية", body: "يطبع فاتورة ضريبية مبسّطة مع رمز QR عند الدفع." },
      { title: "إرسال إلى شاشة المطبخ", body: "الطلبات تطلق إلى المحطة الصحيحة فوراً — بدون إعادة إدخال." },
      { title: "حرية الأجهزة", body: "يعمل على أي تابلت Elo أو Sunmi أو أندرويد جاهز — اختر شاشتك." },
      { title: "يعمل بدون إنترنت", body: "يستمر بقبول الطلبات إذا انقطعت الشبكة، ثم يزامن ويصدر فواتير زاتكا." },
    ],
    proofTitle: "أين يسدد الكشك ثمنه في الوجبات السريعة السعودية",
    proofPoints: [
      "ارتفاع متوسط الفاتورة 10–25% شائع بعد تشغيل الإضافات البصرية.",
      "كاشير واحد يستطيع الإشراف على ثلاثة أكشاك وقت الذروة.",
      "يحرر الموظفين للتركيز على السيارة والتوصيل.",
      "حل عملي لضغط نقص العمالة بدون رفع الرواتب.",
    ],
    faq: [
      { q: "ما الأجهزة المدعومة؟", a: "أي تابلت أندرويد حديث (10 إنش فأكثر)، أو كشك Sunmi، أو شاشة لمس ويندوز. بدون قيد على البائع." },
      { q: "هل يقبل مدى وApple Pay؟", a: "نعم، عبر شركاء الدفع المدعومين أو جهاز نقاط بيع بجانب الكشك." },
      { q: "هل يدعم الكشك لغتين؟", a: "نعم. يختار العميل العربية أو الإنجليزية في أول شاشة، فتتبدّل القائمة والإضافات والفاتورة." },
    ],
  },
  {
    slug: "ar-loyalty-program",
    path: "/ar/loyalty-program",
    lang: "ar",
    dir: "rtl",
    hreflang: "ar-SA",
    alternateSlug: "loyalty-program",
    title: "برنامج ولاء وإدارة عملاء للمطاعم السعودية | Matbex",
    description:
      "سجّل العملاء، شغّل نظام نقاط الولاء، وأطلق حملات واتساب لاستعادة العميل — كله مدمج داخل نفس نظام الكاشير والمحاسبة.",
    heroEyebrow: "ولاء وإدارة عملاء · السعودية",
    heroHeadline: "حوّل زائر المرة الأولى إلى عميل دائم — بدون اشتراك CRM منفصل.",
    heroSub:
      "اجمع كل عميل من الكاشير أو قائمة QR، كافئ التكرار، وأعده بحملات واتساب — كله داخل Matbex.",
    primaryCta: "ابدأ مجاناً",
    secondaryCta: "شاهد الولاء عملياً",
    features: [
      { title: "نقاط لكل ريال", body: "نسب كسب/استرداد قابلة للتعديل تناسب عربات الشاورما والمطاعم الفاخرة." },
      { title: "فئات بمزايا", body: "فضي، ذهبي، بلاتيني — ترقية تلقائية حسب الإنفاق خلال 90 يوماً." },
      { title: "تسجيل رقم الجوال", body: "الكاشير يطلب الجوال عند الدفع، فيصل العميل تأكيد SMS فوراً." },
      { title: "حملات استعادة واتساب", body: "حملات تنطلق تلقائياً إذا لم يزر العميل خلال N يوماً." },
      { title: "استرداد من الكاشير", body: "النقاط المتاحة تظهر فور تعريف العميل — استرداد بضغطة واحدة." },
      { title: "ملف عميل موحد", body: "نفس الملف عبر الصالة والتوصيل والطلب الإلكتروني." },
    ],
    proofTitle: "لماذا يسدد الولاء ثمنه في قطاع F&B السعودي",
    proofPoints: [
      "العميل المتكرر ينفق 30–40% أكثر في الزيارة الواحدة — صحيح في الوجبات السريعة والمطاعم العادية.",
      "معدلات فتح واتساب في السعودية تتجاوز عادةً 90% — أعلى بكثير من البريد.",
      "امتلاك قاعدة عملائك يكسر الاعتماد على تسويق التطبيقات.",
      "بدون اشتراك CRM منفصل — جزء من Matbex.",
    ],
    faq: [
      { q: "هل يحتاج العميل تطبيقاً؟", a: "لا. رقم الجوال هو معرّف الولاء، وتأكيدات SMS أو واتساب تصله مباشرة." },
      { q: "هل يمكنني تشغيل عروض على أصناف محددة؟", a: "نعم — مضاعفات كسب، استرداد على مستوى الصنف، وعروض حسب القسم." },
      { q: "هل بيانات العملاء معزولة لكل مطعم؟", a: "نعم. كل سجل عميل مرتبط بمستأجرك مع عزل صارم على مستوى الصف." },
    ],
  },
  {
    slug: "ar-delivery-aggregators",
    path: "/ar/delivery-aggregators",
    lang: "ar",
    dir: "rtl",
    hreflang: "ar-SA",
    alternateSlug: "delivery-aggregators",
    title: "ربط هنقرستيشن وجاهز ومرسول وطلبات | Matbex",
    description:
      "استقبل طلبات هنقرستيشن وجاهز ومرسول وطلبات مباشرة في الكاشير وشاشة المطبخ — قائمة موحدة، فواتير زاتكا واحدة، وتقرير ربح واحد.",
    heroEyebrow: "ربط التطبيقات · السعودية",
    heroHeadline: "كل طلبات التطبيقات في شاشة واحدة — وداعاً لجدار التابلتات.",
    heroSub:
      "Matbex يسحب طلبات هنقرستيشن وجاهز ومرسول وطلبات إلى الكاشير وشاشة المطبخ. طابور واحد، قائمة واحدة، تقرير إيرادات واحد.",
    primaryCta: "ابدأ مجاناً",
    secondaryCta: "شاهد الطابور الموحد",
    features: [
      { title: "طابور طلبات موحد", body: "كل طلب من التطبيقات يصل لنفس الشاشة مع طلبات الصالة والطلبات المباشرة." },
      { title: "قائمة واحدة لكل القنوات", body: "عدّل السعر أو أوقف الصنف مرة، فيتزامن تلقائياً مع كل تطبيق." },
      { title: "قبول تلقائي مرن", body: "قواعد قبول تلقائي لكل تطبيق فيبدأ التحضير لحظة وصول الطلب." },
      { title: "تقرير ربح لكل قناة", body: "كل طلب موسوم بمصدره فترى صافي الربح بعد العمولة لكل تطبيق." },
      { title: "متوافق مع زاتكا", body: "طلبات التطبيقات تصدر فواتير مبسّطة المرحلة الثانية كأي عملية بيع." },
      { title: "بدون جدار تابلتات", body: "تخلّص من صف تابلتات الموردين — Matbex يجمعها كلها في تطبيق واحد." },
    ],
    proofTitle: "لماذا يريد المشغلون السعوديون طابوراً موحداً",
    proofPoints: [
      "طلبات ضائعة أقل في الذروة — شاشة واحدة، تنبيه واحد.",
      "أخطاء القائمة تنخفض لأن التسعير في مكان واحد.",
      "رؤية ربح حقيقية لكل تطبيق تكشف أيها يستحق الترويج.",
      "تأهيل موظف جديد أسرع — تطبيق واحد فقط.",
    ],
    faq: [
      { q: "ما التطبيقات المدعومة؟", a: "هنقرستيشن وجاهز ومرسول وطلبات على خارطة الطريق؛ تواصل معنا إذا أردت أولوية لتطبيق محدد." },
      { q: "هل أحتفظ بعقودي الحالية مع التطبيقات؟", a: "نعم. Matbex يعمل فوق حساباتك الحالية — العقود والعمولات تبقى معهم." },
      { q: "ماذا يحدث إذا تعطّلت واجهة التطبيق؟", a: "Matbex يحفظ الطلب محلياً ويزامن تلقائياً عند عودة الخدمة." },
    ],
  },
];

export const SEO_PAGES_BY_SLUG: Record<string, SeoPage> = Object.fromEntries(
  SEO_PAGES.map((p) => [p.slug, p]),
);

export const SITE_ORIGIN = "https://matbex.com";

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: "تسجيل-الدخول-الى-لوحة-ماتبكس",
    path: "/ar/help/تسجيل-الدخول-الى-لوحة-ماتبكس",
    lang: "ar",
    dir: "rtl",
    title: "تسجيل الدخول إلى لوحة Matbex | مركز المساعدة",
    description:
      "شرح سريع لتسجيل الدخول إلى لوحة Matbex، اختيار الفرع الصحيح، وحل أكثر أسباب فشل الدخول شيوعاً.",
    heroEyebrow: "مركز المساعدة · تسجيل الدخول",
    heroHeadline: "كيف تسجل الدخول إلى لوحة Matbex بشكل صحيح؟",
    heroSub:
      "هذا الدليل مخصص للمديرين والمالكين وموظفي التشغيل الذين يحتاجون الدخول إلى اللوحة أو الكاشير أو شاشة المطبخ بدون تعطيل الخدمة.",
    sections: [
      {
        title: "1) افتح رابط Matbex الصحيح",
        body: [
          "استخدم رابط الشركة أو الرابط الذي أرسله لك مالك الحساب، ثم اضغط على تسجيل الدخول.",
          "إذا كان لديك أكثر من فرع، تأكد أنك تدخل بالحساب المرتبط بنفس المستأجر قبل محاولة تبديل الفرع من داخل النظام.",
        ],
      },
      {
        title: "2) أدخل البريد وكلمة المرور أو سجّل عبر Google",
        body: [
          "للحسابات الإدارية، يفضّل استخدام نفس البريد الذي استلم دعوة Matbex عليه حتى يتم تحميل الصلاحيات الصحيحة مباشرة.",
          "إذا كنت تستخدم Google، اختر الحساب المرتبط بدعوة العمل وليس حساباً شخصياً مختلفاً.",
        ],
      },
      {
        title: "3) اختر الفرع أو الشاشة المناسبة بعد الدخول",
        body: [
          "بعد تسجيل الدخول، يستطيع المالك أو المدير الانتقال بين الفروع من أعلى الواجهة.",
          "أما المستخدمون المقيّدون مثل الكاشير أو المحاسب، فسيتم توجيههم تلقائياً إلى الشاشات المسموح بها حسب الصلاحية.",
        ],
      },
      {
        title: "إذا لم تتمكن من الدخول",
        body: [
          "تحقق أولاً من صحة البريد، ثم جرّب إعادة تعيين كلمة المرور من صفحة الدخول.",
          "إذا ظهرت لك شاشة مختلفة عن المتوقع، فغالباً المشكلة في الصلاحية أو في انضمامك إلى المستأجر الخطأ، ويجب على المالك إعادة دعوتك أو تحديث دورك.",
        ],
      },
    ],
    faq: [
      {
        q: "هل يمكنني الدخول من الجوال أو التابلت؟",
        a: "نعم. Matbex يعمل على الويب وعلى أجهزة التابلت المخصصة للكاشير والمطبخ.",
      },
      {
        q: "لماذا يتم نقلي إلى صفحة مختلفة بعد الدخول؟",
        a: "لأن النظام يوجّه كل مستخدم حسب دوره: مالك، مدير، كاشير، أو محاسب.",
      },
      {
        q: "نسيت كلمة المرور، ماذا أفعل؟",
        a: "استخدم خيار إعادة تعيين كلمة المرور من صفحة الدخول، ثم افتح الرابط الذي يصلك على البريد نفسه المرتبط بالحساب.",
      },
    ],
  },
  {
    slug: "حل-مشكلة-تعذر-تسجيل-الدخول",
    path: "/ar/help/حل-مشكلة-تعذر-تسجيل-الدخول",
    lang: "ar",
    dir: "rtl",
    title: "حل مشكلة تعذر تسجيل الدخول في Matbex | مركز المساعدة",
    description:
      "أسباب وحلول مشكلة تعذر تسجيل الدخول في Matbex: البريد الخاطئ، كلمة المرور، الصلاحيات، والدعوات غير المكتملة.",
    heroEyebrow: "مركز المساعدة · استكشاف الأخطاء",
    heroHeadline: "لا أستطيع تسجيل الدخول إلى Matbex — ماذا أفعل؟",
    heroSub:
      "ابدأ بهذه الخطوات السريعة قبل التواصل مع الدعم. أغلب مشاكل الدخول تكون مرتبطة بالبريد أو الصلاحية أو دعوة المستخدم.",
    sections: [
      {
        title: "تأكد من البريد الصحيح",
        body: [
          "يجب أن يكون البريد هو نفسه الذي استلمت عليه الدعوة أو أنشأت به الحساب.",
          "إذا سجّلت عبر Google، فتأكد أنك اخترت نفس الحساب وليس حساباً آخر يحمل اسماً مشابهاً.",
        ],
      },
      {
        title: "أعد تعيين كلمة المرور",
        body: [
          "إذا كنت غير متأكد من كلمة المرور، استخدم خيار نسيت كلمة المرور بدلاً من تكرار المحاولة عدة مرات.",
          "بعد إعادة التعيين، افتح الرابط مباشرة من نفس الجهاز أو المتصفح لتجنب انتهاء صلاحية الجلسة.",
        ],
      },
      {
        title: "تحقق من الصلاحيات والدعوة",
        body: [
          "قد ينجح الدخول لكن لا ترى الشاشة المتوقعة لأن دورك داخل المستأجر لا يمنحك نفس الوصول الذي يملكه المدير أو المالك.",
          "في هذه الحالة، على المالك مراجعة المستخدمين والأدوار أو إعادة إرسال الدعوة من جديد.",
        ],
      },
      {
        title: "متى تحتاج إلى الدعم؟",
        body: [
          "إذا كان البريد صحيحاً، وتمت إعادة كلمة المرور، وما زالت المشكلة مستمرة، فاجمع لقطة شاشة للخطأ واسم الفرع ووقت المحاولة قبل التواصل مع الدعم.",
          "ذلك يسرّع الوصول إلى السبب الحقيقي، سواء كان خطأ مصادقة أو مشكلة ربط بين المستخدم والمستأجر.",
        ],
      },
    ],
    faq: [
      {
        q: "هل كثرة محاولات الدخول الخاطئة توقف الحساب؟",
        a: "عادة لا، لكن قد تنتهي الجلسة أو تحتاج إلى إعادة المحاولة بعد إعادة تعيين كلمة المرور.",
      },
      {
        q: "دخلت بنجاح لكن لا أرى لوحة التحكم، لماذا؟",
        a: "غالباً لأن دورك ليس مالكاً أو مديراً، أو لأنك داخل مستأجر مختلف عن المطلوب.",
      },
      {
        q: "هل يمكن للمالك إعادة دعوتي؟",
        a: "نعم. إعادة الدعوة أو تحديث الدور غالباً تحل مشاكل الربط بين الحساب والفرع أو المستأجر.",
      },
    ],
  },
  {
    slug: "فهم-صلاحيات-المالك-والمدير-والكاشير",
    path: "/ar/help/فهم-صلاحيات-المالك-والمدير-والكاشير",
    lang: "ar",
    dir: "rtl",
    title: "صلاحيات المالك والمدير والكاشير في Matbex | مركز المساعدة",
    description:
      "شرح أدوار المستخدمين في Matbex وما الذي يمكن لكل من المالك والمدير والكاشير والمحاسب الوصول إليه داخل النظام.",
    heroEyebrow: "مركز المساعدة · الصلاحيات",
    heroHeadline: "ما الفرق بين صلاحيات المالك والمدير والكاشير؟",
    heroSub:
      "قبل إضافة مستخدم جديد، افهم الدور الأنسب له حتى لا يتم منحه وصولاً أعلى من المطلوب أو أقل مما يحتاجه للعمل.",
    sections: [
      {
        title: "المالك",
        body: [
          "يمتلك أعلى صلاحية داخل المستأجر ويمكنه إدارة الفوترة، الإعدادات الحساسة، الفريق، والخطط والميزات.",
          "هذا الدور مناسب لصاحب النشاط أو الشخص المسؤول عن القرارات المالية والتشغيلية الكاملة.",
        ],
      },
      {
        title: "المدير",
        body: [
          "يمكنه تشغيل أغلب العمليات اليومية: المبيعات، المخزون، التقارير، وإدارة جزء كبير من الإعدادات التشغيلية.",
          "هو أفضل خيار لمدير التشغيل أو مدير الفرع الذي يحتاج رؤية واسعة لكن ليس بالضرورة كل صلاحيات المالك.",
        ],
      },
      {
        title: "الكاشير والمحاسب",
        body: [
          "الكاشير يكون وصوله محدوداً بالشاشات التشغيلية مثل تسجيل البيع والورديات والدردشة الداخلية اللازمة للعمل.",
          "المحاسب يركّز على الشاشات المالية والتقارير، ويُمنع من الشاشات غير المتعلقة بعمله حسب إعدادات المؤسسة.",
        ],
      },
      {
        title: "أفضل ممارسة عند توزيع الصلاحيات",
        body: [
          "امنح أقل مستوى صلاحية يكفي لإنجاز العمل، ثم ارفع الصلاحية فقط عند الحاجة.",
          "هذا يقلل الأخطاء التشغيلية ويحافظ على الإعدادات الحساسة مثل الفوترة والاشتراك وإدارة المستخدمين.",
        ],
      },
    ],
    faq: [
      {
        q: "هل يستطيع المدير رؤية لوحة SEO؟",
        a: "نعم، إذا كان دوره مديراً أو مالكاً فبإمكانه الوصول إلى لوحة SEO الإدارية المخصصة للمستأجر.",
      },
      {
        q: "هل يمكن تغيير دور المستخدم لاحقاً؟",
        a: "نعم. يستطيع المالك تعديل الأدوار أو إعادة توزيعها حسب الحاجة التشغيلية.",
      },
      {
        q: "ما أفضل دور لموظف نقطة البيع؟",
        a: "عادة دور الكاشير هو الأنسب لأنه يمنحه ما يحتاجه فقط لتسجيل البيع وإدارة الوردية.",
      },
    ],
  },
];

export const HELP_ARTICLES_BY_SLUG: Record<string, HelpArticle> = Object.fromEntries(
  HELP_ARTICLES.map((article) => [article.slug, article]),
);