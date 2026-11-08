import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { useEffect } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RouteSeo } from "@/components/seo/RouteSeo";
import { PageTransition } from "@/components/PageTransition";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";

/** صفحة عربية: Matbex مقابل جذر (Jazr) — دليل مفصّل. */
export default function ArVsJazr() {
  useEffect(() => {
    const p = document.documentElement.dir, l = document.documentElement.lang;
    document.documentElement.dir = "rtl"; document.documentElement.lang = "ar";
    return () => { document.documentElement.dir = p || "ltr"; document.documentElement.lang = l || "en"; };
  }, []);

  const title = "Matbex مقابل جذر (Jazr) — أيهما الأنسب للمطاعم السعودية؟ (2026)";
  const description = "مقارنة مفصّلة بين Matbex وجذر للمطاعم في السعودية: زاتكا، المخزون، المحاسبة، الرواتب، التقارير، الفروع المتعددة، والتسعير. مع أسئلة شائعة وأدلة هجرة.";
  const path = "/ar/vs/jazr";
  const url = `https://matbex.com${path}`;

  const rows: Array<{ feature: string; matbex: string | true; rival: string | true | false; note?: string }> = [
    { feature: "كاشير عربي سريع", matbex: true, rival: true },
    { feature: "زاتكا المرحلة الثانية — ختم تشفيري وQR", matbex: true, rival: true },
    { feature: "محاسبة مزدوجة القيد كاملة (P&L، ميزانية، يومية)", matbex: true, rival: false, note: "جذر يركّز على الكاشير أكثر من المحاسبة." },
    { feature: "تكلفة بضاعة لحظية مرتبطة بالبيع", matbex: true, rival: "محدودة" },
    { feature: "جرد أسبوعي ومعالج (Wizard) للأصناف الحرجة", matbex: true, rival: false },
    { feature: "إدارة عمليات متعددة الفروع موحّدة", matbex: true, rival: true },
    { feature: "تطبيق الكاشف للعميل (CFD)", matbex: true, rival: "أجهزة فقط" },
    { feature: "بناء موقع وقائمة مباشرة", matbex: true, rival: false },
    { feature: "إدارة الورديات والرواتب والسلف", matbex: true, rival: "أساسية" },
    { feature: "تجربة مجانية 14 يوماً", matbex: true, rival: false },
    { feature: "تسعير شفّاف بالريال السعودي", matbex: true, rival: true },
  ];

  const faqs = [
    { q: "هل Matbex بديل عملي لجذر للمطاعم الصغيرة؟", a: "نعم. Matbex يقدم كاشيراً عربياً بسيطاً كجذر، ويضيف عليه محاسبة كاملة، تكلفة بضاعة لحظية، ورواتب، وكل ذلك مع تجربة مجانية 14 يوماً ثم من 149 ريال للفرع. ينقل عنك العمل اليدوي إلى المحاسب." },
    { q: "هل أحتاج تغيير الأجهزة؟", a: "لا. يعمل Matbex على نفس أجهزة جذر — iPad وAndroid وWindows وأجهزة الكاشير الحرارية، ويدعم نفس الطابعات والأدراج." },
    { q: "كيف أنقل بياناتي من جذر؟", a: "ندعم استيراد القائمة والمنتجات والمورّدين والمخزون من ملفات تصدير جذر. هجرة الفرع الواحد تكتمل عادةً خلال 24–48 ساعة." },
    { q: "ما الفرق الجوهري؟", a: "جذر كاشير ممتاز للمحال الصغيرة، لكنه يتركك تعتمد على Excel أو محاسب خارجي للحسابات. Matbex يجمع الكاشير والمحاسبة والمخزون والرواتب في منصة واحدة." },
    { q: "هل Matbex مناسب لعربة طعام أو مقهى صغير؟", a: "نعم. الباقة الأساسية (149 ريال) تكفي لعربة أو مقهى صغير، وعند نمو العمل تنتقل بسلاسة إلى الخطة الكاملة بدون تغيير النظام." },
  ];

  const jsonLd = [
    { "@context": "https://schema.org", "@type": "Article", headline: title, description, inLanguage: "ar-SA", datePublished: "2026-05-30", dateModified: "2026-06-02", author: { "@type": "Organization", name: "Matbex" }, publisher: { "@type": "Organization", name: "Matbex", logo: { "@type": "ImageObject", url: "https://matbex.com/og-image.png" } }, mainEntityOfPage: { "@type": "WebPage", "@id": url } },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "الرئيسية", item: "https://matbex.com/ar" },
      { "@type": "ListItem", position: 2, name: "مقارنات", item: "https://matbex.com/ar/vs/jazr" },
      { "@type": "ListItem", position: 3, name: "Matbex مقابل جذر", item: url },
    ]},
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map(f => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
  ];

  return (
    <PageTransition className="min-h-screen bg-white">
      <RouteSeo title={title} description={description} path={path} ogType="article" />
      <Helmet>
        <html lang="ar" dir="rtl" />
        <link rel="alternate" hrefLang="ar" href={url} />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>
      <LandingHeader />
      <main className="max-w-4xl mx-auto px-6 py-20 text-right">
        <nav aria-label="Breadcrumb" className="text-xs text-gray-500 mb-6">
          <Link to="/ar" className="hover:text-[#00713A]">الرئيسية</Link>
          <span className="mx-2">/</span><span>مقارنات</span>
          <span className="mx-2">/</span><span className="text-gray-700">Matbex مقابل جذر</span>
        </nav>
        <p className="text-xs font-semibold tracking-widest text-[#00713A] uppercase mb-4">مقارنة · أنظمة الكاشير</p>
        <h1 className="text-4xl md:text-5xl font-light tracking-tight text-gray-900 leading-tight mb-6">Matbex مقابل جذر</h1>
        <p className="text-lg text-gray-600 mb-12 leading-relaxed">
          جذر نظام كاشير سعودي معروف، يستخدمه كثير من المقاهي والمطاعم الصغيرة. Matbex يقدم
          الكاشير <strong>إلى جانب</strong> محاسبة كاملة وتكلفة بضاعة لحظية ورواتب وبناء موقع
          في منصة واحدة. هذه المقارنة المفصّلة تساعدك على اتخاذ القرار الصحيح.
        </p>

        <section className="border border-gray-200 rounded-2xl overflow-hidden mb-12">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200"><tr>
              <th className="text-right p-4 font-semibold text-gray-900">الميزة</th>
              <th className="text-center p-4 font-semibold text-[#00713A]">Matbex</th>
              <th className="text-center p-4 font-semibold text-gray-600">جذر</th></tr></thead>
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
            جذر خيار سريع وسهل لمن يبدأ بمحل صغير ويحتاج كاشيراً بسيطاً. Matbex مناسب لمن يريد
            ينمو بدون تغيير النظام لاحقاً — يبدأ مجاناً ككاشير، ويتوسّع تلقائياً ليشمل المحاسبة والمخزون
            والرواتب وعدة فروع بدون أن تنتقل لمنصة جديدة.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">١. الكاشير وتجربة الكاشير</h2>
          <p>
            الاثنان يقدّمان كاشيراً عربياً سريعاً، يدعم الطلبات المركّبة، التعديل عليها، تقسيم الفاتورة،
            والطباعة الحرارية. الفرق يبدأ بعد البيع: Matbex يخصم المخزون فوراً عبر شجرة الوصفة،
            يرحّل قيد المبيعات وقيد COGS تلقائياً إلى دفاتر المحاسبة، ويصدّر فاتورة زاتكا مختومة. جذر
            يحفظ البيع كرقم ويترك بقية العمل للمحاسب.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">٢. زاتكا المرحلة الثانية</h2>
          <p>
            الاثنان متوافقان مع زاتكا. الفرق أن Matbex يدير دورة CSID كاملة من داخل النظام، يعرض حالة كل
            فاتورة (تم تخليصها/فشلت/قيد المراجعة)، ويُعيد الإرسال آلياً عند فشل الشبكة، مع لوحة تدقيق
            مخصّصة. للاستزادة: <Link to="/ar/zatca" className="text-[#00713A] underline">دليل زاتكا المرحلة الثانية</Link>.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">٣. المخزون وتكلفة البضاعة</h2>
          <p>
            جذر يدير المنتج كوحدة بيع. Matbex يدير الوصفات والمكوّنات: السندويتش الواحد قد يحتوي
            خبزاً ودجاجاً وصلصة وخضاراً، وعند البيع يُخصم كل مكوّن بالكمية الصحيحة وتُحسب COGS لحظياً.
            هذا يكشف الفاقد ويعطيك نسبة تكلفة طعام دقيقة يومياً.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">٤. المحاسبة والإقفال الشهري</h2>
          <p>
            جذر يصدّر مبيعات يومية كملف. Matbex يحتوي محاسبة مزدوجة القيد مع قائمة حسابات مطابقة
            للسعودية، إقفال شهري، قيود تعديل، وقوائم P&L والميزانية وميزان المراجعة. محاسبك يفتح النظام
            مباشرة ويعمل عليه.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">٥. الورديات والرواتب</h2>
          <p>
            Matbex يدير افتتاح وإغلاق الورديات مع رصيد الصندوق، يكشف الفرق ويُلزم بكتابة السبب، يسجّل
            السُّلَف على الموظفين، ويحسب الراتب نهاية الشهر مع خصم السُّلَف وترحيل القيد آلياً. جذر لا يغطي
            هذه الدورة بشكل كامل.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">٦. التسعير وخطة الهجرة</h2>
          <p>
            يبدأ Matbex مجاناً (Free Plan) ثم خطة Growth بـ 349 ريال/شهر للفرع الواحد تشمل كل ما سبق.
            هجرة البيانات من جذر تتم باستيراد القائمة والمنتجات والمورّدين والمخزون من ملف CSV،
            وعادةً تكتمل خلال 24–48 ساعة. قارن الخطط في
            <Link to="/pricing" className="text-[#00713A] underline"> صفحة الأسعار</Link>.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">متى يكون جذر مناسباً؟</h2>
          <p>عربة طعام أو محل صغير لا يحتاج محاسبة داخلية، ومحاسب خارجي يدير الدفاتر يدوياً، ولا توجد خطة توسّع قريبة.</p>

          <h2 className="text-2xl font-semibold text-gray-900">متى يكون Matbex الخيار الأذكى؟</h2>
          <ul className="list-disc pr-6 space-y-2">
            <li>تريد إيقاف التصدير اليدوي من الكاشير إلى ملف Excel ثم لبرنامج محاسبي.</li>
            <li>تريد رؤية <strong>الربح اليومي</strong> الحقيقي قبل النوم، لا بعد شهر.</li>
            <li>عندك فرع أو أكثر وتحتاج لوحة موحّدة للأداء.</li>
            <li>تريد ربط المخزون بالوصفات بالبيع تلقائياً.</li>
            <li>تخطط للنمو ولا تريد تغيير النظام بعد سنتين.</li>
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
            <h3 className="text-xl font-semibold text-gray-900 mb-3">جرّب Matbex الآن</h3>
            <div className="flex flex-wrap gap-3 justify-end">
              <Button asChild className="bg-[#007a3d] hover:bg-[#006b33] text-white"><Link to="/register">ابدأ مجاناً</Link></Button>
              <Button asChild variant="outline"><Link to="/ar">العودة للرئيسية</Link></Button>
              <Button asChild variant="ghost"><Link to="/pricing">الأسعار</Link></Button>
            </div>
          </div>

          <h2 className="text-2xl font-semibold text-gray-900">مقارنات وأدلة ذات صلة</h2>
          <ul className="list-disc pr-6 space-y-2">
            <li><Link to="/ar/vs/foodics" className="text-[#00713A] underline">Matbex مقابل Foodics</Link></li>
            <li><Link to="/ar/vs/sapaad" className="text-[#00713A] underline">Matbex مقابل Sapaad</Link></li>
            <li><Link to="/ar/vs/qoyod" className="text-[#00713A] underline">Matbex مقابل قيود</Link></li>
            <li><Link to="/ar/zatca" className="text-[#00713A] underline">دليل زاتكا المرحلة الثانية</Link></li>
          </ul>
        </article>
      </main>
      <LandingFooter />
    </PageTransition>
  );
}
