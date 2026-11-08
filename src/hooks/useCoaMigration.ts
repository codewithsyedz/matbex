import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { buildMigrationPlan, type MigrationRow } from "@/lib/coaMigrationPlan";

export interface ApplyResult {
  updated: number;
  created: number;
  failed: { label: string; message: string }[];
}

export function useCoaMigration() {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  const queryClient = useQueryClient();
  const { accounts, isLoading } = useChartOfAccounts();

  const plan = useMemo(() => buildMigrationPlan(accounts), [accounts]);

  const applyMigration = useMutation({
    mutationFn: async (rows: MigrationRow[]): Promise<ApplyResult> => {
      if (!tenantId) throw new Error("No tenant");
      const result: ApplyResult = { updated: 0, created: 0, failed: [] };

      // Re-codes first so freed codes are available for later rows.
      const ordered = [...rows].sort((a, b) => {
        const rank = (r: MigrationRow) => (r.action === "create" ? 1 : 0);
        return rank(a) - rank(b);
      });

      for (const row of ordered) {
        if (row.conflict) continue;
        const label = row.target ? `${row.target.code} ${row.target.name}` : row.existing?.account_name ?? "account";
        try {
          if (row.action === "create" && row.target) {
            const { error } = await supabase.from("chart_of_accounts").insert({
              tenant_id: tenantId,
              account_code: row.target.code,
              account_name: row.target.name,
              account_type: row.target.type,
              description: row.target.description ?? null,
              is_active: true,
            });
            if (error) throw error;
            result.created += 1;
          } else if (row.existing && row.changes.length > 0) {
            const patch: Record<string, string> = {};
            row.changes.forEach((c) => { patch[c.field] = c.to; });
            const { error } = await supabase
              .from("chart_of_accounts")
              .update(patch)
              .eq("id", row.existing.id)
              .eq("tenant_id", tenantId);
            if (error) throw error;
            result.updated += 1;
          }
        } catch (e) {
          result.failed.push({ label, message: e instanceof Error ? e.message : String(e) });
        }
      }

      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["chart-of-accounts", tenantId] });
      if (result.failed.length === 0) {
        toast.success(`Migration applied: ${result.updated} updated, ${result.created} created`);
      } else {
        toast.warning(
          `Applied with issues: ${result.updated} updated, ${result.created} created, ${result.failed.length} failed`,
        );
      }
    },
    onError: (e: Error) => toast.error(`Migration failed: ${e.message}`),
  });

  return { accounts, isLoading, plan, applyMigration };
}
