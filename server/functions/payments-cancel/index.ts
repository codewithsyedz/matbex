import { serve } from "../_runtime/serve.ts";
// The cashier cancelled the card screen in the POS. Closes the gateway's payment page and asks
// the gateway (restaurant's own key) whether the customer paid anyway:
//   { status: "canceled", paid: false }  - the intent is closed, the QR can no longer be paid;
//   { status: "captured", paid: true }   - the customer paid: the POS records the sale with it;
//   { status: "pending", verified: false } - the gateway could not be asked; the reconciler
//                                            finishes the cancel on its next run.
// Access: the intent must be visible to the caller (RLS: same tenant) and, when it belongs to
// a branch, the caller must have access to that branch.

import { buildCorsHeaders, corsPreflight } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { getAdapter, loadTenantCredentials } from "../_shared/payments/registry.ts";
import { intentStore } from "../_shared/payments/settle.ts";
import { cancelIntent, type LifecycleIntent } from "../_shared/payments/lifecycle.ts";
import type { PaymentGateway } from "../_shared/payments/types.ts";

serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const pre = corsPreflight(req);
  if (pre) return pre;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  let auth;
  try { auth = await requireUser(req); }
  catch (r) {
    if (r instanceof Response) return json(await r.json().catch(() => ({ error: "Unauthorized" })), r.status);
    throw r;
  }

  const { intent_id } = await req.json().catch(() => ({}));
  if (typeof intent_id !== "string" || !intent_id) return json({ error: "intent_id required" }, 400);

  // Read as the caller: RLS limits intents to the caller's tenant.
  const { data: intent } = await auth.userClient
    .from("payment_intents")
    .select("id, tenant_id, branch_id, terminal_id, order_id, gateway, method, amount, currency, status, gateway_intent_id, created_at, metadata")
    .eq("id", intent_id)
    .maybeSingle();
  if (!intent) return json({ error: "Intent not found" }, 404);
  if (intent.order_id) return json({ error: "Only POS card payments can be cancelled here" }, 400);
  if (intent.branch_id) {
    const { data: ok, error } = await auth.userClient.rpc("can_access_branch", { _branch_id: intent.branch_id });
    if (error || ok !== true) return json({ error: "Intent not found" }, 404);
  }

  const gateway = intent.gateway as PaymentGateway;
  const adapter = getAdapter(gateway);
  const creds = await loadTenantCredentials(intent.tenant_id, gateway);
  const outcome = await cancelIntent(
    intent as LifecycleIntent,
    {
      verify: (i) => adapter.verifyPayment(i.gateway_intent_id ?? "", creds),
      cancel: adapter.cancelPayment ? (i) => adapter.cancelPayment!(i.gateway_intent_id ?? "", creds) : undefined,
    },
    intentStore(),
    auth.userId,
  );
  return json({ intent_id, ...outcome });
});
