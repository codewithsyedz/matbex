import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { db } from "@/integrations/db/client";

export interface InvoiceDuplicateGroup {
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  occurrences: number;
  excess_amount: number;
}

export interface InvoiceDivergenceRow {
  invoice_id: string;
  invoice_number: string;
  invoice_date: string;
  supplier_name: string | null;
  branch_id: string | null;
  invoice_total: number;
  lines_total: number;
  unique_lines_total: number;
  duplicate_amount: number;
  duplicate_line_count: number;
  expense_id: string | null;
  expense_amount: number | null;
  ledger_debit: number | null;
  ledger_leg_count: number;
  issues: string[];
  duplicate_groups: InvoiceDuplicateGroup[];
}

export interface InvoiceDivergenceParams {
  branchId?: string | null;
  from?: string | null;
  to?: string | null;
}

/**
 * Runs the backend automated check that flags bills whose line total diverges
 * from the ledger postings and returns the suspected duplicate line groups.
 */
export function useInvoiceDivergenceCheck() {
  return useMutation({
    mutationFn: async (params: InvoiceDivergenceParams): Promise<InvoiceDivergenceRow[]> => {
      const { data, error } = await (db as any).rpc("detect_invoice_ledger_divergence", {
        p_branch_id: params.branchId && params.branchId !== "all" ? params.branchId : null,
        p_from: params.from || null,
        p_to: params.to || null,
      });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        ...r,
        invoice_total: Number(r.invoice_total) || 0,
        lines_total: Number(r.lines_total) || 0,
        unique_lines_total: Number(r.unique_lines_total) || 0,
        duplicate_amount: Number(r.duplicate_amount) || 0,
        duplicate_line_count: Number(r.duplicate_line_count) || 0,
        expense_amount: r.expense_amount == null ? null : Number(r.expense_amount),
        ledger_debit: r.ledger_debit == null ? null : Number(r.ledger_debit),
        ledger_leg_count: Number(r.ledger_leg_count) || 0,
        issues: (r.issues ?? []) as string[],
        duplicate_groups: (r.duplicate_groups ?? []) as InvoiceDuplicateGroup[],
      }));
    },
    onError: (e: any) => toast.error(e?.message ?? "Automated check failed"),
  });
}

export interface InvoiceBulkFixRow {
  invoice_id: string;
  invoice_number: string;
  status:
    | "no_change"
    | "would_fix"
    | "fixed"
    | "fixed_needs_repost"
    | "needs_ledger_repost"
    | string;
  removed_lines: number;
  old_total: number;
  new_total: number;
  duplicate_amount: number;
  expense_id: string | null;
  old_expense_amount: number | null;
  new_expense_amount: number | null;
  ledger_debit: number | null;
  needs_ledger_repost: boolean;
  message: string | null;
}

export interface BulkInvoiceFixParams {
  invoiceIds: string[];
  dryRun: boolean;
}

/**
 * Bulk "reconcile and fix": removes duplicated invoice lines and recomputes the
 * inflated bill / expense totals for the selected bills. Dry run previews only.
 */
export function useBulkInvoiceFix() {
  return useMutation({
    mutationFn: async ({ invoiceIds, dryRun }: BulkInvoiceFixParams): Promise<InvoiceBulkFixRow[]> => {
      const { data, error } = await (db as any).rpc("bulk_fix_invoice_divergence", {
        p_invoice_ids: invoiceIds,
        p_dry_run: dryRun,
      });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        ...r,
        removed_lines: Number(r.removed_lines) || 0,
        old_total: Number(r.old_total) || 0,
        new_total: Number(r.new_total) || 0,
        duplicate_amount: Number(r.duplicate_amount) || 0,
        old_expense_amount: r.old_expense_amount == null ? null : Number(r.old_expense_amount),
        new_expense_amount: r.new_expense_amount == null ? null : Number(r.new_expense_amount),
        ledger_debit: r.ledger_debit == null ? null : Number(r.ledger_debit),
        needs_ledger_repost: Boolean(r.needs_ledger_repost),
      }));
    },
    onError: (e: any) => toast.error(e?.message ?? "Bulk fix failed"),
  });
}
