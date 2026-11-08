import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface VarianceThreshold {
  id: string;
  tenant_id: string;
  restaurant_id: string | null;
  minor_threshold: number;
  investigate_threshold: number;
  escalate_threshold: number;
  require_explanation_above: number;
  auto_escalate_enabled: boolean;
  notify_manager_enabled: boolean;
  require_adjustment_for_close: boolean;
}

export interface ShiftVarianceLog {
  id: string;
  tenant_id: string;
  restaurant_id: string;
  shift_id: string;
  cashier_user_id: string | null;
  cashier_staff_id: string | null;
  cashier_name: string;
  opening_float: number;
  expected_cash: number;
  counted_cash: number;
  variance_amount: number;
  variance_percentage: number;
  variance_status: 'perfect' | 'minor' | 'investigate' | 'resolved' | 'escalated';
  threshold_breached: boolean;
  explanation: string | null;
  resolution_notes: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  shift_opened_at: string;
  shift_closed_at: string;
  created_at: string;
}

// Default thresholds
export const DEFAULT_THRESHOLDS: Omit<VarianceThreshold, 'id' | 'tenant_id' | 'restaurant_id'> = {
  minor_threshold: 10,
  investigate_threshold: 50,
  escalate_threshold: 100,
  require_explanation_above: 10,
  auto_escalate_enabled: true,
  notify_manager_enabled: true,
  require_adjustment_for_close: false,
};

export function useVarianceThresholds() {
  const { tenant, restaurant } = useAuth();
  const queryClient = useQueryClient();

  const { data: thresholds, isLoading } = useQuery({
    queryKey: ['variance-thresholds', tenant?.id, restaurant?.id],
    queryFn: async (): Promise<VarianceThreshold> => {
      if (!tenant?.id) return DEFAULT_THRESHOLDS as VarianceThreshold;

      const { data, error } = await supabase
        .from('variance_thresholds')
        .select('*')
        .eq('tenant_id', tenant.id)
        .or(`restaurant_id.eq.${restaurant?.id},restaurant_id.is.null`)
        .order('restaurant_id', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return (data as VarianceThreshold) || (DEFAULT_THRESHOLDS as VarianceThreshold);
    },
    enabled: !!tenant?.id,
  });

  const updateThresholds = useMutation({
    mutationFn: async (data: Partial<VarianceThreshold>) => {
      if (!tenant?.id) throw new Error('No tenant');

      const existing = await supabase
        .from('variance_thresholds')
        .select('id')
        .eq('tenant_id', tenant.id)
        .eq('restaurant_id', restaurant?.id || null)
        .maybeSingle();

      if (existing.data?.id) {
        const { error } = await supabase
          .from('variance_thresholds')
          .update(data)
          .eq('id', existing.data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('variance_thresholds')
          .insert({
            tenant_id: tenant.id,
            restaurant_id: restaurant?.id || null,
            ...DEFAULT_THRESHOLDS,
            ...data,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['variance-thresholds'] });
      toast.success('Variance thresholds updated');
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  return {
    thresholds: thresholds || DEFAULT_THRESHOLDS,
    isLoading,
    updateThresholds,
  };
}

export function useShiftVarianceLogs(options?: { cashierId?: string; status?: string; limit?: number }) {
  const { tenant, restaurant } = useAuth();

  return useQuery({
    queryKey: ['shift-variance-logs', tenant?.id, restaurant?.id, options],
    queryFn: async (): Promise<ShiftVarianceLog[]> => {
      if (!tenant?.id || !restaurant?.id) return [];

      let query = supabase
        .from('shift_variance_logs')
        .select('*')
        .eq('restaurant_id', restaurant.id)
        .order('shift_closed_at', { ascending: false });

      if (options?.cashierId) {
        query = query.or(`cashier_user_id.eq.${options.cashierId},cashier_staff_id.eq.${options.cashierId}`);
      }

      if (options?.status) {
        query = query.eq('variance_status', options.status);
      }

      if (options?.limit) {
        query = query.limit(options.limit);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as ShiftVarianceLog[];
    },
    enabled: !!tenant?.id && !!restaurant?.id,
  });
}

export function useResolveVariance() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ logId, resolutionNotes }: { logId: string; resolutionNotes: string }) => {
      if (!user?.id) throw new Error('Authentication required');

      const { error } = await supabase
        .from('shift_variance_logs')
        .update({
          variance_status: 'resolved',
          resolution_notes: resolutionNotes,
          resolved_by: user.id,
          resolved_at: new Date().toISOString(),
        })
        .eq('id', logId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shift-variance-logs'] });
      toast.success('Variance resolved');
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}

// Helper to get variance status based on thresholds
export function getVarianceStatus(
  variance: number, 
  thresholds: typeof DEFAULT_THRESHOLDS
): 'perfect' | 'minor' | 'investigate' | 'escalated' {
  const abs = Math.abs(variance);
  if (abs === 0) return 'perfect';
  if (abs <= thresholds.minor_threshold) return 'minor';
  if (abs <= thresholds.investigate_threshold) return 'investigate';
  return 'escalated';
}

// Helper to check if explanation is required
export function isExplanationRequired(variance: number, thresholds: typeof DEFAULT_THRESHOLDS): boolean {
  return Math.abs(variance) > thresholds.require_explanation_above;
}
