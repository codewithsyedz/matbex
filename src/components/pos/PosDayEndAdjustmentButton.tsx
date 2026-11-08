import { useState } from "react";
import { format } from "date-fns";
import { Scale, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useDailySales } from "@/hooks/useDailySales";
import { useCurrency } from "@/hooks/useCurrency";
import { DayEndAdjustmentDialog } from "@/components/dayend/DayEndAdjustmentDialog";
import { useTranslation } from "react-i18next";

/**
 * POS-side entry point for day-end adjustments: lets the cashier record the
 * variance between the POS/system total and the counted total and close the
 * day without leaving the register. Closing here feeds Daily Profit and the
 * P&L, which both prefer the closed daily_sales_summary total.
 */
export function PosDayEndAdjustmentButton({ size = "sm" }: { size?: "sm" | "default" }) {
  const { t } = useTranslation();
  const dateStr = format(new Date(), "yyyy-MM-dd");
  const { dailySales, systemTotal, closeDay } = useDailySales(dateStr);
  const { format: formatCurrency } = useCurrency();
  const [open, setOpen] = useState(false);

  const isClosed = dailySales?.status === "closed";
  const recordedTotal = Number(dailySales?.total_sales ?? 0);
  const posReportedTotal = Number(dailySales?.pos_reported_total ?? systemTotal ?? 0);
  const variance = recordedTotal - posReportedTotal;

  const handlePostedAndCloseDay = async (adjustmentId: string) => {
    if (!dailySales?.id) return;
    const note =
      `[POS ${new Date().toISOString()}] Variance of ${formatCurrency(variance)} reconciled by ` +
      `day-end adjustment ${adjustmentId.slice(0, 8)}.`;
    await closeDay.mutateAsync({ id: dailySales.id, varianceNotes: note });
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size={size}
            className="gap-1.5 h-9"
            onClick={() => {
              if (!dailySales?.id) {
                toast.info(t("app.pos.dayEnd.missingTotals"), {
                  description: t("app.pos.dayEnd.missingTotalsDescription"),
                });
                return;
              }
              setOpen(true);
            }}
          >
            {isClosed ? <Lock className="h-4 w-4" /> : <Scale className="h-4 w-4" />}
            <span className="hidden xl:inline">{t("app.pos.dayEnd.action")}</span>
            {!isClosed && Math.abs(variance) > 0.005 && (
              <Badge variant="secondary" className="ms-1 text-[10px]">
                {formatCurrency(Math.abs(variance))}
              </Badge>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {isClosed
            ? t("app.pos.dayEnd.closedHelp")
            : t("app.pos.dayEnd.openHelp")}
        </TooltipContent>
      </Tooltip>

      <DayEndAdjustmentDialog
        open={open}
        onOpenChange={setOpen}
        scope="daily_sales"
        scopeRefId={dailySales?.id ?? null}
        businessDate={dateStr}
        defaultAmount={variance || undefined}
        title={t("app.pos.dayEnd.title")}
        onPostedAndCloseDay={
          dailySales?.id && !isClosed ? handlePostedAndCloseDay : undefined
        }
        recordedTotal={recordedTotal}
        posReportedTotal={posReportedTotal}
      />
    </>
  );
}
