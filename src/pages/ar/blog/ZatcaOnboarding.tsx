import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { RouteSeo } from "@/components/seo/RouteSeo";
import { ArticleLayout } from "@/components/marketing/ArticleLayout";

export default function ArBlogZatcaOnboarding() {
  useEffect(() => {
    const p = document.documentElement.dir, l = document.documentElement.lang;
    document.documentElement.dir = "rtl"; document.documentElement.lang = "ar";
    return () => { document.documentElement.dir = p || "ltr"; document.documentElement.lang = l || "en"; };
  }, []);

  const title = "خطوات تسجيل CSID وربط مطعمك بمنصة فاتورة (2026)";
  const description = "دليل تطبيقي خطوة بخطوة لتسجيل شهادة CSID، اجتياز اختبارات Sandbox، والانتقال إلى الإنتاج على منصة فاتورة — مع لقطات للأخطاء الشائعة وحلولها.";
  const path = "/ar/blog/zatca-onboarding";
  const url = `https://matbex.com${path}`;

  const faqs = [
    { q: "كم تستغرق عملية التسجيل؟", a: "مع نظام مدمج مثل Matbex: 5–10 دقائق للجهاز الواحد. مع المزوّدين الخارجيين: عدة أيام بسبب تبادل المفاتيح يدوياً." },
    { q: "هل أحتاج CSID لكل جهاز كاشير؟", a: "نعم. كل جهاز يصدر فواتير يجب أن يكون مرتبطاً بشهادة Production CSID مستقلة، مرتبطة برقم تعريفي خاص بالجهاز (Device ID)." },
    { q: "ما الفرق بين Compliance CSID و Production CSID؟", a: "Compliance: شهادة اختبار تستخدم في بيئة Sandbox للتأكد من توافق نظامك. Production: شهادة فعلية للإنتاج، تُصدر بعد اجتياز اختبارات Compliance بنجاح." },
    { q: "ما هو OTP في عملية التسجيل؟", a: "رمز يُولَّد من بوابة فاتورة لمنشأتك، صالح لـ 60 دقيقة. تنسخه إلى النظام ليُولّد طلب CSR ويُرسله للهيئة. كل جهاز يحتاج OTP منفصلاً." },
    { q: "هل أحتاج لتجديد الشهادة؟", a: "Compliance CSID: لا حاجة لتجديد، يُستبدل بـ Production CSID. Production CSID: صالح لسنة، يجب تجديده تلقائياً قبل الانتهاء (Matbex يفعل ذلك تلقائياً)." },
  ];

  const jsonLd = [
    { "@context": "https://schema.org", "@type": "Article", headline: title, description, inLanguage: "ar-SA", datePublished: "2026-06-02", author: { "@type": "Organization", name: "Matbex" }, publisher: { "@type": "Organization", name: "Matbex", logo: { "@type": "ImageObject", url: "https://matbex.com/og-image.png" } }, mainEntityOfPage: { "@type": "WebPage", "@id": url } },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "الرئيسية", item: "https://matbex.com/ar" },
      { "@type": "ListItem", position: 2, name: "زاتكا", item: "https://matbex.com/ar/zatca" },
      { "@type": "ListItem", position: 3, name: title, item: url },
    ]},
    { "@context": "https://schema.org", "@type": "HowTo", name: title, description, step: [
      { "@type": "HowToStep", name: "إنشاء حساب في بوابة فاتورة", text: "ادخل بوابة فاتورة بحساب نفاذ الوطني الموحّد المرتبط بالمنشأة." },
      { "@type": "HowToStep", name: "توليد OTP", text: "أنشئ OTP صالح لـ 60 دقيقة لكل جهاز تريد تسجيله." },
      { "@type": "HowToStep", name: "إصدار Compliance CSID", text: "أدخل OTP في نظامك وأرسل طلب CSR لاستلام شهادة الاختبار." },
      { "@type": "HowToStep", name: "اجتياز اختبارات Sandbox", text: "أرسل 10 فواتير تجريبية على الأقل (مبسطة وضريبية) بنجاح." },
      { "@type": "HowToStep", name: "ترقية إلى Production CSID", text: "بعد اجتياز Compliance، النظام يطلب Production CSID تلقائياً." },
      { "@type": "HowToStep", name: "تفعيل البيع الفعلي", text: "ابدأ إصدار فواتير حقيقية واطمئن لنسبة التخليص ≥ 99%." },
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
      <ArticleLayout eyebrow="زاتكا · التسجيل والربط" title={title} meta="نُشر في 2 يونيو 2026 · 12 دقيقة قراءة" rtl>
        <nav aria-label="Breadcrumb" className="text-xs text-gray-500 mb-6">
          <Link to="/ar" className="hover:text-[#00713A]">الرئيسية</Link>
          <span className="mx-2">/</span>
          <Link to="/ar/zatca" className="hover:text-[#00713A]">زاتكا</Link>
          <span className="mx-2">/</span><span className="text-gray-700">التسجيل والربط</span>
        </nav>

        <article className="prose prose-lg max-w-none text-gray-700 leading-relaxed space-y-6 text-right">
          <p className="text-xl">
            ربط نظامك بمنصة فاتورة يبدو معقّداً من بعيد — لكنّه في الواقع <strong>6 خطوات</strong>
            يمكن إنهاؤها في أقل من ساعة بشرط أن يكون نظامك مدمج. هذا الدليل التطبيقي يشرح كل خطوة،
            مع نقاط الفشل الشائعة وحلولها.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">قبل البدء: ما تحتاجه</h2>
          <ul className="list-disc pr-6 space-y-2">
            <li>حساب نفاذ وطني موحّد مرتبط بمنشأتك.</li>
            <li>الرقم الضريبي (VAT) صحيح ومُحدّث في الهيئة.</li>
            <li>نظام كاشير معتمد للمرحلة الثانية (Matbex أحدها).</li>
            <li>اتصال إنترنت مستقر (للأجهزة التي ستصدر فواتير).</li>
          </ul>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">الخطوة ١: إنشاء حساب في بوابة فاتورة</h2>
          <p>
            ادخل بوابة فاتورة (<span dir="ltr">fatoora.zatca.gov.sa</span>) عبر نفاذ. ستظهر منشأتك تلقائياً.
            انتقل إلى <em>إدارة الأجهزة</em>. إذا كان مطعمك يحوي 3 كاشيرات، ستسجّل 3 أجهزة منفصلة.
          </p>
          <p className="text-sm text-gray-500"><strong>مشكلة شائعة:</strong> رؤية رسالة "المنشأة غير مفعّلة" — السبب غالباً أن الرقم الضريبي قديم. تواصل مع الهيئة لتفعيله.</p>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">الخطوة ٢: توليد OTP لكل جهاز</h2>
          <p>
            من شاشة الأجهزة، اضغط <em>إضافة جهاز جديد</em>. ستحصل على OTP من 6 أرقام صالح <strong>60 دقيقة فقط</strong>.
            هذا OTP يربط الجهاز فيزيائياً بمنشأتك. كل جهاز يحتاج OTP منفصل.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">الخطوة ٣: إدخال OTP في نظامك</h2>
          <p>
            في Matbex: انتقل إلى <em>الإعدادات &gt; زاتكا &gt; تسجيل جهاز جديد</em>، ألصق OTP، واضغط <em>تسجيل</em>.
            النظام يولّد طلب CSR (Certificate Signing Request)، يرسله للهيئة، ويستلم Compliance CSID خلال ثوانٍ.
          </p>
          <p className="text-sm text-gray-500"><strong>مشكلة شائعة:</strong> "OTP منتهي الصلاحية" — أعد توليده من بوابة فاتورة. لا تنسخ OTP لاستخدامه لاحقاً.</p>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">الخطوة ٤: اجتياز اختبارات Sandbox</h2>
          <p>
            النظام يطلب منك إصدار 10 فواتير تجريبية على الأقل. تختلط بين فواتير مبسطة (B2C) وضريبية (B2B)،
            مع خصومات وضرائب مختلفة. Matbex يولّدها تلقائياً عند الطلب. النتيجة: تقرير اجتياز بنسبة 100% أو قائمة بالأخطاء.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">الخطوة ٥: ترقية إلى Production CSID</h2>
          <p>
            بعد نجاح Sandbox، يطلب النظام تلقائياً Production CSID. هذه الشهادة <strong>للإنتاج الفعلي</strong>،
            وتُستخدم لختم كل فاتورة حقيقية. لا حاجة لتدخّل يدوي — العملية فورية.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">الخطوة ٦: التفعيل الفعلي والمراقبة</h2>
          <p>
            ابدأ بإصدار فاتورة حقيقية. تأكّد من ظهور رمز QR على الإيصال، ومن أن لوحة زاتكا تعرض <strong>"مخلّصة"</strong>.
            راقب نسبة التخليص اليومية — أي رقم أقل من 99% علامة على مشكلة (اتصال، إعدادات، أو شهادة).
            Matbex يُرسل تنبيهاً فورياً لأي فاتورة فاشلة عبر البريد والإشعار في النظام.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">ماذا يحدث بعد سنة؟</h2>
          <p>
            Production CSID صالحة لسنة واحدة. Matbex يجدّدها تلقائياً قبل انتهائها بـ 30 يوماً — لا حاجة لتدخّلك.
            مع المزوّدين الخارجيين، عليك تذكّر التجديد يدوياً، وإلا توقفت الفوترة فجأة.
          </p>

          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-8 my-12 not-prose">
            <h3 className="text-xl font-semibold text-gray-900 mb-3">سجّل جهازك في 5 دقائق</h3>
            <p className="text-gray-600 mb-6">Matbex يدير دورة CSID كاملة من داخل النظام — التسجيل، Sandbox، Production، والتجديد التلقائي.</p>
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
            <li><Link to="/ar/blog/zatca-fines" className="text-[#00713A] underline">غرامات زاتكا وكيف تتجنّبها</Link></li>
          </ul>
        </article>
      </ArticleLayout>
    </>
  );
}
