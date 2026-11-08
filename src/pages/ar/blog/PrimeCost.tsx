import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { RouteSeo } from "@/components/seo/RouteSeo";
import { ArticleLayout } from "@/components/marketing/ArticleLayout";

export default function ArBlogPrimeCost() {
  useEffect(() => {
    const p = document.documentElement.dir, l = document.documentElement.lang;
    document.documentElement.dir = "rtl"; document.documentElement.lang = "ar";
    return () => { document.documentElement.dir = p || "ltr"; document.documentElement.lang = l || "en"; };
  }, []);

  const title = "التكلفة الأساسية (Prime Cost) في المطاعم السعودية: الدليل الكامل 2026";
  const description = "كيف يحسب أصحاب المطاعم الناجحون التكلفة الأساسية (تكلفة البضاعة + العمالة) ولماذا تتحكم في 60–65٪ من الإيرادات. صيغ، نِسب مرجعية، وأمثلة.";
  const path = "/ar/blog/prime-cost";
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
        <link rel="alternate" hrefLang="en" href="https://matbex.com/blog/restaurant-cogs-guide-ksa" />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>
      <ArticleLayout eyebrow="الربحية · التكلفة الأساسية" title={title} meta="نُشر في 30 مايو 2026 · 11 دقيقة قراءة" rtl>

        <article className="prose prose-lg max-w-none text-gray-700 leading-relaxed space-y-6 text-right">
          <p className="text-xl"><strong>التكلفة الأساسية (Prime Cost)</strong> هي أهم رقم في تشغيل المطعم — ولا توجد أي معركة على الربحية يمكن كسبها قبل ضبطه. هو المؤشر الذي يفرّق بين مطعم يربح ومطعم ينزف بهدوء.</p>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">الصيغة</h2>
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 not-prose my-6"><p className="text-lg font-mono text-gray-900 text-left" dir="ltr">Prime Cost = COGS + Total Labor</p></div>
          <p>تكلفة البضاعة (COGS) <strong>زائد</strong> إجمالي العمالة (الرواتب + التأمينات + البدلات). ثم تُقاس كنسبة من صافي المبيعات:</p>
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 not-prose my-6"><p className="text-lg font-mono text-gray-900 text-left" dir="ltr">Prime Cost % = Prime Cost ÷ Net Sales × 100</p></div>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">النسب المرجعية للسعودية</h2>
          <ul className="list-disc pr-6 space-y-2">
            <li><strong>مطاعم الوجبات السريعة (شاورما، برجر، بروست):</strong> 55–60٪</li>
            <li><strong>مطاعم الخدمة الكاملة (Casual Dining):</strong> 58–63٪</li>
            <li><strong>المطاعم الفاخرة:</strong> 60–65٪</li>
            <li><strong>المقاهي المتخصصة:</strong> 50–55٪</li>
          </ul>
          <p>أي مطعم تجاوزت تكلفته الأساسية <strong>65٪</strong> يحتاج تدخّلاً فورياً. أي رقم أقل من 50٪ مشكوك في صحته.</p>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">لماذا الـ Prime Cost أهم من الربح؟</h2>
          <p>الإيجار والمرافق <em>ثابتة</em> — لا تستطيع تخفيضها هذا الأسبوع. لكن COGS والعمالة <em>متحرّكة يومياً</em>: كل وردية تطبخ فيها، كل موظف تجدوله، كل صنف تشتريه — يدخل في الـ Prime Cost. هذا الرقم هو الذي تديره فعلاً.</p>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">مثال عملي</h2>
          <p>مطعم شاورما في الرياض، مبيعات شهرية 200,000 ريال:</p>
          <ul className="list-disc pr-6 space-y-2">
            <li>COGS: 64,000 ريال (32٪)</li>
            <li>العمالة: 50,000 ريال (25٪)</li>
            <li><strong>Prime Cost: 114,000 ريال = 57٪</strong> ← ضمن النطاق الصحي</li>
            <li>المتاح للإيجار والمرافق والربح: 86,000 ريال (43٪)</li>
          </ul>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">كيف تخفّض الـ Prime Cost؟</h2>
          <ol className="list-decimal pr-6 space-y-2">
            <li><strong>جدولة العمالة حسب حركة الساعة</strong>، لا حسب التغطية الكاملة طوال اليوم.</li>
            <li><strong>التحكم بالتقسيم (Portion control)</strong> — 10 جرامات زائدة لكل طبق قد تساوي 8٪ من COGS.</li>
            <li><strong>تفاوض الموردين كل 90 يوماً</strong>، لا سنوياً.</li>
            <li><strong>تتبّع الهدر يومياً</strong> في حساب منفصل، لا تخلطه مع COGS.</li>
            <li><strong>راقب الـ Prime Cost أسبوعياً</strong>، ليس شهرياً — حتى تتدخل قبل انتهاء الشهر.</li>
          </ol>

          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-8 my-12 not-prose">
            <h3 className="text-xl font-semibold text-gray-900 mb-3">تابع الـ Prime Cost أوتوماتيكياً</h3>
            <p className="text-gray-600 mb-6">Matbex يحسب COGS والعمالة لحظياً ويعرض نسبة Prime Cost اليومية في لوحة المالك.</p>
            <div className="flex flex-wrap gap-3 justify-end"><Button asChild className="bg-[#007a3d] hover:bg-[#006b33] text-white"><Link to="/register">ابدأ مجاناً</Link></Button></div>
          </div>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">مقالات ذات صلة</h2>
          <ul className="list-disc pr-6 space-y-2">
            <li><Link to="/ar/blog/waste-control" className="text-[#00713A] underline">إدارة الهدر في المطاعم</Link></li>
            <li><Link to="/ar/blog/inventory-management" className="text-[#00713A] underline">إدارة المخزون للمطاعم</Link></li>
            <li><Link to="/ar/blog/restaurant-kpis" className="text-[#00713A] underline">أهم مؤشرات أداء المطاعم</Link></li>
          </ul>
        </article>
      </ArticleLayout>
    </>
  );
}