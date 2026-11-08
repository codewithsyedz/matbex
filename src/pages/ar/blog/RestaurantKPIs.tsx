import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { RouteSeo } from "@/components/seo/RouteSeo";
import { ArticleLayout } from "@/components/marketing/ArticleLayout";

export default function ArBlogRestaurantKPIs() {
  useEffect(() => {
    const p = document.documentElement.dir, l = document.documentElement.lang;
    document.documentElement.dir = "rtl"; document.documentElement.lang = "ar";
    return () => { document.documentElement.dir = p || "ltr"; document.documentElement.lang = l || "en"; };
  }, []);

  const title = "أهم 12 مؤشر أداء (KPI) يجب على كل صاحب مطعم متابعتها — 2026";
  const description = "دليل كامل لأهم مؤشرات أداء المطاعم: COGS، Prime Cost، متوسط الفاتورة، معدّل دوران الطاولة، رضا العميل، والمؤشرات المالية. مع النِسب المرجعية للسعودية.";
  const path = "/ar/blog/restaurant-kpis";
  const url = `https://matbex.com${path}`;

  const jsonLd = {
    "@context": "https://schema.org", "@type": "Article", headline: title, description,
    inLanguage: "ar-SA", datePublished: "2026-05-30",
    author: { "@type": "Organization", name: "Matbex" },
    publisher: { "@type": "Organization", name: "Matbex", logo: { "@type": "ImageObject", url: "https://matbex.com/og-image.png" } },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
  };

  const kpis = [
    { name: "تكلفة البضاعة %", formula: "COGS ÷ Net Sales", target: "28–35٪", freq: "يومي" },
    { name: "التكلفة الأساسية %", formula: "(COGS + Labor) ÷ Net Sales", target: "55–65٪", freq: "أسبوعي" },
    { name: "تكلفة العمالة %", formula: "Labor Cost ÷ Net Sales", target: "20–30٪", freq: "أسبوعي" },
    { name: "متوسط قيمة الفاتورة", formula: "Total Sales ÷ # of Checks", target: "حسب المفهوم", freq: "يومي" },
    { name: "معدّل دوران الطاولة", formula: "# of Parties ÷ Tables", target: "1.5–3 / وردية", freq: "يومي" },
    { name: "نسبة الهدر %", formula: "Waste Cost ÷ Purchases", target: "< 4٪", freq: "أسبوعي" },
    { name: "صافي هامش الربح %", formula: "Net Profit ÷ Net Sales", target: "8–15٪", freq: "شهري" },
    { name: "RevPASH (إيراد الكرسي/ساعة)", formula: "Sales ÷ (Seats × Hours)", target: "حسب الموقع", freq: "أسبوعي" },
    { name: "نسبة العائدين", formula: "Returning ÷ Total Customers", target: "> 30٪", freq: "شهري" },
    { name: "Break-even اليومي", formula: "Fixed Costs ÷ Daily Margin", target: "أقل من الإيراد الفعلي", freq: "شهري" },
    { name: "Inventory Turnover", formula: "COGS ÷ Avg Inventory", target: "4–8 شهرياً", freq: "شهري" },
    { name: "معدّل دوران الموظفين", formula: "Leavers ÷ Avg Headcount", target: "< 50٪ سنوياً", freq: "ربع سنوي" },
  ];

  return (
    <>
      <RouteSeo title={title} description={description} path={path} ogType="article" />
      <Helmet>
        <html lang="ar" dir="rtl" />
        <link rel="alternate" hrefLang="ar" href={url} />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>
      <ArticleLayout eyebrow="القياس · مؤشرات الأداء" title={title} meta="نُشر في 30 مايو 2026 · 14 دقيقة قراءة" rtl>

        <article className="prose prose-lg max-w-none text-gray-700 leading-relaxed space-y-6 text-right">
          <p className="text-xl">ما لا يُقاس لا يُدار. هذه قائمة الـ 12 مؤشراً التي يتابعها أصحاب المطاعم الناجحون في السعودية — مع الصيغ، النِسب المرجعية، ومعدّل المتابعة الصحيح لكل منها.</p>

          <section className="not-prose border border-gray-200 rounded-2xl overflow-hidden my-8">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-right p-3 font-semibold text-gray-900">المؤشر</th>
                  <th className="text-right p-3 font-semibold text-gray-900">الصيغة</th>
                  <th className="text-right p-3 font-semibold text-gray-900">النطاق المستهدف</th>
                  <th className="text-right p-3 font-semibold text-gray-900">التكرار</th>
                </tr>
              </thead>
              <tbody>
                {kpis.map((k, i) => (
                  <tr key={i} className="border-b border-gray-100 last:border-0">
                    <td className="p-3 text-gray-900 font-medium">{k.name}</td>
                    <td className="p-3 text-gray-600 font-mono text-xs" dir="ltr">{k.formula}</td>
                    <td className="p-3 text-[#00713A]">{k.target}</td>
                    <td className="p-3 text-gray-600">{k.freq}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">المؤشرات الثلاثة "غير القابلة للتفاوض"</h2>
          <ol className="list-decimal pr-6 space-y-3">
            <li><strong>تكلفة البضاعة اليومية:</strong> لو تجاوزت 35٪ يومين متتاليين، توقّف وحقّق. السبب دائماً واحد من ثلاثة: تقسيم، هدر، أو سرقة.</li>
            <li><strong>التكلفة الأساسية الأسبوعية:</strong> هي الرقم الذي يحدد إن كنت ستربح هذا الشهر أم لا. تجاوز 65٪ يعني أنك تعمل لصالح المورد والموظف، لا لصالحك.</li>
            <li><strong>صافي هامش الربح الشهري:</strong> لو أقل من 8٪ بشكل مستمر، النموذج لا يعمل. أعد التسعير أو غيّر المفهوم.</li>
          </ol>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">المؤشرات التشغيلية اليومية</h2>
          <ul className="list-disc pr-6 space-y-2">
            <li><strong>متوسط الفاتورة:</strong> ارتفاعه بدون زيادة عدد العملاء = نجاح Upsell. انخفاضه = ضغط على الموظفين أو تغيير في سلوك العميل.</li>
            <li><strong>دوران الطاولة:</strong> أهم من عدد المقاعد. مطعم 30 كرسي يدوّر 3 مرات أفضل من مطعم 60 كرسي يدوّر مرة.</li>
            <li><strong>RevPASH (إيراد الكرسي لكل ساعة):</strong> المؤشر السرّي للمطاعم الفاخرة. يربط الإيراد بالسعة الفعلية.</li>
          </ul>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">المؤشرات الاستراتيجية الشهرية</h2>
          <ul className="list-disc pr-6 space-y-2">
            <li><strong>نسبة العائدين:</strong> أرخص عميل هو الذي عاد. لو أقل من 30٪، المشكلة في تجربة العميل وليس في التسويق.</li>
            <li><strong>دوران المخزون:</strong> أقل من 4 يعني تخزين زائد. أعلى من 10 يعني نفاد متكرر.</li>
            <li><strong>دوران الموظفين:</strong> كل موظف يترك يكلّفك بين 4,000 و12,000 ريال (تدريب + إنتاجية مفقودة).</li>
          </ul>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">كيف تتابعها عملياً؟</h2>
          <ol className="list-decimal pr-6 space-y-2">
            <li><strong>لوحة يومية</strong> تُرسل للمالك صباحاً: مبيعات أمس، COGS، Prime Cost، أبرز الانحرافات.</li>
            <li><strong>مراجعة أسبوعية</strong> مع مدير الفرع: الأسبوع كله في صفحة واحدة.</li>
            <li><strong>إغلاق شهري</strong> خلال 3 أيام عمل من نهاية الشهر، لا 3 أسابيع.</li>
          </ol>

          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-8 my-12 not-prose">
            <h3 className="text-xl font-semibold text-gray-900 mb-3">احصل على لوحة الأداء جاهزة</h3>
            <p className="text-gray-600 mb-6">Matbex يحسب كل هذه المؤشرات تلقائياً ويرسل ملخّصاً يومياً للمالك على واتساب والإيميل.</p>
            <div className="flex flex-wrap gap-3 justify-end"><Button asChild className="bg-[#007a3d] hover:bg-[#006b33] text-white"><Link to="/register">ابدأ مجاناً</Link></Button></div>
          </div>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">مقالات ذات صلة</h2>
          <ul className="list-disc pr-6 space-y-2">
            <li><Link to="/ar/blog/prime-cost" className="text-[#00713A] underline">التكلفة الأساسية Prime Cost</Link></li>
            <li><Link to="/ar/blog/waste-control" className="text-[#00713A] underline">إدارة الهدر</Link></li>
            <li><Link to="/ar/blog/inventory-management" className="text-[#00713A] underline">إدارة المخزون</Link></li>
          </ul>
        </article>
      </ArticleLayout>
    </>
  );
}