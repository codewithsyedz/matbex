import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowUp, ArrowDown, Minus, LucideIcon } from "lucide-react";

interface KPIComparisonProps {
  title: string;
  icon: LucideIcon;
  currentValue: number;
  previousValue: number;
  currentLabel: string;
  previousLabel: string;
  formatter?: (value: number) => string;
  inverseColors?: boolean; // For metrics where lower is better (e.g., expenses)
  delay?: number;
}

export function KPIComparison({
  title,
  icon: Icon,
  currentValue,
  previousValue,
  currentLabel,
  previousLabel,
  formatter = (v) => v.toFixed(2),
  inverseColors = false,
  delay = 0,
}: KPIComparisonProps) {
  const changePercent = previousValue === 0 
    ? (currentValue > 0 ? 100 : 0)
    : ((currentValue - previousValue) / previousValue) * 100;

  const isPositive = changePercent > 0;
  const isNeutral = Math.abs(changePercent) < 0.5;

  // For inverse metrics (like expenses), positive change is bad
  const colorClass = isNeutral
    ? "text-muted-foreground"
    : (isPositive !== inverseColors)
    ? "text-success"
    : "text-destructive";

  const bgClass = isNeutral
    ? "bg-muted"
    : (isPositive !== inverseColors)
    ? "bg-success/10"
    : "bg-destructive/10";

  return (
    <Card className="fade-slide-in" style={{ animationDelay: `${delay}ms` }}>
      <CardHeader className="pb-3">
        <CardTitle className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          <Icon className="h-4 w-4" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-end justify-between">
          <div>
            <p className="font-display text-2xl font-semibold tabular-nums text-foreground">
              {formatter(currentValue)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {currentLabel}
            </p>
          </div>
          <div className="text-right">
            <div
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-sm font-medium ${bgClass} ${colorClass}`}
            >
              {isNeutral ? (
                <Minus className="h-3 w-3" />
              ) : isPositive ? (
                <ArrowUp className="h-3 w-3" />
              ) : (
                <ArrowDown className="h-3 w-3" />
              )}
              {Math.abs(changePercent).toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              vs {formatter(previousValue)}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {previousLabel}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
