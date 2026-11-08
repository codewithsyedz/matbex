import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useFiscalSettings, getFiscalMonthRange, getPreviousFiscalMonthRange } from "@/hooks/useFiscalSettings";
import { filterStaffActiveInPeriod, calculateMonthlyPayroll, isCurrentPeriod } from "@/lib/staffUtils";
import { format } from "date-fns";

interface OverheadItem {
  id: string;
  name: string;
  monthly_amount: number;
  is_active: boolean;
  fiscal_daily_amount?: number;
  is_paid?: boolean;
  paid_amount?: number;
  remaining_amount?: number;
}

interface OverheadData {
  fixedOverhead: number;
  grossPayroll: number;
  pendingAdvances: number;
  paidPayroll: number;
  paidOverheadTotal: number;
  totalPayable: number; // Remaining unpaid = (gross - advances) for unpaid staff only
  totalOverhead: number;
  dailyOverhead: number;
  items: OverheadItem[];
  staffCount: number;
  paidStaffCount: number;
  paidOverheadCount: number;
  totalDays: number;
}

/**
 * Shared hook for overhead data - deduplicated across dashboard components.
 * Uses a consistent query key so React Query caches and shares the result.
 * Payroll is calculated as Total Payable = remaining unpaid staff (Net Payable - Already Paid)
 */
export function useOverheadData(useLastMonth = false) {
  const { restaurant } = useAuth();
  const { activeBranchId, pinnedBranchId } = useBranch();
  const branchId = pinnedBranchId ?? activeBranchId ?? null;
  // Rows with a NULL branch_id are shared/tenant-wide and count for every branch.
  const branchFilter = branchId ? `branch_id.eq.${branchId},branch_id.is.null` : null;
  // The staff table pins people via `assigned_branch_id` (`branch_id` is unused/NULL),
  // so payroll must be scoped with that column or every branch sees tenant-wide payroll.
  const staffBranchId = branchId ?? null;
  const { monthStartDay, isLoading: fiscalLoading } = useFiscalSettings();

  const now = new Date();
  const currentFiscalRange = getFiscalMonthRange(now, monthStartDay);
  const prevFiscalRange = getPreviousFiscalMonthRange(now, monthStartDay);
  const { start: fiscalStart, end: fiscalEnd } = useLastMonth ? prevFiscalRange : currentFiscalRange;
  
  const totalDays = Math.ceil((fiscalEnd.getTime() - fiscalStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const fiscalStartStr = format(fiscalStart, "yyyy-MM-dd");
  const fiscalEndStr = format(fiscalEnd, "yyyy-MM-dd");

  return useQuery({
    // Stable query key for deduplication across components
    queryKey: ["shared-overhead-data", restaurant?.id, branchId, useLastMonth, fiscalStartStr],
    queryFn: async (): Promise<OverheadData> => {
      if (!restaurant?.id) {
        return { fixedOverhead: 0, grossPayroll: 0, pendingAdvances: 0, paidPayroll: 0, paidOverheadTotal: 0, totalPayable: 0, totalOverhead: 0, dailyOverhead: 0, items: [], staffCount: 0, paidStaffCount: 0, paidOverheadCount: 0, totalDays: 30 };
      }

      // Run all queries in parallel
      const [overheadResult, staffResult, advancesResult, payrollResult, overheadPaymentsResult] = await Promise.all([
        (async () => {
          let q = db
            .from("overhead_allocation")
            .select("id, name, monthly_amount, is_active")
            .eq("restaurant_id", restaurant.id)
            .eq("is_active", true);
          if (branchFilter) q = q.or(branchFilter);
          return await q.order("monthly_amount", { ascending: false });
        })(),
        
        // Staff query with versioned filtering
        (async () => {
          const isViewingCurrentPeriod = isCurrentPeriod(fiscalEnd);
          
          let query = db
            .from("staff")
            .select("id, monthly_salary, hourly_rate, joined_date, termination_date, is_active, payment_type, assigned_branch_id")
            .eq("restaurant_id", restaurant.id);

          if (staffBranchId) query = query.eq("assigned_branch_id", staffBranchId);
          
          if (isViewingCurrentPeriod) {
            query = query.eq("is_active", true);
          }
          
          const { data: staffData, error } = await query;
          if (error) throw error;
          
          const activeStaff = isViewingCurrentPeriod 
            ? staffData || []
            : filterStaffActiveInPeriod(staffData || [], fiscalStart, fiscalEnd);
          
          return activeStaff;
        })(),
        
        // Pending advances query - advances not yet deducted from payroll
        db
          .from("staff_advances")
          .select("amount, staff_id")
          .eq("restaurant_id", restaurant.id)
          .eq("status", "pending"),
        
        // Payroll records for this fiscal month (to find already-paid staff)
        db
          .from("payroll_records")
          .select("staff_id, amount")
          .eq("restaurant_id", restaurant.id)
          .eq("period_start", fiscalStartStr)
          .eq("period_end", fiscalEndStr),
        
        // Overhead payments - use fiscal start since OverheadPaymentManager uses fiscal months
        (async () => {
          let q = db
            .from("overhead_payments")
            .select("overhead_allocation_id, amount_paid")
            .eq("restaurant_id", restaurant.id)
            .eq("payment_month", fiscalStartStr);
          if (branchFilter) q = q.or(branchFilter);
          return await q;
        })()
      ]);

      if (overheadResult.error) throw overheadResult.error;
      if (advancesResult.error) throw advancesResult.error;
      if (payrollResult.error) throw payrollResult.error;
      if (overheadPaymentsResult.error) throw overheadPaymentsResult.error;

      // Build map of paid overhead items
      const paidOverheadMap = new Map<string, number>();
      (overheadPaymentsResult.data || []).forEach(payment => {
        paidOverheadMap.set(payment.overhead_allocation_id, Number(payment.amount_paid));
      });

      // Map overhead items with paid status and remaining amount
      const items: OverheadItem[] = (overheadResult.data || []).map(item => {
        const monthlyAmount = Number(item.monthly_amount);
        const paidAmount = paidOverheadMap.get(item.id) || 0;
        const isPaid = paidOverheadMap.has(item.id);
        return {
          ...item,
          monthly_amount: monthlyAmount,
          fiscal_daily_amount: totalDays > 0 ? monthlyAmount / totalDays : 0,
          is_paid: isPaid,
          paid_amount: paidAmount,
          remaining_amount: isPaid ? 0 : monthlyAmount
        };
      });

      // Fixed overhead = only unpaid overhead items
      const fixedOverhead = items.reduce((sum, item) => sum + (item.remaining_amount || 0), 0);
      const paidOverheadTotal = items.reduce((sum, item) => sum + (item.paid_amount || 0), 0);
      
      // Restrict payroll/advances to staff belonging to the active branch scope
      const branchStaffIds = new Set(staffResult.map(s => s.id));
      const scopedPayroll = (payrollResult.data || []).filter(pr => branchStaffIds.has(pr.staff_id));
      const scopedAdvances = (advancesResult.data || []).filter(a => branchStaffIds.has(a.staff_id));

      // Get set of already-paid staff IDs
      const paidStaffIds = new Set(scopedPayroll.map(pr => pr.staff_id));
      const paidPayroll = scopedPayroll.reduce((sum, pr) => sum + Number(pr.amount), 0);
      
      // Calculate payroll for ALL active staff
      const grossPayroll = staffResult.reduce((sum, staff) => {
        const salary = Number(staff.monthly_salary) || 0;
        const hourlyEstimate = Number(staff.hourly_rate) * 160 || 0;
        return sum + (salary > 0 ? salary : hourlyEstimate);
      }, 0);
      
      // Calculate pending advances only for active staff
      const pendingAdvances = scopedAdvances.reduce((sum, adv) => sum + Number(adv.amount), 0);
      
      // Calculate Total Payable = sum of (salary - advances) for UNPAID staff only
      const totalPayable = staffResult
        .filter(staff => !paidStaffIds.has(staff.id))
        .reduce((sum, staff) => {
          const salary = Number(staff.monthly_salary) || (Number(staff.hourly_rate) * 160) || 0;
          const staffAdvances = scopedAdvances
            .filter(adv => adv.staff_id === staff.id)
            .reduce((s, adv) => s + Number(adv.amount), 0);
          return sum + Math.max(0, salary - staffAdvances);
        }, 0);
      
      // Total Overhead = unpaid fixed overhead + unpaid payroll
      const totalOverhead = fixedOverhead + totalPayable;

      return {
        fixedOverhead,
        grossPayroll,
        pendingAdvances,
        paidPayroll,
        paidOverheadTotal,
        totalPayable,
        totalOverhead,
        dailyOverhead: totalDays > 0 ? totalOverhead / totalDays : 0,
        items,
        staffCount: staffResult.length,
        paidStaffCount: paidStaffIds.size,
        paidOverheadCount: paidOverheadMap.size,
        totalDays
      };
    },
    enabled: !!restaurant?.id && !fiscalLoading,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });
}
