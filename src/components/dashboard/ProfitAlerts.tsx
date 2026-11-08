import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle, TrendingDown, Target, X } from "lucide-react";
import { useState } from "react";
import { DailyProfitState } from "@/hooks/useDailyProfit";

interface ProfitAlertsProps {
  todayProfit: DailyProfitState | null;
  weekData: DailyProfitState[];
}

export function ProfitAlerts({ todayProfit, weekData }: ProfitAlertsProps) {
  const { restaurant } = useAuth();
  const { format: formatCurrency } = useCurrency();
  const [dismissedAlerts, setDismissedAlerts] = useState<string[]>([]);

  // Fetch profit targets
  const { data: targets = [] } = useQuery({
    queryKey: ["profit-targets", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await supabase
        .from("profit_targets")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .eq("alert_enabled", true);
      if (error) throw error;
      return data;
    },
    enabled: !!restaurant?.id,
  });

  const dismissAlert = (id: string) => {
    setDismissedAlerts((prev) => [...prev, id]);
  };

  // Calculate alerts based on targets
  const alerts: Array<{
    id: string;
    type: "warning" | "error";
    title: string;
    description: string;
  }> = [];

  if (todayProfit && targets.length > 0) {
    // Check daily target
    const dailyTarget = targets.find((t) => t.target_type === "daily");
    if (dailyTarget) {
      const threshold = Number(dailyTarget.target_amount) * (1 - Number(dailyTarget.alert_threshold) / 100);
      
      if (todayProfit.operatingProfit < threshold && Number(dailyTarget.target_amount) > 0) {
        const percentBelow = ((Number(dailyTarget.target_amount) - todayProfit.operatingProfit) / Number(dailyTarget.target_amount)) * 100;
        alerts.push({
          id: "daily-profit-below",
          type: percentBelow > 20 ? "error" : "warning",
          title: "Daily Profit Below Target",
          description: `Today's profit (${formatCurrency(todayProfit.operatingProfit)}) is ${percentBelow.toFixed(0)}% below your target of ${formatCurrency(Number(dailyTarget.target_amount))}.`,
        });
      }

      // Check prime cost target
      if (todayProfit.primeCostPercentage > Number(dailyTarget.prime_cost_target)) {
        alerts.push({
          id: "prime-cost-high",
          type: todayProfit.primeCostPercentage > Number(dailyTarget.prime_cost_target) + 10 ? "error" : "warning",
          title: "Prime Cost Above Target",
          description: `Prime cost (${todayProfit.primeCostPercentage.toFixed(1)}%) exceeds your target of ${dailyTarget.prime_cost_target}%.`,
        });
      }

      // Check margin target
      if (todayProfit.operatingMarginPercentage < Number(dailyTarget.margin_target)) {
        alerts.push({
          id: "margin-low",
          type: todayProfit.operatingMarginPercentage < 0 ? "error" : "warning",
          title: "Operating Margin Below Target",
          description: `Operating margin (${todayProfit.operatingMarginPercentage.toFixed(1)}%) is below your target of ${dailyTarget.margin_target}%.`,
        });
      }
    }

    // Check weekly target
    const weeklyTarget = targets.find((t) => t.target_type === "weekly");
    if (weeklyTarget && weekData.length >= 7) {
      const weeklyProfit = weekData.reduce((sum, d) => sum + d.operatingProfit, 0);
      const threshold = Number(weeklyTarget.target_amount) * (1 - Number(weeklyTarget.alert_threshold) / 100);
      
      if (weeklyProfit < threshold && Number(weeklyTarget.target_amount) > 0) {
        const percentBelow = ((Number(weeklyTarget.target_amount) - weeklyProfit) / Number(weeklyTarget.target_amount)) * 100;
        alerts.push({
          id: "weekly-profit-below",
          type: percentBelow > 20 ? "error" : "warning",
          title: "Weekly Profit Below Target",
          description: `This week's profit (${formatCurrency(weeklyProfit)}) is ${percentBelow.toFixed(0)}% below your target of ${formatCurrency(Number(weeklyTarget.target_amount))}.`,
        });
      }
    }
  }

  // Filter dismissed alerts
  const visibleAlerts = alerts.filter((a) => !dismissedAlerts.includes(a.id));

  if (visibleAlerts.length === 0) return null;

  return (
    <div className="space-y-3">
      {visibleAlerts.map((alert) => (
        <Alert
          key={alert.id}
          variant={alert.type === "error" ? "destructive" : "default"}
          className="relative"
        >
          {alert.type === "error" ? (
            <AlertTriangle className="h-4 w-4" />
          ) : (
            <TrendingDown className="h-4 w-4" />
          )}
          <AlertTitle className="pr-8">{alert.title}</AlertTitle>
          <AlertDescription>{alert.description}</AlertDescription>
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 h-6 w-6"
            onClick={() => dismissAlert(alert.id)}
          >
            <X className="h-3 w-3" />
          </Button>
        </Alert>
      ))}
    </div>
  );
}
