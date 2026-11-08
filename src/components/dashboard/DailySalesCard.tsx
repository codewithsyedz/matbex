import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BranchTotalsExplainerTooltip } from "@/components/branches/BranchTotalsExplainer";
import { Skeleton } from "@/components/ui/skeleton";
import { ShoppingCart, ChevronLeft, ChevronRight, Banknote, CreditCard, Clock, Store, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip as UiTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  Cell,
} from "recharts";
import { format, subDays, addDays, isToday, isFuture } from "date-fns";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getRestaurantDayBoundsUTC, formatZonedYMD } from "@/lib/timezone";
import {
  fetchReconciledSalesByDay,
  buildDayBreakdown,
  pickDayPaymentBreakdown,
} from "@/lib/reconciledSales";

interface ShiftSale {
  shiftId: string;
  shiftName: string;
  drawerName: string;
  openedAt: string;
  total: number;
}

export function DailySalesCard() {
  const { t } = useTranslation();
  const { restaurant } = useAuth();
  const { activeBranchId } = useBranch();
  const { format: formatCurrency } = useCurrency();
  const [selectedDate, setSelectedDate] = useState(subDays(new Date(), 1));

  const { data, isLoading } = useQuery({
    queryKey: ["daily-sales-chart", restaurant?.id, activeBranchId, format(selectedDate, "yyyy-MM-dd")],
    queryFn: async () => {
      if (!restaurant?.id) return { dailyData: [], total: 0, cashSales: 0, cardSales: 0, unpaidSales: 0, shiftSales: [] };

      const timezone = restaurant.timezone || "Asia/Riyadh";

      // OPTIMIZATION: Fetch all 7 days of data in a SINGLE batch request
      // instead of 7 sequential requests (eliminates query waterfall)
      const oldestDate = subDays(selectedDate, 6);
      const { start: rangeStart } = getRestaurantDayBoundsUTC(oldestDate, timezone);
      const { endExclusive: rangeEnd } = getRestaurantDayBoundsUTC(selectedDate, timezone);

      // Single batch query for all 7 days (raw POS — used for payment + shift breakdown)
      let rawSalesQuery = db
        .from("sales_transactions")
        .select("total, created_at, payment_method, settlement_status, shift_id")
        .eq("restaurant_id", restaurant.id)
        .gte("created_at", rangeStart.toISOString())
        .lt("created_at", rangeEnd.toISOString());
      if (activeBranchId) rawSalesQuery = rawSalesQuery.eq("branch_id", activeBranchId);
      const { data: allSalesData } = await rawSalesQuery;

      // Reconciled per-day totals — applies day-end adjustments + closed-day overrides
      const reconciled = await fetchReconciledSalesByDay({
        branchId: activeBranchId ?? null,
        restaurantId: restaurant.id,
        dateFrom: formatZonedYMD(oldestDate, timezone),
        dateTo: formatZonedYMD(selectedDate, timezone),
      });

      // Process sales data client-side by day (raw POS — for breakdowns)
      const salesByDate = new Map<string, number>();
      const selectedDateBounds = getRestaurantDayBoundsUTC(selectedDate, timezone);
      
      // For payment breakdown - filter to selected day only
      const selectedDaySales: typeof allSalesData = [];

      allSalesData?.forEach(sale => {
        const saleTime = new Date(sale.created_at).getTime();
        
        // Check each day bucket
        for (let i = 6; i >= 0; i--) {
          const dayDate = subDays(selectedDate, i);
          const { start, endExclusive } = getRestaurantDayBoundsUTC(dayDate, timezone);
          const dateStr = formatZonedYMD(dayDate, timezone);
          
          if (saleTime >= start.getTime() && saleTime < endExclusive.getTime()) {
            salesByDate.set(dateStr, (salesByDate.get(dateStr) || 0) + (Number(sale.total) || 0));
            break;
          }
        }

        // Also collect selected day sales for breakdown
        if (saleTime >= selectedDateBounds.start.getTime() && saleTime < selectedDateBounds.endExclusive.getTime()) {
          selectedDaySales.push(sale);
        }
      });

      // Build daily data array — prefer reconciled (adjusted) totals over raw POS
      const dailyData: {
        date: string;
        day: string;
        value: number;
        isSelected: boolean;
        source: "summary" | "adjusted" | "raw";
      }[] = [];
      for (let i = 6; i >= 0; i--) {
        const dayDate = subDays(selectedDate, i);
        const dateStr = formatZonedYMD(dayDate, timezone);
        const reconciledValue = reconciled.perDay.get(dateStr);
        const breakdown = buildDayBreakdown(dateStr, reconciled);
        dailyData.push({
          date: dateStr,
          day: format(dayDate, "EEE"),
          value: reconciledValue != null ? reconciledValue : (salesByDate.get(dateStr) || 0),
          isSelected: i === 0,
          source: breakdown.source,
        });
      }

      // Calculate RAW payment breakdowns from selected day POS rows
      const rawCash = selectedDaySales.filter(s => s.payment_method === "cash")
        .reduce((sum, s) => sum + (Number(s.total) || 0), 0);
      const rawCard = selectedDaySales.filter(s => s.payment_method === "card")
        .reduce((sum, s) => sum + (Number(s.total) || 0), 0);
      const rawUnpaid = selectedDaySales.filter(s => s.settlement_status === "unpaid")
        .reduce((sum, s) => sum + (Number(s.total) || 0), 0);

      // Reconcile cash/card with closed daily_sales_summary when present
      const selectedDayStr = formatZonedYMD(selectedDate, timezone);
      const payment = pickDayPaymentBreakdown(
        selectedDayStr,
        rawCash,
        rawCard,
        rawUnpaid,
        reconciled
      );
      const selectedDayBreakdown = buildDayBreakdown(selectedDayStr, reconciled);

      // Get shift-wise breakdown
      const shiftIds = [...new Set(selectedDaySales.map(s => s.shift_id).filter(Boolean))];
      let shiftSales: ShiftSale[] = [];

      if (shiftIds.length > 0) {
        const { data: shiftsData } = await db
          .from("shifts")
          .select("id, opened_at, drawer_id, shift_templates(name), drawers(name)")
          .in("id", shiftIds as string[]);

        const shiftMap = new Map<any, any>(shiftsData?.map(s => [s.id, s]) || []);
        
        // Group sales by shift
        const shiftTotals = new Map<string, number>();
        selectedDaySales.forEach(sale => {
          if (sale.shift_id) {
            const current = shiftTotals.get(sale.shift_id) || 0;
            shiftTotals.set(sale.shift_id, current + (Number(sale.total) || 0));
          }
        });

        shiftSales = Array.from(shiftTotals.entries()).map(([shiftId, total]) => {
          const shift = shiftMap.get(shiftId);
          const templateName = (shift?.shift_templates as any)?.name;
          const drawerName = (shift?.drawers as any)?.name;
          return {
            shiftId,
            shiftName: templateName || "Shift",
            drawerName: drawerName || "",
            openedAt: shift?.opened_at || "",
            total,
          };
        }).sort((a, b) => new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime());
      }

      const total = dailyData.reduce((sum, d) => sum + d.value, 0);

      return {
        dailyData,
        total,
        cashSales: payment.cash,
        cardSales: payment.card,
        unpaidSales: payment.unpaid,
        paymentSource: payment.source,
        rawCash,
        rawCard,
        selectedDayBreakdown,
        shiftSales,
      };
    },
    enabled: !!restaurant?.id,
  });

  const goToPreviousDay = () => {
    setSelectedDate(prev => subDays(prev, 1));
  };

  const goToNextDay = () => {
    const nextDay = addDays(selectedDate, 1);
    if (!isFuture(nextDay)) {
      setSelectedDate(nextDay);
    }
  };

  const todaySales = data?.dailyData.find(d => d.isSelected)?.value || 0;
  const selectedSource = data?.selectedDayBreakdown?.source ?? "raw";
  const paymentSource = data?.paymentSource ?? "raw";
  const breakdown = data?.selectedDayBreakdown;

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-24 mb-4" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="fade-slide-in h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
            <ShoppingCart className="h-4 w-4" />
            Daily Sales
            <BranchTotalsExplainerTooltip />
          </CardTitle>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10"
              onClick={goToPreviousDay}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[72px] text-center text-xs text-muted-foreground">
              {isToday(selectedDate) ? "Today" : format(selectedDate, "MMM dd")}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10"
              onClick={goToNextDay}
              disabled={isToday(selectedDate)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col">
        <TooltipProvider delayDuration={150}>
        <div className="mb-4 flex flex-wrap items-baseline gap-2">
          <span className="font-display text-2xl font-semibold tabular-nums text-foreground">
            {formatCurrency(todaySales)}
          </span>
          <span className="text-xs text-muted-foreground">
            {format(selectedDate, "EEEE")}
          </span>
          <UiTooltip>
            <TooltipTrigger asChild>
              <Badge
                variant={selectedSource === "summary" ? "default" : selectedSource === "adjusted" ? "secondary" : "outline"}
                className="text-[10px] px-1.5 py-0 h-4 cursor-help"
              >
                {selectedSource === "summary"
                  ? "Adjusted"
                  : selectedSource === "adjusted"
                  ? "Reconciled"
                  : "Raw POS"}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs max-w-[220px]">
              {selectedSource === "summary"
                ? "Uses the closed Daily Sales Summary total (operator-reconciled)."
                : selectedSource === "adjusted"
                ? "Raw POS plus active day-end adjustments."
                : "Raw POS transactions only — no day-end adjustments posted."}
            </TooltipContent>
          </UiTooltip>
        </div>

        {/* Bar Chart */}
        <div className="h-24 mb-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data?.dailyData || []} barCategoryGap="20%">
              <XAxis 
                dataKey="day" 
                axisLine={false} 
                tickLine={false}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              />
              <YAxis hide />
              <ChartTooltip
                content={({ active, payload }: any) => {
                  if (active && payload?.length) {
                    const p = payload[0].payload;
                    return (
                      <div className="bg-popover border rounded-md shadow-md px-2 py-1 text-xs space-y-0.5">
                        <p className="font-medium">{formatCurrency(payload[0].value as number)}</p>
                        <p className="text-muted-foreground">{p.date}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {p.source === "summary"
                            ? "Day-end closed total"
                            : p.source === "adjusted"
                            ? "Raw POS + adjustments"
                            : "Raw POS"}
                        </p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {data?.dailyData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.isSelected ? "hsl(var(--primary))" : "hsl(var(--muted))"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Day-End Adjustment Breakdown */}
        {breakdown && (breakdown.source !== "raw" || breakdown.adjustments !== 0) && (
          <div className="pt-2 pb-3 border-t space-y-1 text-xs">
            <div className="flex items-center justify-between text-muted-foreground">
               <span>{t("app.dashboard.derivation.rawPos")}</span>
              <span className="font-mono">{formatCurrency(breakdown.rawPos)}</span>
            </div>
            <div className="flex items-center justify-between text-muted-foreground">
               <span>{t("app.dashboard.derivation.adjustments")}</span>
              <span className={`font-mono ${breakdown.adjustments > 0 ? "text-success" : breakdown.adjustments < 0 ? "text-destructive" : ""}`}>
                {breakdown.adjustments >= 0 ? "+" : ""}{formatCurrency(breakdown.adjustments)}
              </span>
            </div>
            <div className="flex items-center justify-between font-medium pt-1 border-t">
               <span>{t("app.dashboard.monthly.finalReconciled")}</span>
              <span className="font-mono">{formatCurrency(breakdown.final)}</span>
            </div>
          </div>
        )}

        {/* Cash, Card & Settlement Breakdown */}
        <div className={`grid gap-3 border-t pt-3 ${(data?.unpaidSales || 0) > 0 ? 'grid-cols-1 min-[480px]:grid-cols-3' : 'grid-cols-2'}`}>
          <div className="flex min-w-0 items-center gap-2">
            <div className="p-1.5 rounded-md bg-success/10">
              <Banknote className="h-4 w-4 text-success" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                Cash
                <UiTooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3 w-3 cursor-help opacity-60" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs max-w-[220px]">
                    {paymentSource === "summary"
                      ? "From the closed Daily Sales Summary (reconciled cash deposit)."
                      : "Sum of raw POS cash transactions for the day."}
                  </TooltipContent>
                </UiTooltip>
              </p>
              <p className="text-sm font-semibold tabular-nums whitespace-nowrap">{formatCurrency(data?.cashSales || 0)}</p>
              {paymentSource === "summary" && data && Math.abs((data.cashSales || 0) - (data.rawCash || 0)) > 0.01 && (
                <p className="text-[10px] mt-0.5 leading-tight">
                  <span className="line-through text-muted-foreground/70">{formatCurrency(data.rawCash || 0)}</span>
                  <span className={`ml-1 font-medium ${(data.cashSales - data.rawCash) >= 0 ? "text-success" : "text-destructive"}`}>
                    {(data.cashSales - data.rawCash) >= 0 ? "+" : ""}{formatCurrency(data.cashSales - data.rawCash)}
                  </span>
                </p>
              )}
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <div className="p-1.5 rounded-md bg-primary/10">
              <CreditCard className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                Card
                <UiTooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3 w-3 cursor-help opacity-60" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs max-w-[220px]">
                    {paymentSource === "summary"
                      ? "From the closed Daily Sales Summary (reconciled card total)."
                      : "Sum of raw POS card transactions for the day."}
                  </TooltipContent>
                </UiTooltip>
              </p>
              <p className="text-sm font-semibold tabular-nums whitespace-nowrap">{formatCurrency(data?.cardSales || 0)}</p>
              {paymentSource === "summary" && data && Math.abs((data.cardSales || 0) - (data.rawCard || 0)) > 0.01 && (
                <p className="text-[10px] mt-0.5 leading-tight">
                  <span className="line-through text-muted-foreground/70">{formatCurrency(data.rawCard || 0)}</span>
                  <span className={`ml-1 font-medium ${(data.cardSales - data.rawCard) >= 0 ? "text-success" : "text-destructive"}`}>
                    {(data.cardSales - data.rawCard) >= 0 ? "+" : ""}{formatCurrency(data.cardSales - data.rawCard)}
                  </span>
                </p>
              )}
            </div>
          </div>
          {(data?.unpaidSales || 0) > 0 && (
            <div className="flex min-w-0 items-center gap-2">
              <div className="rounded-md bg-warning/10 p-1.5">
                <Clock className="h-4 w-4 text-warning" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  Unpaid
                  <UiTooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3 w-3 cursor-help opacity-60" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs max-w-[220px]">
                      Raw POS unpaid (open tabs/customer credit) — not affected by day-end adjustments.
                    </TooltipContent>
                  </UiTooltip>
                </p>
                <p className="text-sm font-semibold tabular-nums whitespace-nowrap text-warning">{formatCurrency(data?.unpaidSales || 0)}</p>
              </div>
            </div>
          )}
        </div>

        {/* Shift-wise Breakdown */}
        {data?.shiftSales && data.shiftSales.length > 0 && (
          <div className="pt-3 mt-3 border-t space-y-2">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Store className="h-3.5 w-3.5" />
              Shift Breakdown
            </p>
            <div className="space-y-1.5">
              {data.shiftSales.map((shift) => (
                <div key={shift.shiftId} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground">{shift.shiftName}</span>
                    {shift.drawerName && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {shift.drawerName}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground/70">
                      {shift.openedAt ? format(new Date(shift.openedAt), "h:mm a") : ""}
                    </span>
                  </div>
                  <span className="font-medium">{formatCurrency(shift.total)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        </TooltipProvider>
      </CardContent>
    </Card>
  );
}
