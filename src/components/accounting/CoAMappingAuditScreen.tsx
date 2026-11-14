import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, CheckCircle2, Search, Loader2, Wrench, Hash, Download, History, ShieldAlert, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatDistanceToNow, format as formatDate } from "date-fns";
import { toast } from "sonner";

interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
}

interface CategoryRow {
  id: string;
  name: string;
  account_id: string | null;
  account: Account | null;
}

interface ExpenseLite {
  id: string;
  category_id: string | null;
  account_id: string | null;
}

// Categories may map to operating expenses (6xxx), COGS (5xxx), or
// directly to an inventory asset (1200/1210/1220) when the purchase
// should land on the balance sheet (e.g. raw stock buys).
const ALLOWED_TYPES = new Set(["cogs", "expense", "asset"]);

const TYPE_LABEL: Record<string, string> = {
  asset: "Inventory (Asset)",
  cogs: "COGS",
  expense: "Operating Expense",
};

// Per account_type, the DB CHECK constraint allows codes in [min, max).
const TYPE_CODE_BOUNDS: Record<string, { min: number; max: number }> = {
  asset: { min: 1000, max: 2000 },
  liability: { min: 2000, max: 3000 },
  equity: { min: 3000, max: 4000 },
  revenue: { min: 4000, max: 5000 },
  cogs: { min: 5000, max: 6000 },
  expense: { min: 6000, max: 7000 },
};

export function CoAMappingAuditScreen() {
  const { restaurant, tenant } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [updateBlock, setUpdateBlock] = useState<{
    table: string;
    query: string;
    message: string;
    code?: string;
  } | null>(null);

  const { data: accounts = [], error: accountsError } = useQuery({
    queryKey: ["coa-audit-accounts", tenant?.id],
    queryFn: async (): Promise<Account[]> => {
      if (!tenant?.id) return [];
      const { data, error } = await db
        .from("chart_of_accounts")
        .select("id, account_code, account_name, account_type")
        .eq("tenant_id", tenant.id)
        .eq("is_active", true)
        .order("account_code");
      if (error) throw error;
      return data as Account[];
    },
    enabled: !!tenant?.id,
    retry: false,
  });

  const { data: categories = [], isLoading: loadingCats, error: categoriesError } = useQuery({
    queryKey: ["coa-audit-categories", restaurant?.id],
    queryFn: async (): Promise<CategoryRow[]> => {
      if (!restaurant?.id) return [];
      const { data, error } = await db
        .from("expense_categories")
        .select("id, name, account_id, account:chart_of_accounts(id, account_code, account_name, account_type)")
        .eq("restaurant_id", restaurant.id)
        .order("name");
      if (error) throw error;
      return (data as unknown as CategoryRow[]) || [];
    },
    enabled: !!restaurant?.id,
    retry: false,
  });

  const { data: expenses = [], error: expensesError } = useQuery({
    queryKey: ["coa-audit-expenses", restaurant?.id],
    queryFn: async (): Promise<ExpenseLite[]> => {
      if (!restaurant?.id) return [];
      const { data, error } = await db
        .from("expenses")
        .select("id, category_id, account_id")
        .eq("restaurant_id", restaurant.id)
        .is("deleted_at", null)
        .limit(5000);
      if (error) throw error;
      return (data as ExpenseLite[]) || [];
    },
    enabled: !!restaurant?.id,
    retry: false,
  });

  const eligibleAccounts = useMemo(
    () => accounts.filter((a) => ALLOWED_TYPES.has(a.account_type)),
    [accounts],
  );

  const updateCategory = useMutation({
    mutationFn: async ({ id, account_id }: { id: string; account_id: string | null }) => {
      const { error } = await db
        .from("expense_categories")
        .update({ account_id })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Mapping updated");
      setUpdateBlock(null);
      qc.invalidateQueries({ queryKey: ["coa-audit-categories"] });
    },
    onError: (e: unknown) => {
      const info = describeDbError(e);
      setUpdateBlock({
        table: "public.expense_categories",
        query: "UPDATE public.expense_categories SET account_id = $1 WHERE id = $2",
        message: info.message,
        code: info.code,
      });
      toast.error(
        info.isRls ? "Update blocked by RLS - see warning above" : info.message,
      );
    },
  });

  const rows = useMemo(() => {
    const expensesByCat = new Map<string, ExpenseLite[]>();
    for (const e of expenses) {
      if (!e.category_id) continue;
      const arr = expensesByCat.get(e.category_id) ?? [];
      arr.push(e);
      expensesByCat.set(e.category_id, arr);
    }
    return categories.map((c) => {
      const items = expensesByCat.get(c.id) ?? [];
      const used = items.length;
      const missingOnExpenses = items.filter((e) => !e.account_id).length;
      const typeOk = c.account ? ALLOWED_TYPES.has(c.account.account_type) : false;
      const issues: string[] = [];
      if (!c.account_id) issues.push("Category has no default CoA account");
      else if (!typeOk) issues.push(`Account type "${c.account?.account_type}" is not COGS/Expense`);
      if (missingOnExpenses > 0) issues.push(`${missingOnExpenses} expense(s) missing account_id`);
      return { c, used, missingOnExpenses, typeOk, issues };
    });
  }, [categories, expenses]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.c.name.toLowerCase().includes(q) ||
        r.c.account?.account_code.toLowerCase().includes(q) ||
        r.c.account?.account_name.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const totalCategories = rows.length;
  const unmappedCategories = rows.filter((r) => !r.c.account_id).length;
  const typeMismatch = rows.filter((r) => r.c.account_id && !r.typeOk).length;
  const expensesMissingAccount = expenses.filter((e) => !e.account_id).length;
  const orphanExpenses = expenses.filter((e) => !e.category_id).length;

  return (
    <div className="space-y-4">
      <AccessWarnings
        tenantMissing={!tenant?.id}
        restaurantMissing={!restaurant?.id}
        accountsError={accountsError as Error | null}
        categoriesError={categoriesError as Error | null}
        expensesError={expensesError as Error | null}
        updateBlock={updateBlock}
        onDismissUpdate={() => setUpdateBlock(null)}
      />
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => exportAuditCsv(rows)}
          disabled={rows.length === 0}
        >
          <Download className="h-4 w-4" />
          Export audit
        </Button>
        <RenumberSeriesDialog accounts={accounts} onDone={() => {
          qc.invalidateQueries({ queryKey: ["coa-audit-accounts"] });
          qc.invalidateQueries({ queryKey: ["coa-audit-categories"] });
          qc.invalidateQueries({ queryKey: ["chart-of-accounts"] });
        }} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Categories" value={totalCategories} icon={<Wrench className="h-4 w-4" />} />
        <SummaryCard
          label="Unmapped categories"
          value={unmappedCategories}
          tone={unmappedCategories ? "warn" : "ok"}
        />
        <SummaryCard
          label="Type mismatch"
          value={typeMismatch}
          tone={typeMismatch ? "warn" : "ok"}
        />
        <SummaryCard
          label="Expenses missing account"
          value={expensesMissingAccount}
          tone={expensesMissingAccount ? "warn" : "ok"}
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base font-medium">Category → CoA Mapping</CardTitle>
              <CardDescription>
                Assign each expense category a default Chart of Accounts line. New expenses use this mapping automatically.
              </CardDescription>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search category or account…"
                className="pl-8"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="max-h-[60vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead>Mapped CoA account</TableHead>
                  <TableHead className="text-right">Expenses</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingCats && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                    </TableCell>
                  </TableRow>
                )}
                {!loadingCats && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      No categories found.
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map(({ c, used, missingOnExpenses, typeOk, issues }) => {
                  const ok = !!c.account_id && typeOk && missingOnExpenses === 0;
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>
                        {c.account ? (
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs text-muted-foreground">
                                {c.account.account_code}
                              </span>
                              <Badge variant="outline" className="text-[10px] py-0 h-4">
                                {TYPE_LABEL[c.account.account_type] ?? c.account.account_type}
                              </Badge>
                            </div>
                            <span className="text-sm">{c.account.account_name}</span>
                          </div>
                        ) : (
                          <Badge variant="outline" className="text-amber-600 border-amber-300">
                            Unmapped
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {used}
                        {missingOnExpenses > 0 && (
                          <span className="ml-1 text-xs text-amber-600">
                            ({missingOnExpenses} missing)
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {ok ? (
                          <Badge variant="secondary" className="gap-1 text-emerald-700 bg-emerald-50">
                            <CheckCircle2 className="h-3 w-3" /> OK
                          </Badge>
                        ) : (
                          <div className="flex flex-col gap-1">
                            {issues.map((i) => (
                              <Badge
                                key={i}
                                variant="outline"
                                className="gap-1 text-amber-700 border-amber-300 w-fit"
                              >
                                <AlertTriangle className="h-3 w-3" /> {i}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Select
                          value={c.account_id ?? "__none"}
                          onValueChange={(v) =>
                            updateCategory.mutate({
                              id: c.id,
                              account_id: v === "__none" ? null : v,
                            })
                          }
                        >
                          <SelectTrigger className="w-[260px] ml-auto">
                            <SelectValue placeholder="Choose account…" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">- Unmapped -</SelectItem>
                            <SelectGroup>
                              <SelectLabel>Inventory (Asset)</SelectLabel>
                              {eligibleAccounts
                                .filter((a) => a.account_type === "asset")
                                .map((a) => (
                                  <SelectItem key={a.id} value={a.id}>
                                    {a.account_code} · {a.account_name}
                                  </SelectItem>
                                ))}
                            </SelectGroup>
                            <SelectGroup>
                              <SelectLabel>COGS</SelectLabel>
                              {eligibleAccounts
                                .filter((a) => a.account_type === "cogs")
                                .map((a) => (
                                  <SelectItem key={a.id} value={a.id}>
                                    {a.account_code} · {a.account_name}
                                  </SelectItem>
                                ))}
                            </SelectGroup>
                            <SelectGroup>
                              <SelectLabel>Operating Expense</SelectLabel>
                              {eligibleAccounts
                                .filter((a) => a.account_type === "expense")
                                .map((a) => (
                                  <SelectItem key={a.id} value={a.id}>
                                    {a.account_code} · {a.account_name}
                                  </SelectItem>
                                ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      {orphanExpenses > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2 text-amber-700">
              <AlertTriangle className="h-4 w-4" />
              {orphanExpenses} expense(s) have no category
            </CardTitle>
            <CardDescription>
              These cannot inherit a CoA mapping until assigned to a category. Open the Expenses page to fix them.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <MappingHistoryPanel
        restaurantId={restaurant?.id}
        categories={categories}
        accounts={accounts}
      />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone = "neutral",
  icon,
}: {
  label: string;
  value: number;
  tone?: "neutral" | "ok" | "warn";
  icon?: React.ReactNode;
}) {
  const toneCls =
    tone === "warn"
      ? "text-amber-700"
      : tone === "ok"
        ? "text-emerald-700"
        : "text-foreground";
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          {icon}
        </div>
        <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneCls}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

interface AuditRow {
  c: CategoryRow;
  used: number;
  missingOnExpenses: number;
  typeOk: boolean;
  issues: string[];
}

function exportAuditCsv(rows: AuditRow[]) {
  const header = [
    "Category",
    "Mapped account code",
    "Mapped account name",
    "Account type",
    "Expenses count",
    "Expenses missing account_id",
    "Status",
    "Issues",
  ];
  const escape = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) => {
    const ok = !!r.c.account_id && r.typeOk && r.missingOnExpenses === 0;
    return [
      r.c.name,
      r.c.account?.account_code ?? "",
      r.c.account?.account_name ?? "",
      r.c.account?.account_type ?? "",
      r.used,
      r.missingOnExpenses,
      ok ? "OK" : "Needs attention",
      r.issues.join(" | "),
    ]
      .map(escape)
      .join(",");
  });
  const csv = [header.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `coa-mapping-audit-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast.success(`Exported ${rows.length} categories`);
}

interface MappingHistoryRow {
  id: string;
  category_id: string;
  old_account_id: string | null;
  new_account_id: string | null;
  changed_by: string | null;
  changed_at: string;
}

function MappingHistoryPanel({
  restaurantId,
  categories,
  accounts,
}: {
  restaurantId: string | undefined;
  categories: CategoryRow[];
  accounts: Account[];
}) {
  const { data: history = [], isLoading } = useQuery({
    queryKey: ["coa-mapping-history", restaurantId],
    enabled: !!restaurantId,
    queryFn: async (): Promise<MappingHistoryRow[]> => {
      const { data, error } = await db
        .from("expense_category_mapping_history")
        .select("id, category_id, old_account_id, new_account_id, changed_by, changed_at")
        .eq("restaurant_id", restaurantId!)
        .order("changed_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data as MappingHistoryRow[]) || [];
    },
  });

  const userIds = useMemo(
    () => Array.from(new Set(history.map((h) => h.changed_by).filter(Boolean))) as string[],
    [history],
  );

  const { data: profiles = [] } = useQuery({
    queryKey: ["coa-mapping-history-profiles", userIds.join(",")],
    enabled: userIds.length > 0,
    queryFn: async () => {
      const { data, error } = await db
        .from("profiles")
        .select("id, full_name")
        .in("id", userIds);
      if (error) throw error;
      return data || [];
    },
  });

  const profileById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of profiles) m.set(p.id, p.full_name || "Unknown user");
    return m;
  }, [profiles]);

  const categoryById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) m.set(c.id, c.name);
    return m;
  }, [categories]);

  const accountById = useMemo(() => {
    const m = new Map<string, Account>();
    for (const a of accounts) m.set(a.id, a);
    return m;
  }, [accounts]);

  // Latest change per category for the summary table.
  const latestByCategory = useMemo(() => {
    const m = new Map<string, MappingHistoryRow>();
    for (const h of history) {
      if (!m.has(h.category_id)) m.set(h.category_id, h);
    }
    return m;
  }, [history]);

  const renderAccount = (id: string | null) => {
    if (!id) return <span className="text-muted-foreground italic">Unmapped</span>;
    const a = accountById.get(id);
    if (!a) return <span className="text-muted-foreground">{id.slice(0, 8)}…</span>;
    return (
      <span className="font-mono text-xs">
        {a.account_code} · {a.account_name}
      </span>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <History className="h-4 w-4" /> Mapping history
        </CardTitle>
        <CardDescription>
          Last time each category's CoA mapping was changed and by whom. Tracks the most recent 200 events.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="py-8 text-center">
            <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : history.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No mapping changes recorded yet.
          </div>
        ) : (
          <ScrollArea className="max-h-[60vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead>Last change</TableHead>
                  <TableHead>From → To</TableHead>
                  <TableHead>Changed by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from(latestByCategory.values()).map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="font-medium">
                      {categoryById.get(h.category_id) ?? "Deleted category"}
                    </TableCell>
                    <TableCell title={formatDate(new Date(h.changed_at), "PPpp")}>
                      <span className="text-sm">
                        {formatDistanceToNow(new Date(h.changed_at), { addSuffix: true })}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {renderAccount(h.old_account_id)}
                        <span className="text-muted-foreground">→</span>
                        {renderAccount(h.new_account_id)}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {h.changed_by ? profileById.get(h.changed_by) ?? "Unknown user" : <span className="text-muted-foreground italic">System</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

function RenumberSeriesDialog({
  accounts,
  onDone,
}: {
  accounts: Account[];
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [fromPrefix, setFromPrefix] = useState("12");
  const [toPrefix, setToPrefix] = useState("13");
  const [busy, setBusy] = useState(false);

  const matches = useMemo(
    () => accounts.filter((a) => a.account_code.startsWith(fromPrefix)),
    [accounts, fromPrefix],
  );

  const planned = useMemo(() => {
    return matches.map((a) => {
      const newCode = toPrefix + a.account_code.slice(fromPrefix.length);
      const bounds = TYPE_CODE_BOUNDS[a.account_type];
      const numeric = parseInt(newCode, 10);
      const valid =
        bounds &&
        !Number.isNaN(numeric) &&
        numeric >= bounds.min &&
        numeric < bounds.max &&
        newCode.length === a.account_code.length;
      const collides = accounts.some(
        (b) => b.id !== a.id && b.account_code === newCode,
      );
      return { account: a, newCode, valid: !!valid && !collides, collides };
    });
  }, [matches, toPrefix, fromPrefix, accounts]);

  const blockingCount = planned.filter((p) => !p.valid).length;
  const canRun = matches.length > 0 && blockingCount === 0 && fromPrefix !== toPrefix;

  const run = async () => {
    setBusy(true);
    try {
      // Two-pass to avoid unique-constraint collisions: temp prefix → final.
      const temp = `T${Date.now().toString().slice(-6)}_`;
      for (const p of planned) {
        const tmpCode = temp + p.account.account_code;
        const { error } = await db
          .from("chart_of_accounts")
          .update({ account_code: tmpCode })
          .eq("id", p.account.id);
        if (error) throw error;
      }
      for (const p of planned) {
        const { error } = await db
          .from("chart_of_accounts")
          .update({ account_code: p.newCode })
          .eq("id", p.account.id);
        if (error) throw error;
      }
      toast.success(`Renumbered ${planned.length} account(s) from ${fromPrefix}xx → ${toPrefix}xx`);
      onDone();
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message || "Renumber failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Hash className="h-4 w-4" />
          Renumber series…
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Renumber CoA series</DialogTitle>
          <DialogDescription>
            Move every account whose code starts with one prefix to a new prefix
            (e.g. <code className="font-mono">1200</code> →{" "}
            <code className="font-mono">1300</code>). All downstream mappings stay
            intact because they reference accounts by ID, not code.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              From prefix
            </label>
            <Input
              value={fromPrefix}
              onChange={(e) => setFromPrefix(e.target.value.replace(/\D/g, ""))}
              placeholder="e.g. 12"
              className="font-mono"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              To prefix
            </label>
            <Input
              value={toPrefix}
              onChange={(e) => setToPrefix(e.target.value.replace(/\D/g, ""))}
              placeholder="e.g. 13"
              className="font-mono"
            />
          </div>
        </div>

        <ScrollArea className="max-h-72 rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Current</TableHead>
                <TableHead>New</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {planned.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-muted-foreground text-sm">
                    No accounts match prefix "{fromPrefix}".
                  </TableCell>
                </TableRow>
              )}
              {planned.map((p) => (
                <TableRow key={p.account.id}>
                  <TableCell className="text-sm">{p.account.account_name}</TableCell>
                  <TableCell className="font-mono text-xs">{p.account.account_code}</TableCell>
                  <TableCell className="font-mono text-xs">{p.newCode}</TableCell>
                  <TableCell>
                    {p.valid ? (
                      <Badge variant="secondary" className="gap-1">
                        <CheckCircle2 className="h-3 w-3" /> OK
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1 text-amber-700 border-amber-300">
                        <AlertTriangle className="h-3 w-3" />
                        {p.collides ? "Code already exists" : "Out of range for type"}
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={run} disabled={!canRun || busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Renumber {planned.length} account{planned.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Access / RLS warning surface ------------------------------------------

interface DbErrorInfo {
  message: string;
  code?: string;
  isRls: boolean;
  isMissingTable: boolean;
}

function describeDbError(err: unknown): DbErrorInfo {
  const e = (err ?? {}) as { message?: string; code?: string; details?: string; hint?: string };
  const message = e.message || "Unknown error";
  const code = e.code;
  // PostgREST / Postgres signals for RLS blocks:
  // - 42501  insufficient_privilege
  // - PGRST301 / PGRST116 row not found (often RLS-filtered)
  // - "new row violates row-level security policy"
  // - "permission denied for table"
  const text = `${message} ${e.details ?? ""} ${e.hint ?? ""}`.toLowerCase();
  const isRls =
    code === "42501" ||
    code === "PGRST301" ||
    text.includes("row-level security") ||
    text.includes("row level security") ||
    text.includes("permission denied");
  const isMissingTable = text.includes("does not exist") || code === "42P01";
  return { message, code, isRls, isMissingTable };
}

function AccessWarnings({
  tenantMissing,
  restaurantMissing,
  accountsError,
  categoriesError,
  expensesError,
  updateBlock,
  onDismissUpdate,
}: {
  tenantMissing: boolean;
  restaurantMissing: boolean;
  accountsError: Error | null;
  categoriesError: Error | null;
  expensesError: Error | null;
  updateBlock: { table: string; query: string; message: string; code?: string } | null;
  onDismissUpdate: () => void;
}) {
  const readBlocks: Array<{
    label: string;
    table: string;
    query: string;
    info: DbErrorInfo;
  }> = [];
  if (accountsError) {
    readBlocks.push({
      label: "Read Chart of Accounts",
      table: "public.chart_of_accounts",
      query:
        "SELECT id, account_code, account_name, account_type FROM public.chart_of_accounts WHERE tenant_id = <tenant> AND is_active = true",
      info: describeDbError(accountsError),
    });
  }
  if (categoriesError) {
    readBlocks.push({
      label: "Read expense categories",
      table: "public.expense_categories",
      query:
        "SELECT id, name, account_id, account:chart_of_accounts(...) FROM public.expense_categories WHERE restaurant_id = <restaurant>",
      info: describeDbError(categoriesError),
    });
  }
  if (expensesError) {
    readBlocks.push({
      label: "Read expenses (for usage counts)",
      table: "public.expenses",
      query:
        "SELECT id, category_id, account_id FROM public.expenses WHERE restaurant_id = <restaurant> AND deleted_at IS NULL",
      info: describeDbError(expensesError),
    });
  }

  if (
    !tenantMissing &&
    !restaurantMissing &&
    readBlocks.length === 0 &&
    !updateBlock
  ) {
    return null;
  }

  return (
    <Card className="border-amber-300 bg-amber-50/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2 text-amber-800">
          <ShieldAlert className="h-4 w-4" />
          Access issue detected
        </CardTitle>
        <CardDescription>
          One or more queries on this screen could not run. Fix the listed RLS
          policy or tenant configuration to restore mapping reads/updates.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {(tenantMissing || restaurantMissing) && (
          <div className="rounded border border-amber-300 bg-background p-3 text-sm">
            <div className="font-medium text-amber-800">
              Tenant context unavailable
            </div>
            <p className="mt-1 text-muted-foreground">
              Your profile is missing{" "}
              {tenantMissing && <code className="font-mono">tenant_id</code>}
              {tenantMissing && restaurantMissing && " and "}
              {restaurantMissing && (
                <code className="font-mono">restaurant_id</code>
              )}
              . All RLS policies on{" "}
              <code className="font-mono">chart_of_accounts</code>,{" "}
              <code className="font-mono">expense_categories</code> and{" "}
              <code className="font-mono">expenses</code> filter on these
              columns, so reads return empty until the profile is linked.
            </p>
          </div>
        )}

        {readBlocks.map((b) => (
          <BlockedQueryRow
            key={b.label}
            kind="read"
            label={b.label}
            table={b.table}
            query={b.query}
            message={b.info.message}
            code={b.info.code}
            isRls={b.info.isRls}
            isMissingTable={b.info.isMissingTable}
          />
        ))}

        {updateBlock && (
          <BlockedQueryRow
            kind="write"
            label="Update category mapping"
            table={updateBlock.table}
            query={updateBlock.query}
            message={updateBlock.message}
            code={updateBlock.code}
            isRls={
              describeDbError({
                message: updateBlock.message,
                code: updateBlock.code,
              }).isRls
            }
            isMissingTable={false}
            onDismiss={onDismissUpdate}
          />
        )}
      </CardContent>
    </Card>
  );
}

function BlockedQueryRow({
  kind,
  label,
  table,
  query,
  message,
  code,
  isRls,
  isMissingTable,
  onDismiss,
}: {
  kind: "read" | "write";
  label: string;
  table: string;
  query: string;
  message: string;
  code?: string;
  isRls: boolean;
  isMissingTable: boolean;
  onDismiss?: () => void;
}) {
  const reason = isRls
    ? `RLS policy on ${table} blocks ${kind === "read" ? "SELECT" : "UPDATE"}`
    : isMissingTable
      ? `Table ${table} not found in this project`
      : `Database error on ${table}`;

  return (
    <div className="rounded border border-amber-300 bg-background p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-amber-800">{label}</div>
          <div className="text-xs text-muted-foreground">{reason}</div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] py-0 h-5">
            {kind === "read" ? "SELECT" : "UPDATE"}
          </Badge>
          {code && (
            <Badge variant="outline" className="font-mono text-[10px] py-0 h-5">
              {code}
            </Badge>
          )}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-[120px_1fr] text-xs">
        <span className="text-muted-foreground">Table</span>
        <code className="font-mono">{table}</code>
        <span className="text-muted-foreground">Query</span>
        <code className="font-mono break-all">{query}</code>
        <span className="text-muted-foreground">Error</span>
        <code className="font-mono break-all text-amber-800">{message}</code>
      </div>
      {isRls && (
        <p className="mt-2 text-xs text-muted-foreground">
          Ensure the role used by this user has a policy granting{" "}
          {kind === "read" ? "SELECT" : "UPDATE"} on{" "}
          <code className="font-mono">{table}</code> for rows where{" "}
          <code className="font-mono">tenant_id</code> /{" "}
          <code className="font-mono">restaurant_id</code> matches the current
          context.
        </p>
      )}
    </div>
  );
}