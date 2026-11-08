import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { RouteSeo } from "@/components/seo/RouteSeo";
import { ArticleLayout } from "@/components/marketing/ArticleLayout";

export default function ArBlogZatcaPhase2() {
  useEffect(() => {
    const p = document.documentElement.dir, l = document.documentElement.lang;
    document.documentElement.dir = "rtl"; document.documentElement.lang = "ar";
    return () => { document.documentElement.dir = p || "ltr"; document.documentElement.lang = l || "en"; };
  }, []);

  const title = "زاتكا المرحلة الثانية للمطاعم: الدليل التقني الكامل (2026)";
  const description = "كل ما تحتاج معرفته عن تطبيق المرحلة الثانية من الفوترة الإلكترونية لمطعمك: المتطلبات، الجدول الزمني، الختم التشفيري، XML، ومنصة فاتورة.";
  const path = "/ar/blog/zatca-phase-2";
  const url = `https://matbex.com${path}`;

  const faqs = [
    { q: "متى يجب أن أطبّق المرحلة الثانية؟", a: "تطبّقها هيئة الزكاة والضريبة والجمارك على دفعات حسب حجم الإيرادات. الدفعة الأولى بدأت في 1 يناير 2023 للمنشآت التي تتجاوز إيراداتها 3 مليارات ريال، وتتوسّع لتشمل المنشآت الأصغر تدريجياً. ستصلك رسالة رسمية قبل 6 أشهر من تاريخ الإلزام." },
    { q: "ما الفرق بين المرحلة الأولى والثانية؟", a: "المرحلة الأولى (Generation) تطلب إصدار فاتورة إلكترونية بصيغة محددة وحفظها. المرحلة الثانية (Integration) تضيف الربط المباشر مع منصة فاتورة، الختم التشفيري بشهادة CSID، وإرسال XML للتخليص (B2B) أو الإبلاغ (B2C) لحظياً." },
    { q: "هل أحتاج لمزود زاتكا منفصل؟", a: "لا إذا استخدمت نظاماً مدمجاً مثل Matbex. الحلول المدمجة تتعامل مع الختم وXML والإرسال داخلياً، بدون عقد ثالث ولا فاتورة شهرية إضافية." },
    { q: "ماذا لو فشل الإرسال بسبب الإنترنت؟", a: "يجب أن يحتفظ النظام بالفاتورة في طابور محلي ويعيد الإرسال تلقائياً عند عودة الاتصال. خلال الفترة لا يجوز رفض البيع — الفاتورة تصدر للعميل مع رمز QR، وتُخلَّص لاحقاً." },
    { q: "ما هي عقوبات عدم الالتزام؟", a: "تبدأ من 1,000 ريال لكل مخالفة وتتصاعد للمنشآت المتكرّرة، مع احتمالية تعليق الفوترة الإلكترونية. الالتزام ليس اختيارياً." },
  ];

  const jsonLd = [
    { "@context": "https://schema.org", "@type": "Article", headline: title, description, inLanguage: "ar-SA", datePublished: "2026-06-02", dateModified: "2026-06-02", author: { "@type": "Organization", name: "Matbex" }, publisher: { "@type": "Organization", name: "Matbex", logo: { "@type": "ImageObject", url: "https://matbex.com/og-image.png" } }, mainEntityOfPage: { "@type": "WebPage", "@id": url } },
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
        <link rel="alternate" hrefLang="en" href="https://matbex.com/blog/zatca-phase-2-guide" />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>
      <ArticleLayout eyebrow="زاتكا · المرحلة الثانية" title={title} meta="نُشر في 2 يونيو 2026 · 14 دقيقة قراءة" rtl>
        <nav aria-label="Breadcrumb" className="text-xs text-gray-500 mb-6">
          <Link to="/ar" className="hover:text-[#00713A]">الرئيسية</Link>
          <span className="mx-2">/</span>
          <Link to="/ar/zatca" className="hover:text-[#00713A]">زاتكا</Link>
          <span className="mx-2">/</span><span className="text-gray-700">المرحلة الثانية</span>
        </nav>

        <article className="prose prose-lg max-w-none text-gray-700 leading-relaxed space-y-6 text-right">
          <p className="text-xl">
            المرحلة الثانية من <strong>الفوترة الإلكترونية</strong> ليست مجرد ترقية تقنية —
            هي تحوّل جوهري في طريقة إصدار وأرشفة الفواتير في السعودية. هذا الدليل العملي
            يشرح ما تحتاج معرفته كصاحب مطعم: المتطلبات، الجدول الزمني، الحلول، والأخطاء الشائعة.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">١. ما هي المرحلة الثانية بالضبط؟</h2>
          <p>
            المرحلة الثانية (Integration Phase) تُلزم المنشآت بربط نظامها مباشرة بمنصة <strong>فاتورة</strong>
            التابعة لهيئة الزكاة والضريبة والجمارك. كل فاتورة يجب أن تكون موقّعة بختم تشفيري (Cryptographic Stamp)،
            مُولّدة بصيغة UBL 2.1 (XML)، وتحمل رمز QR موقّعاً. الفواتير الضريبية (B2B) تُرسل للتخليص قبل تسليم الفاتورة للعميل،
            بينما الفواتير المبسطة (B2C) تُرسل للإبلاغ خلال 24 ساعة.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">٢. الجدول الزمني للتطبيق</h2>
          <p>
            هيئة الزكاة تطبّق المرحلة الثانية على <strong>موجات</strong>، بناءً على حجم الإيرادات السنوية:
          </p>
          <ul className="list-disc pr-6 space-y-2">
            <li>الموجة الأولى (1 يناير 2023): منشآت إيراداتها &gt; 3 مليار ريال.</li>
            <li>الموجة الثانية (1 يوليو 2023): إيرادات &gt; 500 مليون ريال.</li>
            <li>الموجات اللاحقة تتوسّع تدريجياً، وقد وصلت في 2026 إلى المنشآت ذات الإيرادات أقل من 10 مليون ريال.</li>
            <li>ستصلك رسالة رسمية من الهيئة قبل <strong>6 أشهر</strong> من تاريخ الإلزام.</li>
          </ul>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">٣. المتطلبات التقنية للحل</h2>
          <p>أي نظام كاشير معتمد للمرحلة الثانية يجب أن يدعم:</p>
          <ol className="list-decimal pr-6 space-y-2">
            <li><strong>توليد UBL 2.1 XML</strong> لكل فاتورة، بحقول إلزامية: VAT، رقم تعريف الفاتورة، التواريخ، الأصناف، الإجماليات.</li>
            <li><strong>الختم التشفيري ECDSA</strong> باستخدام شهادة CSID مُصدَّرة من الهيئة.</li>
            <li><strong>توليد رمز QR بصيغة TLV</strong> يحتوي 9 حقول مشفّرة (اسم البائع، الرقم الضريبي، التاريخ، المجموع، VAT، إلخ).</li>
            <li><strong>الإرسال إلى منصة فاتورة</strong> عبر API محدّد (Clearance لـ B2B، Reporting لـ B2C).</li>
            <li><strong>الأرشفة لمدة 7 سنوات</strong> بصيغة قابلة للتحقق والتدقيق.</li>
            <li><strong>طابور احتياطي</strong> عند انقطاع الاتصال، مع إعادة الإرسال آلياً.</li>
          </ol>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">٤. الحل المدمج vs المزود الثالث</h2>
          <p>
            أمامك خياران: نظام مدمج يدير زاتكا داخلياً (مثل Matbex)، أو نظام كاشير قديم يربط بمزوّد زاتكا خارجي.
            الحل المدمج أرخص (لا فاتورة شهرية إضافية)، أبسط (واجهة واحدة)، وأسرع تخليصاً (لا قفزة إضافية بين خادمين).
            المزوّد الثالث يصبح اضطرارياً فقط إذا كان نظامك القديم لا يمكن تطويره.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">٥. خطوات التطبيق العملية</h2>
          <ol className="list-decimal pr-6 space-y-2">
            <li>تحقّق من تاريخ الإلزام لمنشأتك في بوابة فاتورة.</li>
            <li>اختر حلاً مُعتمداً من الهيئة (تحقق من القائمة الرسمية).</li>
            <li>سجّل CSID للجهاز (شهادة Compliance ثم شهادة Production).</li>
            <li>اعمل اختبار Sandbox لعشر فواتير على الأقل.</li>
            <li>انتقل للإنتاج بعد توقيع نموذج التوافق.</li>
            <li>راقب نسبة التخليص الناجح يومياً — يجب أن تكون ≥ 99%.</li>
          </ol>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">٦. الأخطاء الشائعة (وكيف تتجنّبها)</h2>
          <ul className="list-disc pr-6 space-y-2">
            <li><strong>رقم ضريبي خاطئ في الإعدادات</strong> — كل الفواتير سترفضها فاتورة.</li>
            <li><strong>تاريخ الجهاز غير متزامن</strong> — يسبّب فشل الختم. فعّل NTP.</li>
            <li><strong>عدم إعادة إرسال الفواتير المتأخرة</strong> — تتراكم وتُحسب مخالفات.</li>
            <li><strong>تجاهل رسائل الفشل</strong> — كل فاتورة مرفوضة لها سبب وحل واضح في الاستجابة.</li>
          </ul>

          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-8 my-12 not-prose">
            <h3 className="text-xl font-semibold text-gray-900 mb-3">Matbex متوافق مع المرحلة الثانية — مجاناً</h3>
            <p className="text-gray-600 mb-6">إصدار XML، ختم تشفيري، QR موقّع، وإرسال فوري لمنصة فاتورة — كلها مدمجة بدون اشتراك إضافي.</p>
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
            <li><Link to="/ar/blog/zatca-qr-code" className="text-[#00713A] underline">رمز QR في فواتير زاتكا</Link></li>
            <li><Link to="/ar/blog/zatca-onboarding" className="text-[#00713A] underline">خطوات التسجيل وربط CSID</Link></li>
            <li><Link to="/ar/blog/zatca-fines" className="text-[#00713A] underline">غرامات زاتكا وكيف تتجنّبها</Link></li>
            <li><Link to="/ar/zatca" className="text-[#00713A] underline">دليل زاتكا الكامل</Link></li>
          </ul>
        </article>
      </ArticleLayout>
    </>
  );
}
