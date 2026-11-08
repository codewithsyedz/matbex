import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { useEffect } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RouteSeo } from "@/components/seo/RouteSeo";
import { PageTransition } from "@/components/PageTransition";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";

/** صفحة عربية: Matbex مقابل قيود (Qoyod) — دليل مفصّل. */
export default function ArVsQoyod() {
  useEffect(() => {
    const p = document.documentElement.dir, l = document.documentElement.lang;
    document.documentElement.dir = "rtl"; document.documentElement.lang = "ar";
    return () => { document.documentElement.dir = p || "ltr"; document.documentElement.lang = l || "en"; };
  }, []);

  const title = "Matbex مقابل قيود (Qoyod) — أيهما الأنسب للمطاعم؟ (2026)";
  const description = "مقارنة مفصّلة بين Matbex وقيود للمطاعم السعودية: المحاسبة، الكاشير، زاتكا المرحلة الثانية، المخزون والوصفات، الرواتب، التسعير، والتكامل بينهما.";
  const path = "/ar/vs/qoyod";
  const url = `https://matbex.com${path}`;

  const rows: Array<{ feature: string; matbex: string | true; rival: string | true | false; note?: string }> = [
    { feature: "كاشير مطاعم متخصص (POS)", matbex: true, rival: false, note: "قيود نظام محاسبة عام، ليس كاشير مطاعم." },
    { feature: "زاتكا المرحلة الثانية للمطاعم", matbex: true, rival: "محدودة" },
    { feature: "محاسبة مزدوجة القيد", matbex: true, rival: true },
    { feature: "تكلفة بضاعة لحظية + وصفات", matbex: true, rival: false },
    { feature: "إدارة المخزون بالأصناف والوحدات والوصفات", matbex: true, rival: "عامة" },
    { feature: "ورديات، رواتب، سلف موظفين، GOSI", matbex: true, rival: "أساسية" },
    { feature: "تقارير ربح يومية / أسبوعية للمطاعم", matbex: true, rival: false },
    { feature: "بناء موقع وقائمة طعام", matbex: true, rival: false },
    { feature: "تطبيق شاشة العميل (CFD) ومنصات التوصيل", matbex: true, rival: false },
    { feature: "خطة مجانية للبدء", matbex: true, rival: "تجريبية" },
    { feature: "تسعير شفّاف بالريال السعودي", matbex: true, rival: true },
  ];

  const faqs = [
    { q: "هل قيود وMatbex منافسان مباشران؟", a: "ليس تماماً. قيود برنامج محاسبة عام يخدم كل القطاعات. Matbex منصة تشغيل مطاعم متكاملة تشمل المحاسبة. إن كنت في قطاع المطاعم فـ Matbex يلغي حاجتك لاستخدام نظامين." },
    { q: "هل أستطيع استخدامهما معاً؟", a: "نعم تقنياً، عبر تصدير قيود المبيعات من Matbex إلى قيود يدوياً أو بـ CSV. لكن معظم عملائنا يكتفون بـ Matbex لأن المحاسبة بداخله مكتملة (قائمة حسابات، يومية، P&L، ميزانية، إقفال شهري)." },
    { q: "ما الذي يميّز محاسبة Matbex لمطعمي؟", a: "ربط الكاشير بالمخزون بالمحاسبة في حركة واحدة: كل بيع يخصم المخزون عبر الوصفة، يرحّل قيد المبيعات وقيد COGS، ويبرز نسبة تكلفة الطعام لحظياً. قيود لا يقدّم هذه السلسلة." },
    { q: "كيف أنقل دفاتري من قيود إلى Matbex؟", a: "ندعم استيراد قائمة الحسابات والأرصدة الافتتاحية والمورّدين والعملاء من ملفات تصدير قيود (CSV). نُكوّن قائمة حسابات مطعمية معدّلة لك ونضع الأرصدة كافتتاحيات." },
    { q: "هل زاتكا مدمجة؟", a: "نعم. Matbex يصدر فاتورة UBL 2.1 مختومة بشهادة CSID، يضمّن QR، ويرسلها إلى منصة فاتورة لحظياً — متخصصة في فواتير المطاعم متعددة الأصناف والمعدّلات." },
  ];

  const jsonLd = [
    { "@context": "https://schema.org", "@type": "Article", headline: title, description, inLanguage: "ar-SA", datePublished: "2026-05-30", dateModified: "2026-06-02", author: { "@type": "Organization", name: "Matbex" }, publisher: { "@type": "Organization", name: "Matbex", logo: { "@type": "ImageObject", url: "https://matbex.com/og-image.png" } }, mainEntityOfPage: { "@type": "WebPage", "@id": url } },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "الرئيسية", item: "https://matbex.com/ar" },
      { "@type": "ListItem", position: 2, name: "مقارنات", item: "https://matbex.com/ar/vs/qoyod" },
      { "@type": "ListItem", position: 3, name: "Matbex مقابل قيود", item: url },
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
          <span className="mx-2">/</span><span className="text-gray-700">Matbex مقابل قيود</span>
        </nav>
        <p className="text-xs font-semibold tracking-widest text-[#00713A] uppercase mb-4">مقارنة · محاسبة المطاعم</p>
        <h1 className="text-4xl md:text-5xl font-light tracking-tight text-gray-900 leading-tight mb-6">Matbex مقابل قيود</h1>
        <p className="text-lg text-gray-600 mb-12 leading-relaxed">
          قيود نظام محاسبة سحابي ممتاز للشركات الصغيرة والمتوسطة في القطاعات العامة. Matbex منصة
          <strong> تشغيل مطاعم متكاملة</strong> تتضمّن المحاسبة بداخلها. هذه المقارنة المفصّلة
          تساعدك على معرفة أيهما يناسب نوع عملك، ومتى يمكن استخدام الاثنين معاً.
        </p>

        <section className="border border-gray-200 rounded-2xl overflow-hidden mb-12">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr><th className="text-right p-4 font-semibold text-gray-900">الميزة</th>
                <th className="text-center p-4 font-semibold text-[#00713A]">Matbex</th>
                <th className="text-center p-4 font-semibold text-gray-600">قيود</th></tr>
            </thead>
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
            قيود ممتاز إن كنت في قطاع غير غذائي تحتاج فيه دفاتر محاسبية وفواتير عامة. Matbex مصمَّم
            للمطاعم تحديداً: يربط الكاشير بالوصفات بالمخزون بالمحاسبة في حركة واحدة، فلا تحتاج برنامجاً
            ثانياً ولا تصديراً يدوياً. إن كنت تدير مطعماً، Matbex يلغي الحاجة لاستخدام نظامين.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">١. ما الذي يفعله كل منهما؟</h2>
          <p>
            قيود يديرفواتير المبيعات والمشتريات، دفتر اليومية، الأرصدة، الذمم، ضريبة القيمة المضافة،
            وتقارير محاسبية قياسية. Matbex يفعل كل ذلك ويضيف فوقه: كاشير مطاعم، شاشة مطبخ، إدارة طاولات،
            وصفات تخصم المخزون لحظياً، COGS النظرية، ورديات، رواتب، GOSI، السلف، إدارة منصات التوصيل،
            بناء موقع، وزاتكا متخصصة للمطاعم.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">٢. زاتكا المرحلة الثانية</h2>
          <p>
            قيود يدعم زاتكا للفواتير العامة. Matbex يدعمها لفواتير المطاعم المتعدّدة الأصناف والمعدِّلات
            (إضافة جبن، حذف بصل، حجم نصف/كامل...) بصيغة UBL 2.1 موقّعة وQR، مع إعادة إرسال آلية عند فشل الشبكة.
            تفاصيل في <Link to="/ar/zatca" className="text-[#00713A] underline">دليل زاتكا</Link>.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">٣. المخزون والوصفات</h2>
          <p>
            هذه أكبر فجوة بين النظامين. قيود يحتفظ بأرصدة مخزون عامة. Matbex يحتفظ بوصفة لكل صنف قائمة،
            ومكوّنات بوحدات قياس دقيقة (جرام، مليلتر، عدد)، فيخصم تلقائياً ويحسب التكلفة الفعلية للطبق
            ويظهر الفاقد والانحراف عن التكلفة النظرية. هذه القدرة لا تتوفر في برامج المحاسبة العامة.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">٤. الرواتب والموظفون</h2>
          <p>
            Matbex يدير ساعات العمل والورديات، يحتسب الراتب ناقص السُّلَف، يرحّل قيد الرواتب آلياً، ويولّد ملف
            GOSI الشهري. قيود يقدّم قيد رواتب يدوياً.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">٥. التسعير</h2>
          <p>
            قيود يبدأ من نحو 79 ريالاً/شهر للمستخدم في خطته الأساسية. Matbex خطة Growth بـ 349 ريال/شهر
            للفرع الواحد، تشمل المحاسبة الكاملة. للمطاعم: Matbex وحده غالباً أرخص من قيود + كاشير مطاعم
            خارجي. قارن في <Link to="/pricing" className="text-[#00713A] underline">صفحة الأسعار</Link>.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">متى تختار قيود؟</h2>
          <p>
            إذا كنت محاسباً يخدم عدّة شركات في قطاعات مختلفة (تجزئة عامة، خدمات، استشارات)، أو تدير
            شركة غير غذائية وتحتاج فقط محاسبة وفواتير، فقيود يقدّم تجربة محاسبية ممتازة بسعر جيد.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">متى تختار Matbex؟</h2>
          <ul className="list-disc pr-6 space-y-2">
            <li>تدير مطعماً أو مقهى أو سلسلة فروع وتحتاج <strong>كاشير + محاسبة معاً</strong>.</li>
            <li>تريد <strong>تكلفة الطبق الحقيقية</strong> من وصفات ومخزون مرتبطين بالبيع.</li>
            <li>تريد رؤية <strong>نسبة COGS والربح اليومي</strong> دون انتظار قيود نهاية الشهر.</li>
            <li>تحتاج زاتكا مدمجة للمطاعم مع QR وختم تشفيري لكل فاتورة.</li>
            <li>تريد بدء مجاني وانتقال سلس عند النمو.</li>
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
            <h3 className="text-xl font-semibold text-gray-900 mb-3">ابدأ مع Matbex مجاناً</h3>
            <div className="flex flex-wrap gap-3 justify-end">
              <Button asChild className="bg-[#007a3d] hover:bg-[#006b33] text-white"><Link to="/register">إنشاء حساب</Link></Button>
              <Button asChild variant="outline"><Link to="/ar/vs/foodics">مقارنة Foodics</Link></Button>
              <Button asChild variant="ghost"><Link to="/pricing">الأسعار</Link></Button>
            </div>
          </div>

          <h2 className="text-2xl font-semibold text-gray-900">مقارنات وأدلة ذات صلة</h2>
          <ul className="list-disc pr-6 space-y-2">
            <li><Link to="/ar/vs/foodics" className="text-[#00713A] underline">Matbex مقابل Foodics</Link></li>
            <li><Link to="/ar/vs/sapaad" className="text-[#00713A] underline">Matbex مقابل Sapaad</Link></li>
            <li><Link to="/ar/vs/jazr" className="text-[#00713A] underline">Matbex مقابل جذر</Link></li>
            <li><Link to="/ar/zatca" className="text-[#00713A] underline">دليل زاتكا المرحلة الثانية</Link></li>
          </ul>
        </article>
      </main>
      <LandingFooter />
    </PageTransition>
  );
}
