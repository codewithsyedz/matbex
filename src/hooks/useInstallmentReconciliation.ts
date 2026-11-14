import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  buildInstallmentReconRows,
  computeReconTotals,
  type InstallmentReconRow,
  type MatchStatus,
  type ReconAccount,
  type ReconLine,
} from "@/lib/installmentRecon";

/** Untyped client: installment tables are newer than the generated types. */
export type { InstallmentReconRow, MatchStatus, ReconLine };

interface Args {
  branchId?: string | null;
  periodStart: string;
  periodEnd: string;
}

export function useInstallmentReconciliation({ branchId, periodStart, periodEnd }: Args) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  const scope = branchId && branchId !== "all" ? branchId : null;

  return useQuery({
    queryKey: ["installment-reconciliation", tenantId, scope, periodStart, periodEnd],
    enabled: !!tenantId && !!periodStart && !!periodEnd,
    staleTime: 60 * 1000,
    queryFn: async () => {
      // 1. Scheduled installments due (or paid) inside the period
      let pq = db
        .from("installment_payments")
        .select("*")
        .eq("tenant_id", tenantId)
        .gte("due_date", periodStart)
        .lte("due_date", periodEnd)
        .order("due_date", { ascending: true });
      if (scope) pq = pq.eq("branch_id", scope);
      const { data: payRows, error: pErr } = await pq;
      if (pErr) throw pErr;
      const payments = (payRows ?? []) as any[];

      // 2. Parent plans
      const planIds = Array.from(new Set(payments.map((p) => p.plan_id)));
      let plans: any[] = [];
      if (planIds.length) {
        const { data, error } = await db
          .from("installment_plans")
          .select("id, description, provider, supplier_name, installment_count, liability_account_id")
          .in("id", planIds);
        if (error) throw error;
        plans = data ?? [];
      }
      const planById = new Map(plans.map((p) => [p.id, p]));

      // 3. Ledger movements for the posted batches
      const batchIds = payments.map((p) => p.batch_id).filter(Boolean);
      let txns: any[] = [];
      if (batchIds.length) {
        const { data, error } = await db
          .from("account_transactions")
          .select("*")
          .eq("tenant_id", tenantId)
          .in("batch_id", batchIds);
        if (error) throw error;
        txns = data ?? [];
      }

      // 3b. Partner capital accounts -> their equity account in the chart of accounts
      const capitalIds = Array.from(
        new Set(payments.map((p) => p.capital_account_id).filter(Boolean)),
      );
      let capitalAccounts: any[] = [];
      if (capitalIds.length) {
        const { data, error } = await db
          .from("owner_capital_accounts")
          .select("id, partner_name, equity_account_id")
          .in("id", capitalIds);
        if (error) throw error;
        capitalAccounts = data ?? [];
      }
      const equityByCapitalId = new Map<string, string>(
        capitalAccounts.map((c) => [c.id, c.equity_account_id]),
      );
      // Partner capital record ids are NOT chart-of-accounts ids — the guard in
      // buildInstallmentReconRows uses this to block bad comparisons.
      const capitalRecordIds = new Set<string>([
        ...capitalIds.map(String),
        ...capitalAccounts.map((c) => String(c.id)),
      ]);

      // 4. Account metadata
      const accountIds = Array.from(
        new Set([
          ...txns.map((t) => t.account_id),
          ...payments.map((p) => p.payment_account_id).filter(Boolean),
          ...capitalAccounts.map((c) => c.equity_account_id).filter(Boolean),
        ]),
      );
      let accounts: any[] = [];
      if (accountIds.length) {
        const { data, error } = await db
          .from("chart_of_accounts")
          .select("id, account_code, account_name, account_type")
          .in("id", accountIds);
        if (error) throw error;
        accounts = data ?? [];
      }
      const accById = new Map(accounts.map((a) => [a.id, a]));

      const txnsByBatch = new Map<string, any[]>();
      for (const t of txns) {
        if (!t.batch_id) continue;
        const list = txnsByBatch.get(t.batch_id) ?? [];
        list.push(t);
        txnsByBatch.set(t.batch_id, list);
      }

      const todayStr = new Date().toISOString().slice(0, 10);

      const rows = buildInstallmentReconRows({
        payments,
        planById,
        txnsByBatch,
        accById: accById as Map<string, ReconAccount>,
        equityByCapitalId,
        capitalRecordIds,
        today: todayStr,
      });

      return { rows, totals: computeReconTotals(rows) };
    },
  });
}
