import { serve } from "../_runtime/serve.ts";
// Restaurant actions towards Deliverect (owners and managers):
//   POST { action: "send_menu", location_id }              upload the menu to that location
//   POST { action: "busy", location_id, minutes }          stop taking delivery orders for a while
//   POST { action: "resume", location_id }                 take orders again
// location_id is the Deliverect location (delivery_platform_locations.external_location_id); the
// caller must be an owner/manager of its restaurant.

import { z } from "zod";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { requireUser, userHasTenantRole } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/payments/settle.ts";
import { env } from "../_runtime/env.ts";
import { buildDeliverectMenu, deliverectPost, type MenuItemRow } from "../_shared/deliverect.ts";

const Body = z.union([
  z.object({ action: z.literal("send_menu"), location_id: z.string().min(1).max(100) }),
  z.object({ action: z.literal("busy"), location_id: z.string().min(1).max(100), minutes: z.number().int().min(5).max(24 * 60) }),
  z.object({ action: z.literal("resume"), location_id: z.string().min(1).max(100) }),
]);

serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  let auth;
  try {
    auth = await requireUser(req);
  } catch (r) {
    if (r instanceof Response) return json(await r.json().catch(() => ({ error: "Unauthorized" })), r.status);
    throw r;
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid request" }, 400);
  const body = parsed.data;

  const db = serviceClient();
  const { data: mapping } = await db.from("delivery_platform_locations")
    .select("tenant_id, restaurant_id, branch_id, external_account_id, external_location_id, is_active")
    .eq("provider", "deliverect").eq("external_location_id", body.location_id).maybeSingle();
  if (!mapping?.is_active) return json({ error: "This Deliverect location is not linked" }, 404);
  if (!(await userHasTenantRole(auth.db, auth.userId, mapping.tenant_id, ["owner", "manager"]))) {
    return json({ error: "Owners and managers only" }, 403);
  }

  try {
    if (body.action === "send_menu") {
      const [{ data: items }, { data: branch }] = await Promise.all([
        db.from("menu_items").select("id, name, category, description, image_url, is_active, selling_price, quarter_price, half_price, full_price")
          .eq("restaurant_id", mapping.restaurant_id).order("name"),
        db.from("branches").select("vat_rate").eq("id", mapping.branch_id).maybeSingle(),
      ]);
      const menu = buildDeliverectMenu((items ?? []) as MenuItemRow[], Number(branch?.vat_rate ?? 0.15));
      const r = await deliverectPost(env("DELIVERECT_PRODUCTS_PATH") ?? "/productAndCategories", {
        accountId: mapping.external_account_id, locationId: mapping.external_location_id, ...menu,
      });
      if (r.status >= 300) return json({ error: `Deliverect refused the menu (${r.status})`, detail: r.body }, 424);
      return json({ ok: true, products: menu.products.length, categories: menu.categories.length });
    }

    const r = await deliverectPost(`/updateStoreStatus/${encodeURIComponent(mapping.external_location_id)}`,
      body.action === "busy"
        ? { isActive: false, disableAt: new Date(Date.now() + body.minutes * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z") }
        : { isActive: true });
    if (r.status >= 300) return json({ error: `Deliverect refused the change (${r.status})`, detail: r.body }, 424);
    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Deliverect request failed" }, 424);
  }
});
