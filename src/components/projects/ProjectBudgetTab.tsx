import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, CheckCircle2, Download, Pencil, Trash2, TriangleAlert, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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
import { useCurrency } from "@/hooks/useCurrency";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { useProjects } from "@/hooks/useProjects";
import { TREATMENT_LABELS, type Treatment } from "@/hooks/useProjects";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BudgetShiftFilter } from "@/lib/projectBudgetBreakdown";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { downloadBudgetCsv, printBudgetPdf } from "@/lib/projectBudgetExport";
import { ProjectBudgetImportDialog } from "./ProjectBudgetImportDialog";
import { ProjectCategoryDrilldownDialog } from "./ProjectCategoryDrilldownDialog";
import { ProjectPostingHistoryCard } from "./ProjectPostingHistoryCard";

type ProjectsApi = ReturnType<typeof useProjects>;

export function ProjectBudgetTab({ api }: { api: ProjectsApi }) {
  const { format: money } = useCurrency();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [importOpen, setImportOpen] = useState(false);
  const [renaming, setRenaming] = useState<{ category: string; value: string } | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; category: string } | null>(null);
  const [drilldown, setDrilldown] = useState<string | null>(null);
  const [flashCategory, setFlashCategory] = useState<string | null>(null);
  const [confirmPost, setConfirmPost] = useState<{ category: string | null } | null>(null);
  const [selectedTxnIds, setSelectedTxnIds] = useState<Set<string>>(new Set());
  const [treatmentOverrides, setTreatmentOverrides] = useState<Record<string, Treatment>>({});
  const [posting, setPosting] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [shift, setShift] = useState<BudgetShiftFilter>("all");
  const lastEventAt = useRef<number>(0);

  const filtered = Boolean(fromDate || toDate || shift !== "all");
  const rows = filtered
    ? api.getCategoryBreakdown({ from: fromDate || null, to: toDate || null, shift })
    : api.categoryBreakdown;
  const pendingTotal = rows.reduce((s, r) => s + (r.pending ?? 0), 0);
  const periodBudget = rows.reduce((s, r) => s + r.budget, 0);
  const periodActual = rows.reduce((s, r) => s + r.actual, 0);
  const periodFilter = { from: fromDate || null, to: toDate || null, shift };
  const confirmTxns = confirmPost
    ? api.getPendingTransactions(periodFilter, confirmPost.category)
    : [];

  // When the confirm dialog opens, default all pending transactions to selected.
  useEffect(() => {
    if (confirmPost) {
      setSelectedTxnIds(new Set(confirmTxns.map((t) => t.id)));
    } else {
      setSelectedTxnIds(new Set());
    }
    setTreatmentOverrides({});
  }, [confirmPost?.category, fromDate, toDate, shift]);

  const selectedTxns = useMemo(
    () => confirmTxns.filter((t) => selectedTxnIds.has(t.id)),
    [confirmTxns, selectedTxnIds],
  );
  const effectiveTreatment = (t: any): Treatment | null =>
    (treatmentOverrides[t.id] ?? t.treatment ?? null) as Treatment | null;
  const missingTreatment = selectedTxns.filter((t: any) => !effectiveTreatment(t));
  const confirmAmount = selectedTxns.reduce((s: number, t: any) => s + Number(t.amount ?? 0), 0);
  const currentActual = confirmPost?.category
    ? rows.find((r) => r.category === confirmPost.category)?.actual ?? 0
    : periodActual;
  const projectedActual = currentActual + confirmAmount;
  const totalPendingAmount = confirmTxns.reduce((s: number, t: any) => s + Number(t.amount ?? 0), 0);
  const selectionReconciles = selectedTxnIds.size === confirmTxns.length && confirmAmount === totalPendingAmount;
  const selectedCategoryBreakdown = useMemo(() => {
    const groups = new Map<string, { count: number; subtotal: number }>();
    for (const t of selectedTxns) {
      const cat = t.category || "Uncategorised";
      const existing = groups.get(cat) || { count: 0, subtotal: 0 };
      existing.count += 1;
      existing.subtotal += Number(t.amount ?? 0);
      groups.set(cat, existing);
    }
    return Array.from(groups.entries()).map(([category, data]) => ({
      category,
      ...data,
    }));
  }, [selectedTxns]);

  const scopeLabel = (category: string | null) => {
    const parts: string[] = [];
    if (category) parts.push(category);
    if (fromDate || toDate) parts.push(`${fromDate || "start"} → ${toDate || "today"}`);
    if (shift !== "all") parts.push(shift === "morning" ? "morning shift" : "night shift");
    return parts.length ? parts.join(" · ") : "all pending transactions";
  };

  const runConfirmPosting = async () => {
    if (!confirmPost || selectedTxns.length === 0) return;
    if (missingTreatment.length > 0) {
      toast.error("Choose CAPEX / OPEX / Pre-Opening for every selected transaction first");
      return;
    }
    setPosting(true);
    try {
      // Persist any treatment changes chosen in this dialog before posting.
      for (const t of selectedTxns as any[]) {
        const chosen = treatmentOverrides[t.id];
        if (chosen && chosen !== t.treatment) {
          await api.saveTransaction.mutateAsync({ id: t.id, treatment: chosen });
        }
      }
      const res = await api.postPendingTransactions.mutateAsync({
        ids: selectedTxns.map((t: any) => t.id),
        category: confirmPost.category,
        from: fromDate || null,
        to: toDate || null,
        shift,
      });
      if (res.failures.length === 0) {
        toast.success(`${res.posted.length} transaction(s) moved to Actual`);
      } else {
        toast.warning(
          `${res.posted.length} posted, ${res.failures.length} could not be posted`,
          { description: res.failures[0]?.message },
        );
      }
      setConfirmPost(null);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not confirm posting");
    } finally {
      setPosting(false);
    }
  };

  // Subtle realtime feedback when a transaction changes the budget totals.
  const evt = api.lastTxnEvent;
  useEffect(() => {
    if (!evt || evt.at === lastEventAt.current) return;
    lastEventAt.current = evt.at;
    const verb =
      evt.type === "INSERT" ? "added" : evt.type === "DELETE" ? "removed" : "updated";
    toast(`Budget updated — ${evt.category}`, {
      description: `A transaction was ${verb} (${money(evt.amount)}).`,
    });
    setFlashCategory(evt.category);
    const t = window.setTimeout(() => setFlashCategory(null), 2000);
    return () => window.clearTimeout(t);
  }, [evt, money]);

  const save = async (category: string, lineId: string | null) => {
    const raw = drafts[category];
    if (raw === undefined) return;
    try {
      await api.saveBudgetLine.mutateAsync({
        id: lineId ?? undefined,
        category,
        budget_amount: Number(raw) || 0,
      });
      setDrafts((d) => {
        const next = { ...d };
        delete next[category];
        return next;
      });
      toast.success("Budget updated");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save budget");
    }
  };

  const commitRename = async (lineId: string | null) => {
    if (!renaming) return;
    const to = renaming.value.trim();
    if (!to) {
      toast.error("Category name cannot be empty");
      return;
    }
    if (to !== renaming.category && rows.some((r) => r.category === to)) {
      toast.error("A category with that name already exists");
      return;
    }
    try {
      await api.renameBudgetCategory.mutateAsync({ id: lineId, from: renaming.category, to });
      setRenaming(null);
      toast.success("Category renamed");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not rename category");
    }
  };

  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    const ordered = [...rows];
    const [moved] = ordered.splice(index, 1);
    ordered.splice(target, 0, moved);
    const ids = ordered.map((r) => r.lineId).filter((id): id is string => !!id);
    if (ids.length < 2) {
      toast.error("Save budget amounts first so categories can be ordered");
      return;
    }
    try {
      await api.reorderBudgetLines.mutateAsync(ids);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not reorder categories");
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.deleteBudgetLine.mutateAsync(deleting.id);
      toast.success("Budget line removed");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not delete budget line");
    } finally {
      setDeleting(null);
    }
  };

  const exportInput = () => ({
    projectName: (api.activeProject as any)?.name ?? "Project",
    projectCode: (api.activeProject as any)?.code ?? null,
    rows,
    period: { from: fromDate || null, to: toDate || null, shift },
    money,
  });

  const exportCsv = () => {
    downloadBudgetCsv(exportInput());
    toast.success("Budget summary exported as CSV");
  };

  const exportPdf = () => {
    if (!printBudgetPdf(exportInput())) {
      toast.error("Allow pop-ups to export the PDF");
    }
  };

  return (
    <div className="space-y-4">
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base font-medium">Budget vs committed vs actual</CardTitle>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          {pendingTotal > 0 && (
            <Button size="sm" onClick={() => setConfirmPost({ category: null })}>
              <CheckCircle2 className="mr-2 h-4 w-4" /> Confirm posting
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={rows.length === 0}>
                <Download className="mr-2 h-4 w-4" /> Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-popover">
              <DropdownMenuItem onClick={exportCsv}>Download CSV</DropdownMenuItem>
              <DropdownMenuItem onClick={exportPdf}>Download PDF</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="mr-2 h-4 w-4" /> Import Excel
          </Button>
          <span>
            {filtered ? (
              <>
                Budget {money(periodBudget)} · Actual (period) {money(periodActual)}
              </>
            ) : (
              <>
                Budget {money(api.totals.budget)} · Actual {money(api.totals.projectSpend)} ·
                Remaining{" "}
                <span className={api.totals.remainingBudget < 0 ? "text-destructive" : ""}>
                  {money(api.totals.remainingBudget)}
                </span>
              </>
            )}
            {pendingTotal > 0 && (
              <span className="ml-1 text-amber-600 dark:text-amber-500">
                · Pending {money(pendingTotal)}
              </span>
            )}
          </span>
        </div>
      </CardHeader>
      <div className="flex flex-wrap items-end gap-3 border-t px-6 py-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="budget-from">
            From
          </label>
          <Input
            id="budget-from"
            type="date"
            className="h-9 w-[150px]"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="budget-to">
            To
          </label>
          <Input
            id="budget-to"
            type="date"
            className="h-9 w-[150px]"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <span className="block text-xs text-muted-foreground">Shift</span>
          <Select value={shift} onValueChange={(v) => setShift(v as BudgetShiftFilter)}>
            <SelectTrigger className="h-9 w-[170px]">
              <SelectValue placeholder="All shifts" />
            </SelectTrigger>
            <SelectContent className="bg-popover">
              <SelectItem value="all">All shifts</SelectItem>
              <SelectItem value="morning">Morning (11:00–23:00)</SelectItem>
              <SelectItem value="night">Night (23:00–11:00)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9"
            onClick={() => {
              setFromDate("");
              setToDate("");
              setShift("all");
            }}
          >
            <X className="mr-1 h-4 w-4" /> Clear filters
          </Button>
        )}
      </div>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[90px]">Order</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="w-[160px] text-right">Budget</TableHead>
              <TableHead className="text-right">Committed</TableHead>
              <TableHead className="text-right">Actual</TableHead>
              <TableHead className="text-right">Pending</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
              <TableHead className="text-right">Variance</TableHead>
              <TableHead className="w-[150px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => {
              const dirty = drafts[row.category] !== undefined;
              const isRenaming = renaming?.category === row.category;
              return (
                <TableRow
                  key={row.category}
                  className={
                    flashCategory === row.category
                      ? "bg-primary/10 transition-colors duration-700 animate-fade-in"
                      : "transition-colors duration-700"
                  }
                >
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                        aria-label={`Move ${row.category} up`}
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={index === rows.length - 1}
                        onClick={() => move(index, 1)}
                        aria-label={`Move ${row.category} down`}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">
                    {isRenaming ? (
                      <div className="flex items-center gap-1">
                        <Input
                          autoFocus
                          className="h-8"
                          value={renaming.value}
                          onChange={(e) =>
                            setRenaming((r) => (r ? { ...r, value: e.target.value } : r))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void commitRename(row.lineId);
                            if (e.key === "Escape") setRenaming(null);
                          }}
                        />
                        <Button
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => commitRename(row.lineId)}
                          aria-label="Save name"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => setRenaming(null)}
                          aria-label="Cancel rename"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="text-left underline-offset-4 hover:underline focus-visible:underline"
                        onClick={() => setDrilldown(row.category)}
                        title={`View transactions in ${row.category}`}
                      >
                        {row.category}
                      </button>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      className="h-8 text-right"
                      type="number"
                      value={dirty ? drafts[row.category] : String(row.budget)}
                      onChange={(e) => setDrafts((d) => ({ ...d, [row.category]: e.target.value }))}
                    />
                  </TableCell>
                  <TableCell className="text-right">{money(row.committed)}</TableCell>
                  <TableCell className="text-right">{money(row.actual)}</TableCell>
                  <TableCell className="text-right">
                    {row.pending ? (
                      <button
                        type="button"
                        className="text-amber-600 underline-offset-4 hover:underline dark:text-amber-500"
                        onClick={() => setDrilldown(row.category)}
                      >
                        {money(row.pending)}
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({row.pendingCount})
                        </span>
                      </button>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{money(row.outstanding)}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant={row.variance < 0 ? "destructive" : "secondary"}>
                      {money(row.variance)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {dirty && (
                        <Button size="sm" onClick={() => save(row.category, row.lineId)}>
                          Save
                        </Button>
                      )}
                      {row.pending > 0 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-primary"
                          onClick={() => setConfirmPost({ category: row.category })}
                          aria-label={`Confirm posting for ${row.category}`}
                          title="Move pending transactions to Actual"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {!isRenaming && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() =>
                            setRenaming({ category: row.category, value: row.category })
                          }
                          aria-label={`Rename ${row.category}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {row.lineId && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          onClick={() =>
                            setDeleting({ id: row.lineId as string, category: row.category })
                          }
                          aria-label={`Delete ${row.category} budget line`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                  No budget lines yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
      <ProjectBudgetImportDialog api={api} open={importOpen} onOpenChange={setImportOpen} />
      <ProjectCategoryDrilldownDialog
        api={api}
        category={drilldown}
        onOpenChange={(o) => !o && setDrilldown(null)}
      />
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove budget line?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the budget amount for “{deleting?.category}”. Transactions and
              commitments in this category are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!confirmPost} onOpenChange={(o) => !o && !posting && setConfirmPost(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm posting?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  <span className="font-medium">{selectedTxns.length}</span> of{" "}
                  {confirmTxns.length} pending transaction(s) selected, totalling{" "}
                  <span className="font-medium">{money(confirmAmount)}</span>, will move from
                  Pending to Actual and post to the ledger.
                </p>
                <p className="text-xs">Scope: {scopeLabel(confirmPost?.category ?? null)}</p>
                <div className="grid grid-cols-3 gap-2 py-2">
                  <div className="rounded-lg border p-2 text-center">
                    <div className="text-xs text-muted-foreground">Pending preview</div>
                    <div className="text-lg font-semibold">{confirmTxns.length}</div>
                    <div className="text-[10px] text-muted-foreground">transactions</div>
                  </div>
                  <div className="rounded-lg border p-2 text-center">
                    <div className="text-xs text-muted-foreground">Subtotal</div>
                    <div className="text-lg font-semibold">{money(confirmAmount)}</div>
                    <div className="text-[10px] text-muted-foreground">selected</div>
                  </div>
                  <div className="rounded-lg border p-2 text-center">
                    <div className="text-xs text-muted-foreground">Net change to Actual</div>
                    <div className="text-lg font-semibold text-emerald-600">+{money(confirmAmount)}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {money(currentActual)} → {money(projectedActual)}
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground mb-2">
                    Projected cash-on-hand impact (current shift)
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-sm">
                      <span>Opening float</span>
                      <span className="font-medium tabular-nums">{money(currentActual)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm text-emerald-600">
                      <span>+ Net change to Actual</span>
                      <span className="font-medium tabular-nums">+{money(confirmAmount)}</span>
                    </div>
                    <div className="my-1 border-t" />
                    <div className="flex items-center justify-between text-sm font-semibold">
                      <span>Projected cash-on-hand</span>
                      <span className="tabular-nums">{money(projectedActual)}</span>
                    </div>
                  </div>
                </div>
                {missingTreatment.length > 0 && (
                  <Alert variant="destructive">
                    <TriangleAlert className="h-4 w-4" />
                    <AlertTitle>Accounting treatment required</AlertTitle>
                    <AlertDescription>
                      {missingTreatment.length} selected transaction(s) have no treatment. Choose
                      CAPEX, OPEX or Pre-Opening for each before posting.
                    </AlertDescription>
                  </Alert>
                )}
                {confirmTxns.length > 0 && !selectionReconciles && (
                  <Alert variant="warning">
                    <TriangleAlert className="h-4 w-4" />
                    <AlertTitle>Selection does not match filter totals</AlertTitle>
                    <AlertDescription>
                      You selected {selectedTxnIds.size} of {confirmTxns.length} pending transactions
                      ({money(confirmAmount)} of {money(totalPendingAmount)}). Only the selected items
                      will move to Actual; the remaining {confirmTxns.length - selectedTxnIds.size} pending
                      transactions will stay Pending for this filter.
                    </AlertDescription>
                  </Alert>
                )}
                {selectedCategoryBreakdown.length > 0 && (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Category</TableHead>
                          <TableHead className="text-xs text-right">Selected</TableHead>
                          <TableHead className="text-xs text-right">Subtotal</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedCategoryBreakdown.map((group) => (
                          <TableRow key={group.category}>
                            <TableCell className="text-xs font-medium">{group.category}</TableCell>
                            <TableCell className="text-right text-xs tabular-nums">
                              {group.count}
                            </TableCell>
                            <TableCell className="text-right text-xs tabular-nums">
                              {money(group.subtotal)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                {confirmTxns.length > 0 && (
                  <div className="rounded-md border">
                    <ScrollArea className="max-h-[45vh]">
                      <div className="flex flex-wrap items-center gap-2 border-b p-2">
                        <span className="text-xs text-muted-foreground">
                          Apply treatment to all selected:
                        </span>
                        {(["capex", "opex", "pre_opening"] as Treatment[]).map((tr) => (
                          <Button
                            key={tr}
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() =>
                              setTreatmentOverrides((prev) => {
                                const next = { ...prev };
                                selectedTxns.forEach((t: any) => {
                                  next[t.id] = tr;
                                });
                                return next;
                              })
                            }
                          >
                            {TREATMENT_LABELS[tr]}
                          </Button>
                        ))}
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10 text-xs">
                              <Checkbox
                                checked={
                                  selectedTxnIds.size > 0 && selectedTxnIds.size === confirmTxns.length
                                }
                                onCheckedChange={(checked) => {
                                  setSelectedTxnIds(
                                    checked
                                      ? new Set(confirmTxns.map((t) => t.id))
                                      : new Set(),
                                  );
                                }}
                                aria-label="Select all transactions"
                              />
                            </TableHead>
                            <TableHead className="text-xs">Date</TableHead>
                            <TableHead className="text-xs">Description</TableHead>
                            <TableHead className="text-xs">Category</TableHead>
                            <TableHead className="text-xs">Treatment</TableHead>
                            <TableHead className="text-xs">Paid by</TableHead>
                            <TableHead className="text-xs text-right">Amount</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {confirmTxns.map((t: any) => {
                            const checked = selectedTxnIds.has(t.id);
                            return (
                              <TableRow
                                key={t.id}
                                className={checked ? undefined : "opacity-50"}
                              >
                                <TableCell className="w-10">
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={(c) => {
                                      setSelectedTxnIds((prev) => {
                                        const next = new Set(prev);
                                        if (c) next.add(t.id);
                                        else next.delete(t.id);
                                        return next;
                                      });
                                    }}
                                    aria-label={`Select transaction ${t.description || t.vendor_name || t.id}`}
                                  />
                                </TableCell>
                                <TableCell className="whitespace-nowrap text-xs tabular-nums">
                                  {t.txn_date ?? "—"}
                                </TableCell>
                                <TableCell className="max-w-[220px] truncate text-xs">
                                  {t.description || t.vendor_name || "—"}
                                </TableCell>
                                <TableCell className="text-xs">
                                  {t.category ?? "Uncategorised"}
                                </TableCell>
                                <TableCell className="text-xs">
                                  <Select
                                    value={effectiveTreatment(t) ?? ""}
                                    onValueChange={(v) =>
                                      setTreatmentOverrides((prev) => ({
                                        ...prev,
                                        [t.id]: v as Treatment,
                                      }))
                                    }
                                  >
                                    <SelectTrigger
                                      className={`h-7 w-[150px] text-xs ${
                                        checked && !effectiveTreatment(t) ? "border-destructive" : ""
                                      }`}
                                    >
                                      <SelectValue placeholder="Choose…" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {Object.entries(TREATMENT_LABELS).map(([k, v]) => (
                                        <SelectItem key={k} value={k} className="text-xs">
                                          {v}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </TableCell>
                                <TableCell className="text-xs capitalize">
                                  {t.paid_by === "partner"
                                    ? t.partner_name || "Partner"
                                    : t.paid_by ?? "—"}
                                </TableCell>
                                <TableCell className="text-right text-xs tabular-nums">
                                  {money(Number(t.amount ?? 0))}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={posting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={posting || selectedTxns.length === 0 || missingTreatment.length > 0}
              onClick={(e) => {
                e.preventDefault();
                void runConfirmPosting();
              }}
            >
              {posting ? "Posting…" : `Post ${selectedTxns.length}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
    <ProjectPostingHistoryCard api={api} />
    </div>
  );
}