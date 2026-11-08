import { useState } from "react";
import { useCurrency } from "@/hooks/useCurrency";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Calculator, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";

interface Props {
  rawPosSales: number;
  reconciliationDelta: number;
  adjustmentsTotal: number;
  closedDaysCount: number;
  grossSales: number;
  vatAmount: number;
  netExVatSales: number;
  effectiveVatRate: number;
  branchLabel?: string | null;
}

interface Line {
  label: string;
  detail: string;
  amount: number;
  sign?: "plus" | "minus";
  emphasis?: boolean;
}

/**
 * Traceability panel for the Gross Sales KPI:
 *   Raw POS receipts
 *   +/- closed-day override (day-end recorder replaces raw POS)
 *   +/- active day-end adjustments
 *   = Gross sales (VAT-inclusive)
 *   - VAT (effective rate from receipts)
 *   = Net sales excl. VAT
 */
export function SalesDerivationBreakdown({
  rawPosSales,
  reconciliationDelta,
  adjustmentsTotal,
  closedDaysCount,
  grossSales,
  vatAmount,
  netExVatSales,
  effectiveVatRate,
  branchLabel,
}: Props) {
  const { t } = useTranslation();
  const { format: formatCurrency } = useCurrency();
  const [open, setOpen] = useState(false);

  // The override portion is whatever the reconciliation moved beyond adjustments.
  const overrideDelta = reconciliationDelta - adjustmentsTotal;

  const lines: Line[] = [
    {
      label: t("app.dashboard.derivation.rawPos"),
      detail: t("app.dashboard.derivation.rawPosDetail"),
      amount: rawPosSales,
    },
    {
      label: t("app.dashboard.derivation.closedDayOverride"),
      detail:
        closedDaysCount > 0
          ? t("app.dashboard.derivation.closedDays", { count: closedDaysCount })
          : t("app.dashboard.derivation.noClosedDays"),
      amount: overrideDelta,
      sign: overrideDelta < 0 ? "minus" : "plus",
    },
    {
      label: t("app.dashboard.derivation.adjustments"),
      detail: t("app.dashboard.derivation.adjustmentsDetail"),
      amount: adjustmentsTotal,
      sign: adjustmentsTotal < 0 ? "minus" : "plus",
    },
  ];

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="p-3">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-full justify-between px-1 h-auto py-1">
            <span className="flex items-center gap-2 text-xs font-medium">
              <Calculator className="h-3.5 w-3.5 text-muted-foreground" />
               {t("app.dashboard.derivation.title")}
              {branchLabel && (
                <span className="text-muted-foreground font-normal">· {branchLabel}</span>
              )}
            </span>
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            />
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="mt-3 space-y-2 text-xs">
            {lines.map((line) => (
              <div key={line.label} className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-medium">{line.label}</div>
                  <div className="text-muted-foreground">{line.detail}</div>
                </div>
                <div className="shrink-0 tabular-nums font-medium">
                  {line.sign && line.amount !== 0 ? (line.amount > 0 ? "+" : "") : ""}
                  {formatCurrency(line.amount)}
                </div>
              </div>
            ))}

            <Separator />

            <div className="flex items-center justify-between gap-4">
               <span className="font-semibold">{t("app.dashboard.derivation.grossSales")}</span>
              <span className="tabular-nums font-semibold">{formatCurrency(grossSales)}</span>
            </div>

            <div className="flex items-start justify-between gap-4">
              <div>
                 <div className="font-medium">{t("app.dashboard.derivation.vat")}</div>
                <div className="text-muted-foreground">
                   {t("app.dashboard.derivation.effectiveRate", { value: (effectiveVatRate * 100).toFixed(2) })}
                </div>
              </div>
              <span className="tabular-nums font-medium">−{formatCurrency(vatAmount)}</span>
            </div>

            <Separator />

            <div className="flex items-center justify-between gap-4">
               <span className="font-semibold">{t("app.dashboard.derivation.netSales")}</span>
              <span className="tabular-nums font-semibold">{formatCurrency(netExVatSales)}</span>
            </div>

            <p className="pt-1 text-[11px] text-muted-foreground">
               {t("app.dashboard.derivation.note")}
            </p>
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
