import { useMemo, useState } from "react";
import { Copy, Layers, Pencil, Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import type { FixedAssetClass } from "@/hooks/useFixedAssets";
import { useTranslation } from "react-i18next";

type Method = "straight_line" | "reducing_balance";

const METHOD_LABEL: Record<Method, string> = {
  straight_line: "Straight line",
  reducing_balance: "Reducing balance",
};

interface Props {
  allClasses: FixedAssetClass[];
  branches: { id: string; name: string }[];
  scopeBranchId: string | null;
  canEdit: boolean;
  saveClass: any;
  copyClassesToBranch: any;
  deleteBranchClass: any;
}

interface FormState {
  id?: string;
  branchId: string | null;
  code: string;
  name: string;
  description: string;
  assetAccountId: string;
  accumDepAccountId: string;
  depExpenseAccountId: string;
  usefulLifeMonths: string;
  depreciationMethod: Method;
  salvageRatePct: string;
  isActive: boolean;
}

const emptyForm = (branchId: string | null): FormState => ({
  branchId,
  code: "",
  name: "",
  description: "",
  assetAccountId: "",
  accumDepAccountId: "",
  depExpenseAccountId: "",
  usefulLifeMonths: "60",
  depreciationMethod: "straight_line",
  salvageRatePct: "0",
  isActive: true,
});

export function AssetClassTemplates({
  allClasses,
  branches,
  scopeBranchId,
  canEdit,
  saveClass,
  copyClassesToBranch,
  deleteBranchClass,
}: Props) {
  const { accounts } = useChartOfAccounts();
  const { t } = useTranslation();
  const [branchFilter, setBranchFilter] = useState<string>(scopeBranchId ?? "tenant");
  const [form, setForm] = useState<FormState | null>(null);

  const viewBranchId = branchFilter === "tenant" ? null : branchFilter;

  const assetAccounts = useMemo(
    () => accounts.filter((a) => a.account_type === "asset" && a.is_active),
    [accounts],
  );
  const expenseAccounts = useMemo(
    () => accounts.filter((a) => a.account_type === "expense" && a.is_active),
    [accounts],
  );
  const accountLabel = (id: string) => {
    const a = accounts.find((x) => x.id === id);
    return a ? `${a.account_code} · ${a.account_name}` : "—";
  };

  const tenantClasses = useMemo(
    () => allClasses.filter((c) => !c.branch_id),
    [allClasses],
  );

  /** Effective list for the selected scope: branch override replaces the company template. */
  const rows = useMemo(() => {
    const overrides = new Map(
      allClasses.filter((c) => c.branch_id === viewBranchId).map((c) => [c.code, c]),
    );
    const codes = new Set([...tenantClasses.map((c) => c.code), ...overrides.keys()]);
    return Array.from(codes)
      .map((code) => {
        const override = overrides.get(code) ?? null;
        const base = tenantClasses.find((c) => c.code === code) ?? null;
        const effective = (override ?? base) as FixedAssetClass;
        return { code, base, override, effective };
      })
      .filter((r) => !!r.effective)
      .sort(
        (a, b) =>
          a.effective.sort_order - b.effective.sort_order ||
          a.effective.name.localeCompare(b.effective.name),
      );
  }, [allClasses, tenantClasses, viewBranchId]);

  const openEdit = (c: FixedAssetClass) =>
    setForm({
      id: c.id,
      branchId: c.branch_id,
      code: c.code,
      name: c.name,
      description: c.description ?? "",
      assetAccountId: c.asset_account_id,
      accumDepAccountId: c.accum_dep_account_id,
      depExpenseAccountId: c.dep_expense_account_id,
      usefulLifeMonths: String(c.useful_life_months),
      depreciationMethod: (c.depreciation_method ?? "straight_line") as Method,
      salvageRatePct: String(c.salvage_rate_pct ?? 0),
      isActive: c.is_active,
    });

  /** Start a branch-specific copy of a company template. */
  const openCustomize = (base: FixedAssetClass) =>
    setForm({
      branchId: viewBranchId,
      code: base.code,
      name: base.name,
      description: base.description ?? "",
      assetAccountId: base.asset_account_id,
      accumDepAccountId: base.accum_dep_account_id,
      depExpenseAccountId: base.dep_expense_account_id,
      usefulLifeMonths: String(base.useful_life_months),
      depreciationMethod: (base.depreciation_method ?? "straight_line") as Method,
      salvageRatePct: String(base.salvage_rate_pct ?? 0),
      isActive: base.is_active,
    });

  const submit = async () => {
    if (!form) return;
    const life = Number(form.usefulLifeMonths);
    if (!form.name.trim()) return toast.error(t("finance.assetClasses.errors.name"));
    if (!form.code.trim()) return toast.error(t("finance.assetClasses.errors.code"));
    if (!Number.isFinite(life) || life < 1 || life > 600)
      return toast.error(t("finance.assetClasses.errors.life"));
    if (!form.assetAccountId || !form.accumDepAccountId || !form.depExpenseAccountId)
      return toast.error(t("finance.assetClasses.errors.accounts"));
    try {
      await saveClass.mutateAsync({
        id: form.id,
        branchId: form.branchId,
        code: form.code.trim().toLowerCase().replace(/\s+/g, "_"),
        name: form.name.trim(),
        description: form.description.trim() || null,
        assetAccountId: form.assetAccountId,
        accumDepAccountId: form.accumDepAccountId,
        depExpenseAccountId: form.depExpenseAccountId,
        usefulLifeMonths: life,
        depreciationMethod: form.depreciationMethod,
        salvageRatePct: Number(form.salvageRatePct) || 0,
        isActive: form.isActive,
      });
      toast.success(t(form.id ? "finance.assetClasses.updated" : "finance.assetClasses.saved"));
      setForm(null);
    } catch (e: any) {
      toast.error(e.message ?? t("finance.assetClasses.errors.save"));
    }
  };

  const copyAll = async () => {
    if (!viewBranchId) return;
    try {
      const res = await copyClassesToBranch.mutateAsync({ branchId: viewBranchId });
      toast.success(
        `Copied ${res?.copied ?? 0} template${res?.copied === 1 ? "" : "s"}` +
          (res?.skipped ? ` · ${res.skipped} already customized` : ""),
      );
    } catch (e: any) {
      toast.error(e.message ?? t("finance.assetClasses.errors.copy"));
    }
  };

  const resetOverride = async (id: string) => {
    try {
      await deleteBranchClass.mutateAsync(id);
      toast.success(t("finance.assetClasses.resetDone"));
    } catch (e: any) {
      toast.error(e.message ?? t("finance.assetClasses.errors.reset"));
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col items-stretch justify-between gap-3 pb-3 lg:flex-row lg:items-start">
          <div>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Layers className="h-4 w-4" /> {t("finance.assetClasses.title")}
            </CardTitle>
            <CardDescription>
              Default useful life, depreciation method and account mapping applied to new
              purchases. Copy a template into a branch to customize it there.
            </CardDescription>
          </div>
          <div className="data-panel flex flex-col items-stretch gap-2 p-2 sm:flex-row sm:items-center">
            <Select value={branchFilter} onValueChange={setBranchFilter}>
              <SelectTrigger className="w-full sm:w-[210px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tenant">{t("finance.assetClasses.companyDefaults")}</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canEdit && viewBranchId && (
              <Button variant="outline" size="sm" onClick={copyAll} disabled={copyClassesToBranch.isPending}>
                <Copy className="h-3.5 w-3.5 me-1.5" /> {t("finance.assetClasses.copyAll")}
              </Button>
            )}
            {canEdit && (
              <Button size="sm" onClick={() => setForm(emptyForm(viewBranchId))}>
                <Plus className="h-3.5 w-3.5 me-1.5" /> {t("finance.assetClasses.newClass")}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
          <Table className="min-w-[1100px]">
              <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_hsl(var(--border))]">
              <TableRow>
                <TableHead>{t("finance.assetClasses.columns.class")}</TableHead>
                <TableHead>{t("finance.assetClasses.columns.scope")}</TableHead>
                <TableHead className="text-end">{t("finance.assetClasses.columns.usefulLife")}</TableHead>
                <TableHead>{t("finance.assetClasses.columns.method")}</TableHead>
                <TableHead className="text-end">{t("finance.assetClasses.columns.salvage")}</TableHead>
                <TableHead>{t("finance.assetClasses.columns.assetAccount")}</TableHead>
                <TableHead>{t("finance.assetClasses.columns.accumDep")}</TableHead>
                <TableHead>{t("finance.assetClasses.columns.depExpense")}</TableHead>
                <TableHead className="text-end">{t("finance.assetClasses.columns.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-8">
                    {t("finance.assetClasses.noClasses")}
                  </TableCell>
                </TableRow>
              )}
              {rows.map(({ code, base, override, effective }) => (
                <TableRow key={code} className={effective.is_active ? "" : "opacity-60"}>
                  <TableCell>
                    <p className="font-medium">{effective.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {effective.description || code}
                    </p>
                  </TableCell>
                  <TableCell>
                    {override ? (
                      <Badge variant="default">{t("finance.assetClasses.branchOverride")}</Badge>
                    ) : (
                      <Badge variant="secondary">{t("finance.assetClasses.companyDefault")}</Badge>
                    )}
                    {!effective.is_active && (
                      <Badge variant="outline" className="ms-1">
                        Inactive
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {t("finance.assetClasses.months", { count: effective.useful_life_months })}
                  </TableCell>
                  <TableCell className="text-sm">
                    {t(`finance.assetClasses.methods.${effective.depreciation_method ?? "straight_line"}`)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {Number(effective.salvage_rate_pct ?? 0)}%
                  </TableCell>
                  <TableCell className="text-xs">{accountLabel(effective.asset_account_id)}</TableCell>
                  <TableCell className="text-xs">{accountLabel(effective.accum_dep_account_id)}</TableCell>
                  <TableCell className="text-xs">
                    {accountLabel(effective.dep_expense_account_id)}
                  </TableCell>
                  <TableCell className="text-end whitespace-nowrap">
                    {canEdit && (
                      <>
                        {override || !viewBranchId ? (
                          <Button variant="ghost" size="sm" onClick={() => openEdit(effective)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => openCustomize(base ?? effective)}>
                            <Copy className="h-3.5 w-3.5 me-1.5" /> {t("finance.assetClasses.customize")}
                          </Button>
                        )}
                        {override && (
                          <Button variant="ghost" size="sm" onClick={() => resetOverride(override.id)}>
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
         <DialogContent className="max-h-[90vh] max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t(form?.id ? "finance.assetClasses.editTitle" : "finance.assetClasses.createTitle")}</DialogTitle>
            <DialogDescription>
              {form?.branchId
                ? `Applies to ${branches.find((b) => b.id === form?.branchId)?.name ?? "this branch"} only.`
                : t("finance.assetClasses.companyWide")}
            </DialogDescription>
          </DialogHeader>
          {form && (
             <ScrollArea className="max-h-[68vh] pe-3">
               <div className="space-y-4">
                 <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>{t("finance.assetClasses.name")}</Label>
                    <Input
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="Kitchen Equipment"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("finance.assetClasses.code")}</Label>
                    <Input
                      value={form.code}
                      disabled={!!form.id}
                      onChange={(e) => setForm({ ...form, code: e.target.value })}
                      placeholder="kitchen_equipment"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>{t("finance.assetClasses.descriptionLabel")}</Label>
                  <Textarea
                    rows={2}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder={t("finance.assetClasses.descriptionPlaceholder")}
                  />
                </div>

                 <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label>{t("finance.assetClasses.usefulLife")}</Label>
                    <Input
                      type="number"
                      value={form.usefulLifeMonths}
                      onChange={(e) => setForm({ ...form, usefulLifeMonths: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("finance.assetClasses.method")}</Label>
                    <Select
                      value={form.depreciationMethod}
                      onValueChange={(v) => setForm({ ...form, depreciationMethod: v as Method })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="straight_line">{t("finance.assetClasses.methods.straight_line")}</SelectItem>
                        <SelectItem value="reducing_balance">{t("finance.assetClasses.methods.reducing_balance")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("finance.assetClasses.salvage")}</Label>
                    <Input
                      type="number"
                      value={form.salvageRatePct}
                      onChange={(e) => setForm({ ...form, salvageRatePct: e.target.value })}
                    />
                  </div>
                </div>

                 <div className="border-t border-border/70 pt-4">
                   <p className="mb-3 text-xs font-semibold text-muted-foreground">{t("finance.assetClasses.mapping")}</p>
                   <div className="grid gap-3 sm:grid-cols-2">
                 <div className="space-y-1.5">
                   <Label>{t("finance.assetClasses.assetAccount")}</Label>
                  <Select
                    value={form.assetAccountId}
                    onValueChange={(v) => setForm({ ...form, assetAccountId: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("finance.assetClasses.selectAccount")} />
                    </SelectTrigger>
                    <SelectContent>
                      {assetAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.account_code} · {a.account_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                 <div className="space-y-1.5">
                  <Label>{t("finance.assetClasses.accumDep")}</Label>
                  <Select
                    value={form.accumDepAccountId}
                    onValueChange={(v) => setForm({ ...form, accumDepAccountId: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("finance.assetClasses.selectAccount")} />
                    </SelectTrigger>
                    <SelectContent>
                      {assetAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.account_code} · {a.account_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                 <div className="space-y-1.5 sm:col-span-2">
                  <Label>{t("finance.assetClasses.depExpense")}</Label>
                  <Select
                    value={form.depExpenseAccountId}
                    onValueChange={(v) => setForm({ ...form, depExpenseAccountId: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("finance.assetClasses.selectAccount")} />
                    </SelectTrigger>
                    <SelectContent>
                      {expenseAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.account_code} · {a.account_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                 </div>
                   </div>
                 </div>

                 <div className="flex items-center justify-between rounded-md border border-border/80 bg-muted/20 p-3">
                  <div>
                    <p className="text-sm font-medium">{t("finance.assetClasses.active")}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("finance.assetClasses.activeDescription")}
                    </p>
                  </div>
                  <Switch
                    checked={form.isActive}
                    onCheckedChange={(v) => setForm({ ...form, isActive: v })}
                  />
                </div>
              </div>
            </ScrollArea>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setForm(null)}>
              {t("finance.assetClasses.cancel")}
            </Button>
            <Button onClick={submit} disabled={saveClass.isPending}>
              {saveClass.isPending ? t("finance.assetClasses.saving") : t("finance.assetClasses.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
