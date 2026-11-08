import { useCurrency } from "@/hooks/useCurrency";
import { useOverheadData } from "@/hooks/useOverheadData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, Lightbulb, Wifi, DollarSign, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";


export function DailyOverheadCard() {
  const { t } = useTranslation();
  const { format: formatCurrency } = useCurrency();
  
  // Use shared overhead data hook - cached and deduplicated across components
  const { data: overheadData, isLoading: overheadLoading } = useOverheadData();

  const isLoading = overheadLoading;

  const getIconForName = (name: string) => {
    const lower = name.toLowerCase();
    if (lower.includes("rent")) return Building2;
    if (lower.includes("utilit") || lower.includes("electric") || lower.includes("water") || lower.includes("gas")) return Lightbulb;
    if (lower.includes("internet") || lower.includes("phone") || lower.includes("wifi")) return Wifi;
    return DollarSign;
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-24 mb-4" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const totalDaily = overheadData?.dailyOverhead || 0;
  const items = overheadData?.items || [];
  const payrollDaily = overheadData ? overheadData.totalPayable / overheadData.totalDays : 0;
  const payrollMonthly = overheadData?.totalPayable || 0;
  const paidStaffCount = overheadData?.paidStaffCount || 0;
  const totalStaffCount = overheadData?.staffCount || 0;

  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-[11px] font-bold uppercase text-muted-foreground">
           {t("app.dashboard.dailyOverhead.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col flex-1">
        <div className="mb-4">
          <span className="font-display text-2xl font-semibold tabular-nums text-foreground">
            {formatCurrency(totalDaily)}
          </span>
           <span className="text-sm text-muted-foreground ms-1">{t("app.dashboard.dailyOverhead.perDay")}</span>
        </div>

        {/* Scrollable items container with max height */}
        <div className="space-y-2 overflow-y-auto max-h-40 pr-1 flex-1">
          {/* Payroll allocation (Total Payable = remaining unpaid) */}
          {payrollMonthly > 0 && (
            <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-md bg-primary/10">
                  <Users className="h-3.5 w-3.5 text-primary" />
                </div>
                <div>
                   <span className="text-sm font-medium">{t("app.dashboard.dailyOverhead.payroll")}</span>
                  {paidStaffCount > 0 && (
                     <p className="text-[10px] text-muted-foreground">{t("app.dashboard.dailyOverhead.paid", { paid: paidStaffCount, total: totalStaffCount })}</p>
                  )}
                </div>
              </div>
              <div className="text-right">
                <span className="text-sm font-semibold">{formatCurrency(payrollDaily)}</span>
                <p className="text-xs text-muted-foreground">{formatCurrency(payrollMonthly)}/mo</p>
              </div>
            </div>
          )}

          {/* Overhead items */}
          {items.map((item) => {
            const Icon = getIconForName(item.name);
            return (
              <div 
                key={item.id} 
                className={cn(
                  "flex items-center justify-between p-2 rounded-md bg-muted/50"
                )}
              >
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-md bg-accent/50">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <span className="text-sm font-medium truncate max-w-[100px]">{item.name}</span>
                </div>
                <div className="text-right">
                  <span className="text-sm font-semibold">{formatCurrency(item.fiscal_daily_amount || 0)}</span>
                  <p className="text-xs text-muted-foreground">{formatCurrency(Number(item.monthly_amount))}/mo</p>
                </div>
              </div>
            );
          })}

          {items.length === 0 && payrollMonthly === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
               {t("app.dashboard.dailyOverhead.empty")}
            </p>
          )}
        </div>

        {/* Summary footer */}
        <div className="mt-4 pt-3 border-t border-border">
          <div className="flex justify-between text-xs text-muted-foreground">
             <span>{t("app.dashboard.dailyOverhead.items", { count: items.length + (payrollMonthly > 0 ? 1 : 0) })}</span>
             <span>{t("app.dashboard.dailyOverhead.monthly")}: {formatCurrency(overheadData?.totalOverhead || 0)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}