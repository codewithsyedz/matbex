import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { format, startOfMonth } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { Loader2, Plus, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { CalendarClock } from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";
import { buildFineInstallmentSchedule } from "@/lib/fineInstallments";
import { uploadFineEvidenceFile } from "@/hooks/useFineEvidence";
import {
  useEmployeeFines,
  useFineCapacity,
  useViolationTypes,
} from "@/hooks/useEmployeeFines";
import { FineCapacityPanel } from "./FineCapacityPanel";

interface StaffRow {
  id: string;
  name: string;
  role: string;
  branch_id: string | null;
}

export function CreateFineDialog() {
  const { restaurant } = useAuth();
  const { activeBranchId } = useBranch();
  const { violationTypes } = useViolationTypes();
  const { createFine, changeStatus } = useEmployeeFines();
  const { format: fmt } = useCurrency();

  const [open, setOpen] = useState(false);
  const [staffId, setStaffId] = useState("");
  const [violationTypeId, setViolationTypeId] = useState("");
  const [violationDate, setViolationDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [payrollMonth, setPayrollMonth] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [attendanceRef, setAttendanceRef] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [splitEnabled, setSplitEnabled] = useState(true);

  const { data: staffList = [] } = useQuery({
    queryKey: ["staff-for-fines", restaurant?.id, activeBranchId],
    queryFn: async () => {
      let q = db
        .from("staff")
        .select("id,name,role,branch_id")
        .eq("restaurant_id", restaurant!.id)
        .eq("is_active", true)
        .order("name");
      const { data, error } = await q;
      if (error) throw error;
      return data as StaffRow[];
    },
    enabled: !!restaurant?.id && open,
  });

  const { data: capacity } = useFineCapacity(staffId || null, payrollMonth);
  const numericAmount = Number(amount) || 0;
  const selectedStaff = staffList.find((s) => s.id === staffId);
  const selectedType = violationTypes.find((t) => t.id === violationTypeId);
  const evidenceRequired = !!selectedType?.requires_evidence;
  const evidenceMissing = evidenceRequired && files.length === 0;

  const blocked = useMemo(() => {
    if (!capacity) return false;
    const perViolation = Number(capacity.max_fine_per_violation) || 0;
    const limit = Number(capacity.monthly_fine_limit) || 0;
    if (perViolation > 0 && numericAmount > perViolation) return true;
    if (limit > 0 && numericAmount > Number(capacity.remaining_fine_capacity)) return true;
    return false;
  }, [capacity, numericAmount]);

  /** Spread the fine over the coming salary months when it exceeds this month's legal cap. */
  const schedule = useMemo(() => {
    if (!capacity || numericAmount <= 0) return [];
    return buildFineInstallmentSchedule({
      totalAmount: numericAmount,
      startMonth: payrollMonth,
      firstMonthCapacity: Number(capacity.remaining_fine_capacity) || 0,
      monthlyLimit: Number(capacity.monthly_fine_limit) || 0,
      maxPerViolation: Number(capacity.max_fine_per_violation) || 0,
    });
  }, [capacity, numericAmount, payrollMonth]);

  const needsSplit = blocked && schedule.length > 1;
  const willSplit = needsSplit && splitEnabled;

  const reset = () => {
    setStaffId("");
    setViolationTypeId("");
    setAmount("");
    setDescription("");
    setAttendanceRef("");
    setFiles([]);
    setSplitEnabled(true);
  };

  const handleSubmit = async (submitForApproval: boolean) => {
    if (!staffId || !violationTypeId || numericAmount <= 0) {
      toast.error("Employee, violation type and amount are required");
      return;
    }
    if (submitForApproval && evidenceMissing) {
      toast.error("Evidence required", {
        description: "This violation type requires at least one supporting attachment.",
      });
      return;
    }
    if (blocked && !willSplit) {
      toast.error("Fine exceeds the monthly deduction limit", {
        description: "Enable installment spreading or reduce the amount.",
      });
      return;
    }

    try {
      const plan = willSplit
        ? schedule
        : [{ installment_number: 1, payroll_month: payrollMonth, amount: numericAmount }];
      const groupId = willSplit ? crypto.randomUUID() : null;

      // Always create as draft first so evidence can be attached before the
      // database evidence-requirement check runs on submission.
      const created: { id: string }[] = [];
      for (const part of plan) {
        const row = await createFine.mutateAsync({
          staff_id: staffId,
          branch_id: selectedStaff?.branch_id ?? activeBranchId,
          violation_type_id: violationTypeId,
          violation_date: violationDate,
          payroll_month: part.payroll_month,
          description: willSplit
            ? `${description || ""}${description ? " — " : ""}Installment ${part.installment_number}/${plan.length} of ${numericAmount.toFixed(2)}`
            : description,
          attendance_reference: attendanceRef,
          amount: part.amount,
          status: "draft",
          installment_group_id: groupId,
          installment_number: willSplit ? part.installment_number : null,
          installment_count: willSplit ? plan.length : null,
          installment_total_amount: willSplit ? numericAmount : null,
        });
        created.push(row as { id: string });
      }
      const fine = created[0];

      if (files.length) {
        setUploading(true);
        for (const f of files) {
          const { path, safeName } = await uploadFineEvidenceFile(restaurant!.id, f);
          const { error } = await db.from("fine_evidence_attachments").insert({
            restaurant_id: restaurant!.id,
            fine_id: fine.id,
            storage_path: path,
            file_name: safeName,
            file_size: f.size,
            content_type: f.type || null,
          });
          if (error) throw error;
        }
        setUploading(false);
      }

      if (submitForApproval) {
        for (const row of created) {
          await changeStatus.mutateAsync({ id: row.id, status: "submitted" });
        }
      }
      if (willSplit) {
        toast.success(`Fine split across ${plan.length} salary months`);
      }
      reset();
      setOpen(false);
    } catch (e) {
      setUploading(false);
      toast.error("Could not complete the fine", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <Plus className="h-4 w-4" /> Create Fine
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Fine / Deduction</DialogTitle>
          <DialogDescription>
            Record a proven workplace violation. The fine stays pending until approved.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-3">
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label>Employee</Label>
              <Select value={staffId} onValueChange={setStaffId}>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {staffList.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} — {s.role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Violation type</Label>
              <Select value={violationTypeId} onValueChange={(v) => {
                setViolationTypeId(v);
                const t = violationTypes.find((x) => x.id === v);
                if (t && Number(t.default_amount) > 0 && !amount) setAmount(String(t.default_amount));
              }}>
                <SelectTrigger><SelectValue placeholder="Select violation" /></SelectTrigger>
                <SelectContent>
                  {violationTypes.filter((t) => t.is_active).map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name_en}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Violation date</Label>
                <Input type="date" value={violationDate} onChange={(e) => setViolationDate(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>Payroll month</Label>
                <Input
                  type="month"
                  value={payrollMonth.slice(0, 7)}
                  onChange={(e) => setPayrollMonth(`${e.target.value}-01`)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Fine amount</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="grid gap-2">
                <Label>Attendance reference</Label>
                <Input
                  value={attendanceRef}
                  onChange={(e) => setAttendanceRef(e.target.value)}
                  placeholder="Optional"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Description / reason</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Describe the violation and the evidence supporting it"
              />
            </div>

            <div className="grid gap-2">
              <Label className="flex items-center gap-1.5">
                <Paperclip className="h-3.5 w-3.5" /> Supporting evidence
                {evidenceRequired && <span className="text-destructive">*</span>}
              </Label>
              <Input
                type="file"
                multiple
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              />
              {files.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {files.length} file{files.length > 1 ? "s" : ""} selected
                </p>
              )}
              {evidenceMissing && (
                <Alert variant="destructive">
                  <AlertDescription>
                    “{selectedType?.name_en}” requires supporting evidence before it can be
                    submitted for approval.
                  </AlertDescription>
                </Alert>
              )}
            </div>

            {capacity && (
              <FineCapacityPanel
                capacity={capacity}
                requestedAmount={numericAmount}
                staffName={selectedStaff?.name}
              />
            )}

            {needsSplit && (
              <div className="space-y-3 rounded-lg border border-border/60 bg-muted/30 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 text-xs font-medium">
                      <CalendarClock className="h-3.5 w-3.5" />
                      Spread over next salaries
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {fmt(numericAmount)} exceeds the monthly limit, so it is recovered over{" "}
                      {schedule.length} payroll months.
                    </p>
                  </div>
                  <Switch checked={splitEnabled} onCheckedChange={setSplitEnabled} />
                </div>

                {splitEnabled && (
                  <div className="space-y-1 text-xs">
                    {schedule.map((s) => (
                      <div key={s.installment_number} className="flex justify-between">
                        <span className="text-muted-foreground">
                          {s.installment_number}. {s.payroll_month.slice(0, 7)}
                        </span>
                        <span className="font-medium">{fmt(s.amount)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between border-t pt-1 font-semibold">
                      <span>Total</span>
                      <span>{fmt(numericAmount)}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => handleSubmit(false)} disabled={createFine.isPending || uploading}>
            Save as draft
          </Button>
          <Button
            onClick={() => handleSubmit(true)}
            disabled={createFine.isPending || uploading || (blocked && !willSplit) || evidenceMissing}
          >
            {(createFine.isPending || uploading) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {willSplit ? `Submit ${schedule.length} installments` : "Submit for approval"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}