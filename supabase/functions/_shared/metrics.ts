// Edge-function metrics helper.
//
// Wraps a Deno.serve handler with timing + cold-start detection and writes a
// row to public.edge_function_metrics. The insert is fire-and-forget (queued
// with EdgeRuntime.waitUntil when available) so it never delays the response.
//
// Usage:
//   import { withMetrics } from "../_shared/metrics.ts";
//   Deno.serve(withMetrics("cache-proxy", async (req) => { ... }));

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Cold-start detection: this module-level flag is `false` for the first
// request handled by a new isolate, then flips to `true` for warm requests.
let warm = false;

type Handler = (req: Request) => Promise<Response> | Response;

async function postMetric(row: Record<string, unknown>) {
  if (!SUPABASE_URL || !SERVICE_ROLE) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/edge_function_metrics`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    });
  } catch (e) {
    // Never let metrics failure break the function.
    console.warn("[metrics] insert failed", (e as Error).message);
  }
}

function waitUntil(p: Promise<unknown>) {
  // Supabase Edge Runtime exposes EdgeRuntime.waitUntil; fall back to fire-and-forget.
  const er = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (er?.waitUntil) {
    er.waitUntil(p);
  } else {
    p.catch(() => { /* swallow */ });
  }
}

export function withMetrics(functionName: string, handler: Handler): Handler {
  return async (req) => {
    const coldStart = !warm;
    warm = true;
    const startedAt = new Date();
    const t0 = performance.now();
    let response: Response;
    let errorMessage: string | null = null;
    try {
      response = await handler(req);
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : String(e);
      response = new Response(
        JSON.stringify({ error: errorMessage }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
    const durationMs = Math.round(performance.now() - t0);
    // Skip metrics for CORS preflights — they are noise.
    if (req.method !== "OPTIONS") {
      waitUntil(postMetric({
        function_name: functionName,
        request_id: req.headers.get("x-request-id") ?? null,
        status_code: response.status,
        duration_ms: durationMs,
        cold_start: coldStart,
        error_message: errorMessage,
        started_at: startedAt.toISOString(),
      }));
    }
    return response;
  };
}