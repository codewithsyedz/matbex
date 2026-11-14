import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
export type ReversalEventKind =
  | "void"
  | "reversal_batch"
  | "adjustment_reversed"
  | "overhead_reopened"
  | "overhead_adjusted";

export interface ReversalAuditLeg {
  accountCode: string | null;
  accountName: string | null;
  debit: number;
  credit: number;
  isVoided: boolean;
}

export interface ReversalAuditEvent {
  id: string;
  kind: ReversalEventKind;
  occurredAt: string;
  title: string;
  detail: string | null;
  reason: string | null;
  actorName: string | null;
  amount: number | null;
  branchId: string | null;
  branchName: string | null;
  batchId: string | null;
  referenceNumber: string | null;
  legs: ReversalAuditLeg[];
}

export const REVERSAL_KIND_LABEL: Record<ReversalEventKind, string> = {
  void: "Voided batch",
  reversal_batch: "Reversal entry",
  adjustment_reversed: "Day-end adjustment reversed",
  overhead_reopened: "Overhead day reopened",
  overhead_adjusted: "Overhead day adjusted",
};

interface Args {
  /** "all" / null = every branch. */
  branchId?: string | null;
  date: Date;
}

export function useReversalAudit({ branchId, date }: Args) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  const branchKey = branchId && branchId !== "all" ? branchId : null;
  const dateKey = format(date, "yyyy-MM-dd");

  const query = useQuery({
    queryKey: ["reversal-audit", tenantId, branchKey, dateKey],
    enabled: !!tenantId,
    staleTime: 60_000,
    queryFn: async (): Promise<ReversalAuditEvent[]> => {
      // ---- ledger legs on this business date -------------------------------
      let legQ = db
        .from("account_transactions")
        .select(
          "id, account_id, batch_id, branch_id, transaction_date, debit, credit, description, created_at, created_by, is_voided, voided_at, voided_by, void_reason",
        )
        .eq("tenant_id", tenantId)
        .eq("transaction_date", dateKey)
        .limit(3000);
      if (branchKey) legQ = legQ.eq("branch_id", branchKey);

      const [{ data: legs, error: legErr }, branchesRes] = await Promise.all([
        legQ,
        db.from("branches").select("id, name"),
      ]);
      if (legErr) throw legErr;

      const branchNames = new Map<string, string>();
      (branchesRes.data || []).forEach((b: any) => branchNames.set(b.id, b.name));

      const rows = (legs || []) as any[];
      const batchIds = Array.from(new Set(rows.map((r) => r.batch_id).filter(Boolean))) as string[];
      const accountIds = Array.from(new Set(rows.map((r) => r.account_id).filter(Boolean))) as string[];

      const [batchesRes, accountsRes] = await Promise.all([
        batchIds.length
          ? db
              .from("journal_entry_batches")
              .select(
                "id, reference_number, entry_type, journal_type, description, batch_date, created_at, created_by, branch_id",
              )
              .in("id", batchIds)
          : Promise.resolve({ data: [] }),
        accountIds.length
          ? db.from("chart_of_accounts").select("id, account_code, account_name").in("id", accountIds)
          : Promise.resolve({ data: [] }),
      ]);

      const batches = new Map<string, any>();
      (batchesRes.data || []).forEach((b: any) => batches.set(b.id, b));
      const accounts = new Map<string, any>();
      (accountsRes.data || []).forEach((a: any) => accounts.set(a.id, a));

      // ---- day-end adjustments --------------------------------------------
      let adjQ = db
        .from("day_end_adjustments")
        .select(
          "id, business_date, branch_id, scope, reason, notes, amount, created_at, created_by, reversed_at, reversed_by, reversal_reason, reversal_of_id, ledger_batch_id",
        )
        .eq("tenant_id", tenantId)
        .eq("business_date", dateKey);
      if (branchKey) adjQ = adjQ.eq("branch_id", branchKey);
      const { data: adjustments } = await adjQ;

      // ---- daily overhead closures + audit ---------------------------------
      let closureQ = db
        .from("daily_overhead_closures")
        .select("id, business_date, branch_id, status")
        .eq("tenant_id", tenantId)
        .eq("business_date", dateKey);
      if (branchKey) closureQ = closureQ.eq("branch_id", branchKey);
      const { data: closures } = await closureQ;
      const closureIds = (closures || []).map((c: any) => c.id);
      const closureBranch = new Map<string, string | null>();
      (closures || []).forEach((c: any) => closureBranch.set(c.id, c.branch_id ?? null));

      const overheadAudit = closureIds.length
        ? (
            await db
              .from("daily_overhead_audit")
              .select("id, closure_id, action, amount_before, amount_after, reason, performed_by, performed_at, batch_id, gl_reference")
              .in("closure_id", closureIds)
              .order("performed_at", { ascending: false })
          ).data || []
        : [];

      // ---- resolve actor names ---------------------------------------------
      const userIds = Array.from(
        new Set(
          [
            ...rows.map((r) => r.voided_by),
            ...(batchesRes.data || []).map((b: any) => b.created_by),
            ...(adjustments || []).map((a: any) => a.reversed_by),
            ...(adjustments || []).map((a: any) => a.created_by),
            ...overheadAudit.map((a: any) => a.performed_by),
          ].filter(Boolean),
        ),
      ) as string[];
      const profilesRes = userIds.length
        ? await db.from("profiles").select("id, full_name").in("id", userIds)
        : { data: [] };
      const names = new Map<string, string>();
      (profilesRes.data || []).forEach((p: any) => names.set(p.id, p.full_name || "Unknown user"));
      const nameOf = (id: string | null | undefined) => (id ? names.get(id) ?? "Unknown user" : null);

      const events: ReversalAuditEvent[] = [];

      // A) voided batches + reversal batches
      const grouped = new Map<string, any[]>();
      rows.forEach((r) => {
        if (!r.batch_id) return;
        const arr = grouped.get(r.batch_id) ?? [];
        arr.push(r);
        grouped.set(r.batch_id, arr);
      });

      grouped.forEach((batchLegs, batchId) => {
        const batch = batches.get(batchId);
        const voidedLegs = batchLegs.filter((l) => l.is_voided);
        const bid = batch?.branch_id ?? batchLegs[0]?.branch_id ?? null;
        const legList: ReversalAuditLeg[] = batchLegs.map((l) => ({
          accountCode: accounts.get(l.account_id)?.account_code ?? null,
          accountName: accounts.get(l.account_id)?.account_name ?? null,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          isVoided: !!l.is_voided,
        }));

        if (voidedLegs.length > 0) {
          const voidedAt = voidedLegs
            .map((l) => l.voided_at)
            .filter(Boolean)
            .sort()
            .pop();
          events.push({
            id: `void-${batchId}`,
            kind: "void",
            occurredAt: voidedAt || batch?.created_at || batchLegs[0].created_at,
            title:
              voidedLegs.length === batchLegs.length
                ? "Whole batch voided"
                : `${voidedLegs.length} of ${batchLegs.length} lines voided`,
            detail: batch?.description ?? batchLegs[0].description ?? null,
            reason: voidedLegs.find((l) => l.void_reason)?.void_reason ?? null,
            actorName: nameOf(voidedLegs.find((l) => l.voided_by)?.voided_by),
            amount: voidedLegs.reduce((s, l) => s + (Number(l.debit) || 0), 0),
            branchId: bid,
            branchName: bid ? branchNames.get(bid) ?? null : null,
            batchId,
            referenceNumber: batch?.reference_number ?? null,
            legs: legList,
          });
        }

        const desc: string = (batch?.description || "").toLowerCase();
        const isReversalBatch =
          batch &&
          (batch.entry_type === "reversal" ||
            batch.journal_type === "reversal" ||
            desc.startsWith("reversal") ||
            desc.includes("reversal of"));
        if (isReversalBatch) {
          events.push({
            id: `rev-${batchId}`,
            kind: "reversal_batch",
            occurredAt: batch.created_at,
            title: "Reversal journal posted",
            detail: batch.description ?? null,
            reason: null,
            actorName: nameOf(batch.created_by),
            amount: batchLegs.reduce((s, l) => s + (Number(l.debit) || 0), 0),
            branchId: bid,
            branchName: bid ? branchNames.get(bid) ?? null : null,
            batchId,
            referenceNumber: batch.reference_number ?? null,
            legs: legList,
          });
        }
      });

      // B) day-end adjustments reversed / reversal rows
      (adjustments || []).forEach((a: any) => {
        if (!a.reversed_at && !a.reversal_of_id) return;
        const bid = a.branch_id ?? null;
        events.push({
          id: `adj-${a.id}`,
          kind: "adjustment_reversed",
          occurredAt: a.reversed_at || a.created_at,
          title: a.reversal_of_id
            ? `Reversing adjustment recorded (${a.scope})`
            : `Adjustment reversed (${a.scope})`,
          detail: a.notes ?? null,
          reason: a.reversal_reason ?? null,
          actorName: nameOf(a.reversed_by ?? a.created_by),
          amount: Number(a.amount) || 0,
          branchId: bid,
          branchName: bid ? branchNames.get(bid) ?? null : null,
          batchId: a.ledger_batch_id ?? null,
          referenceNumber: null,
          legs: [],
        });
      });

      // C) overhead reopen / adjust actions
      overheadAudit.forEach((a: any) => {
        const action = String(a.action || "").toLowerCase();
        const isReopen = action.includes("reopen");
        const isAdjust = action.includes("adjust") || action.includes("revers");
        if (!isReopen && !isAdjust) return;
        const bid = closureBranch.get(a.closure_id) ?? null;
        events.push({
          id: `oh-${a.id}`,
          kind: isReopen ? "overhead_reopened" : "overhead_adjusted",
          occurredAt: a.performed_at,
          title: isReopen ? "Overhead day reopened" : "Overhead amount adjusted",
          detail:
            a.amount_before != null || a.amount_after != null
              ? `${a.amount_before ?? "—"} → ${a.amount_after ?? "—"}`
              : a.gl_reference ?? null,
          reason: a.reason ?? null,
          actorName: nameOf(a.performed_by),
          amount: a.amount_after != null ? Number(a.amount_after) : null,
          branchId: bid,
          branchName: bid ? branchNames.get(bid) ?? null : null,
          batchId: a.batch_id ?? null,
          referenceNumber: a.gl_reference ?? null,
          legs: [],
        });
      });

      events.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
      return events;
    },
  });

  return {
    events: query.data ?? [],
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
