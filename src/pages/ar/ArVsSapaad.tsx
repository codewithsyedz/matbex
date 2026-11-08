import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { useEffect } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RouteSeo } from "@/components/seo/RouteSeo";
import { PageTransition } from "@/components/PageTransition";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";

/** صفحة عربية: Matbex مقابل Sapaad — مقارنة شاملة. */
export default function ArVsSapaad() {
  useEffect(() => {
    const p = document.documentElement.dir, l = document.documentElement.lang;
    document.documentElement.dir = "rtl"; document.documentElement.lang = "ar";
    return () => { document.documentElement.dir = p || "ltr"; document.documentElement.lang = l || "en"; };
  }, []);

  const title = "Matbex مقابل Sapaad — مقارنة كاملة لأنظمة المطاعم في السعودية (2026)";
  const description = "مقارنة شاملة بين Matbex وSapaad للمطاعم السعودية: زاتكا المرحلة الثانية، المحاسبة المزدوجة، COGS اللحظية، التوطين العربي، التسعير بالريال، وخطة الهجرة.";
  const path = "/ar/vs/sapaad";
  const url = `https://matbex.com${path}`;

  const rows: Array<{ feature: string; matbex: string | true; rival: string | true | false; note?: string }> = [
    { feature: "مبنيّ خصيصاً للسوق السعودي", matbex: true, rival: "منصة عالمية", note: "Sapaad يخدم 6 أسواق؛ Matbex متخصص في السعودية." },
    { feature: "زاتكا المرحلة الثانية — مدمج بدون مزود خارجي", matbex: true, rival: "بإضافة" },
    { feature: "محاسبة مزدوجة القيد كاملة (P&L، ميزانية، يومية)", matbex: true, rival: false, note: "Sapaad يصدّر إلى Xero/QuickBooks فقط." },
    { feature: "تكلفة بضاعة لحظية مرتبطة بكل بيع", matbex: true, rival: "تقارير" },
    { feature: "جرد أسبوعي بمعالج (Wizard) للأصناف عالية التكلفة", matbex: true, rival: false },
    { feature: "واجهة عربية أصلية + RTL كامل", matbex: true, rival: "مترجمة" },
    { feature: "إدارة الموظفين، الورديات، السلف، والرواتب", matbex: true, rival: "أساسية" },
    { feature: "بناء موقع وقائمة طعام مباشرة", matbex: true, rival: false },
    { feature: "تطبيق شاشة العميل (CFD)", matbex: true, rival: true },
    { feature: "خطة مجانية للبدء بدون بطاقة", matbex: true, rival: false },
    { feature: "تسعير شفّاف بالريال السعودي", matbex: true, rival: "بالدولار" },
    { feature: "دعم بشري بالعربية في نفس اليوم", matbex: true, rival: "تذاكر عالمية" },
  ];

  const faqs = [
    { q: "هل Matbex بديل حقيقي لـ Sapaad في السعودية؟", a: "نعم. Matbex يغطي كل ما يحتاجه مشغّل سعودي من Sapaad — كاشير، KDS، مخزون، مدفوعات، تكامل مع منصات التوصيل — ويضيف زاتكا المرحلة الثانية، المحاسبة المزدوجة، الرواتب، وبناء الموقع كلها داخل اشتراك واحد." },
    { q: "هل زاتكا المرحلة الثانية مدمجة فعلاً في Matbex؟", a: "نعم. يصدر Matbex فاتورة UBL 2.1 موقّعة بشهادة CSID، يضمّن QR، ويرسلها إلى منصة فاتورة للتخليص الفوري — بدون مزوّد ثالث." },
    { q: "كيف أنقل بياناتي من Sapaad؟", a: "نستورد القائمة والوصفات والمورّدين وأرصدة المخزون وحتى 24 شهراً من المبيعات من ملفات تصدير Sapaad. هجرة الفرع الواحد تكتمل عادةً خلال 48 ساعة." },
    { q: "ما الفرق في السعر؟", a: "Sapaad يبدأ من نحو 79 دولاراً للفرع شهرياً ويفرض رسوماً منفصلة للمحاسبة والرواتب وزاتكا. Matbex يبدأ من 149 ريال، وخطة Growth بـ 349 ريال/شهر للفرع شاملة كل ذلك. الفرع الواحد يوفّر عادةً 60–75% من تكلفته." },
    { q: "هل يعمل على أجهزتي الحالية؟", a: "نعم. يدعم iPad وAndroid وWindows وأجهزة الكاشير الحرارية، وطابعات ESC/POS وأدراج USB/Bluetooth وشاشة العميل — نفس بيئة Sapaad." },
  ];

  const jsonLd = [
    { "@context": "https://schema.org", "@type": "Article", headline: title, description, inLanguage: "ar-SA", datePublished: "2026-05-30", dateModified: "2026-06-02", author: { "@type": "Organization", name: "Matbex" }, publisher: { "@type": "Organization", name: "Matbex", logo: { "@type": "ImageObject", url: "https://matbex.com/og-image.png" } }, mainEntityOfPage: { "@type": "WebPage", "@id": url } },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "الرئيسية", item: "https://matbex.com/ar" },
      { "@type": "ListItem", position: 2, name: "مقارنات", item: "https://matbex.com/ar/vs/sapaad" },
      { "@type": "ListItem", position: 3, name: "Matbex مقابل Sapaad", item: url },
    ]},
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map(f => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
  ];

  return (
    <PageTransition className="min-h-screen bg-white">
      <RouteSeo title={title} description={description} path={path} ogType="article" />
      <Helmet>
        <html lang="ar" dir="rtl" />
        <link rel="alternate" hrefLang="ar" href={url} />
        <link rel="alternate" hrefLang="en" href="https://matbex.com/sa/vs/sapaad" />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>

      <LandingHeader />

      <main className="max-w-4xl mx-auto px-6 py-20 text-right">
        <nav aria-label="Breadcrumb" className="text-xs text-gray-500 mb-6">
          <Link to="/ar" className="hover:text-[#00713A]">الرئيسية</Link>
          <span className="mx-2">/</span><span>مقارنات</span>
          <span className="mx-2">/</span><span className="text-gray-700">Matbex مقابل Sapaad</span>
        </nav>
        <p className="text-xs font-semibold tracking-widest text-[#00713A] uppercase mb-4">مقارنة · أنظمة المطاعم</p>
        <h1 className="text-4xl md:text-5xl font-light tracking-tight text-gray-900 leading-tight mb-6">Matbex مقابل Sapaad</h1>
        <p className="text-lg text-gray-600 mb-12 leading-relaxed">
          Sapaad منصة عالمية لإدارة المطاعم مقرّها دبي، تخدم أكثر من 15,000 مطعم حول العالم.
          Matbex بُني <strong>خصيصاً للمطعم السعودي</strong>: زاتكا مدمجة، محاسبة كاملة، واجهة عربية أصلية،
          وتسعير بالريال. هذه المقارنة المفصّلة تساعدك على اختيار المنصة المناسبة لتشغيلك في 2026.
        </p>

        <section className="border border-gray-200 rounded-2xl overflow-hidden mb-12">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200"><tr>
              <th className="text-right p-4 font-semibold text-gray-900">الميزة</th>
              <th className="text-center p-4 font-semibold text-[#00713A]">Matbex</th>
              <th className="text-center p-4 font-semibold text-gray-600">Sapaad</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-gray-100 last:border-0">
                  <td className="p-4 text-gray-800">{r.feature}{r.note && <span className="block text-xs text-gray-500 mt-1">{r.note}</span>}</td>
                  <td className="p-4 text-center">{r.matbex === true ? <Check className="inline w-5 h-5 text-[#00713A]" /> : <span className="text-gray-700">{r.matbex}</span>}</td>
                  <td className="p-4 text-center">{r.rival === true ? <Check className="inline w-5 h-5 text-gray-400" /> : r.rival === false ? <X className="inline w-5 h-5 text-gray-300" /> : <span className="text-gray-600">{r.rival}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <article className="prose prose-lg max-w-none text-gray-700 leading-relaxed space-y-6 text-right">
          <h2 className="text-2xl font-semibold text-gray-900">الخلاصة في فقرة واحدة</h2>
          <p>
            إذا كنت تشغّل سلاسل في أكثر من دولة (الإمارات، الهند، سنغافورة، السعودية) وتدفع أصلاً
            لـ Xero أو QuickBooks، Sapaad منصّة ناضجة ومناسبة. أما إذا كنت داخل السعودية فقط وتريد
            اشتراكاً واحداً يغطّي الكاشير وزاتكا والمحاسبة والمخزون والرواتب والموقع، فـ Matbex
            مصمَّم خصيصاً لهذه الحالة وتكلفته الفعلية أقل بنسبة 60–75%.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">١. زاتكا المرحلة الثانية</h2>
          <p>
            كل فاتورة B2B وأغلب فواتير B2C يجب إصدارها UBL 2.1، توقيعها بختم تشفيري من هيئة الزكاة،
            تضمين QR، ثم تخليصها أو الإبلاغ عنها عبر منصة فاتورة لحظياً. Sapaad يستخدم مزوّداً ثالثاً
            يُفوتَر منفصلاً لكل فرع. Matbex يدير الدورة كاملة داخلياً — من تسجيل CSID وحتى أرشفة XML المختوم —
            دون فاتورة إضافية. للتفاصيل: <Link to="/ar/zatca" className="text-[#00713A] underline">دليل زاتكا</Link>.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">٢. عمق المحاسبة</h2>
          <p>
            Sapaad يقدّم تقارير مبيعات ويصدّرها إلى Xero أو QuickBooks. Matbex يأتي بمحاسبة مزدوجة القيد
            كاملة: قائمة حسابات مطابقة للسعودية، قيود تلقائية لكل بيع وشراء، ترحيل COGS عند الاستهلاك،
            رواتب باستحقاق، ذمم موردين، ذمم عملاء، سجل تدقيق غير قابل للتعديل، إقفال شهري،
            وقوائم P&L والميزانية وميزان المراجعة. محاسبك يستخدم نفس النظام بدون ملفات Excel.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">٣. تكلفة البضاعة لحظياً</h2>
          <p>
            Sapaad يحتسب COGS من تقارير المخزون بعد جرد دوري. Matbex يحسب COGS النظرية مع كل بيع بالاعتماد
            على شجرة الوصفة: إن استهلك طبق ما 180 جراماً من الدجاج بـ 24 ريال/كجم، يخصم النظام فوراً 180 جراماً
            ويرحّل 4.32 ريالاً إلى حساب 5100. ترى نسبة COGS الحقيقية على نفس لوحة المبيعات.
            للاستزادة: <Link to="/blog/restaurant-cogs-guide-ksa" className="text-[#00713A] underline">دليل COGS للمطاعم السعودية</Link>.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">٤. التوطين العربي و RTL</h2>
          <p>
            Sapaad ترجم واجهته الإنجليزية. Matbex صُمِّم عربياً أولاً: التخطيط، الخطوط، تنسيق الأرقام
            ورمز العملة، تنسيق التاريخ، حتى ترميز الطابعات الحرارية اختير لمُشغِّل عربي. التبديل بين اللغتين
            بضغطة، وكل إيصال طباعة وتذكرة مطبخ وشاشة عميل وملف PDF يحترم اللغة النشطة.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">٥. السعر — الرقم الحقيقي</h2>
          <p>
            سعر Sapaad المعلن يبدأ من ~79 دولاراً للفرع شهرياً للكاشير، ثم 19–39 دولاراً للمخزون،
            29 دولاراً للولاء، 15–25 دولاراً لتكامل زاتكا، فضلاً عن تكلفة Xero/QuickBooks منفصلة.
            الفرع السعودي بالحزمة الكاملة قد يصل 700–900 ريال/شهر. Matbex Growth بـ
            <strong> 349 ريال/شهر للفرع</strong>، مع تجربة مجانية 14 يوماً. قارن الخطط في
            <Link to="/pricing" className="text-[#00713A] underline"> صفحة الأسعار</Link>.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">٦. خطة الهجرة من Sapaad</h2>
          <p>
            تستطيع تصدير القائمة والمعدِّلات والوصفات والمورّدين وأرصدة المخزون من Sapaad. يستورد Matbex
            القائمة والوصفات مباشرة، يربط المعدِّلات، ويعيد تشغيل ما يصل إلى 24 شهراً من المبيعات لتبقى التقارير متصلة.
            التحويل المعتاد للفرع الواحد ليلة سبت إلى صباح أحد؛ للسلاسل نشغّل فرعاً تجريبياً 1–2 أسبوع قبل التعميم.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">متى يكون Sapaad الخيار الأنسب؟</h2>
          <p>
            تشغيل متعدد الدول، فريق محاسبي خارجي، تعامل بالدولار، وأدوات إنجليزية. عندئذٍ منصّة موحّدة
            عالمياً مفيدة، ويفضّلها أصحاب السلاسل الإقليمية الكبرى.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">متى يكون Matbex الخيار الأذكى؟</h2>
          <ul className="list-disc pr-6 space-y-2">
            <li>تشغيلك <strong>داخل السعودية فقط</strong> وتريد منصة تفهم الزكاة والضريبة والعمالة المحلية.</li>
            <li>تريد <strong>زاتكا المرحلة الثانية</strong> جاهزة بدون مزوّد ثالث ولا اشتراك إضافي.</li>
            <li>تريد <strong>محاسبة مزدوجة القيد بالكامل</strong> داخل النظام، لا تصدير إلى Xero.</li>
            <li>تريد رؤية <strong>الربح اليومي</strong> الحقيقي من نفس لوحة المبيعات.</li>
            <li>تريد <strong>بدء مجاني</strong> بدون بطاقة وبدون التزام شهري.</li>
            <li>تريد دعماً بشرياً بالعربية في نفس اليوم.</li>
          </ul>

          <h2 className="text-2xl font-semibold text-gray-900">أسئلة شائعة</h2>
          <div className="space-y-6 not-prose">
            {faqs.map((f, i) => (
              <div key={i} className="border border-gray-200 rounded-xl p-6 text-right">
                <h3 className="text-base font-semibold text-gray-900 mb-2">{f.q}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{f.a}</p>
              </div>
            ))}
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-8 my-12 not-prose">
            <h3 className="text-xl font-semibold text-gray-900 mb-3">جرّب Matbex مجاناً</h3>
            <p className="text-gray-600 mb-6">ابدأ بحسابك المجاني — بدون بطاقة، بدون التزام.</p>
            <div className="flex flex-wrap gap-3 justify-end">
              <Button asChild className="bg-[#007a3d] hover:bg-[#006b33] text-white"><Link to="/register">ابدأ مجاناً</Link></Button>
              <Button asChild variant="outline"><Link to="/ar">العودة للرئيسية</Link></Button>
              <Button asChild variant="ghost"><Link to="/pricing">الأسعار</Link></Button>
            </div>
          </div>

          <h2 className="text-2xl font-semibold text-gray-900">مقارنات وأدلة ذات صلة</h2>
          <ul className="list-disc pr-6 space-y-2">
            <li><Link to="/ar/vs/foodics" className="text-[#00713A] underline">Matbex مقابل Foodics</Link></li>
            <li><Link to="/ar/vs/qoyod" className="text-[#00713A] underline">Matbex مقابل قيود</Link></li>
            <li><Link to="/ar/vs/jazr" className="text-[#00713A] underline">Matbex مقابل جذر</Link></li>
            <li><Link to="/ar/zatca" className="text-[#00713A] underline">دليل زاتكا المرحلة الثانية</Link></li>
            <li><Link to="/sa/vs/sapaad" className="text-[#00713A] underline">English version</Link></li>
          </ul>
        </article>
      </main>

      <LandingFooter />
    </PageTransition>
  );
}
