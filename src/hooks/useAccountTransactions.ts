import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";

function emptyMeta(): AccountTransactionsMeta {
  return {
    loadedCount: 0,
    earliestLoadedAt: null,
    latestLoadedAt: null,
    hasMore: false,
  };
}

function minDate(dates: string[]): string {
  return dates.reduce((a, b) => (a <= b ? a : b));
}

function maxDate(dates: string[]): string {
  return dates.reduce((a, b) => (a >= b ? a : b));
}

export interface AccountTransaction {
  id: string;
  tenant_id: string;
  account_id: string;
  branch_id: string | null;
  transaction_date: string;
  debit: number | null;
  credit: number | null;
  description: string | null;
  reference_type: string | null;
  reference_id: string | null;
  created_by: string | null;
  created_at: string;
  // Soft-delete fields
  is_voided: boolean | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  original_transaction_id: string | null;
  batch_id: string | null;
  // Joined batch info (used to detect immutable AP settlement entries)
  batch?: {
    id: string;
    reference_number: string | null;
    entry_type: string | null;
  } | null;
  // Joined account info
  account?: {
    account_code: string;
    account_name: string;
    account_type: string;
  };
  branch?: {
    id: string;
    name: string;
    code: string | null;
  } | null;
}

export interface AccountTransactionsMeta {
  loadedCount: number;
  earliestLoadedAt: string | null;
  latestLoadedAt: string | null;
  hasMore: boolean;
}

export function useAccountTransactions(accountId?: string) {
  const { profile } = useAuth();
  const { activeBranchId, pinnedBranchId } = useBranch();
  const branchKey =
    pinnedBranchId ??
    (activeBranchId && activeBranchId !== "all" ? activeBranchId : null);
  const tenantId = profile?.tenant_id;

  // Fetch transactions for a specific account or all
  const { data, isLoading, error } = useQuery({
    queryKey: ['account-transactions', tenantId, accountId, branchKey],
    queryFn: async () => {
      if (!tenantId) return { transactions: [], meta: emptyMeta() };

      // Paginate so older postings aren't silently cut off by a single-page
      // row cap (that hid early-month rows and rolled them into "opening balance").
      const pageSize = 1000;
      const maxPages = 6;
      const rows: AccountTransaction[] = [];
      for (let page = 0; page < maxPages; page++) {
        let query = db
          .from('account_transactions')
          .select(`
            *,
            account:chart_of_accounts(account_code, account_name, account_type),
            branch:branches!account_transactions_branch_id_fkey(id, name, code),
            batch:journal_entry_batches(id, reference_number, entry_type)
          `)
          .eq('tenant_id', tenantId)
          .order('transaction_date', { ascending: false })
          .order('created_at', { ascending: false });

        if (accountId) {
          query = query.eq('account_id', accountId);
        }

        if (branchKey) {
          query = query.eq('branch_id', branchKey);
        }

        const { data, error } = await query.range(
          page * pageSize,
          page * pageSize + pageSize - 1,
        );
        if (error) throw error;
        const batch = (data ?? []) as AccountTransaction[];
        rows.push(...batch);
        if (batch.length < pageSize) break;
      }

      const transactions = rows as AccountTransaction[];
      const dates = transactions.map((t) => t.transaction_date);
      const meta: AccountTransactionsMeta = {
        loadedCount: transactions.length,
        earliestLoadedAt: dates.length ? minDate(dates) : null,
        latestLoadedAt: dates.length ? maxDate(dates) : null,
        hasMore: transactions.length === pageSize * maxPages,
      };
      return { transactions, meta };
    },
    enabled: !!tenantId,
  });

  const transactions = data?.transactions ?? [];
  const meta = data?.meta ?? emptyMeta();

  // Ledger lines are written only by the server (posting functions and /api/v1/ledger);
  // manual journal entries go through useJournalEntries.
  return {
    transactions,
    meta,
    isLoading,
    error,
  };
}
