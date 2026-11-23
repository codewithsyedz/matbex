import { serve } from "../_runtime/serve.ts";
// Background reconciler: re-checks open payment intents with the gateway, oldest first.
// Triggered by the worker schedule (server/src/jobs/schedules.ts). Requires the cron secret or
// a SuperAdmin JWT. Each intent is verified with its restaurant's own gateway keys (never a
// server key). Intents older than MAX_OPEN_AGE_MS get one last check and are expired, so
// abandoned QR codes do not pile up and crowd out real payments; a POS cancel that could not
// reach the gateway is finished here (lifecycle.ts).

import { getAdapter, loadTenantCredentials } from "../_shared/payments/registry.ts";
import { intentStore, serviceClient } from "../_shared/payments/settle.ts";
import { OPEN_STATUSES, reconcileIntent, type LifecycleIntent } from "../_shared/payments/lifecycle.ts";
import type { GatewayCredentials, PaymentGateway } from "../_shared/payments/types.ts";
import { guardCronCaller } from "../_shared/cronGuard.ts";

const BATCH = 100;

serve(async (req) => {
  const unauthorized = await guardCronCaller(req, {});
  if (unauthorized) return unauthorized;

  const db = serviceClient();
  const store = intentStore();

  const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { data: intents, error } = await db
    .from("payment_intents")
    .select("*")
    .in("status", OPEN_STATUSES)
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(BATCH);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  const credsCache = new Map<string, Promise<GatewayCredentials>>();
  const credsFor = (tenantId: string, gateway: PaymentGateway) => {
    const key = `${tenantId}:${gateway}`;
    if (!credsCache.has(key)) credsCache.set(key, loadTenantCredentials(tenantId, gateway));
    return credsCache.get(key)!;
  };

  const results: Array<{ id: string; status: string; error?: string }> = [];
  for (const intent of intents ?? []) {
    try {
      const gateway = intent.gateway as PaymentGateway;
      const adapter = getAdapter(gateway);
      const status = await reconcileIntent(intent as LifecycleIntent, {
        verify: async (i) => adapter.verifyPayment(i.gateway_intent_id ?? "", await credsFor(i.tenant_id, gateway)),
        cancel: adapter.cancelPayment
          ? async (i) => adapter.cancelPayment!(i.gateway_intent_id ?? "", await credsFor(i.tenant_id, gateway))
          : undefined,
      }, store);
      results.push({ id: intent.id, status });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ id: intent.id, status: "error", error: msg });
    }
  }

  return new Response(JSON.stringify({ checked: results.length, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
