import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";

export interface SessionSecurity {
  aal: "aal1" | "aal2";
  owner_mfa_required: boolean;
  is_superadmin_account: boolean;
  admin_ip_allowed: boolean;
  client_ip: string | null;
}

/** session_security_status(): this session's two-factor level and the rules that apply to it. */
export function useSessionSecurity() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["session-security", user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await db.rpc("session_security_status");
      if (error) throw error;
      return data as unknown as SessionSecurity;
    },
  });
}
