import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

export interface TerminalRefreshArgs {
  /** Limit the refresh to one branch. Omit to refresh every branch. */
  branchId?: string | null;
  /** Optional terminal for the audit trail (all terminals on the branch refresh). */
  terminalUid?: string | null;
  /** Human label used in the success toast. */
  label?: string;
}

/**
 * One-click "refresh terminal state".
 *
 * Bumps the server-side menu/price version for the target branch(es). Terminals
 * poll `/menu/version` on their heartbeat and refetch `/menu` whenever the
 * version changes, so this clears any stale menu, price, VAT-rate or branch
 * cache on the device without closing and reopening a shift — and without an
 * Android app update (the Terminal API contract is unchanged).
 */
export function useTerminalStateRefresh() {
  const { restaurant } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ branchId = null, terminalUid = null }: TerminalRefreshArgs = {}) => {
      if (!restaurant?.id) throw new Error("No active restaurant");
      const { data, error } = await (supabase.rpc as any)("request_terminal_state_refresh", {
        _restaurant_id: restaurant.id,
        _branch_id: branchId,
        _terminal_uid: terminalUid,
      });
      if (error) throw error;
      return (data ?? []) as Array<{ branch_id: string; menu_version: number }>;
    },
    onSuccess: (rows, vars) => {
      const scope = vars?.label ?? (vars?.branchId ? "branch" : "all branches");
      toast.success(`Terminal state refresh queued — ${scope}`, {
        description:
          rows.length === 1
            ? `Menu version is now v${rows[0].menu_version}. Terminals reload on their next check-in (within ~1 min).`
            : `${rows.length} branch versions bumped. Terminals reload on their next check-in (within ~1 min).`,
      });
      queryClient.invalidateQueries({ queryKey: ["terminal-branch-settings", restaurant?.id] });
      queryClient.invalidateQueries({ queryKey: ["terminal-sync-health", restaurant?.id] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not refresh terminal state"),
  });
}
