import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Clock, Lock, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { useDemoTrial } from "@/hooks/useDemoTrial";
import { cn } from "@/lib/utils";

interface Props {
  /** Trial length used to compute the progress bar. Defaults to 14 days. */
  trialLengthDays?: number;
  className?: string;
}

/**
 * Prominent trial-status card with live day/hour countdown and an Upgrade CTA.
 * Hidden for paid / non-trial tenants. Persists in an "expired" state once
 * the expire_trials() job downgrades the tenant to Free.
 */
export function TrialCountdownCard({ trialLengthDays = 14, className }: Props) {
  const navigate = useNavigate();
  const { tenant } = useAuth();
  const { isTrial, isDemo, isExpired, daysLeft, trialEndsAt } = useDemoTrial();

  const hoursLeft = useMemo(() => {
    if (!trialEndsAt) return null;
    return Math.max(
      0,
      Math.ceil((trialEndsAt.getTime() - Date.now()) / (60 * 60 * 1000)),
    );
  }, [trialEndsAt]);

  if (!tenant) return null;
  if (!isTrial && !isDemo && !isExpired) return null;

  const totalHours = trialLengthDays * 24;
  const usedHours = hoursLeft !== null ? Math.max(0, totalHours - hoursLeft) : 0;
  const progress = Math.min(100, Math.round((usedHours / totalHours) * 100));

  const urgent = !isExpired && daysLeft !== null && daysLeft <= 3;

  const tone = isExpired
    ? "border-destructive/40 bg-destructive/5"
    : urgent
    ? "border-amber-500/40 bg-amber-500/5"
    : "border-primary/30 bg-primary/5";

  const accent = isExpired
    ? "text-destructive"
    : urgent
    ? "text-amber-600 dark:text-amber-400"
    : "text-primary";

  const Icon = isExpired ? Lock : urgent ? Clock : Sparkles;

  const headline = isExpired
    ? isDemo
      ? "Your demo has expired"
      : "Your trial has expired"
    : daysLeft === 0
    ? "Trial ends today"
    : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left in your trial`;

  const sub = isExpired
    ? "Pro features are locked. Upgrade to restore full access to your data and tools."
    : hoursLeft !== null && daysLeft !== null && daysLeft <= 3
    ? `About ${hoursLeft} hour${hoursLeft === 1 ? "" : "s"} remaining — upgrade now to keep Pro features.`
    : "Enjoy full Pro access during your trial. Upgrade any time to lock it in.";

  return (
    <Card className={cn("overflow-hidden", tone, className)}>
      <CardContent className="pt-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className={cn(
                "h-10 w-10 shrink-0 rounded-full flex items-center justify-center bg-background/70",
                accent,
              )}
            >
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm md:text-base font-medium text-foreground">
                  {headline}
                </h3>
                <Badge
                  variant="outline"
                  className={cn("text-[10px] uppercase tracking-wide", accent)}
                >
                  {isExpired ? "Expired" : isDemo ? "Demo" : "Trial"}
                </Badge>
              </div>
              <p className="text-xs md:text-sm text-muted-foreground mt-1">
                {sub}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant={isExpired || urgent ? "default" : "outline"}
            onClick={() => navigate("/billing")}
            className="self-start md:self-auto"
          >
            {isExpired ? "Upgrade Now" : "Upgrade to Pro"}
            <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </div>

        {!isExpired && (
          <div className="mt-4 space-y-1.5">
            <Progress value={progress} className="h-1.5" />
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Day {Math.min(trialLengthDays, Math.ceil(usedHours / 24))} of {trialLengthDays}</span>
              {hoursLeft !== null && (
                <span>{hoursLeft}h remaining</span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}