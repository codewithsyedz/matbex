import { useState } from "react";
import { useExpensePostingStatus } from "@/hooks/useExpensePostingStatus";
import { useExpenseAiJournalAudit } from "@/hooks/useExpenseAiJournalAudit";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { useAuth } from "@/contexts/AuthContext";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { Loader2, AlertTriangle, CheckCircle2, CircleDashed, Layers, PencilLine, Sparkles } from "lucide-react";
import { BranchBadge } from "@/components/branch/BranchBadge";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  expenseId: string | null | undefined;
  ledgerPosted?: boolean | null;
  branchId?: string | null;
}

/**
 * Shows the live posting status for an expense:
 *  - unposted: no ledger rows yet
 *  - balanced: DR == CR
 *  - unbalanced: DR != CR (missing or extra leg)
 * Lists every linked debit/credit row for auditability.
 */
export function ExpensePostingStatusPanel({ expenseId, ledgerPosted, branchId }: Props) {
  const { t } = useTranslation();
  const { data, isLoading } = useExpensePostingStatus(expenseId);
  const { data: auditRows = [], isLoading: auditLoading } = useExpenseAiJournalAudit(expenseId);
  const { accounts, isVisibleForBranch: isAccountVisibleForBranch } = useChartOfAccounts();
  const { isOwner, isManager, isAccountant, roles } = useAuth();
  const queryClient = useQueryClient();
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [reason, setReason] = useState("");

  const canOverride = isOwner || isManager || isAccountant || roles.some((role) => role.role === "superadmin");
  const latestAudit = auditRows[0] ?? null;
  const latestAiAudit = auditRows.find((row) => !row.is_manual_override) ?? null;
  const eligibleAccounts = accounts.filter(
    (account) =>
      account.is_active &&
      ["expense", "asset", "liability", "cogs"].includes(account.account_type) &&
      (branchId ? isAccountVisibleForBranch(account.id, branchId) : true),
  );

  const overrideMutation = useMutation({
    mutationFn: async () => {
      if (!expenseId || !accountId) throw new Error(t("expenses.journal.selectAccountError"));
      if (reason.trim().length < 3) throw new Error(t("expenses.journal.reasonError"));
      const { data: result, error } = await supabase.rpc("apply_manual_expense_account_override", {
        p_expense_id: expenseId,
        p_account_id: accountId,
        p_reason: reason.trim(),
      });
      if (error) throw error;
      return result;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["expenses"] }),
        queryClient.invalidateQueries({ queryKey: ["expenses-with-approval"] }),
        queryClient.invalidateQueries({ queryKey: ["expense-posting-status", expenseId] }),
        queryClient.invalidateQueries({ queryKey: ["expense-ai-journal-audit", expenseId] }),
        queryClient.invalidateQueries({ queryKey: ["account-transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["trial-balance"] }),
        queryClient.invalidateQueries({ queryKey: ["profit-loss"] }),
      ]);
      toast.success(t("expenses.journal.overrideSuccess"));
      setOverrideOpen(false);
      setAccountId("");
      setReason("");
    },
    onError: (error: Error) => toast.error(t("expenses.journal.overrideFailed"), { description: error.message }),
  });

  if (!expenseId) return null;

  if (isLoading || !data) {
    return (
      <div className="rounded-lg border bg-muted/30 p-3 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("app.expenses.posting.loading")}
      </div>
    );
  }

  const { status, totalDebit, totalCredit, diff, netByAccount, batches } = data;
  const showUnposted = status === "unposted";
  const showUnbalanced = status === "unbalanced";
  const hasReversals = netByAccount.some((a) => a.reversed);
  const effective = netByAccount.filter((a) => !a.reversed);

  return (
    <div className="rounded-lg border bg-card p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{t("app.expenses.posting.title")}</span>
          {showUnposted ? (
            <Badge variant="outline" className="gap-1 border-muted text-muted-foreground">
              <CircleDashed className="h-3 w-3" />
              {ledgerPosted ? t("app.expenses.posting.postedNoRows") : t("app.expenses.posting.unposted")}
            </Badge>
          ) : showUnbalanced ? (
            <Badge variant="outline" className="gap-1 border-destructive text-destructive bg-destructive/5">
              <AlertTriangle className="h-3 w-3" />
              {t("app.expenses.posting.unbalanced")}
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 border-green-500 text-green-600 bg-green-50">
              <CheckCircle2 className="h-3 w-3" />
              {t("app.expenses.posting.balanced")}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="text-xs tabular-nums text-muted-foreground">
            DR {totalDebit.toFixed(2)} · CR {totalCredit.toFixed(2)}
            {Math.abs(diff) > 0.005 && (
              <span className="ms-2 text-destructive">Δ {diff.toFixed(2)}</span>
            )}
          </div>
          {canOverride && (
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setOverrideOpen(true)}>
              <PencilLine className="h-3.5 w-3.5" />
              {t("expenses.journal.manualOverride")}
            </Button>
          )}
        </div>
      </div>

      {(latestAudit || auditLoading) && (
        <div className="rounded-md border bg-muted/20 px-3 py-2">
          {auditLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("expenses.journal.loadingAi")}
            </div>
          ) : latestAudit ? (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
                  {latestAudit.is_manual_override ? <PencilLine className="h-3.5 w-3.5 text-primary" /> : <Sparkles className="h-3.5 w-3.5 text-primary" />}
                  <span>{latestAudit.is_manual_override ? t("expenses.journal.manualClassification") : latestAudit.classification}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {latestAudit.outcome === "posted" ? t("expenses.journal.posted") : t("expenses.journal.needsReview")}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {latestAudit.override_reason || latestAudit.rationale || latestAudit.error_message}
                </p>
              </div>
              {latestAiAudit?.confidence != null && (
                <div className="text-end">
                  <div className="text-lg font-semibold tabular-nums">{Math.round(latestAiAudit.confidence * 100)}%</div>
                  <div className="text-[10px] uppercase text-muted-foreground">{t("expenses.journal.aiConfidence")}</div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}

      {batches.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Layers className="h-3.5 w-3.5" />
            {t("app.expenses.posting.batchSummary", { count: batches.length, adjustments: batches.filter((b) => b.isAdjustment).length })}
          </div>
          {batches.map((b, idx) => (
            <div key={b.batch_id ?? `unbatched-${idx}`} className="rounded-md border overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 bg-muted/40">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge
                    variant="outline"
                    className={
                      b.isAdjustment
                        ? "text-[10px] py-0 px-1 border-amber-500 text-amber-600 bg-amber-50"
                        : "text-[10px] py-0 px-1"
                    }
                  >
                    {b.isAdjustment ? t("app.expenses.posting.adjustment") : t("app.expenses.posting.original")}
                  </Badge>
                  <span className="font-mono text-xs truncate">
                    {b.reference_number ?? (b.batch_id ? b.batch_id.slice(0, 8) : "No batch")}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">{b.batch_date ?? ""}</span>
                  {b.is_posted === false && (
                    <Badge variant="outline" className="text-[10px] py-0 px-1 text-muted-foreground">
                      {t("app.expenses.posting.draft")}
                    </Badge>
                  )}
                </div>
                <div className="text-xs tabular-nums text-muted-foreground">
                  DR {b.totalDebit.toFixed(2)} · CR {b.totalCredit.toFixed(2)}
                  {!b.balanced && (
                    <span className="ms-2 text-destructive">
                      Δ {(b.totalDebit - b.totalCredit).toFixed(2)}
                    </span>
                  )}
                </div>
              </div>
              {b.description && (
                <p className="px-3 pt-1.5 text-xs text-muted-foreground">{b.description}</p>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-8 text-xs">{t("app.expenses.posting.date")}</TableHead>
                    <TableHead className="h-8 text-xs">{t("app.expenses.posting.account")}</TableHead>
                    <TableHead className="h-8 text-xs">{t("app.expenses.posting.branch")}</TableHead>
                    <TableHead className="h-8 text-xs text-end">{t("app.expenses.posting.debit")}</TableHead>
                    <TableHead className="h-8 text-xs text-end">{t("app.expenses.posting.credit")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {b.legs.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="py-1.5 text-xs tabular-nums">{l.transaction_date}</TableCell>
                      <TableCell className="py-1.5 text-xs">
                        <span className="font-mono">{l.account?.account_code ?? "—"}</span>{" "}
                        {l.account?.account_name ?? ""}
                        {latestAudit?.selected_account_id === l.account_id && Number(l.debit ?? 0) > 0 && (
                          <Badge variant="secondary" className="ms-2 gap-1 text-[10px] py-0 px-1">
                            {latestAudit.is_manual_override ? <PencilLine className="h-2.5 w-2.5" /> : <Sparkles className="h-2.5 w-2.5" />}
                            {latestAudit.is_manual_override
                              ? t("expenses.journal.overridden")
                              : `${t("expenses.journal.aiAssigned")}${latestAudit.confidence != null ? ` · ${Math.round(latestAudit.confidence * 100)}%` : ""}`}
                          </Badge>
                        )}
                        {Number(l.credit ?? 0) > 0 && (
                          <Badge variant="outline" className="ms-2 text-[10px] py-0 px-1">
                            {t("expenses.journal.systemAssigned")}
                          </Badge>
                        )}
                        {l.reference_type && l.reference_type !== "expense" && (
                           <Badge variant="outline" className="ms-2 text-[10px] py-0 px-1 border-warning text-warning bg-warning/10">
                             {l.reference_type === "adjustment" ? t("app.expenses.posting.correction") : t("app.expenses.posting.reversal")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="py-1.5 max-w-[140px]">
                        <BranchBadge size="sm" name={l.branch?.name ?? null} />
                      </TableCell>
                       <TableCell className="py-1.5 text-xs text-end tabular-nums">
                        {Number(l.debit ?? 0) > 0 ? Number(l.debit).toFixed(2) : ""}
                      </TableCell>
                       <TableCell className="py-1.5 text-xs text-end tabular-nums">
                        {Number(l.credit ?? 0) > 0 ? Number(l.credit).toFixed(2) : ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ))}
        </div>
      )}

      {netByAccount.length > 0 && (
        <div className="rounded-md border overflow-hidden">
          <div className="px-3 py-1.5 text-xs font-medium bg-muted/40">
            {t("app.expenses.posting.netImpact")}{hasReversals ? ` ${t("app.expenses.posting.reversedNote")}` : ""}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-8 text-xs">{t("app.expenses.posting.account")}</TableHead>
                <TableHead className="h-8 text-xs text-end">{t("app.expenses.posting.netDebit")}</TableHead>
                <TableHead className="h-8 text-xs text-end">{t("app.expenses.posting.netCredit")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {netByAccount.map((a) => (
                <TableRow key={a.account_id} className={a.reversed ? "opacity-60" : undefined}>
                  <TableCell className="py-1.5 text-xs">
                    <span className="font-mono">{a.account_code}</span> {a.account_name}
                    {a.reversed && (
                       <Badge variant="outline" className="ms-2 text-[10px] py-0 px-1 text-muted-foreground">
                         {t("app.expenses.posting.reversedNoEffect")}
                      </Badge>
                    )}
                  </TableCell>
                   <TableCell className="py-1.5 text-xs text-end tabular-nums">
                    {a.net > 0.005 ? a.net.toFixed(2) : ""}
                  </TableCell>
                   <TableCell className="py-1.5 text-xs text-end tabular-nums">
                    {a.net < -0.005 ? Math.abs(a.net).toFixed(2) : ""}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {hasReversals && effective.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("app.expenses.posting.reversalExplanation")}
        </p>
      )}

      {showUnbalanced && (
        <p className="text-xs text-destructive">
          {t("app.expenses.posting.unbalancedHelp")}
        </p>
      )}
      {showUnposted && ledgerPosted && (
        <p className="text-xs text-muted-foreground">
          {t("app.expenses.posting.missingRowsHelp")}
        </p>
      )}

      <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("expenses.journal.overrideTitle")}</DialogTitle>
            <DialogDescription>
              {ledgerPosted ? t("expenses.journal.overridePostedHelp") : t("expenses.journal.overrideUnpostedHelp")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {latestAiAudit && (
              <div className="rounded-md border bg-muted/30 p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{latestAiAudit.account?.account_code} · {latestAiAudit.account?.account_name}</span>
                  {latestAiAudit.confidence != null && <Badge variant="outline">{Math.round(latestAiAudit.confidence * 100)}%</Badge>}
                </div>
                {latestAiAudit.rationale && <p className="mt-1 text-muted-foreground">{latestAiAudit.rationale}</p>}
              </div>
            )}
            <div className="space-y-2">
              <Label>{t("expenses.journal.replacementAccount")}</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger><SelectValue placeholder={t("expenses.journal.selectAccount")} /></SelectTrigger>
                <SelectContent>
                  {eligibleAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.account_code} · {account.account_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`override-reason-${expenseId}`}>{t("expenses.journal.overrideReason")}</Label>
              <Textarea
                id={`override-reason-${expenseId}`}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={t("expenses.journal.overrideReasonPlaceholder")}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideOpen(false)} disabled={overrideMutation.isPending}>
              {t("expenses.journal.cancel")}
            </Button>
            <Button onClick={() => overrideMutation.mutate()} disabled={!accountId || reason.trim().length < 3 || overrideMutation.isPending}>
              {overrideMutation.isPending ? t("expenses.journal.postingOverride") : t("expenses.journal.confirmOverride")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
