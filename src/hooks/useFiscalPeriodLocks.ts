import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { getFiscalMonthRange } from "./useFiscalSettings";

export interface FiscalPeriodLock {
  id: string;
  tenant_id: string;
  restaurant_id: string;
  period_start: string;
  period_end: string;
  locked_at: string;
  locked_by: string;
  unlock_requested_at: string | null;
  unlock_requested_by: string | null;
  unlock_reason: string | null;
  unlocked_at: string | null;
  unlocked_by: string | null;
  is_locked: boolean;
  created_at: string;
}

export function useFiscalPeriodLocks() {
  const { restaurant, profile } = useAuth();
  const queryClient = useQueryClient();

  const { data: locks = [], isLoading } = useQuery({
    queryKey: ["fiscal-period-locks", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];

      const { data, error } = await db
        .from("fiscal_period_locks")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .order("period_start", { ascending: false });

      if (error) throw error;
      return data as FiscalPeriodLock[];
    },
    enabled: !!restaurant?.id,
  });

  // Check if a specific date is in a locked period
  const isDateLocked = (date: Date): boolean => {
    const dateStr = date.toISOString().split("T")[0];
    return locks.some(
      (lock) =>
        lock.is_locked &&
        dateStr >= lock.period_start &&
        dateStr <= lock.period_end
    );
  };

  // Get lock for a specific period
  const getLockForPeriod = (periodStart: Date, periodEnd: Date): FiscalPeriodLock | undefined => {
    const startStr = periodStart.toISOString().split("T")[0];
    const endStr = periodEnd.toISOString().split("T")[0];
    return locks.find(
      (lock) => lock.period_start === startStr && lock.period_end === endStr
    );
  };

  // Lock a fiscal period
  const lockPeriod = useMutation({
    mutationFn: async ({ periodStart, periodEnd }: { periodStart: Date; periodEnd: Date }) => {
      if (!restaurant?.id) throw new Error("No restaurant selected");

      const { data, error } = await db.rpc("lock_fiscal_period", {
        p_restaurant_id: restaurant.id,
        p_period_start: periodStart.toISOString().split("T")[0],
        p_period_end: periodEnd.toISOString().split("T")[0],
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fiscal-period-locks"] });
      toast.success("Period locked successfully");
    },
    onError: (error: Error) => {
      toast.error("Failed to lock period", { description: error.message });
    },
  });

  // Unlock a fiscal period
  const unlockPeriod = useMutation({
    mutationFn: async ({ lockId, reason }: { lockId: string; reason: string }) => {
      const { data, error } = await db.rpc("unlock_fiscal_period", {
        p_lock_id: lockId,
        p_reason: reason,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fiscal-period-locks"] });
      toast.success("Period unlocked successfully");
    },
    onError: (error: Error) => {
      toast.error("Failed to unlock period", { description: error.message });
    },
  });

  // Get list of months that can be locked (past months only)
  const getClosableMonths = (monthStartDay: number, count: number = 12): Array<{ start: Date; end: Date; label: string }> => {
    const months: Array<{ start: Date; end: Date; label: string }> = [];
    const now = new Date();
    
    // Start from previous fiscal month
    const current = new Date(now);
    current.setMonth(current.getMonth() - 1);
    
    for (let i = 0; i < count; i++) {
      const { start, end } = getFiscalMonthRange(current, monthStartDay);
      
      // Only include months that have ended
      if (end < now) {
        const label = start.toLocaleDateString("en-US", { month: "long", year: "numeric" });
        months.push({ start, end, label });
      }
      
      current.setMonth(current.getMonth() - 1);
    }
    
    return months;
  };

  return {
    locks,
    isLoading,
    isDateLocked,
    getLockForPeriod,
    lockPeriod,
    unlockPeriod,
    getClosableMonths,
    isLocking: lockPeriod.isPending,
    isUnlocking: unlockPeriod.isPending,
  };
}
