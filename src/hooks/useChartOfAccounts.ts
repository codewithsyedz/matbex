import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  useAllAccountBranchVisibility,
  buildVisibilityIndex,
  isAccountVisible,
} from "./useAccountBranchVisibility";

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'cogs' | 'expense';

export interface ChartOfAccount {
  id: string;
  tenant_id: string;
  account_code: string;
  account_name: string;
  account_type: AccountType;
  parent_id: string | null;
  description: string | null;
  is_system_account: boolean;
  is_active: boolean;
  balance: number;
  created_at: string;
  updated_at: string;
  has_transactions?: boolean;
  /** Posting to this account is blocked unless a branch or project is set. */
  requires_cost_center?: boolean;
  /** Spend on this account is capitalised into the fixed asset register. */
  is_fixed_asset_account?: boolean;
  /** Input/output VAT should normally be split out for this account. */
  vat_applicable?: boolean;
  /** Plain-English guidance shown in the account picker. */
  help_text?: string | null;
}

export interface CreateAccountData {
  account_code: string;
  account_name: string;
  account_type: AccountType;
  parent_id?: string | null;
  description?: string;
  is_system_account?: boolean;
}

export interface UpdateAccountData {
  id: string;
  account_name?: string;
  description?: string;
  is_active?: boolean;
}

// Account code ranges by type
export const ACCOUNT_CODE_RANGES: Record<AccountType, { min: string; max: string; label: string }> = {
  asset: { min: '1000', max: '1999', label: 'Assets (1000-1999)' },
  liability: { min: '2000', max: '2999', label: 'Liabilities (2000-2999)' },
  equity: { min: '3000', max: '3999', label: 'Equity (3000-3999)' },
  revenue: { min: '4000', max: '4999', label: 'Revenue (4000-4999)' },
  cogs: { min: '5000', max: '5999', label: 'COGS (5000-5999)' },
  expense: { min: '6000', max: '6999', label: 'Expenses (6000-6999)' },
};

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  asset: 'Asset',
  liability: 'Liability',
  equity: 'Equity',
  revenue: 'Revenue',
  cogs: 'COGS',
  expense: 'Expense',
};

export function useChartOfAccounts() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const tenantId = profile?.tenant_id;
  const { data: visibilityRows = [] } = useAllAccountBranchVisibility();
  const visibilityIndex = buildVisibilityIndex(visibilityRows);

  const { data: accounts = [], isLoading, error } = useQuery({
    queryKey: ['chart-of-accounts', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];

      const { data, error } = await db
        .from('chart_of_accounts')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('account_code', { ascending: true });

      if (error) throw error;

      // Check for transactions for each account
      const accountsWithTransactions = await Promise.all(
        (data || []).map(async (account) => {
          const { count } = await db
            .from('account_transactions')
            .select('*', { count: 'exact', head: true })
            .eq('account_id', account.id);
          
          return {
            ...account,
            has_transactions: (count || 0) > 0,
          };
        })
      );

      return accountsWithTransactions as ChartOfAccount[];
    },
    enabled: !!tenantId,
  });

  const createAccount = useMutation({
    mutationFn: async (data: CreateAccountData) => {
      if (!tenantId) throw new Error('No tenant ID');

      const { data: result, error } = await db
        .from('chart_of_accounts')
        .insert({
          ...data,
          tenant_id: tenantId,
        })
        .select()
        .single();

      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts', tenantId] });
      toast.success('Account created successfully');
    },
    onError: (error: Error) => {
      console.error('Error creating account:', error);
      if (error.message.includes('valid_account_code_range')) {
        toast.error('Account code does not match the selected account type range');
      } else if (error.message.includes('unique_account_code_per_tenant')) {
        toast.error('An account with this code already exists');
      } else {
        toast.error('Failed to create account: ' + error.message);
      }
    },
  });

  const updateAccount = useMutation({
    mutationFn: async (data: UpdateAccountData) => {
      const { id, ...updateData } = data;

      const { data: result, error } = await db
        .from('chart_of_accounts')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts', tenantId] });
      toast.success('Account updated successfully');
    },
    onError: (error: Error) => {
      console.error('Error updating account:', error);
      toast.error('Failed to update account');
    },
  });

  const deleteAccount = useMutation({
    mutationFn: async (accountId: string) => {
      const { error } = await db
        .from('chart_of_accounts')
        .delete()
        .eq('id', accountId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts', tenantId] });
      toast.success('Account deleted successfully');
    },
    onError: (error: Error) => {
      console.error('Error deleting account:', error);
      if (error.message.includes('violates foreign key constraint')) {
        toast.error('Cannot delete account with existing transactions');
      } else {
        toast.error('Failed to delete account');
      }
    },
  });

  // Group accounts by type
  const accountsByType = accounts.reduce((acc, account) => {
    if (!acc[account.account_type]) {
      acc[account.account_type] = [];
    }
    acc[account.account_type].push(account);
    return acc;
  }, {} as Record<AccountType, ChartOfAccount[]>);

  /**
   * Per-account visibility helpers.
   *
   * - `visibleBranchIdsFor(accountId)`:
   *     `null` => no restriction (visible to all branches).
   *     `string[]` => the only branches that may see this account.
   * - `accountsForBranch(branchId)`: filter `accounts` to those visible for
   *   the given branch. `null`/"all" returns everything.
   * - `isVisibleForBranch(accountId, branchId)`: predicate used by report rows.
   */
  const visibleBranchIdsFor = (accountId: string): string[] | null => {
    const set = visibilityIndex.get(accountId);
    if (!set || set.size === 0) return null;
    return Array.from(set);
  };

  const isVisibleForBranch = (accountId: string, branchId: string | null) =>
    isAccountVisible(visibilityIndex, accountId, branchId);

  const accountsForBranch = (branchId: string | null) =>
    !branchId
      ? accounts
      : accounts.filter((a) => isVisibleForBranch(a.id, branchId));

  return {
    accounts,
    accountsByType,
    isLoading,
    error,
    createAccount,
    updateAccount,
    deleteAccount,
    visibilityIndex,
    visibleBranchIdsFor,
    isVisibleForBranch,
    accountsForBranch,
  };
}
