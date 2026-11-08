import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { captureAttribution } from "@/lib/leadAttribution";
import { detectCountry, enableAdTags, needsBanner, readConsent, saveConsent } from "@/lib/adConsent";

/** Opens the banner again from anywhere (e.g. a "Cookie settings" footer link). */
export const openCookieSettings = () => window.dispatchEvent(new CustomEvent("matbex:open-cookie-settings"));

export function CookieConsentBanner() {
  const { i18n } = useTranslation();
  const ar = i18n.language?.startsWith("ar");
  const L = (en: string, a: string) => (ar ? a : en);
  const [open, setOpen] = useState(false);
  const [country, setCountry] = useState<string | null>(null);
  const location = useLocation();

  useEffect(() => { captureAttribution(); }, []);

  useEffect(() => {
    let alive = true;
    detectCountry().then((c) => {
      if (!alive) return;
      setCountry(c);
      if (!readConsent() && needsBanner(c)) setOpen(true);
      void enableAdTags();
    });
    const reopen = () => setOpen(true);
    const sync = (e: StorageEvent) => { if (e.key?.startsWith("matbex_ad_consent")) void enableAdTags(); };
    window.addEventListener("matbex:open-cookie-settings", reopen);
    window.addEventListener("storage", sync);
    return () => { alive = false; window.removeEventListener("matbex:open-cookie-settings", reopen); window.removeEventListener("storage", sync); };
  }, []);

  // Only on public pages, never inside the app.
  const isApp = /^\/(dashboard|sales|expenses|accounting|reports|admin|record-sale|shifts|settings|inventory|staff|payroll|pos|kiosk)/.test(location.pathname);
  if (!open || isApp) return null;

  const choose = (c: "granted" | "denied") => { saveConsent(c, country); setOpen(false); };

  return (
    <div role="dialog" aria-label={L("Cookie settings", "إعدادات ملفات تعريف الارتباط")} className="fixed inset-x-3 bottom-3 z-[60] mx-auto max-w-xl rounded-xl border border-border bg-background/95 p-4 shadow-lg backdrop-blur">
      <p className="text-sm text-foreground">
        {L(
          "We'd like to use advertising cookies from Meta (Facebook/Instagram) and Google to measure which of our ads lead to sign-ups and demo bookings. You can change this any time.",
          "نود استخدام ملفات تعريف الارتباط الإعلانية من Meta (فيسبوك/إنستغرام) وGoogle لمعرفة أي إعلاناتنا تؤدي إلى التسجيل وحجز العروض. يمكنك تغيير اختيارك في أي وقت.",
        )}{" "}
        <Link to="/privacy" className="text-primary underline-offset-2 hover:underline">{L("Privacy policy", "سياسة الخصوصية")}</Link>
      </p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => choose("denied")}>{L("Reject", "رفض")}</Button>
        <Button size="sm" onClick={() => choose("granted")}>{L("Accept", "قبول")}</Button>
      </div>
    </div>
  );
}
