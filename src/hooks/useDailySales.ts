import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { toast } from "sonner";
import { parseCoaError, getErrorExplanation } from "@/lib/coaValidation";
import { bucketForPaymentMethod, fetchPaymentMap, fetchPaymentRules } from "@/lib/posPaymentMapping";
import { getRestaurantDayBoundsUTC } from "@/lib/timezone";

export type DeliveryPlatform = 'hungerstation' | 'jahez' | 'toyou' | 'mrsool' | 'carriage' | 'talabat' | 'uber_eats' | 'other';
export type DaySalesStatus = 'draft' | 'submitted' | 'approved' | 'closed';
export type VarianceStatus = 'pending' | 'matched' | 'minor' | 'investigate' | 'resolved';

export const DELIVERY_PLATFORMS: { value: DeliveryPlatform; label: string; color: string }[] = [
  { value: 'hungerstation', label: 'HungerStation', color: 'bg-orange-500' },
  { value: 'jahez', label: 'Jahez', color: 'bg-yellow-500' },
  { value: 'toyou', label: 'ToYou', color: 'bg-purple-500' },
  { value: 'mrsool', label: 'Mrsool', color: 'bg-blue-500' },
  { value: 'carriage', label: 'Carriage', color: 'bg-green-500' },
  { value: 'talabat', label: 'Talabat', color: 'bg-orange-600' },
  { value: 'uber_eats', label: 'Uber Eats', color: 'bg-black' },
  { value: 'other', label: 'Other', color: 'bg-gray-500' },
];

export interface DailySalesSummary {
  id: string;
  tenant_id: string;
  restaurant_id: string;
  sales_date: string;
  cash_sales: number;
  card_sales: number;
  delivery_sales: number;
  other_sales: number;
  /** Sales put on customers' tabs (posted to Customer Accounts receivable, not cash). */
  account_sales?: number;
  total_sales: number;
  pos_reported_total: number | null;
  system_calculated_total: number | null;
  variance_amount: number | null;
  variance_status: VarianceStatus;
  variance_notes: string | null;
  variance_resolved_by: string | null;
  variance_resolved_at: string | null;
  status: DaySalesStatus;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  ledger_posted: boolean | null;
  ledger_batch_id: string | null;
  ai_revenue_account_id: string | null;
  delivery_breakdown?: DeliveryBreakdown[];
}

export interface DeliveryBreakdown {
  id: string;
  daily_sales_id: string;
  platform: DeliveryPlatform;
  gross_sales: number;
  platform_commission: number;
  net_sales: number;
  order_count: number;
  notes: string | null;
}

export interface CreateDailySalesData {
  sales_date: string;
  cash_sales: number;
  card_sales: number;
  delivery_sales: number;
  other_sales?: number;
  pos_reported_total?: number;
  variance_notes?: string;
  delivery_breakdown?: Omit<DeliveryBreakdown, 'id' | 'daily_sales_id' | 'net_sales'>[];
}

export interface UpdateDailySalesData {
  id: string;
  cash_sales?: number;
  card_sales?: number;
  delivery_sales?: number;
  other_sales?: number;
  pos_reported_total?: number;
  variance_notes?: string;
  status?: DaySalesStatus;
}

// Parse explicit errors from database
function parseDailySalesError(error: Error | string): { message: string; field?: string } {
  const message = typeof error === 'string' ? error : error.message;
  
  if (message.includes('VALIDATION_ERROR:')) {
    const cleanMessage = message.replace(/.*VALIDATION_ERROR:\s*/, '').replace(/\s*CONTEXT:.*/, '');
    
    if (cleanMessage.includes('unresolved variance')) {
      return { message: cleanMessage, field: 'variance' };
    }
    if (cleanMessage.includes('payment types')) {
      return { message: cleanMessage, field: 'payment' };
    }
    if (cleanMessage.includes('past date') || cleanMessage.includes('future date') || cleanMessage.includes('unclosed days')) {
      return { message: cleanMessage, field: 'date' };
    }
    return { message: cleanMessage };
  }
  
  if (message.includes('unique_daily_sales_per_restaurant')) {
    return { 
      message: 'Sales have already been recorded for this date. Please edit the existing entry instead.',
      field: 'date'
    };
  }
  
  return { message: message || 'An error occurred while saving sales data.' };
}

/**
 * What each customer sale of the day put on the customer's tab (sale_account_amounts,
 * migration 20261111190452). End of Day leaves these out of cash/card and posts them to the
 * Customer Accounts receivable.
 */
async function fetchAccountAmounts(restaurantId: string, branchId: string | null, from: Date, to: Date) {
  const { data, error } = await db.rpc("sale_account_amounts", {
    p_restaurant_id: restaurantId,
    p_branch_id: branchId as string,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
  if (error) throw error;
  return new Map<string, number>((data ?? []).map((r: { sale_id: string; on_account: number }) => [r.sale_id, Number(r.on_account) || 0]));
}
const sumAccount = (m: Map<string, number>) => Math.round([...m.values()].reduce((a, b) => a + b, 0) * 100) / 100;

export function useDailySales(date?: string) {
  const { user, restaurant, tenant } = useAuth();
  const { activeBranchId, isAllBranches, hasMultipleBranches, isBranchReady } = useBranch();
  const queryClient = useQueryClient();
  const tz = restaurant?.timezone || "Asia/Riyadh";

  /**
   * Day-end is branch-scoped: one daily_sales_summary row per
   * restaurant + branch + date. With "All branches" selected on a
   * multi-branch tenant there is no single day to record, so the caller
   * must ask the user to pick a branch first.
   */
  const requiresBranchSelection = isAllBranches && hasMultipleBranches;

  // Fetch daily sales for a specific date (single record)
  const { data: dailySales, isLoading, error } = useQuery({
    queryKey: ['daily-sales', restaurant?.id, activeBranchId ?? 'all', date],
    queryFn: async (): Promise<DailySalesSummary | null> => {
      if (!restaurant?.id || !date) return null;

      let q = db
        .from('daily_sales_summary')
        .select('*')
        .eq('restaurant_id', restaurant.id)
        .eq('sales_date', date);
      if (activeBranchId) q = q.eq('branch_id', activeBranchId);
      const { data, error } = await q.order('created_at', { ascending: true }).limit(1).maybeSingle();

      if (error) throw error;
      return data as DailySalesSummary | null;
    },
    enabled: !!restaurant?.id && !!date && isBranchReady && !requiresBranchSelection,
  });

  // Fetch system-calculated total from transactions
  const { data: systemTotal } = useQuery({
    queryKey: ['system-sales-total', restaurant?.id, activeBranchId, date],
    queryFn: async () => {
      if (!restaurant?.id || !date) return 0;

      const { start, endExclusive } = getRestaurantDayBoundsUTC(new Date(`${date}T12:00:00Z`), tz);
      let q = db
        .from('sales_transactions')
        .select('total')
        .eq('restaurant_id', restaurant.id)
        .gte('created_at', start.toISOString())
        .lt('created_at', endExclusive.toISOString());
      if (activeBranchId) q = q.eq('branch_id', activeBranchId);
      const { data, error } = await q;

      if (error) throw error;
      return data?.reduce((sum, t) => sum + (Number(t.total) || 0), 0) || 0;
    },
    enabled: !!restaurant?.id && !!date && isBranchReady,
  });

  // Fetch system breakdown by payment_method for prefill
  const { data: systemBreakdown, isLoading: isBreakdownLoading, isFetching: isBreakdownFetching } = useQuery({
    queryKey: ['system-sales-breakdown', restaurant?.id, activeBranchId, date],
    queryFn: async () => {
      const empty = {
        cash: 0,
        card: 0,
        delivery: 0,
        other: 0,
        /** Put on customers' tabs: left out of cash/card, posted as receivable. */
        account: 0,
        transactions: [] as Array<{
          id: string;
          receipt_number: string | null;
          payment_method: string | null;
          total: number;
          created_at: string;
          bucket: 'cash' | 'card' | 'delivery' | 'other';
          /** Part of the sale put on the customer's tab (not taken at the till). */
          on_account: number;
        }>,
        startISO: '',
        endExclusiveISO: '',
        timezone: tz,
      };
      if (!restaurant?.id || !date) return empty;

      const { start, endExclusive } = getRestaurantDayBoundsUTC(new Date(`${date}T12:00:00Z`), tz);
      let q = db
        .from('sales_transactions')
        .select('id,receipt_number,total,payment_method,created_at')
        .eq('restaurant_id', restaurant.id)
        .gte('created_at', start.toISOString())
        .lt('created_at', endExclusive.toISOString())
        .order('created_at', { ascending: true });
      if (activeBranchId) q = q.eq('branch_id', activeBranchId);
      const { data, error } = await q;

      if (error) throw error;
      const [overrides, rules, onAccount] = await Promise.all([
        fetchPaymentMap(restaurant.id),
        fetchPaymentRules(restaurant.id),
        fetchAccountAmounts(restaurant.id, activeBranchId ?? null, start, endExclusive),
      ]);
      const acc = {
        ...empty,
        transactions: [] as typeof empty.transactions,
        startISO: start.toISOString(),
        endExclusiveISO: endExclusive.toISOString(),
        timezone: tz,
      };
      for (const r of data || []) {
        const amt = Number(r.total) || 0;
        const bucket = bucketForPaymentMethod(r.payment_method as string, overrides, rules);
        // A tab sale's unpaid part was not taken at the till: it is not cash or card.
        const owedPart = onAccount.get(r.id as string) ?? 0;
        acc[bucket] += amt - owedPart;
        acc.account += owedPart;
        acc.transactions.push({
          id: r.id as string,
          receipt_number: (r as { receipt_number: string | null }).receipt_number,
          payment_method: (r.payment_method as string) ?? null,
          total: amt,
          created_at: r.created_at as string,
          bucket,
          on_account: owedPart,
        });
      }
      return acc;
    },
    enabled: !!restaurant?.id && !!date && isBranchReady,
  });

  // Create daily sales entry
  const createDailySales = useMutation({
    mutationFn: async (data: CreateDailySalesData) => {
      if (!restaurant?.id || !tenant?.id || !user?.id) {
        throw new Error('Missing authentication context');
      }

      // Validate mandatory fields
      if (data.cash_sales < 0 || data.card_sales < 0 || data.delivery_sales < 0) {
        throw new Error('VALIDATION_ERROR: Sales amounts cannot be negative.');
      }

      // Calculate system total
      const { start: cStart, endExclusive: cEnd } = getRestaurantDayBoundsUTC(new Date(`${data.sales_date}T12:00:00Z`), tz);
      let txQ = db
        .from('sales_transactions')
        .select('total')
        .eq('restaurant_id', restaurant.id)
        .gte('created_at', cStart.toISOString())
        .lt('created_at', cEnd.toISOString());
      if (activeBranchId) txQ = txQ.eq('branch_id', activeBranchId);
      const { data: txData } = await txQ;
      
      const systemCalcTotal = txData?.reduce((sum, t) => sum + (Number(t.total) || 0), 0) || 0;
      const accountSales = sumAccount(await fetchAccountAmounts(restaurant.id, activeBranchId ?? null, cStart, cEnd));

      const { data: result, error } = await db
        .from('daily_sales_summary')
        .insert({
          tenant_id: tenant.id,
          restaurant_id: restaurant.id,
          branch_id: activeBranchId ?? null,
          sales_date: data.sales_date,
          cash_sales: data.cash_sales,
          card_sales: data.card_sales,
          delivery_sales: data.delivery_sales,
          other_sales: data.other_sales || 0,
          account_sales: accountSales,
          pos_reported_total: data.pos_reported_total,
          system_calculated_total: systemCalcTotal,
          variance_notes: data.variance_notes,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;

      // Create delivery breakdown if provided
      if (data.delivery_breakdown && data.delivery_breakdown.length > 0) {
        const { error: breakdownError } = await db
          .from('daily_delivery_breakdown')
          .insert(
            data.delivery_breakdown.map(b => ({
              daily_sales_id: result.id,
              platform: b.platform,
              gross_sales: b.gross_sales,
              platform_commission: b.platform_commission,
              order_count: b.order_count,
              notes: b.notes,
            }))
          );
        
        if (breakdownError) {
          console.error('Error creating delivery breakdown:', breakdownError);
        }
      }

      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-sales'] });
      queryClient.invalidateQueries({ queryKey: ['system-sales-total'] });
      toast.success('Daily sales recorded successfully');
    },
    onError: (error: Error) => {
      const parsed = parseDailySalesError(error);
      toast.error(parsed.message, { duration: 6000 });
    },
  });

  // Update daily sales
  const updateDailySales = useMutation({
    mutationFn: async (data: UpdateDailySalesData) => {
      const { id, ...updateData } = data;

      // Re-snapshot the POS system total: a reopened / re-entered day must not
      // keep the total captured when the row was first created, otherwise the
      // variance shown on the day-end screen is computed against stale data.
      let systemCalcTotal: number | undefined;
      let accountSales: number | undefined;
      if (restaurant?.id) {
        const { data: existing } = await db
          .from('daily_sales_summary')
          .select('sales_date, branch_id')
          .eq('id', id)
          .maybeSingle();
        if (existing?.sales_date) {
          const { start: uStart, endExclusive: uEnd } = getRestaurantDayBoundsUTC(
            new Date(`${existing.sales_date}T12:00:00Z`),
            tz,
          );
          let sysQ = db
            .from('sales_transactions')
            .select('total')
            .eq('restaurant_id', restaurant.id)
            .gte('created_at', uStart.toISOString())
            .lt('created_at', uEnd.toISOString());
          const scopeBranch = existing.branch_id ?? activeBranchId;
          if (scopeBranch) sysQ = sysQ.eq('branch_id', scopeBranch);
          const { data: sysRows } = await sysQ;
          systemCalcTotal = (sysRows || []).reduce((sum, t) => sum + (Number(t.total) || 0), 0);
          accountSales = sumAccount(await fetchAccountAmounts(restaurant.id, scopeBranch ?? null, uStart, uEnd));
        }
      }

      const { data: result, error } = await db
        .from('daily_sales_summary')
        .update({
          ...updateData,
          ...(systemCalcTotal !== undefined ? { system_calculated_total: systemCalcTotal } : {}),
          ...(accountSales !== undefined ? { account_sales: accountSales } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-sales'] });
      toast.success('Daily sales updated successfully');
    },
    onError: (error: Error) => {
      const parsed = parseDailySalesError(error);
      toast.error(parsed.message, { duration: 6000 });
    },
  });

  // Close day (with variance check)
  const closeDay = useMutation({
    mutationFn: async ({ id, varianceNotes }: { id: string; varianceNotes?: string }) => {
      const updatePayload: Record<string, unknown> = {
        status: 'closed',
        updated_at: new Date().toISOString(),
      };

      // If resolving variance, add resolution fields
      if (varianceNotes) {
        updatePayload.variance_notes = varianceNotes;
        updatePayload.variance_resolved_by = user?.id;
        updatePayload.variance_resolved_at = new Date().toISOString();
        updatePayload.variance_status = 'resolved';
      }

      const { data, error } = await db
        .from('daily_sales_summary')
        .update(updatePayload)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-sales'] });
      toast.success('Day closed successfully');
    },
    onError: (error: Error) => {
      const parsed = parseDailySalesError(error);
      toast.error(parsed.message, { duration: 6000 });
    },
  });

  return {
    dailySales,
    systemTotal,
    systemBreakdown,
    isBreakdownLoading: isBreakdownLoading || isBreakdownFetching,
    isLoading,
    error,
    requiresBranchSelection,
    createDailySales,
    updateDailySales,
    closeDay,
  };
}

// Hook for fetching delivery breakdown
export function useDeliveryBreakdown(dailySalesId?: string) {
  return useQuery({
    queryKey: ['delivery-breakdown', dailySalesId],
    queryFn: async () => {
      if (!dailySalesId) return [];

      const { data, error } = await db
        .from('daily_delivery_breakdown')
        .select('*')
        .eq('daily_sales_id', dailySalesId)
        .order('gross_sales', { ascending: false });

      if (error) throw error;
      return data as DeliveryBreakdown[];
    },
    enabled: !!dailySalesId,
  });
}
