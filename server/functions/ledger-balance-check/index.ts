import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
import { createClient } from "@matbex/client";

import { buildCorsHeaders } from "../_shared/cors.ts";
import { guardCronCaller } from "../_shared/cronGuard.ts";

/**
 * Nightly check that every account's stored balance equals its ledger
 * (sum of debit - credit over non-voided lines). Any drift is corrected and
 * recorded in account_balance_recompute_log by recompute_account_balances().
 * With the ledger trigger owning the column this should find nothing; a
 * non-empty result points at a posting path to investigate.
 *
 * Body (optional): { tenant_id?: string }
 */
serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const unauthorized = await guardCronCaller(req, corsHeaders);
  if (unauthorized) return unauthorized;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let tenantId: string | null = null;
  try {
    const body = await req.json();
    if (typeof body?.tenant_id === "string") tenantId = body.tenant_id;
  } catch (_e) {
    // no body: all tenants
  }

  const db = createClient(env("API_URL")!, env("SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const { data, error } = await db.rpc("recompute_account_balances", {
    p_tenant_id: tenantId,
    p_source: "nightly_check",
  });
  if (error) {
    console.error("ledger-balance-check failed", error.message);
    return json({ ok: false, error: error.message }, 500);
  }

  const corrected = (data ?? []) as Array<{ tenant_id: string; accounts_corrected: number; abs_drift: number }>;
  if (corrected.length > 0) {
    console.warn("ledger-balance-check corrected drift", JSON.stringify(corrected));
  }
  return json({ ok: true, corrected });
});
