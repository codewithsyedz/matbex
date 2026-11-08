import { useState } from "react";
import { useKPIAlerts, AlertSeverity, AlertType } from "@/hooks/useKPIAlerts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertTriangle,
  TrendingDown,
  X,
  Check,
  ChevronDown,
  ChevronUp,
  Bell,
  DollarSign,
  Percent,
  Wallet,
  Receipt,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { useTranslation } from "react-i18next";
import { ar, enUS } from "date-fns/locale";

const alertTypeIcons: Record<AlertType, React.ElementType> = {
  profit_below_target: TrendingDown,
  prime_cost_high: Percent,
  margin_low: DollarSign,
  cash_variance_high: Wallet,
  expense_spike: Receipt,
};

export function OwnerDashboardAlerts() {
  const { t, i18n } = useTranslation();
  const {
    activeAlerts,
    unacknowledgedCount,
    criticalCount,
    acknowledgeAlert,
    isAcknowledging,
    isLoading,
  } = useKPIAlerts();

  const [isExpanded, setIsExpanded] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  if (isLoading) return null;
  if (activeAlerts.length === 0) return null;
  if (isDismissed) return null;

  const getSeverityStyles = (severity: AlertSeverity) => {
    if (severity === "critical") {
      return {
        container: "border-destructive/50 bg-destructive/5",
        icon: "text-destructive",
        badge: "bg-destructive text-destructive-foreground",
      };
    }
    return {
      container: "border-warning/50 bg-warning/5",
      icon: "text-warning",
      badge: "bg-warning text-warning-foreground",
    };
  };

  return (
    <Card className="relative border-2 border-destructive/20 bg-gradient-to-br from-destructive/5 to-transparent">
      {/* Close button */}
      <Button
        variant="ghost"
        size="sm"
        className="absolute end-2 top-2 h-6 w-6 p-0 z-10"
        onClick={() => setIsDismissed(true)}
      >
        <X className="h-4 w-4 text-muted-foreground" />
      </Button>

      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CardHeader className="pe-10 pb-3">
          <CollapsibleTrigger asChild>
            <div className="flex items-center justify-between cursor-pointer group">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-destructive/10">
                  <Bell className="h-4 w-4 text-destructive" />
                </div>
                <div>
                  <CardTitle className="text-base font-medium flex items-center gap-2">
                    {t("app.dashboard.alerts.title")}
                    {unacknowledgedCount > 0 && (
                      <Badge variant="destructive" className="text-xs">
                        {t("app.dashboard.alerts.unread", { count: unacknowledgedCount })}
                      </Badge>
                    )}
                    {criticalCount > 0 && (
                      <Badge variant="destructive" className="text-xs">
                        {t("app.dashboard.alerts.critical", { count: criticalCount })}
                      </Badge>
                    )}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("app.dashboard.alerts.subtitle")}
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            </div>
          </CollapsibleTrigger>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="space-y-3">
            {activeAlerts.map((alert) => {
              const styles = getSeverityStyles(alert.severity as AlertSeverity);
              const Icon = alertTypeIcons[alert.alert_type as AlertType] || AlertTriangle;
               const label = t(`app.dashboard.alerts.types.${alert.alert_type}`, { defaultValue: t("app.dashboard.alerts.alert") });

              return (
                <div
                  key={alert.id}
                  className={cn(
                    "relative p-4 rounded-lg border transition-all",
                    styles.container,
                    alert.acknowledged_at && "opacity-60"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className={cn("p-1.5 rounded-md", styles.icon)}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-xs">
                          {label}
                        </Badge>
                        <Badge className={cn("text-xs", styles.badge)}>
                           {t(`app.dashboard.alerts.severity.${alert.severity}`, { defaultValue: alert.severity })}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                           {formatDistanceToNow(new Date(alert.triggered_at), { addSuffix: true, locale: i18n.language.startsWith("ar") ? ar : enUS })}
                        </span>
                      </div>
                      <h4 className="font-medium text-sm text-foreground">
                        {alert.title}
                      </h4>
                      <p className="text-sm text-muted-foreground mt-1">
                        {alert.description}
                      </p>
                      
                      {/* Metric details */}
                      {alert.metric_value !== null && alert.threshold_value !== null && (
                        <div className="flex items-center gap-4 mt-2 text-xs">
                          <span className="text-muted-foreground">
                             {t("app.dashboard.alerts.actual")}: <span className="font-medium text-foreground">{alert.metric_value.toFixed(1)}</span>
                          </span>
                          <span className="text-muted-foreground">
                             {t("app.dashboard.alerts.threshold")}: <span className="font-medium text-foreground">{alert.threshold_value.toFixed(1)}</span>
                          </span>
                        </div>
                      )}
                    </div>
                    
                    {/* Acknowledge button */}
                    {!alert.acknowledged_at && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 shrink-0"
                        onClick={() => acknowledgeAlert(alert.id)}
                        disabled={isAcknowledging}
                      >
                        <Check className="h-3.5 w-3.5 me-1.5" />
                        {t("app.dashboard.alerts.acknowledge")}
                      </Button>
                    )}
                    
                    {alert.acknowledged_at && (
                      <Badge variant="outline" className="text-xs text-muted-foreground">
                        <Check className="h-3 w-3 me-1" />
                        {t("app.dashboard.alerts.acknowledged")}
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Quick acknowledge all */}
            {unacknowledgedCount > 1 && (
              <div className="flex justify-end pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    activeAlerts
                      .filter(a => !a.acknowledged_at)
                      .forEach(a => acknowledgeAlert(a.id));
                  }}
                  disabled={isAcknowledging}
                >
                  <Check className="h-3.5 w-3.5 me-1.5" />
                  {t("app.dashboard.alerts.acknowledgeAll")}
                </Button>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
