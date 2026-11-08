import { Fragment, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowRight, AlertTriangle, CalendarIcon, CheckCircle2, Filter, Info, Loader2, Mail, Pencil, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import { CoAAuditScheduleDialog } from "./CoAAuditScheduleDialog";

interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_type: "cogs" | "expense" | string;
}

interface Category {
  id: string;
  name: string;
  color: string | null;
  account_id: string | null;
}

interface ExpenseRow {
  id: string;
  amount: number;
  description: string | null;
  expense_date: string;
  category_id: string | null;
  account_id: string | null;
}

type IssueKind = "unmapped" | "type_mismatch" | "category_unmapped";

interface Issue {
  expense: ExpenseRow;
  category: Category | null;
  currentAccount: Account | null;
  suggestedAccount: Account | null;
  kind: IssueKind;
  reason: string;
  ruleCode: string;
  recommendation: string;
}

interface PendingChange {
  expenseId: string;
  description: string;
  amount: number;
  fromAccount: Account | null;
  toAccount: Account;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEditExpense?: (expenseId: string) => void;
}

const ISSUE_LABEL: Record<IssueKind, string> = {
  unmapped: "No CoA mapping",
  type_mismatch: "Type mismatch",
  category_unmapped: "Category has no default",
};

const ISSUE_BADGE: Record<IssueKind, "destructive" | "secondary" | "outline"> = {
  unmapped: "destructive",
  type_mismatch: "secondary",
  category_unmapped: "outline",
};

export function ExpenseCoAAuditDialog({ open, onOpenChange, onEditExpense }: Props) {
  const { profile, restaurant } = useAuth();
  const tenantId = profile?.tenant_id;
  const restaurantId = restaurant?.id;
  const queryClient = useQueryClient();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTarget, setBulkTarget] = useState<string>("");

  // Weekly audit email schedule dialog
  const [scheduleOpen, setScheduleOpen] = useState(false);

  // Preview confirmation step state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLabel, setPreviewLabel] = useState("");
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([]);

  // Scan scope: how many expenses to audit. "all" paginates the full history.
  type ScanScope = "2000" | "5000" | "10000" | "all";
  const [scanScope, setScanScope] = useState<ScanScope>("2000");
  const [scanProgress, setScanProgress] = useState<number>(0);

  // User filters
  const [enabledKinds, setEnabledKinds] = useState<Record<IssueKind, boolean>>({
    unmapped: true,
    type_mismatch: true,
    category_unmapped: true,
  });
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  const { data: accounts = [] } = useQuery({
    queryKey: ["coa-audit-accounts", tenantId],
    queryFn: async () => {
      if (!tenantId) return [] as Account[];
      const { data, error } = await supabase
        .from("chart_of_accounts")
        .select("id, account_code, account_name, account_type")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .in("account_type", ["cogs", "expense"])
        .order("account_code");
      if (error) throw error;
      return (data || []) as Account[];
    },
    enabled: !!tenantId && open,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["coa-audit-categories", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [] as Category[];
      const { data, error } = await supabase
        .from("expense_categories")
        .select("id, name, color, account_id")
        .eq("restaurant_id", restaurantId);
      if (error) throw error;
      return (data || []) as Category[];
    },
    enabled: !!restaurantId && open,
  });

  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ["coa-audit-expenses", restaurantId, scanScope],
    queryFn: async () => {
      if (!restaurantId) return [] as ExpenseRow[];
      const PAGE = 1000;
      const cap = scanScope === "all" ? Number.POSITIVE_INFINITY : parseInt(scanScope, 10);
      setScanProgress(0);
      const all: ExpenseRow[] = [];
      let from = 0;
      while (true) {
        const remaining = cap - all.length;
        if (remaining <= 0) break;
        const pageSize = Math.min(PAGE, remaining);
        const to = from + pageSize - 1;
        const { data, error } = await supabase
          .from("expenses")
          .select("id, amount, description, expense_date, category_id, account_id")
          .eq("restaurant_id", restaurantId)
          .is("deleted_at", null)
          .order("expense_date", { ascending: false })
          .range(from, to);
        if (error) throw error;
        const batch = (data || []) as ExpenseRow[];
        all.push(...batch);
        setScanProgress(all.length);
        if (batch.length < pageSize) break;
        from += pageSize;
      }
      return all;
    },
    enabled: !!restaurantId && open,
  });

  const accountById = useMemo(() => {
    const m = new Map<string, Account>();
    accounts.forEach((a) => m.set(a.id, a));
    return m;
  }, [accounts]);

  const categoryById = useMemo(() => {
    const m = new Map<string, Category>();
    categories.forEach((c) => m.set(c.id, c));
    return m;
  }, [categories]);

  const issues = useMemo<Issue[]>(() => {
    const result: Issue[] = [];
    for (const e of expenses) {
      const cat = e.category_id ? categoryById.get(e.category_id) || null : null;
      const current = e.account_id ? accountById.get(e.account_id) || null : null;
      const suggested = cat?.account_id ? accountById.get(cat.account_id) || null : null;

      if (!e.account_id) {
        result.push({
          expense: e,
          category: cat,
          currentAccount: null,
          suggestedAccount: suggested,
          kind: "unmapped",
          reason: "Expense has no Chart of Accounts mapping.",
          ruleCode: "COA_MISSING_ACCOUNT",
          recommendation: suggested
            ? `Map this expense to ${suggested.account_code} · ${suggested.account_name} (default for category "${cat?.name ?? "-"}").`
            : cat
            ? `Set a default CoA account on category "${cat.name}", or assign an Expense (6000-series) account directly.`
            : `Assign a category with a default CoA account, or pick an Expense (6000-series) account manually.`,
        });
        continue;
      }

      if (cat && !cat.account_id) {
        result.push({
          expense: e,
          category: cat,
          currentAccount: current,
          suggestedAccount: null,
          kind: "category_unmapped",
          reason: `Category "${cat.name}" has no default CoA account configured.`,
          ruleCode: "COA_CATEGORY_DEFAULT_MISSING",
          recommendation: `Open Settings → Expense Categories and set a default CoA account for "${cat.name}". Future expenses in this category will auto-map.`,
        });
        continue;
      }

      if (suggested && current && suggested.id !== current.id && suggested.account_type !== current.account_type) {
        result.push({
          expense: e,
          category: cat,
          currentAccount: current,
          suggestedAccount: suggested,
          kind: "type_mismatch",
          reason: `Expense posts to ${current.account_type.toUpperCase()} (${current.account_code}) but category default is ${suggested.account_type.toUpperCase()} (${suggested.account_code}).`,
          ruleCode: "COA_TYPE_MISMATCH",
          recommendation: `Remap to ${suggested.account_code} · ${suggested.account_name} so the posting type (${suggested.account_type.toUpperCase()}) matches the category "${cat?.name ?? ""}". Mismatched types distort COGS vs. Operating Expenses on the P&L.`,
        });
      }
    }
    return result;
  }, [expenses, accountById, categoryById]);

  const counts = useMemo(() => {
    return {
      unmapped: issues.filter((i) => i.kind === "unmapped").length,
      type_mismatch: issues.filter((i) => i.kind === "type_mismatch").length,
      category_unmapped: issues.filter((i) => i.kind === "category_unmapped").length,
      total: issues.length,
    };
  }, [issues]);

  // Apply user filters (kind + date range) - these drive the visible tables and bulk actions.
  const filteredIssues = useMemo(() => {
    const fromDate = dateRange?.from ? new Date(dateRange.from) : null;
    const toDate = dateRange?.to
      ? new Date(dateRange.to)
      : dateRange?.from
      ? new Date(dateRange.from)
      : null;
    if (fromDate) fromDate.setHours(0, 0, 0, 0);
    if (toDate) toDate.setHours(23, 59, 59, 999);
    return issues.filter((i) => {
      if (!enabledKinds[i.kind]) return false;
      if (fromDate || toDate) {
        const d = new Date(i.expense.expense_date);
        if (Number.isNaN(d.getTime())) return false;
        if (fromDate && d < fromDate) return false;
        if (toDate && d > toDate) return false;
      }
      return true;
    });
  }, [issues, enabledKinds, dateRange]);

  const filteredCounts = useMemo(() => ({
    unmapped: filteredIssues.filter((i) => i.kind === "unmapped").length,
    type_mismatch: filteredIssues.filter((i) => i.kind === "type_mismatch").length,
    category_unmapped: filteredIssues.filter((i) => i.kind === "category_unmapped").length,
    total: filteredIssues.length,
  }), [filteredIssues]);

  const autoFixable = useMemo(
    () => filteredIssues.filter((i) => i.suggestedAccount !== null),
    [filteredIssues]
  );

  const activeFilterCount =
    (enabledKinds.unmapped ? 0 : 1) +
    (enabledKinds.type_mismatch ? 0 : 1) +
    (enabledKinds.category_unmapped ? 0 : 1) +
    (dateRange?.from ? 1 : 0);

  const clearFilters = () => {
    setEnabledKinds({ unmapped: true, type_mismatch: true, category_unmapped: true });
    setDateRange(undefined);
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = (visible: Issue[], checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      visible.forEach((i) => {
        if (checked) next.add(i.expense.id);
        else next.delete(i.expense.id);
      });
      return next;
    });
  };

  const applyMutation = useMutation({
    mutationFn: async (changes: PendingChange[]) => {
      // Group by target account for fewer round-trips
      const byTarget = new Map<string, string[]>();
      changes.forEach((c) => {
        const list = byTarget.get(c.toAccount.id) || [];
        list.push(c.expenseId);
        byTarget.set(c.toAccount.id, list);
      });
      for (const [accountId, ids] of byTarget.entries()) {
        const payload: { account_id: string } = { account_id: accountId };
        const { error } = await (supabase
          .from("expenses") as any)
          .update(payload)
          .in("id", ids);
        if (error) throw error;
      }
      return changes.length;
    },
    onSuccess: (count) => {
      toast.success(`Applied ${count} CoA mapping fix${count === 1 ? "" : "es"}.`);
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["coa-audit-expenses", restaurantId] });
      setPreviewOpen(false);
      setPendingChanges([]);
      setSelected(new Set());
    },
    onError: (err: Error) => {
      toast.error(`Failed to apply fixes: ${err.message}`);
    },
  });

  // Build pending changes and open preview confirmation
  const stageAutoFixAll = () => {
    const changes: PendingChange[] = autoFixable.map((i) => ({
      expenseId: i.expense.id,
      description: i.expense.description || "(no description)",
      amount: Number(i.expense.amount) || 0,
      fromAccount: i.currentAccount,
      toAccount: i.suggestedAccount!,
    }));
    if (changes.length === 0) {
      toast.info("No auto-fixable issues found.");
      return;
    }
    setPreviewLabel(`Auto-fix ${changes.length} expense${changes.length === 1 ? "" : "s"} using category defaults`);
    setPendingChanges(changes);
    setPreviewOpen(true);
  };

  const stageAutoFixSelected = () => {
    const changes: PendingChange[] = filteredIssues
      .filter((i) => selected.has(i.expense.id) && i.suggestedAccount)
      .map((i) => ({
        expenseId: i.expense.id,
        description: i.expense.description || "(no description)",
        amount: Number(i.expense.amount) || 0,
        fromAccount: i.currentAccount,
        toAccount: i.suggestedAccount!,
      }));
    if (changes.length === 0) {
      toast.info("No selected rows have a suggested fix.");
      return;
    }
    setPreviewLabel(`Apply category defaults to ${changes.length} selected expense${changes.length === 1 ? "" : "s"}`);
    setPendingChanges(changes);
    setPreviewOpen(true);
  };

  const stageBulkRemap = () => {
    if (!bulkTarget) {
      toast.error("Choose a target account first.");
      return;
    }
    const target = accountById.get(bulkTarget);
    if (!target) return;
    const selectedIssues = filteredIssues.filter((i) => selected.has(i.expense.id));
    if (selectedIssues.length === 0) {
      toast.error("Select at least one row to remap.");
      return;
    }
    // Safety: block COGS for expenses whose category default is an Expense account
    if (target.account_type === "cogs") {
      const blocked = selectedIssues.filter(
        (i) => i.suggestedAccount && i.suggestedAccount.account_type === "expense"
      );
      if (blocked.length > 0) {
        toast.error(
          `${blocked.length} row(s) have an Expense-type category default and cannot be remapped to a COGS account.`
        );
        return;
      }
    }
    const changes: PendingChange[] = selectedIssues.map((i) => ({
      expenseId: i.expense.id,
      description: i.expense.description || "(no description)",
      amount: Number(i.expense.amount) || 0,
      fromAccount: i.currentAccount,
      toAccount: target,
    }));
    setPreviewLabel(
      `Remap ${changes.length} selected expense${changes.length === 1 ? "" : "s"} to ${target.account_code} ${target.account_name}`
    );
    setPendingChanges(changes);
    setPreviewOpen(true);
  };

  const cogsAccounts = accounts.filter((a) => a.account_type === "cogs");
  const expenseAccounts = accounts.filter((a) => a.account_type === "expense");

  const renderTable = (rows: Issue[]) => {
    const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.expense.id));
    return (
      <ScrollArea className="h-[420px] rounded-md border">
        <Table>
          <TableHeader className="sticky top-0 bg-background z-10">
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allChecked}
                  onCheckedChange={(c) => selectAllVisible(rows, !!c)}
                  aria-label="Select all"
                />
              </TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Current CoA</TableHead>
              <TableHead>Suggested</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  <CheckCircle2 className="h-5 w-5 inline mr-2 text-emerald-500" />
                  No issues in this category.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((i) => (
                <Fragment key={i.expense.id}>
                <TableRow className="border-b-0">
                  <TableCell>
                    <Checkbox
                      checked={selected.has(i.expense.id)}
                      onCheckedChange={() => toggleSelect(i.expense.id)}
                    />
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{i.expense.expense_date}</TableCell>
                  <TableCell className="max-w-[220px] truncate" title={i.expense.description || ""}>
                    {i.expense.description || <span className="text-muted-foreground">-</span>}
                  </TableCell>
                  <TableCell>
                    {i.category ? (
                      <Badge variant="outline">{i.category.name}</Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">Uncategorized</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {i.currentAccount ? (
                      <span className="text-xs font-mono">
                        {i.currentAccount.account_code} · {i.currentAccount.account_name}
                      </span>
                    ) : (
                      <Badge variant="destructive">Unmapped</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {i.suggestedAccount ? (
                      <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400">
                        {i.suggestedAccount.account_code} · {i.suggestedAccount.account_name}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-xs font-mono">
                    {Number(i.expense.amount).toFixed(2)}
                  </TableCell>
                  <TableCell>
                    {onEditExpense && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => {
                          onOpenChange(false);
                          onEditExpense(i.expense.id);
                        }}
                        aria-label="Edit expense"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableCell />
                  <TableCell colSpan={7} className="py-2">
                    <div className="flex items-start gap-2 text-xs">
                      <Info className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                      <div className="space-y-1 leading-relaxed">
                        <div>
                          <Badge variant={ISSUE_BADGE[i.kind]} className="mr-2 align-middle">
                            {ISSUE_LABEL[i.kind]}
                          </Badge>
                          <span className="font-mono text-[10px] text-muted-foreground mr-2">
                            {i.ruleCode}
                          </span>
                          <span className="text-foreground/90">{i.reason}</span>
                        </div>
                        <div className="text-muted-foreground">
                          <span className="font-medium text-foreground/80">Recommended fix:</span>{" "}
                          {i.recommendation}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
                </Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </ScrollArea>
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <div className="flex items-start justify-between gap-2">
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                Expense → CoA Mapping Audit
              </DialogTitle>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => setScheduleOpen(true)}
              >
                <Mail className="h-3.5 w-3.5" />
                Schedule weekly email
              </Button>
            </div>
            <DialogDescription>
              Review unmapped or inconsistently typed expenses. One-click fixes show a confirmation
              preview before any changes are saved.
            </DialogDescription>
          </DialogHeader>

          {/* Scan scope + filters toolbar */}
          <div className="flex flex-wrap items-center gap-2 -mt-1">
            <span className="text-xs text-muted-foreground">Scan scope:</span>
            <Select value={scanScope} onValueChange={(v) => setScanScope(v as ScanScope)}>
              <SelectTrigger className="w-[200px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2000">Latest 2,000 (fastest)</SelectItem>
                <SelectItem value="5000">Latest 5,000</SelectItem>
                <SelectItem value="10000">Latest 10,000</SelectItem>
                <SelectItem value="all">Entire history (paginated)</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() =>
                queryClient.invalidateQueries({
                  queryKey: ["coa-audit-expenses", restaurantId, scanScope],
                })
              }
              disabled={isLoading}
            >
              Rescan
            </Button>

            <div className="h-5 w-px bg-border mx-1" />

            {/* Issue-type filter */}
            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5">
                  <Filter className="h-3.5 w-3.5" />
                  Issue type
                  {(!enabledKinds.unmapped || !enabledKinds.type_mismatch || !enabledKinds.category_unmapped) && (
                    <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">
                      {[enabledKinds.unmapped, enabledKinds.type_mismatch, enabledKinds.category_unmapped].filter(Boolean).length}/3
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-56 p-2">
                <div className="space-y-2">
                  {(["unmapped", "type_mismatch", "category_unmapped"] as IssueKind[]).map((kind) => (
                    <label
                      key={kind}
                      className="flex items-center gap-2 text-sm cursor-pointer rounded px-1 py-1 hover:bg-muted"
                    >
                      <Checkbox
                        checked={enabledKinds[kind]}
                        onCheckedChange={(c) =>
                          setEnabledKinds((prev) => ({ ...prev, [kind]: !!c }))
                        }
                      />
                      <span className="flex-1">{ISSUE_LABEL[kind]}</span>
                      <Badge variant={ISSUE_BADGE[kind]} className="text-[10px]">
                        {counts[kind]}
                      </Badge>
                    </label>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            {/* Date range filter */}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className={cn("h-8 text-xs gap-1.5", !dateRange?.from && "text-muted-foreground")}
                >
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {dateRange?.from
                    ? dateRange.to
                      ? `${format(dateRange.from, "MMM d")} – ${format(dateRange.to, "MMM d, yyyy")}`
                      : format(dateRange.from, "MMM d, yyyy")
                    : "Date range"}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-0">
                <Calendar
                  mode="range"
                  selected={dateRange}
                  onSelect={setDateRange}
                  numberOfMonths={2}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>

            {activeFilterCount > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-xs gap-1"
                onClick={clearFilters}
              >
                <X className="h-3.5 w-3.5" />
                Clear filters ({activeFilterCount})
              </Button>
            )}

            {scanScope === "all" && (
              <span className="text-xs text-amber-600 dark:text-amber-400 ml-auto">
                Full-history scans may take longer.
              </span>
            )}
          </div>

          {isLoading ? (
            <div className="py-12 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Scanning expenses…
              {scanProgress > 0 && (
                <span className="ml-2 text-xs font-mono">({scanProgress.toLocaleString()} loaded)</span>
              )}
            </div>
          ) : (
            <Tabs defaultValue="unmapped" className="w-full">
              <TabsList>
                <TabsTrigger value="unmapped">
                  Unmapped <Badge variant="destructive" className="ml-2">{filteredCounts.unmapped}</Badge>
                </TabsTrigger>
                <TabsTrigger value="type_mismatch">
                  Type mismatch <Badge variant="secondary" className="ml-2">{filteredCounts.type_mismatch}</Badge>
                </TabsTrigger>
                <TabsTrigger value="category_unmapped">
                  Category gap <Badge variant="outline" className="ml-2">{filteredCounts.category_unmapped}</Badge>
                </TabsTrigger>
              </TabsList>
              <TabsContent value="unmapped" className="mt-3">
                {renderTable(filteredIssues.filter((i) => i.kind === "unmapped"))}
              </TabsContent>
              <TabsContent value="type_mismatch" className="mt-3">
                {renderTable(filteredIssues.filter((i) => i.kind === "type_mismatch"))}
              </TabsContent>
              <TabsContent value="category_unmapped" className="mt-3">
                {renderTable(filteredIssues.filter((i) => i.kind === "category_unmapped"))}
              </TabsContent>
            </Tabs>
          )}

          <div className="flex flex-col gap-3 border-t pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="default"
                size="sm"
                onClick={stageAutoFixAll}
                disabled={autoFixable.length === 0}
                className="gap-1.5"
              >
                <Wand2 className="h-4 w-4" />
                Auto-fix all ({autoFixable.length}) - preview first
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={stageAutoFixSelected}
                disabled={selected.size === 0}
              >
                Auto-fix selected ({selected.size})
              </Button>
              <div className="flex items-center gap-2 ml-auto">
                <Select value={bulkTarget} onValueChange={setBulkTarget}>
                  <SelectTrigger className="w-[280px] h-9">
                    <SelectValue placeholder="Choose target account…" />
                  </SelectTrigger>
                  <SelectContent>
                    {cogsAccounts.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>COGS (5000–)</SelectLabel>
                        {cogsAccounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.account_code} · {a.account_name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                    {expenseAccounts.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Expenses (6000–)</SelectLabel>
                        {expenseAccounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.account_code} · {a.account_name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={stageBulkRemap}
                  disabled={selected.size === 0 || !bulkTarget}
                >
                  Remap selected
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Showing {filteredCounts.total} of {counts.total} issue{counts.total === 1 ? "" : "s"} (
              {expenses.length.toLocaleString()} expenses scanned
              {scanScope === "all" ? ", entire history" : `, latest ${scanScope}`}
              {activeFilterCount > 0 ? `, ${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"} active` : ""}
              ). All actions respect the active filters and show a confirmation preview before saving.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <CoAAuditScheduleDialog open={scheduleOpen} onOpenChange={setScheduleOpen} />

      {/* Confirmation preview step */}
      <Dialog open={previewOpen} onOpenChange={(o) => !applyMutation.isPending && setPreviewOpen(o)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Confirm changes</DialogTitle>
            <DialogDescription>{previewLabel}. Review every row below - nothing has been saved yet.</DialogDescription>
          </DialogHeader>

          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            <span>
              {pendingChanges.length} expense{pendingChanges.length === 1 ? "" : "s"} will be updated.
              Total amount affected:{" "}
              <strong>
                {pendingChanges.reduce((s, c) => s + c.amount, 0).toFixed(2)}
              </strong>
            </span>
          </div>

          <ScrollArea className="h-[380px] rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead>Expense</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead className="w-6" />
                  <TableHead>To</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingChanges.map((c) => (
                  <TableRow key={c.expenseId}>
                    <TableCell className="max-w-[260px] truncate" title={c.description}>
                      {c.description}
                    </TableCell>
                    <TableCell className="text-right text-xs font-mono">
                      {c.amount.toFixed(2)}
                    </TableCell>
                    <TableCell>
                      {c.fromAccount ? (
                        <span className="text-xs font-mono">
                          {c.fromAccount.account_code} · {c.fromAccount.account_name}
                        </span>
                      ) : (
                        <Badge variant="destructive">Unmapped</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </TableCell>
                    <TableCell>
                      <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400">
                        {c.toAccount.account_code} · {c.toAccount.account_name}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPreviewOpen(false)}
              disabled={applyMutation.isPending}
            >
              Back to audit
            </Button>
            <Button
              onClick={() => applyMutation.mutate(pendingChanges)}
              disabled={applyMutation.isPending || pendingChanges.length === 0}
              className="gap-1.5"
            >
              {applyMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Applying…
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Confirm & apply {pendingChanges.length} change{pendingChanges.length === 1 ? "" : "s"}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default ExpenseCoAAuditDialog;