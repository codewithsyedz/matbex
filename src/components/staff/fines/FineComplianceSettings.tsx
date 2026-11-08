import { useState } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info, Save, Plus } from "lucide-react";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { useDeductionSettings, useViolationTypes } from "@/hooks/useEmployeeFines";

export function FineComplianceSettings({ canEdit }: { canEdit: boolean }) {
  const { branches } = useBranch();
  const { format: fmt } = useCurrency();
  const { settingsHistory, currentSettings, saveSettings } = useDeductionSettings();
  const { violationTypes, upsertType } = useViolationTypes();

  const [branchId, setBranchId] = useState<string>("all");
  const [effectiveFrom, setEffectiveFrom] = useState(format(new Date(), "yyyy-MM-dd"));
  const [perViolation, setPerViolation] = useState(String(currentSettings?.max_fine_per_violation ?? 0));
  const [perMonth, setPerMonth] = useState(String(currentSettings?.max_fine_per_month ?? 0));
  const [daysWage, setDaysWage] = useState(String(currentSettings?.max_days_wage_per_month ?? 5));
  const [pct, setPct] = useState(String(currentSettings?.max_total_deduction_pct ?? 50));
  const [secondApproval, setSecondApproval] = useState(currentSettings?.requires_second_approval ?? false);

  const [newType, setNewType] = useState({
    code: "",
    name_en: "",
    name_ar: "",
    default_amount: "",
    requires_evidence: false,
  });

  return (
    <div className="space-y-6">
      <Card className="border-border/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Fines & Deduction Limits</CardTitle>
          <CardDescription>
            Configure statutory and company limits. Changes are effective-date based — historical
            payroll keeps the rules that applied at the time.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="grid gap-2">
              <Label>Applies to</Label>
              <Select value={branchId} onValueChange={setBranchId} disabled={!canEdit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All branches (default)</SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Effective from</Label>
              <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} disabled={!canEdit} />
            </div>
            <div className="grid gap-2">
              <Label>Maximum fine per violation</Label>
              <Input type="number" min="0" step="0.01" value={perViolation} onChange={(e) => setPerViolation(e.target.value)} disabled={!canEdit} />
            </div>
            <div className="grid gap-2">
              <Label>Maximum fine per month</Label>
              <Input type="number" min="0" step="0.01" value={perMonth} onChange={(e) => setPerMonth(e.target.value)} disabled={!canEdit} />
            </div>
            <div className="grid gap-2">
              <Label>Maximum days of wage per month</Label>
              <Input type="number" min="0" step="0.5" value={daysWage} onChange={(e) => setDaysWage(e.target.value)} disabled={!canEdit} />
            </div>
            <div className="grid gap-2">
              <Label>Maximum total wage deduction (%)</Label>
              <Input type="number" min="1" max="100" step="1" value={pct} onChange={(e) => setPct(e.target.value)} disabled={!canEdit} />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/60 p-3">
            <div>
              <p className="text-sm font-medium">Require second approval</p>
              <p className="text-xs text-muted-foreground">
                Fines must pass an explicit review step before approval.
              </p>
            </div>
            <Switch checked={secondApproval} onCheckedChange={setSecondApproval} disabled={!canEdit} />
          </div>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              A value of 0 means “not configured”. Monthly fines are capped by the lower of the
              monthly amount and the days-of-wage rule. Total deductions — fines, advances, loans and
              other deductions — can never exceed {pct}% of the due wage.
            </AlertDescription>
          </Alert>

          {canEdit && (
            <Button
              className="gap-2"
              disabled={saveSettings.isPending}
              onClick={() =>
                saveSettings.mutate({
                  branch_id: branchId === "all" ? null : branchId,
                  effective_from: effectiveFrom,
                  max_fine_per_violation: Number(perViolation) || 0,
                  max_fine_per_month: Number(perMonth) || 0,
                  max_days_wage_per_month: Number(daysWage) || 0,
                  max_total_deduction_pct: Number(pct) || 50,
                  requires_second_approval: secondApproval,
                })
              }
            >
              <Save className="h-4 w-4" /> Save new effective version
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Configuration history</CardTitle>
          <CardDescription>Previous payroll periods use the rules active at that time.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Effective from</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead className="text-right">Per violation</TableHead>
                <TableHead className="text-right">Per month</TableHead>
                <TableHead className="text-right">Days of wage</TableHead>
                <TableHead className="text-right">Max deduction</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {settingsHistory.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{format(new Date(s.effective_from), "dd MMM yyyy")}</TableCell>
                  <TableCell>
                    {s.branch_id ? branches.find((b) => b.id === s.branch_id)?.name ?? "Branch" : (
                      <Badge variant="secondary">All branches</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{fmt(Number(s.max_fine_per_violation))}</TableCell>
                  <TableCell className="text-right">{fmt(Number(s.max_fine_per_month))}</TableCell>
                  <TableCell className="text-right">{Number(s.max_days_wage_per_month)}</TableCell>
                  <TableCell className="text-right">{Number(s.max_total_deduction_pct)}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-border/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Violation types</CardTitle>
          <CardDescription>Configurable list used when recording a fine.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {violationTypes.map((t) => (
              <Badge key={t.id} variant={t.is_active ? "secondary" : "outline"}>
                {t.name_en}
                {Number(t.default_amount) > 0 ? ` · ${fmt(Number(t.default_amount))}` : ""}
                {t.requires_evidence ? " · evidence required" : ""}
              </Badge>
            ))}
          </div>

          {canEdit && violationTypes.length > 0 && (
            <div className="space-y-2 rounded-md border border-border/40 p-3">
              <p className="text-xs text-muted-foreground">
                Require supporting evidence before a fine of this type can be submitted or approved.
              </p>
              {violationTypes.map((t) => (
                <div key={t.id} className="flex items-center justify-between">
                  <Label className="text-sm font-normal">{t.name_en}</Label>
                  <Switch
                    checked={!!t.requires_evidence}
                    disabled={upsertType.isPending}
                    onCheckedChange={(v) =>
                      upsertType.mutate({
                        id: t.id,
                        code: t.code,
                        name_en: t.name_en,
                        requires_evidence: v,
                      })
                    }
                  />
                </div>
              ))}
            </div>
          )}

          {canEdit && (
            <div className="grid gap-3 sm:grid-cols-6 items-end">
              <div className="grid gap-2">
                <Label className="text-xs">Code</Label>
                <Input value={newType.code} onChange={(e) => setNewType({ ...newType, code: e.target.value })} placeholder="late_return" />
              </div>
              <div className="grid gap-2">
                <Label className="text-xs">Name (EN)</Label>
                <Input value={newType.name_en} onChange={(e) => setNewType({ ...newType, name_en: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label className="text-xs">Name (AR)</Label>
                <Input value={newType.name_ar} onChange={(e) => setNewType({ ...newType, name_ar: e.target.value })} dir="rtl" />
              </div>
              <div className="grid gap-2">
                <Label className="text-xs">Default amount</Label>
                <Input type="number" min="0" value={newType.default_amount} onChange={(e) => setNewType({ ...newType, default_amount: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label className="text-xs">Evidence required</Label>
                <Switch
                  checked={newType.requires_evidence}
                  onCheckedChange={(v) => setNewType({ ...newType, requires_evidence: v })}
                />
              </div>
              <Button
                variant="outline"
                className="gap-2"
                disabled={!newType.code || !newType.name_en || upsertType.isPending}
                onClick={() =>
                  upsertType.mutate({
                    code: newType.code,
                    name_en: newType.name_en,
                    name_ar: newType.name_ar || null,
                    default_amount: Number(newType.default_amount) || 0,
                    requires_evidence: newType.requires_evidence,
                  })
                }
              >
                <Plus className="h-4 w-4" /> Add
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}