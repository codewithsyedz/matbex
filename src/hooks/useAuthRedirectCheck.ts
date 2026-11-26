import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";

export interface AuthRedirectCheckResult {
  ok: boolean;
  whatsapp_app_url: string;
  desired_redirect: string;
  effective_redirect: string | null;
  matches_desired: boolean;
  desired_allowed: boolean;
  effective_allowed: boolean;
  origin: string | null;
  origin_allowed: boolean | null;
  expected_allowlist: string[];
  generate_error: string | null;
  api_url: string;
}

/**
 * Validate that the Matbex auth redirectTo / domain allowlist is configured
 * correctly for the magic-links we embed in WhatsApp summaries.
 *
 * - `desired_allowed`: the URL we *intend* to use is in our expected allowlist.
 * - `effective_allowed`: the URL GoTrue actually accepted (after silent rewrite)
 *   is in our expected allowlist.
 * - `matches_desired`: GoTrue did not rewrite our redirect - the the API
 *   project allowlist contains our APP_URL.
 */
export function useAuthRedirectCheck(opts: { enabled?: boolean } = {}) {
  const { hasRole, session, loading } = useAuth();
  const isOwner = hasRole("owner");
  const accessToken = session?.access_token;

  return useQuery({
    queryKey: ["auth-redirect-check"],
    enabled: (opts.enabled ?? true) && !loading && isOwner && !!accessToken,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async (): Promise<AuthRedirectCheckResult> => {
      if (!accessToken) {
        throw new Error("No active session. Please sign in again.");
      }

      const { data, error } = await db.functions.invoke("validate-auth-redirects", {
        body: {},
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (error) throw error;
      return data as AuthRedirectCheckResult;
    },
  });
}

/** True when the redirect setup is safe enough to send live magic-links. */
export function isRedirectConfigHealthy(r?: AuthRedirectCheckResult | null): boolean {
  if (!r) return false;
  return r.ok && r.desired_allowed && r.matches_desired && r.effective_allowed;
}