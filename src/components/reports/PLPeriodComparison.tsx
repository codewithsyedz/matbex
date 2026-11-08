import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ArrowUp, ArrowDown, Minus, TrendingUp, TrendingDown, DollarSign, Percent, Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import type { ReactNode } from "react";
import { useCurrency } from "@/hooks/useCurrency";
import { PeriodComparison, ProfitLossData } from "@/hooks/useProfitLoss";
import { cn } from "@/lib/utils";

interface PLPeriodComparisonProps {
  comparison: PeriodComparison;
  showDetailedBreakdown?: boolean;
}

interface ChangeIndicatorProps {
  value: number;
  percentage: number;
  inverse?: boolean;
  formatValue: (v: number) => string;
}

function ChangeIndicator({ value, percentage, inverse = false, formatValue }: ChangeIndicatorProps) {
  const isPositive = value > 0;
  const isNegative = value < 0;
  const isNeutral = value === 0;
  
  // For costs, positive change is bad (inverse logic)
  const isGood = inverse ? isNegative : isPositive;
  const isBad = inverse ? isPositive : isNegative;
  
  return (
    <div className={cn(
      "flex items-center gap-1 text-sm font-medium",
      isGood && "text-success",
      isBad && "text-destructive",
      isNeutral && "text-muted-foreground"
    )}>
      {isPositive && <ArrowUp className="h-3 w-3" />}
      {isNegative && <ArrowDown className="h-3 w-3" />}
      {isNeutral && <Minus className="h-3 w-3" />}
      <span>{formatValue(Math.abs(value))}</span>
      <span className="text-xs text-muted-foreground">
        ({percentage >= 0 ? "+" : ""}{percentage.toFixed(1)}%)
      </span>
    </div>
  );
}

interface ComparisonRowProps {
  label: string;
  current: number;
  previous: number;
  formatValue: (v: number) => string;
  showPercentage?: boolean;
  currentPercentage?: number;
  previousPercentage?: number;
  inverse?: boolean;
  highlight?: boolean;
  indent?: boolean;
  info?: ReactNode;
}

function ComparisonRow({
  label,
  current,
  previous,
  formatValue,
  showPercentage = false,
  currentPercentage,
  previousPercentage,
  inverse = false,
  highlight = false,
  indent = false,
  info,
}: ComparisonRowProps) {
  const change = current - previous;
  const changePercent = previous !== 0 ? (change / Math.abs(previous)) * 100 : current !== 0 ? 100 : 0;
  
  return (
    <div className={cn(
      "grid grid-cols-4 gap-4 py-2 text-sm",
      highlight && "font-semibold bg-muted/50 -mx-4 px-4 rounded-md",
      indent && "pl-4"
    )}>
      <div className="text-muted-foreground flex items-center gap-1.5">
        <span>{label}</span>
        {info}
      </div>
      <div className="text-right tabular-nums">
        {formatValue(current)}
        {showPercentage && currentPercentage !== undefined && (
          <span className="text-xs text-muted-foreground ml-1">({currentPercentage.toFixed(1)}%)</span>
        )}
      </div>
      <div className="text-right tabular-nums text-muted-foreground">
        {formatValue(previous)}
        {showPercentage && previousPercentage !== undefined && (
          <span className="text-xs ml-1">({previousPercentage.toFixed(1)}%)</span>
        )}
      </div>
      <div className="text-right">
        <ChangeIndicator
          value={change}
          percentage={changePercent}
          inverse={inverse}
          formatValue={formatValue}
        />
      </div>
    </div>
  );
}

export function PLPeriodComparison({ comparison, showDetailedBreakdown = true }: PLPeriodComparisonProps) {
  const { format: formatCurrency } = useCurrency();
  const { current, previous, changes } = comparison;
  
  const currentNetSales = current.revenue.netSales;
  const previousNetSales = previous.revenue.netSales;
  
  const getPercentOfSales = (amount: number, netSales: number) => 
    netSales > 0 ? (amount / netSales) * 100 : 0;

  return (
    <Card className="fade-slide-in">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-medium">Period Comparison</CardTitle>
          <div className="flex gap-2">
            <Badge variant="outline">{current.periodLabel}</Badge>
            <span className="text-muted-foreground">vs</span>
            <Badge variant="secondary">{previous.periodLabel}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard
            title="Revenue"
            icon={DollarSign}
            current={current.revenue.netSales}
            change={changes.revenue}
            changePercent={changes.revenuePercent}
            formatValue={formatCurrency}
          />
          <SummaryCard
            title="Gross Profit"
            icon={TrendingUp}
            current={current.grossProfit}
            change={changes.grossProfit}
            changePercent={changes.grossProfitPercent}
            formatValue={formatCurrency}
          />
          <SummaryCard
            title="Operating Profit"
            icon={TrendingUp}
            current={current.operatingProfit}
            change={changes.operatingProfit}
            changePercent={changes.operatingProfitPercent}
            formatValue={formatCurrency}
          />
          <SummaryCard
            title="Net Income"
            icon={current.netIncome >= 0 ? TrendingUp : TrendingDown}
            current={current.netIncome}
            change={changes.netIncome}
            changePercent={changes.netIncomePercent}
            formatValue={formatCurrency}
            highlight={current.netIncome >= 0}
          />
        </div>

        {showDetailedBreakdown && (
          <>
            <Separator />
            
            {/* Detailed Comparison Table */}
            <div className="space-y-4">
              {/* Header */}
              <div className="grid grid-cols-4 gap-4 text-xs font-medium text-muted-foreground uppercase tracking-wider pb-2 border-b">
                <div>Metric</div>
                <div className="text-right">{current.periodLabel}</div>
                <div className="text-right">{previous.periodLabel}</div>
                <div className="text-right">Change</div>
              </div>

              {/* Revenue Section */}
              <div>
                <h4 className="text-sm font-semibold text-primary mb-2">REVENUE</h4>
                <ComparisonRow
                  label="Gross Sales"
                  current={current.revenue.grossSales}
                  previous={previous.revenue.grossSales}
                  formatValue={formatCurrency}
                />
                <ComparisonRow
                  label="Discounts"
                  current={current.revenue.discounts}
                  previous={previous.revenue.discounts}
                  formatValue={formatCurrency}
                  inverse
                  indent
                />
                <ComparisonRow
                  label="Net Sales"
                  current={current.revenue.netSales}
                  previous={previous.revenue.netSales}
                  formatValue={formatCurrency}
                  highlight
                />
              </div>

              {/* COGS Section */}
              <div>
                <h4 className="text-sm font-semibold text-primary mb-2">COST OF GOODS SOLD</h4>
                <ComparisonRow
                  label="Food Cost"
                  current={current.cogs.foodCost}
                  previous={previous.cogs.foodCost}
                  formatValue={formatCurrency}
                  showPercentage
                  currentPercentage={getPercentOfSales(current.cogs.foodCost, currentNetSales)}
                  previousPercentage={getPercentOfSales(previous.cogs.foodCost, previousNetSales)}
                  inverse
                  indent
                  info={
                    <OtherExpensesInfo
                      currentItems={current.cogs.foodCostBreakdown || []}
                      previousItems={previous.cogs.foodCostBreakdown || []}
                      currentLabel={current.periodLabel}
                      previousLabel={previous.periodLabel}
                      formatValue={formatCurrency}
                      title="Food cost breakdown"
                      ariaLabel="Food cost details"
                    />
                  }
                />
                <ComparisonRow
                  label="Beverage Cost"
                  current={current.cogs.beverageCost}
                  previous={previous.cogs.beverageCost}
                  formatValue={formatCurrency}
                  inverse
                  indent
                  info={
                    <OtherExpensesInfo
                      currentItems={current.cogs.beverageCostBreakdown || []}
                      previousItems={previous.cogs.beverageCostBreakdown || []}
                      currentLabel={current.periodLabel}
                      previousLabel={previous.periodLabel}
                      formatValue={formatCurrency}
                      title="Beverage cost breakdown"
                      ariaLabel="Beverage cost details"
                    />
                  }
                />
                <ComparisonRow
                  label="Total COGS"
                  current={current.cogs.totalCOGS}
                  previous={previous.cogs.totalCOGS}
                  formatValue={formatCurrency}
                  showPercentage
                  currentPercentage={getPercentOfSales(current.cogs.totalCOGS, currentNetSales)}
                  previousPercentage={getPercentOfSales(previous.cogs.totalCOGS, previousNetSales)}
                  inverse
                  highlight
                />
              </div>

              {/* Gross Profit */}
              <div className="bg-success/10 rounded-lg p-3 -mx-3">
                <ComparisonRow
                  label="GROSS PROFIT"
                  current={current.grossProfit}
                  previous={previous.grossProfit}
                  formatValue={formatCurrency}
                  showPercentage
                  currentPercentage={current.grossMargin}
                  previousPercentage={previous.grossMargin}
                  highlight
                />
              </div>

              {/* Operating Expenses */}
              <div>
                <h4 className="text-sm font-semibold text-primary mb-2">OPERATING EXPENSES</h4>
                <ComparisonRow
                  label="Labor Cost"
                  current={current.operatingExpenses.laborCost}
                  previous={previous.operatingExpenses.laborCost}
                  formatValue={formatCurrency}
                  showPercentage
                  currentPercentage={getPercentOfSales(current.operatingExpenses.laborCost, currentNetSales)}
                  previousPercentage={getPercentOfSales(previous.operatingExpenses.laborCost, previousNetSales)}
                  inverse
                  indent
                  info={
                    <LaborInfo
                      currentItems={current.operatingExpenses.laborBreakdown || []}
                      previousItems={previous.operatingExpenses.laborBreakdown || []}
                      currentLabel={current.periodLabel}
                      previousLabel={previous.periodLabel}
                      formatValue={formatCurrency}
                    />
                  }
                />
                {(current.operatingExpenses.payrollDeductions?.total ?? 0) > 0 && (
                  <ComparisonRow
                    label="Payroll deductions (memo)"
                    current={current.operatingExpenses.payrollDeductions?.total ?? 0}
                    previous={previous.operatingExpenses.payrollDeductions?.total ?? 0}
                    formatValue={formatCurrency}
                    indent
                    info={
                      <BreakdownInfo
                        title="Advance & fine recoveries"
                        ariaLabel="Payroll deduction details"
                        currentItems={[
                          {
                            name: "Advances recovered",
                            amount: current.operatingExpenses.payrollDeductions.advanceRecovered,
                          },
                          {
                            name: "Fines deducted",
                            amount: current.operatingExpenses.payrollDeductions.finesDeducted,
                          },
                          {
                            name: "Other deductions",
                            amount: current.operatingExpenses.payrollDeductions.otherDeductions,
                          },
                          {
                            name: "Net payable to staff",
                            amount: current.operatingExpenses.payrollDeductions.netPayable,
                          },
                        ].filter((i) => i.amount > 0)}
                        previousItems={[]}
                        currentLabel={current.periodLabel}
                        previousLabel={previous.periodLabel}
                        formatValue={formatCurrency}
                      />
                    }
                  />
                )}
                <ComparisonRow
                  label="Overhead"
                  current={current.operatingExpenses.totalOverhead}
                  previous={previous.operatingExpenses.totalOverhead}
                  formatValue={formatCurrency}
                  inverse
                  indent
                  info={
                    <OverheadInfo
                      currentItems={current.operatingExpenses.overhead || []}
                      previousItems={previous.operatingExpenses.overhead || []}
                      currentLabel={current.periodLabel}
                      previousLabel={previous.periodLabel}
                      formatValue={formatCurrency}
                    />
                  }
                />
                <ComparisonRow
                  label="Other Expenses"
                  current={current.operatingExpenses.otherExpenses}
                  previous={previous.operatingExpenses.otherExpenses}
                  formatValue={formatCurrency}
                  inverse
                  indent
                  info={
                    <OtherExpensesInfo
                      currentItems={current.operatingExpenses.otherExpenseBreakdown || []}
                      previousItems={previous.operatingExpenses.otherExpenseBreakdown || []}
                      currentLabel={current.periodLabel}
                      previousLabel={previous.periodLabel}
                      formatValue={formatCurrency}
                    />
                  }
                />
              </div>

              {/* Prime Cost */}
              <div className={cn(
                "rounded-lg p-3 -mx-3",
                current.primeCostPercentage <= 65 ? "bg-success/10" : "bg-warning/10"
              )}>
                <ComparisonRow
                  label="Prime Cost (Food + Labor)"
                  current={current.primeCost}
                  previous={previous.primeCost}
                  formatValue={formatCurrency}
                  showPercentage
                  currentPercentage={current.primeCostPercentage}
                  previousPercentage={previous.primeCostPercentage}
                  inverse
                  highlight
                />
              </div>

              {/* Net Income */}
              <div className={cn(
                "rounded-lg p-4 border-2 -mx-3",
                current.netIncome >= 0 ? "border-success bg-success/5" : "border-destructive bg-destructive/5"
              )}>
                <ComparisonRow
                  label="NET INCOME"
                  current={current.netIncome}
                  previous={previous.netIncome}
                  formatValue={formatCurrency}
                  showPercentage
                  currentPercentage={current.netMargin}
                  previousPercentage={previous.netMargin}
                  highlight
                />
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface OtherExpensesInfoProps {
  currentItems: { name: string; amount: number; count: number }[];
  previousItems: { name: string; amount: number; count: number }[];
  currentLabel: string;
  previousLabel: string;
  formatValue: (v: number) => string;
  title?: string;
  ariaLabel?: string;
}

/** Info badge listing the line items that make up a cost row. */
function OtherExpensesInfo({
  currentItems,
  previousItems,
  currentLabel,
  previousLabel,
  formatValue,
  title = "Other expenses breakdown",
  ariaLabel = "Other expenses details",
}: OtherExpensesInfoProps) {
  const prevMap = new Map(previousItems.map((i) => [i.name, i.amount]));
  const names = Array.from(
    new Set([...currentItems.map((i) => i.name), ...previousItems.map((i) => i.name)]),
  );
  const rows = names
    .map((name) => {
      const cur = currentItems.find((i) => i.name === name);
      return {
        name,
        current: cur?.amount || 0,
        count: cur?.count || 0,
        previous: prevMap.get(name) || 0,
      };
    })
    .sort((a, b) => b.current - a.current);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground transition-colors"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0 max-h-[60vh] overflow-hidden">
        <div className="px-3 py-2 border-b">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">
            {currentLabel} vs {previousLabel}
          </p>
        </div>
        {rows.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">No entries in this period.</p>
        ) : (
          <div className="max-h-[calc(60vh-3.25rem)] overflow-y-auto overscroll-contain">
            <div className="divide-y">
              {rows.map((r) => (
                <div key={r.name} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm truncate">{r.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.count} entr{r.count === 1 ? "y" : "ies"} · prev {formatValue(r.previous)}
                    </p>
                  </div>
                  <span className="text-sm tabular-nums font-medium">{formatValue(r.current)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

interface BreakdownInfoProps {
  currentItems: { name: string; amount: number; count?: number }[];
  previousItems: { name: string; amount: number; count?: number }[];
  currentLabel: string;
  previousLabel: string;
  formatValue: (v: number) => string;
  title: string;
  ariaLabel: string;
}

/** Generic info badge listing line items that make up a P&L row. */
function BreakdownInfo({
  currentItems,
  previousItems,
  currentLabel,
  previousLabel,
  formatValue,
  title,
  ariaLabel,
}: BreakdownInfoProps) {
  const prevMap = new Map(previousItems.map((i) => [i.name, i]));
  const names = Array.from(
    new Set([...currentItems.map((i) => i.name), ...previousItems.map((i) => i.name)]),
  );
  const rows = names
    .map((name) => {
      const cur = currentItems.find((i) => i.name === name);
      const prev = prevMap.get(name);
      return {
        name,
        current: cur?.amount || 0,
        count: cur?.count,
        previous: prev?.amount || 0,
      };
    })
    .sort((a, b) => b.current - a.current);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground transition-colors"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0 max-h-[60vh] overflow-hidden">
        <div className="px-3 py-2 border-b">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">
            {currentLabel} vs {previousLabel}
          </p>
        </div>
        {rows.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">No items in this period.</p>
        ) : (
          <div className="max-h-[calc(60vh-3.25rem)] overflow-y-auto overscroll-contain">
            <div className="divide-y">
              {rows.map((r) => (
                <div key={r.name} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm truncate">{r.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.count != null
                        ? `${r.count} entr${r.count === 1 ? "y" : "ies"} · `
                        : ""}
                      prev {formatValue(r.previous)}
                    </p>
                  </div>
                  <span className="text-sm tabular-nums font-medium">{formatValue(r.current)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Info badge listing the per-staff prorated amounts that make up "Labor Cost". */
function LaborInfo(props: Omit<BreakdownInfoProps, "title" | "ariaLabel">) {
  return <BreakdownInfo {...props} title="Labor cost breakdown" ariaLabel="Labor cost details" />;
}

/** Info badge listing the overhead allocation items that make up "Overhead". */
function OverheadInfo(props: Omit<BreakdownInfoProps, "title" | "ariaLabel">) {
  return <BreakdownInfo {...props} title="Overhead breakdown" ariaLabel="Overhead details" />;
}

interface SummaryCardProps {
  title: string;
  icon: React.ElementType;
  current: number;
  change: number;
  changePercent: number;
  formatValue: (v: number) => string;
  highlight?: boolean;
}

function SummaryCard({ title, icon: Icon, current, change, changePercent, formatValue, highlight }: SummaryCardProps) {
  const isPositive = change > 0;
  const isNegative = change < 0;
  
  return (
    <div className={cn(
      "rounded-lg border p-3 space-y-1",
      highlight && current >= 0 && "border-success/50 bg-success/5"
    )}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3 w-3" />
        {title}
      </div>
      <p className={cn(
        "text-lg font-semibold tabular-nums",
        current < 0 && "text-destructive"
      )}>
        {formatValue(current)}
      </p>
      <div className={cn(
        "flex items-center gap-1 text-xs",
        isPositive && "text-success",
        isNegative && "text-destructive",
        !isPositive && !isNegative && "text-muted-foreground"
      )}>
        {isPositive && <ArrowUp className="h-3 w-3" />}
        {isNegative && <ArrowDown className="h-3 w-3" />}
        <span>{changePercent >= 0 ? "+" : ""}{changePercent.toFixed(1)}%</span>
      </div>
    </div>
  );
}
