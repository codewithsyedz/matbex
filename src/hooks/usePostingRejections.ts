import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import type { RuleViolation } from "@/lib/accountPostingRules";
import {
  buildRejectionRecord,
  type PostingRejectionRow,
  type RejectionContext,
} from "@/lib/postingRejectionLog";

const TABLE = "posting_rule_rejections";

/**
 * Returns a fire-and-forget recorder for blocked saves. Logging must never
 * break the user's flow, so failures are swallowed after a console warning.
 */
export function useRecordPostingRejection() {
  const { profile, user } = useAuth();
  const { activeBranchId, pinnedBranchId } = useBranch();
  const queryClient = useQueryClient();

  return useCallback(
    (violation: RuleViolation, ctx: Omit<RejectionContext, "tenantId" | "userId"> & {
      tenantId?: string | null;
      branchId?: string | null;
    }) => {
      const record = buildRejectionRecord(violation, {
        ...ctx,
        tenantId: ctx.tenantId ?? profile?.tenant_id ?? null,
        userId: user?.id ?? null,
        branchId: ctx.branchId ?? pinnedBranchId ?? activeBranchId ?? null,
        route: ctx.route ?? (typeof window !== "undefined" ? window.location.pathname : null),
      });
      if (!record) return;
      void (db as any)
        .from(TABLE)
        .insert(record)
        .then(({ error }: { error: unknown }) => {
          if (error) console.warn("Could not record posting rejection", error);
          else queryClient.invalidateQueries({ queryKey: ["posting-rejections"] });
        });
    },
    [profile?.tenant_id, user?.id, activeBranchId, pinnedBranchId, queryClient],
  );
}

export interface PostingRejectionFilters {
  days?: number;
  branchId?: string | null;
}

export function usePostingRejections(filters: PostingRejectionFilters = {}) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  const days = filters.days ?? 90;

  return useQuery({
    queryKey: ["posting-rejections", tenantId, days, filters.branchId ?? "all"],
    enabled: !!tenantId,
    staleTime: 60_000,
    queryFn: async (): Promise<PostingRejectionRow[]> => {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      let query = (db as any)
        .from(TABLE)
        .select("*")
        .eq("tenant_id", tenantId)
        .gte("occurred_at", since)
        .order("occurred_at", { ascending: false })
        .limit(1000);
      if (filters.branchId) query = query.eq("branch_id", filters.branchId);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as PostingRejectionRow[];
    },
  });
}
