import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PayrollDeductionsPanel } from "@/components/staff/fines/PayrollDeductionsPanel";
import { parseFineComplianceError } from "@/hooks/useEmployeeFines";
import { DeductionAllocationDialog } from "@/components/staff/fines/DeductionAllocationDialog";
import { isAllocationRequiredError, parseAllocationError } from "@/hooks/useDeductionAllocation";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { deriveAdvanceSettlement } from "@/lib/staffAdvanceSettlement";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PayrollManagerSkeleton } from "@/components/staff/StaffSkeletons";
import { PayrollScheduleRecalcDialog } from "@/components/staff/PayrollScheduleRecalcDialog";
import { Plus, Loader2, Trash2, Calendar, DollarSign, Eye, Pencil, Lock, Unlock, ShieldCheck } from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";
import { format } from "date-fns";
import { arSA, enUS } from "date-fns/locale";
import { useTranslation } from "react-i18next";

interface Staff {
  id: string;
  name: string;
  role: string;
  payment_type: string;
  hourly_rate: number;
  monthly_salary: number | null;
  assigned_branch_id?: string | null;
}

interface StaffBasic {
  id: string;
  name: string;
  role: string;
}

interface PayrollRecord {
  id: string;
  staff_id: string;
  amount: number;
  payment_date: string;
  period_start: string;
  period_end: string;
  hours_worked: number | null;
  deductions: number;
  bonus: number;
  advance_recovered?: number;
  notes: string | null;
  created_at: string;
  branch_id?: string | null;
  staff?: StaffBasic;
}

interface PendingAdvance {
  id: string;
  staff_id: string;
  amount: number;
  advance_date: string;
  repaid_amount?: number | null;
  status?: string | null;
}

export function PayrollManager() {
  const { restaurant, user, hasRole } = useAuth();
  const { format: formatCurrency } = useCurrency();
  const { activeBranchId, isAllBranches } = useBranch();
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const isManager = hasRole("owner") || hasRole("manager");
  const isOwner = hasRole("owner");
  const canAllocate = isManager || hasRole("accountant");
  const [allocationPayrollId, setAllocationPayrollId] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const highlightedPayrollId = searchParams.get("payroll");
  const highlightRef = useRef<HTMLTableRowElement | null>(null);

  useEffect(() => {
    if (highlightedPayrollId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightedPayrollId]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [recordToDelete, setRecordToDelete] = useState<PayrollRecord | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<PayrollRecord | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  // Pay period filter (YYYY-MM-DD)
  const monthStart = new Date();
  const defaultStart = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1)
    .toISOString()
    .split("T")[0];
  const defaultEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0)
    .toISOString()
    .split("T")[0];
  const [periodStart, setPeriodStart] = useState<string>("");
  const [periodEnd, setPeriodEnd] = useState<string>("");
  const [lockNotes, setLockNotes] = useState("");
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);

  const [formData, setFormData] = useState({
    staff_id: "",
    amount: "",
    payment_date: new Date().toISOString().split("T")[0],
    period_start: "",
    period_end: "",
    hours_worked: "",
    deductions: "",
    bonus: "",
    advance_recovered: "",
    notes: "",
  });

  const { data: staffList } = useQuery({
    queryKey: ["staff-active", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await supabase
        .from("staff")
        .select("id, name, role, payment_type, hourly_rate, monthly_salary, assigned_branch_id")
        .eq("restaurant_id", restaurant.id)
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      return data as Staff[];
    },
    enabled: !!restaurant?.id,
  });

  const { data: payrollRecords, isLoading } = useQuery({
    // NOTE: key is versioned so persisted (localStorage) caches from older
    // app versions — which lacked the embedded staff relation and period
    // columns, rendering rows as "Unknown / - - -" — are never reused.
    queryKey: ["payroll", "v2", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await supabase
        .from("payroll_records")
        .select("*, staff:staff_id(id, name, role, assigned_branch_id, is_active)")
        .eq("restaurant_id", restaurant.id)
        .order("payment_date", { ascending: false });

      if (error) throw error;
      return data as PayrollRecord[];
    },
    enabled: !!restaurant?.id,
    staleTime: 0,
  });

  // Pending employee advances (asset 1150) available for recovery from salary
  const { data: pendingAdvances } = useQuery({
    queryKey: ["pending-advances", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await supabase
        .from("staff_advances")
        .select("id, staff_id, amount, advance_date, repaid_amount, status, ledger_reversed")
        .eq("restaurant_id", restaurant.id)
        .eq("status", "pending")
        .order("advance_date");
      if (error) throw error;
      return data as PendingAdvance[];
    },
    enabled: !!restaurant?.id,
  });

  const advancesForStaff = (staffId: string) =>
    (pendingAdvances || []).filter(
      (a) => a.staff_id === staffId && deriveAdvanceSettlement(a).outstanding > 0
    );

  const pendingAdvanceTotal = (staffId: string) =>
    advancesForStaff(staffId).reduce((sum, a) => sum + deriveAdvanceSettlement(a).outstanding, 0);

  const scopedStaffList = (staffList || []).filter((s) => {
    if (isAllBranches || !activeBranchId) return true;
    return !s.assigned_branch_id || s.assigned_branch_id === activeBranchId;
  });
  const scopedPayrollRecords: PayrollRecord[] = (payrollRecords || []).filter((r) => {
    // Only payments belonging to currently active staff
    if ((r.staff as any)?.is_active === false) return false;
    // Pay period filter: keep records whose period overlaps the selected range
    if (periodStart && r.period_end && r.period_end < periodStart) return false;
    if (periodEnd && r.period_start && r.period_start > periodEnd) return false;
    if (isAllBranches || !activeBranchId) return true;
    const rb = r.branch_id ?? (r.staff as any)?.assigned_branch_id ?? null;
    return !rb || rb === activeBranchId;
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      if (!restaurant?.id || !user?.id) throw new Error("No restaurant or user");
      const gross = parseFloat(data.amount) || 0;
      const recovered = Math.min(parseFloat(data.advance_recovered) || 0, gross);
      const { data: inserted, error } = await supabase.from("payroll_records").insert({
        restaurant_id: restaurant.id,
        staff_id: data.staff_id,
        amount: gross,
        advance_recovered: recovered,
        payment_date: data.payment_date,
        period_start: data.period_start,
        period_end: data.period_end,
        hours_worked: data.hours_worked ? parseFloat(data.hours_worked) : null,
        deductions: parseFloat(data.deductions) || 0,
        bonus: parseFloat(data.bonus) || 0,
        notes: data.notes || null,
        created_by: user.id,
      }).select("id").single();
      if (error) throw error;

      // Pull approved fines for this period into the payroll record.
      // The database enforces the maximum wage-deduction percentage.
      const { error: fineError } = await supabase.rpc("apply_fines_to_payroll", {
        p_payroll_id: inserted.id,
      });
      if (fineError) {
        if (isAllocationRequiredError(fineError.message)) {
          // Do not silently reduce anything — ask an authorized user to allocate.
          return { id: inserted.id as string, requiresAllocation: true, message: fineError.message };
        }
        throw fineError;
      }

      // Settle pending advances (oldest first) against the recovered amount.
      let remaining = recovered;
      for (const adv of advancesForStaff(data.staff_id)) {
        if (remaining < Number(adv.amount)) break;
        const { error: advError } = await supabase.rpc("deduct_advance_from_payroll", {
          p_advance_id: adv.id,
          p_payroll_id: inserted.id,
        });
        if (advError) {
          console.error("Failed to settle advance", adv.id, advError);
          break;
        }
        remaining -= Number(adv.amount);
      }
      return { id: inserted.id as string, requiresAllocation: false };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["payroll"] });
      queryClient.invalidateQueries({ queryKey: ["pending-advances"] });
      queryClient.invalidateQueries({ queryKey: ["staff-advances"] });
      queryClient.invalidateQueries({ queryKey: ["employee-fines"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-approved-fines"] });
      if (result?.requiresAllocation) {
        toast.warning("Deduction limit exceeded", {
          description: parseAllocationError(result.message ?? ""),
        });
        setAllocationPayrollId(result.id);
      } else {
        toast.success("Payroll record added");
      }
      resetForm();
      setDialogOpen(false);
    },
    onError: (error: Error) => {
      toast.error("Failed to add payroll record", {
        description: parseFineComplianceError(error.message),
      });
      console.error(error);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: typeof formData & { id: string }) => {
      const { error } = await supabase
        .from("payroll_records")
        .update({
          staff_id: data.staff_id,
          amount: parseFloat(data.amount) || 0,
          advance_recovered: parseFloat(data.advance_recovered) || 0,
          payment_date: data.payment_date,
          period_start: data.period_start,
          period_end: data.period_end,
          hours_worked: data.hours_worked ? parseFloat(data.hours_worked) : null,
          deductions: parseFloat(data.deductions) || 0,
          bonus: parseFloat(data.bonus) || 0,
          notes: data.notes || null,
        })
        .eq("id", data.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll"] });
      toast.success("Payroll record updated");
      setViewDialogOpen(false);
      setIsEditing(false);
      setSelectedRecord(null);
    },
    onError: (error) => {
      toast.error("Failed to update payroll record");
      console.error(error);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("payroll_records").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll"] });
      toast.success("Payroll record deleted");
      setDeleteDialogOpen(false);
      setRecordToDelete(null);
    },
    onError: (error) => {
      toast.error("Failed to delete payroll record");
      console.error(error);
    },
  });

  const resetForm = () => {
    setFormData({
      staff_id: "",
      amount: "",
      payment_date: new Date().toISOString().split("T")[0],
      period_start: "",
      period_end: "",
      hours_worked: "",
      deductions: "",
      bonus: "",
      advance_recovered: "",
      notes: "",
    });
  };

  const handleStaffSelect = (staffId: string) => {
    const staff = staffList?.find((s) => s.id === staffId);
    if (staff) {
      const suggestedAmount =
        staff.payment_type === "monthly"
          ? staff.monthly_salary?.toString() || ""
          : "";
      const gross = parseFloat(suggestedAmount) || 0;
      const advance = pendingAdvanceTotal(staffId);
      setFormData({
        ...formData,
        staff_id: staffId,
        amount: suggestedAmount,
        advance_recovered: advance > 0 ? String(gross > 0 ? Math.min(advance, gross) : advance) : "",
      });
    }
  };

  const handleViewRecord = (record: PayrollRecord) => {
    setSelectedRecord(record);
    setFormData({
      staff_id: record.staff_id,
      amount: record.amount.toString(),
      payment_date: record.payment_date,
      period_start: record.period_start,
      period_end: record.period_end,
      hours_worked: record.hours_worked?.toString() || "",
      deductions: record.deductions.toString(),
      bonus: record.bonus.toString(),
      advance_recovered: (record.advance_recovered ?? 0).toString(),
      notes: record.notes || "",
    });
    setIsEditing(false);
    setViewDialogOpen(true);
  };

  const handleUpdateSubmit = () => {
    if (!selectedRecord) return;
    if (!formData.staff_id) {
      toast.error("Please select a staff member");
      return;
    }
    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }
    if (!formData.period_start || !formData.period_end) {
      toast.error("Please enter the payment period");
      return;
    }
    updateMutation.mutate({ ...formData, id: selectedRecord.id });
  };

  const handleSubmit = () => {
    if (!formData.staff_id) {
      toast.error("Please select a staff member");
      return;
    }
    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }
    if (!formData.period_start || !formData.period_end) {
      toast.error("Please enter the payment period");
      return;
    }
    createMutation.mutate(formData);
  };

  // Helper to safely format dates
  const safeFormatDate = (dateStr: string | null | undefined, formatStr: string) => {
    if (!dateStr) return "-";
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "-";
    return format(date, formatStr, { locale: i18n.language === "ar" ? arSA : enUS });
  };

  // Calculate totals
  const totalPaidThisMonth = scopedPayrollRecords
    .filter((r) => {
      if (!r.payment_date) return false;
      const paymentDate = new Date(r.payment_date);
      if (isNaN(paymentDate.getTime())) return false;
      const now = new Date();
      return (
        paymentDate.getMonth() === now.getMonth() &&
        paymentDate.getFullYear() === now.getFullYear()
      );
    })
    .reduce((sum, r) => sum + r.amount, 0);

  // ---- Payroll period approval / lock ----
  const lockBranchId = isAllBranches ? null : activeBranchId ?? null;

  const { data: periodLocks } = useQuery({
    queryKey: ["payroll-period-locks", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await supabase
        .from("payroll_period_locks" as any)
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .eq("status", "locked")
        .order("period_start", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: !!restaurant?.id,
  });

  const activePeriodLock =
    periodStart && periodEnd
      ? (periodLocks || []).find(
          (l) =>
            (l.branch_id === null || l.branch_id === lockBranchId) &&
            periodStart >= l.period_start &&
            periodEnd <= l.period_end
        )
      : undefined;
  const isPeriodLocked = !!activePeriodLock;

  const recordIsLocked = (r: PayrollRecord) =>
    (periodLocks || []).some(
      (l) =>
        (l.branch_id === null || l.branch_id === (r.branch_id ?? null)) &&
        r.period_start >= l.period_start &&
        r.period_end <= l.period_end
    );

  const approvePeriodMutation = useMutation({
    mutationFn: async () => {
      if (!restaurant?.id || !user?.id) throw new Error("No restaurant or user");
      if (!periodStart || !periodEnd) throw new Error("Select a pay period first");
      const { error } = await supabase.from("payroll_period_locks" as any).insert({
        restaurant_id: restaurant.id,
        branch_id: lockBranchId,
        period_start: periodStart,
        period_end: periodEnd,
        status: "locked",
        notes: lockNotes.trim() || null,
        approved_by: user.id,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-period-locks"] });
      toast.success("Pay period approved and locked");
      setApproveDialogOpen(false);
      setLockNotes("");
    },
    onError: (e: any) => toast.error(e?.message || "Failed to approve pay period"),
  });

  const unlockPeriodMutation = useMutation({
    mutationFn: async (lockId: string) => {
      const { error } = await supabase
        .from("payroll_period_locks" as any)
        .delete()
        .eq("id", lockId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-period-locks"] });
      toast.success("Pay period unlocked");
    },
    onError: (e: any) => toast.error(e?.message || "Failed to unlock pay period"),
  });

  // Breakdown by pay type for active staff in the selected branch + period
  const staffById = new Map((staffList || []).map((s) => [s.id, s]));
  const payTypeBreakdown = (() => {
    const groups = new Map<
      string,
      { total: number; bonus: number; deductions: number; records: number; staff: Set<string> }
    >();
    for (const r of scopedPayrollRecords) {
      const type = staffById.get(r.staff_id)?.payment_type || "other";
      const g =
        groups.get(type) ||
        { total: 0, bonus: 0, deductions: 0, records: 0, staff: new Set<string>() };
      g.total += Number(r.amount || 0);
      g.bonus += Number(r.bonus || 0);
      g.deductions += Number(r.deductions || 0);
      g.records += 1;
      g.staff.add(r.staff_id);
      groups.set(type, g);
    }
    return Array.from(groups.entries())
      .map(([type, g]) => ({ type, ...g, staffCount: g.staff.size }))
      .sort((a, b) => b.total - a.total);
  })();
  const breakdownTotal = payTypeBreakdown.reduce((s, g) => s + g.total, 0);
  const payTypeLabel = (type: string) =>
    type === "monthly" ? t("app.staff.payroll.monthlySalary") : type === "hourly" ? t("app.staff.payroll.hourly") : type === "daily" ? t("app.staff.payroll.daily") : t("app.staff.payroll.other");

  if (isLoading) {
    return <PayrollManagerSkeleton />;
  }

  return (
    <>
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-primary/10">
                <DollarSign className="h-5 w-5 text-primary" />
              </div>
              <div>
                 <p className="text-sm text-muted-foreground">{t("app.staff.payroll.paidThisMonth")}</p>
                <p className="text-2xl font-semibold">{formatCurrency(totalPaidThisMonth)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-green-500/10">
                <Calendar className="h-5 w-5 text-green-600" />
              </div>
              <div>
                 <p className="text-sm text-muted-foreground">{t("app.staff.payroll.totalRecords")}</p>
                <p className="text-2xl font-semibold">{scopedPayrollRecords.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pb-3">
          <div>
             <CardTitle className="text-base font-medium">{t("app.staff.payroll.records")}</CardTitle>
             <CardDescription>{t("app.staff.payroll.description")}</CardDescription>
            {payTypeBreakdown.length > 0 && (
              <div className="mt-3 rounded-lg border bg-muted/30 p-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">
                   {t("app.staff.payroll.breakdown", { total: formatCurrency(breakdownTotal) })}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {payTypeBreakdown.map((g) => (
                    <div key={g.type} className="rounded-md border bg-background p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{payTypeLabel(g.type)}</span>
                        <span className="text-sm font-semibold">{formatCurrency(g.total)}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1">
                         {t("app.staff.payroll.breakdownCounts", { staff: g.staffCount, records: g.records })}
                        {breakdownTotal > 0
                          ? ` · ${Math.round((g.total / breakdownTotal) * 100)}%`
                          : ""}
                      </p>
                      {(g.bonus > 0 || g.deductions > 0) && (
                        <p className="text-[11px] text-muted-foreground">
                           {t("app.staff.payroll.bonus")} {formatCurrency(g.bonus)} · {t("app.staff.payroll.deductions")} {formatCurrency(g.deductions)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-end gap-2 mt-3">
              <div className="space-y-1">
                 <Label className="text-xs text-muted-foreground">{t("app.staff.payroll.periodFrom")}</Label>
                <Input
                  type="date"
                  className="h-8 w-[150px]"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                 <Label className="text-xs text-muted-foreground">{t("app.staff.payroll.periodTo")}</Label>
                <Input
                  type="date"
                  className="h-8 w-[150px]"
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => {
                  setPeriodStart(defaultStart);
                  setPeriodEnd(defaultEnd);
                }}
              >
                 {t("app.staff.payroll.thisMonth")}
              </Button>
              {(periodStart || periodEnd) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8"
                  onClick={() => {
                    setPeriodStart("");
                    setPeriodEnd("");
                  }}
                >
                   {t("common.clear")}
                </Button>
              )}
            </div>
            {isManager && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {isPeriodLocked ? (
                  <>
                    <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-600">
                      <Lock className="h-3 w-3" />
                       {t("app.staff.payroll.locked")} {activePeriodLock?.period_start} → {activePeriodLock?.period_end}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                       {t("app.staff.payroll.approved")} {activePeriodLock?.approved_at ? safeFormatDate(activePeriodLock.approved_at, "MMM d, yyyy") : ""}
                      {activePeriodLock?.notes ? ` · ${activePeriodLock.notes}` : ""}
                    </span>
                    {isOwner && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8"
                        disabled={unlockPeriodMutation.isPending}
                        onClick={() => unlockPeriodMutation.mutate(activePeriodLock!.id)}
                      >
                         <Unlock className="h-3.5 w-3.5 me-1" />
                         {t("app.staff.payroll.unlock")}
                      </Button>
                    )}
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={!periodStart || !periodEnd}
                    onClick={() => setApproveDialogOpen(true)}
                  >
                     <ShieldCheck className="h-3.5 w-3.5 me-1" />
                     {t("app.staff.payroll.approveLock")}
                  </Button>
                )}
                {(!periodStart || !periodEnd) && !isPeriodLocked && (
                  <span className="text-xs text-muted-foreground">
                     {t("app.staff.payroll.selectPeriodHelp")}
                  </span>
                )}
              </div>
            )}
          </div>
          {isManager && (
            <div className="flex flex-wrap items-center gap-2">
              <PayrollScheduleRecalcDialog disabled={isPeriodLocked} />
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={resetForm} disabled={isPeriodLocked}>
                   <Plus className="h-4 w-4 me-2" />
                   {t("app.staff.payroll.addPayment")}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                   <DialogTitle>{t("app.staff.payroll.recordPayment")}</DialogTitle>
                   <DialogDescription>{t("app.staff.payroll.recordPaymentDescription")}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
                  <div className="space-y-2">
                     <Label>{t("app.staff.payroll.staffMember")} *</Label>
                    <Select value={formData.staff_id} onValueChange={handleStaffSelect}>
                      <SelectTrigger>
                         <SelectValue placeholder={t("app.staff.payroll.selectStaff")} />
                      </SelectTrigger>
                      <SelectContent>
                        {scopedStaffList.map((staff) => (
                          <SelectItem key={staff.id} value={staff.id}>
                            {staff.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                       <Label htmlFor="period_start">{t("app.staff.payroll.periodStart")} *</Label>
                      <Input
                        id="period_start"
                        type="date"
                        value={formData.period_start}
                        onChange={(e) => setFormData({ ...formData, period_start: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                       <Label htmlFor="period_end">{t("app.staff.payroll.periodEnd")} *</Label>
                      <Input
                        id="period_end"
                        type="date"
                        value={formData.period_end}
                        onChange={(e) => setFormData({ ...formData, period_end: e.target.value })}
                      />
                    </div>
                  </div>
                  {formData.period_start && formData.period_end && (
                    <p className="text-sm text-muted-foreground">
                      {(() => {
                        const start = new Date(formData.period_start);
                        const end = new Date(formData.period_end);
                        if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
                        const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                         return days > 0 ? t("app.staff.summary.days", { count: days }) : null;
                      })()}
                    </p>
                  )}
                  <div className="space-y-2">
                     <Label htmlFor="amount">{t("common.amount")} *</Label>
                    <Input
                      id="amount"
                      type="number"
                      placeholder="0.00"
                      value={formData.amount}
                      onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                     <Label htmlFor="hours_worked">{t("app.staff.payroll.hoursWorked")}</Label>
                    <Input
                      id="hours_worked"
                      type="number"
                      placeholder="0"
                      value={formData.hours_worked}
                      onChange={(e) => setFormData({ ...formData, hours_worked: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                       <Label htmlFor="bonus">{t("app.staff.payroll.bonus")}</Label>
                      <Input
                        id="bonus"
                        type="number"
                        placeholder="0.00"
                        value={formData.bonus}
                        onChange={(e) => setFormData({ ...formData, bonus: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                       <Label htmlFor="deductions">{t("app.staff.payroll.deductions")}</Label>
                      <Input
                        id="deductions"
                        type="number"
                        placeholder="0.00"
                        value={formData.deductions}
                        onChange={(e) => setFormData({ ...formData, deductions: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                     <Label htmlFor="payment_date">{t("app.staff.payroll.paymentDate")}</Label>
                    <Input
                      id="payment_date"
                      type="date"
                      value={formData.payment_date}
                      onChange={(e) => setFormData({ ...formData, payment_date: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                     <Label htmlFor="advance_recovered">{t("app.staff.payroll.advanceRecovered")}</Label>
                    <Input
                      id="advance_recovered"
                      type="number"
                      placeholder="0.00"
                      value={formData.advance_recovered}
                      onChange={(e) => setFormData({ ...formData, advance_recovered: e.target.value })}
                    />
                    {formData.staff_id && (
                      <p className="text-xs text-muted-foreground">
                         {t("app.staff.payroll.pendingAdvances")}: {formatCurrency(pendingAdvanceTotal(formData.staff_id))}
                      </p>
                    )}
                  </div>
                  {(() => {
                    const gross = parseFloat(formData.amount) || 0;
                    const recovered = Math.min(parseFloat(formData.advance_recovered) || 0, gross);
                    if (gross <= 0) return null;
                    return (
                      <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Salary expense (full gross)</span>
                          <span className="font-medium">{formatCurrency(gross)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Less: advance recovered</span>
                          <span className="font-medium">-{formatCurrency(recovered)}</span>
                        </div>
                        <div className="flex justify-between border-t pt-1">
                          <span className="text-muted-foreground">Net cash to employee</span>
                          <span className="font-medium">{formatCurrency(gross - recovered)}</span>
                        </div>
                        <p className="pt-1 text-xs text-muted-foreground">
                          Ledger: DR Wages {formatCurrency(gross)} · CR 1150 Advance to Employees Against Salary{" "}
                          {formatCurrency(recovered)} ·
                          CR Cash {formatCurrency(gross - recovered)}
                        </p>
                      </div>
                    );
                  })()}
                  <PayrollDeductionsPanel
                    staffId={formData.staff_id}
                    periodStart={formData.period_start}
                    periodEnd={formData.period_end}
                    grossWage={parseFloat(formData.amount) || 0}
                    otherDeductions={parseFloat(formData.deductions) || 0}
                    advanceRecovered={parseFloat(formData.advance_recovered) || 0}
                  />
                  <div className="space-y-2">
                     <Label htmlFor="notes">{t("app.staff.fields.notes")}</Label>
                    <Input
                      id="notes"
                       placeholder={t("app.staff.fields.notesPlaceholder")}
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDialogOpen(false)}>
                     {t("common.cancel")}
                  </Button>
                  <Button onClick={handleSubmit} disabled={createMutation.isPending}>
                    {createMutation.isPending && (
                       <Loader2 className="h-4 w-4 me-2 animate-spin" />
                    )}
                     {t("app.staff.payroll.addPayment")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {scopedPayrollRecords.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <DollarSign className="h-10 w-10 text-muted-foreground mb-3" />
               <p className="text-muted-foreground">{t("app.staff.payroll.empty")}</p>
              <p className="text-sm text-muted-foreground">
                 {t("app.staff.payroll.emptyHelp")}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                   <TableHead>{t("app.staff.tabs.staff")}</TableHead>
                   <TableHead>{t("app.staff.payroll.period")}</TableHead>
                   <TableHead>{t("common.amount")}</TableHead>
                   <TableHead>{t("app.staff.payroll.hours")}</TableHead>
                   <TableHead>{t("app.staff.payroll.paymentDate")}</TableHead>
                  {isOwner && <TableHead className="w-10"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {scopedPayrollRecords.map((record) => (
                  <TableRow
                    key={record.id}
                    ref={record.id === highlightedPayrollId ? highlightRef : undefined}
                    className={
                      record.id === highlightedPayrollId
                        ? "bg-primary/5 ring-1 ring-primary/40"
                        : undefined
                    }
                  >
                    <TableCell>
                      <div>
                         <p className="font-medium">{(record.staff as any)?.name || t("app.staff.roles.unknown")}</p>
                        <Badge variant="outline" className="text-xs">
                          {(record.staff as any)?.role}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {safeFormatDate(record.period_start, "MMM d")} -{" "}
                      {safeFormatDate(record.period_end, "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{formatCurrency(record.amount)}</p>
                        {(record.bonus > 0 || record.deductions > 0) && (
                          <p className="text-xs text-muted-foreground">
                            {record.bonus > 0 && (
                              <span className="text-green-600">+{formatCurrency(record.bonus)}</span>
                            )}
                            {record.bonus > 0 && record.deductions > 0 && " / "}
                            {record.deductions > 0 && (
                              <span className="text-destructive">-{formatCurrency(record.deductions)}</span>
                            )}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {record.hours_worked || "-"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {safeFormatDate(record.payment_date, "MMM d, yyyy")}
                    </TableCell>
                    {isOwner && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleViewRecord(record)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            disabled={recordIsLocked(record)}
                            title={recordIsLocked(record) ? "Pay period is locked" : "Delete"}
                            onClick={() => {
                              setRecordToDelete(record);
                              setDeleteDialogOpen(true);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Payroll Record</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this payroll record? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => recordToDelete && deleteMutation.mutate(recordToDelete.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* View/Edit Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setViewDialogOpen(false);
          setIsEditing(false);
          setSelectedRecord(null);
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit Payment" : "Payment Details"}</DialogTitle>
            <DialogDescription>
              {isEditing ? "Update payroll record" : `Payment for ${(selectedRecord?.staff as any)?.name || "Staff"}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
            {isEditing ? (
              <>
                <div className="space-y-2">
                  <Label>Staff Member *</Label>
                  <Select value={formData.staff_id} onValueChange={(val) => setFormData({ ...formData, staff_id: val })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select staff" />
                    </SelectTrigger>
                    <SelectContent>
                      {scopedStaffList.map((staff) => (
                        <SelectItem key={staff.id} value={staff.id}>
                          {staff.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit_period_start">Period Start *</Label>
                    <Input
                      id="edit_period_start"
                      type="date"
                      value={formData.period_start}
                      onChange={(e) => setFormData({ ...formData, period_start: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit_period_end">Period End *</Label>
                    <Input
                      id="edit_period_end"
                      type="date"
                      value={formData.period_end}
                      onChange={(e) => setFormData({ ...formData, period_end: e.target.value })}
                    />
                  </div>
                </div>
                {formData.period_start && formData.period_end && (
                  <p className="text-sm text-muted-foreground">
                    {(() => {
                      const start = new Date(formData.period_start);
                      const end = new Date(formData.period_end);
                      if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
                      const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                      return days > 0 ? `${days} day${days !== 1 ? 's' : ''}` : null;
                    })()}
                  </p>
                )}
                <div className="space-y-2">
                  <Label htmlFor="edit_amount">Amount *</Label>
                  <Input
                    id="edit_amount"
                    type="number"
                    placeholder="0.00"
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit_hours_worked">Hours Worked (optional)</Label>
                  <Input
                    id="edit_hours_worked"
                    type="number"
                    placeholder="0"
                    value={formData.hours_worked}
                    onChange={(e) => setFormData({ ...formData, hours_worked: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit_advance_recovered">Advance Recovered</Label>
                  <Input
                    id="edit_advance_recovered"
                    type="number"
                    placeholder="0.00"
                    value={formData.advance_recovered}
                    onChange={(e) => setFormData({ ...formData, advance_recovered: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Net cash paid:{" "}
                    {formatCurrency(
                      Math.max((parseFloat(formData.amount) || 0) - (parseFloat(formData.advance_recovered) || 0), 0)
                    )}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit_bonus">Bonus</Label>
                    <Input
                      id="edit_bonus"
                      type="number"
                      placeholder="0.00"
                      value={formData.bonus}
                      onChange={(e) => setFormData({ ...formData, bonus: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit_deductions">Deductions</Label>
                    <Input
                      id="edit_deductions"
                      type="number"
                      placeholder="0.00"
                      value={formData.deductions}
                      onChange={(e) => setFormData({ ...formData, deductions: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit_payment_date">Payment Date</Label>
                  <Input
                    id="edit_payment_date"
                    type="date"
                    value={formData.payment_date}
                    onChange={(e) => setFormData({ ...formData, payment_date: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit_notes">Notes</Label>
                  <Input
                    id="edit_notes"
                    placeholder="Additional notes"
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  />
                </div>
              </>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Staff Member</p>
                    <p className="font-medium">{(selectedRecord?.staff as any)?.name || "-"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Role</p>
                    <Badge variant="outline">{(selectedRecord?.staff as any)?.role || "-"}</Badge>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Period Start</p>
                    <p className="font-medium">{safeFormatDate(selectedRecord?.period_start, "MMM d, yyyy")}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Period End</p>
                    <p className="font-medium">{safeFormatDate(selectedRecord?.period_end, "MMM d, yyyy")}</p>
                  </div>
                </div>
                {selectedRecord?.period_start && selectedRecord?.period_end && (
                  <div>
                    <p className="text-sm text-muted-foreground">Duration</p>
                    <p className="font-medium">
                      {(() => {
                        const start = new Date(selectedRecord.period_start);
                        const end = new Date(selectedRecord.period_end);
                        if (isNaN(start.getTime()) || isNaN(end.getTime())) return "-";
                        const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                        return days > 0 ? `${days} day${days !== 1 ? 's' : ''}` : "-";
                      })()}
                    </p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Amount</p>
                    <p className="font-medium text-lg">{formatCurrency(selectedRecord?.amount || 0)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Payment Date</p>
                    <p className="font-medium">{safeFormatDate(selectedRecord?.payment_date, "MMM d, yyyy")}</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Hours</p>
                    <p className="font-medium">{selectedRecord?.hours_worked || "-"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Bonus</p>
                    <p className="font-medium text-green-600">{formatCurrency(selectedRecord?.bonus || 0)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Deductions</p>
                    <p className="font-medium text-destructive">{formatCurrency(selectedRecord?.deductions || 0)}</p>
                  </div>
                </div>
                {selectedRecord?.notes && (
                  <div>
                    <p className="text-sm text-muted-foreground">Notes</p>
                    <p className="font-medium">{selectedRecord.notes}</p>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            {isEditing ? (
              <>
                <Button variant="outline" onClick={() => setIsEditing(false)}>
                  Cancel
                </Button>
                <Button onClick={handleUpdateSubmit} disabled={updateMutation.isPending}>
                  {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Save Changes
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setViewDialogOpen(false)}>
                  Close
                </Button>
                {isManager && (
                  <Button
                    onClick={() => setIsEditing(true)}
                    disabled={!!selectedRecord && recordIsLocked(selectedRecord)}
                  >
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit
                  </Button>
                )}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approve & lock pay period */}
      <Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Approve pay period</DialogTitle>
            <DialogDescription>
              Locking {periodStart} → {periodEnd}
              {lockBranchId ? " for the selected branch" : " for all branches"}. Payroll records in
              this period can no longer be added, edited, or deleted.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>Approval note (optional)</Label>
            <Input
              value={lockNotes}
              onChange={(e) => setLockNotes(e.target.value)}
              placeholder="e.g. Reviewed against attendance sheet"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => approvePeriodMutation.mutate()}
              disabled={approvePeriodMutation.isPending}
            >
              {approvePeriodMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              <Lock className="h-4 w-4 mr-2" />
              Approve &amp; lock
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeductionAllocationDialog
        payrollId={allocationPayrollId}
        open={!!allocationPayrollId}
        onOpenChange={(o) => !o && setAllocationPayrollId(null)}
        canAllocate={canAllocate}
        onAllocated={() => {
          queryClient.invalidateQueries({ queryKey: ["payroll"] });
          queryClient.invalidateQueries({ queryKey: ["employee-fines"] });
        }}
      />
    </>
  );
}
