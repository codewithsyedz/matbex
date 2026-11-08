import { useState } from "react";
import { cn } from "@/lib/utils";
import { Clock, User, DollarSign, CheckCircle2, AlertCircle, Timer, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCurrency } from "@/hooks/useCurrency";
import { ShiftSummary } from "@/components/shifts/ShiftSummary";

export type ShiftStatus = "open" | "closing" | "closed";
export type VarianceStatus = "perfect" | "minor" | "investigate";

interface ShiftCardProps {
  id: string;
  cashier: string;
  startTime: string;
  endTime?: string;
  status: ShiftStatus;
  expectedCash?: number;
  countedCash?: number;
  variance?: number;
  varianceStatus?: VarianceStatus;
  drawer: string;
  onClose?: () => void;
  /** Optional metadata to enable the COGS vs Expense rollup */
  shiftMeta?: {
    opened_at: string;
    closed_at?: string | null;
    template_id?: string | null;
  };
}

export function ShiftCard({
  id,
  cashier,
  startTime,
  endTime,
  status,
  expectedCash,
  countedCash,
  variance,
  varianceStatus,
  drawer,
  onClose,
  shiftMeta,
}: ShiftCardProps) {
  const { format } = useCurrency();
  const [showSummary, setShowSummary] = useState(false);
  const statusConfig = {
    open: {
      label: "Active",
      className: "bg-success/10 text-success border-success/20",
      icon: Timer,
    },
    closing: {
      label: "Closing",
      className: "bg-warning/10 text-warning border-warning/20",
      icon: Clock,
    },
    closed: {
      label: "Closed",
      className: "bg-muted text-muted-foreground border-muted",
      icon: CheckCircle2,
    },
  };

  const varianceConfig = {
    perfect: {
      label: "Perfect Close",
      className: "bg-success/10 text-success",
      icon: CheckCircle2,
    },
    minor: {
      label: "Slight Variance",
      className: "bg-warning/10 text-warning",
      icon: AlertCircle,
    },
    investigate: {
      label: "Investigate",
      className: "bg-destructive/10 text-destructive",
      icon: AlertCircle,
    },
  };

  const StatusIcon = statusConfig[status].icon;

  return (
    <div
      className={cn(
        "p-4 rounded-lg border bg-card card-lift min-w-[280px]",
        status === "closed" && varianceStatus === "perfect" && "confetti-border"
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={statusConfig[status].className}>
            <StatusIcon className="h-3 w-3 mr-1" />
            {statusConfig[status].label}
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground">{drawer}</span>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <User className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-medium">{cashier}</span>
        </div>

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          <span>
            {startTime}
            {endTime && ` - ${endTime}`}
          </span>
        </div>

        {status === "open" && expectedCash !== undefined && (
          <div className="flex items-center gap-2 text-sm">
            <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium number-glow">{format(expectedCash)}</span>
            <span className="text-muted-foreground">expected</span>
          </div>
        )}

        {status === "closed" && variance !== undefined && varianceStatus && (
          <div className="pt-2 border-t border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {(() => {
                  const VarIcon = varianceConfig[varianceStatus].icon;
                  return <VarIcon className="h-3.5 w-3.5" />;
                })()}
                <span className="text-sm font-medium">
                  {format(Math.abs(variance))} {variance >= 0 ? "over" : "short"}
                </span>
              </div>
              <Badge className={varianceConfig[varianceStatus].className}>
                {varianceConfig[varianceStatus].label}
              </Badge>
            </div>
          </div>
        )}

        {status === "open" && onClose && (
          <Button
            size="sm"
            className="w-full mt-2"
            onClick={onClose}
          >
            Close Shift
          </Button>
        )}

        {shiftMeta && (
          <div className="pt-2 border-t border-border">
            <button
              type="button"
              onClick={() => setShowSummary((v) => !v)}
              className="w-full flex items-center justify-between text-xs text-muted-foreground hover:text-foreground transition-colors"
              aria-expanded={showSummary}
            >
              <span className="font-medium">COGS / Expense rollup</span>
              {showSummary ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
            {showSummary && (
              <div className="mt-2">
                <ShiftSummary
                  shift={{
                    id,
                    opened_at: shiftMeta.opened_at,
                    closed_at: shiftMeta.closed_at,
                    template_id: shiftMeta.template_id,
                  }}
                  compact
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
