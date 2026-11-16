import { serve } from "../_runtime/serve.ts";
// Every minute (server/src/jobs/schedules.ts): send queued order status changes to Deliverect
// (delivery_status_outbox, filled by trg_queue_deliverect_status). Retries with backoff until
// Deliverect accepts, at most 10 attempts per update.

import { buildCorsHeaders } from "../_shared/cors.ts";
import { guardCronCaller } from "../_shared/cronGuard.ts";
import { serviceClient } from "../_shared/payments/settle.ts";
import { deliverectPost } from "../_shared/deliverect.ts";

const MAX_ATTEMPTS = 10;

serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const unauthorized = await guardCronCaller(req, cors);
  if (unauthorized) return unauthorized;

  const db = serviceClient();
  const { data: due } = await db.from("delivery_status_outbox").select("*")
    .is("sent_at", null).lte("next_attempt_at", new Date().toISOString()).lt("attempts", MAX_ATTEMPTS)
    .eq("provider", "deliverect").order("created_at").limit(50);

  let sent = 0;
  let failed = 0;
  for (const row of due ?? []) {
    let error: string | null = null;
    try {
      const r = await deliverectPost(`/orderStatus/${encodeURIComponent(row.external_order_id)}`, {
        orderId: row.external_order_id,
        receiptId: row.receipt_id ?? "",
        status: row.status_code,
        ...(row.reason ? { reason: row.reason } : {}),
        timeStamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      });
      if (r.status < 200 || r.status >= 300) error = `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    if (!error) {
      await db.from("delivery_status_outbox").update({ sent_at: new Date().toISOString(), attempts: row.attempts + 1, last_error: null }).eq("id", row.id);
      sent++;
    } else {
      const wait = Math.min(60, 2 ** row.attempts); // minutes
      await db.from("delivery_status_outbox").update({
        attempts: row.attempts + 1,
        last_error: error,
        next_attempt_at: new Date(Date.now() + wait * 60_000).toISOString(),
      }).eq("id", row.id);
      failed++;
    }
  }
  return new Response(JSON.stringify({ due: due?.length ?? 0, sent, failed }), { headers: { ...cors, "Content-Type": "application/json" } });
});
