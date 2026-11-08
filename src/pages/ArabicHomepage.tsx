import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { useEffect } from "react";
import { Check, ArrowLeft, Flame, Sparkles, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RouteSeo } from "@/components/seo/RouteSeo";
import { PageTransition } from "@/components/PageTransition";
import { Progress } from "@/components/ui/progress";
import { useActivePromotion } from "@/hooks/useActivePromotion";
import { useLanguage } from "@/hooks/useLanguage";

/**
 * Arabic homepage at /ar, a dedicated, indexable Arabic URL with hreflang.
 * Targets Arabic-speaking restaurant operators in KSA. RTL layout, native Arabic copy.
 */
export default function ArabicHomepage() {
  const { data: promo } = useActivePromotion();
  const { setLanguage } = useLanguage();
  // Ensure RTL while on this page even if the language picker is on EN.
  useEffect(() => {
    document.documentElement.dir = "rtl";
    document.documentElement.lang = "ar";
    // No cleanup: i18n's `languageChanged` listener (src/i18n/config.ts) owns
    // dir/lang on the document. Restoring a snapshot here would clobber the
    // value just set by setLanguage("en") when navigating away.
  }, []);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Matbex, نظام مطاعم متكامل",
    inLanguage: "ar-SA",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web, iPad, Android, Windows",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "SAR",
      availability: "https://schema.org/InStock",
      url: "https://matbex.com/ar",
    },
    image: "https://matbex.com/og-image.png",
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: "4.9",
      ratingCount: "150",
      bestRating: "5",
      worstRating: "1",
    },
    description:
      "منصة Matbex لإدارة المطاعم في السعودية: كاشير، زاتكا المرحلة الثانية، مخزون، رواتب، ومحاسبة في مكان واحد.",
    url: "https://matbex.com/ar",
    publisher: { "@type": "Organization", name: "Rilan Business Company" },
  };

  const valueProps = [
    {
      title: "كاشير سريع وموثوق",
      body: "واجهة كاشير عربية مصمّمة للسرعة، تعمل على آيباد وأندرويد وويندوز مع أغلب الطابعات والأدراج.",
    },
    {
      title: "زاتكا المرحلة الثانية, مدمجة",
      body: "ختم تشفيري، رمز QR، إرسال فوري إلى منصة فاتورة، وأرشيف 7 سنوات. بدون مزود خارجي.",
    },
    {
      title: "تكلفة بضاعة لحظية",
      body: "الوصفات تخصم المخزون مع كل بيع، فتظهر نسبة COGS بشكل حي بدلاً من جرد شهري متأخر.",
    },
    {
      title: "محاسبة مزدوجة القيد تلقائياً",
      body: "كل عملية تشغيل تُرحَّل إلى الدفاتر مباشرة, مبيعات، مشتريات، رواتب، نفقات, بدون تصدير يدوي.",
    },
    {
      title: "رواتب وسلف الموظفين",
      body: "إدارة الفريق، الورديات، السلف، والرواتب الشهرية مع ربط مباشر بحسابات الدفاتر.",
    },
    {
      title: "تقارير ربحية يومية",
      body: "ملخص ربح يومي يصل عبر البريد الساعة 11 مساءً بتوقيت الرياض. اعرف ربحك قبل أن تنام.",
    },
  ];

  const proofPoints = [
    "تتبع تكلفة الطعام بشكل لحظي مع كل عملية بيع",
    "تسوية صندوق دقيقة في نهاية كل وردية",
    "تقارير ربح وخسارة شهرية جاهزة للمحاسب",
    "دعم متعدد الفروع مع صلاحيات دقيقة لكل دور",
  ];

  const faqs = [
    {
      q: "هل النظام متوافق مع زاتكا المرحلة الثانية؟",
      a: "نعم. Matbex يرسل الفواتير المبسطة (B2C) والضريبية (B2B) إلى منصة فاتورة مع ختم تشفيري ورمز QR بصيغة TLV، ويحتفظ بالأرشيف لمدة 7 سنوات.",
    },
    {
      q: "هل يمكن البدء بدون رسوم؟",
      a: "نعم، تجربة مجانية 14 يوماً بدون بطاقة ائتمان. بعدها تبدأ الباقات من 149 ريال للفرع شهرياً، وزاتكا مشمولة في حزمة النمو (349 ريال) والمؤسسات.",
    },
    {
      q: "هل النظام يعمل بالعربية بالكامل؟",
      a: "نعم. كل الواجهات والإيصالات والتقارير تدعم العربية مع تخطيط RTL، ويمكن التبديل إلى الإنجليزية لأي مستخدم.",
    },
    {
      q: "ماذا يحدث إذا انقطع الإنترنت أثناء الخدمة؟",
      a: "الكاشير يعمل بوضع غير متصل ويحفظ الفواتير محلياً، ثم يزامنها تلقائياً عند عودة الاتصال, بدون فقدان أي طلب.",
    },
  ];

  // Market comparison rows (Arabic)
  type Cell = boolean | "addon" | string;
  const cmpRows: Array<{ label: string; matbex: Cell; foodics: Cell; marn: Cell; rasta: Cell }> = [
    { label: "السعر الشهري (لكل فرع)", matbex: "349 ﷼", foodics: "423 ﷼", marn: "حسب العرض", rasta: "199 ﷼" },
    { label: "كاشير + درج نقد + ورديات", matbex: true, foodics: true, marn: true, rasta: true },
    { label: "زاتكا المرحلة الثانية", matbex: true, foodics: true, marn: true, rasta: true },
    { label: "محاسبة كاملة (دليل حسابات، P&L، ميزان مراجعة)", matbex: true, foodics: "addon", marn: "addon", rasta: false },
    { label: "تكلفة بضاعة لحظية ووصفات", matbex: true, foodics: "addon", marn: false, rasta: false },
    { label: "رواتب وسلف الموظفين تلقائياً", matbex: true, foodics: "addon", marn: "addon", rasta: false },
    { label: "ذمم العملاء وبرنامج الولاء", matbex: true, foodics: "addon", marn: false, rasta: false },
    { label: "توقّع الأرباح وملخص يومي بالبريد", matbex: true, foodics: false, marn: false, rasta: false },
    { label: "عربي أولاً + RTL أصلي", matbex: true, foodics: true, marn: true, rasta: true },
    { label: "التكلفة الإجمالية للحل الكامل", matbex: "349 ﷼", foodics: "~801 ﷼", marn: "~500 ﷼", rasta: "~400 ﷼" },
  ];

  const renderCmpCell = (value: Cell, isMatbex: boolean) => {
    if (value === "addon") {
      return <span className="text-[11px] text-amber-600 font-medium">إضافة مدفوعة</span>;
    }
    if (typeof value === "string") {
      return <span className={`text-sm font-medium ${isMatbex ? "text-[#00713A]" : "text-gray-700"}`}>{value}</span>;
    }
    if (value === true) {
      return <Check className={`w-4 h-4 mx-auto ${isMatbex ? "text-[#00A859]" : "text-gray-400"}`} />;
    }
    return <Minus className="w-4 h-4 mx-auto text-gray-300" />;
  };

  const plans = [
    {
      tagline: "للبداية",
      name: "الأساسية",
      price: "149 ﷼",
      desc: "كاشير ومخزون أساسي لفرع واحد. زاتكا غير مشمولة.",
      features: ["كاشير عربي كامل", "درج نقد وورديات", "مخزون أساسي", "تقارير مبيعات يومية"],
      highlighted: false,
    },
    {
      tagline: "الأكثر شيوعاً",
      name: "حزمة النمو",
      price: "349 ﷼",
      desc: "كل ما يحتاجه المطعم: كاشير، محاسبة، مخزون، رواتب, في خطة واحدة.",
      features: [
        "كل مزايا الأساسية",
        "زاتكا المرحلة الثانية",
        "محاسبة مزدوجة القيد كاملة",
        "تكلفة بضاعة لحظية + وصفات",
        "إدارة الرواتب والسلف",
        "ذمم العملاء + الولاء",
        "ملخص أرباح يومي بالبريد",
        "دعم متعدد الفروع",
      ],
      highlighted: true,
      badge: "موصى به",
    },
    {
      tagline: "للسلاسل الكبيرة",
      name: "Enterprise",
      price: "699 ﷼",
      desc: "+10 فروع، تكاملات مخصّصة، ومدير حساب مخصّص.",
      features: ["كل مزايا حزمة النمو", "SLA مضمون", "API ومنصات تكامل", "تدريب وانتقال بيانات", "مدير نجاح عملاء"],
      highlighted: false,
    },
  ];

  const remaining = promo ? Math.max(0, promo.max_slots - promo.claimed_slots) : 0;
  const progressPct = promo ? (promo.claimed_slots / promo.max_slots) * 100 : 0;

  return (
    <PageTransition className="min-h-screen bg-white">
      <RouteSeo
        title="ماتبكس | نظام كاشير ومحاسبة للمطاعم السعودية متوافق مع زاتكا"
        description="نظام مطاعم سعودي متكامل: كاشير سريع، زاتكا المرحلة الثانية، مخزون لحظي، رواتب، ومحاسبة كاملة في منصة واحدة. ابدأ مجاناً."
        path="/ar"
      />
      <Helmet>
        <link rel="alternate" hrefLang="ar-SA" href="https://matbex.com/ar" />
        <link rel="alternate" hrefLang="en" href="https://matbex.com/" />
        <link rel="alternate" hrefLang="x-default" href="https://matbex.com/" />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>

      {/* Header */}
      <header className="border-b border-gray-100 bg-white/80 backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/ar" className="text-xl font-semibold tracking-tight text-gray-900">
            ماتبكس
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm text-gray-700">
            <Link to="/ar/zatca" className="hover:text-gray-900">زاتكا</Link>
            <Link to="/ar/كاشير-مطاعم" className="hover:text-gray-900">الكاشير</Link>
            <Link to="/ar/نقاط-البيع" className="hover:text-gray-900">نقاط البيع</Link>
            <Link to="/" onClick={() => { setLanguage("en"); document.documentElement.dir = "ltr"; document.documentElement.lang = "en"; }} className="text-gray-500 hover:text-gray-900">English</Link>
          </nav>
          <Button asChild className="bg-[#007a3d] hover:bg-[#006b33] text-white">
            <Link to="/register">ابدأ مجاناً</Link>
          </Button>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="px-6 pt-20 pb-24 max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            {/* Right: Copy (RTL, text on right) */}
            <div className="order-2 lg:order-2">
              <p className="text-xs font-semibold tracking-widest text-[#00713A] uppercase mb-6">
                نظام مطاعم سعودي · متوافق مع زاتكا
              </p>
              <h1 className="text-5xl md:text-6xl font-light tracking-tight text-gray-900 leading-[1.1] max-w-4xl">
                منصة واحدة لإدارة المطعم, من الكاشير إلى الأرباح.
              </h1>
              <p className="mt-6 text-lg text-gray-600 max-w-2xl leading-relaxed">
                Matbex يجمع الكاشير، فوترة زاتكا، المخزون، الرواتب، والمحاسبة في نظام واحد مصمَّم للسوق السعودي.
                بدون أدوات متفرقة، بدون مطابقات يدوية، وبدون مفاجآت في نهاية الشهر.
              </p>
              <div className="mt-10 flex flex-wrap gap-3">
                <Button asChild size="lg" className="bg-[#007a3d] hover:bg-[#006b33] text-white">
                  <Link to="/register">ابدأ تجربة مجانية</Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link to="/ar/zatca">
                    تعرّف على حل زاتكا
                    <ArrowLeft className="ms-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>

            {/* Left: Dashboard image (RTL, image on left) */}
            <div className="order-1 lg:order-1">
              <img
                src="/arabic-hero-dashboard.jpg"
                alt="لوحة تحكم Matbex, كاشير ومحاسبة ومخزون للمطاعم السعودية"
                width={1200}
                height={800}
                className="w-full rounded-xl border border-gray-200 shadow-lg"
              />
            </div>
          </div>
        </section>

        {/* Value props */}
        <section className="bg-gray-50 py-24 px-6">
          <div className="max-w-7xl mx-auto">
            <p className="text-xs font-semibold tracking-widest text-[#00713A] uppercase mb-4">
              ما الذي يجعل ماتبكس مختلفاً
            </p>
            <h2 className="text-3xl md:text-4xl font-light text-gray-900 max-w-3xl mb-16">
              كل ما يحتاجه المطعم في مكان واحد، مبنيّ للسوق السعودي.
            </h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-10">
              {valueProps.map((v) => (
                <article key={v.title}>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">{v.title}</h3>
                  <p className="text-gray-600 leading-relaxed">{v.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Proof */}
        <section className="py-24 px-6 max-w-7xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-light text-gray-900 mb-10 max-w-3xl">
            بيانات تشغيلية ومالية حيّة, لا تنتظر الجرد الشهري لتعرف الربح.
          </h2>
          <ul className="space-y-4">
            {proofPoints.map((p) => (
              <li key={p} className="flex items-start gap-3">
                <Check className="h-5 w-5 text-[#00713A] flex-shrink-0 mt-1" />
                <span className="text-gray-700 text-lg">{p}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* CTA */}
        <section className="bg-gray-900 text-white py-24 px-6">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-3xl md:text-4xl font-light mb-6">
              ابدأ بإدارة مطعمك بدقة محاسبية, مجاناً.
            </h2>
            <p className="text-gray-200 mb-10 max-w-2xl mx-auto">
              بدون بطاقة ائتمان. الإعداد يأخذ أقل من 15 دقيقة. الدعم بالعربية والإنجليزية.
            </p>
            <Button asChild size="lg" className="bg-[#007a3d] hover:bg-[#006b33] text-white">
              <Link to="/register">إنشاء حساب الآن</Link>
            </Button>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="py-24 px-6 bg-[#FAFAFA] border-t border-gray-200">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <p className="text-xs font-semibold tracking-widest text-[#00713A] uppercase mb-4">التسعير</p>
              <h2 className="text-3xl md:text-4xl font-light tracking-tight text-gray-900 mb-4 leading-tight">
                تسعير شفّاف بالريال. <span className="text-gray-500">بدون مفاجآت.</span>
              </h2>
              <p className="text-base text-gray-600 max-w-2xl mx-auto leading-relaxed">
                ادفع مقابل ما تحتاجه فعلاً. حزمة النمو تشمل كل ما يديره مطعمك بسعر أقل مما يأخذه المنافسون مقابل الكاشير وحده.
              </p>
            </div>

            {/* Founding 50 banner (Arabic) */}
            {promo && (
              <div className="mb-12 rounded-2xl overflow-hidden border border-[#00A859]/30 bg-gradient-to-bl from-[#00A859]/[0.04] via-white to-[#00713A]/[0.06] shadow-[0_8px_40px_-12px_rgba(0,168,89,0.25)]">
                <div className="p-6 md:p-8 lg:p-10">
                  <div className="grid lg:grid-cols-[1.4fr_1fr] gap-8 items-center">
                    <div>
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#00A859] text-white text-[11px] font-semibold tracking-wider mb-4">
                        <Flame className="w-3 h-3" />
                        عرض المؤسّسين الخمسين
                      </div>
                      <h3 className="text-2xl md:text-3xl lg:text-4xl font-semibold tracking-tight text-gray-900 mb-3 leading-[1.15]">
                        خصم 50% للسنة الأولى. ثم 25% مدى الحياة.
                      </h3>
                      <p className="text-sm md:text-base text-gray-600 leading-relaxed mb-5 max-w-xl">
                        أول 50 مطعماً ينضمّون إلى Matbex يحصلون على خصم استثنائي وميزات حصرية، مكافأةً لثقتهم المبكرة.
                      </p>
                      <ul className="space-y-2 mb-6">
                        {[
                          "خصم 50% على حزمة النمو لمدة 12 شهراً",
                          "خصم 25% مدى الحياة بعد السنة الأولى",
                          "نقل بياناتك وإعداد حسابك مجاناً",
                          "خط واتساب مباشر مع المؤسسين",
                          "شعار مطعمك ضمن جدار «يثقون بنا»",
                          "شهر مجاني إضافي مع كل إحالة",
                        ].map((p, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                            <Check className="w-4 h-4 text-[#00713A] flex-shrink-0 mt-0.5" />
                            <span>{p}</span>
                          </li>
                        ))}
                      </ul>
                      <Button asChild disabled={remaining === 0} className="h-11 px-6 rounded-md bg-[#007a3d] hover:bg-[#006b33] text-white text-sm font-medium disabled:opacity-50">
                        <Link to={remaining === 0 ? "#" : "/register?promo=founding"}>
                          <Sparkles className="w-4 h-4 ms-2" />
                          {remaining === 0 ? "اكتملت المقاعد, انضم لقائمة الانتظار" : "احجز مقعدك من المؤسسين"}
                        </Link>
                      </Button>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 p-6 md:p-7">
                      <p className="text-[11px] font-medium text-gray-500 tracking-wider mb-2">مقاعد محدودة</p>
                      <div className="flex items-baseline gap-2 mb-4">
                        <span className="text-5xl md:text-6xl font-light tracking-tight text-gray-900 tabular-nums">{remaining}</span>
                        <span className="text-lg text-gray-500">من {promo.max_slots} متبقّية</span>
                      </div>
                      <Progress value={progressPct} className="h-1.5 mb-3 bg-gray-100" />
                      <p className="text-xs text-gray-500 leading-relaxed">
                        انضم <span className="text-[#00713A] font-semibold">{promo.claimed_slots}</span> مطعماً حتى الآن. خصم {promo.discount_percent}% للسنة الأولى، ثم 25% مدى الحياة.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Pricing cards */}
            <div className="grid md:grid-cols-3 gap-4 lg:gap-6">
              {plans.map((plan) => (
                <div key={plan.name} className={`relative rounded-lg p-8 bg-white border ${plan.highlighted ? "border-[#00A859]" : "border-gray-200"}`}>
                  {plan.badge && (
                    <div className="absolute -top-3 right-1/2 translate-x-1/2">
                      <div className="inline-flex items-center px-2.5 py-1 bg-[#00A859] text-white text-[10px] font-medium tracking-wider rounded">{plan.badge}</div>
                    </div>
                  )}
                  <div className="mb-6">
                    <p className="text-xs font-medium text-gray-500 tracking-wider mb-1">{plan.tagline}</p>
                    <h3 className="text-xl font-semibold tracking-tight text-gray-900 mb-2">{plan.name}</h3>
                    <p className="text-sm text-gray-600 leading-relaxed">{plan.desc}</p>
                  </div>
                  <div className="mb-6 pb-6 border-b border-gray-100">
                    <div className="flex items-baseline gap-2">
                      <span className="text-4xl font-light tracking-tight text-gray-900">{plan.price}</span>
                      {plan.price !== "تواصل معنا" && plan.price !== "0 ﷼" && <span className="text-sm text-gray-500">/ شهرياً</span>}
                    </div>
                  </div>
                  <ul className="space-y-3 mb-8">
                    {plan.features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <Check className="w-4 h-4 text-[#00713A] flex-shrink-0 mt-0.5" />
                        <span className="text-sm text-gray-700 leading-relaxed">{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Button asChild className={`w-full h-11 rounded-md text-sm font-medium ${plan.highlighted ? "bg-[#007a3d] hover:bg-[#006b33] text-white" : "bg-white border border-gray-300 hover:bg-gray-50 text-gray-900"}`}>
                    <Link to={plan.price === "تواصل معنا" ? "/contact" : "/register"}>
                      {plan.price === "تواصل معنا" ? "تواصل مع المبيعات" : "ابدأ الآن"}
                    </Link>
                  </Button>
                </div>
              ))}
            </div>

            {/* Market comparison (Arabic) */}
            <div className="mt-24">
              <div className="text-center mb-10">
                <p className="text-xs font-semibold text-[#00713A] tracking-widest mb-4">مقارنة السوق</p>
                <h3 className="text-2xl md:text-3xl font-semibold tracking-tight text-gray-900 mb-3 leading-tight">
                  نفس الإمكانات. <span className="text-gray-500">بجزء بسيط من السعر.</span>
                </h3>
                <p className="text-sm text-gray-600 max-w-2xl mx-auto leading-relaxed">
                  معظم منصات السعودية تبيع الكاشير بسعر منخفض، ثم تفرض رسوماً على كل وحدة فعلية تشغّل مطعمك. حزمة نمو Matbex تشمل كل شيء, بأقل مما يأخذه المنافسون مقابل الكاشير وحده.
                </p>
              </div>
              <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                <table className="w-full min-w-[720px]">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50/60">
                      <th className="text-right text-xs font-medium text-gray-500 tracking-wider px-6 py-4 w-[36%]">الميزة</th>
                      <th className="text-center px-4 py-4 bg-[#00A859]/[0.04] border-x border-[#00A859]/20">
                        <div className="text-sm font-semibold text-[#00713A]">Matbex</div>
                        <div className="text-[11px] text-gray-500 mt-0.5">حزمة النمو</div>
                      </th>
                      <th className="text-center px-4 py-4">
                        <div className="text-sm font-semibold text-gray-700">Foodics</div>
                        <div className="text-[11px] text-gray-500 mt-0.5">الأساسية + إضافات</div>
                      </th>
                      <th className="text-center px-4 py-4">
                        <div className="text-sm font-semibold text-gray-700">Marn</div>
                        <div className="text-[11px] text-gray-500 mt-0.5">خطة Pro</div>
                      </th>
                      <th className="text-center px-4 py-4">
                        <div className="text-sm font-semibold text-gray-700">Rasta</div>
                        <div className="text-[11px] text-gray-500 mt-0.5">القياسية</div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {cmpRows.map((row, i) => {
                      const isLast = i === cmpRows.length - 1;
                      return (
                        <tr key={row.label} className={`${isLast ? "bg-gray-50/40 font-medium" : ""} ${!isLast ? "border-b border-gray-100" : ""}`}>
                          <td className="text-sm text-gray-700 px-6 py-3.5 leading-relaxed">{row.label}</td>
                          <td className="text-center px-4 py-3.5 bg-[#00A859]/[0.04] border-x border-[#00A859]/20">{renderCmpCell(row.matbex, true)}</td>
                          <td className="text-center px-4 py-3.5">{renderCmpCell(row.foodics, false)}</td>
                          <td className="text-center px-4 py-3.5">{renderCmpCell(row.marn, false)}</td>
                          <td className="text-center px-4 py-3.5">{renderCmpCell(row.rasta, false)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-gray-400 text-center mt-4 max-w-3xl mx-auto leading-relaxed">
                أسعار المنافسين بناءً على القوائم المنشورة والإضافات حتى 2026. التكلفة الفعلية تتغيّر حسب عدد الفروع والوحدات المختارة وشروط التعاقد.
              </p>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-24 px-6 max-w-4xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-light text-gray-900 mb-12">أسئلة شائعة</h2>
          <div className="space-y-8">
            {faqs.map((f) => (
              <div key={f.q} className="border-b border-gray-200 pb-8">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">{f.q}</h3>
                <p className="text-gray-600 leading-relaxed">{f.a}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="bg-white border-t border-gray-200 py-12 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4 text-sm text-gray-600">
          <p>© 2026 شركة ريلان للأعمال. جميع الحقوق محفوظة.</p>
          <nav className="flex gap-6">
            <Link to="/ar/zatca" className="hover:text-gray-900">زاتكا</Link>
            <Link to="/privacy" className="hover:text-gray-900">الخصوصية</Link>
            <Link to="/terms" className="hover:text-gray-900">الشروط</Link>
            <Link to="/" onClick={() => { setLanguage("en"); document.documentElement.dir = "ltr"; document.documentElement.lang = "en"; }} className="hover:text-gray-900">English</Link>
          </nav>
        </div>
      </footer>
    </PageTransition>
  );
}