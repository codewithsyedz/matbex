// Redis cache proxy backed by Upstash Redis REST API.
// Validates the caller's JWT and namespaces every key by their tenant so
// users can never read another tenant's cached payload.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { buildCorsHeaders } from "../_shared/cors.ts";
import { withMetrics } from "../_shared/metrics.ts";
const UPSTASH_URL = Deno.env.get("UPSTASH_REDIS_REST_URL");
const UPSTASH_TOKEN = Deno.env.get("UPSTASH_REDIS_REST_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

type Body =
  | { op: "get"; key: string }
  | { op: "set"; key: string; value: unknown; ttl?: number }
  | { op: "del"; key: string }
  | { op: "mget"; keys: string[] };

async function upstash(path: string, init?: RequestInit) {
  const res = await fetch(`${UPSTASH_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Upstash ${res.status}: ${txt}`);
  }
  return res.json();
}

Deno.serve(withMetrics("cache-proxy", async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!UPSTASH_URL || !UPSTASH_TOKEN) {
      return new Response(
        JSON.stringify({ error: "Redis not configured" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
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
    const ns = `t:${tenantId}:u:${userId}`;
    const scope = (k: string) => `${ns}:${k}`;

    if (body.op === "get") {
      const r = await upstash(`/get/${encodeURIComponent(scope(body.key))}`);
      const value = r?.result ? JSON.parse(r.result as string) : null;
      return new Response(JSON.stringify({ hit: value !== null, value }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.op === "mget") {
      const keys = body.keys.map(scope);
      const path = `/mget/${keys.map(encodeURIComponent).join("/")}`;
      const r = await upstash(path);
      const arr = (r?.result as (string | null)[]) || [];
      const values = arr.map((v) => (v ? JSON.parse(v) : null));
      return new Response(JSON.stringify({ values }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.op === "set") {
      const ttl = Math.max(5, Math.min(body.ttl ?? 45, 3600));
      // Send the value in the request body - putting it in the URL path
      // overflows Upstash's URL length limit for large payloads.
      await upstash(
        `/set/${encodeURIComponent(scope(body.key))}?EX=${ttl}`,
        { method: "POST", body: JSON.stringify(body.value) },
      );
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.op === "del") {
      await upstash(`/del/${encodeURIComponent(scope(body.key))}`, {
        method: "POST",
      });
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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