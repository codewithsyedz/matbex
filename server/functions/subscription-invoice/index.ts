import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
// Tax invoice for one of Matbex's own subscription payments (owners of the paying business).
// POST { payment_id } -> invoice data the Billing page renders and prints (with the ZATCA QR).
// Seller details come from server settings: MATBEX_LEGAL_NAME, MATBEX_VAT_NUMBER,
// MATBEX_CR_NUMBER, MATBEX_ADDRESS; `seller_incomplete` says when any is missing.

import { createClient } from "@matbex/client";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { paymentOwner } from "../_shared/subscriptionPayment.ts";

const PLAN_LABEL: Record<string, string> = { starter: "Starter", pro: "Growth", enterprise: "Enterprise" };

serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const admin = createClient(env("API_URL") ?? "", env("SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
  let owner;
  try {
    owner = await paymentOwner(admin, req);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Please sign in" }, 403);
  }
  const { payment_id } = await req.json().catch(() => ({}));
  if (typeof payment_id !== "string" || !/^[0-9a-f-]{36}$/i.test(payment_id)) return json({ error: "Invalid payment" }, 400);

  const { data: p } = await admin.from("subscription_payments")
    .select("*, plans:plan_id(name), addons:addon_id(name)")
    .eq("id", payment_id).eq("tenant_id", owner.tenant.id).eq("status", "paid").maybeSingle();
  if (!p?.invoice_number) return json({ error: "No invoice for this payment" }, 404);

  const { data: t } = await admin.from("tenants").select("name").eq("id", owner.tenant.id).single();
  const { data: rests } = await admin.from("restaurants").select("id, name").eq("tenant_id", owner.tenant.id);
  let buyerVat: string | null = null;
  if (rests?.length) {
    const { data: z } = await admin.from("zatca_settings").select("vat_registration_number")
      .in("restaurant_id", rests.map((r: { id: string }) => r.id)).not("vat_registration_number", "is", null).limit(1);
    buyerVat = z?.[0]?.vat_registration_number ?? null;
  }

  // Lines (excluding VAT): the plan or add-on, then add-ons renewed with the plan.
  const items = (p.addon_items ?? []) as { addon_id: string; amount: number }[];
  let addonNames: Record<string, string> = {};
  if (items.length) {
    const { data: a } = await admin.from("addons").select("id, name").in("id", items.map((i) => i.addon_id));
    addonNames = Object.fromEntries((a ?? []).map((x: { id: string; name: string }) => [x.id, x.name]));
  }
  const subtotal = Number(p.subtotal ?? p.amount);
  const addonsTotal = items.reduce((s, i) => s + Number(i.amount), 0);
  const planName = PLAN_LABEL[(p as any).plans?.name] ?? (p as any).plans?.name ?? "Plan";
  const months = Number(p.months) || 0;
  const branches = Number(p.branches) || 1;
  const main = p.kind === "addon"
    ? `Add-on: ${(p as any).addons?.name ?? "Add-on"} (to ${p.period_end ? String(p.period_end).slice(0, 10) : "plan end"})`
    : p.mode === "upgrade"
      ? `Upgrade to Matbex ${planName} (remaining days to ${p.period_end ? String(p.period_end).slice(0, 10) : "period end"})`
      : `Matbex ${planName}, ${months === 12 ? "1 year" : `${months} month${months === 1 ? "" : "s"}`}, ${branches} branch${branches > 1 ? "es" : ""}`;
  const lines = [
    { description: main, amount: Math.round((subtotal - addonsTotal) * 100) / 100 },
    ...items.map((i) => ({ description: `Add-on: ${addonNames[i.addon_id] ?? "Add-on"}`, amount: Number(i.amount) })),
  ];

  const seller = {
    name: env("MATBEX_LEGAL_NAME") ?? "Matbex",
    vat_number: env("MATBEX_VAT_NUMBER") ?? null,
    cr_number: env("MATBEX_CR_NUMBER") ?? null,
    address: env("MATBEX_ADDRESS") ?? null,
  };
  return json({
    invoice_number: p.invoice_number,
    issued_at: p.invoiced_at ?? p.paid_at,
    period_start: p.period_start,
    period_end: p.period_end,
    seller,
    seller_incomplete: !env("MATBEX_LEGAL_NAME") || !seller.vat_number || !seller.address,
    buyer: { name: t?.name ?? "", vat_number: buyerVat },
    lines,
    subtotal,
    vat_rate: Number(p.vat_rate ?? 0),
    vat_amount: Number(p.vat_amount ?? 0),
    total: Number(p.amount),
    currency: "SAR",
    payment_reference: p.moyasar_payment_id,
  });
});
