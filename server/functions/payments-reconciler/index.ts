import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
// Background reconciler: finds intents stuck pending and verifies them.
// Triggered via cron (every 5 minutes). Requires the cron secret or a SuperAdmin JWT.

import { createClient } from "@matbex/client";
import { getAdapter, loadCredentials } from "../_shared/payments/registry.ts";
import type { PaymentGateway } from "../_shared/payments/types.ts";
import { guardCronCaller } from "../_shared/cronGuard.ts";

serve(async (req) => {
  const unauthorized = await guardCronCaller(req, {});
  if (unauthorized) return unauthorized;

  const db = createClient(
    env("API_URL")!,
    env("SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { data: intents } = await db
    .from("payment_intents")
    .select("*")
    .in("status", ["pending", "authorized"])
    .lt("created_at", cutoff)
    .limit(50);

  const results: Array<{ id: string; status: string; error?: string }> = [];
  for (const intent of intents ?? []) {
    try {
      const adapter = getAdapter(intent.gateway as PaymentGateway);
      const creds = loadCredentials(intent.gateway as PaymentGateway);
      const r = await adapter.verifyPayment(intent.gateway_intent_id ?? "", creds);

      await db.from("payment_intents").update({ status: r.status }).eq("id", intent.id);

      if (r.status === "captured") {
        await db.from("payment_transactions").insert({
          tenant_id: intent.tenant_id,
          branch_id: intent.branch_id,
          terminal_id: intent.terminal_id,
          intent_id: intent.id,
          order_id: intent.order_id,
          kind: "charge",
          gateway: intent.gateway,
          method: intent.method,
          amount: intent.amount,
          currency: intent.currency,
          status: "success",
          gateway_reference: r.gatewayReference ?? null,
          raw_payload: r.raw as any,
        });
      }
      results.push({ id: intent.id, status: r.status });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ id: intent.id, status: "error", error: msg });
    }
  }

  return new Response(JSON.stringify({ checked: results.length, results }), {
    headers: { "Content-Type": "application/json" },
  });
});