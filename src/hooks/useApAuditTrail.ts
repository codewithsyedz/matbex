import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { settlementKindOf, type SettlementKind } from "@/lib/apSettlement";

export interface ApAuditLeg {
  id: string;
  accountCode: string | null;
  accountName: string | null;
  debit: number;
  credit: number;
  isVoided: boolean;
  voidReason: string | null;
  voidedAt: string | null;
  voidedByName: string | null;
}

export interface ApAuditEvent {
  batchId: string;
  referenceNumber: string | null;
  kind: Exclude<SettlementKind, null> | "posting";
  entryType: string | null;
  description: string | null;
  transactionDate: string;
  createdAt: string;
  postedAt: string | null;
  createdByName: string | null;
  postedByName: string | null;
  branchId: string | null;
  branchName: string | null;
  expenseId: string | null;
  expenseDescription: string | null;
  supplierName: string | null;
  amount: number;
  isVoided: boolean;
  legs: ApAuditLeg[];
}

interface Args {
  /** Restrict to a single expense / payable. */
  expenseId?: string | null;
  /** "all" / null = consolidated across branches. */
  branchId?: string | null;
  from: Date;
  to: Date;
  /** Include the original EXP- posting alongside settlements/reversals. */
  includePostings?: boolean;
}

export function useApAuditTrail({ expenseId, branchId, from, to, includePostings = true }: Args) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  const branchKey = branchId && branchId !== "all" ? branchId : null;
  const fromKey = format(from, "yyyy-MM-dd");
  const toKey = format(to, "yyyy-MM-dd");

  const query = useQuery({
    queryKey: ["ap-audit-trail", tenantId, expenseId ?? null, branchKey, fromKey, toKey, includePostings],
    enabled: !!tenantId,
    staleTime: 1000 * 60,
    queryFn: async (): Promise<ApAuditEvent[]> => {
      let legQuery = db
        .from("account_transactions")
        .select(
          "id, account_id, batch_id, branch_id, reference_id, transaction_date, debit, credit, description, created_at, created_by, is_voided, voided_at, voided_by, void_reason",
        )
        .eq("tenant_id", tenantId!)
        .eq("reference_type", "expense")
        .gte("transaction_date", fromKey)
        .lte("transaction_date", toKey)
        .order("transaction_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(2000);

      if (expenseId) legQuery = legQuery.eq("reference_id", expenseId);
      if (branchKey) legQuery = legQuery.eq("branch_id", branchKey);

      const { data: legs, error } = await legQuery;
      if (error) throw error;

      const rows = (legs || []).filter((l: any) => l.batch_id);
      if (rows.length === 0) return [];

      const batchIds = Array.from(new Set(rows.map((r: any) => r.batch_id as string)));
      const accountIds = Array.from(new Set(rows.map((r: any) => r.account_id).filter(Boolean)));
      const expenseIds = Array.from(new Set(rows.map((r: any) => r.reference_id).filter(Boolean)));

      const [batchesRes, accountsRes, branchesRes, expensesRes] = await Promise.all([
        db
          .from("journal_entry_batches")
          .select("id, reference_number, entry_type, description, created_at, created_by, posted_at, posted_by, branch_id")
          .in("id", batchIds),
        accountIds.length
          ? db.from("chart_of_accounts").select("id, account_code, account_name").in("id", accountIds)
          : Promise.resolve({ data: [] } as any),
        db.from("branches").select("id, name"),
        expenseIds.length
          ? db.from("expenses").select("id, description, supplier_id").in("id", expenseIds as string[])
          : Promise.resolve({ data: [] } as any),
      ]);

      const batches = new Map<string, any>();
      (batchesRes.data || []).forEach((b: any) => batches.set(b.id, b));

      const userIds = Array.from(
        new Set(
          [
            ...(batchesRes.data || []).flatMap((b: any) => [b.created_by, b.posted_by]),
            ...rows.map((r: any) => r.voided_by),
          ].filter(Boolean),
        ),
      ) as string[];

      const profilesRes = userIds.length
        ? await db.from("profiles").select("id, full_name").in("id", userIds)
        : ({ data: [] } as any);

      const names = new Map<string, string>();
      (profilesRes.data || []).forEach((p: any) => names.set(p.id, p.full_name || "Unknown user"));
      const accounts = new Map<string, any>();
      (accountsRes.data || []).forEach((a: any) => accounts.set(a.id, a));
      const branchNames = new Map<string, string>();
      (branchesRes.data || []).forEach((b: any) => branchNames.set(b.id, b.name));
      const expenses = new Map<string, any>();
      (expensesRes.data || []).forEach((e: any) => expenses.set(e.id, e));

      const supplierIds = Array.from(
        new Set((expensesRes.data || []).map((e: any) => e.supplier_id).filter(Boolean)),
      ) as string[];
      const suppliersRes = supplierIds.length
        ? await db.from("suppliers").select("id, name").in("id", supplierIds)
        : ({ data: [] } as any);
      const supplierNames = new Map<string, string>();
      (suppliersRes.data || []).forEach((s: any) => supplierNames.set(s.id, s.name));

      const grouped = new Map<string, any[]>();
      rows.forEach((r: any) => {
        const arr = grouped.get(r.batch_id) ?? [];
        arr.push(r);
        grouped.set(r.batch_id, arr);
      });

      const events: ApAuditEvent[] = [];
      grouped.forEach((batchLegs, batchId) => {
        const batch = batches.get(batchId);
        const kindRaw = settlementKindOf(batch?.reference_number);
        const kind = kindRaw ?? "posting";
        if (!kindRaw && !includePostings) return;

        const active = batchLegs.filter((l) => !l.is_voided);
        const amount = (active.length ? active : batchLegs).reduce(
          (s, l) => s + (Number(l.debit) || 0),
          0,
        );
        const first = batchLegs[0];
        const branch = batch?.branch_id ?? first.branch_id ?? null;

        events.push({
          batchId,
          referenceNumber: batch?.reference_number ?? null,
          kind,
          entryType: batch?.entry_type ?? null,
          description: batch?.description ?? first.description ?? null,
          transactionDate: first.transaction_date,
          createdAt: batch?.created_at ?? first.created_at,
          postedAt: batch?.posted_at ?? null,
          createdByName: batch?.created_by ? names.get(batch.created_by) ?? "Unknown user" : null,
          postedByName: batch?.posted_by ? names.get(batch.posted_by) ?? "Unknown user" : null,
          branchId: branch,
          branchName: branch ? branchNames.get(branch) ?? null : null,
          expenseId: first.reference_id ?? null,
          expenseDescription: first.reference_id ? expenses.get(first.reference_id)?.description ?? null : null,
          supplierName: (() => {
            const sid = first.reference_id ? expenses.get(first.reference_id)?.supplier_id : null;
            return sid ? supplierNames.get(sid) ?? null : null;
          })(),
          amount,
          isVoided: batchLegs.length > 0 && batchLegs.every((l) => l.is_voided),
          legs: batchLegs.map((l) => ({
            id: l.id,
            accountCode: accounts.get(l.account_id)?.account_code ?? null,
            accountName: accounts.get(l.account_id)?.account_name ?? null,
            debit: Number(l.debit) || 0,
            credit: Number(l.credit) || 0,
            isVoided: !!l.is_voided,
            voidReason: l.void_reason ?? null,
            voidedAt: l.voided_at ?? null,
            voidedByName: l.voided_by ? names.get(l.voided_by) ?? "Unknown user" : null,
          })),
        });
      });

      events.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return events;
    },
  });

  return {
    events: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export const AP_EVENT_LABEL: Record<ApAuditEvent["kind"], string> = {
  posting: "Original posting",
  settlement: "Settlement (payment)",
  reversal: "Payment reversal",
};
