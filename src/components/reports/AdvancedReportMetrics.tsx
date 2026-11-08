import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  DollarSign, 
  Users, 
  Building2, 
  TrendingUp,
  Utensils,
  Percent,
  AlertTriangle,
  CheckCircle
} from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";

interface AdvancedReportMetricsProps {
  totalSales: number;
  foodCost: number;
  laborCost: number;
  overheadCost: number;
  otherExpenses: number;
  rangeDays: number;
}

export function AdvancedReportMetrics({
  totalSales,
  foodCost,
  laborCost,
  overheadCost,
  otherExpenses,
  rangeDays,
}: AdvancedReportMetricsProps) {
  const { format: formatCurrency } = useCurrency();

  // Calculate key metrics
  const primeCost = foodCost + laborCost;
  const primeCostPercent = totalSales > 0 ? (primeCost / totalSales) * 100 : 0;
  const foodCostPercent = totalSales > 0 ? (foodCost / totalSales) * 100 : 0;
  const laborCostPercent = totalSales > 0 ? (laborCost / totalSales) * 100 : 0;
  const overheadPercent = totalSales > 0 ? (overheadCost / totalSales) * 100 : 0;
  
  const totalCosts = primeCost + overheadCost + otherExpenses;
  const grossProfit = totalSales - foodCost;
  const grossMargin = totalSales > 0 ? (grossProfit / totalSales) * 100 : 0;
  const operatingProfit = totalSales - totalCosts;
  const operatingMargin = totalSales > 0 ? (operatingProfit / totalSales) * 100 : 0;

  // Daily averages
  const avgDailySales = rangeDays > 0 ? totalSales / rangeDays : 0;
  const avgDailyLabor = rangeDays > 0 ? laborCost / rangeDays : 0;
  const avgDailyProfit = rangeDays > 0 ? operatingProfit / rangeDays : 0;

  // Industry benchmarks
  const isPrimeCostHealthy = primeCostPercent <= 65;
  const isFoodCostHealthy = foodCostPercent <= 30;
  const isLaborCostHealthy = laborCostPercent <= 30;
  const isMarginHealthy = operatingMargin >= 10;

  const getHealthBadge = (isHealthy: boolean, goodText: string, badText: string) => (
    <Badge variant={isHealthy ? "default" : "destructive"} className="text-xs">
      {isHealthy ? <CheckCircle className="h-3 w-3 mr-1" /> : <AlertTriangle className="h-3 w-3 mr-1" />}
      {isHealthy ? goodText : badText}
    </Badge>
  );

  return (
    <div className="space-y-6">
      {/* Prime Cost Analysis */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="fade-slide-in">
          <CardHeader className="pb-3">
            <CardTitle className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
              <Percent className="h-4 w-4" />
              Prime Cost
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <p className={`font-display text-2xl font-semibold tabular-nums ${isPrimeCostHealthy ? "text-success" : "text-destructive"}`}>
                {primeCostPercent.toFixed(1)}%
              </p>
              {getHealthBadge(isPrimeCostHealthy, "Healthy", "High")}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {formatCurrency(primeCost)} of {formatCurrency(totalSales)}
            </p>
            <Progress value={Math.min(primeCostPercent, 100)} className="mt-2 h-2" />
            <p className="text-xs text-muted-foreground mt-1">Target: ≤65%</p>
          </CardContent>
        </Card>

        <Card className="fade-slide-in" style={{ animationDelay: "50ms" }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
              <Utensils className="h-4 w-4" />
              Food Cost
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <p className={`font-display text-2xl font-semibold tabular-nums ${isFoodCostHealthy ? "text-success" : "text-warning"}`}>
                {foodCostPercent.toFixed(1)}%
              </p>
              {getHealthBadge(isFoodCostHealthy, "On Target", "Above Target")}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {formatCurrency(foodCost)}
            </p>
            <Progress value={Math.min(foodCostPercent, 100)} className="mt-2 h-2" />
            <p className="text-xs text-muted-foreground mt-1">Target: ≤30%</p>
          </CardContent>
        </Card>

        <Card className="fade-slide-in" style={{ animationDelay: "100ms" }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
              <Users className="h-4 w-4" />
              Labor Cost
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <p className={`font-display text-2xl font-semibold tabular-nums ${isLaborCostHealthy ? "text-success" : "text-warning"}`}>
                {laborCostPercent.toFixed(1)}%
              </p>
              {getHealthBadge(isLaborCostHealthy, "On Target", "Above Target")}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {formatCurrency(laborCost)}
            </p>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-muted-foreground">Daily avg:</span>
              <span className="text-xs font-medium">{formatCurrency(avgDailyLabor)}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="fade-slide-in" style={{ animationDelay: "150ms" }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Overhead
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {overheadPercent.toFixed(1)}%
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {formatCurrency(overheadCost)}
            </p>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-muted-foreground">Daily allocation:</span>
              <span className="text-xs font-medium">{formatCurrency(rangeDays > 0 ? overheadCost / rangeDays : 0)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Profit Margins */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="fade-slide-in" style={{ animationDelay: "200ms" }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Gross Profit
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`font-display text-2xl font-semibold tabular-nums ${grossProfit >= 0 ? "text-success" : "text-destructive"}`}>
              {formatCurrency(grossProfit)}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm text-muted-foreground">Gross Margin:</span>
              <span className="text-sm font-medium">{grossMargin.toFixed(1)}%</span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Sales minus food cost
            </p>
          </CardContent>
        </Card>

        <Card className="fade-slide-in" style={{ animationDelay: "250ms" }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Operating Profit
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <p className={`font-display text-2xl font-semibold tabular-nums ${operatingProfit >= 0 ? "text-success" : "text-destructive"}`}>
                {formatCurrency(operatingProfit)}
              </p>
              {getHealthBadge(isMarginHealthy, "Good Margin", "Low Margin")}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm text-muted-foreground">Operating Margin:</span>
              <span className="text-sm font-medium">{operatingMargin.toFixed(1)}%</span>
            </div>
          </CardContent>
        </Card>

        <Card className="fade-slide-in" style={{ animationDelay: "300ms" }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium text-muted-foreground">
              Daily Averages
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Avg Sales</span>
                <span className="text-sm font-medium">{formatCurrency(avgDailySales)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Avg Profit</span>
                <span className={`text-sm font-medium ${avgDailyProfit >= 0 ? "text-success" : "text-destructive"}`}>
                  {formatCurrency(avgDailyProfit)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Period</span>
                <span className="text-sm font-medium">{rangeDays} days</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
