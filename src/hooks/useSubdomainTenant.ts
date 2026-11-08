import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Parses the current hostname and, if it matches `{slug}.matbex.com` (or
 * `{slug}.matbex.lovable.app` for previews), resolves it against the
 * `resolve_subdomain` RPC.
 *
 * Returns:
 *   - { isSubdomain: false } when on the marketing/app host
 *   - { isSubdomain: true, tenantId, redirectTo? } when on a tenant subdomain
 *
 * `redirectTo` is set if the visitor hit an old subdomain that has a
 * recent 90-day redirect to a renamed one — the consumer should
 * `window.location.replace` to the new host.
 */
export function useSubdomainTenant() {
  const hostname = typeof window !== "undefined" ? window.location.hostname : "";
  const subdomain = extractTenantSubdomain(hostname);
  const customDomain = subdomain ? null : extractCustomDomain(hostname);

  const query = useQuery({
    queryKey: ["resolve-tenant-host", subdomain ?? customDomain],
    enabled: !!subdomain || !!customDomain,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (subdomain) {
        const { data, error } = await (supabase.rpc as any)("resolve_subdomain", {
          _subdomain: subdomain,
        });
        if (error) throw error;
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) return { notFound: true as const };
        return {
          tenantId: row.tenant_id as string,
          redirectTo: (row.redirect_to as string | null) ?? null,
          status: row.status as string,
        };
      }
      if (customDomain) {
        const { data, error } = await supabase
          .from("tenant_domains")
          .select("tenant_id, domain_status")
          .eq("custom_domain", customDomain)
          .eq("domain_status", "active")
          .maybeSingle();
        if (error) throw error;
        if (!data) return { notFound: true as const };
        return {
          tenantId: data.tenant_id as string,
          redirectTo: null as string | null,
          status: data.domain_status as string,
        };
      }
      return null;
    },
  });

  return {
    subdomain,
    customDomain,
    isSubdomain: !!subdomain,
    isCustomDomain: !!customDomain,
    isLoading: query.isLoading,
    tenantId: (query.data as any)?.tenantId as string | undefined,
    redirectTo: (query.data as any)?.redirectTo as string | null | undefined,
    notFound: (query.data as any)?.notFound === true,
  };
}

/** Reserved hosts that should never resolve as a tenant subdomain. */
const RESERVED_HOSTS = new Set([
  "www",
  "matbex",
  "app",
  "admin",
  "api",
  "preview",
  "id-preview",
  "lovable",
]);

/** App-owned hostnames that must never be treated as custom-domain tenants. */
const APP_HOSTS = new Set([
  "matbex.com",
  "www.matbex.com",
  "matbex.lovable.app",
  "localhost",
]);

/**
 * Returns the hostname if it looks like a tenant-owned custom domain (i.e. not
 * a matbex.* or matbex.lovable.app host, and not a local/preview host).
 */
export function extractCustomDomain(hostname: string): string | null {
  if (!hostname) return null;
  const host = hostname.toLowerCase();
  if (APP_HOSTS.has(host)) return null;
  if (host.endsWith(".matbex.com")) return null;
  if (host.endsWith(".matbex.lovable.app")) return null;
  if (host.endsWith(".lovable.app")) return null;
  if (host.endsWith(".lovableproject.com")) return null;
  if (host.endsWith(".lovable.dev")) return null;
  if (host === "localhost" || host.endsWith(".localhost")) return null;
  // IP addresses
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  return host;
}

/** Returns the tenant subdomain part of a hostname, or null if none. */
export function extractTenantSubdomain(hostname: string): string | null {
  if (!hostname) return null;
  const host = hostname.toLowerCase().replace(/^www\./, "");

  // Production: <slug>.matbex.com
  const prodMatch = host.match(/^([a-z0-9-]+)\.matbex\.com$/);
  if (prodMatch) {
    const slug = prodMatch[1];
    return RESERVED_HOSTS.has(slug) ? null : slug;
  }

  // Preview: <slug>.matbex.lovable.app
  const previewMatch = host.match(/^([a-z0-9-]+)\.matbex\.lovable\.app$/);
  if (previewMatch) {
    const slug = previewMatch[1];
    return RESERVED_HOSTS.has(slug) ? null : slug;
  }

  // Local dev / id-preview hosts → never a tenant
  return null;
}