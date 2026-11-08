import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDailyProfit, ProfitStatus } from "@/hooks/useDailyProfit";
import { useCurrency } from "@/hooks/useCurrency";
import { TrendingUp, TrendingDown, ChevronRight, ChevronLeft, Sparkles, AlertTriangle, CheckCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { format, subDays, addDays, isToday, startOfDay } from "date-fns";
import { useTranslation } from "react-i18next";
import { ar, enUS } from "date-fns/locale";

const statusConfig: Record<ProfitStatus, { color: string; bg: string; icon: typeof CheckCircle }> = {
  excellent: { color: "text-success", bg: "bg-success/10", icon: Sparkles },
  healthy: { color: "text-primary", bg: "bg-primary/10", icon: CheckCircle },
  attention: { color: "text-warning", bg: "bg-warning/10", icon: AlertTriangle },
  critical: { color: "text-destructive", bg: "bg-destructive/10", icon: AlertTriangle },
};

function AnimatedNumber({ value, format: formatFn }: { value: number; format: (v: number) => string }) {
  const [displayValue, setDisplayValue] = useState(0);
  const animationRef = useRef<number>();
  const startTimeRef = useRef<number>();
  const startValueRef = useRef(0);

  useEffect(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }

    startValueRef.current = displayValue;
    startTimeRef.current = undefined;
    const duration = 800;

    const animate = (timestamp: number) => {
      if (!startTimeRef.current) startTimeRef.current = timestamp;
      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);
      
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = startValueRef.current + (value - startValueRef.current) * eased;
      
      setDisplayValue(current);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [value]);

  return <span className="tabular-nums">{formatFn(displayValue)}</span>;
}

function MiniSparkline({ data, className }: { data: number[]; className?: string }) {
  if (data.length < 2) return null;
  
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const height = 24;
  const width = 60;
  
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg className={cn("overflow-visible", className)} width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
      {/* Dot on last point */}
      <circle
        cx={(data.length - 1) / (data.length - 1) * width}
        cy={height - ((data[data.length - 1] - min) / range) * height}
        r="2"
        fill="currentColor"
      />
    </svg>
  );
}

export function DailyProfitCard() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [selectedDate, setSelectedDate] = useState(() => subDays(new Date(), 1));
  const { today: dayData, yesterday, weekData, isLoading } = useDailyProfit(selectedDate);
  const { format: formatCurrency } = useCurrency();
  const [isHovered, setIsHovered] = useState(false);

  const isTodaySelected = isToday(selectedDate);
  const canGoForward = !isTodaySelected;

  const goToPreviousDay = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedDate(prev => subDays(prev, 1));
  };

  const goToNextDay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (canGoForward) {
      setSelectedDate(prev => addDays(prev, 1));
    }
  };

  const dateLabel = isTodaySelected
    ? t("app.dashboard.dailyProfit.todayProfit")
    : t("app.dashboard.dailyProfit.dateProfit", { date: format(selectedDate, "MMM d", { locale: i18n.language.startsWith("ar") ? ar : enUS }) });

  if (isLoading) {
    return (
      <Card className="relative overflow-hidden">
        <CardContent className="pt-6">
          <div className="space-y-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-40" />
            <div className="flex gap-4">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!dayData) {
    return (
      <Card className="relative overflow-hidden">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={goToPreviousDay}
              >
                <ChevronLeft className="h-4 w-4 rtl-flip" />
              </Button>
              <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                {dateLabel}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={goToNextDay}
                disabled={!canGoForward}
              >
                <ChevronRight className="h-4 w-4 rtl-flip" />
              </Button>
            </div>
          </div>
           <p className="text-muted-foreground text-center">{t("app.dashboard.dailyProfit.noData")}</p>
           <p className="text-xs text-muted-foreground mt-1 text-center">{t("app.dashboard.dailyProfit.startRecording")}</p>
        </CardContent>
      </Card>
    );
  }

  const status = statusConfig[dayData.status];
  const StatusIcon = status.icon;
  
  const profitChange = yesterday
    ? ((dayData.operatingProfit - yesterday.operatingProfit) / Math.abs(yesterday.operatingProfit || 1)) * 100
    : 0;
  const isPositiveChange = profitChange >= 0;

  const sparklineData = weekData.map((d) => d.operatingProfit);

  const totalExpenses = dayData.primeCost - dayData.allocatedOverhead;

  return (
    <Card
      className={cn(
        "relative overflow-hidden transition-all duration-300 cursor-pointer group",
        "hover:shadow-xl hover:-translate-y-1",
        dayData.status === "excellent" && "ring-2 ring-success/20"
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => navigate("/daily-profit")}
    >
      {/* Background gradient based on profit status */}
      <div className={cn(
        "absolute inset-0 opacity-30 pointer-events-none transition-opacity",
        dayData.operatingProfit >= 0 
          ? "bg-gradient-to-br from-success/10 via-transparent to-transparent" 
          : "bg-gradient-to-br from-destructive/10 via-transparent to-transparent"
      )} />
      
      <CardContent className="pt-6 relative">
        {/* Header Row */}
        <div className="flex items-center justify-between mb-4 md:mb-5 pe-16">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 md:h-7 md:w-7 hover:bg-muted"
              onClick={goToPreviousDay}
            >
              <ChevronLeft className="h-3.5 w-3.5 md:h-4 md:w-4 rtl-flip" />
            </Button>
            <span className="text-xs md:text-sm font-semibold text-foreground uppercase tracking-wide">
              {dateLabel}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 md:h-7 md:w-7 hover:bg-muted"
              onClick={goToNextDay}
              disabled={!canGoForward}
            >
              <ChevronRight className="h-3.5 w-3.5 md:h-4 md:w-4 rtl-flip" />
            </Button>
          </div>
          <div className={cn(
            "flex items-center gap-1 px-2 md:px-3 py-0.5 md:py-1 rounded-full text-[10px] md:text-xs font-semibold",
            status.bg, status.color
          )}>
            <StatusIcon className="h-3 w-3 md:h-3.5 md:w-3.5" />
             <span className="hidden sm:inline">{t(`app.dashboard.dailyProfit.status.${dayData.status}`)}</span>
          </div>
        </div>

        {/* Main Content Grid - Stack on mobile */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          {/* Left: Operating Profit */}
          <div className="md:col-span-5 flex flex-col">
            <p className="text-[10px] md:text-[11px] text-muted-foreground uppercase tracking-wider font-medium mb-1">
              {t("app.dashboard.dailyProfit.operatingProfit")}
            </p>
            <p className={cn(
              "text-2xl md:text-3xl font-bold tracking-tight",
              dayData.operatingProfit >= 0 ? "text-success" : "text-destructive"
            )}>
              <AnimatedNumber value={dayData.operatingProfit} format={formatCurrency} />
            </p>
            {yesterday && (
              <div className={cn(
                "flex items-center gap-1.5 mt-1.5 md:mt-2",
                isPositiveChange ? "text-success" : "text-destructive"
              )}>
                {isPositiveChange ? <TrendingUp className="h-3 w-3 md:h-3.5 md:w-3.5" /> : <TrendingDown className="h-3 w-3 md:h-3.5 md:w-3.5" />}
                 <span className="text-[10px] md:text-xs font-medium">{t("app.dashboard.dailyProfit.vsYesterday", { value: Math.abs(profitChange).toFixed(1) })}</span>
              </div>
            )}
          </div>

          {/* Center Divider - Hidden on mobile */}
          <div className="hidden md:col-span-1 md:flex justify-center">
            <div className="w-px h-full bg-border" />
          </div>

          {/* Right: Breakdown */}
          <div className="md:col-span-6 space-y-2 md:space-y-3 pt-3 md:pt-0 border-t md:border-t-0 border-border">
            {/* Net Sales with expense breakdown */}
            <div className="space-y-1 md:space-y-1.5">
              <div className="flex items-center justify-between">
                 <span className="text-xs md:text-sm text-muted-foreground">{t("app.dashboard.dailyProfit.netSales")}</span>
                <span className="text-xs md:text-sm font-semibold text-foreground">{formatCurrency(dayData.netSales)}</span>
              </div>
              {(dayData.paidExpenses > 0 || dayData.unpaidExpenses > 0) && (
                 <div className="ms-2 md:ms-3 ps-2 md:ps-3 border-s-2 border-muted space-y-0.5 md:space-y-1">
                  <div className="flex items-center justify-between text-[10px] md:text-xs">
                    <span className="text-success">{t("app.dashboard.dailyProfit.paidExpenses")}</span>
                    <span className="text-success">{formatCurrency(dayData.paidExpenses)}</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] md:text-xs">
                    <span className="text-warning">{t("app.dashboard.dailyProfit.unpaidExpenses")}</span>
                    <span className="text-warning">{formatCurrency(dayData.unpaidExpenses)}</span>
                  </div>
                </div>
              )}
            </div>
            
            {/* Prime Cost with breakdown */}
            <div className="space-y-1 md:space-y-1.5">
              <div className="flex items-center justify-between">
                 <span className="text-xs md:text-sm text-muted-foreground">{t("app.dashboard.dailyProfit.primeCost")}</span>
                <span className="text-xs md:text-sm font-semibold text-destructive">-{formatCurrency(dayData.primeCost)}</span>
              </div>
               <div className="ms-2 md:ms-3 ps-2 md:ps-3 border-s-2 border-muted space-y-0.5 md:space-y-1">
                <div className="flex items-center justify-between text-[10px] md:text-xs">
                   <span className="text-muted-foreground">{t("nav.expenses")}</span>
                  <span className="text-muted-foreground">{formatCurrency(totalExpenses)}</span>
                </div>
                <div className="flex items-center justify-between text-[10px] md:text-xs">
                   <span className="text-muted-foreground">{t("app.dashboard.dailyProfit.overhead")}</span>
                  <span className="text-muted-foreground">{formatCurrency(dayData.allocatedOverhead)}</span>
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-dashed border-muted-foreground/30" />
            
            {/* Result */}
            <div className="flex items-center justify-between">
               <span className="text-xs md:text-sm font-medium text-foreground">= {t("app.dashboard.dailyProfit.profit")}</span>
              <span className={cn(
                "text-xs md:text-sm font-bold",
                dayData.operatingProfit >= 0 ? "text-success" : "text-destructive"
              )}>
                {formatCurrency(dayData.operatingProfit)}
              </span>
            </div>
          </div>
        </div>

        {/* Bottom KPI Pills */}
        <div className="flex items-stretch gap-2 md:gap-3 mt-4 md:mt-5 pt-3 md:pt-4 border-t border-border">
          <div className={cn(
            "flex-1 flex items-center justify-between px-2 md:px-3 py-1.5 md:py-2 rounded-lg",
            dayData.primeCostPercentage <= 65 ? "bg-success/10" : "bg-warning/10"
          )}>
            <div>
              <p className="text-[9px] md:text-[10px] text-muted-foreground uppercase tracking-wider">{t("app.dashboard.dailyProfit.primeCost")}</p>
              <p className={cn(
                "text-base md:text-lg font-bold",
                dayData.primeCostPercentage <= 65 ? "text-success" : "text-warning"
              )}>
                {dayData.primeCostPercentage.toFixed(1)}%
              </p>
            </div>
            <div className="text-end">
              <p className={cn(
                "text-[9px] md:text-[10px] font-medium",
                dayData.primeCostPercentage <= 65 ? "text-success" : "text-warning"
              )}>
                {dayData.primeCostPercentage <= 65 ? `✓ ${t("app.dashboard.dailyProfit.onTarget")}` : t("app.dashboard.dailyProfit.aboveTarget")}
              </p>
              <p className="text-[9px] md:text-[10px] text-muted-foreground">≤65%</p>
            </div>
          </div>
          
          <div className={cn(
            "flex-1 flex items-center justify-between px-2 md:px-3 py-1.5 md:py-2 rounded-lg",
            dayData.operatingMarginPercentage >= 10 ? "bg-success/10" : dayData.operatingMarginPercentage >= 0 ? "bg-warning/10" : "bg-destructive/10"
          )}>
            <div>
              <p className="text-[9px] md:text-[10px] text-muted-foreground uppercase tracking-wider">{t("app.dashboard.dailyProfit.margin")}</p>
              <p className={cn(
                "text-base md:text-lg font-bold",
                dayData.operatingMarginPercentage >= 10 ? "text-success" : dayData.operatingMarginPercentage >= 0 ? "text-warning" : "text-destructive"
              )}>
                {dayData.operatingMarginPercentage.toFixed(1)}%
              </p>
            </div>
            <div className="text-end">
              <p className={cn(
                "text-[9px] md:text-[10px] font-medium",
                dayData.operatingMarginPercentage >= 10 ? "text-success" : dayData.operatingMarginPercentage >= 0 ? "text-warning" : "text-destructive"
              )}>
                {dayData.operatingMarginPercentage >= 10 ? `✓ ${t("app.dashboard.dailyProfit.onTarget")}` : t("app.dashboard.dailyProfit.belowTarget")}
              </p>
              <p className="text-[9px] md:text-[10px] text-muted-foreground">≥10%</p>
            </div>
          </div>
        </div>

        {/* Sparkline in corner */}
        <div className="absolute top-4 md:top-5 end-4 md:end-5">
          <MiniSparkline data={sparklineData} className={isPositiveChange ? "text-success" : "text-destructive"} />
        </div>
      </CardContent>
    </Card>
  );
}
