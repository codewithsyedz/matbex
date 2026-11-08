import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { RouteSeo } from "@/components/seo/RouteSeo";
import { ArticleLayout } from "@/components/marketing/ArticleLayout";

export default function ArBlogZatcaQrCode() {
  useEffect(() => {
    const p = document.documentElement.dir, l = document.documentElement.lang;
    document.documentElement.dir = "rtl"; document.documentElement.lang = "ar";
    return () => { document.documentElement.dir = p || "ltr"; document.documentElement.lang = l || "en"; };
  }, []);

  const title = "رمز QR في فواتير زاتكا: كل ما تحتاج معرفته (2026)";
  const description = "شرح مفصّل لرمز QR في الفواتير الإلكترونية: ما يحتويه، صيغة TLV، طريقة التحقق، والأخطاء الشائعة في الطباعة والعرض.";
  const path = "/ar/blog/zatca-qr-code";
  const url = `https://matbex.com${path}`;

  const faqs = [
    { q: "ما الذي يحتويه رمز QR؟", a: "في المرحلة الأولى يحتوي 5 حقول (اسم البائع، الرقم الضريبي، التاريخ، المجموع، VAT). في المرحلة الثانية تُضاف 4 حقول: تجزئة الفاتورة (Hash)، الختم التشفيري، المفتاح العام، وتوقيع الهيئة." },
    { q: "لماذا يفشل التحقق من بعض الرموز؟", a: "أكثر الأسباب شيوعاً: تشفير TLV غير صحيح، حقل ناقص، تاريخ بصيغة خاطئة (يجب ISO 8601)، أو ختم تشفيري قديم. كل تطبيقات التحقق تستخدم نفس مكتبة الهيئة، فالخطأ دائماً من الإصدار لا من القارئ." },
    { q: "هل يجب طباعة الرمز ملوناً؟", a: "لا. أبيض وأسود يكفي، بشرط أن يكون التباين كافياً وألا يقل العرض عن 2 سم على الإيصالات الحرارية. الطابعات منخفضة الجودة قد تشوّه الرمز." },
    { q: "كيف يتحقق العميل من فاتورتي؟", a: "بفتح كاميرا الهاتف وتوجيهها للرمز. يعرض الهاتف بيانات الفاتورة مباشرة. للمرحلة الثانية يفتح صفحة تحقق رسمية في بوابة فاتورة تؤكّد أصالة الفاتورة." },
    { q: "هل يمكن طباعة الفاتورة بدون QR؟", a: "لا. أي فاتورة مبسطة (B2C) بدون QR ساري المفعول تُعدّ مخالفة. النظام يجب أن يرفض الطباعة إن فشل توليد الرمز." },
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
      <ArticleLayout eyebrow="زاتكا · رمز QR" title={title} meta="نُشر في 2 يونيو 2026 · 8 دقائق قراءة" rtl>
        <nav aria-label="Breadcrumb" className="text-xs text-gray-500 mb-6">
          <Link to="/ar" className="hover:text-[#00713A]">الرئيسية</Link>
          <span className="mx-2">/</span>
          <Link to="/ar/zatca" className="hover:text-[#00713A]">زاتكا</Link>
          <span className="mx-2">/</span><span className="text-gray-700">رمز QR</span>
        </nav>

        <article className="prose prose-lg max-w-none text-gray-700 leading-relaxed space-y-6 text-right">
          <p className="text-xl">
            رمز QR على فاتورتك ليس مجرد صورة جميلة — هو <strong>ختم رقمي</strong> يحوي بيانات الفاتورة موقّعة
            من نظامك، ويستطيع أي شخص (عميل، مفتّش، محاسب) قراءته خلال ثانيتين والتحقق من صحته.
            هذا الدليل يفكّ شيفرة ما بداخل هذا المربع الصغير.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">صيغة TLV (Tag-Length-Value)</h2>
          <p>
            رموز QR في زاتكا لا تستخدم نصاً عادياً — بل تنسيقاً ثنائياً بسيطاً يسمى TLV: لكل حقل ثلاث قِيَم
            (الرقم التعريفي، طوله، قيمته)، ثم تُسلسل كلها وتُشفّر بـ Base64.
          </p>
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 not-prose my-6" dir="ltr">
            <pre className="text-sm text-gray-800 overflow-x-auto"><code>{`Tag 1: Seller name        e.g. "مطعم نجد"
Tag 2: VAT registration   e.g. "310123456700003"
Tag 3: Timestamp          e.g. "2026-06-02T14:30:00Z"
Tag 4: Invoice total      e.g. "115.00"
Tag 5: VAT amount         e.g. "15.00"
Tag 6: Invoice hash       (Phase 2)
Tag 7: ECDSA signature    (Phase 2)
Tag 8: Public key         (Phase 2)
Tag 9: ZATCA signature    (Phase 2)`}</code></pre>
          </div>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">الفرق بين المرحلة الأولى والثانية</h2>
          <ul className="list-disc pr-6 space-y-2">
            <li><strong>المرحلة الأولى:</strong> 5 حقول فقط. يكفي إثبات أن الفاتورة صدرت من النظام.</li>
            <li><strong>المرحلة الثانية:</strong> 9 حقول. تُضاف تجزئة الفاتورة، ختمها، مفتاحها العام، وتوقيع الهيئة (يأتي مع استجابة التخليص).</li>
          </ul>
          <p>في المرحلة الثانية، التحقق من الرمز يفتح <strong>صفحة رسمية</strong> في بوابة فاتورة تؤكد أن الفاتورة فعلاً سُجّلت لدى الهيئة، وليس فقط أنها صدرت من النظام.</p>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">أين يجب أن يظهر الرمز؟</h2>
          <ol className="list-decimal pr-6 space-y-2">
            <li><strong>إيصال الكاشير الحراري:</strong> في أعلى الإيصال أو أسفله، بعرض ≥ 2 سم.</li>
            <li><strong>الفاتورة الورقية A4 (B2B):</strong> في الزاوية العلوية اليمنى، بعرض ≥ 4 سم.</li>
            <li><strong>الفاتورة الإلكترونية PDF/Email:</strong> داخل الـ PDF وفي نص الإيميل.</li>
            <li><strong>شاشة العميل (CFD):</strong> يفضّل عرض الرمز قبل الدفع، بحيث يقرأه العميل من شاشته.</li>
          </ol>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">أخطاء شائعة في الطباعة</h2>
          <ul className="list-disc pr-6 space-y-2">
            <li>طابعة منخفضة الكثافة (DPI &lt; 200) تشوّه الرمز.</li>
            <li>درجة حرارة طباعة منخفضة تنتج رمزاً باهتاً يفشل المسح.</li>
            <li>ورق إيصال قديم/مصفرّ يقلل التباين.</li>
            <li>طي الإيصال على الرمز يدمّر قابليته للقراءة.</li>
          </ul>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">كيف تتحقق بنفسك؟</h2>
          <p>افتح كاميرا الآيفون أو أي تطبيق ماسح QR. إن رأيت نصاً مفهوماً ببيانات الفاتورة، الرمز صحيح للمرحلة الأولى. للتحقق من المرحلة الثانية، استخدم بوابة فاتورة الرسمية: تفتح الصفحة وتعرض حالة الفاتورة (مخلّصة/مرفوضة) واسم البائع.</p>

          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-8 my-12 not-prose">
            <h3 className="text-xl font-semibold text-gray-900 mb-3">رمز QR صحيح في كل فاتورة Matbex</h3>
            <p className="text-gray-600 mb-6">Matbex يولّد TLV قياسياً ويختم كل فاتورة بشهادة CSID المُسجّلة لجهازك. لا حاجة لإعداد تقني.</p>
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
            <li><Link to="/ar/blog/zatca-onboarding" className="text-[#00713A] underline">خطوات التسجيل وربط CSID</Link></li>
            <li><Link to="/ar/blog/zatca-fines" className="text-[#00713A] underline">غرامات زاتكا وكيف تتجنّبها</Link></li>
          </ul>
        </article>
      </ArticleLayout>
    </>
  );
}
