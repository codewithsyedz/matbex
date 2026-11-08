import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShieldAlert } from "lucide-react";
import {
  COMPLIANCE_SOURCE_LABELS,
  type ComplianceSource,
  type ComplianceViolation,
} from "@/hooks/useComplianceViolations";
import { useComplianceConfig } from "@/hooks/useComplianceConfig";

interface StaffOption {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  branchId: string | null;
  branchName: string;
  staff: StaffOption[];
  existing?: ComplianceViolation | null;
  onSave: (input: Partial<ComplianceViolation> & { branch_id: string }) => Promise<unknown>;
  saving?: boolean;
}

export function ViolationDialog({
  open,
  onOpenChange,
  branchId,
  branchName,
  staff,
  existing,
  onSave,
  saving,
}: Props) {
  const { categories, types, settings } = useComplianceConfig();
  const [form, setForm] = useState<Record<string, unknown>>({});

  const patch = (p: Record<string, unknown>) => setForm((f) => ({ ...f, ...p }));

  useEffect(() => {
    if (!open) return;
    setForm(
      existing
        ? { ...existing }
        : {
            source: "internal_inspection" as ComplianceSource,
            violation_date: format(new Date(), "yyyy-MM-dd"),
            violation_time: format(new Date(), "HH:mm"),
            fine_amount: 0,
            is_municipality_fine: false,
            status: "identified",
          },
    );
  }, [open, existing]);

  const categoryId = form.category_id as string | undefined;
  const filteredTypes = useMemo(
    () => types.filter((t) => t.category_id === categoryId && t.is_active),
    [types, categoryId],
  );

  const selectedType = filteredTypes.find((t) => t.id === form.violation_type_id);
  const isOfficial =
    form.source === "balady_inspection" || form.source === "food_safety_inspection";

  useEffect(() => {
    if (!open) return;
    patch({ is_municipality_fine: Boolean(isOfficial && form.municipality_reference) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.source, form.municipality_reference]);

  const handleTypeChange = (id: string) => {
    const t = types.find((x) => x.id === id);
    const days = t?.default_correction_days ?? settings?.default_correction_days ?? 3;
    const base = new Date((form.violation_date as string) ?? new Date());
    base.setDate(base.getDate() + days);
    patch({
      violation_type_id: id,
      corrective_action_due_date: format(base, "yyyy-MM-dd"),
    });
  };

  const submit = async () => {
    if (!branchId) return;
    await onSave({ ...(form as Partial<ComplianceViolation>), branch_id: branchId });
    onOpenChange(false);
  };

  const canSubmit = !!branchId && !!form.category_id && !!form.violation_type_id;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit violation" : "Record compliance violation"}</DialogTitle>
          <DialogDescription>
            {branchName} — an internal SOP violation is never treated as a municipality fine and never
            reaches payroll automatically.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh] pr-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                value={(form.category_id as string) ?? ""}
                onValueChange={(v) => patch({ category_id: v, violation_type_id: null })}
              >
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name_en}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Violation type</Label>
              <Select
                value={(form.violation_type_id as string) ?? ""}
                onValueChange={handleTypeChange}
                disabled={!categoryId}
              >
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {filteredTypes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name_en}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Source</Label>
              <Select
                value={(form.source as string) ?? "internal_inspection"}
                onValueChange={(v) => patch({ source: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(COMPLIANCE_SOURCE_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={(form.violation_date as string) ?? ""}
                  onChange={(e) => patch({ violation_date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Time</Label>
                <Input
                  type="time"
                  value={((form.violation_time as string) ?? "").slice(0, 5)}
                  onChange={(e) => patch({ violation_time: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Responsible employee (optional)</Label>
              <Select
                value={(form.responsible_staff_id as string) ?? "none"}
                onValueChange={(v) => patch({ responsible_staff_id: v === "none" ? null : v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not attributed</SelectItem>
                  {staff.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Supervisor</Label>
              <Select
                value={(form.supervisor_staff_id as string) ?? "none"}
                onValueChange={(v) => patch({ supervisor_staff_id: v === "none" ? null : v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not assigned</SelectItem>
                  {staff.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Description</Label>
              <Textarea
                rows={3}
                value={(form.description as string) ?? ""}
                onChange={(e) => patch({ description: e.target.value })}
                placeholder="What was observed, where, and by whom"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Corrective action required</Label>
              <Textarea
                rows={2}
                value={(form.corrective_action_required as string) ?? ""}
                onChange={(e) => patch({ corrective_action_required: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Corrective action due date</Label>
              <Input
                type="date"
                value={(form.corrective_action_due_date as string) ?? ""}
                onChange={(e) => patch({ corrective_action_due_date: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Fine amount (if any)</Label>
              <Input
                type="number"
                step="0.01"
                value={String(form.fine_amount ?? 0)}
                onChange={(e) => patch({ fine_amount: Number(e.target.value) })}
              />
            </div>

            <div className="space-y-2">
              <Label>Municipality reference</Label>
              <Input
                value={(form.municipality_reference as string) ?? ""}
                onChange={(e) => patch({ municipality_reference: e.target.value })}
                placeholder="Balady notice number"
              />
            </div>

            <div className="space-y-2">
              <Label>Inspector name</Label>
              <Input
                value={(form.inspector_name as string) ?? ""}
                onChange={(e) => patch({ inspector_name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Inspection date</Label>
              <Input
                type="date"
                value={(form.inspection_date as string) ?? ""}
                onChange={(e) => patch({ inspection_date: e.target.value })}
              />
            </div>

            <div className="md:col-span-2 flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Official municipality fine</p>
                <p className="text-xs text-muted-foreground">
                  Only enable for a regulatory notice with a reference number. This makes the amount a
                  company liability, not an employee deduction.
                </p>
              </div>
              <Switch
                checked={Boolean(form.is_municipality_fine)}
                onCheckedChange={(v) => patch({ is_municipality_fine: v })}
              />
            </div>

            {selectedType?.requires_evidence ? (
              <Alert className="md:col-span-2">
                <ShieldAlert className="h-4 w-4" />
                <AlertTitle>Evidence expected</AlertTitle>
                <AlertDescription>
                  This violation type requires photo evidence. Save the record, then attach the before
                  photos from the violation detail panel.
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!canSubmit || saving}>
            {saving ? "Saving…" : existing ? "Save changes" : "Record violation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}