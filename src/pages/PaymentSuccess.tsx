import { useEffect, useRef, useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { MatbexLogo } from "@/components/brand/MatbexLogo";
import { Check, AlertCircle, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";

type PaymentStatus = "verifying" | "success" | "error" | "missing";

export default function PaymentSuccess() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refreshProfile } = useAuth();
  const refreshRef = useRef(refreshProfile);
  refreshRef.current = refreshProfile;
  const { i18n } = useTranslation();
  const ar = i18n.language.startsWith("ar");
  const [status, setStatus] = useState<PaymentStatus>("verifying");
  const [errorMessage, setErrorMessage] = useState("");
  const [testPayment, setTestPayment] = useState(false);
  const [registration, setRegistration] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const sessionId = params.get("session_id");
  const subscription = params.get("flow") === "subscription";

  useEffect(() => {
    let cancelled = false;
    if (!sessionId) { setStatus("missing"); return; }
    setStatus("verifying");
    async function verify() {
      try {
        const { data: auth } = await db.auth.getSession();
        const fn = subscription || auth.session ? "verify-subscription-payment" : "complete-registration-payment";
        let result = await db.functions.invoke(fn, { body: { session_id: sessionId }, headers: auth.session ? { Authorization: `Bearer ${auth.session.access_token}` } : undefined });
        let isRegistration = fn === "complete-registration-payment";
        if (result.data?.registration) {
          isRegistration = true;
          result = await db.functions.invoke("complete-registration-payment", { body: { session_id: sessionId } });
        }
        if (result.error || !result.data?.success) {
          let message = result.data?.error;
          if (!message && result.error?.context instanceof Response) {
            const body = await result.error.context.json().catch(() => null);
            message = body?.error;
          }
          throw new Error(message || result.error?.message || "Payment verification failed");
        }
        if (!isRegistration) await refreshRef.current();
        if (!cancelled) {
          setTestPayment(Boolean(result.data.test));
          setRegistration(isRegistration);
          setStatus("success");
        }
      } catch (error) {
        if (!cancelled) { setErrorMessage(error instanceof Error ? error.message : "Payment verification failed"); setStatus("error"); }
      }
    }
    void verify();
    return () => { cancelled = true; };
  }, [sessionId, subscription, attempt]);

  return (
    <main dir={ar ? "rtl" : "ltr"} className="min-h-screen bg-background flex items-center justify-center p-4">
      <section className="w-full max-w-md bg-card text-card-foreground rounded-lg border border-border shadow-sm p-8 text-center">
        <Link to="/" className="inline-block mb-8"><MatbexLogo size="lg" /></Link>
        <div className="w-16 h-16 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-6">
          {status === "success" ? <Check className="h-8 w-8" /> : status === "error" ? <AlertCircle className="h-8 w-8 text-destructive" /> : <CreditCard className="h-8 w-8" />}
        </div>
        <h1 className="text-2xl font-semibold mb-3">
          {status === "verifying" ? (ar ? "جارٍ التحقق من الدفع" : "Verifying payment") : status === "success" ? (ar ? "تم تأكيد الدفع" : testPayment ? "Test payment confirmed" : "Payment confirmed") : status === "missing" ? (ar ? "تفعيل اشتراكك" : "Activate your subscription") : (ar ? "تعذر تأكيد الدفع" : "Payment not confirmed")}
        </h1>
        <p className="text-muted-foreground mb-6" role={status === "error" ? "alert" : "status"}>
          {status === "verifying" ? (ar ? "جارٍ تأكيد الدفع وتحديث حسابك." : "Confirming your payment and updating your account.") : status === "success" ? (registration ? (ar ? "تم إنشاء حسابك. تحقق من بريدك الإلكتروني." : "Your account has been created. Check your email for sign-in details.") : testPayment ? (ar ? "تم تفعيل اشتراكك التجريبي. لم يتم خصم أموال حقيقية." : "Your test subscription is active. No real money was charged.") : (ar ? "اشتراكك نشط الآن." : "Your subscription is now active.")) : status === "missing" ? (ar ? "لم يتم بدء عملية دفع. اختر اشتراكك من صفحة الفواتير." : "No checkout has been started. Choose your subscription on the Billing page.") : errorMessage}
        </p>
        {status === "verifying" && <div className="h-2 bg-muted rounded animate-pulse" />}
        {status === "error" && <Button variant="outline" className="w-full mb-3" onClick={() => setAttempt(n => n + 1)}>{ar ? "التحقق مرة أخرى" : "Check again"}</Button>}
        {status !== "verifying" && <Button className="w-full" onClick={() => navigate(status === "success" ? registration ? "/auth" : "/dashboard" : "/billing")}>{status === "success" ? (ar ? "متابعة" : registration ? "Sign in" : "Go to dashboard") : (ar ? "الانتقال إلى الفواتير" : "Go to Billing")}</Button>}
      </section>
    </main>
  );
}
