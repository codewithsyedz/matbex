/**
 * Global write-guard for role impersonation ("Test as…").
 *
 * Why this exists: `useImpersonationGuard` is opt-in per call site. An audit
 * found only 6 of ~178 mutation hooks remember to call it, so a guard you
 * have to remember is not a guard. This file installs a single fetch
 * interceptor that refuses mutating HTTP verbs to the API endpoints
 * whenever an owner is acting as another role — regardless of which code
 * path tries to mutate. The opt-in hook still exists for UX (disable
 * buttons, show toast); this file is the safety net behind it.
 *
 * Contract:
 *   - Reads from `isImpersonationActive()` (mirrored by AuthCore via
 *     `setImpersonationActive()` on every impersonation state change).
 *   - Blocks: POST / PATCH / PUT / DELETE to /rest/v1/*, every POST to
 *     /rest/v1/rpc/* (RPCs are writes by default), non-GET to
 *     /storage/v1/object/*, and every call to /functions/v1/* (edge
 *     functions usually mutate).
 *   - Always allows: any GET, and a small allowlist of impersonation-
 *     management endpoints so `stopRoleImpersonation()` and the heartbeat
 *     can still close their own session cleanly.
 *   - Blocked requests resolve with a synthetic
 *     `403 { code: "impersonation_readonly", ... }` Response so callers
 *     surface a friendly error path instead of throwing.
 *
 * This file installs the hook exactly once and is a no-op outside the
 * browser (so vitest / SSR don't trip it).
 */
import { reportClientError } from "./errorReporter";

let active = false;
let installed = false;

export function setImpersonationActive(value: boolean): void {
  active = value;
}

export function isImpersonationActive(): boolean {
  return active;
}

/** URL substrings that are always allowed even during impersonation, so the
 *  impersonation session can manage its own lifecycle (stop / heartbeat /
 *  server-side validation). */
const BYPASS_URL_FRAGMENTS = [
  "/rest/v1/role_impersonation_logs",
  "/rest/v1/rpc/heartbeat_impersonation",
  "/rest/v1/rpc/validate_active_impersonation",
  // The client-error sink itself must keep working so we can log the very
  // 403s this guard produces.
  "/rest/v1/client_errors",
];

function isApiMutationRequest(url: string, method: string): boolean {
  const upper = method.toUpperCase();
  if (upper === "GET" || upper === "HEAD" || upper === "OPTIONS") return false;

  // PostgREST table writes + RPCs (RPCs are POST in PostgREST).
  if (url.includes("/rest/v1/")) return true;
  // Storage uploads / deletes.
  if (url.includes("/storage/v1/object/")) return true;
  // Edge function invocations — most mutate, and we don't have per-function
  // metadata at this layer. Read-only edge functions should be rare; if a
  // legitimate one exists, surface it explicitly via the bypass list.
  if (url.includes("/functions/v1/")) return true;

  return false;
}

function isBypassed(url: string): boolean {
  return BYPASS_URL_FRAGMENTS.some((frag) => url.includes(frag));
}

function readonlyResponse(): Response {
  return new Response(
    JSON.stringify({
      code: "impersonation_readonly",
      message:
        "Test as… is read-only. Stop role impersonation to make changes.",
    }),
    {
      status: 403,
      headers: { "Content-Type": "application/json" },
    },
  );
}

export function installImpersonationFetchGuard(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    try {
      if (!active) return originalFetch(input, init);

      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method =
        init?.method ??
        (input instanceof Request ? input.method : "GET") ??
        "GET";

      if (!isApiMutationRequest(url, method)) {
        return originalFetch(input, init);
      }
      if (isBypassed(url)) {
        return originalFetch(input, init);
      }

      // Best-effort telemetry; never block on the sink.
      void reportClientError(
        new Error(`Blocked impersonated write: ${method} ${url}`),
        {
          severity: "warning",
          context: { source: "impersonationFetchGuard", method, url },
          // Always log these — they're rare and security-relevant.
          sampleRate: 1,
        },
      );

      return readonlyResponse();
    } catch {
      // Never let the guard itself break the app — fall through to real fetch.
      return originalFetch(input, init);
    }
  }) as typeof window.fetch;
}