import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
import { createClient } from "@matbex/client";

import { buildCorsHeaders } from "../_shared/cors.ts";
import { guardCronCaller } from "../_shared/cronGuard.ts";

/**
 * Hourly ledger housekeeping:
 *  - every account's stored balance equals its ledger (sum of debit - credit
 *    over non-voided lines); drift is corrected and recorded in
 *    account_balance_recompute_log by recompute_account_balances(). With the
 *    ledger trigger owning the column this should find nothing.
 *  - journal entries committed since the last run get their gap-free number
 *    (number_journal_entries).
 *  - reports the balance / append-only violations logged in the last 24 hours
 *    (ledger_integrity_violations), which stay in log mode until that is empty.
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

  // Gap-free journal entry numbers for entries committed since the last run.
  const { data: numbered, error: numError } = await db.rpc("number_journal_entries", { p_tenant_id: tenantId });
  if (numError) {
    console.error("number_journal_entries failed", numError.message);
    return json({ ok: false, corrected, error: numError.message }, 500);
  }

  // Integrity checks run in log mode first: report what they caught in the last day.
  const since = new Date(Date.now() - 86_400_000).toISOString();
  let vq = db.from("ledger_integrity_violations").select("kind").gte("created_at", since);
  if (tenantId) vq = vq.eq("tenant_id", tenantId);
  const { data: violations, error: vError } = await vq.limit(1000);
  if (vError) console.error("violation count failed", vError.message);
  const byKind: Record<string, number> = {};
  for (const v of (violations ?? []) as Array<{ kind: string }>) byKind[v.kind] = (byKind[v.kind] ?? 0) + 1;
  if (Object.keys(byKind).length) console.warn("ledger integrity violations (last 24h)", JSON.stringify(byKind));

  return json({ ok: true, corrected, numbered: numbered ?? 0, violationsLast24h: byKind });
});
