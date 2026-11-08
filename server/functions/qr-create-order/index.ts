import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
// QR Dine-In order creation endpoint.
// Public — no JWT. Validates the per-table token, inserts an online_orders row
// scoped to the table with channel='qr', returns the order id.

import { createClient } from "@matbex/client";
import { z } from "zod";
import { buildCorsHeaders } from "../_shared/cors.ts";

const ItemSchema = z.object({
  menu_item_id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  variant: z.string().max(40).optional(),
  quantity: z.number().int().min(1).max(99),
  // Client-supplied price is accepted for backwards compatibility but IGNORED:
  // all prices are resolved server-side from the menu.
  price: z.number().min(0).max(100000).optional(),
  notes: z.string().max(500).optional(),
});

const BodySchema = z.object({
  token: z.string().min(8).max(64),
  customer_name: z.string().min(1).max(120).default("Guest"),
  customer_phone: z.string().max(40).default(""),
  items: z.array(ItemSchema).min(1).max(80),
  notes: z.string().max(500).optional(),
  tax_rate: z.number().min(0).max(1).optional(),
});

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: parsed.error.flatten().fieldErrors }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { token, customer_name, customer_phone, items, notes } = parsed.data;

  const db = createClient(
    env("API_URL")!,
    env("SERVICE_ROLE_KEY")!,
  );

  const { data: qr, error: qrErr } = await db
    .from("table_qr_codes")
    .select("restaurant_id, table_id, active")
    .eq("token", token)
    .maybeSingle();

  if (qrErr || !qr || !qr.active) {
    return new Response(JSON.stringify({ error: "Invalid or inactive QR code" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Resolve authoritative prices server-side; caller-supplied prices are ignored.
  const { data: menuRows, error: menuErr } = await db
    .from("menu_items")
    .select("id, name, selling_price, quarter_price, half_price, full_price, is_active")
    .eq("restaurant_id", qr.restaurant_id)
    .in("id", Array.from(new Set(items.map((i) => i.menu_item_id))));

  if (menuErr) {
    console.error("[qr-create-order] menu lookup failed", menuErr);
    return new Response(JSON.stringify({ error: "Failed to place order" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const menuById = new Map((menuRows ?? []).map((m) => [m.id as string, m]));
  const pricedItems: Array<{
    menu_item_id: string; name: string; variant?: string;
    quantity: number; price: number; line_total: number; notes?: string;
  }> = [];

  for (const it of items) {
    const m = menuById.get(it.menu_item_id);
    if (!m || m.is_active === false) {
      return new Response(JSON.stringify({ error: "One or more items are unavailable" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const variant = (it.variant ?? "").toLowerCase();
    const variantPrice = variant === "quarter" ? m.quarter_price
      : variant === "half" ? m.half_price
      : variant === "full" ? m.full_price
      : null;
    const unit = Number(
      variantPrice ?? m.selling_price ?? m.full_price ?? m.half_price ?? m.quarter_price ?? NaN,
    );
    if (!Number.isFinite(unit) || unit < 0) {
      return new Response(JSON.stringify({ error: "One or more items have no price configured" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const price = Math.round(unit * 100) / 100;
    pricedItems.push({
      menu_item_id: it.menu_item_id,
      name: m.name as string,
      variant: it.variant,
      quantity: it.quantity,
      price,
      line_total: Math.round(price * it.quantity * 100) / 100,
      notes: it.notes,
    });
  }

  // VAT rate comes from the branch configuration, never from the request.
  const { data: branchRow } = await db
    .from("branches")
    .select("vat_rate, is_primary, created_at")
    .eq("restaurant_id", qr.restaurant_id)
    .is("deleted_at", null)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  let taxRate = Number(branchRow?.vat_rate ?? 0.15);
  if (!Number.isFinite(taxRate) || taxRate < 0) taxRate = 0.15;
  if (taxRate > 1) taxRate = taxRate / 100;

  // Menu prices are VAT-inclusive: the item sum is the final payable total.
  const total = Math.round(pricedItems.reduce((s, i) => s + i.line_total, 0) * 100) / 100;
  const subtotal = Math.round((total / (1 + taxRate)) * 100) / 100;
  const tax = Math.round((total - subtotal) * 100) / 100;

  const { data: lastOrder } = await db
    .from("online_orders")
    .select("order_number")
    .eq("restaurant_id", qr.restaurant_id)
    .order("order_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrderNumber = (lastOrder?.order_number ?? 0) + 1;

  const { data: inserted, error: insErr } = await db
    .from("online_orders")
    .insert({
      restaurant_id: qr.restaurant_id,
      table_id: qr.table_id,
      channel: "qr",
      order_number: nextOrderNumber,
      order_type: "dine_in",
      customer_name,
      customer_phone,
      subtotal,
      tax,
      total,
      delivery_fee: 0,
      payment_status: "pending",
      payment_method: "pay_at_table",
      status: "pending",
      delivery_notes: notes ?? null,
      external_payload: { items: pricedItems, notes },
    })
    .select("id, order_number")
    .single();

  if (insErr) {
    console.error("[qr-create-order] insert failed", insErr);
    return new Response(JSON.stringify({ error: "Failed to place order" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ ok: true, order_id: inserted.id, order_number: inserted.order_number }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});