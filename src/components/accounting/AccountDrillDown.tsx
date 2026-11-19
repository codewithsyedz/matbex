import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { Skeleton } from "@/components/ui/skeleton";
import { DateRangePicker } from "@/components/reports/DateRangePicker";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { useCurrency } from "@/hooks/useCurrency";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useFiscalSettings, getFiscalMonthRange } from "@/hooks/useFiscalSettings";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { format } from "date-fns";
import { DateRange } from "react-day-picker";
import {
  TrendingUp,
  TrendingDown,
  Search,
  PieChart,
  Target,
  Receipt,
  CalendarClock,
} from "lucide-react";

/**
 * Generic Account Drill-Down: defaults to 5003 (Dairy Cost) when present.
 * Shows ledger transactions for a single CoA account, totals, linked shifts /
 * COGS submissions, and variance vs a configurable % of revenue target.
 */
export function AccountDrillDown() {
  const { profile, restaurant } = useAuth();
  const {
    branches,
    hasMultipleBranches,
    activeBranchId,
    setActiveBranchId,
    canSwitchBranches,
    pinnedBranchId,
  } = useBranch();
  const branchKey =
    pinnedBranchId ??
    (activeBranchId && activeBranchId !== "all" ? activeBranchId : null);
  const { accounts, isLoading: loadingAccounts, isVisibleForBranch } = useChartOfAccounts();
  const visibleAccounts = accounts.filter((a) =>
    isVisibleForBranch(a.id, branchKey),
  );
  const { format: formatCurrency } = useCurrency();
  const { monthStartDay } = useFiscalSettings();

  // Default to fiscal month
  const fiscalRange = useMemo(
    () => getFiscalMonthRange(new Date(), monthStartDay),
    [monthStartDay]
  );
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: fiscalRange.start,
    to: fiscalRange.end,
  });

  // Default account: 5003 if it exists, otherwise first COGS, else first account
  const defaultAccountId = useMemo(() => {
    if (!accounts.length) return undefined;
    const dairy = accounts.find((a) => a.account_code === "5003");
    if (dairy) return dairy.id;
    const firstCogs = accounts.find((a) => a.account_type === "cogs");
    return firstCogs?.id ?? accounts[0].id;
  }, [accounts]);

  const [accountId, setAccountId] = useState<string | undefined>(undefined);
  const selectedAccountId = accountId ?? defaultAccountId;
  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);

  // % of revenue target (e.g., 5% = dairy should be ≤ 5% of net sales)
  const [targetPct, setTargetPct] = useState<string>("5");
  const targetPctNum = parseFloat(targetPct) || 0;

  const [searchTerm, setSearchTerm] = useState("");

  const fromIso = dateRange?.from
    ? format(dateRange.from, "yyyy-MM-dd")
    : undefined;
  const toIso = dateRange?.to
    ? format(dateRange.to, "yyyy-MM-dd")
    : fromIso;

  // Fetch ledger transactions for the selected account in range
  const { data: transactions = [], isLoading: loadingTx } = useQuery({
    queryKey: [
      "account-drilldown-tx",
      profile?.tenant_id,
      selectedAccountId,
      fromIso,
      toIso,
      branchKey,
    ],
    queryFn: async () => {
      if (!profile?.tenant_id || !selectedAccountId || !fromIso || !toIso)
        return [];
      let q = db
        .from("account_transactions")
        .select("*, branch:branches!account_transactions_branch_id_fkey(id, name, code)")
        .eq("tenant_id", profile.tenant_id)
        .eq("account_id", selectedAccountId)
        .gte("transaction_date", fromIso)
        .lte("transaction_date", toIso)
        .order("transaction_date", { ascending: false })
        .limit(500);
      if (branchKey) q = q.eq("branch_id", branchKey);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!profile?.tenant_id && !!selectedAccountId && !!fromIso && !!toIso,
  });

  // Fetch net sales for variance calc
  const { data: salesData } = useQuery({
    queryKey: ["account-drilldown-sales", restaurant?.id, fromIso, toIso],
    queryFn: async () => {
      if (!restaurant?.id || !fromIso || !toIso) return { total: 0 };
      const { data, error } = await db
        .from("daily_sales_summary")
        .select("total_sales")
        .eq("restaurant_id", restaurant.id)
        .gte("sales_date", fromIso)
        .lte("sales_date", toIso);
      if (error) throw error;
      const total = (data ?? []).reduce(
        (sum, r: any) => sum + (Number(r.total_sales) || 0),
        0
      );
      return { total };
    },
    enabled: !!restaurant?.id && !!fromIso && !!toIso,
  });

  // Fetch linked COGS submissions (via shift_id) for context
  const shiftIds = useMemo(
    () =>
      Array.from(
        new Set(
          transactions
            .filter((t: any) => t.reference_type === "cogs_submission")
            .map((t: any) => t.reference_id)
            .filter(Boolean)
        )
      ),
    [transactions]
  );

  const { data: linkedSubmissions = [] } = useQuery({
    queryKey: ["account-drilldown-cogs-subs", shiftIds.join(",")],
    queryFn: async () => {
      if (!shiftIds.length) return [];
      const { data, error } = await db
        .from("daily_cogs_submissions")
        .select(
          "id, submission_date, shift_type, cashier_name, cogs, total_sales, food_cost_percentage, status"
        )
        .in("id", shiftIds);
      if (error) throw error;
      return data ?? [];
    },
    enabled: shiftIds.length > 0,
  });

  // Totals
  const totals = useMemo(() => {
    const debits = transactions.reduce(
      (sum: number, t: any) =>
        t.is_voided ? sum : sum + (Number(t.debit) || 0),
      0
    );
    const credits = transactions.reduce(
      (sum: number, t: any) =>
        t.is_voided ? sum : sum + (Number(t.credit) || 0),
      0
    );
    // For expense/COGS accounts: net = debits - credits
    const net = debits - credits;
    const count = transactions.filter((t: any) => !t.is_voided).length;
    return { debits, credits, net, count };
  }, [transactions]);

  const netSales = salesData?.total ?? 0;
  const actualPct = netSales > 0 ? (totals.net / netSales) * 100 : 0;
  const budgetAmount = (netSales * targetPctNum) / 100;
  const variance = totals.net - budgetAmount;
  const variancePct = budgetAmount > 0 ? (variance / budgetAmount) * 100 : 0;
  const isOverBudget = variance > 0;

  const filteredTx = transactions.filter((t: any) => {
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return (
      (t.description || "").toLowerCase().includes(q) ||
      (t.reference_type || "").toLowerCase().includes(q)
    );
  });

  const isLoading = loadingAccounts || loadingTx;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <PieChart className="h-5 w-5" />
            Account Drill-Down
          </CardTitle>
          <CardDescription>
            Inspect ledger activity, linked shifts, and budget variance for any
            CoA account. Defaults to <strong>5003 - Dairy Cost</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            {hasMultipleBranches && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Branch
                </label>
                {canSwitchBranches ? (
                  <Select
                    value={activeBranchId === null ? "all" : activeBranchId}
                    onValueChange={(v) => setActiveBranchId(v as string | "all")}
                  >
                    <SelectTrigger className="w-[200px]">
                      <SelectValue placeholder="Branch" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All branches</SelectItem>
                      {branches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="inline-flex items-center h-10 px-3 rounded-md border border-input bg-muted/40 text-sm w-[200px]">
                    <span className="truncate">
                      {branches.find((b) => b.id === pinnedBranchId)?.name ?? "Branch"}
                    </span>
                  </div>
                )}
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Account
              </label>
              <Select
                value={selectedAccountId ?? ""}
                onValueChange={(v) => setAccountId(v)}
              >
                <SelectTrigger className="w-[300px]">
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {visibleAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <span className="font-mono text-xs mr-2">
                        {a.account_code}
                      </span>
                      {a.account_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Date range
              </label>
              <DateRangePicker
                dateRange={dateRange}
                onDateRangeChange={setDateRange}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Target (% of revenue)
              </label>
              <div className="relative">
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={targetPct}
                  onChange={(e) => setTargetPct(e.target.value)}
                  className="w-[140px] pr-7"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  %
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <SummaryCard
          icon={<Receipt className="h-4 w-4" />}
          label="Net Posted"
          value={formatCurrency(totals.net)}
          sub={`${totals.count} transaction${totals.count === 1 ? "" : "s"}`}
        />
        <SummaryCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Net Sales (period)"
          value={formatCurrency(netSales)}
          sub={
            actualPct > 0
              ? `${actualPct.toFixed(2)}% of revenue`
              : "No sales in range"
          }
        />
        <SummaryCard
          icon={<Target className="h-4 w-4" />}
          label={`Budget (${targetPctNum}% of revenue)`}
          value={formatCurrency(budgetAmount)}
          sub="Target ceiling"
        />
        <SummaryCard
          icon={
            isOverBudget ? (
              <TrendingUp className="h-4 w-4 text-destructive" />
            ) : (
              <TrendingDown className="h-4 w-4 text-green-600" />
            )
          }
          label="Variance vs Budget"
          value={`${variance >= 0 ? "+" : ""}${formatCurrency(variance)}`}
          sub={
            budgetAmount > 0
              ? `${variancePct >= 0 ? "+" : ""}${variancePct.toFixed(1)}% vs target`
              : "Set a target %"
          }
          tone={isOverBudget ? "danger" : "success"}
        />
      </div>

      {/* Linked shifts / COGS submissions */}
      {linkedSubmissions.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <CalendarClock className="h-4 w-4" />
              Linked Shifts &amp; COGS Submissions
            </CardTitle>
            <CardDescription>
              Shifts where {selectedAccount?.account_name ?? "this account"} was
              posted via daily COGS.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Shift</TableHead>
                    <TableHead>Cashier</TableHead>
                    <TableHead className="text-right">COGS</TableHead>
                    <TableHead className="text-right">Sales</TableHead>
                    <TableHead className="text-right">Food Cost %</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linkedSubmissions.map((s: any) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono text-xs">
                        {format(new Date(s.submission_date), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell className="capitalize text-sm">
                        {s.shift_type}
                      </TableCell>
                      <TableCell className="text-sm">
                        {s.cashier_name}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(Number(s.cogs) || 0)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(Number(s.total_sales) || 0)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {Number(s.food_cost_percentage || 0).toFixed(1)}%
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs capitalize">
                          {s.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Transactions */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-medium">Recent Transactions</CardTitle>
              <CardDescription>
                {selectedAccount ? (
                  <>
                    <span className="font-mono">
                      {selectedAccount.account_code}
                    </span>{" "}
                    - {selectedAccount.account_name}
                  </>
                ) : (
                  "Pick an account"
                )}
              </CardDescription>
            </div>
            <div className="relative w-full md:w-[260px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search description / source"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTx.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="text-center py-8 text-muted-foreground text-sm"
                      >
                        No transactions in this range
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredTx.slice(0, 200).map((t: any) => (
                      <TableRow
                        key={t.id}
                        className={t.is_voided ? "opacity-50" : ""}
                      >
                        <TableCell className="font-mono text-xs">
                          {format(new Date(t.transaction_date), "MMM d, yyyy")}
                        </TableCell>
                        <TableCell className="text-sm max-w-[280px] truncate">
                          {t.description || "-"}
                        </TableCell>
                        <TableCell>
                          {t.reference_type ? (
                            <Badge
                              variant="outline"
                              className="text-xs capitalize"
                            >
                              {t.reference_type.replace(/_/g, " ")}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              -
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {t.debit
                            ? formatCurrency(Number(t.debit))
                            : "-"}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {t.credit
                            ? formatCurrency(Number(t.credit))
                            : "-"}
                        </TableCell>
                        <TableCell>
                          {t.is_voided ? (
                            <Badge variant="destructive" className="text-xs">
                              Voided
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">
                              Posted
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
          {filteredTx.length > 200 && (
            <p className="text-xs text-muted-foreground text-center mt-3">
              Showing first 200 of {filteredTx.length} transactions
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: "danger" | "success";
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {icon}
          <span>{label}</span>
        </div>
        <div
          className={
            "text-xl font-semibold mt-1 " +
            (tone === "danger"
              ? "text-destructive"
              : tone === "success"
                ? "text-green-600"
                : "")
          }
        >
          {value}
        </div>
        {sub && (
          <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
        )}
      </CardContent>
    </Card>
  );
}