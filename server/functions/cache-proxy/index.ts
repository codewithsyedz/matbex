import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
import { getRedis } from "../_runtime/redis.ts";
// Redis cache proxy for dashboard/report queries (src/lib/redisCache.ts).
// Validates the caller's JWT and namespaces every key by their tenant and user so
// users can never read another tenant's cached payload. Uses the API's shared Redis
// connection (REDIS_URL); without Redis every read is a miss and writes are no-ops.
import { createClient } from "@matbex/client";

import { buildCorsHeaders } from "../_shared/cors.ts";
import { withMetrics } from "../_shared/metrics.ts";
const API_URL = env("API_URL")!;
const ANON_KEY = env("ANON_KEY")!;

type Body =
  | { op: "get"; key: string }
  | { op: "set"; key: string; value: unknown; ttl?: number }
  | { op: "del"; key: string }
  | { op: "mget"; keys: string[] };

const MAX_KEYS = 50;
const MAX_VALUE_BYTES = 512 * 1024;

serve(withMetrics("cache-proxy", async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const redis = getRedis();

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supa = createClient(API_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: uErr } = await supa.auth.getUser();
    const userId = userData?.user?.id;
    if (uErr || !userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve tenant for this user - used as the cache namespace.
    const { data: tenantRow } = await supa
      .from("user_tenant_roles")
      .select("tenant_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    const tenantId = (tenantRow as any)?.tenant_id ?? "no-tenant";

    const body = (await req.json()) as Body;
    const ns = `cache:t:${tenantId}:u:${userId}`;
    const scope = (k: string) => `${ns}:${k}`;

    const json = (data: unknown) =>
      new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    // Redis not configured or unreachable: behave as an empty cache.
    const live = redis && redis.status === "ready" ? redis : null;

    if (body.op === "get") {
      const raw = live ? await live.get(scope(body.key)) : null;
      const value = raw ? JSON.parse(raw) : null;
      return json({ hit: value !== null, value });
    }

    if (body.op === "mget") {
      const keys = (body.keys ?? []).slice(0, MAX_KEYS).map(scope);
      const arr = live && keys.length ? await live.mget(...keys) : keys.map(() => null);
      return json({ values: arr.map((v) => (v ? JSON.parse(v) : null)) });
    }

    if (body.op === "set") {
      const ttl = Math.max(5, Math.min(body.ttl ?? 45, 3600));
      const payload = JSON.stringify(body.value ?? null);
      if (live && payload.length <= MAX_VALUE_BYTES) await live.set(scope(body.key), payload, "EX", ttl);
      return json({ ok: true });
    }

    if (body.op === "del") {
      if (live) await live.del(scope(body.key));
      return json({ ok: true });
    }

    return new Response(JSON.stringify({ error: "Invalid op" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("cache-proxy error", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
}));