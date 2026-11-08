import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useFiscalSettings, getFiscalMonthRange } from "@/hooks/useFiscalSettings";
import { resolvePayrollPeriod, describePayrollPeriod } from "@/lib/payrollCutoff";
import { useCurrency } from "@/hooks/useCurrency";
import { useStaffAdvances, advanceOutstanding } from "@/hooks/useStaffAdvances";
import { useBranch } from "@/contexts/BranchContext";
import { BranchScopeSelector } from "@/components/branches/BranchScopeSelector";
import { format, differenceInCalendarDays, differenceInMonths, parseISO, subDays, subMonths } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { exportStaffPayablePdf } from "@/lib/staffPayableBreakdownPdf";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PayableBreakdownSkeleton } from "@/components/staff/StaffSkeletons";
import {
  Calendar,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  FileDown,
  Loader2,
  Minus,
  AlertTriangle,
  Circle,
  RotateCcw,
  Sparkles,
  Columns3,
  User,
  Wallet,
} from "lucide-react";

type PayStepKey = "record" | "fines" | "advances" | "ledger";

interface PayStep {
  key: PayStepKey;
  label: string;
  status: "pending" | "running" | "done" | "skipped" | "failed";
  error?: string;
}

const PAY_STEPS: { key: PayStepKey; label: string }[] = [
  { key: "record", label: "Create payroll record" },
  { key: "fines", label: "Apply approved fines" },
  { key: "advances", label: "Recover staff advances" },
  { key: "ledger", label: "Post to general ledger" },
];

const initialPaySteps = (): PayStep[] =>
  PAY_STEPS.map((s) => ({ ...s, status: "pending" as const }));

interface Staff {
  id: string;
  name: string;
  role: string;
  payment_type: string;
  monthly_salary: number | null;
  hourly_rate: number | null;
  assigned_branch_id?: string | null;
  joined_date?: string | null;
}

interface PayrollRecord {
  id: string;
  staff_id: string;
  amount: number;
  period_start: string;
  period_end: string;
  payment_date: string;
}

interface FineLine {
  id: string;
  amount: number;
  /** yyyy-MM the installment is scheduled for. */
  month: string;
  isOverdue: boolean;
  label: string;
}

/** Renders a yyyy-MM allocation key as a short human month, e.g. "Jul 2026". */
function formatMonthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return format(new Date(y, m - 1, 1), "MMM yyyy");
}

interface StaffPayable {
  /** Individual fine installments recovered by this payroll month. */
  fineLines: FineLine[];
  staff: Staff;
  baseSalary: number;
  fullSalary: number;
  isProrated: boolean;
  proratedDays: number;
  fiscalDays: number;
  isNewJoiner: boolean;
  pendingAdvances: number;
  pendingFines: number;
  /** Fines whose payroll_month falls inside the active payroll cycle. */
  dueFines: number;
  /** Outstanding fines from earlier cycles that were never recovered. */
  overdueFines: number;
  fineCount: number;
  netPayable: number;
  isPaid: boolean;
  payrollRecordId?: string;
  /** Unpaid pro-rated salary for the joining cycle (joining date → previous cycle end). */
  joiningArrears: number;
  arrearsDays: number;
  arrearsFrom?: string;
  arrearsTo?: string;
  arrearsCycleDays: number;
  /** period_start to use when recording the payroll (joining date when arrears apply). */
  periodStart: string;
}

function parseDateOnly(value?: string | null): Date | null {
  if (!value) return null;
  const d = parseISO(value.length > 10 ? value.slice(0, 10) : value);
  return isNaN(d.getTime()) ? null : d;
}

export function FiscalMonthPayableBreakdown() {
  const { restaurant, user, hasRole } = useAuth();
  const {
    monthStartDay,
    payrollCutoffDay,
    payrollPeriodOffset,
    fineAllocationMode,
    isLoading: fiscalLoading,
  } = useFiscalSettings();
  const { format: formatCurrency } = useCurrency();
  const queryClient = useQueryClient();
  const isManager = hasRole("owner") || hasRole("manager");
  const { advances } = useStaffAdvances();
  const { activeBranchId, branches, hasMultipleBranches } = useBranch();
  const [compareMode, setCompareMode] = useState(false);
  const compareEnabled = compareMode && hasMultipleBranches;

  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<StaffPayable | null>(null);
  const [expandedFines, setExpandedFines] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [paySteps, setPaySteps] = useState<PayStep[]>(initialPaySteps);
  const [payAttempt, setPayAttempt] = useState(0);
  /** Survives a failed attempt so a retry resumes instead of duplicating work. */
  const payFlowRef = useRef<{ payrollId?: string; done: Set<PayStepKey>; deferred: number }>({
    done: new Set(),
    deferred: 0,
  });

  const resetPayFlow = () => {
    payFlowRef.current = { done: new Set(), deferred: 0 };
    setPaySteps(initialPaySteps());
    setPayAttempt(0);
  };

  const setStep = (key: PayStepKey, status: PayStep["status"], error?: string) =>
    setPaySteps((prev) =>
      prev.map((s) => (s.key === key ? { ...s, status, error } : s))
    );

  // Payroll target period follows the tenant's configurable cut-off rules
  // (defaults: pay the last completed cycle, released on the 1st).
  const today = new Date();
  const payrollPeriod = resolvePayrollPeriod(today, {
    monthStartDay,
    payrollCutoffDay,
    payrollPeriodOffset,
  });
  const { start: fiscalStart, end: fiscalEnd } = payrollPeriod;
  const fiscalStartStr = format(fiscalStart, "yyyy-MM-dd");
  const fiscalEndStr = format(fiscalEnd, "yyyy-MM-dd");
  /** Calendar month (yyyy-MM) that fines/installments are labelled with for this cycle. */
  const payrollMonthKey = format(fiscalEnd, "yyyy-MM");

  // Fetch active staff with salary info
  const { data: staffList, isLoading: staffLoading } = useQuery({
    queryKey: ["staff-active-full", restaurant?.id, compareEnabled ? "all-compare" : activeBranchId],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      let q = supabase
        .from("staff")
        .select("id, name, role, payment_type, monthly_salary, hourly_rate, assigned_branch_id, joined_date")
        .eq("restaurant_id", restaurant.id)
        .eq("is_active", true);
      if (activeBranchId && !compareEnabled) q = q.eq("assigned_branch_id", activeBranchId);
      const { data, error } = await q.order("name");

      if (error) throw error;
      return data as Staff[];
    },
    enabled: !!restaurant?.id,
  });

  // Fetch payroll records for this fiscal month
  const { data: payrollRecords, isLoading: payrollLoading } = useQuery({
    queryKey: ["payroll-fiscal-month", restaurant?.id, fiscalStartStr, fiscalEndStr],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await supabase
        .from("payroll_records")
        .select("id, staff_id, amount, period_start, period_end, payment_date")
        .eq("restaurant_id", restaurant.id)
        .gte("period_start", format(subMonths(fiscalStart, 3), "yyyy-MM-dd"))
        .lte("period_end", fiscalEndStr);

      if (error) throw error;
      return data as PayrollRecord[];
    },
    enabled: !!restaurant?.id,
  });

  // Approved (not yet applied) fines that should reduce this month's salary
  const { data: pendingFinesList = [], isLoading: finesLoading } = useQuery({
    queryKey: ["staff-pending-fines", restaurant?.id, fiscalEndStr, fineAllocationMode],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await supabase
        .from("employee_fines")
        .select(
          "id, staff_id, amount, recovered_amount, payroll_month, created_at, fine_number, description, installment_number, installment_count, installment_group_id"
        )
        .eq("restaurant_id", restaurant.id)
        .eq("status", "approved")
        .is("deleted_at", null)
        .or(
          `payroll_month.lte.${fiscalEndStr},created_at.lte.${fiscalEndStr}T23:59:59`
        );
      if (error) throw error;
      return (data ?? []) as {
        id: string;
        staff_id: string;
        amount: number;
        recovered_amount: number | null;
        payroll_month: string;
        created_at: string;
        fine_number: string | null;
        description: string | null;
        installment_number: number | null;
        installment_count: number | null;
        installment_group_id: string | null;
      }[];
    },
    enabled: !!restaurant?.id,
  });

  // Create payroll record mutation (mark as paid)
  const createPayrollMutation = useMutation({
    mutationFn: async (staffPayable: StaffPayable) => {
      if (!restaurant?.id || !user?.id) throw new Error("Missing context");
      const flow = payFlowRef.current;
      const fail = (key: PayStepKey, err: unknown): never => {
        const message = err instanceof Error ? err.message : String(err);
        setStep(key, "failed", message);
        throw err instanceof Error ? err : new Error(message);
      };

      // Create payroll record
      // amount must be the GROSS wage: post_payroll_to_ledger derives the advance
      // recovery credit (1150) and net cash from it. Passing the net here silently
      // dropped the advance recovery leg from the ledger.
      const grossWage =
        staffPayable.netPayable + staffPayable.pendingAdvances + staffPayable.pendingFines;

      // Saudi labour rule mirrored by the DB trigger `enforce_payroll_deduction_cap`:
      // advances + fines + other deductions may not exceed a % of the due wage.
      // Cap the recovery here (fines first, advances with what's left) and carry
      // the excess to the next payroll instead of failing the whole payment.
      const { data: capSetting } = await supabase
        .from("payroll_deduction_settings")
        .select("max_total_deduction_pct, branch_id, effective_from")
        .eq("restaurant_id", restaurant.id)
        .lte("effective_from", fiscalEndStr)
        .order("effective_from", { ascending: false });
      const branchId = (staffPayable.staff as any)?.branch_id ?? null;
      const pct =
        capSetting?.find((s) => s.branch_id && s.branch_id === branchId)
          ?.max_total_deduction_pct ??
        capSetting?.find((s) => !s.branch_id)?.max_total_deduction_pct ??
        50;
      const maxDeduction = grossWage > 0 ? Math.round((grossWage * pct) / 100 * 100) / 100 : Infinity;
      const fineCapacity = Math.max(0, Math.min(staffPayable.pendingFines, maxDeduction));
      const advanceCapacity = Math.max(
        0,
        Math.round((maxDeduction - fineCapacity) * 100) / 100
      );
      const advanceRecovered = Math.min(staffPayable.pendingAdvances, advanceCapacity);
      const deferred =
        Math.round(
          (staffPayable.pendingAdvances - advanceRecovered +
            (staffPayable.pendingFines - fineCapacity)) * 100
        ) / 100;

      flow.deferred = deferred;

      let payrollId = flow.payrollId;
      if (!flow.done.has("record")) {
        setStep("record", "running");
        const { data: payroll, error: payrollError } = await supabase
          .from("payroll_records")
          .insert({
          restaurant_id: restaurant.id,
          staff_id: staffPayable.staff.id,
          amount: grossWage,
          advance_recovered: advanceRecovered,
          period_start: staffPayable.periodStart,
          period_end: fiscalEndStr,
          payment_date: format(new Date(), "yyyy-MM-dd"),
          created_by: user.id,
          // `deductions` holds *other* deductions only — advances and fines are
          // tracked in their own columns and the DB cap sums all three.
          deductions: 0,
          notes: [
            advanceRecovered > 0
              ? `Includes deduction of ${formatCurrency(advanceRecovered)} for pending advances`
              : null,
            staffPayable.pendingFines > 0
              ? `Includes deduction of ${formatCurrency(staffPayable.pendingFines)} for ${staffPayable.fineCount} approved fine${staffPayable.fineCount === 1 ? "" : "s"}`
              : null,
            staffPayable.joiningArrears > 0
              ? `Includes ${formatCurrency(staffPayable.joiningArrears)} joining arrears (${staffPayable.arrearsFrom} → ${staffPayable.arrearsTo})`
              : null,
            deferred > 0
              ? `${formatCurrency(deferred)} deferred to next payroll (${pct}% deduction cap)`
              : null,
          ]
            .filter(Boolean)
            .join(". ") || null,
          })
          .select()
          .single();

        if (payrollError) fail("record", payrollError);
        payrollId = payroll!.id;
        flow.payrollId = payrollId;
        flow.done.add("record");
        setStep("record", "done");
      }

      // Apply approved fines to this payroll (DB enforces max deduction %)
      if (!flow.done.has("fines")) {
        if (staffPayable.pendingFines > 0) {
          setStep("fines", "running");
          const { error: fineError } = await supabase.rpc("apply_fines_to_payroll", {
            p_payroll_id: payrollId!,
          });
          if (fineError) {
            console.error("Error applying fines:", fineError);
            fail("fines", fineError);
          }
          setStep("fines", "done");
        } else {
          setStep("fines", "skipped");
        }
        flow.done.add("fines");
      }

      // Deduct all pending advances for this staff
      const staffPendingAdvances = advances.filter(
        (a) =>
          a.staff_id === staffPayable.staff.id &&
          a.status === "pending" &&
          advanceOutstanding(a) > 0
      );

      if (!flow.done.has("advances")) {
        if (advanceRecovered > 0 && staffPendingAdvances.length > 0) {
          setStep("advances", "running");
          let remaining = advanceRecovered;
          for (const advance of staffPendingAdvances) {
            if (remaining <= 0.009) break;
            const outstanding = advanceOutstanding(advance);
            if (outstanding <= remaining + 0.009) {
              const { error: deductError } = await supabase.rpc("deduct_advance_from_payroll", {
                p_advance_id: advance.id,
                p_payroll_id: payrollId!,
              });
              if (deductError) {
                console.error("Error deducting advance:", deductError);
                fail("advances", deductError);
              }
              remaining = Math.round((remaining - outstanding) * 100) / 100;
            } else {
              // Partial recovery — the rest stays outstanding for the next payroll.
              const { error: partialError } = await supabase.rpc("record_staff_advance_repayment", {
                p_advance_id: advance.id,
                p_amount: remaining,
                p_repayment_date: format(new Date(), "yyyy-MM-dd"),
                p_source: "payroll",
                p_payroll_id: payrollId!,
                p_notes: `Partial recovery — ${pct}% payroll deduction cap`,
              });
              if (partialError) {
                console.error("Error recording partial advance recovery:", partialError);
                fail("advances", partialError);
              }
              remaining = 0;
            }
          }
          setStep("advances", "done");
        } else {
          setStep("advances", "skipped");
        }
        flow.done.add("advances");
      }

      // Post payroll to ledger
      if (!flow.done.has("ledger")) {
        setStep("ledger", "running");
        const { error: ledgerError } = await supabase.rpc("post_payroll_to_ledger", {
          p_payroll_id: payrollId!,
        });
        if (ledgerError) {
          console.error("Error posting to ledger:", ledgerError);
          fail("ledger", ledgerError);
        }
        flow.done.add("ledger");
        setStep("ledger", "done");
      }

      return { id: payrollId, __deferred: deferred };
    },
    onSuccess: (payroll: any) => {
      queryClient.invalidateQueries({ queryKey: ["payroll-fiscal-month"] });
      queryClient.invalidateQueries({ queryKey: ["staff-advances"] });
      queryClient.invalidateQueries({ queryKey: ["staff-pending-fines"] });
      queryClient.invalidateQueries({ queryKey: ["employee-fines"] });
      queryClient.invalidateQueries({ queryKey: ["payroll"] });
      if (payroll?.__deferred > 0) {
        toast.success(
          `Paid. ${formatCurrency(payroll.__deferred)} of deductions deferred to next payroll (legal deduction cap).`
        );
      } else {
        toast.success("Staff marked as paid for this fiscal month");
      }
      setPayDialogOpen(false);
      setSelectedStaff(null);
      resetPayFlow();
    },
    onError: (error) => {
      console.error("Error creating payroll:", error);
      toast.error(
        error instanceof Error && error.message
          ? `Failed to record payment: ${error.message}`
          : "Failed to record payment"
      );
      setPayAttempt((n) => n + 1);
    },
  });

  // Calculate payable breakdown for each staff
  const getStaffPayables = (): StaffPayable[] => {
    if (!staffList) return [];

    return staffList.map((staff) => {
      // Base salary calculation
      let fullSalary = 0;
      if (staff.payment_type === "monthly" && staff.monthly_salary) {
        fullSalary = staff.monthly_salary;
      } else if (staff.payment_type === "hourly" && staff.hourly_rate) {
        // Estimate 160 hours/month for hourly staff
        fullSalary = staff.hourly_rate * 160;
      }

      // Pro-rate the current fiscal month for staff who joined mid-cycle.
      // Salary is always computed on a fixed 30-day month basis.
      const joined = parseDateOnly(staff.joined_date);
      const PAYROLL_MONTH_DAYS = 30;
      const fiscalDays = PAYROLL_MONTH_DAYS;
      let proratedDays = fiscalDays;
      let isProrated = false;
      if (joined && joined > fiscalStart && joined <= fiscalEnd) {
        proratedDays = Math.min(differenceInCalendarDays(fiscalEnd, joined) + 1, PAYROLL_MONTH_DAYS);
        isProrated = true;
      }
      const baseSalary =
        isProrated
          ? Math.round(((fullSalary * proratedDays) / PAYROLL_MONTH_DAYS) * 100) / 100
          : fullSalary;


      // "New" badge for staff who joined within the last 2 months
      const isNewJoiner = !!joined && joined <= today && differenceInMonths(today, joined) < 2;

      // Joining arrears: staff who joined in an earlier cycle that was never paid
      // still owe salary from their joining date onward.
      let joiningArrears = 0;
      let arrearsDays = 0;
      let arrearsCycleDays = 0;
      let arrearsFrom: string | undefined;
      let arrearsTo: string | undefined;
      if (joined && joined < fiscalStart && differenceInMonths(today, joined) < 4) {
        const joinCycle = getFiscalMonthRange(joined, monthStartDay);
        const cycleEnd = joinCycle.end < fiscalStart ? joinCycle.end : subDays(fiscalStart, 1);
        const cycleCalendarDays = differenceInCalendarDays(joinCycle.end, joinCycle.start) + 1;
        const cycleDays = PAYROLL_MONTH_DAYS;
        const days = Math.min(
          differenceInCalendarDays(cycleEnd, joined) + 1,
          PAYROLL_MONTH_DAYS
        );
        const joinCycleStartStr = format(joinCycle.start, "yyyy-MM-dd");
        const joinCycleEndStr = format(joinCycle.end, "yyyy-MM-dd");
        const alreadyPaid = payrollRecords?.some(
          (pr) =>
            pr.staff_id === staff.id &&
            pr.period_start <= joinCycleEndStr &&
            pr.period_end >= joinCycleStartStr
        );
        if (!alreadyPaid && days > 0 && cycleCalendarDays > 0 && days < cycleDays) {
          joiningArrears = Math.round(((fullSalary * days) / cycleDays) * 100) / 100;
          arrearsDays = days;
          arrearsCycleDays = cycleDays;

          arrearsFrom = format(joined, "yyyy-MM-dd");
          arrearsTo = format(cycleEnd, "yyyy-MM-dd");
        }
      }

      // Sum pending advances for this staff
      const pendingAdvances = advances
        .filter((a) => a.staff_id === staff.id && a.status === "pending")
        .reduce((sum, a) => sum + advanceOutstanding(a), 0);

      // Approved fines to recover from this staff member, split into the portion
      // scheduled for the active payroll month (e.g. one installment) and any
      // outstanding amounts carried over from earlier months. Installments
      // scheduled for future months are intentionally excluded.
      const outstandingOf = (f: { amount: number; recovered_amount: number | null }) =>
        Math.max(0, Number(f.amount || 0) - Number(f.recovered_amount || 0));
      const round2 = (n: number) => Math.round(n * 100) / 100;

      // Which month a fine belongs to depends on the configured allocation basis:
      // the installment schedule (payroll_month) or the date the fine was created.
      const allocationMonth = (f: { payroll_month: string; created_at: string }) =>
        (fineAllocationMode === "created_date"
          ? (f.created_at ?? "")
          : (f.payroll_month ?? "")
        ).slice(0, 7);

      const staffFines = pendingFinesList.filter(
        (f) => f.staff_id === staff.id && allocationMonth(f) <= payrollMonthKey
      );
      const dueFinesList = staffFines.filter((f) => allocationMonth(f) === payrollMonthKey);
      const overdueFinesList = staffFines.filter((f) => allocationMonth(f) < payrollMonthKey);
      const dueFines = round2(dueFinesList.reduce((sum, f) => sum + outstandingOf(f), 0));
      const overdueFines = round2(
        overdueFinesList.reduce((sum, f) => sum + outstandingOf(f), 0)
      );
      const pendingFines = round2(dueFines + overdueFines);

      // Per-installment lines so the payroll month shows exactly which
      // installment(s) it recovers.
      const fineLines: FineLine[] = [...dueFinesList, ...overdueFinesList]
        .filter((f) => outstandingOf(f) > 0)
        .sort((a, b) => allocationMonth(a).localeCompare(allocationMonth(b)))
        .map((f) => ({
          id: f.id,
          amount: outstandingOf(f),
          month: allocationMonth(f),
          isOverdue: allocationMonth(f) < payrollMonthKey,
          label:
            fineAllocationMode === "installment_date" && f.installment_count && f.installment_count > 1
              ? `Inst. ${f.installment_number ?? "?"}/${f.installment_count}`
              : f.fine_number || f.description || "Fine",
        }));

      // Check if already paid this fiscal month
      const paidRecord = payrollRecords?.find(
        (pr) =>
          pr.staff_id === staff.id &&
          pr.period_start <= fiscalStartStr &&
          pr.period_end === fiscalEndStr
      );

      const netPayable = Math.max(
        0,
        baseSalary + joiningArrears - pendingAdvances - pendingFines
      );

      return {
        staff,
        baseSalary,
        fullSalary,
        isProrated,
        proratedDays,
        fiscalDays,
        isNewJoiner,
        pendingAdvances,
        pendingFines,
        dueFines,
        overdueFines,
        fineLines,
        fineCount: staffFines.length,
        netPayable,
        isPaid: !!paidRecord,
        payrollRecordId: paidRecord?.id,
        joiningArrears,
        arrearsDays,
        arrearsCycleDays,
        arrearsFrom,
        arrearsTo,
        periodStart: joiningArrears > 0 && arrearsFrom ? arrearsFrom : fiscalStartStr,
      };
    });
  };

  const staffPayables = getStaffPayables();
  const totalBaseSalary = staffPayables.reduce((sum, sp) => sum + sp.baseSalary, 0);
  const totalPendingAdvances = staffPayables.reduce((sum, sp) => sum + sp.pendingAdvances, 0);
  const totalPendingFines = staffPayables.reduce((sum, sp) => sum + sp.pendingFines, 0);
  const totalNetPayableAll = staffPayables.reduce((sum, sp) => sum + sp.netPayable, 0); // All staff net payable
  const totalNetPayableRemaining = staffPayables.reduce((sum, sp) => sum + (sp.isPaid ? 0 : sp.netPayable), 0); // Only unpaid
  const paidCount = staffPayables.filter((sp) => sp.isPaid).length;

  // Side-by-side branch comparison groups
  const branchGroups = (() => {
    if (!compareEnabled) return [];
    const buckets = new Map<string, { id: string | null; name: string; rows: StaffPayable[] }>();
    for (const b of branches) {
      buckets.set(b.id, { id: b.id, name: b.name, rows: [] });
    }
    buckets.set("__unassigned__", { id: null, name: "Unassigned", rows: [] });
    for (const sp of staffPayables) {
      const key = sp.staff.assigned_branch_id ?? "__unassigned__";
      const bucket = buckets.get(key) ?? buckets.get("__unassigned__")!;
      bucket.rows.push(sp);
    }
    return Array.from(buckets.values())
      .filter((b) => b.rows.length > 0)
      .map((b) => ({
        ...b,
        totalBase: b.rows.reduce((s, r) => s + r.baseSalary, 0),
        totalAdvances: b.rows.reduce((s, r) => s + r.pendingAdvances, 0),
        totalFines: b.rows.reduce((s, r) => s + r.pendingFines, 0),
        totalNet: b.rows.reduce((s, r) => s + r.netPayable, 0),
        remaining: b.rows.reduce((s, r) => s + (r.isPaid ? 0 : r.netPayable), 0),
        paid: b.rows.filter((r) => r.isPaid).length,
        newJoiners: b.rows.filter((r) => r.isNewJoiner).length,
      }))
      .sort((a, b) => b.totalNet - a.totalNet);
  })();

  const maxBranchNet = Math.max(1, ...branchGroups.map((g) => g.totalNet));

  const handleMarkAsPaid = (staffPayable: StaffPayable) => {
    // Keep an unfinished flow for the same staff so re-opening the dialog resumes
    // instead of inserting a second payroll record.
    if (selectedStaff?.staff.id !== staffPayable.staff.id) resetPayFlow();
    setSelectedStaff(staffPayable);
    setPayDialogOpen(true);
  };

  const branchNameById = new Map(branches.map((b) => [b.id, b.name] as const));
  const activeBranchLabel = compareEnabled
    ? "All branches (comparison)"
    : activeBranchId
    ? branchNameById.get(activeBranchId) ?? "Selected branch"
    : "All branches";

  const handleExportPdf = async () => {
    if (staffPayables.length === 0) {
      toast.error("Nothing to export for this payroll month");
      return;
    }
    setExporting(true);
    try {
      await exportStaffPayablePdf({
        restaurantName: restaurant?.name ?? "Restaurant",
        branchLabel: activeBranchLabel,
        periodLabel: `${format(fiscalStart, "MMM d")} → ${format(fiscalEnd, "MMM d, yyyy")}`,
        periodNote: describePayrollPeriod(payrollPeriod),
        recoveryBasisLabel:
          fineAllocationMode === "created_date" ? "Fine created date" : "Installment date",
        formatCurrency,
        rows: staffPayables.map((sp) => ({
          name: sp.staff.name,
          role: sp.staff.role,
          branchName: sp.staff.assigned_branch_id
            ? branchNameById.get(sp.staff.assigned_branch_id) ?? null
            : null,
          baseSalary: sp.baseSalary,
          joiningArrears: sp.joiningArrears,
          pendingAdvances: sp.pendingAdvances,
          pendingFines: sp.pendingFines,
          netPayable: sp.netPayable,
          isPaid: sp.isPaid,
          isProrated: sp.isProrated,
          fineLines: sp.fineLines.map((f) => ({
            label: f.label,
            amount: f.amount,
            month: formatMonthLabel(f.month),
            isOverdue: f.isOverdue,
          })),
        })),
        totals: {
          baseSalary: totalBaseSalary,
          advances: totalPendingAdvances,
          fines: totalPendingFines,
          net: totalNetPayableAll,
          remaining: totalNetPayableRemaining,
          paidCount,
        },
        fileName: `payable-breakdown-${payrollMonthKey}.pdf`,
      });
      toast.success("PDF exported");
    } catch (error) {
      console.error("Payable PDF export failed", error);
      toast.error("Could not generate the PDF");
    } finally {
      setExporting(false);
    }
  };

  const confirmPayment = () => {
    if (!selectedStaff) return;
    createPayrollMutation.mutate(selectedStaff);
  };

  const isLoading = fiscalLoading || staffLoading || payrollLoading || finesLoading;

  if (isLoading) {
    return <PayableBreakdownSkeleton />;
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <CardTitle className="text-base font-medium flex flex-col items-start gap-2 sm:flex-row sm:items-center">
                <span className="flex items-center gap-2 shrink-0">
                  <Calendar className="h-5 w-5" />
                  Payable Breakdown
                </span>
                <Badge variant="secondary" className="font-normal text-[10px] sm:text-xs">
                  {payrollPeriod.cyclesBack === 0
                    ? "Current month"
                    : payrollPeriod.cyclesBack === 1
                    ? "Last completed month"
                    : `Month -${payrollPeriod.cyclesBack}`}
                </Badge>
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Payroll month: {format(fiscalStart, "MMM d")} → {format(fiscalEnd, "MMM d, yyyy")}{" "}
                <span className="text-xs">({describePayrollPeriod(payrollPeriod)})</span>
                <span className="block text-xs text-muted-foreground">
                  Period resolved {format(today, "MMM d, yyyy 'at' h:mm a")}
                </span>
                {payrollPeriod.cutoffPending && (
                  <span className="block text-xs text-muted-foreground">
                    Cut-off day {payrollCutoffDay} not reached yet — showing the prior cycle until{" "}
                    {format(payrollPeriod.cutoffDate, "MMM d")}.
                  </span>
                )}
              </CardDescription>
            </div>
            <div className="text-left sm:text-right shrink-0">
              <p className="text-xs sm:text-sm text-muted-foreground">Total Payable</p>
              <p className="text-xl sm:text-2xl font-bold text-primary">
                {formatCurrency(totalNetPayableRemaining)}
              </p>
              <p className="text-xs text-muted-foreground">
                {paidCount}/{staffPayables.length} paid
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 min-h-[44px] w-full sm:w-auto"
                onClick={handleExportPdf}
                disabled={exporting || staffPayables.length === 0}
              >
                {exporting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileDown className="mr-2 h-4 w-4" />
                )}
                Export PDF
              </Button>
            </div>
          </div>
          <div className="mt-3">
            {!compareEnabled && (
              <BranchScopeSelector
                hint="Payables below only include staff assigned to this branch"
                className="items-start"
              />
            )}
            {hasMultipleBranches && (
              <div className="mt-3 flex items-center gap-2">
                <Switch
                  id="branch-compare-mode"
                  checked={compareMode}
                  onCheckedChange={setCompareMode}
                />
                <Label
                  htmlFor="branch-compare-mode"
                  className="flex items-center gap-1.5 text-sm font-normal"
                >
                  <Columns3 className="h-4 w-4 text-muted-foreground" />
                  Compare branches side by side
                </Label>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {/* Sticky mobile summary bar: month badge + totals stay visible while scrolling */}
          <div className="md:hidden sticky top-0 z-30 -mx-6 px-6 py-2 bg-card/95 backdrop-blur border-b border-border">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
                <Badge variant="secondary" className="font-normal text-[10px]">
                  {payrollPeriod.cyclesBack === 0
                    ? "Current month"
                    : payrollPeriod.cyclesBack === 1
                    ? "Last completed month"
                    : `Month -${payrollPeriod.cyclesBack}`}
                </Badge>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[10px] text-muted-foreground">Total Payable</p>
                <p className="text-sm font-bold text-primary">
                  {formatCurrency(totalNetPayableRemaining)}
                </p>
              </div>
            </div>
            <div className="mt-1.5 grid grid-cols-4 gap-1 text-center">
              <div>
                <p className="text-[9px] text-muted-foreground">Salaries</p>
                <p className="text-xs font-semibold">{formatCurrency(totalBaseSalary)}</p>
              </div>
              <div>
                <p className="text-[9px] text-muted-foreground">Advances</p>
                <p className="text-xs font-semibold text-amber-600">
                  {formatCurrency(totalPendingAdvances)}
                </p>
              </div>
              <div>
                <p className="text-[9px] text-muted-foreground">Fines</p>
                <p className="text-xs font-semibold text-destructive">
                  {formatCurrency(totalPendingFines)}
                </p>
              </div>
              <div>
                <p className="text-[9px] text-muted-foreground">Net</p>
                <p className="text-xs font-semibold text-primary">
                  {formatCurrency(totalNetPayableAll)}
                </p>
              </div>
            </div>
          </div>

          {/* Summary Row */}
          <div className="hidden md:grid grid-cols-2 gap-4 mb-6 p-4 rounded-lg bg-muted/50 md:grid-cols-4">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Total Salaries</p>
              <p className="text-lg font-semibold">{formatCurrency(totalBaseSalary)}</p>
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground flex items-center justify-center gap-1">
                <Minus className="h-3 w-3" /> Pending Advances
              </p>
              <p className="text-lg font-semibold text-amber-600">
                {formatCurrency(totalPendingAdvances)}
              </p>
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground flex items-center justify-center gap-1">
                <Minus className="h-3 w-3" /> Fines
              </p>
              <p className="text-lg font-semibold text-destructive">
                {formatCurrency(totalPendingFines)}
              </p>
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Net Payable</p>
              <p className="text-lg font-semibold text-primary">
                {formatCurrency(totalNetPayableAll)}
              </p>
            </div>
          </div>

          {staffPayables.length === 0 ? (
            <div className="text-center py-12">
              <User className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                {activeBranchId
                  ? "No active staff assigned to this branch"
                  : "No active staff members"}
              </p>
            </div>
          ) : compareEnabled ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {branchGroups.map((group) => (
                <div
                  key={group.id ?? "unassigned"}
                  className="rounded-lg border bg-card p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{group.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {group.rows.length} staff • {group.paid}/{group.rows.length} paid
                        {group.newJoiners > 0 && ` • ${group.newJoiners} new`}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-semibold text-primary">
                        {formatCurrency(group.remaining)}
                      </p>
                      <p className="text-[11px] text-muted-foreground">remaining</p>
                    </div>
                  </div>

                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary/70"
                      style={{ width: `${(group.totalNet / maxBranchNet) * 100}%` }}
                    />
                  </div>

                  <div className="grid grid-cols-4 gap-2 text-center text-xs">
                    <div>
                      <p className="text-muted-foreground">Salaries</p>
                      <p className="font-medium">{formatCurrency(group.totalBase)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Advances</p>
                      <p className="font-medium text-amber-600">
                        {group.totalAdvances > 0 ? `-${formatCurrency(group.totalAdvances)}` : "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Fines</p>
                      <p className="font-medium text-destructive">
                        {group.totalFines > 0 ? `-${formatCurrency(group.totalFines)}` : "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Net</p>
                      <p className="font-medium text-primary">{formatCurrency(group.totalNet)}</p>
                    </div>
                  </div>

                  <div className="border-t pt-2 space-y-1.5 max-h-56 overflow-y-auto">
                    {group.rows.map((sp) => (
                      <div
                        key={sp.staff.id}
                        className={`flex items-center justify-between gap-2 text-sm ${
                          sp.isPaid ? "opacity-60" : ""
                        }`}
                      >
                        <span className="truncate flex items-center gap-1.5">
                          {sp.staff.name}
                          {sp.isNewJoiner && (
                            <Badge
                              variant="outline"
                              className="border-primary/40 bg-primary/10 text-primary text-[10px] px-1 py-0"
                            >
                              New
                            </Badge>
                          )}
                        </span>
                        <span
                          className={
                            sp.isPaid
                              ? "text-muted-foreground line-through shrink-0"
                              : "font-medium shrink-0"
                          }
                        >
                          {formatCurrency(sp.netPayable)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Staff</TableHead>
                    <TableHead className="text-right">Base Salary</TableHead>
                    <TableHead className="text-right">Pending Advances</TableHead>
                    <TableHead className="text-right">Fines</TableHead>
                    <TableHead className="text-right">Net Payable</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    {isManager && <TableHead className="w-32"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {staffPayables.map((sp) => (
                    <TableRow key={sp.staff.id} className={sp.isPaid ? "opacity-60" : ""}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
                            <User className="h-4 w-4 text-primary" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-medium">{sp.staff.name}</p>
                              {sp.isNewJoiner && (
                                <Badge
                                  variant="outline"
                                  className="gap-1 border-primary/40 bg-primary/10 text-primary text-[10px] px-1.5 py-0"
                                >
                                  <Sparkles className="h-3 w-3" />
                                  New
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground capitalize">
                              {sp.staff.role} • {sp.staff.payment_type}
                            </p>
                            {sp.staff.joined_date && sp.isNewJoiner && (
                              <p className="text-[11px] text-muted-foreground">
                                Joined {format(parseDateOnly(sp.staff.joined_date)!, "MMM d, yyyy")}
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(sp.baseSalary)}
                        {sp.isProrated && (
                          <p className="text-[11px] font-normal text-muted-foreground">
                            Pro-rated {sp.proratedDays}/{sp.fiscalDays} days of{" "}
                            {formatCurrency(sp.fullSalary)}
                          </p>
                        )}
                        {sp.joiningArrears > 0 && (
                          <p className="text-[11px] font-normal text-primary">
                            + {formatCurrency(sp.joiningArrears)} joining arrears (
                            {sp.arrearsDays}/{sp.arrearsCycleDays} days from{" "}
                            {format(parseDateOnly(sp.arrearsFrom)!, "MMM d")})
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {sp.pendingAdvances > 0 ? (
                          <span className="text-amber-600 font-medium">
                            -{formatCurrency(sp.pendingAdvances)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right align-top min-w-[10rem] sm:min-w-[13rem]">
                        {sp.pendingFines > 0 ? (
                          <div className="space-y-2">
                            <span className="text-destructive font-medium">
                              -{formatCurrency(sp.pendingFines)}
                            </span>
                            {expandedFines.has(sp.staff.id) ? (
                              <div className="space-y-1">
                                {sp.fineLines.map((line) => (
                                  <div
                                    key={line.id}
                                    className="flex flex-col items-end gap-1 text-xs leading-tight sm:flex-row sm:items-baseline sm:justify-end sm:gap-1.5"
                                  >
                                    <span className="flex items-baseline gap-1.5">
                                      <span className="text-muted-foreground">{line.label}</span>
                                      <span className="text-muted-foreground/60">·</span>
                                      <span
                                        className={
                                          line.isOverdue
                                            ? "font-medium text-amber-600"
                                            : "text-muted-foreground"
                                        }
                                      >
                                        {formatMonthLabel(line.month)}
                                      </span>
                                    </span>
                                    <span className="tabular-nums text-destructive sm:ml-1">
                                      -{formatCurrency(line.amount)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground">
                                {sp.fineLines.length} fine{sp.fineLines.length !== 1 ? "s" : ""}
                              </p>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setExpandedFines((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(sp.staff.id)) next.delete(sp.staff.id);
                                  else next.add(sp.staff.id);
                                  return next;
                                });
                              }}
                              className="inline-flex items-center gap-1 min-h-[44px] py-2 text-sm text-primary hover:underline"
                            >
                              {expandedFines.has(sp.staff.id) ? (
                                <>
                                  Hide <ChevronUp className="h-4 w-4" />
                                </>
                              ) : (
                                <>
                                  Show details <ChevronDown className="h-4 w-4" />
                                </>
                              )}
                            </button>
                            {sp.overdueFines > 0 && (
                              <p className="text-[11px] font-normal text-muted-foreground">
                                {formatCurrency(sp.dueFines)} due {payrollMonthKey}
                                {" · "}
                                {formatCurrency(sp.overdueFines)} carried over
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {sp.isPaid ? (
                          <span className="text-muted-foreground line-through">
                            {formatCurrency(sp.netPayable)}
                          </span>
                        ) : (
                          <span className="text-primary">{formatCurrency(sp.netPayable)}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {sp.isPaid ? (
                          <Badge variant="outline" className="gap-1 text-green-600 border-green-300 bg-green-50">
                            <CheckCircle className="h-3 w-3" />
                            Paid
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300 bg-amber-50">
                            <Clock className="h-3 w-3" />
                            Pending
                          </Badge>
                        )}
                      </TableCell>
                      {isManager && (
                        <TableCell>
                          {!sp.isPaid && sp.netPayable > 0 && (
                            <Button
                              size="sm"
                              onClick={() => handleMarkAsPaid(sp)}
                              disabled={createPayrollMutation.isPending}
                            >
                              <Wallet className="h-4 w-4 mr-1" />
                              Mark Paid
                            </Button>
                          )}
                          {sp.isPaid && (
                            <span className="text-xs text-muted-foreground">Completed</span>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment Confirmation Dialog */}
      <AlertDialog open={payDialogOpen} onOpenChange={setPayDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Payment</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Mark <strong>{selectedStaff?.staff.name}</strong> as paid for the current fiscal month?
                </p>
                <div className="p-3 rounded-lg bg-muted space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Base Salary:</span>
                    <span className="font-medium">
                      {formatCurrency(selectedStaff?.baseSalary || 0)}
                    </span>
                  </div>
                  {selectedStaff?.isProrated && (
                    <p className="text-xs text-muted-foreground">
                      Pro-rated from joining date — {selectedStaff.proratedDays} of{" "}
                      {selectedStaff.fiscalDays} days ({formatCurrency(selectedStaff.fullSalary)}{" "}
                      full month)
                    </p>
                  )}
                  {(selectedStaff?.joiningArrears || 0) > 0 && (
                    <div className="flex justify-between text-sm">
                      <span>
                        Joining arrears ({selectedStaff!.arrearsDays}/
                        {selectedStaff!.arrearsCycleDays} days from{" "}
                        {format(parseDateOnly(selectedStaff!.arrearsFrom)!, "MMM d")}):
                      </span>
                      <span className="font-medium">
                        {formatCurrency(selectedStaff!.joiningArrears)}
                      </span>
                    </div>
                  )}
                  {(selectedStaff?.pendingAdvances || 0) > 0 && (
                    <div className="flex justify-between text-sm text-amber-600">
                      <span>Advance Deduction:</span>
                      <span className="font-medium">
                        -{formatCurrency(selectedStaff?.pendingAdvances || 0)}
                      </span>
                    </div>
                  )}
                  {(selectedStaff?.pendingFines || 0) > 0 && (
                    <div className="flex justify-between text-sm text-destructive">
                      <span>
                        Fines ({selectedStaff!.fineCount} approved):
                      </span>
                      <span className="font-medium">
                        -{formatCurrency(selectedStaff?.pendingFines || 0)}
                      </span>
                    </div>
                  )}
                  {(selectedStaff?.overdueFines || 0) > 0 && (
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>
                        Includes {formatCurrency(selectedStaff?.dueFines || 0)} for{" "}
                        {payrollMonthKey}
                      </span>
                      <span>
                        + {formatCurrency(selectedStaff?.overdueFines || 0)} carried over
                      </span>
                    </div>
                  )}
                  {(selectedStaff?.fineLines?.length || 0) > 0 && (
                    <ul className="space-y-0.5 pl-3 text-xs text-muted-foreground">
                      {selectedStaff!.fineLines.map((line) => (
                        <li key={line.id} className="flex justify-between gap-2">
                          <span>
                            {line.label} · {formatMonthLabel(line.month)}
                            {line.isOverdue ? " (carried over)" : ""}
                          </span>
                          <span>-{formatCurrency(line.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="border-t pt-2 flex justify-between font-semibold">
                    <span>Net Payment:</span>
                    <span className="text-primary">
                      {formatCurrency(selectedStaff?.netPayable || 0)}
                    </span>
                  </div>
                </div>
                {(selectedStaff?.pendingAdvances || 0) > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Pending advances will be automatically marked as deducted.
                  </p>
                )}
                {(selectedStaff?.pendingFines || 0) > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Approved fines will be applied to this payroll and marked as recovered.
                  </p>
                )}

                {(createPayrollMutation.isPending || payAttempt > 0) && (
                  <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
                    <p className="text-xs font-medium text-foreground">
                      {createPayrollMutation.isPending
                        ? payAttempt > 0
                          ? `Retrying payment (attempt ${payAttempt + 1})…`
                          : "Recording payment…"
                        : "Payment incomplete — completed steps are kept"}
                    </p>
                    <ul className="space-y-1.5">
                      {paySteps.map((step) => (
                        <li key={step.key} className="flex items-start gap-2 text-xs">
                          {step.status === "running" ? (
                            <Loader2 className="h-3.5 w-3.5 mt-0.5 animate-spin text-primary shrink-0" />
                          ) : step.status === "done" ? (
                            <CheckCircle className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" />
                          ) : step.status === "failed" ? (
                            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-destructive shrink-0" />
                          ) : step.status === "skipped" ? (
                            <Minus className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                          ) : (
                            <Circle className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                          )}
                          <span className="flex-1 min-w-0">
                            <span
                              className={
                                step.status === "failed"
                                  ? "text-destructive font-medium"
                                  : step.status === "done"
                                    ? "text-foreground"
                                    : "text-muted-foreground"
                              }
                            >
                              {step.label}
                              {step.status === "skipped" ? " (nothing to do)" : ""}
                            </span>
                            {step.error && (
                              <span className="block break-words text-destructive/90">
                                {step.error}
                              </span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {payAttempt > 0 && !createPayrollMutation.isPending && (
                      <p className="text-xs text-muted-foreground">
                        Retrying resumes from the failed step — the payroll record and any
                        recoveries already saved are not duplicated.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={createPayrollMutation.isPending}>
              {payAttempt > 0 ? "Close" : "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmPayment();
              }}
              disabled={createPayrollMutation.isPending}
            >
              {createPayrollMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {payAttempt > 0 && !createPayrollMutation.isPending && (
                <RotateCcw className="h-4 w-4 mr-2" />
              )}
              {payAttempt > 0 ? "Retry Mark Paid" : "Confirm Payment"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
