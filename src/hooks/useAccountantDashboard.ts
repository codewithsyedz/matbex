import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { isInputVatAccount } from "@/lib/vatRecoverableReconciliation";
import type { AccountantExpense } from "@/lib/accountantDashboard";

export function useAccountantDashboard(branch: string | null, from: string, to: string) {
  const { restaurant, profile } = useAuth();
  const restaurantId = restaurant?.id;
  const tenantId = profile?.tenant_id;
  return useQuery({
    queryKey: ["accountant-dashboard", tenantId, restaurantId, branch, from, to],
    enabled: !!restaurantId && !!tenantId && !!from && !!to,
    staleTime: 120_000, refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!restaurantId || !tenantId) throw new Error("No restaurant selected");
      const loadExpenses = async () => {
        const rows: AccountantExpense[] = [];
        for (let offset = 0; ; offset += 1000) {
          let q = supabase.from("expenses").select("id,amount,paid_amount,vat_amount,expense_date,description,branch_id,ledger_posted,approval_status,vat_split_status,account_id,deleted_at")
            .eq("restaurant_id", restaurantId).eq("tenant_id", tenantId).is("deleted_at", null).order("id").range(offset, offset + 999);
          if (branch) q = q.eq("branch_id", branch);
          const { data, error } = await q;
          if (error) throw error;
          rows.push(...(data || []) as AccountantExpense[]);
          if (!data || data.length < 1000) return rows;
        }
      };
      const loadInventory = async () => {
        const rows: { id: string; name: string; current_stock: number; unit_cost: number; reorder_level: number | null; branch_id: string | null }[] = [];
        for (let offset = 0; ; offset += 1000) {
          let q = supabase.from("inventory_items").select("id,name,current_stock,unit_cost,reorder_level,branch_id").eq("restaurant_id", restaurantId).eq("is_active", true).order("id").range(offset, offset + 999);
          if (branch) q = q.eq("branch_id", branch);
          const { data, error } = await q;
          if (error) throw error;
          rows.push(...data || []);
          if (!data || data.length < 1000) return rows;
        }
      };
      const loadVat = async () => {
        const { data: accounts, error } = await supabase.from("chart_of_accounts").select("id,account_code,account_name").eq("tenant_id", tenantId);
        if (error) throw error;
        const ids = (accounts || []).filter(a => isInputVatAccount(a.account_code, a.account_name)).map(a => a.id);
        if (!ids.length) return 0;
        let total = 0;
        for (let offset = 0; ; offset += 1000) {
          let q = supabase.from("account_transactions").select("id,debit,credit").eq("tenant_id", tenantId).in("account_id", ids).eq("is_voided", false).gte("transaction_date", from).lte("transaction_date", to).order("id").range(offset, offset + 999);
          if (branch) q = q.eq("branch_id", branch);
          else {
            const { data: branches, error: branchError } = await supabase.from("branches").select("id").eq("restaurant_id", restaurantId);
            if (branchError) throw branchError;
            q = q.or(`branch_id.is.null,branch_id.in.(${(branches || []).map(b => b.id).join(",")})`);
          }
          const { data, error: lineError } = await q;
          if (lineError) throw lineError;
          total += (data || []).reduce((s, r) => s + Number(r.debit || 0) - Number(r.credit || 0), 0);
          if (!data || data.length < 1000) return total;
        }
      };
      const [expenses, inventory, postedInputVat] = await Promise.all([loadExpenses(), loadInventory(), loadVat()]);
      return { expenses, inventory, postedInputVat };
    },
  });
}