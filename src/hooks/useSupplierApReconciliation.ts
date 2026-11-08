import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface SupplierApReconRow {
  supplierId: string;
  supplierName: string;
  apAccountId: string | null;
  apAccountCode: string | null;
  apAccountName: string | null;
  /** Open amount from the expense sub-ledger (billed - paid on unsettled bills) */
  subledgerOpen: number;
  /** Credit - debit on the supplier's own AP head */
  glDedicated: number;
  /** Credit - debit on shared AP control accounts for this supplier's bills */
  glShared: number;
  glOpen: number;
  variance: number;
  openBills: number;
  unpostedBills: number;
}

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function useSupplierApReconciliation(branchId?: string | null) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  const branchKey = branchId && branchId !== "all" ? branchId : null;

  const query = useQuery({
    queryKey: ["supplier-ap-reconciliation", tenantId, branchKey],
    enabled: !!tenantId,
    staleTime: 1000 * 60 * 2,
    queryFn: async () => {
      // Suppliers + their dedicated AP heads
      const { data: suppliers, error: supErr } = await supabase
        .from("suppliers")
        .select("id, name, ap_account_id, is_active")
        .eq("restaurant_id", tenantId!)
        .order("name");
      if (supErr) throw supErr;

      // Chart of accounts: dedicated heads + shared AP controls
      const { data: accounts, error: accErr } = await supabase
        .from("chart_of_accounts")
        .select("id, account_code, account_name, account_type")
        .eq("tenant_id", tenantId!)
        .eq("account_type", "liability");
      if (accErr) throw accErr;

      const accountMap = Object.fromEntries(
        (accounts ?? []).map((a) => [a.id, { code: a.account_code, name: a.account_name }]),
      );
      const sharedApIds = new Set(
        (accounts ?? [])
          .filter((a) => a.account_code.startsWith("2000") || a.account_code === "2000")
          .map((a) => a.id),
      );
      const dedicatedByAccount = new Map<string, string>();
      for (const s of suppliers ?? []) {
        if (s.ap_account_id) dedicatedByAccount.set(s.ap_account_id, s.id);
      }

      // Expense sub-ledger (open bills carrying a supplier)
      let expQ = supabase
        .from("expenses")
        .select("id, supplier_id, amount, vat_amount, paid_amount, status, ledger_posted, branch_id")
        .eq("tenant_id", tenantId!)
        .is("deleted_at", null)
        .not("supplier_id", "is", null);
      if (branchKey) expQ = expQ.eq("branch_id", branchKey);
      const { data: expenses, error: expErr } = await expQ;
      if (expErr) throw expErr;

      const expenseIds = (expenses ?? []).map((e) => e.id);

      // Ledger legs against those expenses (AP heads only matter here)
      const legs: Array<{
        account_id: string;
        reference_id: string;
        debit: number;
        credit: number;
      }> = [];
      for (const ids of chunk(expenseIds, 150)) {
        const { data, error } = await supabase
          .from("account_transactions")
          .select("account_id, reference_id, debit, credit, is_voided, branch_id")
          .eq("tenant_id", tenantId!)
          .in("reference_id", ids);
        if (error) throw error;
        for (const l of data ?? []) {
          if (l.is_voided) continue;
          if (branchKey && l.branch_id && l.branch_id !== branchKey) continue;
          legs.push({
            account_id: l.account_id,
            reference_id: l.reference_id,
            debit: Number(l.debit ?? 0),
            credit: Number(l.credit ?? 0),
          });
        }
      }

      const supplierByExpense = new Map<string, string>();
      for (const e of expenses ?? []) supplierByExpense.set(e.id, e.supplier_id as string);

      const rows = new Map<string, SupplierApReconRow>();
      const ensure = (id: string): SupplierApReconRow => {
        const existing = rows.get(id);
        if (existing) return existing;
        const s = (suppliers ?? []).find((x) => x.id === id);
        const meta = s?.ap_account_id ? accountMap[s.ap_account_id] : undefined;
        const row: SupplierApReconRow = {
          supplierId: id,
          supplierName: s?.name ?? "Unknown supplier",
          apAccountId: s?.ap_account_id ?? null,
          apAccountCode: meta?.code ?? null,
          apAccountName: meta?.name ?? null,
          subledgerOpen: 0,
          glDedicated: 0,
          glShared: 0,
          glOpen: 0,
          variance: 0,
          openBills: 0,
          unpostedBills: 0,
        };
        rows.set(id, row);
        return row;
      };

      for (const e of expenses ?? []) {
        const row = ensure(e.supplier_id as string);
        const billed = Number(e.amount ?? 0) + Number(e.vat_amount ?? 0);
        const open = billed - Number(e.paid_amount ?? 0);
        if (e.status !== "paid" && open > 0.005) {
          row.subledgerOpen += open;
          row.openBills += 1;
          if (!e.ledger_posted) row.unpostedBills += 1;
        }
      }

      for (const l of legs) {
        const supplierId = supplierByExpense.get(l.reference_id);
        if (!supplierId) continue;
        const dedicatedOwner = dedicatedByAccount.get(l.account_id);
        const isShared = sharedApIds.has(l.account_id);
        if (!dedicatedOwner && !isShared) continue;
        const row = ensure(supplierId);
        const net = l.credit - l.debit;
        if (dedicatedOwner === supplierId) row.glDedicated += net;
        else if (isShared) row.glShared += net;
      }

      const result = Array.from(rows.values()).map((r) => {
        const subledgerOpen = round2(r.subledgerOpen);
        const glDedicated = round2(r.glDedicated);
        const glShared = round2(r.glShared);
        const glOpen = round2(glDedicated + glShared);
        return {
          ...r,
          subledgerOpen,
          glDedicated,
          glShared,
          glOpen,
          variance: round2(subledgerOpen - glOpen),
        };
      });

      return result
        .filter((r) => r.subledgerOpen !== 0 || r.glOpen !== 0)
        .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance) || b.glOpen - a.glOpen);
    },
  });

  const rows = query.data ?? [];

  const totals = useMemo(
    () => ({
      subledgerOpen: round2(rows.reduce((s, r) => s + r.subledgerOpen, 0)),
      glOpen: round2(rows.reduce((s, r) => s + r.glOpen, 0)),
      glShared: round2(rows.reduce((s, r) => s + r.glShared, 0)),
      variance: round2(rows.reduce((s, r) => s + r.variance, 0)),
      mismatched: rows.filter((r) => Math.abs(r.variance) > 0.01).length,
      onSharedControl: rows.filter((r) => Math.abs(r.glShared) > 0.01).length,
      missingHeads: rows.filter((r) => !r.apAccountId).length,
    }),
    [rows],
  );

  return {
    rows,
    totals,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    refetch: query.refetch,
  };
}
