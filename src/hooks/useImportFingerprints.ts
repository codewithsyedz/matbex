import { useQuery, useQueryClient } from "@tanstack/react-query";

import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  buildFingerprintRecords,
  type FingerprintInput,
  type ImportScope,
  type KnownFingerprint,
} from "@/lib/importFingerprint";

/**
 * Loads the fingerprints of everything already imported for a scope and
 * records new ones after a successful import. The database also enforces
 * uniqueness on (tenant, scope, hash), so a race between two tabs still cannot
 * double-import the same source row.
 */
export function useImportFingerprints(scope: ImportScope, scopeRef?: string | null) {
  const { profile, user } = useAuth();
  const tenantId = profile?.tenant_id;
  const queryClient = useQueryClient();
  const queryKey = ["import-fingerprints", tenantId, scope, scopeRef ?? "all"];

  const { data: known = [], isLoading } = useQuery({
    queryKey,
    queryFn: async (): Promise<KnownFingerprint[]> => {
      if (!tenantId) return [];
      let q = db
        .from("import_row_fingerprints")
        .select("row_hash, source_file, source_sheet, source_row_number, created_at, target_id")
        .eq("tenant_id", tenantId)
        .eq("scope", scope);
      if (scopeRef) q = q.eq("scope_ref", scopeRef);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as KnownFingerprint[];
    },
    enabled: !!tenantId,
    staleTime: 0,
  });

  const recordImported = async (params: {
    sourceFile?: string | null;
    sourceSheet?: string | null;
    targetTable?: string | null;
    rows: { row: FingerprintInput; sourceRowNumber?: number | null; targetId?: string | null }[];
  }) => {
    if (!tenantId || params.rows.length === 0) return;
    const records = buildFingerprintRecords({
      tenantId,
      scope,
      scopeRef: scopeRef ?? null,
      userId: user?.id ?? null,
      ...params,
    });
    // ignoreDuplicates: the unique index is the real guard; a clash simply means
    // another session already claimed that source row.
    const { error } = await db
      .from("import_row_fingerprints")
      .upsert(records as unknown as never[], {
        onConflict: "tenant_id,scope,row_hash",
        ignoreDuplicates: true,
      });
    if (error) console.error("Failed to record import fingerprints", error);
    await queryClient.invalidateQueries({ queryKey });
  };

  return { known, isLoading, recordImported };
}
