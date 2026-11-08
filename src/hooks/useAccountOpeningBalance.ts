import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Opening balance for a single account: every non-voided posting strictly
 * before `beforeDate` (YYYY-MM-DD), optionally scoped to a branch.
 * Returns raw debit/credit sums; callers apply the account's normal side.
 */
export function useAccountOpeningBalance(
  accountId: string | null,
  beforeDate: string | null,
  branchId: string | null,
) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;

  const query = useQuery({
    queryKey: ["account-opening-balance", tenantId, accountId, beforeDate, branchId],
    enabled: !!tenantId && !!accountId && !!beforeDate,
    staleTime: 1000 * 60 * 2,
    queryFn: async () => {
      const pageSize = 1000;
      let page = 0;
      let debit = 0;
      let credit = 0;
      while (true) {
        let q = supabase
          .from("account_transactions")
          .select("debit, credit")
          .eq("tenant_id", tenantId!)
          .eq("account_id", accountId!)
          .eq("is_voided", false)
          .lt("transaction_date", beforeDate!);
        if (branchId) q = q.eq("branch_id", branchId);
        const { data, error } = await q.range(page * pageSize, page * pageSize + pageSize - 1);
        if (error) throw error;
        const batch = data ?? [];
        for (const row of batch) {
          debit += Number(row.debit ?? 0);
          credit += Number(row.credit ?? 0);
        }
        if (batch.length < pageSize) break;
        page += 1;
        if (page > 50) break;
      }
      return { debit, credit };
    },
  });

  return {
    openingDebit: query.data?.debit ?? 0,
    openingCredit: query.data?.credit ?? 0,
    isLoading: query.isLoading,
  };
}
