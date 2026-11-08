import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Trust badge displayed on the public landing page to signal that the
 * platform implements ZATCA Phase 2 e-invoicing (UBL 2.1, hash chain,
 * Fatoora clearance + reporting, tamper-evident audit trail).
 */
export function ZatcaComplianceBadge() {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t("landing.zatcaBadge.ariaLabel")}
      className="border-y border-border/40 bg-white"
    >
      <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-center gap-6 text-center md:text-left">
        <div className="flex items-center gap-3 shrink-0">
          <div className="h-10 w-10 rounded-full bg-gray-100 ring-1 ring-gray-200 flex items-center justify-center">
            <ShieldCheck className="h-5 w-5 text-gray-700" strokeWidth={1.5} />
          </div>
          <div className="text-left">
            <p className="text-[10px] uppercase tracking-[0.18em] text-gray-600">
              {t("landing.zatcaBadge.eyebrow")}
            </p>
            <p className="text-sm font-medium text-foreground">
              {t("landing.zatcaBadge.title")}
            </p>
          </div>
        </div>

        <div className="hidden md:block h-8 w-px bg-border/60" />

        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-gray-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1 w-1 rounded-full bg-foreground/50" />
            {t("landing.zatcaBadge.ubl")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1 w-1 rounded-full bg-foreground/50" />
            {t("landing.zatcaBadge.fatoora")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1 w-1 rounded-full bg-foreground/50" />
            {t("landing.zatcaBadge.csid")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1 w-1 rounded-full bg-foreground/50" />
            {t("landing.zatcaBadge.audit")}
          </span>
        </div>
      </div>
    </section>
  );
}