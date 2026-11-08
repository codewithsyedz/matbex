import { cn } from "@/lib/utils";
import { LucideIcon, TrendingUp, TrendingDown, Minus, Info, RefreshCw } from "lucide-react";
import { ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";


interface KPICardProps {
  title: string;
  value: string;
  change?: number;
  changeLabel?: string;
  icon: LucideIcon;
  variant?: "default" | "success" | "warning" | "destructive";
  delay?: number;
  summary?: ReactNode;
  /** Short explanation of how this number is calculated (shown in an info popover). */
  info?: ReactNode;
  /** Optional scope line, e.g. "Scope: Al-Wadi branch · Today". */
  infoScope?: string;
  /** Called when the user presses the card's refresh action. */
  onRefresh?: () => void;
  /** Whether the card is currently refreshing. */
  isRefreshing?: boolean;
}


export function KPICard({
  title,
  value,
  change,
  changeLabel,
  icon: Icon,
  variant = "default",
  delay = 0,
  summary,
  info,
  infoScope,
  onRefresh,
  isRefreshing,
}: KPICardProps) {

  const getTrendIcon = () => {
    if (change === undefined) return null;
    if (change > 0) return <TrendingUp className="h-3 w-3" />;
    if (change < 0) return <TrendingDown className="h-3 w-3" />;
    return <Minus className="h-3 w-3" />;
  };

  const getTrendColor = () => {
    if (change === undefined) return "text-muted-foreground";
    if (variant === "destructive") {
      return change > 0 ? "text-destructive" : "text-success";
    }
    if (change > 0) return "text-success";
    if (change < 0) return "text-destructive";
    return "text-muted-foreground";
  };

  const variantStyles = {
    default: "border-border",
    success: "border-success/20 bg-success/5",
    warning: "border-warning/20 bg-warning/5",
    destructive: "border-destructive/20 bg-destructive/5",
  };

  return (
    <div
      className={cn(
        "h-full min-w-0 rounded-lg border border-border/80 bg-card p-5 shadow-soft card-lift",
        variantStyles[variant]
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex h-full items-start justify-between gap-3">
        <div className="space-y-3 min-w-0 flex-1">
          <div className="flex items-start gap-1.5">
            <p className="text-[11px] font-bold text-muted-foreground uppercase">
              {title}
            </p>
            {info && (
              <Popover>
                <PopoverTrigger
                  aria-label={`How ${title} is calculated`}
                  className="mt-[1px] shrink-0 text-muted-foreground/60 hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                >
                  <Info className="h-3.5 w-3.5" />
                </PopoverTrigger>
                <PopoverContent align="start" className="w-72 text-xs leading-relaxed space-y-2">
                  <p className="font-medium text-foreground">{title}</p>
                  <div className="text-muted-foreground">{info}</div>
                  {infoScope && (
                    <p className="pt-1 border-t text-[11px] text-muted-foreground/80">{infoScope}</p>
                  )}
                </PopoverContent>
              </Popover>
            )}
            {onRefresh && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Refresh ${title}`}
                className="h-5 w-5 -mt-0.5 ml-auto shrink-0 text-muted-foreground/60 hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  onRefresh();
                }}
                disabled={isRefreshing}
              >
                <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
              </Button>
            )}
          </div>

          <p className="font-display text-2xl font-semibold tabular-nums text-foreground break-words">
            {value}
          </p>
          {(change !== undefined || changeLabel) && (
            <div className={cn("flex flex-wrap items-center gap-1 text-xs font-medium min-w-0", getTrendColor())}>
              {change !== undefined && (
                <>
                  {getTrendIcon()}
                  <span>{Math.abs(change).toFixed(0)}%</span>
                </>
              )}
              {changeLabel && (
                <span className="text-muted-foreground font-normal min-w-0 truncate">
                  {changeLabel}
                </span>
              )}
            </div>
          )}
          {summary && (
            <div className="pt-1 min-w-0">
              {summary}
            </div>
          )}
        </div>
        <div
          className={cn(
            "p-2 rounded-md shrink-0",
            variant === "default" && "bg-accent text-accent-foreground",
            variant === "success" && "bg-success/10 text-success",
            variant === "warning" && "bg-warning/10 text-warning",
            variant === "destructive" && "bg-destructive/10 text-destructive"
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}
