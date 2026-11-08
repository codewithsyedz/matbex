import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { RouteSeo } from "@/components/seo/RouteSeo";
import { ArticleLayout } from "@/components/marketing/ArticleLayout";

export default function ArBlogZatcaFines() {
  useEffect(() => {
    const p = document.documentElement.dir, l = document.documentElement.lang;
    document.documentElement.dir = "rtl"; document.documentElement.lang = "ar";
    return () => { document.documentElement.dir = p || "ltr"; document.documentElement.lang = l || "en"; };
  }, []);

  const title = "غرامات زاتكا وكيف تتجنّبها (دليل المطاعم 2026)";
  const description = "جدول كامل بغرامات الفوترة الإلكترونية في السعودية: المبالغ، شروط التضاعف، الأخطاء الأشهر التي تقع فيها المطاعم، وكيف تتجنّبها.";
  const path = "/ar/blog/zatca-fines";
  const url = `https://matbex.com${path}`;

  const faqs = [
    { q: "هل تُفرض الغرامة من أول مخالفة؟", a: "نعم. لا توجد فترة سماح بعد تاريخ الإلزام. لكن تطبيق الغرامة الفعلي يبدأ عادةً بإنذار من الهيئة، خاصة للمنشآت الصغيرة، ثم تتصاعد التطبيقات." },
    { q: "ما أكثر مخالفة شيوعاً في المطاعم؟", a: "عدم إصدار رمز QR على إيصال الكاشير. تحدث عادة بسبب إعدادات قديمة في الكاشير أو طابعة معطّلة. الحل: نظام يرفض الطباعة إذا فشل توليد الرمز." },
    { q: "هل التأخر في التخليص يعدّ مخالفة؟", a: "إذا تأخّر إرسال فاتورة B2C عن 24 ساعة من تاريخ الإصدار، تُعدّ مخالفة. لذا يجب أن يحوي النظام طابوراً يعيد الإرسال آلياً." },
    { q: "كم تبلغ الغرامة لعدم وجود نظام معتمد؟", a: "تبدأ من 5,000 ريال وتتضاعف بحسب حجم المنشأة وفترة المخالفة. تعليق الفوترة الإلكترونية يأتي عند تكرار المخالفة." },
    { q: "كيف أعرف إذا أصدر نظامي فواتير غير متوافقة؟", a: "راقب نسبة التخليص الناجح في لوحة الإدارة. أي رقم أقل من 99% علامة على مشكلة. Matbex يعرض هذه النسبة في لوحة المالك ويرسل تنبيهات فورية للفواتير الفاشلة." },
  ];

  const jsonLd = [
    { "@context": "https://schema.org", "@type": "Article", headline: title, description, inLanguage: "ar-SA", datePublished: "2026-06-02", author: { "@type": "Organization", name: "Matbex" }, publisher: { "@type": "Organization", name: "Matbex", logo: { "@type": "ImageObject", url: "https://matbex.com/og-image.png" } }, mainEntityOfPage: { "@type": "WebPage", "@id": url } },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "الرئيسية", item: "https://matbex.com/ar" },
      { "@type": "ListItem", position: 2, name: "زاتكا", item: "https://matbex.com/ar/zatca" },
      { "@type": "ListItem", position: 3, name: title, item: url },
    ]},
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map(f => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
  ];

  return (
    <>
      <RouteSeo title={title} description={description} path={path} ogType="article" />
      <Helmet>
        <html lang="ar" dir="rtl" />
        <link rel="alternate" hrefLang="ar" href={url} />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>
      <ArticleLayout eyebrow="زاتكا · الغرامات" title={title} meta="نُشر في 2 يونيو 2026 · 10 دقائق قراءة" rtl>
        <nav aria-label="Breadcrumb" className="text-xs text-gray-500 mb-6">
          <Link to="/ar" className="hover:text-[#00713A]">الرئيسية</Link>
          <span className="mx-2">/</span>
          <Link to="/ar/zatca" className="hover:text-[#00713A]">زاتكا</Link>
          <span className="mx-2">/</span><span className="text-gray-700">الغرامات</span>
        </nav>

        <article className="prose prose-lg max-w-none text-gray-700 leading-relaxed space-y-6 text-right">
          <p className="text-xl">
            غرامات زاتكا ليست رمزية — منشأة متوسطة قد تواجه مخالفات بمئات الآلاف من الريالات
            في شهر واحد إن لم يكن نظامها متوافقاً. هذا الدليل يشرح <strong>كل أنواع الغرامات</strong>،
            مقاديرها، وكيف تبني نظاماً يحميك من الوقوع فيها.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">جدول الغرامات الرسمي</h2>
          <div className="overflow-x-auto my-6 not-prose">
            <table className="w-full text-sm border border-gray-200 rounded-xl overflow-hidden">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-right p-3 font-semibold text-gray-900">المخالفة</th>
                  <th className="text-right p-3 font-semibold text-gray-900">الغرامة</th>
                </tr>
              </thead>
              <tbody className="text-gray-700">
                <tr className="border-t border-gray-100"><td className="p-3">عدم إصدار فاتورة إلكترونية أو إصدار يدوي</td><td className="p-3">5,000 – 50,000 ريال</td></tr>
                <tr className="border-t border-gray-100"><td className="p-3">عدم تضمين رمز QR في الفاتورة المبسّطة</td><td className="p-3">1,000 ريال لكل فاتورة</td></tr>
                <tr className="border-t border-gray-100"><td className="p-3">عدم إرسال فاتورة B2B للتخليص قبل التسليم</td><td className="p-3">5,000 – 50,000 ريال</td></tr>
                <tr className="border-t border-gray-100"><td className="p-3">عدم الإبلاغ عن فاتورة B2C خلال 24 ساعة</td><td className="p-3">1,000 ريال لكل فاتورة</td></tr>
                <tr className="border-t border-gray-100"><td className="p-3">عدم حفظ الفواتير لمدة 7 سنوات</td><td className="p-3">حتى 50,000 ريال</td></tr>
                <tr className="border-t border-gray-100"><td className="p-3">تعديل فاتورة بعد إصدارها (بدون إشعار دائن/مدين)</td><td className="p-3">حتى 50,000 ريال</td></tr>
                <tr className="border-t border-gray-100"><td className="p-3">منع المفتّش من الوصول للنظام</td><td className="p-3">حتى 50,000 ريال + تعليق</td></tr>
              </tbody>
            </table>
          </div>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">المضاعفات</h2>
          <ul className="list-disc pr-6 space-y-2">
            <li><strong>تكرار المخالفة</strong> خلال 12 شهراً يضاعف الغرامة.</li>
            <li><strong>المخالفة العَرَضية</strong> (مرّة واحدة بحُسن نية) قد تُعالَج بإنذار.</li>
            <li><strong>المخالفة المنهجية</strong> (تتكرّر يومياً) تؤدي إلى <em>تعليق</em> الفوترة الإلكترونية — أي إغلاق فعلي للمطعم.</li>
          </ul>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">٧ أخطاء يقع فيها المطاعم</h2>
          <ol className="list-decimal pr-6 space-y-2">
            <li><strong>طباعة إيصال بدون QR</strong> — بسبب طابعة معطلّة أو حجم ورق صغير.</li>
            <li><strong>إصدار فاتورة "مؤقّتة" يدوية</strong> عند انقطاع الإنترنت — مخالفة بحد ذاتها.</li>
            <li><strong>تأخير إرسال فواتير B2C</strong> لأكثر من 24 ساعة بسبب نسيان "إعادة الإرسال".</li>
            <li><strong>إلغاء فاتورة بحذفها</strong> من النظام بدلاً من إصدار إشعار دائن.</li>
            <li><strong>استخدام Excel</strong> أو نظام غير معتمد لإصدار الفواتير.</li>
            <li><strong>اختلاف رقم VAT</strong> بين النظام والسجل التجاري.</li>
            <li><strong>عدم تجديد شهادة CSID</strong> عند انتهائها (سنوياً).</li>
          </ol>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">كيف تبني نظاماً يحميك؟</h2>
          <ul className="list-disc pr-6 space-y-2">
            <li>اختر حلاً <strong>مُعتمداً رسمياً</strong> من الهيئة (تحقق من القائمة).</li>
            <li>تأكّد من وجود <strong>طابور احتياطي</strong> يعيد إرسال الفواتير الفاشلة.</li>
            <li>راقب <strong>نسبة التخليص</strong> يومياً — يجب أن تبقى ≥ 99%.</li>
            <li>فعّل <strong>التنبيهات</strong> على البريد/الواتساب لكل فاتورة مرفوضة.</li>
            <li>راجع <strong>تقرير زاتكا الشهري</strong> قبل نهاية الشهر، لا بعده.</li>
            <li>درّب الكاشيرز ألا يطبعوا فواتير يدوية مهما حدث.</li>
          </ul>

          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-8 my-12 not-prose">
            <h3 className="text-xl font-semibold text-gray-900 mb-3">Matbex يحميك من الغرامات</h3>
            <p className="text-gray-600 mb-6">طابور احتياطي تلقائي، تنبيه فوري لأي فاتورة فاشلة، ولوحة متابعة نسبة التخليص يومياً — كلها مدمجة.</p>
            <div className="flex flex-wrap gap-3 justify-end">
              <Button asChild className="bg-[#007a3d] hover:bg-[#006b33] text-white"><Link to="/register">ابدأ مجاناً</Link></Button>
              <Button asChild variant="outline"><Link to="/ar/zatca">دليل زاتكا الكامل</Link></Button>
            </div>
          </div>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">أسئلة شائعة</h2>
          <div className="space-y-6 not-prose">
            {faqs.map((f, i) => (
              <div key={i} className="border border-gray-200 rounded-xl p-6 text-right">
                <h3 className="text-base font-semibold text-gray-900 mb-2">{f.q}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{f.a}</p>
              </div>
            ))}
          </div>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">مقالات ذات صلة</h2>
          <ul className="list-disc pr-6 space-y-2">
            <li><Link to="/ar/blog/zatca-phase-2" className="text-[#00713A] underline">المرحلة الثانية: الدليل الكامل</Link></li>
            <li><Link to="/ar/blog/zatca-qr-code" className="text-[#00713A] underline">رمز QR في فواتير زاتكا</Link></li>
            <li><Link to="/ar/blog/zatca-onboarding" className="text-[#00713A] underline">خطوات التسجيل وربط CSID</Link></li>
          </ul>
        </article>
      </ArticleLayout>
    </>
  );
}
