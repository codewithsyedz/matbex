import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { useEffect } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RouteSeo } from "@/components/seo/RouteSeo";
import { PageTransition } from "@/components/PageTransition";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";

/** صفحة عربية: Matbex مقابل Foodics — دليل مفصّل لأصحاب المطاعم السعودية. */
export default function ArVsFoodics() {
  useEffect(() => {
    const p = document.documentElement.dir, l = document.documentElement.lang;
    document.documentElement.dir = "rtl"; document.documentElement.lang = "ar";
    return () => { document.documentElement.dir = p || "ltr"; document.documentElement.lang = l || "en"; };
  }, []);

  const title = "Matbex مقابل Foodics — مقارنة شاملة لأنظمة المطاعم في السعودية (2026)";
  const description =
    "مقارنة عملية وصريحة بين Matbex وFoodics للمطاعم السعودية: الكاشير، زاتكا المرحلة الثانية، تكلفة البضاعة اللحظية، المحاسبة المزدوجة، الرواتب، التسعير، والهجرة من Foodics.";
  const path = "/ar/vs/foodics";
  const url = `https://matbex.com${path}`;

  const rows: Array<{ feature: string; matbex: string | true; rival: string | true | false; note?: string }> = [
    { feature: "كاشير سريع لـ iPad / Android / Windows", matbex: true, rival: true },
    { feature: "زاتكا المرحلة الثانية — مدمج بدون مزود خارجي", matbex: true, rival: "بإضافة" },
    { feature: "محاسبة مزدوجة القيد كاملة (P&L، ميزانية، يومية)", matbex: true, rival: false, note: "Foodics يحتاج تصدير لبرنامج محاسبي خارجي." },
    { feature: "تكلفة بضاعة لحظية (Theoretical COGS) لكل بيع", matbex: true, rival: "محدودة" },
    { feature: "جرد أسبوعي بمعالج (Wizard) للأصناف عالية التكلفة", matbex: true, rival: false },
    { feature: "إدارة الموظفين، الورديات، السلف، والرواتب", matbex: true, rival: "منفصلة (Foodics HQ)" },
    { feature: "بناء موقع ويب وقائمة طعام مباشرة", matbex: true, rival: false },
    { feature: "دعم عربي / إنجليزي كامل (RTL/LTR)", matbex: true, rival: true },
    { feature: "تجربة مجانية 14 يوماً بدون بطاقة", matbex: true, rival: false },
    { feature: "تسعير شفّاف بالريال السعودي", matbex: true, rival: "عرض سعر" },
    { feature: "دعم بشري بالعربية في نفس اليوم", matbex: true, rival: "تذاكر" },
  ];

  const faqs = [
    { q: "هل Matbex بديل حقيقي لـ Foodics في السعودية؟", a: "نعم. يغطي Matbex كل ما يحتاجه مشغّل مطعم سعودي من Foodics — كاشير، شاشة مطبخ، مخزون، مدفوعات، ربط بمنصات التوصيل — ويضيف عليه زاتكا المرحلة الثانية، محاسبة مزدوجة القيد كاملة، رواتب، وبناء موقع، كل ذلك ضمن اشتراك واحد." },
    { q: "هل زاتكا المرحلة الثانية مدمجة فعلاً؟", a: "نعم. يصدر Matbex فاتورة UBL 2.1 موقّعة بشهادة CSID المصدّرة من هيئة الزكاة، يدمج QR موقّعاً، ويرسلها مباشرة إلى منصة فاتورة (Fatoora) للتخليص (B2B) أو الإبلاغ (B2C) لحظياً — بدون أي مزوّد ثالث ولا اشتراك إضافي." },
    { q: "ما تكلفة Matbex مقارنة بـ Foodics؟", a: "Foodics يبدأ من 423 ريال/شهر، والمحاسبة والمخزون من باقة Basic بـ 801 ريال. Matbex يبدأ من 149 ريال، وخطة Growth الشاملة بـ 349 ريال/شهر للفرع، تشمل زاتكا والمحاسبة والرواتب." },
    { q: "كيف أنقل بياناتي من Foodics إلى Matbex؟", a: "نستورد قائمتك ووصفاتك ومخزونك ومورّديك وتاريخ مبيعاتك حتى 24 شهراً من ملفات تصدير Foodics. غالباً تكتمل هجرة الفرع الواحد في 48 ساعة. للسلاسل ننفّذ تشغيلاً تجريبياً أسبوعين قبل التحويل الكامل." },
    { q: "هل يعمل Matbex على أجهزتي الحالية؟", a: "نعم. يعمل على iPad وAndroid وWindows وأجهزة الكاشير الحرارية، ويدعم طابعات ESC/POS، أدراج كاش USB/Bluetooth، شاشة العميل، وطباعة الشبكة عبر QZ Tray — نفس الأجهزة التي يستخدمها Foodics." },
  ];

  const jsonLd = [
    { "@context": "https://schema.org", "@type": "Article", headline: title, description, inLanguage: "ar-SA", datePublished: "2026-05-30", dateModified: "2026-06-02", author: { "@type": "Organization", name: "Matbex" }, publisher: { "@type": "Organization", name: "Matbex", logo: { "@type": "ImageObject", url: "https://matbex.com/og-image.png" } }, mainEntityOfPage: { "@type": "WebPage", "@id": url } },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "الرئيسية", item: "https://matbex.com/ar" },
      { "@type": "ListItem", position: 2, name: "مقارنات", item: "https://matbex.com/ar/vs/foodics" },
      { "@type": "ListItem", position: 3, name: "Matbex مقابل Foodics", item: url },
    ]},
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map(f => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
  ];

  return (
    <PageTransition className="min-h-screen bg-white">
      <RouteSeo title={title} description={description} path={path} ogType="article" />
      <Helmet>
        <html lang="ar" dir="rtl" />
        <link rel="alternate" hrefLang="ar" href={url} />
        <link rel="alternate" hrefLang="en" href="https://matbex.com/sa/foodics-alternative" />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>

      <LandingHeader />

      <main className="max-w-4xl mx-auto px-6 py-20 text-right">
        <nav aria-label="Breadcrumb" className="text-xs text-gray-500 mb-6">
          <Link to="/ar" className="hover:text-[#00713A]">الرئيسية</Link>
          <span className="mx-2">/</span><span>مقارنات</span>
          <span className="mx-2">/</span><span className="text-gray-700">Matbex مقابل Foodics</span>
        </nav>
        <p className="text-xs font-semibold tracking-widest text-[#00713A] uppercase mb-4">مقارنة · أنظمة المطاعم</p>
        <h1 className="text-4xl md:text-5xl font-light tracking-tight text-gray-900 leading-tight mb-6">
          Matbex مقابل Foodics — أيهما الأنسب لمطعمك؟
        </h1>
        <p className="text-lg text-gray-600 mb-12 leading-relaxed">
          Foodics من أوائل أنظمة الكاشير في السعودية، ويملك قاعدة عملاء واسعة. Matbex منصة
          أحدث، مبنية من الصفر لتجمع <strong>الكاشير + زاتكا + المحاسبة + المخزون + الرواتب</strong>
          في اشتراك واحد بدون أدوات منفصلة. هذه المقارنة موضوعية ومفصّلة، تساعدك على اتخاذ القرار في 2026.
        </p>

        <section className="border border-gray-200 rounded-2xl overflow-hidden mb-12">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200"><tr>
              <th className="text-right p-4 font-semibold text-gray-900">الميزة</th>
              <th className="text-center p-4 font-semibold text-[#00713A]">Matbex</th>
              <th className="text-center p-4 font-semibold text-gray-600">Foodics</th></tr></thead>
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
            إذا كنت تدير سلسلة كبيرة (15+ فرعاً) ولديك قسم محاسبة منفصل يستخدم برنامجاً مستقلاً،
            فبيئة Foodics الناضجة قد تخدمك. أما إذا كنت تدير من فرع إلى عشرة فروع داخل السعودية
            وتريد منصة واحدة تجمع كل شيء بسعر مفهوم وبدعم عربي مباشر، فـ Matbex مصمَّم تحديداً لهذه الحالة،
            وتكلفته الفعلية أقل بنسبة 60–75% بعد جمع وحدات Foodics المنفصلة.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">١. زاتكا المرحلة الثانية</h2>
          <p>
            لم يعد التطبيق اختيارياً. كل فاتورة B2B (وأغلب فواتير B2C) يجب إصدارها بصيغة UBL 2.1،
            توقيعها بختم تشفيري من هيئة الزكاة، تضمين QR موقّع، ثم تخليصها (B2B) أو الإبلاغ عنها (B2C)
            عبر منصة فاتورة لحظياً. Foodics يعتمد على مزوّد خارجي يُفوتَر بشكل مستقل لكل فرع.
            Matbex يدير الدورة كاملة داخلياً — من تسجيل CSID وحتى أرشفة XML المختوم — بدون فاتورة إضافية ولا عقد منفصل.
            تفاصيل تقنية كاملة في <Link to="/sa/zatca-e-invoicing" className="text-[#00713A] underline">دليل زاتكا المرحلة الثانية</Link>.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">٢. عمق المحاسبة</h2>
          <p>
            Foodics يصدّر إلى Xero أو QuickBooks. Matbex يحوي محاسبة مزدوجة القيد كاملة: قائمة حسابات
            مطابقة للمعايير السعودية، قيود يومية تلقائية لكل بيع وشراء، ترحيل تكلفة البضاعة المباعة عند الاستهلاك،
            رواتب باستحقاق، ذمم موردين، ذمم عملاء، سجل تدقيق غير قابل للتعديل، إقفال شهري، وقوائم
            P&L والميزانية وميزان المراجعة قابلة للطباعة. محاسبك يعمل على نفس النظام الذي يعمل عليه الكاشير —
            بدون ملفات Excel وبدون تأخير.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">٣. تكلفة البضاعة المباعة لحظياً</h2>
          <p>
            Foodics يحتسب COGS بعد الجرد الشهري. Matbex يحسب COGS النظرية مع كل بيع: لو شاورما الدجاج
            تستهلك 180 جراماً من الدجاج بسعر 24 ريال/كجم، يخصم النظام فوراً 180 جراماً ويُرحِّل 4.32 ريالاً
            إلى حساب 5100 (COGS). ترى نسبة تكلفة الطعام الحقيقية على نفس لوحة المبيعات — لا تنتظر ثلاثة أسابيع.
            للاستزادة: <Link to="/blog/restaurant-cogs-guide-ksa" className="text-[#00713A] underline">دليل COGS للمطاعم السعودية</Link>.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">٤. الموظفون والرواتب والسلف</h2>
          <p>
            Foodics يحتاج اشتراكاً منفصلاً (Foodics HQ) لإدارة الموظفين، ولا يغطي الرواتب فعلياً.
            Matbex يدير الورديات، يطبع جدول الدوام، يحسب الراتب الأساسي ناقص السُّلَف المعلّقة، ويرحّل قيد
            الرواتب آلياً (مدين 6200، دائن 1150) في نهاية كل شهر.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">٥. السعر — الرقم الحقيقي</h2>
          <p>
            Foodics يبدأ بعرض سعر يتجاوز عادة 299 ريالاً للكاشير وحده، ثم تُضاف 99–149 ريالاً للمخزون،
            99 ريالاً للولاء، 50–100 ريالاً لتكامل زاتكا، إضافةً إلى تكلفة برنامج محاسبي خارجي.
            الفرع الواحد قد يصل إلى 750–900 ريال/شهر للحزمة الكاملة. خطة Matbex Growth الشاملة بـ
            <strong> 349 ريال/شهر للفرع</strong>، مع تجربة مجانية 14 يوماً. قارن الخطط في
            <Link to="/pricing" className="text-[#00713A] underline"> صفحة الأسعار</Link>.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">٦. خطة الهجرة من Foodics</h2>
          <p>
            تستطيع تصدير قائمتك ومعدِّلاتها ووصفاتك ومخزونك ومورديك وتاريخ مبيعاتك من Foodics بصيغة CSV.
            يستورد Matbex القائمة والوصفات مباشرة، يربط المعدِّلات، ويعيد تشغيل ما يصل إلى 24 شهراً من
            المبيعات لتبقى تقاريرك متصلة. التحويل المعتاد للفرع الواحد ليلة سبت إلى صباح أحد.
            للسلاسل: نشغّل فرعاً تجريبياً 1–2 أسبوع قبل التعميم.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">متى يكون Foodics الخيار الأنسب؟</h2>
          <p>
            سلسلة كبيرة جداً (15+ فرعاً)، فريق محاسبة منفصل يستخدم برنامجاً مستقلاً، وفريق IT داخلي
            قادر على إدارة مزوّد زاتكا خارجي وعقود متعدّدة.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">متى يكون Matbex الخيار الأذكى؟</h2>
          <ul className="list-disc pr-6 space-y-2">
            <li>تريد <strong>منصة واحدة</strong> تجمع الكاشير والمحاسبة وزاتكا والمخزون والرواتب.</li>
            <li>تبحث عن <strong>تكلفة بضاعة لحظية</strong> بدلاً من تقارير شهرية متأخرة.</li>
            <li>تريد <strong>بدء مجاني</strong> دون التزام طويل ولا عرض سعر.</li>
            <li>لديك من فرع إلى عشرة فروع وتريد رؤية رقم الربح اليومي قبل النوم.</li>
            <li>تريد دعماً بشرياً بالعربية في نفس اليوم — لا تذاكر تبقى أياماً.</li>
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
            <h3 className="text-xl font-semibold text-gray-900 mb-3">جرّب Matbex مجاناً</h3>
            <p className="text-gray-600 mb-6">ابدأ بحسابك المجاني — بدون بطاقة، بدون التزام.</p>
            <div className="flex flex-wrap gap-3 justify-end">
              <Button asChild className="bg-[#007a3d] hover:bg-[#006b33] text-white"><Link to="/register">ابدأ مجاناً</Link></Button>
              <Button asChild variant="outline"><Link to="/ar">العودة للرئيسية</Link></Button>
              <Button asChild variant="ghost"><Link to="/pricing">الأسعار</Link></Button>
            </div>
          </div>

          <h2 className="text-2xl font-semibold text-gray-900">مقارنات وأدلة ذات صلة</h2>
          <ul className="list-disc pr-6 space-y-2">
            <li><Link to="/ar/vs/sapaad" className="text-[#00713A] underline">Matbex مقابل Sapaad</Link></li>
            <li><Link to="/ar/vs/qoyod" className="text-[#00713A] underline">Matbex مقابل قيود</Link></li>
            <li><Link to="/ar/vs/jazr" className="text-[#00713A] underline">Matbex مقابل جذر</Link></li>
            <li><Link to="/ar/zatca" className="text-[#00713A] underline">دليل زاتكا المرحلة الثانية</Link></li>
            <li><Link to="/sa/foodics-alternative" className="text-[#00713A] underline">English version</Link></li>
          </ul>
        </article>
      </main>

      <LandingFooter />
    </PageTransition>
  );
}
