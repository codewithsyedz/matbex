import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { parseCoaError } from "@/lib/coaValidation";

export interface COGSAccount {
  id: string;
  account_code: string;
  account_name: string;
  account_type: 'cogs';
  is_active: boolean;
}

export interface PendingCOGSEntry {
  id: string;
  type: 'usage' | 'purchase';
  item_name: string;
  amount: number;
  date: string;
  ledger_posted: boolean;
  cogs_account_id: string | null;
}

export function useCOGSPosting() {
  const { profile, restaurant } = useAuth();
  const queryClient = useQueryClient();
  const tenantId = profile?.tenant_id;

  // Fetch COGS accounts only (5000-5999 range)
  const { data: cogsAccounts = [], isLoading: accountsLoading } = useQuery({
    queryKey: ['cogs-accounts', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];

      const { data, error } = await supabase
        .from('chart_of_accounts')
        .select('id, account_code, account_name, account_type, is_active')
        .eq('tenant_id', tenantId)
        .eq('account_type', 'cogs')
        .eq('is_active', true)
        .order('account_code');

      if (error) throw error;
      return data as COGSAccount[];
    },
    enabled: !!tenantId,
  });

  // Fetch unposted inventory usage entries
  const { data: unpostedUsage = [], isLoading: usageLoading } = useQuery({
    queryKey: ['unposted-cogs-usage', restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];

      const { data, error } = await supabase
        .from('inventory_usage')
        .select(`
          id,
          total_cost,
          usage_date,
          ledger_posted,
          cogs_account_id,
          inventory_items(name)
        `)
        .eq('restaurant_id', restaurant.id)
        .eq('ledger_posted', false)
        .order('usage_date', { ascending: false });

      if (error) throw error;
      
      return (data || []).map(u => ({
        id: u.id,
        type: 'usage' as const,
        item_name: (u.inventory_items as any)?.name || 'Unknown Item',
        amount: Number(u.total_cost),
        date: u.usage_date,
        ledger_posted: u.ledger_posted,
        cogs_account_id: u.cogs_account_id,
      }));
    },
    enabled: !!restaurant?.id,
  });

  // Fetch unposted COGS purchases
  const { data: unpostedPurchases = [], isLoading: purchasesLoading } = useQuery({
    queryKey: ['unposted-cogs-purchases', restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];

      const { data, error } = await supabase
        .from('cogs_purchases')
        .select(`
          id,
          amount,
          item_type,
          supplier_name,
          ledger_posted,
          cogs_account_id,
          daily_cogs_submissions!inner(restaurant_id, submission_date)
        `)
        .eq('daily_cogs_submissions.restaurant_id', restaurant.id)
        .eq('ledger_posted', false)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      return (data || []).map(p => ({
        id: p.id,
        type: 'purchase' as const,
        item_name: p.item_type + (p.supplier_name ? ` (${p.supplier_name})` : ''),
        amount: Number(p.amount),
        date: (p.daily_cogs_submissions as any)?.submission_date || new Date().toISOString().split('T')[0],
        ledger_posted: p.ledger_posted,
        cogs_account_id: p.cogs_account_id,
      }));
    },
    enabled: !!restaurant?.id,
  });

  // Post usage to COGS ledger
  const postUsageToCOGS = useMutation({
    mutationFn: async ({ usageId, cogsAccountId }: { usageId: string; cogsAccountId: string }) => {
      const { data, error } = await supabase.rpc('post_inventory_usage_to_cogs', {
        p_usage_id: usageId,
        p_cogs_account_id: cogsAccountId,
      });
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unposted-cogs-usage'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['account-transactions'] });
      toast.success('Inventory usage posted to COGS');
    },
    onError: (error: Error) => {
      const parsed = parseCoaError(error);
      toast.error(parsed.message);
    },
  });

  // Post purchase to COGS ledger
  const postPurchaseToCOGS = useMutation({
    mutationFn: async ({ purchaseId, cogsAccountId }: { purchaseId: string; cogsAccountId: string }) => {
      const { data, error } = await supabase.rpc('post_purchase_to_cogs', {
        p_purchase_id: purchaseId,
        p_cogs_account_id: cogsAccountId,
      });
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unposted-cogs-purchases'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['account-transactions'] });
      toast.success('Purchase posted to COGS');
    },
    onError: (error: Error) => {
      const parsed = parseCoaError(error);
      toast.error(parsed.message);
    },
  });

  // Bulk post multiple entries
  const bulkPostToCOGS = useMutation({
    mutationFn: async ({ 
      entries, 
      cogsAccountId 
    }: { 
      entries: PendingCOGSEntry[]; 
      cogsAccountId: string;
    }) => {
      const results = [];
      
      for (const entry of entries) {
        if (entry.type === 'usage') {
          const { data, error } = await supabase.rpc('post_inventory_usage_to_cogs', {
            p_usage_id: entry.id,
            p_cogs_account_id: cogsAccountId,
          });
          if (error) throw error;
          results.push(data);
        } else {
          const { data, error } = await supabase.rpc('post_purchase_to_cogs', {
            p_purchase_id: entry.id,
            p_cogs_account_id: cogsAccountId,
          });
          if (error) throw error;
          results.push(data);
        }
      }
      
      return results;
    },
    onSuccess: (_, { entries }) => {
      queryClient.invalidateQueries({ queryKey: ['unposted-cogs-usage'] });
      queryClient.invalidateQueries({ queryKey: ['unposted-cogs-purchases'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['account-transactions'] });
      toast.success(`${entries.length} entries posted to COGS`);
    },
    onError: (error: Error) => {
      const parsed = parseCoaError(error);
      toast.error(parsed.message);
    },
  });

  const allUnpostedEntries = [...unpostedUsage, ...unpostedPurchases];
  const totalUnpostedAmount = allUnpostedEntries.reduce((sum, e) => sum + e.amount, 0);

  return {
    cogsAccounts,
    unpostedUsage,
    unpostedPurchases,
    allUnpostedEntries,
    totalUnpostedAmount,
    isLoading: accountsLoading || usageLoading || purchasesLoading,
    postUsageToCOGS,
    postPurchaseToCOGS,
    bulkPostToCOGS,
  };
}
