import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { RouteSeo } from "@/components/seo/RouteSeo";
import { ArticleLayout } from "@/components/marketing/ArticleLayout";

export default function ArBlogInventoryManagement() {
  useEffect(() => {
    const p = document.documentElement.dir, l = document.documentElement.lang;
    document.documentElement.dir = "rtl"; document.documentElement.lang = "ar";
    return () => { document.documentElement.dir = p || "ltr"; document.documentElement.lang = l || "en"; };
  }, []);

  const title = "إدارة المخزون في المطاعم: النظام الذي يستخدمه المحترفون (2026)";
  const description = "نظام عملي لإدارة مخزون المطعم: تصنيف ABC، الجرد الأسبوعي، نقطة إعادة الطلب، الوصفات، والربط مع المحاسبة. للمطاعم في السعودية.";
  const path = "/ar/blog/inventory-management";
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
      <ArticleLayout eyebrow="العمليات · المخزون" title={title} meta="نُشر في 30 مايو 2026 · 13 دقيقة قراءة" rtl>

        <article className="prose prose-lg max-w-none text-gray-700 leading-relaxed space-y-6 text-right">
          <p className="text-xl">معظم مطاعم السعودية تدير مخزونها بـ <em>الذاكرة</em> — يفتح الشيف الثلاجة، ينظر، ويطلب. النتيجة: نفاد مفاجئ، تخزين زائد، وفاقد عالي. هذا الدليل يقدّم النظام البديل.</p>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">1. تصنيف ABC للأصناف</h2>
          <p>ليست كل الأصناف متساوية. صنّفها حسب قيمتها السنوية:</p>
          <ul className="list-disc pr-6 space-y-2">
            <li><strong>A — عالية القيمة (80٪ من تكلفة المخزون):</strong> اللحوم، الدواجن، الأسماك، الجبن المستورد. جرد أسبوعي إلزامي.</li>
            <li><strong>B — متوسطة (15٪):</strong> الزيوت، الأرز، المعلبات. جرد كل أسبوعين.</li>
            <li><strong>C — منخفضة (5٪):</strong> البهارات، التغليف، المناديل. جرد شهري.</li>
          </ul>
          <p>قاعدة عملية: 20٪ من أصنافك تمثّل 80٪ من تكلفتك. ركّز جهدك عليها.</p>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">2. نقطة إعادة الطلب (Reorder Point)</h2>
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 not-prose my-6"><p className="text-lg font-mono text-gray-900 text-left" dir="ltr">Reorder Point = (Daily Usage × Lead Time) + Safety Stock</p></div>
          <p>مثال: لو استهلاكك اليومي 10 كجم دجاج، والمورد يحتاج يومين للتسليم، وأمان أسبوع = 70 كجم، فنقطة إعادة الطلب = (10 × 2) + 70 = <strong>90 كجم</strong>. متى وصل المخزون لهذا الرقم، اطلب.</p>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">3. الوصفات هي العمود الفقري</h2>
          <p>بدون وصفات موثّقة لكل طبق، لا يمكنك حساب تكلفة الطبق الحقيقية ولا التحكم بالمخزون. كل وصفة يجب أن تحتوي:</p>
          <ul className="list-disc pr-6 space-y-2">
            <li>المكوّنات بالوحدات الصحيحة (جرامات، مل).</li>
            <li>نسبة العائد (Yield) لكل مكوّن.</li>
            <li>تكلفة المكوّن من آخر فاتورة شراء.</li>
            <li>إجمالي تكلفة الطبق + هامش الربح المستهدف.</li>
          </ul>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">4. الجرد الأسبوعي بـ 30 دقيقة</h2>
          <ol className="list-decimal pr-6 space-y-2">
            <li>اطبع قائمة الأصناف من النظام مرتّبة حسب موقع التخزين.</li>
            <li>شخصان: واحد يعدّ، الآخر يسجّل (لتقليل الخطأ).</li>
            <li>عُدّ الأصناف من المجموعة A فقط (5–10 أصناف).</li>
            <li>أدخل الأرقام في النظام، احسب الفرق مع المتوقع.</li>
            <li>أي فرق يتجاوز 2٪ يستحق التحقيق صباح اليوم التالي.</li>
          </ol>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">5. الربط مع المحاسبة</h2>
          <p>كل حركة في المخزون يجب أن تنعكس في الدفاتر تلقائياً:</p>
          <ul className="list-disc pr-6 space-y-2">
            <li><strong>شراء:</strong> مدين المخزون (1300) / دائن الذمم الدائنة (2100).</li>
            <li><strong>استهلاك (بيع):</strong> مدين COGS (5100) / دائن المخزون (1300).</li>
            <li><strong>هدر:</strong> مدين الهدر (6100) / دائن المخزون (1300).</li>
            <li><strong>تسوية جرد:</strong> مدين/دائن فروق الجرد (5150) مقابل المخزون.</li>
          </ul>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">الأخطاء الخمسة الأكثر شيوعاً</h2>
          <ol className="list-decimal pr-6 space-y-2">
            <li>الاعتماد على الذاكرة بدلاً من نقطة إعادة الطلب.</li>
            <li>عدّ المخزون شهرياً فقط — متأخر جداً.</li>
            <li>عدم تحديث تكلفة الوصفات مع تغيّر أسعار الموردين.</li>
            <li>تخزين زائد للأصناف "في حال احتجناها" → تلف وفاقد.</li>
            <li>عدم وجود سياسة استلام موثّقة (لا أحد يتحقق من وزن الفاتورة).</li>
          </ol>

          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-8 my-12 not-prose">
            <h3 className="text-xl font-semibold text-gray-900 mb-3">شغّل مخزونك مع Matbex</h3>
            <p className="text-gray-600 mb-6">وصفات، تكلفة لحظية، نقاط إعادة طلب، وجرد أسبوعي بمعالج — كلها في منصة واحدة.</p>
            <div className="flex flex-wrap gap-3 justify-end"><Button asChild className="bg-[#007a3d] hover:bg-[#006b33] text-white"><Link to="/register">ابدأ مجاناً</Link></Button></div>
          </div>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">مقالات ذات صلة</h2>
          <ul className="list-disc pr-6 space-y-2">
            <li><Link to="/ar/blog/prime-cost" className="text-[#00713A] underline">التكلفة الأساسية Prime Cost</Link></li>
            <li><Link to="/ar/blog/waste-control" className="text-[#00713A] underline">إدارة الهدر</Link></li>
            <li><Link to="/ar/blog/restaurant-kpis" className="text-[#00713A] underline">مؤشرات الأداء</Link></li>
          </ul>
        </article>
      </ArticleLayout>
    </>
  );
}