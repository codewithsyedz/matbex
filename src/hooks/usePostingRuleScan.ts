import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  summariseScan,
  scanAccountClassification,
  type ScanAccount,
  type ScanExpenseRow,
  type ScanLedgerLine,
  type ScanSummary,
} from "@/lib/postingRuleScan";

export interface PostingRuleScanOptions {
  /** ISO date; defaults to the last 24 months of activity. */
  fromDate?: string;
  branchId?: string | null;
}

const PAGE = 1000;

/** Paginate past the 1000-row PostgREST cap so the scan covers everything. */
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < 50; page += 1) {
    const { data, error } = await build(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export function usePostingRuleScan(opts: PostingRuleScanOptions = {}) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  const fromDate =
    opts.fromDate ??
    new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const branchId = opts.branchId ?? null;

  return useQuery<ScanSummary & { accountIssues: ReturnType<typeof scanAccountClassification> }>({
    queryKey: ["posting-rule-scan", tenantId, fromDate, branchId],
    enabled: !!tenantId,
    staleTime: 60_000,
    queryFn: async () => {
      const accounts = (await fetchAll<ScanAccount>((from, to) =>
        db
          .from("chart_of_accounts")
          .select("id, account_code, account_name, account_type, is_fixed_asset_account")
          .eq("tenant_id", tenantId!)
          .range(from, to),
      )) as ScanAccount[];

      const expenses = (await fetchAll<ScanExpenseRow>((from, to) => {
        let q = db
          .from("expenses")
          .select("id, expense_date, description, amount, account_id, project_id, status, branch_id")
          .eq("tenant_id", tenantId!)
          .is("deleted_at", null)
          .gte("expense_date", fromDate)
          .range(from, to);
        if (branchId) q = q.eq("branch_id", branchId);
        return q;
      })) as ScanExpenseRow[];

      const lines = (await fetchAll<ScanLedgerLine>((from, to) => {
        let q = db
          .from("account_transactions")
          .select(
            "id, batch_id, transaction_date, account_id, debit, credit, description, is_voided, project_id",
          )
          .eq("tenant_id", tenantId!)
          .eq("is_voided", false)
          .gte("transaction_date", fromDate)
          .range(from, to);
        if (branchId) q = q.eq("branch_id", branchId);
        return q;
      })) as ScanLedgerLine[];

      return {
        ...summariseScan(expenses, lines, accounts),
        accountIssues: scanAccountClassification(accounts),
      };
    },
  });
}
