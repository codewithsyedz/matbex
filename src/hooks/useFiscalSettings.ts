import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/query/queryKeys";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";

export interface FiscalSettings {
  id: string;
  restaurant_id: string;
  month_start_day: number;
  payroll_cutoff_day: number;
  payroll_period_offset: number;
  fine_allocation_mode: FineAllocationMode;
  created_at: string;
  updated_at: string;
}

export type FineAllocationMode = "installment_date" | "created_date";

export function useFiscalSettings() {
  const { restaurant } = useAuth();
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ["fiscal-settings", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return null;
      
      const { data, error } = await db
        .from("fiscal_settings")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .maybeSingle();

      if (error) throw error;
      return data as FiscalSettings | null;
    },
    enabled: !!restaurant?.id,
  });

  const updateMutation = useMutation({
    mutationFn: async (monthStartDay: number) => {
      if (!restaurant?.id) throw new Error("No restaurant");

      // Upsert the setting
      const { data, error } = await db
        .from("fiscal_settings")
        .upsert({
          restaurant_id: restaurant.id,
          month_start_day: monthStartDay,
        }, {
          onConflict: "restaurant_id",
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fiscal-settings"] });
      // Also invalidate all dashboard/profit queries that depend on fiscal settings
      queryClient.invalidateQueries({ queryKey: qk.monthlyStats.all() });
      queryClient.invalidateQueries({ queryKey: qk.monthlyKpi.all() });
      queryClient.invalidateQueries({ queryKey: ["monthly-overhead"] });
      queryClient.invalidateQueries({ queryKey: ["daily-profit"] });
      queryClient.invalidateQueries({ queryKey: ["monthly-kpi"] });
    },
  });

  const updatePayrollRulesMutation = useMutation({
    mutationFn: async (rules: {
      payrollCutoffDay: number;
      payrollPeriodOffset: number;
      fineAllocationMode?: FineAllocationMode;
    }) => {
      if (!restaurant?.id) throw new Error("No restaurant");

      const { data, error } = await db
        .from("fiscal_settings")
        .upsert({
          restaurant_id: restaurant.id,
          month_start_day: settings?.month_start_day ?? 1,
          payroll_cutoff_day: rules.payrollCutoffDay,
          payroll_period_offset: rules.payrollPeriodOffset,
          fine_allocation_mode:
            rules.fineAllocationMode ?? settings?.fine_allocation_mode ?? "installment_date",
        }, {
          onConflict: "restaurant_id",
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fiscal-settings"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-fiscal-month"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-records"] });
      queryClient.invalidateQueries({ queryKey: ["staff-pending-fines"] });
    },
  });

  // Default to 1 if no settings exist
  const monthStartDay = settings?.month_start_day ?? 1;

  return {
    settings,
    monthStartDay,
    payrollCutoffDay: settings?.payroll_cutoff_day ?? 1,
    payrollPeriodOffset: settings?.payroll_period_offset ?? 1,
    fineAllocationMode: (settings?.fine_allocation_mode ?? "installment_date") as FineAllocationMode,
    isLoading,
    updateMonthStartDay: updateMutation.mutate,
    isUpdating: updateMutation.isPending,
    updatePayrollRules: updatePayrollRulesMutation.mutate,
    isUpdatingPayrollRules: updatePayrollRulesMutation.isPending,
  };
}

// Helper functions for fiscal month calculations
export function getFiscalMonthRange(date: Date, monthStartDay: number): { start: Date; end: Date } {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();

  let start: Date;
  let end: Date;

  if (day >= monthStartDay) {
    // We're in the current fiscal month (starts this calendar month)
    start = new Date(year, month, monthStartDay);
    // End is the day before the start day of next month
    const nextMonth = month + 1;
    end = new Date(year, nextMonth, monthStartDay - 1);
  } else {
    // We're in the previous fiscal month (started last calendar month)
    const prevMonth = month - 1;
    start = new Date(year, prevMonth, monthStartDay);
    end = new Date(year, month, monthStartDay - 1);
  }

  return { start, end };
}

export function getFiscalMonthDays(date: Date, monthStartDay: number): number {
  const { start, end } = getFiscalMonthRange(date, monthStartDay);
  const diffTime = end.getTime() - start.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
}

export function getFiscalMonthProgress(date: Date, monthStartDay: number): { 
  daysElapsed: number; 
  daysRemaining: number; 
  totalDays: number;
  percentComplete: number;
  yesterday: Date;
} {
  const { start, end } = getFiscalMonthRange(date, monthStartDay);
  const totalDays = getFiscalMonthDays(date, monthStartDay);
  
  // Use yesterday (current date - 1) as the data cutoff for calculations
  const now = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  
  // Cap yesterday to fiscal start if it's before the fiscal month started
  const effectiveYesterday = yesterday < start ? start : yesterday;
  
  // Days elapsed counts up to yesterday (not including today)
  const daysElapsed = Math.max(0, Math.floor((effectiveYesterday.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
  // Days remaining includes today and future days
  const daysRemaining = totalDays - daysElapsed;
  const percentComplete = (daysElapsed / totalDays) * 100;

  return { daysElapsed, daysRemaining, totalDays, percentComplete, yesterday: effectiveYesterday };
}

export function getPreviousFiscalMonthRange(date: Date, monthStartDay: number): { start: Date; end: Date } {
  const { start: currentStart } = getFiscalMonthRange(date, monthStartDay);
  // Go back one month from current fiscal month start
  const prevMonthDate = new Date(currentStart);
  prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
  return getFiscalMonthRange(prevMonthDate, monthStartDay);
}
