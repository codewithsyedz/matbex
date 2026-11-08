import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyCustomerJwt } from "../_shared/customerJwt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("authorization") ?? "";
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m) return json({ error: "Missing token" }, 401);
    let claims;
    try {
      claims = await verifyCustomerJwt(m[1]);
    } catch (e: any) {
      return json({ error: "Invalid or expired token" }, 401);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? "list";

    if (action === "me") {
      const { data, error } = await admin
        .from("customer_profiles")
        .select("id, phone, name, email, created_at")
        .eq("id", claims.sub)
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);
      return json({ customer: data });
    }

    if (action === "link-order" && req.method === "POST") {
      const { order_id } = await req.json().catch(() => ({}));
      if (!order_id) return json({ error: "order_id required" }, 400);
      // Only link if phone matches the customer's phone (prevents claiming others' orders)
      const { data: order } = await admin
        .from("online_orders")
        .select("id, customer_phone, customer_id")
        .eq("id", order_id)
        .maybeSingle();
      if (!order) return json({ error: "Order not found" }, 404);
      if (order.customer_phone !== claims.phone) return json({ error: "Phone mismatch" }, 403);
      if (!order.customer_id) {
        await admin.from("online_orders").update({ customer_id: claims.sub }).eq("id", order_id);
      }
      return json({ ok: true });
    }

    // Default: list orders linked to this customer (and any past orders matching phone)
    const { data: orders, error } = await admin
      .from("online_orders")
      .select(
        "id, order_number, status, order_type, total, payment_method, payment_status, customer_name, customer_phone, created_at, restaurant_id",
      )
      .or(`customer_id.eq.${claims.sub},customer_phone.eq.${claims.phone}`)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return json({ error: error.message }, 500);

    return json({ orders: orders ?? [] });
  } catch (e: any) {
    console.error("customer-orders error", e);
    return json({ error: e?.message ?? "Failed" }, 500);
  }
});