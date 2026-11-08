import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { CheckCircle2, ArrowLeft } from "lucide-react";
import { RouteSeo } from "@/components/seo/RouteSeo";

/**
 * Confirmation screen shown after an enquiry reaches the Matbex team.
 */
export default function ContactThankYou() {
  const { i18n } = useTranslation();
  const ar = i18n.language.startsWith("ar");
  return (
    <>
      <RouteSeo
        title={ar ? "تم استلام رسالتك | مطبخ" : "Message received | Matbex"}
        description={ar ? "شكرًا لتواصلك مع مطبخ. سيرد فريقنا خلال يوم عمل واحد." : "Thanks for contacting Matbex. Our team replies to every enquiry within one business day."}
        noindex
      />
      <main dir={ar ? "rtl" : "ltr"} lang={ar ? "ar" : "en"} className="min-h-screen bg-gray-50 flex items-center justify-center px-6 py-16">
        <div className="relative w-full max-w-lg text-center">
          <span
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-0 h-[320px] w-[520px] max-w-[120vw] -translate-x-1/2 -translate-y-1/3 rounded-full bg-[radial-gradient(circle,rgba(0,168,89,0.18),transparent_70%)] blur-2xl"
          />
          <div className="relative bg-white border border-gray-200 rounded-2xl shadow-sm px-6 py-10 sm:px-10">
            <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-[#00A859]/10">
              <CheckCircle2 className="h-7 w-7 text-[#00A859]" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-light tracking-tight text-gray-900 mb-4">
              {ar ? "تم استلام رسالتك" : "Your message is on its way"}
            </h1>
            <p className="text-base text-gray-600 font-light leading-relaxed mb-8">
              {ar ? "شكرًا لتواصلك معنا. استلم فريقنا طلبك وسيرد خلال يوم عمل واحد. أرسلنا أيضًا نسخة إلى بريدك الإلكتروني؛ يمكنك الرد عليها لإضافة أي تفاصيل." : "Thanks for reaching out. Our team has your enquiry and will reply within one business day. We've also sent a copy to your inbox — just reply to it if you have anything to add."}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                to="/"
                className="inline-flex items-center justify-center gap-2 min-h-11 rounded-lg border border-gray-300 bg-white px-5 text-sm font-medium text-gray-900 transition-colors hover:border-gray-400"
              >
                <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
                {ar ? "العودة إلى الرئيسية" : "Back to home"}
              </Link>
              <Link
                to="/register"
                className="inline-flex items-center justify-center min-h-11 rounded-lg bg-[#00A859] px-5 text-sm font-medium text-white transition-colors hover:bg-[#00954e]"
              >
                {ar ? "ابدأ تسجيل مطعمك" : "Start Your Residency"}
              </Link>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
