import { useQuery } from "@tanstack/react-query";

import { db } from "@/integrations/db/client";

/** Audit actions written whenever an invoice/ledger posting is repaired. */
export const INVOICE_REPAIR_ACTIONS = [
  "BULK_INVOICE_RECONCILE_FIX",
  "INVOICE_DUPLICATE_LINE_CORRECTION",
] as const;

export const REPAIR_RULE_LABELS: Record<string, string> = {
  BULK_INVOICE_RECONCILE_FIX:
    "Bulk reconcile & fix — identical description/qty/unit price lines removed, bill and expense totals recomputed",
  INVOICE_DUPLICATE_LINE_CORRECTION:
    "Same-timestamp duplicate line rule — duplicate line voided and the ledger legs reposted",
};

export interface InvoiceRepairAuditRow {
  id: string;
  action: string;
  ruleLabel: string;
  entityId: string | null;
  createdAt: string;
  performedBy: string | null;
  invoiceNumber: string | null;
  supplierName: string | null;
  before: { invoiceTotal: number | null; expenseAmount: number | null; ledgerDebit: number | null };
  after: { invoiceTotal: number | null; expenseAmount: number | null; ledgerDebit: number | null };
  removedLines: number;
  needsLedgerRepost: boolean;
  duplicateGroups: Array<Record<string, any>>;
  raw: { old: Record<string, any>; new: Record<string, any> };
}

const num = (v: any): number | null => (v == null || v === "" ? null : Number(v));

/**
 * Every repaired invoice / ledger posting: before and after amounts, when it
 * happened, who ran it, and which correction rule fired.
 */
export function useInvoiceRepairAudit(limit = 100) {
  return useQuery({
    queryKey: ["invoice-repair-audit", limit],
    staleTime: 60_000,
    queryFn: async (): Promise<InvoiceRepairAuditRow[]> => {
      const { data, error } = await (db as any)
        .from("audit_logs")
        .select("id, action, entity_id, old_data, new_data, created_at, user_id")
        .in("action", INVOICE_REPAIR_ACTIONS as unknown as string[])
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;

      const logs = (data ?? []) as any[];
      const invoiceIds = Array.from(
        new Set(logs.map((l) => l.entity_id).filter(Boolean)),
      ) as string[];
      const userIds = Array.from(new Set(logs.map((l) => l.user_id).filter(Boolean))) as string[];

      const [invoicesRes, profilesRes] = await Promise.all([
        invoiceIds.length
          ? (db as any)
              .from("purchase_invoices")
              .select("id, invoice_number, suppliers(name)")
              .in("id", invoiceIds)
          : Promise.resolve({ data: [] }),
        userIds.length
          ? (db as any).from("profiles").select("id, full_name").in("id", userIds)
          : Promise.resolve({ data: [] }),
      ]);

      const invoiceMap = new Map<string, { number: string | null; supplier: string | null }>();
      ((invoicesRes as any).data ?? []).forEach((i: any) =>
        invoiceMap.set(i.id, {
          number: i.invoice_number ?? null,
          supplier: i.suppliers?.name ?? null,
        }),
      );
      const userMap = new Map<string, string>();
      ((profilesRes as any).data ?? []).forEach((p: any) =>
        userMap.set(p.id, p.full_name || "Unknown user"),
      );

      return logs.map((l) => {
        const o = (l.old_data ?? {}) as Record<string, any>;
        const n = (l.new_data ?? {}) as Record<string, any>;
        const inv = l.entity_id ? invoiceMap.get(l.entity_id) : undefined;
        const dupGroups = Array.isArray(o.duplicate_groups)
          ? o.duplicate_groups
          : o.duplicate_line
            ? [o.duplicate_line]
            : [];
        return {
          id: l.id,
          action: l.action,
          ruleLabel: REPAIR_RULE_LABELS[l.action] ?? l.action,
          entityId: l.entity_id ?? null,
          createdAt: l.created_at,
          performedBy: l.user_id ? (userMap.get(l.user_id) ?? "Unknown user") : null,
          invoiceNumber: inv?.number ?? null,
          supplierName: inv?.supplier ?? null,
          before: {
            invoiceTotal: num(o.total_amount ?? o.invoice_total),
            expenseAmount: num(o.expense_amount),
            ledgerDebit: num(o.ledger_debit),
          },
          after: {
            invoiceTotal: num(n.total_amount ?? n.invoice_total),
            expenseAmount: num(n.expense_amount),
            ledgerDebit: num(n.ledger_debit),
          },
          removedLines: Number(n.removed_lines ?? 0) || 0,
          needsLedgerRepost: Boolean(n.needs_ledger_repost),
          duplicateGroups: dupGroups,
          raw: { old: o, new: n },
        };
      });
    },
  });
}