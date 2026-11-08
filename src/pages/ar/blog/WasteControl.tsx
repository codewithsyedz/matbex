import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { RouteSeo } from "@/components/seo/RouteSeo";
import { ArticleLayout } from "@/components/marketing/ArticleLayout";

export default function ArBlogWasteControl() {
  useEffect(() => {
    const p = document.documentElement.dir, l = document.documentElement.lang;
    document.documentElement.dir = "rtl"; document.documentElement.lang = "ar";
    return () => { document.documentElement.dir = p || "ltr"; document.documentElement.lang = l || "en"; };
  }, []);

  const title = "إدارة الهدر في المطاعم السعودية: دليل عملي لخفض الفاقد (2026)";
  const description = "كيف تقيس وتقلّل الهدر والتلف في مطعمك. أنواع الهدر، صيغة قياسه، أسبابه الخفية، وكيف يُسجَّل محاسبياً بشكل صحيح بعيداً عن COGS.";
  const path = "/ar/blog/waste-control";
  const url = `https://matbex.com${path}`;

  const jsonLd = {
    "@context": "https://schema.org", "@type": "Article", headline: title, description,
    inLanguage: "ar-SA", datePublished: "2026-05-30",
    author: { "@type": "Organization", name: "Matbex" },
    publisher: { "@type": "Organization", name: "Matbex", logo: { "@type": "ImageObject", url: "https://matbex.com/og-image.png" } },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
  };

  return (
    <>
      <RouteSeo title={title} description={description} path={path} ogType="article" />
      <Helmet>
        <html lang="ar" dir="rtl" />
        <link rel="alternate" hrefLang="ar" href={url} />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>
      <ArticleLayout eyebrow="العمليات · الهدر" title={title} meta="نُشر في 30 مايو 2026 · 10 دقائق قراءة" rtl>

        <article className="prose prose-lg max-w-none text-gray-700 leading-relaxed space-y-6 text-right">
          <p className="text-xl">الهدر في المطاعم السعودية يتراوح بين <strong>4٪ و12٪</strong> من المشتريات. معظم المطاعم لا تعرف الرقم الحقيقي لأن الهدر يُدفن داخل COGS فيصبح غير مرئي. هذا الدليل يفصل ما يجب فصله.</p>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">الأنواع الأربعة للهدر</h2>
          <ol className="list-decimal pr-6 space-y-2">
            <li><strong>هدر إنتاجي (Production Waste):</strong> قشور، عظام، تقطيع زائد. مقبول لو ضمن نسبة العائد المتوقعة.</li>
            <li><strong>هدر تخزيني (Spoilage):</strong> أصناف انتهت صلاحيتها أو فسدت بسبب سوء التخزين.</li>
            <li><strong>هدر تشغيلي:</strong> أطباق مردودة، طلبات خاطئة، طبخ زائد.</li>
            <li><strong>هدر خفي (سرقة / استهلاك غير موثّق):</strong> وجبات موظفين بدون تسجيل، أصناف تخرج للأقارب.</li>
          </ol>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">الصيغة</h2>
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 not-prose my-6"><p className="text-lg font-mono text-gray-900 text-left" dir="ltr">Waste % = Waste Cost ÷ Total Purchases × 100</p></div>
          <p>النسبة الصحية: <strong>أقل من 4٪</strong>. كل 1٪ زيادة في الهدر يعني 1٪ خسارة مباشرة في الربح.</p>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">القاعدة الذهبية المحاسبية</h2>
          <p><strong>لا تخلط الهدر مع COGS أبداً.</strong> القيد الصحيح:</p>
          <ul className="list-disc pr-6 space-y-2">
            <li>مدين: حساب <em>الهدر والتالف (6100)</em></li>
            <li>دائن: حساب <em>المخزون (1300)</em></li>
          </ul>
          <p>لماذا؟ لأن الهدر <strong>مشكلة إدارية</strong> يتحملها مدير الفرع، بينما COGS <em>تكلفة عادية</em> من التشغيل. خلطهما يخفي المسؤولية ويمنعك من التدخل.</p>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">خمس عمليات أسبوعية تخفض الهدر فوراً</h2>
          <ol className="list-decimal pr-6 space-y-2">
            <li><strong>سجل هدر يومي إجباري</strong> — ورقة بسيطة أو شاشة في الكاشير. ما لا يُسجّل لا يُقاس.</li>
            <li><strong>FIFO صارم</strong>: الوارد أولاً يخرج أولاً. لاصق تاريخ على كل صنف.</li>
            <li><strong>جرد أسبوعي للأصناف عالية التكلفة</strong> فقط (لحوم، دواجن، أسماك، زيوت).</li>
            <li><strong>تحديد نِسب عائد لكل بروتين</strong> ومتابعة الفرق أسبوعياً.</li>
            <li><strong>سياسة وجبات موظفين موثّقة</strong> تُسجّل في الكاشير بسعر رمزي، لا تختفي.</li>
          </ol>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">إشارات إنذار خفية</h2>
          <ul className="list-disc pr-6 space-y-2">
            <li>فرق غير مبرّر بين الـ COGS النظري والفعلي يتجاوز 2٪.</li>
            <li>صنف يُشترى أكثر مما تظهره المبيعات (مؤشر تسرّب).</li>
            <li>زيادة مفاجئة في نسبة "الأطباق المردودة" أو "الإلغاء".</li>
            <li>صرف نقدي متكرّر من الدرج بدون فاتورة موثّقة.</li>
          </ul>

          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-8 my-12 not-prose">
            <h3 className="text-xl font-semibold text-gray-900 mb-3">تتبّع الهدر تلقائياً</h3>
            <p className="text-gray-600 mb-6">Matbex يفصل الهدر عن COGS، يقيّده محاسبياً، ويرسل تنبيهاً للمالك عند تجاوز عتبة محدّدة.</p>
            <div className="flex flex-wrap gap-3 justify-end"><Button asChild className="bg-[#007a3d] hover:bg-[#006b33] text-white"><Link to="/register">ابدأ مجاناً</Link></Button></div>
          </div>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">مقالات ذات صلة</h2>
          <ul className="list-disc pr-6 space-y-2">
            <li><Link to="/ar/blog/prime-cost" className="text-[#00713A] underline">التكلفة الأساسية Prime Cost</Link></li>
            <li><Link to="/ar/blog/inventory-management" className="text-[#00713A] underline">إدارة المخزون</Link></li>
            <li><Link to="/ar/blog/restaurant-kpis" className="text-[#00713A] underline">مؤشرات أداء المطاعم</Link></li>
          </ul>
        </article>
      </ArticleLayout>
    </>
  );
}