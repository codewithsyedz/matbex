import { ApPostingBreakdownCard } from "./ApPostingBreakdownCard";
import { useState } from "react";
import { useDragScroll } from "@/hooks/useDragScroll";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { BranchBadge } from "@/components/branch/BranchBadge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BookOpen,
  Search,
  Ban,
  Loader2,
  ArrowUpRight,
  ArrowDownRight,
  Shield,
  Filter,
  Download,
  Lock,
  Undo2,
  X,
  CalendarRange,
  AlertCircle,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  settlementKindOf,
  settlementLockReason,
  SETTLEMENT_LOCK_LABEL,
  type SettlementKind,
} from "@/lib/apSettlement";
import {
  useAccountTransactions,
  AccountTransaction,
} from "@/hooks/useAccountTransactions";
import { useAccountOpeningBalance } from "@/hooks/useAccountOpeningBalance";
import { useJournalEntries } from "@/hooks/useJournalEntries";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { useFiscalPeriodLocks } from "@/hooks/useFiscalPeriodLocks";
import { useCurrency } from "@/hooks/useCurrency";
import { useBranch } from "@/contexts/BranchContext";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";

interface TransactionLedgerProps {
  initialBatchId?: string | null;
}

export function TransactionLedger({ initialBatchId }: TransactionLedgerProps = {}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [accountFilter, setAccountFilter] = useState<string>("all");
  // Scope the fetch to the selected account so its full history loads,
  // instead of relying on a tenant-wide page of the most recent rows.
  const { transactions, isLoading, meta } = useAccountTransactions(
    accountFilter !== "all" ? accountFilter : undefined,
  );
  const { voidTransaction, isVoiding } = useJournalEntries();
  const { accounts, isVisibleForBranch } = useChartOfAccounts();
  const { isDateLocked } = useFiscalPeriodLocks();
  const { format: formatCurrency } = useCurrency();
  const {
    branches,
    hasMultipleBranches,
    activeBranchId,
    activeBranch,
    isAllBranches,
    setActiveBranchId,
    canSwitchBranches,
    pinnedBranchId,
  } = useBranch();

  const branchScopeLabel =
    isAllBranches || !activeBranchId
      ? "All branches"
      : activeBranch?.name ?? "Branch";
  const visibleAccounts = accounts.filter((a) =>
    isVisibleForBranch(a.id, activeBranchId ?? null)
  );

  const [batchFilter, setBatchFilter] = useState<string | null>(initialBatchId ?? null);
  const [showVoided, setShowVoided] = useState(false);
  const [voidingTx, setVoidingTx] = useState<AccountTransaction | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [lockedTx, setLockedTx] = useState<AccountTransaction | null>(null);
  const { ref: scrollRef, isDragging, dragHandlers } = useDragScroll<HTMLDivElement>();

  // Filter transactions
  const filteredTransactions = transactions.filter((tx) => {
    // Voided filter
    if (!showVoided && tx.is_voided) return false;

    // Account filter
    if (accountFilter !== "all" && tx.account_id !== accountFilter)
      return false;

    // Batch filter (jump-to-batch from pending entries / elsewhere)
    if (batchFilter && tx.batch_id !== batchFilter) return false;

    // Search filter
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      const matchesDescription = tx.description?.toLowerCase().includes(search);
      const matchesAccount = tx.account?.account_name
        .toLowerCase()
        .includes(search);
      const matchesCode = tx.account?.account_code
        .toLowerCase()
        .includes(search);
      if (!matchesDescription && !matchesAccount && !matchesCode) return false;
    }

    return true;
  });

  // ---- Opening / movement / closing for a single selected account ----
  const selectedAccount =
    accountFilter !== "all"
      ? accounts.find((a) => a.id === accountFilter) ?? null
      : null;
  const normalSide: "debit" | "credit" =
    selectedAccount &&
    ["liability", "equity", "revenue"].includes(selectedAccount.account_type)
      ? "credit"
      : "debit";

  const activeRows = filteredTransactions.filter((tx) => !tx.is_voided);

  // Fixed column widths so ledger columns never clip and horizontal scroll is consistent
  const LEDGER_COL_WIDTHS = {
    date: 110,
    account: 220,
    branch: 140,
    description: 320,
    debit: 120,
    credit: 120,
    balance: 130,
    status: 110,
    actions: 80,
  } as const;
  const ledgerTableMinWidth =
    LEDGER_COL_WIDTHS.date +
    LEDGER_COL_WIDTHS.account +
    (hasMultipleBranches ? LEDGER_COL_WIDTHS.branch : 0) +
    LEDGER_COL_WIDTHS.description +
    LEDGER_COL_WIDTHS.debit +
    LEDGER_COL_WIDTHS.credit +
    (selectedAccount ? LEDGER_COL_WIDTHS.balance : 0) +
    LEDGER_COL_WIDTHS.status +
    LEDGER_COL_WIDTHS.actions;
  const earliestDate = activeRows.length
    ? activeRows
        .map((tx) => tx.transaction_date.slice(0, 10))
        .reduce((a, b) => (a < b ? a : b))
    : null;
  const branchScopeId =
    pinnedBranchId ?? (activeBranchId && !isAllBranches ? activeBranchId : null);

  const { openingDebit, openingCredit } = useAccountOpeningBalance(
    selectedAccount ? selectedAccount.id : null,
    selectedAccount ? earliestDate : null,
    branchScopeId,
  );

  const openingBalance =
    normalSide === "debit"
      ? openingDebit - openingCredit
      : openingCredit - openingDebit;
  const periodDebit = activeRows.reduce((s, tx) => s + Number(tx.debit ?? 0), 0);
  const periodCredit = activeRows.reduce((s, tx) => s + Number(tx.credit ?? 0), 0);
  const periodMovement =
    normalSide === "debit" ? periodDebit - periodCredit : periodCredit - periodDebit;
  const closingBalance = openingBalance + periodMovement;

  // Running balance per transaction (oldest → newest), keyed by tx id.
  const runningBalances = new Map<string, number>();
  if (selectedAccount) {
    const ascending = [...activeRows].sort((a, b) =>
      a.transaction_date === b.transaction_date
        ? a.created_at.localeCompare(b.created_at)
        : a.transaction_date.localeCompare(b.transaction_date),
    );
    let run = openingBalance;
    for (const tx of ascending) {
      const delta =
        normalSide === "debit"
          ? Number(tx.debit ?? 0) - Number(tx.credit ?? 0)
          : Number(tx.credit ?? 0) - Number(tx.debit ?? 0);
      run += delta;
      runningBalances.set(tx.id, run);
    }
  }

  const sideLabel = (value: number) => {
    const side = value >= 0 ? normalSide : normalSide === "debit" ? "credit" : "debit";
    return side === "debit" ? "Dr" : "Cr";
  };

  const handleVoid = () => {
    if (!voidingTx || !voidReason.trim()) return;
    voidTransaction.mutate(
      { transactionId: voidingTx.id, reason: voidReason },
      {
        onSuccess: () => {
          setVoidingTx(null);
          setVoidReason("");
        },
      }
    );
  };

  const canVoidTransaction = (tx: AccountTransaction): boolean => {
    if (tx.is_voided) return false;
    // Posted AP settlement / reversal entries are immutable — reversal only.
    if (settlementKindOf(tx.batch?.reference_number)) return false;
    const txDate = new Date(tx.transaction_date);
    return !isDateLocked(txDate);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Transaction Ledger</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="grid lg:grid-cols-3 gap-6 min-w-0">
        <div className="lg:col-span-2 min-w-0">
          <Card className="min-w-0 overflow-hidden">
            <CardHeader className="pb-3">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-base font-medium flex items-center gap-2">
                    <BookOpen className="h-5 w-5" />
                    Transaction Ledger
                  </CardTitle>
                  <CardDescription>
                    Immutable record of all financial transactions. Void
                    transactions to correct errors.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 min-w-0">
              {/* Filters */}
              <div className="flex flex-wrap gap-3">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search transactions..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9"
                  />
                </div>
                {hasMultipleBranches &&
                  (canSwitchBranches ? (
                    <Select
                      value={activeBranchId === null ? "all" : activeBranchId}
                      onValueChange={(v) =>
                        setActiveBranchId(v as string | "all")
                      }
                    >
                      <SelectTrigger className="w-[200px]">
                        <Filter className="h-4 w-4 mr-2" />
                        <SelectValue placeholder="Filter by branch" />
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
                    <div className="inline-flex items-center gap-2 h-10 px-3 rounded-md border border-input bg-muted/40 text-sm">
                      <Filter className="h-4 w-4 text-muted-foreground" />
                      <span className="truncate max-w-[160px]">
                        {branches.find((b) => b.id === pinnedBranchId)?.name ??
                          "Branch"}
                      </span>
                    </div>
                  ))}
                <Select value={accountFilter} onValueChange={setAccountFilter}>
                  <SelectTrigger className="w-[200px]">
                    <Filter className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="Filter by account" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Accounts</SelectItem>
                    {visibleAccounts.map((acc) => (
                      <SelectItem key={acc.id} value={acc.id}>
                        <span className="font-mono text-xs mr-1">
                          {acc.account_code}
                        </span>
                        {acc.account_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant={showVoided ? "secondary" : "outline"}
                  onClick={() => setShowVoided(!showVoided)}
                  className="gap-1"
                >
                  <Ban className="h-4 w-4" />
                  {showVoided ? "Hide Voided" : "Show Voided"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    const meta = [`Branch,${branchScopeLabel}`, ""];
                    const header = [
                      "Date",
                      "Code",
                      "Account",
                      "Branch",
                      "Description",
                      "Debit",
                      "Credit",
                      "Status",
                    ];
                    if (selectedAccount) {
                      meta.splice(1, 0, `Account,${selectedAccount.account_code} ${selectedAccount.account_name}`);
                      meta.splice(
                        2,
                        0,
                        `Opening Balance,${Math.abs(openingBalance).toFixed(2)} ${sideLabel(openingBalance)}`,
                        `Closing Balance,${Math.abs(closingBalance).toFixed(2)} ${sideLabel(closingBalance)}`,
                      );
                      header.push("Running Balance", "Balance Side");
                    }
                    const lines = [...meta, header.join(",")];
                    for (const tx of filteredTransactions) {
                      const row = [
                          format(new Date(tx.transaction_date), "yyyy-MM-dd"),
                          tx.account?.account_code ?? "",
                          `"${(tx.account?.account_name ?? "").replace(
                            /"/g,
                            '""'
                          )}"`,
                          `"${(tx.branch?.name ?? "").replace(/"/g, '""')}"`,
                          `"${(tx.description ?? "").replace(/"/g, '""')}"`,
                          (tx.debit ?? 0).toFixed(2),
                          (tx.credit ?? 0).toFixed(2),
                          tx.is_voided ? "voided" : "active",
                      ];
                      if (selectedAccount) {
                        const bal = runningBalances.get(tx.id);
                        row.push(
                          bal === undefined ? "" : Math.abs(bal).toFixed(2),
                          bal === undefined ? "" : sideLabel(bal),
                        );
                      }
                      lines.push(row.join(","));
                    }
                    const blob = new Blob([lines.join("\n")], {
                      type: "text/csv",
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    const safe = branchScopeLabel
                      .replace(/[^a-z0-9]+/gi, "-")
                      .toLowerCase();
                    a.href = url;
                    a.download = `transaction-ledger_${safe}_${new Date()
                      .toISOString()
                      .slice(0, 10)}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="gap-1"
                >
                  <Download className="h-4 w-4" />
                  Export CSV
                </Button>
              </div>

              {batchFilter && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Filter className="h-4 w-4 text-primary" />
                    <span>
                      Showing ledger lines for batch{" "}
                      <span className="font-mono">{batchFilter.slice(0, 8)}…</span>
                    </span>
                    <Badge variant="secondary" className="font-mono">
                      {filteredTransactions.length} line
                      {filteredTransactions.length === 1 ? "" : "s"}
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1 text-muted-foreground hover:text-foreground"
                    onClick={() => setBatchFilter(null)}
                  >
                    <X className="h-4 w-4" />
                    Clear batch filter
                  </Button>
                </div>
              )}

              {/* Transaction Table */}
              {selectedAccount && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 rounded-lg border bg-muted/30 p-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Opening balance</p>
                    <p className="text-sm font-semibold tabular-nums">
                      {formatCurrency(Math.abs(openingBalance))} {sideLabel(openingBalance)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {earliestDate ? `Before ${earliestDate}` : "No activity"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total debit</p>
                    <p className="text-sm font-semibold tabular-nums text-green-600">
                      {formatCurrency(periodDebit)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total credit</p>
                    <p className="text-sm font-semibold tabular-nums text-red-600">
                      {formatCurrency(periodCredit)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Closing balance</p>
                    <p className="text-sm font-semibold tabular-nums">
                      {formatCurrency(Math.abs(closingBalance))} {sideLabel(closingBalance)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Opening {sideLabel(openingBalance)} + movement
                    </p>
                  </div>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground lg:hidden">
                Swipe or drag sideways to see more columns.
              </p>
              <div className="border rounded-lg overflow-hidden w-full max-w-full min-w-0">
                <div
                  ref={scrollRef}
                  {...dragHandlers}
                  className={`h-[560px] w-full max-w-full overflow-auto overscroll-x-contain touch-pan-x touch-pan-y [-webkit-overflow-scrolling:touch] [&>div]:overflow-visible ${
                    isDragging ? "cursor-grabbing select-none" : "md:cursor-grab"
                  }`}
                >
                  <Table
                    className="table-fixed"
                    style={{ minWidth: `${ledgerTableMinWidth}px`, width: `${ledgerTableMinWidth}px` }}
                  >
                    <TableHeader className="sticky top-0 z-20 bg-background shadow-[inset_0_-1px_0_hsl(var(--border))]">
                      <TableRow>
                        <TableHead
                          className="bg-background sticky left-0 z-30 whitespace-nowrap shadow-[inset_-1px_0_0_hsl(var(--border))]"
                          style={{ width: LEDGER_COL_WIDTHS.date }}
                        >
                          Date
                        </TableHead>
                        <TableHead className="bg-background whitespace-nowrap" style={{ width: LEDGER_COL_WIDTHS.account }}>Account</TableHead>
                        {hasMultipleBranches && (
                          <TableHead className="bg-background whitespace-nowrap" style={{ width: LEDGER_COL_WIDTHS.branch }}>Branch</TableHead>
                        )}
                        <TableHead className="bg-background whitespace-nowrap" style={{ width: LEDGER_COL_WIDTHS.description }}>Description</TableHead>
                        <TableHead className="text-right bg-background whitespace-nowrap" style={{ width: LEDGER_COL_WIDTHS.debit }}>Debit</TableHead>
                        <TableHead className="text-right bg-background whitespace-nowrap" style={{ width: LEDGER_COL_WIDTHS.credit }}>Credit</TableHead>
                        {selectedAccount && (
                          <TableHead className="text-right bg-background whitespace-nowrap" style={{ width: LEDGER_COL_WIDTHS.balance }}>Balance</TableHead>
                        )}
                        <TableHead className="bg-background whitespace-nowrap" style={{ width: LEDGER_COL_WIDTHS.status }}>Status</TableHead>
                        <TableHead className="bg-background" style={{ width: LEDGER_COL_WIDTHS.actions }}></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredTransactions.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={
                              (hasMultipleBranches ? 8 : 7) + (selectedAccount ? 1 : 0)
                            }
                            className="text-center py-8 text-muted-foreground"
                          >
                            No transactions found
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredTransactions.slice(0, 100).map((tx) => {
                          const isLocked = isDateLocked(
                            new Date(tx.transaction_date)
                          );
                          const settlementKind: SettlementKind = settlementKindOf(
                            tx.batch?.reference_number
                          );

                          return (
                            <TableRow
                              key={tx.id}
                              className={
                                tx.is_voided ? "opacity-50 bg-muted/30" : ""
                              }
                            >
                              <TableCell
                                className={`font-mono text-xs whitespace-nowrap sticky left-0 z-10 shadow-[inset_-1px_0_0_hsl(var(--border))] ${
                                  tx.is_voided ? "bg-muted" : "bg-background"
                                }`}
                              >
                                {format(
                                  new Date(tx.transaction_date),
                                  "MMM d, yyyy"
                                )}
                              </TableCell>
                              <TableCell className="break-words">
                                <div>
                                  <span className="font-mono text-xs text-muted-foreground mr-1">
                                    {tx.account?.account_code}
                                  </span>
                                  <span className="text-sm">
                                    {tx.account?.account_name}
                                  </span>
                                </div>
                              </TableCell>
                              {hasMultipleBranches && (
                                <TableCell>
                                  {tx.branch?.name ? (
                                    <BranchBadge
                                      name={tx.branch.name}
                                      branchId={tx.branch_id ?? null}
                                      size="sm"
                                    />
                                  ) : (
                                    <span className="text-xs text-muted-foreground">
                                      —
                                    </span>
                                  )}
                                </TableCell>
                              )}
                              <TableCell className="text-sm break-words">
                                {tx.description || "-"}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {tx.debit ? (
                                  <span className="text-green-600 flex items-center justify-end gap-1">
                                    <ArrowUpRight className="h-3 w-3" />
                                    {formatCurrency(tx.debit)}
                                  </span>
                                ) : (
                                  "-"
                                )}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {tx.credit ? (
                                  <span className="text-red-600 flex items-center justify-end gap-1">
                                    <ArrowDownRight className="h-3 w-3" />
                                    {formatCurrency(tx.credit)}
                                  </span>
                                ) : (
                                  "-"
                                )}
                              </TableCell>
                              {selectedAccount && (
                                <TableCell className="text-right font-mono text-sm">
                                  {runningBalances.has(tx.id) ? (
                                    <>
                                      {formatCurrency(
                                        Math.abs(runningBalances.get(tx.id) as number),
                                      )}{" "}
                                      <span className="text-xs text-muted-foreground">
                                        {sideLabel(runningBalances.get(tx.id) as number)}
                                      </span>
                                    </>
                                  ) : (
                                    "-"
                                  )}
                                </TableCell>
                              )}
                              <TableCell>
                                <div className="flex items-center gap-1">
                                  {tx.is_voided && (
                                    <Badge
                                      variant="destructive"
                                      className="text-xs"
                                    >
                                      Voided
                                    </Badge>
                                  )}
                                  {isLocked && !tx.is_voided && (
                                    <Badge
                                      variant="secondary"
                                      className="text-xs gap-1"
                                    >
                                      <Shield className="h-3 w-3" />
                                      Locked
                                    </Badge>
                                  )}
                                  {settlementKind && !tx.is_voided && (
                                    <Badge
                                      variant="secondary"
                                      className="text-xs gap-1"
                                    >
                                      <Lock className="h-3 w-3" />
                                      {settlementKind === "reversal"
                                        ? "Reversal entry"
                                        : "Settlement"}
                                    </Badge>
                                  )}
                                  {tx.reference_type && (
                                    <Badge
                                      variant="outline"
                                      className="text-xs capitalize"
                                    >
                                      {tx.reference_type.replace("_", " ")}
                                    </Badge>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                {settlementKind && !tx.is_voided ? (
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="gap-1 text-xs"
                                          onClick={() => setLockedTx(tx)}
                                        >
                                          <Undo2 className="h-3.5 w-3.5" />
                                          {SETTLEMENT_LOCK_LABEL}
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent className="max-w-xs">
                                        {settlementLockReason(settlementKind)}
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                ) : canVoidTransaction(tx) ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setVoidingTx(tx)}
                                    className="text-destructive hover:text-destructive"
                                  >
                                    <Ban className="h-4 w-4" />
                                  </Button>
                                ) : null}
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Pagination boundary indicator */}
              {meta.loadedCount > 0 && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border bg-muted/30 p-3 text-sm w-full max-w-full min-w-0 overflow-hidden">
                  <div className="flex items-start gap-2 text-muted-foreground min-w-0">
                    <CalendarRange className="h-4 w-4 shrink-0 mt-0.5" />
                    <span className="min-w-0 break-words">
                      Loaded{" "}
                      <span className="font-medium text-foreground">
                        {meta.loadedCount.toLocaleString()}
                      </span>{" "}
                      transactions
                      {meta.earliestLoadedAt && meta.latestLoadedAt && (
                        <>
                          {" "}
                          from{" "}
                          <span className="font-medium text-foreground">
                            {format(
                              new Date(meta.latestLoadedAt),
                              "MMM d, yyyy",
                            )}
                          </span>{" "}
                          back to{" "}
                          <span className="font-medium text-foreground">
                            {format(
                              new Date(meta.earliestLoadedAt),
                              "MMM d, yyyy",
                            )}
                          </span>
                        </>
                      )}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 min-w-0">
                    {filteredTransactions.length > 100 && (
                      <span className="text-xs text-muted-foreground">
                        Showing first 100 of{" "}
                        {filteredTransactions.length.toLocaleString()} filtered
                      </span>
                    )}
                    {meta.hasMore && (
                      <div className="flex items-center gap-1.5 text-xs text-amber-600">
                        <AlertCircle className="h-3.5 w-3.5" />
                        <span>Older transactions exist beyond loaded range</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        <div>
          <ApPostingBreakdownCard />
        </div>
      </div>

      {/* Immutable AP settlement notice */}
      <Dialog open={!!lockedTx} onOpenChange={() => setLockedTx(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              {SETTLEMENT_LOCK_LABEL}
            </DialogTitle>
            <DialogDescription>
              {settlementLockReason(
                settlementKindOf(lockedTx?.batch?.reference_number)
              )}
            </DialogDescription>
          </DialogHeader>
          {lockedTx && (
            <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1">
              <p>
                <strong>Date:</strong>{" "}
                {format(new Date(lockedTx.transaction_date), "MMM d, yyyy")}
              </p>
              <p>
                <strong>Account:</strong> {lockedTx.account?.account_code} -{" "}
                {lockedTx.account?.account_name}
              </p>
              <p>
                <strong>Amount:</strong>{" "}
                {lockedTx.debit
                  ? `Debit ${formatCurrency(lockedTx.debit)}`
                  : `Credit ${formatCurrency(lockedTx.credit || 0)}`}
              </p>
              <p>
                <strong>Reference:</strong>{" "}
                {lockedTx.batch?.reference_number ?? "-"}
              </p>
            </div>
          )}
          <div className="text-sm text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">How to correct this</p>
            <p>
              Open the expense and switch it back to <strong>Unpaid</strong>.
              That posts a reversal entry (DR Cash · CR Accounts Payable) and
              restores the liability, keeping the full audit trail intact.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setLockedTx(null)}>Understood</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Void Transaction Dialog */}
      <Dialog open={!!voidingTx} onOpenChange={() => setVoidingTx(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ban className="h-5 w-5 text-destructive" />
              Void Transaction
            </DialogTitle>
            <DialogDescription>
              Voiding creates a reversing entry to cancel this transaction. The
              original record is preserved for audit purposes.
            </DialogDescription>
          </DialogHeader>

          {voidingTx && (
            <div className="space-y-4 py-4">
              <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1">
                <p>
                  <strong>Date:</strong>{" "}
                  {format(new Date(voidingTx.transaction_date), "MMM d, yyyy")}
                </p>
                <p>
                  <strong>Account:</strong> {voidingTx.account?.account_code} -{" "}
                  {voidingTx.account?.account_name}
                </p>
                <p>
                  <strong>Amount:</strong>{" "}
                  {voidingTx.debit
                    ? `Debit ${formatCurrency(voidingTx.debit)}`
                    : `Credit ${formatCurrency(voidingTx.credit || 0)}`}
                </p>
                <p>
                  <strong>Description:</strong> {voidingTx.description || "-"}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="void-reason">Reason for Voiding *</Label>
                <Textarea
                  id="void-reason"
                  placeholder="Explain why this transaction needs to be voided..."
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidingTx(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleVoid}
              disabled={isVoiding || !voidReason.trim()}
              className="gap-1"
            >
              {isVoiding ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Ban className="h-4 w-4" />
              )}
              Void Transaction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
