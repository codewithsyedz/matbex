import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { getTerminalId } from "@/lib/offline/terminal";

export type ResolutionSource = "user" | "terminal" | "primary" | "none";

export interface BranchResolutionDebug {
  terminalId: string;
  terminalName: string | null;
  paired: boolean;
  staffBranch: string | null;
  terminalBranch: string | null;
  primaryBranch: string | null;
  resolved: string | null;
  source: ResolutionSource;
  names: Map<string, string>;
  lastFetch: {
    at: string;
    requestId: string | null;
    status: number;
    cashierId: string | null;
    branchId: string | null;
    branchName: string | null;
    branchSource: ResolutionSource | null;
    vatRate: number | null;
  } | null;
}

/**
 * Fetches the terminal branch resolution chain for the current device:
 * staff.assigned_branch_id → terminal pin → primary branch fallback.
 */
export function useBranchResolution() {
  const { restaurant } = useAuth();

  return useQuery<BranchResolutionDebug>({
    queryKey: ["branch-resolution-debug", restaurant?.id],
    enabled: !!restaurant?.id,
    staleTime: 0,
    queryFn: async () => {
      const terminalId = await getTerminalId();
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id ?? null;

      const [historyRes, staffRes, terminalRes, primaryRes, branchesRes] = await Promise.all([
        supabase
          .from("pos_terminal_audit")
          .select("id, request_id, endpoint, status_code, created_at, response_snapshot, cashier_id")
          .eq("terminal_id", terminalId)
          .ilike("endpoint", "%menu%")
          .order("created_at", { ascending: false })
          .limit(1),
        userId
          ? supabase
              .from("staff")
              .select("assigned_branch_id, is_active")
              .eq("user_id", userId)
              .eq("restaurant_id", restaurant!.id)
              .eq("is_active", true)
              .not("assigned_branch_id", "is", null)
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null } as any),
        supabase
          .from("pos_terminals")
          .select("id, name, branch_id")
          .eq("id", terminalId)
          .maybeSingle(),
        supabase
          .from("branches")
          .select("id, name")
          .eq("restaurant_id", restaurant!.id)
          .eq("is_active", true)
          .eq("is_primary", true)
          .is("deleted_at", null)
          .limit(1)
          .maybeSingle(),
        supabase.from("branches").select("id, name").eq("restaurant_id", restaurant!.id),
      ]);

      const names = new Map<string, string>(
        (branchesRes.data ?? []).map((b: any) => [b.id as string, b.name as string]),
      );
      const staffBranch = (staffRes.data as any)?.assigned_branch_id ?? null;
      const terminalBranch = (terminalRes.data as any)?.branch_id ?? null;
      const primaryBranch = (primaryRes.data as any)?.id ?? null;

      const resolved = staffBranch ?? terminalBranch ?? primaryBranch ?? null;
      const source: ResolutionSource = staffBranch
        ? "user"
        : terminalBranch
          ? "terminal"
          : primaryBranch
            ? "primary"
            : "none";

      const row = (historyRes.data ?? [])[0] as any;
      const s = row?.response_snapshot ?? null;
      const lastFetch = row
        ? {
            at: row.created_at as string,
            requestId: (row.request_id ?? row.id ?? null) as string | null,
            status: row.status_code as number,
            cashierId: (row.cashier_id ?? null) as string | null,
            branchId: (s?.branch_id ?? null) as string | null,
            branchName: (s?.branch_name ?? null) as string | null,
            branchSource: (s?.branch_source ?? null) as ResolutionSource | null,
            vatRate: s?.vat_rate ?? null,
          }
        : null;

      return {
        terminalId,
        terminalName: (terminalRes.data as any)?.name ?? null,
        paired: !!terminalRes.data,
        staffBranch,
        terminalBranch,
        primaryBranch,
        resolved,
        source,
        names,
        lastFetch,
      };
    },
  });
}
