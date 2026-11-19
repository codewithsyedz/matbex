import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChartContainer,
  ChartTooltip,
} from "@/components/ui/chart";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  ReferenceLine,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { format, addDays, subDays, startOfMonth, endOfMonth } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { useCOGS } from "@/hooks/useCOGS";
import { useCOGSSubmissions } from "@/hooks/useCOGSSubmissions";
import {
  AlertCircle,
  TrendingUp,
  TrendingDown,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  PieChart as PieChartIcon,
  BarChart2,
  Layers,
  Package,
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
  FileText,
  FileCheck,
  Download,
  FileSpreadsheet,
  Target,
  CalendarIcon,
  CheckCircle,
  AlertTriangle,
  ShoppingCart,
  Percent,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { COGSSubmissionsList, COGSApprovalQueue } from "@/components/cogs";
import { exportCOGSSummaryReport } from "@/lib/cogsExportUtils";
import { LockedFeatureScreen } from "@/components/LockedFeatureScreen";

const chartConfig = {
  cogs: { label: "COGS %", color: "hsl(var(--chart-5))" },
  target: { label: "Target", color: "hsl(var(--muted))" },
  grossMargin: { label: "Gross Margin", color: "hsl(var(--success))" },
};

/**
 * Plan gate. The screen itself is a separate component so its hooks always run in the same
 * order: returning the locked screen before them broke the rules of hooks and crashed the
 * page ("Rendered more hooks than during the previous render") when the plan's features
 * changed while it was open.
 */
export default function COGSPage() {
  const { hasFeature, loading: authLoading } = useAuth();

  // Show locked screen if COGS feature is not enabled
  if (!authLoading && !hasFeature("cogs")) {
    return (
      <>
        <LockedFeatureScreen 
          featureName="COGS Tracking" 
          description="Track your cost of goods sold, monitor food cost percentages, and optimize your margins with detailed analytics."
          featureKey="cogs"
        />
      </>
    );
  }

  return <COGSScreen />;
}

function COGSScreen() {
  const { isManager, isOwner, hasFeature, loading: authLoading } = useAuth();
  const { t } = useTranslation();


  const [selectedDate, setSelectedDate] = useState(new Date());
  const [activeTab, setActiveTab] = useState("dashboard");
  const { today, yesterday, weekData, monthlyAverage, ingredientBreakdown, topCostItems, isLoading } = useCOGS(selectedDate);
  const { submissions, pendingApprovals } = useCOGSSubmissions({
    from: startOfMonth(selectedDate),
    to: endOfMonth(selectedDate),
  });
  const { format: formatCurrency } = useCurrency();

  const goToPreviousDay = () => setSelectedDate((d) => subDays(d, 1));
  const goToNextDay = () => setSelectedDate((d) => addDays(d, 1));
  const isToday = format(selectedDate, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");

  // Trend chart data
  const trendData = weekData.map((d) => ({
    date: format(new Date(d.date), "MMM d"),
    cogsPercentage: d.cogsPercentage,
    grossMargin: d.grossMargin,
    variance: d.variancePercentage,
  }));

  // Status helpers
  const getCOGSStatus = (percentage: number) => {
    if (percentage <= 40) return { status: "healthy", color: "text-success", bg: "bg-success/10" };
    if (percentage <= 45) return { status: "warning", color: "text-warning", bg: "bg-warning/10" };
    return { status: "critical", color: "text-destructive", bg: "bg-destructive/10" };
  };

  const getVarianceStatus = (variance: number) => {
    const abs = Math.abs(variance);
    if (abs <= 5) return { label: "OK", color: "text-success", bg: "bg-success/10" };
    if (abs <= 10) return { label: "Warning", color: "text-warning", bg: "bg-warning/10" };
    return { label: "Investigate", color: "text-destructive", bg: "bg-destructive/10" };
  };

  const handleExportSummary = () => {
    if (submissions && submissions.length > 0) {
      exportCOGSSummaryReport(
        submissions,
        { from: startOfMonth(selectedDate), to: endOfMonth(selectedDate) }
      );
    }
  };

  if (isLoading) {
    return (
      <>
        <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        </div>
      </>
    );
  }

  const cogsStatus = today ? getCOGSStatus(today.cogsPercentage) : getCOGSStatus(0);
  const varianceStatus = today ? getVarianceStatus(today.variancePercentage) : getVarianceStatus(0);

  return (
    <>
      <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
        {/* Header */}
        <header className="fade-slide-in">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">
                  {t("app.cogs.title")}
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                  {t("app.cogs.subtitle")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleExportSummary} disabled={!submissions?.length}>
                  <Download className="h-4 w-4 mr-2" />
                  {t("app.cogs.exportReport")}
                </Button>
              </div>
            </div>
          </div>
        </header>

        {/* Main Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="fade-slide-in">
          <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 lg:w-auto lg:inline-grid">
            <TabsTrigger value="dashboard" className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              <span className="hidden sm:inline">{t("app.cogs.tabs.dashboard")}</span>
            </TabsTrigger>
            <TabsTrigger value="submissions" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              <span className="hidden sm:inline">{t("app.cogs.tabs.submissions")}</span>
            </TabsTrigger>
            {(isManager || isOwner) && (
              <TabsTrigger value="approvals" className="flex items-center gap-2">
                <FileCheck className="h-4 w-4" />
                <span className="hidden sm:inline">{t("app.cogs.tabs.approvals")}</span>
                {pendingApprovals && pendingApprovals.length > 0 && (
                  <Badge variant="destructive" className="ml-1 h-5 w-5 p-0 flex items-center justify-center text-xs">
                    {pendingApprovals.length}
                  </Badge>
                )}
              </TabsTrigger>
            )}
            <TabsTrigger value="analysis" className="flex items-center gap-2">
              <Target className="h-4 w-4" />
              <span className="hidden sm:inline">{t("app.cogs.tabs.analysis")}</span>
            </TabsTrigger>
          </TabsList>

          {/* Dashboard Tab */}
          <TabsContent value="dashboard" className="space-y-6 mt-6">
            {/* Date Navigator */}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="icon" onClick={goToPreviousDay}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-[140px] sm:w-[180px] justify-start text-left font-normal text-sm">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(selectedDate, "MMM d, yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={(date) => date && setSelectedDate(date)}
                    disabled={(date) => date > new Date()}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              
              <Button variant="outline" size="icon" onClick={goToNextDay} disabled={isToday}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              
              {!isToday && (
                <Button variant="ghost" size="sm" onClick={() => setSelectedDate(new Date())}>
                  Today
                </Button>
              )}
            </div>

            {/* Status Banner */}
            {today && (
              <div
                className={cn(
                  "flex items-center justify-between p-4 rounded-lg border",
                  cogsStatus.bg,
                  cogsStatus.status === "healthy" ? "border-success/30" : cogsStatus.status === "warning" ? "border-warning/30" : "border-destructive/30"
                )}
              >
                <div className="flex items-center gap-3">
                  {cogsStatus.status === "healthy" ? (
                    <CheckCircle className="h-5 w-5 text-success" />
                  ) : (
                    <AlertTriangle className={cn("h-5 w-5", cogsStatus.color)} />
                  )}
                  <div>
                    <span className={cn("font-medium", cogsStatus.color)}>
                      {cogsStatus.status === "healthy" ? "Healthy COGS" : cogsStatus.status === "warning" ? "COGS Warning" : "COGS Critical"}
                    </span>
                    <span className="ml-2 text-sm text-muted-foreground">
                      {today.cogsPercentage.toFixed(1)}% of sales
                    </span>
                  </div>
                </div>
                <Badge variant="outline" className={cn(varianceStatus.bg, varianceStatus.color)}>
                  Variance: {today.variancePercentage >= 0 ? "+" : ""}{today.variancePercentage.toFixed(1)}%
                </Badge>
              </div>
            )}

            {/* COGS Formula Card */}
            <Card className="border-dashed">
              <CardContent className="pt-6">
                <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted">
                    <Package className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">Opening Stock</p>
                      <p className="font-semibold">{formatCurrency(today?.openingStock || 0)}</p>
                    </div>
                  </div>
                  <span className="text-xl font-light text-muted-foreground">+</span>
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted">
                    <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">Purchases</p>
                      <p className="font-semibold">{formatCurrency(today?.purchases || 0)}</p>
                    </div>
                  </div>
                  <span className="text-xl font-light text-muted-foreground">−</span>
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted">
                    <Package className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">Closing Stock</p>
                      <p className="font-semibold">{formatCurrency(today?.closingStock || 0)}</p>
                    </div>
                  </div>
                  <span className="text-xl font-light text-muted-foreground">=</span>
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20">
                    <DollarSign className="h-4 w-4 text-primary" />
                    <div>
                      <p className="text-xs text-muted-foreground">COGS</p>
                      <p className="font-semibold text-primary">{formatCurrency(today?.cogs || 0)}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {today ? (
                <>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider mb-1">
                        <Percent className="h-3 w-3" />
                        COGS %
                      </div>
                      <p className={cn("text-2xl font-semibold", cogsStatus.color)}>
                        {today.cogsPercentage.toFixed(1)}%
                      </p>
                      <div className="mt-2">
                        <Progress 
                          value={Math.min(today.cogsPercentage, 100)} 
                          className="h-1.5"
                        />
                        <p className="text-xs text-muted-foreground mt-1">Target: ≤40%</p>
                      </div>
                    </CardContent>
                  </Card>
                  
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider mb-1">
                        <TrendingUp className="h-3 w-3" />
                        Gross Profit
                      </div>
                      <p className={cn(
                        "text-2xl font-semibold",
                        today.grossProfit >= 0 ? "text-success" : "text-destructive"
                      )}>
                        {formatCurrency(today.grossProfit)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {today.grossMargin.toFixed(1)}% margin
                      </p>
                    </CardContent>
                  </Card>
                  
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider mb-1">
                        <Target className="h-3 w-3" />
                        Variance
                      </div>
                      <p className={cn("text-2xl font-semibold", varianceStatus.color)}>
                        {today.variance >= 0 ? "+" : ""}{formatCurrency(today.variance)}
                      </p>
                      <Badge variant="outline" className={cn("mt-1", varianceStatus.bg, varianceStatus.color)}>
                        {varianceStatus.label}
                      </Badge>
                    </CardContent>
                  </Card>
                  
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider mb-1">
                        <DollarSign className="h-3 w-3" />
                        Net Sales
                      </div>
                      <p className="text-2xl font-semibold">
                        {formatCurrency(today.netSales)}
                      </p>
                      {yesterday && (
                        <div className="flex items-center gap-1 mt-1 text-xs">
                          {today.netSales >= yesterday.netSales ? (
                            <ArrowUpRight className="h-3 w-3 text-success" />
                          ) : (
                            <ArrowDownRight className="h-3 w-3 text-destructive" />
                          )}
                          <span className="text-muted-foreground">vs yesterday</span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </>
              ) : (
                <Card className="col-span-full">
                  <CardContent className="pt-6 text-center">
                    <Package className="h-10 w-10 mx-auto mb-3 text-muted-foreground opacity-50" />
                    <p className="text-muted-foreground">No COGS data available</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Record inventory usage to track food costs
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* 7-Day Trend Chart */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-medium">7-Day COGS Trend</CardTitle>
                <CardDescription>Target: ≤40% Healthy | 41-45% Warning | &gt;45% Critical</CardDescription>
              </CardHeader>
              <CardContent>
                {trendData.length > 0 ? (
                  <ChartContainer config={chartConfig} className="h-[250px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={trendData}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                        <XAxis dataKey="date" className="text-xs" />
                        <YAxis domain={[0, 80]} className="text-xs" tickFormatter={(v) => `${v}%`} />
                        <ChartTooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const data = payload[0].payload;
                            return (
                              <div className="bg-popover border rounded-lg p-3 shadow-lg">
                                <p className="font-medium">{data.date}</p>
                                <p className="text-sm">COGS: {data.cogsPercentage.toFixed(1)}%</p>
                                <p className="text-sm">Gross Margin: {data.grossMargin.toFixed(1)}%</p>
                              </div>
                            );
                          }}
                        />
                        <ReferenceLine y={40} stroke="hsl(var(--success))" strokeDasharray="5 5" />
                        <ReferenceLine y={45} stroke="hsl(var(--warning))" strokeDasharray="5 5" />
                        <Bar dataKey="cogsPercentage" radius={[4, 4, 0, 0]}>
                          {trendData.map((entry, index) => (
                            <Cell 
                              key={`cell-${index}`} 
                              fill={
                                entry.cogsPercentage <= 40 
                                  ? "hsl(var(--success))" 
                                  : entry.cogsPercentage <= 45 
                                    ? "hsl(var(--warning))" 
                                    : "hsl(var(--destructive))"
                              }
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartContainer>
                ) : (
                  <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                    No trend data available
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Submissions Tab */}
          <TabsContent value="submissions" className="mt-6">
            <COGSSubmissionsList />
          </TabsContent>

          {/* Approvals Tab - Manager/Owner only */}
          {(isManager || isOwner) && (
            <TabsContent value="approvals" className="mt-6">
              <COGSApprovalQueue />
            </TabsContent>
          )}

          {/* Analysis Tab */}
          <TabsContent value="analysis" className="space-y-6 mt-6">
            {/* Weekly Averages */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardContent className="pt-6 text-center">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Avg COGS %</p>
                  <p className={cn(
                    "text-3xl font-semibold",
                    monthlyAverage.cogsPercentage <= 40 ? "text-success" : monthlyAverage.cogsPercentage <= 45 ? "text-warning" : "text-destructive"
                  )}>
                    {monthlyAverage.cogsPercentage.toFixed(1)}%
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6 text-center">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Avg Gross Margin</p>
                  <p className="text-3xl font-semibold text-success">
                    {monthlyAverage.grossMargin.toFixed(1)}%
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6 text-center">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Avg Variance</p>
                  <p className={cn(
                    "text-3xl font-semibold",
                    monthlyAverage.variancePercentage <= 5 ? "text-success" : "text-warning"
                  )}>
                    ±{monthlyAverage.variancePercentage.toFixed(1)}%
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Top Cost Items */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-medium">Top Cost Items</CardTitle>
                <CardDescription>Highest cost ingredients today</CardDescription>
              </CardHeader>
              <CardContent>
                {topCostItems.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ingredient</TableHead>
                        <TableHead className="text-right">Used</TableHead>
                        <TableHead className="text-right">Cost</TableHead>
                        <TableHead className="text-right">% of COGS</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topCostItems.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">{item.name}</TableCell>
                          <TableCell className="text-right">{item.used.toFixed(2)} {item.unit}</TableCell>
                          <TableCell className="text-right">{formatCurrency(item.totalCost)}</TableCell>
                          <TableCell className="text-right">
                            <Badge variant="outline">{item.percentage.toFixed(1)}%</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    No usage data for today
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Ingredient Breakdown */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-medium">Ingredient Breakdown</CardTitle>
                <CardDescription>Full inventory movement for {format(selectedDate, "MMMM d, yyyy")}</CardDescription>
              </CardHeader>
              <CardContent>
                {ingredientBreakdown.length > 0 ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item</TableHead>
                          <TableHead className="text-right">Opening</TableHead>
                          <TableHead className="text-right">Purchased</TableHead>
                          <TableHead className="text-right">Used</TableHead>
                          <TableHead className="text-right">Closing</TableHead>
                          <TableHead className="text-right">Cost</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ingredientBreakdown.slice(0, 10).map((item) => (
                          <TableRow key={item.id}>
                            <TableCell className="font-medium">{item.name}</TableCell>
                            <TableCell className="text-right">{item.openingStock.toFixed(2)}</TableCell>
                            <TableCell className="text-right text-success">+{item.purchased.toFixed(2)}</TableCell>
                            <TableCell className="text-right text-destructive">-{item.used.toFixed(2)}</TableCell>
                            <TableCell className="text-right">{item.closingStock.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(item.totalCost)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    No ingredient data available
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
