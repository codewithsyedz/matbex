import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

/**
 * Per-branch visibility for Chart of Accounts.
 *
 * Semantics (opt-in restriction):
 *   - 0 rows for an account => visible to ALL branches (default, back-compatible).
 *   - 1+ rows                => visible ONLY to the listed branches.
 *   - branch_id = null/"all" => always visible (consolidated view).
 */
export interface AccountBranchVisibilityRow {
  account_id: string;
  branch_id: string;
  tenant_id: string;
}

export function useAllAccountBranchVisibility() {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;

  return useQuery({
    queryKey: ["account-branch-visibility", tenantId],
    queryFn: async () => {
      if (!tenantId) return [] as AccountBranchVisibilityRow[];
      const { data, error } = await (db as any)
        .from("account_branch_visibility")
        .select("account_id, branch_id, tenant_id")
        .eq("tenant_id", tenantId);
      if (error) throw error;
      return (data || []) as AccountBranchVisibilityRow[];
    },
    enabled: !!tenantId,
    staleTime: 60_000,
  });
}

/**
 * Convenience: build a map { accountId -> Set<branchId> | null }.
 * `null` means "no restriction" (visible everywhere).
 */
export function buildVisibilityIndex(
  rows: AccountBranchVisibilityRow[]
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!map.has(r.account_id)) map.set(r.account_id, new Set());
    map.get(r.account_id)!.add(r.branch_id);
  }
  return map;
}

/**
 * Returns true if account is visible for the given branch (or "all").
 */
export function isAccountVisible(
  visibility: Map<string, Set<string>>,
  accountId: string,
  branchId: string | null,
): boolean {
  if (!branchId) return true; // "All branches" view shows everything
  const set = visibility.get(accountId);
  if (!set || set.size === 0) return true; // no restriction
  return set.has(branchId);
}

export function useAccountBranchVisibility(accountId: string | null) {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const tenantId = profile?.tenant_id;

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["account-branch-visibility", "single", accountId],
    queryFn: async () => {
      if (!accountId) return [] as AccountBranchVisibilityRow[];
      const { data, error } = await (db as any)
        .from("account_branch_visibility")
        .select("account_id, branch_id, tenant_id")
        .eq("account_id", accountId);
      if (error) throw error;
      return (data || []) as AccountBranchVisibilityRow[];
    },
    enabled: !!accountId,
  });

  const save = useMutation({
    mutationFn: async (branchIds: string[]) => {
      if (!accountId || !tenantId) throw new Error("Missing account or tenant");
      // Delete existing rows for this account, then insert the new set.
      const { error: delErr } = await (db as any)
        .from("account_branch_visibility")
        .delete()
        .eq("account_id", accountId);
      if (delErr) throw delErr;
      if (branchIds.length === 0) return; // empty = visible to all
      const payload = branchIds.map((bid) => ({
        account_id: accountId,
        branch_id: bid,
        tenant_id: tenantId,
      }));
      const { error: insErr } = await (db as any)
        .from("account_branch_visibility")
        .insert(payload);
      if (insErr) throw insErr;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["account-branch-visibility"] });
      toast.success("Account visibility updated");
    },
    onError: (e: any) => {
      console.error(e);
      toast.error("Failed to update visibility: " + (e?.message ?? "unknown error"));
    },
  });

  return { rows, isLoading, save };
}