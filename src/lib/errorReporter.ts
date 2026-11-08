/**
 * Lightweight client-side error sink → `public.client_errors`.
 *
 * Why: production chunk-load failures, unhandled rejections, and React
 * boundary catches were previously invisible (LazyLoadErrorBoundary just
 * reloaded the page). This sink lets owners/managers see what's breaking
 * for their tenant without pulling in a full Sentry SDK.
 *
 * Design notes:
 * - Anonymous-friendly: a chunk-load failure during the public landing page
 *   still logs (the RLS policy allows anon INSERT).
 * - Sampled (default 25%) so a runaway error loop can't DDoS the DB.
 * - Best-effort: failures here are swallowed - we never want the reporter
 *   to itself cause a render error.
 * - Per-fingerprint cooldown (60s) prevents a tight loop from flooding.
 */
import { supabase } from "@/integrations/supabase/client";

type Severity = "warning" | "error" | "fatal";

interface ReportOptions {
  severity?: Severity;
  context?: Record<string, unknown>;
  /** Override the default sample rate (0..1) - use 1 for boundary catches. */
  sampleRate?: number;
}

const DEFAULT_SAMPLE_RATE = 0.25;
const FINGERPRINT_COOLDOWN_MS = 60_000;
const recentFingerprints = new Map<string, number>();

function fingerprint(err: Error): string {
  const firstLine = (err.stack || "").split("\n").slice(0, 3).join("|");
  return `${err.name}:${err.message}:${firstLine}`.slice(0, 256);
}

function shouldThrottle(fp: string): boolean {
  const now = Date.now();
  const last = recentFingerprints.get(fp);
  if (last && now - last < FINGERPRINT_COOLDOWN_MS) return true;
  recentFingerprints.set(fp, now);
  // Keep the map bounded - drop old entries when it grows past 200.
  if (recentFingerprints.size > 200) {
    const cutoff = now - FINGERPRINT_COOLDOWN_MS;
    for (const [k, v] of recentFingerprints) {
      if (v < cutoff) recentFingerprints.delete(k);
    }
  }
  return false;
}

function safeRoute(): string | null {
  try {
    return typeof window !== "undefined" ? window.location.pathname : null;
  } catch {
    return null;
  }
}

async function currentUserAndTenant() {
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user?.id ?? null;
    if (!userId) return { userId: null, tenantId: null };
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    return { userId, tenantId: (profile?.tenant_id as string | null) ?? null };
  } catch {
    return { userId: null, tenantId: null };
  }
}

export async function reportClientError(
  err: unknown,
  opts: ReportOptions = {},
): Promise<void> {
  try {
    const error = err instanceof Error ? err : new Error(String(err));
    const sampleRate = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
    if (Math.random() > sampleRate) return;

    const fp = fingerprint(error);
    if (shouldThrottle(fp)) return;

    const { userId, tenantId } = await currentUserAndTenant();

    const payload = {
      tenant_id: tenantId,
      user_id: userId,
      route: safeRoute(),
      release: (import.meta as any)?.env?.VITE_RELEASE ?? null,
      user_agent:
        typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 512) : null,
      error_name: error.name?.slice(0, 256) ?? "Error",
      error_message: error.message?.slice(0, 1024) ?? "",
      error_stack: error.stack?.slice(0, 8000) ?? null,
      context: opts.context ?? null,
      severity: opts.severity ?? "error",
    };
    // @ts-expect-error - generated Database types lag the new table by one regen
    await supabase.from("client_errors").insert(payload);
  } catch {
    /* never let the reporter itself throw */
  }
}

/** Wire window-level handlers exactly once. Safe to call multiple times. */
let installed = false;

const CHUNK_RELOAD_FLAG = "lovable:chunk-reload-at";
const CHUNK_RELOAD_COOLDOWN_MS = 30_000;

function isChunkLoadError(err: Error): boolean {
  const msg = err?.message || "";
  return (
    msg.includes("Failed to fetch dynamically imported module") ||
    msg.includes("Loading chunk") ||
    msg.includes("Loading CSS chunk") ||
    msg.includes("error loading dynamically imported module")
  );
}

function maybeAutoReloadForStaleChunk(err: Error): void {
  if (!isChunkLoadError(err)) return;
  try {
    const raw = sessionStorage.getItem(CHUNK_RELOAD_FLAG);
    if (raw && Date.now() - Number(raw) < CHUNK_RELOAD_COOLDOWN_MS) return;
    sessionStorage.setItem(CHUNK_RELOAD_FLAG, String(Date.now()));
  } catch {
    /* ignore */
  }
  console.warn("[errorReporter] stale dynamic import detected, reloading", err);
  setTimeout(() => window.location.reload(), 100);
}

export function installGlobalErrorReporter(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (ev) => {
    const err = ev.error instanceof Error ? ev.error : new Error(ev.message);
    void reportClientError(err, { severity: "error", context: { source: "window.error" } });
    maybeAutoReloadForStaleChunk(err);
  });

  window.addEventListener("unhandledrejection", (ev) => {
    const reason = (ev as PromiseRejectionEvent).reason;
    const err = reason instanceof Error ? reason : new Error(String(reason));
    void reportClientError(err, {
      severity: "error",
      context: { source: "unhandledrejection" },
    });
    maybeAutoReloadForStaleChunk(err);
  });
}