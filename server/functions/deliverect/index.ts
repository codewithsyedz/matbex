import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
// Webhooks Deliverect calls on Matbex (Matbex is the POS). Every request must carry Deliverect's
// HMAC (X-Server-Authorization-HMAC-SHA256) over the raw body; see _shared/deliverect.ts.
//
//   POST /functions/v1/deliverect/register        a location is linked. externalLocationId is the
//                                                  Matbex branch id; answers with our webhook URLs
//   POST /functions/v1/deliverect/orders          an order (or cancellation) -> online_orders
//   POST /functions/v1/deliverect/sync-products   Deliverect asks for the menu: answered with it
//   POST /functions/v1/deliverect/store-status    a delivery app opened/closed the store (logged)

import { buildCorsHeaders } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/payments/settle.ts";
import { aggregatorsAllowed, buildDeliverectMenu, verifyDeliverectSignature, type MenuItemRow } from "../_shared/deliverect.ts";

serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const route = new URL(req.url).pathname.split("/").filter(Boolean).pop();
  const raw = await req.text();
  let body: any;
  try { body = raw ? JSON.parse(raw) : {}; } catch { return json({ error: "Invalid JSON" }, 400); }

  const signed = await verifyDeliverectSignature(raw, req.headers.get("x-server-authorization-hmac-sha256"),
    [body?.locationId, body?.location, body?.channelLink]);
  if (!signed) return json({ error: "Invalid signature" }, 401);

  const db = serviceClient();
  const mappingFor = async (deliverectLocationId: string | undefined) => {
    if (!deliverectLocationId) return null;
    const { data } = await db.from("delivery_platform_locations")
      .select("tenant_id, restaurant_id, branch_id, external_account_id, is_active")
      .eq("provider", "deliverect").eq("external_location_id", deliverectLocationId).maybeSingle();
    return data?.is_active ? data : null;
  };

  if (route === "register") {
    const branchId = String(body.externalLocationId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(branchId)) return json({ error: "externalLocationId must be the Matbex branch id" }, 400);
    const { data: branch } = await db.from("branches").select("id, restaurant_id")
      .eq("id", branchId).is("deleted_at", null).maybeSingle();
    const { data: rest } = branch
      ? await db.from("restaurants").select("tenant_id").eq("id", branch.restaurant_id).maybeSingle()
      : { data: null };
    if (!branch || !rest?.tenant_id) return json({ error: "Unknown Matbex branch id" }, 404);
    if (!(await aggregatorsAllowed(db, rest.tenant_id))) return json({ error: "Delivery aggregators need the Matbex Enterprise plan" }, 403);
    if (!body.locationId) return json({ error: "locationId is required" }, 400);
    const { error } = await db.from("delivery_platform_locations").upsert({
      provider: "deliverect",
      external_location_id: String(body.locationId),
      tenant_id: rest.tenant_id,
      restaurant_id: branch.restaurant_id,
      branch_id: branch.id,
      external_account_id: body.accountId ? String(body.accountId) : null,
      location_name: body.locationName ? String(body.locationName) : null,
      registered_at: new Date().toISOString(),
      is_active: true,
    }, { onConflict: "provider,external_location_id" });
    if (error) return json({ error: error.message }, 500);
    const base = `${(env("API_URL") ?? "").replace(/\/$/, "")}/functions/v1/deliverect`;
    return json({
      ordersWebhookURL: `${base}/orders`,
      syncProductsURL: `${base}/sync-products`,
      storeStatusWebhookURL: `${base}/store-status`,
      syncTablesURL: "",
      syncFloorsURL: "",
      operationsWebhookURL: "",
      taxCalculationWebhookURL: "",
    });
  }

  if (route === "orders") {
    const mapping = await mappingFor(body.location);
    if (!mapping) return json({ error: "This Deliverect location is not linked to Matbex" }, 404);
    if (!(await aggregatorsAllowed(db, mapping.tenant_id))) return json({ error: "Delivery aggregators need the Matbex Enterprise plan" }, 403);
    const { data, error } = await db.rpc("ingest_deliverect_order", { p_restaurant_id: mapping.restaurant_id, p_order: body });
    if (error) return json({ error: error.message }, 500);
    return json({ result: "OK", ...(data as Record<string, unknown>) });
  }

  if (route === "sync-products") {
    const mapping = await mappingFor(body.locationId ?? body.location);
    if (!mapping) return json({ error: "This Deliverect location is not linked to Matbex" }, 404);
    const [{ data: items }, { data: branch }] = await Promise.all([
      db.from("menu_items").select("id, name, category, description, image_url, is_active, selling_price, quarter_price, half_price, full_price")
        .eq("restaurant_id", mapping.restaurant_id).order("name"),
      db.from("branches").select("vat_rate").eq("id", mapping.branch_id).maybeSingle(),
    ]);
    const menu = buildDeliverectMenu((items ?? []) as MenuItemRow[], Number(branch?.vat_rate ?? 0.15));
    return json({ accountId: mapping.external_account_id, locationId: body.locationId ?? body.location, ...menu });
  }

  if (route === "store-status") {
    return json({ result: "OK" });
  }

  return json({ error: "Unknown Deliverect webhook" }, 404);
});
