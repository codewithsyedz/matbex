import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { useDailyProfit, DailyProfitState } from "@/hooks/useDailyProfit";
import { useDashboardData } from "@/hooks/useDashboardData";
import { format, subDays } from "date-fns";
import { useEffect, useMemo, useRef } from "react";

export type AlertType = 
  | "profit_below_target" 
  | "prime_cost_high" 
  | "margin_low" 
  | "cash_variance_high" 
  | "expense_spike";

export type AlertSeverity = "warning" | "critical";

export interface KPIAlert {
  id: string;
  restaurant_id: string;
  alert_type: AlertType;
  severity: AlertSeverity;
  title: string;
  description: string;
  metric_value: number | null;
  threshold_value: number | null;
  reference_date: string;
  triggered_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  is_active: boolean;
}

export interface ThresholdConfig {
  daily_profit_target: number;
  weekly_profit_target: number;
  prime_cost_target: number;
  margin_target: number;
  alert_threshold: number;
  cash_variance_threshold: number;
  expense_spike_threshold: number;
  expense_spike_window_days: number;
}

export function useKPIAlerts() {
  const { restaurant, user } = useAuth();
  const { activeBranchId } = useBranch();
  const queryClient = useQueryClient();
  const { format: formatCurrency } = useCurrency();
  const { today: todayProfit, weekData } = useDailyProfit();
  const { metrics } = useDashboardData();

  // Fetch active alerts
  const { data: activeAlerts = [], isLoading: alertsLoading } = useQuery({
    queryKey: ["kpi-alerts", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await supabase
        .from("kpi_alerts")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .eq("is_active", true)
        .order("triggered_at", { ascending: false });
      if (error) throw error;
      return data as KPIAlert[];
    },
    enabled: !!restaurant?.id,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Fetch threshold configuration
  const { data: thresholds } = useQuery({
    queryKey: ["kpi-thresholds", restaurant?.id],
    queryFn: async (): Promise<ThresholdConfig> => {
      if (!restaurant?.id) {
        return {
          daily_profit_target: 0,
          weekly_profit_target: 0,
          prime_cost_target: 65,
          margin_target: 10,
          alert_threshold: 10,
          cash_variance_threshold: 50,
          expense_spike_threshold: 30,
          expense_spike_window_days: 7,
        };
      }
      
      const { data, error } = await supabase
        .from("profit_targets")
        .select("*")
        .eq("restaurant_id", restaurant.id);
      
      if (error) throw error;
      
      const dailyTarget = data?.find(t => t.target_type === "daily");
      const weeklyTarget = data?.find(t => t.target_type === "weekly");
      
      return {
        daily_profit_target: Number(dailyTarget?.target_amount) || 0,
        weekly_profit_target: Number(weeklyTarget?.target_amount) || 0,
        prime_cost_target: Number(dailyTarget?.prime_cost_target) || 65,
        margin_target: Number(dailyTarget?.margin_target) || 10,
        alert_threshold: Number(dailyTarget?.alert_threshold) || 10,
        cash_variance_threshold: Number(dailyTarget?.cash_variance_threshold) || 50,
        expense_spike_threshold: Number(dailyTarget?.expense_spike_threshold) || 30,
        expense_spike_window_days: Number(dailyTarget?.expense_spike_window_days) || 7,
      };
    },
    enabled: !!restaurant?.id,
  });

  // Fetch historical expenses for spike detection
  const { data: historicalExpenses = [] } = useQuery({
    queryKey: ["expense-history", restaurant?.id, activeBranchId ?? "all"],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const windowDays = thresholds?.expense_spike_window_days || 7;
      const startDate = format(subDays(new Date(), windowDays), "yyyy-MM-dd");
      
      let query = supabase
        .from("expenses")
        .select("amount, expense_date")
        .eq("restaurant_id", restaurant.id)
        .is("deleted_at", null)
        .gte("expense_date", startDate);
      if (activeBranchId) query = query.eq("branch_id", activeBranchId);
      const { data, error } = await query;
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!restaurant?.id && !!thresholds,
  });

  // Acknowledge alert mutation
  const acknowledgeAlertMutation = useMutation({
    mutationFn: async (alertId: string) => {
      const { error } = await supabase
        .from("kpi_alerts")
        .update({
          acknowledged_at: new Date().toISOString(),
          acknowledged_by: user?.id,
          is_active: false,
        })
        .eq("id", alertId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kpi-alerts"] });
    },
  });

  // Create alert mutation
  const createAlertMutation = useMutation({
    mutationFn: async (alert: Omit<KPIAlert, "id" | "triggered_at" | "acknowledged_at" | "acknowledged_by">) => {
      // Check if similar alert already exists for today
      const today = format(new Date(), "yyyy-MM-dd");
      const { data: existing } = await supabase
        .from("kpi_alerts")
        .select("id")
        .eq("restaurant_id", alert.restaurant_id)
        .eq("alert_type", alert.alert_type)
        .eq("reference_date", today)
        .eq("is_active", true)
        .maybeSingle();
      
      if (existing) return; // Don't duplicate

      const { error } = await supabase
        .from("kpi_alerts")
        .insert({
          ...alert,
          reference_date: today,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kpi-alerts"] });
    },
  });

  // Detect and create alerts based on current metrics
  const detectedAlerts = useMemo(() => {
    if (!thresholds || !restaurant?.id) return [];

    const alerts: Array<{
      type: AlertType;
      severity: AlertSeverity;
      title: string;
      description: string;
      metricValue: number;
      thresholdValue: number;
    }> = [];

    // Check daily profit target
    if (todayProfit && thresholds.daily_profit_target > 0) {
      const threshold = thresholds.daily_profit_target * (1 - thresholds.alert_threshold / 100);
      if (todayProfit.operatingProfit < threshold) {
        const percentBelow = ((thresholds.daily_profit_target - todayProfit.operatingProfit) / thresholds.daily_profit_target) * 100;
        alerts.push({
          type: "profit_below_target",
          severity: percentBelow > 20 ? "critical" : "warning",
          title: "Daily Profit Below Target",
          description: `Today's profit (${formatCurrency(todayProfit.operatingProfit)}) is ${percentBelow.toFixed(0)}% below target of ${formatCurrency(thresholds.daily_profit_target)}.`,
          metricValue: todayProfit.operatingProfit,
          thresholdValue: thresholds.daily_profit_target,
        });
      }
    }

    // Check prime cost
    if (todayProfit && todayProfit.primeCostPercentage > thresholds.prime_cost_target) {
      const excess = todayProfit.primeCostPercentage - thresholds.prime_cost_target;
      alerts.push({
        type: "prime_cost_high",
        severity: excess > 10 ? "critical" : "warning",
        title: "Prime Cost Above Target",
        description: `Prime cost (${todayProfit.primeCostPercentage.toFixed(1)}%) exceeds target of ${thresholds.prime_cost_target}%.`,
        metricValue: todayProfit.primeCostPercentage,
        thresholdValue: thresholds.prime_cost_target,
      });
    }

    // Check operating margin
    if (todayProfit && todayProfit.operatingMarginPercentage < thresholds.margin_target) {
      alerts.push({
        type: "margin_low",
        severity: todayProfit.operatingMarginPercentage < 0 ? "critical" : "warning",
        title: "Operating Margin Below Target",
        description: `Operating margin (${todayProfit.operatingMarginPercentage.toFixed(1)}%) is below target of ${thresholds.margin_target}%.`,
        metricValue: todayProfit.operatingMarginPercentage,
        thresholdValue: thresholds.margin_target,
      });
    }

    // Check cash variance
    if (metrics.cashVariance > thresholds.cash_variance_threshold) {
      alerts.push({
        type: "cash_variance_high",
        severity: metrics.cashVariance > thresholds.cash_variance_threshold * 2 ? "critical" : "warning",
        title: "High Cash Variance",
        description: `Cash variance (${formatCurrency(metrics.cashVariance)}) exceeds threshold of ${formatCurrency(thresholds.cash_variance_threshold)}.`,
        metricValue: metrics.cashVariance,
        thresholdValue: thresholds.cash_variance_threshold,
      });
    }

    // Check expense spike
    if (historicalExpenses.length > 0) {
      const today = format(new Date(), "yyyy-MM-dd");
      const todayExpenses = historicalExpenses
        .filter(e => e.expense_date === today)
        .reduce((sum, e) => sum + Number(e.amount), 0);
      
      const previousExpenses = historicalExpenses
        .filter(e => e.expense_date !== today)
        .reduce((sum, e) => sum + Number(e.amount), 0);
      
      const avgPreviousDaily = previousExpenses / Math.max(1, thresholds.expense_spike_window_days - 1);
      
      if (avgPreviousDaily > 0 && todayExpenses > 0) {
        const spikePercent = ((todayExpenses - avgPreviousDaily) / avgPreviousDaily) * 100;
        if (spikePercent > thresholds.expense_spike_threshold) {
          alerts.push({
            type: "expense_spike",
            severity: spikePercent > thresholds.expense_spike_threshold * 2 ? "critical" : "warning",
            title: "Expense Spike Detected",
            description: `Today's expenses (${formatCurrency(todayExpenses)}) are ${spikePercent.toFixed(0)}% above the ${thresholds.expense_spike_window_days}-day average of ${formatCurrency(avgPreviousDaily)}.`,
            metricValue: todayExpenses,
            thresholdValue: avgPreviousDaily,
          });
        }
      }
    }

    return alerts;
  }, [thresholds, todayProfit, metrics, historicalExpenses, restaurant?.id, formatCurrency]);

  // Guard against re-firing the same alert. `detectedAlerts` is derived from
  // objects that get new identities on every render, so without this ref the
  // effect below would insert the same alert on every single render.
  const attemptedRef = useRef<Set<string>>(new Set());

  // Stable, value-based signatures so the effect only runs when the *set* of
  // detected/active alert types actually changes.
  const detectedSignature = useMemo(
    () => detectedAlerts.map(a => a.type).sort().join("|"),
    [detectedAlerts]
  );
  const activeSignature = useMemo(
    () => activeAlerts.map(a => `${a.alert_type}@${a.reference_date}`).sort().join("|"),
    [activeAlerts]
  );

  // Auto-create alerts when thresholds are breached
  useEffect(() => {
    if (!restaurant?.id || alertsLoading || detectedAlerts.length === 0) return;

    const today = format(new Date(), "yyyy-MM-dd");

    detectedAlerts.forEach(alert => {
      const key = `${restaurant.id}:${today}:${alert.type}`;
      if (attemptedRef.current.has(key)) return;

      const alreadyExists = activeAlerts.some(
        a => a.alert_type === alert.type && a.reference_date === today
      );
      if (alreadyExists) {
        attemptedRef.current.add(key);
        return;
      }

      // Mark before firing so a re-render mid-flight can't duplicate the insert.
      attemptedRef.current.add(key);
      createAlertMutation.mutate({
        restaurant_id: restaurant.id,
        alert_type: alert.type,
        severity: alert.severity,
        title: alert.title,
        description: alert.description,
        metric_value: alert.metricValue,
        threshold_value: alert.thresholdValue,
        reference_date: today,
        is_active: true,
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectedSignature, activeSignature, restaurant?.id, alertsLoading]);

  // Count unacknowledged alerts
  const unacknowledgedCount = activeAlerts.filter(a => !a.acknowledged_at).length;
  const criticalCount = activeAlerts.filter(a => a.severity === "critical" && !a.acknowledged_at).length;

  return {
    activeAlerts,
    detectedAlerts,
    thresholds,
    isLoading: alertsLoading,
    unacknowledgedCount,
    criticalCount,
    acknowledgeAlert: acknowledgeAlertMutation.mutate,
    isAcknowledging: acknowledgeAlertMutation.isPending,
  };
}
