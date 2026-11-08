import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, ArrowUp, ArrowDown, AlertCircle } from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";
import { ProfitLossData } from "@/hooks/useProfitLoss";
import { cn } from "@/lib/utils";

interface DailyPLCardProps {
  data: ProfitLossData;
  previousData?: ProfitLossData | null;
  isLoading?: boolean;
  compact?: boolean;
}

interface LineItemProps {
  label: string;
  amount: number;
  percentage?: number;
  previousAmount?: number;
  formatValue: (v: number) => string;
  isNegative?: boolean;
  isTotal?: boolean;
  indent?: boolean;
}

function LineItem({ 
  label, 
  amount, 
  percentage, 
  previousAmount,
  formatValue, 
  isNegative = false,
  isTotal = false,
  indent = false,
}: LineItemProps) {
  const change = previousAmount !== undefined ? amount - previousAmount : undefined;
  const changePercent = previousAmount && previousAmount !== 0 
    ? ((amount - previousAmount) / Math.abs(previousAmount)) * 100 
    : undefined;
  
  return (
    <div className={cn(
      "flex justify-between items-center py-1.5",
      isTotal && "font-semibold border-t pt-2 mt-1"
    )}>
      <span className={cn(
        "text-sm",
        indent && "pl-3",
        !isTotal && "text-muted-foreground"
      )}>
        {label}
      </span>
      <div className="flex items-center gap-3">
        {percentage !== undefined && (
          <span className="text-xs text-muted-foreground w-12 text-right">
            {percentage.toFixed(1)}%
          </span>
        )}
        <span className={cn(
          "tabular-nums text-sm",
          isNegative && amount > 0 && "text-destructive"
        )}>
          {isNegative && amount > 0 ? "(" : ""}{formatValue(Math.abs(amount))}{isNegative && amount > 0 ? ")" : ""}
        </span>
        {change !== undefined && changePercent !== undefined && (
          <span className={cn(
            "flex items-center gap-0.5 text-xs",
            change > 0 ? "text-success" : change < 0 ? "text-destructive" : "text-muted-foreground"
          )}>
            {change > 0 && <ArrowUp className="h-2.5 w-2.5" />}
            {change < 0 && <ArrowDown className="h-2.5 w-2.5" />}
            {Math.abs(changePercent).toFixed(0)}%
          </span>
        )}
      </div>
    </div>
  );
}

export function DailyPLCard({ data, previousData, isLoading, compact = false }: DailyPLCardProps) {
  const { format: formatCurrency } = useCurrency();
  
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-8 w-full" />
        </CardContent>
      </Card>
    );
  }

  const netSales = data.revenue.netSales;
  const getPercentOfSales = (amount: number) => netSales > 0 ? (amount / netSales) * 100 : 0;

  return (
    <Card className="fade-slide-in">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-medium">
            P&L Summary
          </CardTitle>
          <div className="flex items-center gap-2">
            {data.isEstimated && (
              <Badge variant="secondary" className="text-xs gap-1">
                <AlertCircle className="h-3 w-3" />
                Estimated
              </Badge>
            )}
            <Badge variant="outline" className="text-xs">
              {data.periodLabel}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Revenue Section */}
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Revenue
          </h4>
          <LineItem
            label="Gross Sales"
            amount={data.revenue.grossSales}
            previousAmount={previousData?.revenue.grossSales}
            formatValue={formatCurrency}
          />
          {!compact && data.revenue.discounts > 0 && (
            <LineItem
              label="Discounts"
              amount={data.revenue.discounts}
              formatValue={formatCurrency}
              isNegative
              indent
            />
          )}
          <LineItem
            label="Net Sales"
            amount={data.revenue.netSales}
            previousAmount={previousData?.revenue.netSales}
            percentage={100}
            formatValue={formatCurrency}
            isTotal
          />
        </div>

        <Separator />

        {/* COGS Section */}
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Cost of Goods Sold
          </h4>
          <LineItem
            label="Food Cost"
            amount={data.cogs.foodCost}
            percentage={getPercentOfSales(data.cogs.foodCost)}
            formatValue={formatCurrency}
            indent
          />
          {!compact && data.cogs.beverageCost > 0 && (
            <LineItem
              label="Beverage Cost"
              amount={data.cogs.beverageCost}
              percentage={getPercentOfSales(data.cogs.beverageCost)}
              formatValue={formatCurrency}
              indent
            />
          )}
          <LineItem
            label="Total COGS"
            amount={data.cogs.totalCOGS}
            previousAmount={previousData?.cogs.totalCOGS}
            percentage={getPercentOfSales(data.cogs.totalCOGS)}
            formatValue={formatCurrency}
            isTotal
          />
        </div>

        {/* Gross Profit */}
        <div className={cn(
          "rounded-lg p-3 -mx-3",
          data.grossMargin >= 60 ? "bg-success/10" : data.grossMargin >= 50 ? "bg-warning/10" : "bg-destructive/10"
        )}>
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium">Gross Profit</span>
            <div className="flex items-center gap-2">
              <Badge variant={data.grossMargin >= 60 ? "default" : "secondary"}>
                {data.grossMargin.toFixed(1)}%
              </Badge>
              <span className="font-semibold tabular-nums">{formatCurrency(data.grossProfit)}</span>
            </div>
          </div>
        </div>

        {!compact && (
          <>
            <Separator />

            {/* Operating Expenses */}
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Operating Expenses
              </h4>
              <LineItem
                label="Labor"
                amount={data.operatingExpenses.laborCost}
                percentage={getPercentOfSales(data.operatingExpenses.laborCost)}
                formatValue={formatCurrency}
                indent
              />
              <LineItem
                label="Overhead"
                amount={data.operatingExpenses.totalOverhead}
                percentage={getPercentOfSales(data.operatingExpenses.totalOverhead)}
                formatValue={formatCurrency}
                indent
              />
              {data.operatingExpenses.otherExpenses > 0 && (
                <LineItem
                  label="Other"
                  amount={data.operatingExpenses.otherExpenses}
                  percentage={getPercentOfSales(data.operatingExpenses.otherExpenses)}
                  formatValue={formatCurrency}
                  indent
                />
              )}
              {(data.operatingExpenses.payrollDeductions?.total ?? 0) > 0 && (
                <div className="mt-1 pl-3 text-[11px] text-muted-foreground">
                  Payroll deductions (memo):{" "}
                  {formatCurrency(data.operatingExpenses.payrollDeductions.total)} · advances{" "}
                  {formatCurrency(data.operatingExpenses.payrollDeductions.advanceRecovered)} · fines{" "}
                  {formatCurrency(data.operatingExpenses.payrollDeductions.finesDeducted)} · net payable{" "}
                  {formatCurrency(data.operatingExpenses.payrollDeductions.netPayable)}
                </div>
              )}
            </div>


            {/* Prime Cost */}
            <div className={cn(
              "rounded-lg p-3 -mx-3",
              data.primeCostPercentage <= 60 ? "bg-success/10" : data.primeCostPercentage <= 70 ? "bg-warning/10" : "bg-destructive/10"
            )}>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Prime Cost</span>
                <div className="flex items-center gap-2">
                  <Badge variant={data.primeCostPercentage <= 65 ? "default" : "destructive"}>
                    {data.primeCostPercentage.toFixed(1)}%
                  </Badge>
                  <span className="font-semibold tabular-nums">{formatCurrency(data.primeCost)}</span>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Net Income */}
        <div className={cn(
          "rounded-lg p-4 border-2 -mx-3",
          data.netIncome >= 0 ? "border-success bg-success/5" : "border-destructive bg-destructive/5"
        )}>
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              {data.netIncome >= 0 ? (
                <TrendingUp className="h-5 w-5 text-success" />
              ) : (
                <TrendingDown className="h-5 w-5 text-destructive" />
              )}
              <span className="font-semibold">Net Income</span>
            </div>
            <div className="text-right">
              <p className={cn(
                "text-xl font-bold tabular-nums",
                data.netIncome >= 0 ? "text-success" : "text-destructive"
              )}>
                {formatCurrency(data.netIncome)}
              </p>
              <p className="text-xs text-muted-foreground">
                {data.netMargin.toFixed(1)}% margin
              </p>
            </div>
          </div>
          {previousData && (
            <div className="mt-2 pt-2 border-t border-border/50">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">vs {previousData.periodLabel}</span>
                {(() => {
                  const change = data.netIncome - previousData.netIncome;
                  const changePercent = previousData.netIncome !== 0 
                    ? (change / Math.abs(previousData.netIncome)) * 100 
                    : 0;
                  return (
                    <span className={cn(
                      "flex items-center gap-1 font-medium",
                      change > 0 ? "text-success" : change < 0 ? "text-destructive" : "text-muted-foreground"
                    )}>
                      {change > 0 && <ArrowUp className="h-3 w-3" />}
                      {change < 0 && <ArrowDown className="h-3 w-3" />}
                      {formatCurrency(Math.abs(change))} ({changePercent >= 0 ? "+" : ""}{changePercent.toFixed(1)}%)
                    </span>
                  );
                })()}
              </div>
            </div>
          )}
        </div>

        {/* Transaction Count */}
        <div className="text-xs text-muted-foreground text-center pt-2">
          {data.transactionCount} transactions · {data.expenseCount} expenses
        </div>
      </CardContent>
    </Card>
  );
}
