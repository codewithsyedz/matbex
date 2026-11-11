import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { BranchBadge } from "@/components/branch/BranchBadge";
import { useJournalEntries, JournalEntryBatch } from "@/hooks/useJournalEntries";
import { useCurrency } from "@/hooks/useCurrency";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, XCircle, Clock, AlertCircle, History, Scale, Search, FilterX, RefreshCw, ExternalLink } from "lucide-react";

interface PendingLine {
  account_id: string;
  debit?: number | null;
  credit?: number | null;
  description?: string | null;
}

/** Role gate; the card is a separate component so its hooks always run in the same order. */
export function PendingJournalEntriesCard() {
  const { isManager, isAccountant } = useAuth();
  if (!isManager && !isAccountant) return null;
  return <PendingJournalEntriesCardInner />;
}

function PendingJournalEntriesCardInner() {
  const { user, profile, isManager, isAccountant } = useAuth();
  const { branches, activeBranch, isAllBranches, pinnedBranchId } = useBranch();
  const tenantId = profile?.tenant_id;
  const {
    batches,
    isLoading,
    approveBatch,
    rejectBatch,
    acknowledgeBatch,
    bulkApproveBatches,
    bulkRejectBatches,
  } =
    useJournalEntries();
  const { format: formatCurrency } = useCurrency();

  const [reviewing, setReviewing] = useState<JournalEntryBatch | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const [bulkRejectReason, setBulkRejectReason] = useState("");
  const [bulkApproveOpen, setBulkApproveOpen] = useState(false);
  const [acknowledgingBatch, setAcknowledgingBatch] = useState<JournalEntryBatch | null>(null);
  const [search, setSearch] = useState("");
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"pending" | "posted" | "rejected" | "all">(
    "pending"
  );
  const [branchFilter, setBranchFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Map account ids to readable codes/names for the review dialog
  const { data: accountLookup = {} } = useQuery({
    queryKey: ["coa-lookup", tenantId],
    queryFn: async () => {
      if (!tenantId) return {} as Record<string, { code: string; name: string }>;
      const { data, error } = await db
        .from("chart_of_accounts")
        .select("id, account_code, account_name")
        .eq("tenant_id", tenantId);
      if (error) throw error;
      const map: Record<string, { code: string; name: string }> = {};
      (data || []).forEach((a: any) => {
        map[a.id] = { code: a.account_code, name: a.account_name };
      });
      return map;
    },
    enabled: !!tenantId,
  });

  const branchName = (id?: string | null) =>
    id ? branches.find((b) => b.id === id)?.name ?? null : null;
  const scopeLabel = isAllBranches && !pinnedBranchId ? "All branches" : activeBranch?.name ?? "Current branch";

  /** Lifecycle bucket for a batch: rejected > posted > pending. */
  const statusOf = (b: JournalEntryBatch): "pending" | "posted" | "rejected" =>
    b.approval_status === "rejected" ? "rejected" : b.is_posted ? "posted" : "pending";

  const statusCounts = useMemo(() => {
    const c = { pending: 0, posted: 0, rejected: 0 };
    batches.forEach((b) => {
      c[statusOf(b)] += 1;
    });
    return c;
  }, [batches]);

  // Rows in the selected lifecycle bucket, before the text/account/date filters.
  const allPending = useMemo(
    () =>
      batches.filter((b) => {
        if (statusFilter !== "all" && statusOf(b) !== statusFilter) return false;
        if (branchFilter === "untagged" && b.branch_id) return false;
        if (branchFilter !== "all" && branchFilter !== "untagged" && b.branch_id !== branchFilter)
          return false;
        return true;
      }),
    [batches, statusFilter, branchFilter]
  );

  // Branch attribution for the current bucket — shown as count chips.
  const branchBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    batches
      .filter((b) => statusFilter === "all" || statusOf(b) === statusFilter)
      .forEach((b) => {
        const key = b.branch_id ?? "untagged";
        counts.set(key, (counts.get(key) ?? 0) + 1);
      });
    return Array.from(counts.entries())
      .map(([id, count]) => ({
        id,
        count,
        name: id === "untagged" ? null : branches.find((x) => x.id === id)?.name ?? null,
      }))
      .sort((a, b) => b.count - a.count);
     
  }, [batches, statusFilter, branches]);

  // Account ids per pending batch — from pending_lines when present, otherwise
  // from the ledger rows the direct posters wrote.
  const { data: ledgerAccountsByBatch = {} } = useQuery({
    queryKey: ["pending-batch-accounts", allPending.map((b) => b.id).join(",")],
    enabled: allPending.length > 0,
    queryFn: async () => {
      const { data, error } = await db
        .from("account_transactions")
        .select("batch_id, account_id")
        .in("batch_id", allPending.map((b) => b.id))
        .or("is_voided.is.null,is_voided.eq.false");
      if (error) throw error;
      const map: Record<string, string[]> = {};
      (data || []).forEach((r: any) => {
        if (!r.batch_id) return;
        (map[r.batch_id] ||= []).push(r.account_id);
      });
      return map;
    },
  });

  const accountsForBatch = (b: JournalEntryBatch): string[] => {
    const lines = Array.isArray(b.pending_lines) ? (b.pending_lines as PendingLine[]) : [];
    const fromLines = lines.map((l) => l.account_id).filter(Boolean);
    return fromLines.length > 0 ? fromLines : ledgerAccountsByBatch[b.id] ?? [];
  };

  const accountOptions = useMemo(() => {
    const ids = new Set<string>();
    allPending.forEach((b) => accountsForBatch(b).forEach((id) => ids.add(id)));
    return Array.from(ids)
      .map((id) => ({ id, label: accountLookup[id] ? `${accountLookup[id].code} · ${accountLookup[id].name}` : id.slice(0, 8) }))
      .sort((a, b) => a.label.localeCompare(b.label));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPending, ledgerAccountsByBatch, accountLookup]);

  const typeOptions = useMemo(
    () => Array.from(new Set(allPending.map((b) => b.entry_type).filter(Boolean))),
    [allPending]
  );

  const term = search.trim().toLowerCase();
  const pending = allPending.filter((b) => {
    if (typeFilter !== "all" && b.entry_type !== typeFilter) return false;
    if (dateFrom && b.batch_date < dateFrom) return false;
    if (dateTo && b.batch_date > dateTo) return false;
    if (accountFilter !== "all" && !accountsForBatch(b).includes(accountFilter)) return false;
    if (term) {
      const accountText = accountsForBatch(b)
        .map((id) => (accountLookup[id] ? `${accountLookup[id].code} ${accountLookup[id].name}` : id))
        .join(" ");
      const haystack = [
        b.description,
        b.reference_number ?? "",
        b.entry_type,
        branchName(b.branch_id) ?? "",
        accountText,
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    return true;
  });

  const hasFilters =
    !!term ||
    accountFilter !== "all" ||
    typeFilter !== "all" ||
    branchFilter !== "all" ||
    !!dateFrom ||
    !!dateTo;
  const clearFilters = () => {
    setSearch("");
    setAccountFilter("all");
    setTypeFilter("all");
    setBranchFilter("all");
    setDateFrom("");
    setDateTo("");
  };

  // Only truly pending rows can be approved/rejected in bulk.
  const pendingIds = pending.filter((b) => statusOf(b) === "pending").map((b) => b.id);
  const selectedPendingIds = selectedIds.filter((id) => pendingIds.includes(id));
  const allSelected = pendingIds.length > 0 && selectedPendingIds.length === pendingIds.length;
  const someSelected = selectedPendingIds.length > 0 && !allSelected;
  const isBulkBusy = bulkApproveBatches.isPending || bulkRejectBatches.isPending;

  const toggleAll = (checked: boolean) => setSelectedIds(checked ? pendingIds : []);
  const toggleOne = (id: string, checked: boolean) =>
    setSelectedIds((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)));

  const recentDecided = batches
    .filter((b) => b.approval_status === "rejected")
    .slice(0, 5);


  const canDecide = isManager;

  // Re-check the batch itself whenever the dialog opens (and on demand), so the
  // Approve/Acknowledge state reflects what another process may have posted
  // since the list was last loaded.
  const {
    data: freshBatch,
    isFetching: freshBatchFetching,
    dataUpdatedAt: freshBatchUpdatedAt,
    refetch: refetchFreshBatch,
  } = useQuery({
    queryKey: ["pending-batch-fresh", reviewing?.id],
    enabled: !!reviewing?.id,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const { data, error } = await db
        .from("journal_entry_batches")
        .select("id, approval_status, pending_lines, posted_at, posted_by")
        .eq("id", reviewing!.id)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const effectiveBatch: any = freshBatch ?? reviewing;
  const pendingLinesFromBatch: PendingLine[] = Array.isArray(effectiveBatch?.pending_lines)
    ? (effectiveBatch.pending_lines as PendingLine[])
    : [];
  const liveApprovalStatus: string | undefined = effectiveBatch?.approval_status;
  const alreadyDecided =
    !!liveApprovalStatus && liveApprovalStatus !== "pending";

  // Always load the real ledger rows for this batch so the reviewer can see
  // exactly what is (or would be) in the ledger, with references, before
  // acknowledging or approving. Some batches (expense / day-end posters)
  // insert directly into account_transactions and never populate pending_lines.
  const {
    data: ledgerRows = [],
    isLoading: ledgerRowsLoading,
    refetch: refetchLedgerRows,
  } = useQuery({
    queryKey: ["pending-batch-txns", reviewing?.id],
    enabled: !!reviewing,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const { data, error } = await db
        .from("account_transactions")
        .select(
          "id, account_id, debit, credit, description, transaction_date, reference_type, reference_id, branch_id, is_voided, void_reason, created_at"
        )
        .eq("batch_id", reviewing!.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const activeLedgerRows = ledgerRows.filter((r: any) => !r.is_voided);
  const voidedLedgerRows = ledgerRows.filter((r: any) => r.is_voided);
  const fallbackLines: PendingLine[] = activeLedgerRows.map((r: any) => ({
    account_id: r.account_id,
    debit: r.debit,
    credit: r.credit,
    description: r.description,
  }));

  const hasStagedLines = pendingLinesFromBatch.length > 0;
  const reviewLines: PendingLine[] =
    hasStagedLines ? pendingLinesFromBatch : fallbackLines;
  const linesFromLedger = !hasStagedLines && fallbackLines.length > 0;
  const reviewDebits = reviewLines.reduce((s, l) => s + (Number(l.debit) || 0), 0);

  const reviewCredits = reviewLines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const reviewDiff = reviewDebits - reviewCredits;
  const isUnbalanced = Math.abs(reviewDiff) > 0.01;

  // Per-account net (debit - credit). Rank by absolute contribution so the
  // reviewer sees the most suspicious legs first.
  const accountNets = (() => {
    const m = new Map<string, { debit: number; credit: number }>();
    for (const l of reviewLines) {
      const cur = m.get(l.account_id) ?? { debit: 0, credit: 0 };
      cur.debit += Number(l.debit) || 0;
      cur.credit += Number(l.credit) || 0;
      m.set(l.account_id, cur);
    }
    return Array.from(m.entries())
      .map(([account_id, v]) => ({
        account_id,
        debit: v.debit,
        credit: v.credit,
        net: v.debit - v.credit,
      }))
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  })();
  const topOffenders = isUnbalanced
    ? accountNets.filter((a) => Math.abs(a.net) > 0.01).slice(0, 3)
    : [];

  // Audit trail: who created the batch, and (if it's an expense) the
  // expense_posting_audit row(s) that produced it.
  const { data: creatorProfile } = useQuery({
    queryKey: ["pending-batch-creator", reviewing?.created_by],
    enabled: !!reviewing?.created_by,
    queryFn: async () => {
      const { data, error } = await db
        .from("profiles")
        .select("id, full_name")
        .eq("id", reviewing!.created_by as string)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: postingAuditRows = [] } = useQuery({
    queryKey: ["pending-batch-audit", reviewing?.id],
    enabled: !!reviewing?.id,
    queryFn: async () => {
      const { data, error } = await db
        .from("expense_posting_audit")
        .select(
          "id, action, outcome, reason_code, reason_detail, trigger_source, triggered_by, dr_total, cr_total, created_at"
        )
        .eq("batch_id", reviewing!.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  const inferredSource = (() => {
    const ref = reviewing?.reference_number || "";
    if (ref.startsWith("EXP-")) return "Expense poster (post_expense_to_ledger)";
    if (ref.startsWith("DEA-")) return "Day-end adjustment poster";
    if (ref.startsWith("INV-")) return "Inventory / purchase poster";
    if (ref.startsWith("DSS-")) return "Daily sales summary poster";
    return reviewing?.entry_type ? `${reviewing.entry_type} poster` : "Unknown source";
  })();

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Journal Entries
            {statusCounts.pending > 0 && (
              <Badge variant="secondary" className="ml-1">
                {statusCounts.pending} pending
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            {canDecide
              ? "Review and approve or reject entries submitted by accountants before they post to the ledger."
              : "Entries you submit appear here until an owner or manager approves them."}{" "}
            · Scope: {scopeLabel}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
                <SelectTrigger className="w-[190px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending ({statusCounts.pending})</SelectItem>
                  <SelectItem value="posted">Posted ({statusCounts.posted})</SelectItem>
                  <SelectItem value="rejected">Rejected ({statusCounts.rejected})</SelectItem>
                  <SelectItem value="all">All statuses ({batches.length})</SelectItem>
                </SelectContent>
              </Select>
              <Select value={branchFilter} onValueChange={setBranchFilter}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Branch" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="all">All branches in scope</SelectItem>
                  {branches.map((br) => (
                    <SelectItem key={br.id} value={br.id}>
                      {br.name}
                    </SelectItem>
                  ))}
                  <SelectItem value="untagged">Untagged branch</SelectItem>
                </SelectContent>
              </Select>
              {branchBreakdown.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setBranchFilter(branchFilter === b.id ? "all" : b.id)}
                  className={`flex items-center gap-1 rounded-full border px-2 py-1 text-xs transition-colors ${
                    branchFilter === b.id ? "border-primary bg-primary/10" : "hover:bg-muted"
                  }`}
                >
                  <BranchBadge name={b.name} branchId={b.id === "untagged" ? null : b.id} size="sm" untaggedLabel="Untagged" />
                  <span className="font-medium">{b.count}</span>
                </button>
              ))}
            </div>
            {allPending.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[220px] flex-1">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search vendor, description, reference, account…"
                    className="pl-8"
                  />
                </div>
                <Select value={accountFilter} onValueChange={setAccountFilter}>
                  <SelectTrigger className="w-[220px]">
                    <SelectValue placeholder="Account" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="all">All accounts</SelectItem>
                    {accountOptions.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    {typeOptions.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-[150px]"
                  aria-label="From date"
                />
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-[150px]"
                  aria-label="To date"
                />
                {hasFilters && (
                  <Button variant="ghost" size="sm" onClick={clearFilters}>
                    <FilterX className="mr-1 h-4 w-4" />
                    Clear
                  </Button>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Showing {pending.length} {statusFilter === "all" ? "" : statusFilter} entr
              {pending.length === 1 ? "y" : "ies"}
              {hasFilters ? ` (of ${batches.length} in scope)` : ""} · Scope: {scopeLabel}
            </p>
          </div>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {hasFilters
                ? "No entries match these filters."
                : `No ${statusFilter === "all" ? "" : statusFilter + " "}entries.`}
            </p>
          ) : (
            <>
            {canDecide && selectedPendingIds.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-2">
                <span className="text-sm font-medium">
                  {selectedPendingIds.length} selected · {scopeLabel}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setSelectedIds([])}>
                    Clear
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={isBulkBusy}
                    onClick={() => {
                      setBulkRejectReason("");
                      setBulkRejectOpen(true);
                    }}
                  >
                    <XCircle className="h-4 w-4 mr-1" />
                    Reject selected
                  </Button>
                  <Button size="sm" disabled={isBulkBusy} onClick={() => setBulkApproveOpen(true)}>
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    Approve selected
                  </Button>
                </div>
              </div>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  {canDecide && (
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allSelected ? true : someSelected ? "indeterminate" : false}
                        onCheckedChange={(c) => toggleAll(c === true)}
                        aria-label="Select all pending entries"
                      />
                    </TableHead>
                  )}
                  <TableHead>Date</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((b) => (
                  <TableRow key={b.id}>
                    {canDecide && (
                      <TableCell>
                        {statusOf(b) === "pending" && (
                          <Checkbox
                            checked={selectedPendingIds.includes(b.id)}
                            onCheckedChange={(c) => toggleOne(b.id, c === true)}
                            aria-label={`Select entry ${b.description}`}
                          />
                        )}
                      </TableCell>
                    )}
                    <TableCell className="font-mono text-xs">{b.batch_date}</TableCell>
                    <TableCell>
                      <BranchBadge
                        name={branchName(b.branch_id)}
                        branchId={b.branch_id}
                        size="sm"
                        untaggedLabel="Untagged"
                      />
                    </TableCell>
                    <TableCell>
                      {statusOf(b) === "posted" ? (
                        <Badge variant="secondary" className="gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Posted
                        </Badge>
                      ) : statusOf(b) === "rejected" ? (
                        <Badge variant="destructive" className="gap-1">
                          <XCircle className="h-3 w-3" /> Rejected
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1">
                          <Clock className="h-3 w-3" /> Pending
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate">{b.description}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {b.reference_number || "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{b.entry_type}</Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button size="sm" variant="outline" onClick={() => setReviewing(b)}>
                        Review
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </>
          )}

          {recentDecided.length > 0 && (
            <div className="mt-6 space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Recently Rejected
              </p>
              <div className="space-y-2">
                {recentDecided.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-start gap-2 rounded border bg-muted/30 p-3 text-sm"
                  >
                    <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <div className="font-medium">{b.description}</div>
                      <div className="text-xs text-muted-foreground">
                        {b.batch_date} · {branchName(b.branch_id) ?? "Untagged branch"} ·{" "}
                        {b.rejection_reason || "No reason provided"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Review dialog */}
      <Dialog open={!!reviewing} onOpenChange={(o) => !o && setReviewing(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review Pending Journal Entry</DialogTitle>
            <DialogDescription>
              {reviewing?.description} · {reviewing?.batch_date}
            </DialogDescription>
          </DialogHeader>

          {reviewing && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs">
                <span className="text-muted-foreground">
                  {freshBatchFetching
                    ? "Re-checking staged lines…"
                    : `Staged lines re-checked${
                        freshBatchUpdatedAt
                          ? ` at ${new Date(freshBatchUpdatedAt).toLocaleTimeString()}`
                          : ""
                      } · ${pendingLinesFromBatch.length} staged line(s) · status ${
                        liveApprovalStatus ?? "unknown"
                      }`}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  disabled={freshBatchFetching}
                  onClick={() => {
                    refetchFreshBatch();
                    refetchLedgerRows();
                  }}
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 mr-1 ${freshBatchFetching ? "animate-spin" : ""}`}
                  />
                  Re-check
                </Button>
              </div>

              {alreadyDecided && (
                <div className="flex items-start gap-2 text-xs border rounded p-2 bg-muted/30">
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>
                    This batch is no longer pending — another process set its
                    status to <strong>{liveApprovalStatus}</strong>. Approve and
                    Acknowledge are disabled.
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Type: </span>
                  <Badge variant="outline">{reviewing.entry_type}</Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Reference: </span>
                  {reviewing.reference_number || "-"}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Branch: </span>
                  <BranchBadge
                    name={branchName(reviewing.branch_id)}
                    branchId={reviewing.branch_id}
                    size="sm"
                    untaggedLabel="Untagged"
                  />
                </div>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reviewLines.map((line, idx) => {
                      const acc = accountLookup[line.account_id];
                      return (
                        <TableRow key={idx}>
                          <TableCell>
                            {acc ? (
                              <>
                                <span className="font-mono text-xs text-muted-foreground mr-2">
                                  {acc.code}
                                </span>
                                {acc.name}
                              </>
                            ) : (
                              <span className="font-mono text-xs">{line.account_id}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {line.debit ? formatCurrency(Number(line.debit)) : ""}
                          </TableCell>
                          <TableCell className="text-right">
                            {line.credit ? formatCurrency(Number(line.credit)) : ""}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow className="font-medium bg-muted/30">
                      <TableCell>Totals</TableCell>
                      <TableCell className="text-right">{formatCurrency(reviewDebits)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(reviewCredits)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              {isUnbalanced && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                    <Scale className="h-4 w-4" />
                    Imbalance: {formatCurrency(Math.abs(reviewDiff))} {reviewDiff > 0 ? "more debit" : "more credit"}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <div className="text-muted-foreground">Total debits</div>
                      <div className="font-mono">{formatCurrency(reviewDebits)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Total credits</div>
                      <div className="font-mono">{formatCurrency(reviewCredits)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Difference</div>
                      <div className="font-mono text-destructive">
                        {reviewDiff > 0 ? "+" : ""}
                        {formatCurrency(reviewDiff)}
                      </div>
                    </div>
                  </div>
                  {topOffenders.length > 0 && (
                    <div className="space-y-1 pt-1 border-t border-destructive/20">
                      <div className="text-xs text-muted-foreground">
                        Review these legs first ({reviewDiff > 0 ? "missing credit / extra debit" : "missing debit / extra credit"}):
                      </div>
                      {topOffenders.map((a) => {
                        const acc = accountLookup[a.account_id];
                        return (
                          <div key={a.account_id} className="flex justify-between text-xs">
                            <span className="truncate">
                              {acc ? (
                                <>
                                  <span className="font-mono text-muted-foreground mr-1">{acc.code}</span>
                                  {acc.name}
                                </>
                              ) : (
                                <span className="font-mono">{a.account_id.slice(0, 8)}…</span>
                              )}
                            </span>
                            <span className="font-mono">
                              DR {formatCurrency(a.debit)} / CR {formatCurrency(a.credit)}
                              <span className="ml-2 text-destructive">
                                net {a.net > 0 ? "+" : ""}
                                {formatCurrency(a.net)}
                              </span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Exact ledger rows written for this batch */}
              <div className="rounded-lg border bg-muted/10 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Ledger entry lines
                  </div>
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                    {ledgerRowsLoading
                      ? "loading…"
                      : `${activeLedgerRows.length} live${
                          voidedLedgerRows.length ? ` · ${voidedLedgerRows.length} voided` : ""
                        }`}
                  </Badge>
                </div>

                {!ledgerRowsLoading && ledgerRows.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Nothing is written to the ledger yet for this batch.
                    {hasStagedLines
                      ? " The lines above are staged and will be posted when you approve."
                      : " There are no staged lines either, so there is nothing to approve."}
                  </p>
                )}


                {ledgerRows.map((r: any) => {
                  const acc = accountLookup[r.account_id];
                  return (
                    <div
                      key={r.id}
                      className={`text-xs border rounded p-2 space-y-1 ${
                        r.is_voided ? "opacity-60 line-through" : "bg-background"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">
                          <span className="font-mono text-muted-foreground mr-1">
                            {acc?.code ?? r.account_id.slice(0, 8)}
                          </span>
                          {acc?.name ?? ""}
                        </span>
                        <span className="font-mono">
                          DR {formatCurrency(Number(r.debit) || 0)} / CR{" "}
                          {formatCurrency(Number(r.credit) || 0)}
                        </span>
                      </div>
                      {r.description && (
                        <div className="text-muted-foreground">{r.description}</div>
                      )}
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground font-mono">
                        <span>{r.transaction_date}</span>
                        {r.reference_type && <span>ref: {r.reference_type}</span>}
                        {r.reference_id && <span>#{String(r.reference_id).slice(0, 8)}…</span>}
                        <span>line {String(r.id).slice(0, 8)}…</span>
                        {branchName(r.branch_id) && <span>{branchName(r.branch_id)}</span>}
                        {r.is_voided && (
                          <span className="text-destructive no-underline">
                            voided{r.void_reason ? `: ${r.void_reason}` : ""}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {linesFromLedger && (
                <div className="flex items-start gap-2 text-xs text-muted-foreground border rounded p-2 bg-muted/30">
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>
                    These lines were already written to the ledger by the source
                    posting (expense / day-end), so this batch is shown here for
                    review only — approving will not re-post. Use the Posting
                    Center to fix imbalances.
                  </span>
                </div>
              )}

              {/* Audit trail */}
              <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <History className="h-3.5 w-3.5" />
                  Audit trail
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div>
                    <span className="text-muted-foreground">Created by: </span>
                    {creatorProfile?.full_name || (
                      <span className="font-mono">{reviewing.created_by?.slice(0, 8)}…</span>
                    )}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Created at: </span>
                    {reviewing.created_at
                      ? new Date(reviewing.created_at as string).toLocaleString()
                      : "—"}
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Source process: </span>
                    {inferredSource}
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Flipped to pending by: </span>
                    trg_enforce_journal_entry_approval_state — creator is not an
                    owner/manager/superadmin for this tenant, so the trigger
                    forced approval_status=pending on insert.
                  </div>
                  {pendingLinesFromBatch.length === 0 && (
                    <div className="col-span-2 text-muted-foreground">
                      pending_lines is empty because this batch was created by a
                      direct poster (not submit_pending_journal_entry), which
                      writes lines straight into account_transactions.
                    </div>
                  )}
                </div>

                {postingAuditRows.length > 0 && (
                  <div className="pt-2 border-t space-y-1">
                    <div className="text-xs text-muted-foreground">
                      Posting events for this batch:
                    </div>
                    {postingAuditRows.map((r: any) => (
                      <div key={r.id} className="text-xs flex flex-wrap gap-x-2">
                        <span className="font-mono text-muted-foreground">
                          {new Date(r.created_at).toLocaleString()}
                        </span>
                        <Badge variant="outline" className="h-5 px-1.5">
                          {r.action}/{r.outcome}
                        </Badge>
                        <span>{r.reason_code}</span>
                        <span className="text-muted-foreground">
                          via {r.trigger_source}
                        </span>
                        {(r.dr_total != null || r.cr_total != null) && (
                          <span className="font-mono text-muted-foreground">
                            DR {formatCurrency(Number(r.dr_total) || 0)} / CR{" "}
                            {formatCurrency(Number(r.cr_total) || 0)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {!canDecide && (
                <p className="text-xs text-muted-foreground">
                  Waiting for an owner or manager to approve or reject this entry.
                </p>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2 flex-wrap">
            <Button variant="outline" onClick={() => setReviewing(null)}>
              Close
            </Button>
            {canDecide && reviewing && (
              <>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setRejectingId(reviewing.id);
                    setRejectReason("");
                  }}
                >
                  <XCircle className="h-4 w-4 mr-1" />
                  Reject
                </Button>
                {linesFromLedger ? (
                  <Button
                    disabled={acknowledgeBatch.isPending || freshBatchFetching || alreadyDecided}
                    title={
                      alreadyDecided
                        ? `This batch is already ${liveApprovalStatus}; nothing to acknowledge.`
                        : "This batch is already live in the ledger. Acknowledging clears the pending flag without posting again."
                    }
                    onClick={() => setAcknowledgingBatch(reviewing)}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    {acknowledgeBatch.isPending
                      ? "Acknowledging…"
                      : "Acknowledge (already posted)"}
                  </Button>
                ) : hasStagedLines ? (
                  <Button
                    disabled={
                      approveBatch.isPending ||
                      isUnbalanced ||
                      freshBatchFetching ||
                      alreadyDecided
                    }
                    title={
                      alreadyDecided
                        ? `This batch is already ${liveApprovalStatus}; it can no longer be approved.`
                        : isUnbalanced
                        ? "Total debits must equal total credits before this voucher can post"
                        : undefined
                    }
                    onClick={() =>
                      approveBatch.mutate(reviewing.id, {
                        onSuccess: () => setReviewing(null),
                      })
                    }
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    {isUnbalanced ? "Cannot post — unbalanced" : "Approve & Post"}
                  </Button>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      disabled
                      title="This batch has no staged journal lines to post."
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                      Approve & Post
                    </Button>
                    <Button variant="outline" asChild className="gap-1">
                      <Link
                        to={`/accounting?tab=ledger&batch_id=${reviewing.id}`}
                        onClick={() => setReviewing(null)}
                      >
                        <ExternalLink className="h-4 w-4" />
                        View ledger lines
                      </Link>
                    </Button>
                    <span className="text-xs text-muted-foreground max-w-[220px]">
                      Approve is disabled because this batch has no staged lines.
                      It was likely posted directly to the ledger by a source
                      process; if ledger lines appear above, use Acknowledge.
                    </span>
                  </div>
                )}
              </>
            )}
          </DialogFooter>

        </DialogContent>
      </Dialog>

      {/* Acknowledge confirmation dialog */}
      <Dialog
        open={!!acknowledgingBatch}
        onOpenChange={(o) => !o && setAcknowledgingBatch(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Acknowledge already-posted entry?</DialogTitle>
            <DialogDescription>
              This batch was written directly to the ledger by a source process. Acknowledging only updates its status — no ledger entries will change.
            </DialogDescription>
          </DialogHeader>

          {acknowledgingBatch && (
            <div className="space-y-3 text-sm">
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Batch</span>
                  <span className="font-medium text-right">{acknowledgingBatch.description}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Reference</span>
                  <span className="font-mono">{acknowledgingBatch.reference_number ?? "—"}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Branch</span>
                  <span>{branchName(acknowledgingBatch.branch_id) ?? "Untagged"}</span>
                </div>
              </div>

              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
                <div className="font-medium text-primary">What will change</div>
                <ul className="space-y-1 text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                    <span>approval_status will be set to <strong>approved</strong></span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                    <span>pending flag cleared — it will no longer appear in the pending list</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                    <span>ledger transactions already recorded remain untouched</span>
                  </li>
                </ul>
              </div>

              <div className="rounded-lg border p-3 space-y-1">
                <div className="font-medium">Recorded as acknowledged by</div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">
                    {profile?.full_name || user?.email || (
                      <span className="font-mono">{user?.id?.slice(0, 8)}…</span>
                    )}
                  </span>
                  {profile?.full_name && user?.email && (
                    <span className="text-muted-foreground">({user.email})</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  User ID: <span className="font-mono">{user?.id}</span>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAcknowledgingBatch(null)}>
              Cancel
            </Button>
            <Button
              disabled={acknowledgeBatch.isPending}
              onClick={() => {
                if (!acknowledgingBatch) return;
                acknowledgeBatch.mutate(acknowledgingBatch.id, {
                  onSuccess: () => {
                    setAcknowledgingBatch(null);
                    setReviewing(null);
                  },
                });
              }}
            >
              <CheckCircle2 className="h-4 w-4 mr-1" />
              {acknowledgeBatch.isPending ? "Acknowledging…" : "Confirm Acknowledge"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject reason dialog */}
      <Dialog open={!!rejectingId} onOpenChange={(o) => !o && setRejectingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Journal Entry</DialogTitle>
            <DialogDescription>
              The accountant will see this reason. Be specific so they can fix and resubmit.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-reason">Reason</Label>
            <Textarea
              id="reject-reason"
              rows={4}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="E.g. Wrong account selected for the credit line."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectingId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!rejectReason.trim() || rejectBatch.isPending}
              onClick={() => {
                if (!rejectingId) return;
                rejectBatch.mutate(
                  { batchId: rejectingId, reason: rejectReason.trim() },
                  {
                    onSuccess: () => {
                      setRejectingId(null);
                      setReviewing(null);
                    },
                  }
                );
              }}
            >
              Confirm Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk approve confirm */}
      <Dialog open={bulkApproveOpen} onOpenChange={setBulkApproveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve {selectedPendingIds.length} entries?</DialogTitle>
            <DialogDescription>
              These entries will be posted to the ledger for {scopeLabel}. Entries that fail
              validation (e.g. unbalanced) are skipped and reported.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkApproveOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={bulkApproveBatches.isPending}
              onClick={() =>
                bulkApproveBatches.mutate(selectedPendingIds, {
                  onSuccess: () => {
                    setBulkApproveOpen(false);
                    setSelectedIds([]);
                  },
                })
              }
            >
              <CheckCircle2 className="h-4 w-4 mr-1" />
              {bulkApproveBatches.isPending ? "Approving…" : "Approve & Post"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk reject reason */}
      <Dialog open={bulkRejectOpen} onOpenChange={setBulkRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject {selectedPendingIds.length} entries</DialogTitle>
            <DialogDescription>
              The same reason is applied to every selected entry in {scopeLabel}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="bulk-reject-reason">Reason</Label>
            <Textarea
              id="bulk-reject-reason"
              rows={4}
              value={bulkRejectReason}
              onChange={(e) => setBulkRejectReason(e.target.value)}
              placeholder="E.g. Duplicate batches submitted for the same day."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!bulkRejectReason.trim() || bulkRejectBatches.isPending}
              onClick={() =>
                bulkRejectBatches.mutate(
                  { batchIds: selectedPendingIds, reason: bulkRejectReason.trim() },
                  {
                    onSuccess: () => {
                      setBulkRejectOpen(false);
                      setSelectedIds([]);
                    },
                  }
                )
              }
            >
              {bulkRejectBatches.isPending ? "Rejecting…" : "Confirm Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}