import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  evaluateInvoiceReconciliation,
  round2,
  type InvoiceLineGroup,
  type InvoiceReconIssue,
} from "@/lib/invoiceReconciliation";

export type { InvoiceLineGroup, InvoiceReconIssue } from "@/lib/invoiceReconciliation";
export { INVOICE_RECON_ISSUE_LABELS } from "@/lib/invoiceReconciliation";

export interface InvoiceReconRow {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  supplierName: string | null;
  branchId: string | null;
  branchName: string | null;
  invoiceTotal: number;
  itemsSum: number;
  dedupSum: number;
  duplicateAmount: number;
  lineCount: number;
  duplicateLineCount: number;
  expenseId: string | null;
  expenseAmount: number | null;
  ledgerAmount: number | null;
  ledgerLegCount: number;
  issues: InvoiceReconIssue[];
  worstIssue: InvoiceReconIssue;
  groups: InvoiceLineGroup[];
}

export interface InvoiceReconTotals {
  scanned: number;
  flagged: number;
  duplicateLines: number;
  duplicateAmount: number;
  totalMismatch: number;
  expenseMismatch: number;
  ledgerMismatch: number;
  notPosted: number;
}

export interface InvoiceReconFilters {
  branchId?: string | null;
  from?: string | null;
  to?: string | null;
}

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};


/**
 * Cross-checks purchase invoices against their line items, the linked expense
 * and the transactional ledger. Duplicated line rows (the historical cause of
 * doubled totals) are surfaced per bill with a per-line drilldown.
 */
export function useInvoiceLedgerReconciliation(filters: InvoiceReconFilters) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  const branchKey = filters.branchId && filters.branchId !== "all" ? filters.branchId : null;
  const from = filters.from || null;
  const to = filters.to || null;

  const query = useQuery({
    queryKey: ["invoice-ledger-reconciliation", tenantId, branchKey, from, to],
    enabled: !!tenantId,
    staleTime: 1000 * 60,
    queryFn: async (): Promise<InvoiceReconRow[]> => {
      let invQ: any = (supabase as any)
        .from("purchase_invoices")
        .select("id, invoice_number, invoice_date, subtotal, total_amount, tax_amount, supplier_id, branch_id")
        .eq("restaurant_id", tenantId!)
        .order("invoice_date", { ascending: false })
        .limit(2000);
      if (branchKey) invQ = invQ.eq("branch_id", branchKey);
      if (from) invQ = invQ.gte("invoice_date", from);
      if (to) invQ = invQ.lte("invoice_date", to);

      const [invRes, branchRes, supplierRes]: any[] = await Promise.all([
        invQ,
        (supabase as any).from("branches").select("id, name").eq("tenant_id", tenantId!),
        (supabase as any).from("suppliers").select("id, name").eq("restaurant_id", tenantId!),
      ]);
      if (invRes.error) throw invRes.error;
      const invoices = (invRes.data ?? []) as any[];
      if (invoices.length === 0) return [];

      const branchNames = new Map<string, string>(
        (branchRes.data ?? []).map((b: any) => [b.id as string, b.name as string]),
      );
      const supplierNames = new Map<string, string>(
        (supplierRes.data ?? []).map((s: any) => [s.id as string, s.name as string]),
      );

      const invoiceIds = invoices.map((i) => i.id as string);

      // Line items
      const linesByInvoice = new Map<string, any[]>();
      for (const part of chunk(invoiceIds, 150)) {
        const { data, error } = await (supabase as any)
          .from("invoice_items")
          .select("id, invoice_id, description, quantity, unit_price, total_price, created_at")
          .in("invoice_id", part);
        if (error) throw error;
        for (const l of (data ?? []) as any[]) {
          const arr = linesByInvoice.get(l.invoice_id) ?? [];
          arr.push(l);
          linesByInvoice.set(l.invoice_id, arr);
        }
      }

      // Linked expenses
      const expenseByInvoice = new Map<string, any>();
      for (const part of chunk(invoiceIds, 150)) {
        const { data, error } = await (supabase as any)
          .from("expenses")
          .select("id, purchase_invoice_id, amount, ledger_posted")
          .eq("tenant_id", tenantId!)
          .is("deleted_at", null)
          .in("purchase_invoice_id", part);
        if (error) throw error;
        for (const e of (data ?? []) as any[]) expenseByInvoice.set(e.purchase_invoice_id, e);
      }

      // Ledger legs for the original postings (settlement batches excluded)
      const expenseIds = Array.from(expenseByInvoice.values()).map((e) => e.id as string);
      const rawLegs: any[] = [];
      for (const part of chunk(expenseIds, 150)) {
        if (part.length === 0) continue;
        const { data, error } = await (supabase as any)
          .from("account_transactions")
          .select("reference_id, debit, credit, is_voided, batch_id")
          .eq("tenant_id", tenantId!)
          .eq("reference_type", "expense")
          .in("reference_id", part);
        if (error) throw error;
        for (const leg of (data ?? []) as any[]) if (!leg.is_voided) rawLegs.push(leg);
      }

      const batchIds = Array.from(new Set(rawLegs.map((l) => l.batch_id).filter(Boolean) as string[]));
      const settlementBatches = new Set<string>();
      for (const part of chunk(batchIds, 150)) {
        if (part.length === 0) continue;
        const { data } = await (supabase as any)
          .from("journal_entry_batches")
          .select("id, entry_type, reference_number")
          .in("id", part);
        for (const b of (data ?? []) as any[]) {
          const ref = String(b.reference_number ?? "");
          if (b.entry_type === "payment" || ref.startsWith("EXPPAY-") || ref.startsWith("APREMAP")) {
            settlementBatches.add(b.id as string);
          }
        }
      }

      const ledger = new Map<string, { dr: number; legs: number }>();
      for (const leg of rawLegs) {
        if (leg.batch_id && settlementBatches.has(leg.batch_id)) continue;
        const cur = ledger.get(leg.reference_id) ?? { dr: 0, legs: 0 };
        cur.dr += Number(leg.debit) || 0;
        cur.legs += 1;
        ledger.set(leg.reference_id, cur);
      }

      return invoices.map((inv: any): InvoiceReconRow => {
        const lines = linesByInvoice.get(inv.id) ?? [];
        const expense = expenseByInvoice.get(inv.id) ?? null;
        const led = expense ? ledger.get(expense.id) ?? null : null;
        const evaluation = evaluateInvoiceReconciliation({
          invoice: inv,
          lines,
          expenseAmount: expense ? expense.amount : null,
          hasExpense: !!expense,
          ledgerDebit: led ? led.dr : null,
          ledgerLegCount: led?.legs ?? 0,
        });

        return {
          invoiceId: inv.id,
          invoiceNumber: inv.invoice_number,
          invoiceDate: inv.invoice_date,
          supplierName: inv.supplier_id ? supplierNames.get(inv.supplier_id) ?? null : null,
          branchId: inv.branch_id ?? null,
          branchName: inv.branch_id ? branchNames.get(inv.branch_id) ?? null : null,
          invoiceTotal: evaluation.invoiceTotal,
          itemsSum: evaluation.itemsSum,
          dedupSum: evaluation.dedupSum,
          duplicateAmount: evaluation.duplicateAmount,
          lineCount: evaluation.lineCount,
          duplicateLineCount: evaluation.duplicateLineCount,
          expenseId: expense?.id ?? null,
          expenseAmount: expense ? round2(expense.amount) : null,
          ledgerAmount: led ? round2(led.dr) : null,
          ledgerLegCount: led?.legs ?? 0,
          issues: evaluation.issues,
          worstIssue: evaluation.worstIssue,
          groups: evaluation.groups,
        };
      });
    },
  });

  const rows = query.data ?? [];

  const totals = useMemo<InvoiceReconTotals>(() => {
    const t: InvoiceReconTotals = {
      scanned: rows.length,
      flagged: 0,
      duplicateLines: 0,
      duplicateAmount: 0,
      totalMismatch: 0,
      expenseMismatch: 0,
      ledgerMismatch: 0,
      notPosted: 0,
    };
    for (const r of rows) {
      if (r.issues.length > 0) t.flagged += 1;
      if (r.issues.includes("duplicate_lines")) {
        t.duplicateLines += 1;
        t.duplicateAmount = round2(t.duplicateAmount + r.duplicateAmount);
      }
      if (r.issues.includes("total_mismatch")) t.totalMismatch += 1;
      if (r.issues.includes("expense_mismatch")) t.expenseMismatch += 1;
      if (r.issues.includes("ledger_mismatch")) t.ledgerMismatch += 1;
      if (r.issues.includes("not_posted")) t.notPosted += 1;
    }
    return t;
  }, [rows]);

  return {
    rows,
    totals,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}
