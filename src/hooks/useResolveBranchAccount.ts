import { useCallback } from "react";
import { db } from "@/integrations/db/client";
import { useBranch } from "@/contexts/BranchContext";

/**
 * Resolves the correct accounting account to post to for the active branch.
 * If a child sub-account named for the active branch exists under `parentAccountId`,
 * its id is returned. Otherwise the parent id is returned unchanged.
 *
 * Falls back to the parent id on any error so postings never fail because of
 * the resolver itself.
 */
export function useResolveBranchAccount() {
  const { activeBranchId, pinnedBranchId } = useBranch();
  const branchId = pinnedBranchId ?? activeBranchId ?? null;

  const resolve = useCallback(
    async (
      parentAccountId: string | null | undefined,
      overrideBranchId?: string | null,
    ): Promise<string | null> => {
      if (!parentAccountId) return null;
      const target = overrideBranchId ?? branchId;
      if (!target || target === "all") return parentAccountId;
      try {
        const { data, error } = await db.rpc("resolve_branch_account", {
          _parent_account_id: parentAccountId,
          _branch_id: target,
        });
        if (error || !data) return parentAccountId;
        return data as unknown as string;
      } catch {
        return parentAccountId;
      }
    },
    [branchId],
  );

  return { resolve, branchId };
}
