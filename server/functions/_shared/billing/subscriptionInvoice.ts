// Tax invoices for Matbex's own subscription payments: the data (shared by the owner's invoice
// view, the SuperAdmin billing console and the receipt email) and the receipt email itself.
//
// Seller details come from platform_settings "matbex_seller" (SuperAdmin → Settings), with the
// MATBEX_LEGAL_NAME / _VAT_NUMBER / _CR_NUMBER / _ADDRESS server settings as fallback.

import { env } from "../../_runtime/env.ts";
import { sendEmail } from "../../../src/email/send.ts";

const PLAN_LABEL: Record<string, string> = { starter: "Starter", pro: "Growth", enterprise: "Enterprise" };

// deno-lint-ignore no-explicit-any
type Db = any;

export interface SubscriptionInvoice {
  payment_id: string;
  tenant_id: string;
  invoice_number: string;
  issued_at: string;
  period_start: string | null;
  period_end: string | null;
  seller: { name: string; vat_number: string | null; cr_number: string | null; address: string | null };
  seller_incomplete: boolean;
  buyer: { name: string; vat_number: string | null };
  lines: { description: string; amount: number }[];
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  refunded_amount: number;
  currency: string;
  method: string;
  payment_reference: string | null;
}

export async function sellerDetails(db: Db) {
  const { data: ps } = await db.from("platform_settings").select("value").eq("key", "matbex_seller").maybeSingle();
  const saved = (ps?.value ?? {}) as Record<string, string | undefined>;
  const pick = (k: string, envName: string) => (saved[k]?.trim() || env(envName) || null);
  const legalName = pick("legal_name", "MATBEX_LEGAL_NAME");
  const seller = {
    name: legalName ?? "Matbex",
    vat_number: pick("vat_number", "MATBEX_VAT_NUMBER"),
    cr_number: pick("cr_number", "MATBEX_CR_NUMBER"),
    address: pick("address", "MATBEX_ADDRESS"),
  };
  return { seller, incomplete: !legalName || !seller.vat_number || !seller.address };
}

/** The invoice for a paid payment, or null when it has none. `tenantId` scopes the lookup. */
export async function buildSubscriptionInvoice(db: Db, paymentId: string, tenantId?: string): Promise<SubscriptionInvoice | null> {
  let q = db.from("subscription_payments").select("*, plans:plan_id(name), addons:addon_id(name)")
    .eq("id", paymentId).eq("status", "paid");
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data: p } = await q.maybeSingle();
  if (!p?.invoice_number || !p.tenant_id) return null;

  const { data: t } = await db.from("tenants").select("name").eq("id", p.tenant_id).single();
  const { data: rests } = await db.from("restaurants").select("id").eq("tenant_id", p.tenant_id);
  let buyerVat: string | null = null;
  if (rests?.length) {
    const { data: z } = await db.from("zatca_settings").select("vat_registration_number")
      .in("restaurant_id", rests.map((r: { id: string }) => r.id)).not("vat_registration_number", "is", null).limit(1);
    buyerVat = z?.[0]?.vat_registration_number ?? null;
  }

  // Lines (excluding VAT): the plan or add-on, then add-ons renewed with the plan.
  const items = (p.addon_items ?? []) as { addon_id: string; amount: number }[];
  let addonNames: Record<string, string> = {};
  if (items.length) {
    const { data: a } = await db.from("addons").select("id, name").in("id", items.map((i) => i.addon_id));
    addonNames = Object.fromEntries((a ?? []).map((x: { id: string; name: string }) => [x.id, x.name]));
  }
  const subtotal = Number(p.subtotal ?? p.amount);
  const addonsTotal = items.reduce((s, i) => s + Number(i.amount), 0);
  const planName = PLAN_LABEL[p.plans?.name] ?? p.plans?.name ?? "Plan";
  const months = Number(p.months) || 0;
  const branches = Number(p.branches) || 1;
  const until = (d: string | null, fallback: string) => (d ? String(d).slice(0, 10) : fallback);
  const main = p.kind === "addon"
    ? `Add-on: ${p.addons?.name ?? "Add-on"} (to ${until(p.period_end, "plan end")})`
    : p.mode === "upgrade"
      ? `Upgrade to Matbex ${planName} (remaining days to ${until(p.period_end, "period end")})`
      : `Matbex ${planName}, ${months === 12 ? "1 year" : `${months} month${months === 1 ? "" : "s"}`}, ${branches} branch${branches > 1 ? "es" : ""}`;
  const lines = [
    { description: main, amount: Math.round((subtotal - addonsTotal) * 100) / 100 },
    ...items.map((i) => ({ description: `Add-on: ${addonNames[i.addon_id] ?? "Add-on"}`, amount: Number(i.amount) })),
  ];

  const { seller, incomplete } = await sellerDetails(db);
  return {
    payment_id: p.id,
    tenant_id: p.tenant_id,
    invoice_number: p.invoice_number,
    issued_at: p.invoiced_at ?? p.paid_at,
    period_start: p.period_start,
    period_end: p.period_end,
    seller,
    seller_incomplete: incomplete,
    buyer: { name: t?.name ?? "", vat_number: buyerVat },
    lines,
    subtotal,
    vat_rate: Number(p.vat_rate ?? 0),
    vat_amount: Number(p.vat_amount ?? 0),
    total: Number(p.amount),
    refunded_amount: Number(p.refunded_amount ?? 0),
    currency: "SAR",
    method: p.method ?? "moyasar",
    payment_reference: p.moyasar_payment_id ?? p.reference ?? null,
  };
}

const esc = (s: string | null | undefined) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const sar = (n: number) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const METHOD: Record<string, string> = { moyasar: "Paid online", bank_transfer: "Paid by bank transfer", cash: "Paid in cash", other: "Paid" };

function invoiceEmailHtml(inv: SubscriptionInvoice, billingUrl: string) {
  const row = (a: string, b: string, bold = false) =>
    `<tr><td style="padding:6px 0;${bold ? "font-weight:600" : ""}">${a}</td><td style="padding:6px 0;text-align:right;${bold ? "font-weight:600" : ""}">${b}</td></tr>`;
  return `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;color:#111">
  <h2 style="margin:0 0 4px">Tax invoice ${esc(inv.invoice_number)}</h2>
  <p style="color:#555;margin:0 0 16px">Thank you for your payment to Matbex. ${esc(METHOD[inv.method] ?? "Paid")}${inv.payment_reference ? ` (ref ${esc(inv.payment_reference)})` : ""}.</p>
  <p style="margin:0 0 12px;font-size:14px"><b>Seller</b>: ${esc(inv.seller.name)}${inv.seller.vat_number ? `, VAT ${esc(inv.seller.vat_number)}` : ""}<br>
  <b>Buyer</b>: ${esc(inv.buyer.name)}${inv.buyer.vat_number ? `, VAT ${esc(inv.buyer.vat_number)}` : ""}</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px;border-top:1px solid #ddd">
  ${inv.lines.map((l) => row(esc(l.description), sar(l.amount))).join("")}
  ${row("Subtotal", sar(inv.subtotal))}
  ${row(`VAT ${(inv.vat_rate * 100).toFixed(0)}%`, sar(inv.vat_amount))}
  ${row("Total paid", `SAR ${sar(inv.total)}`, true)}
  </table>
  <p style="margin-top:20px"><a href="${billingUrl}" style="display:inline-block;background:#1f5135;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">View and print the invoice</a></p>
  <p style="color:#666;font-size:13px">The printable invoice with its ZATCA QR code is under Billing → Payment history.</p></div>`;
}

/** Owner email addresses of a business. */
export async function ownerEmails(db: Db, tenantId: string): Promise<string[]> {
  const { data: roles } = await db.from("user_tenant_roles").select("user_id").eq("tenant_id", tenantId).eq("role", "owner");
  const out: string[] = [];
  for (const r of roles ?? []) {
    const { data } = await db.auth.admin.getUserById(r.user_id);
    if (data?.user?.email) out.push(data.user.email);
  }
  return out;
}

/**
 * Email the tax invoice for a paid payment to the business's owners (or `to`). The same
 * invoice is sent once per address unless `resend` is set (SuperAdmin "Resend invoice").
 * Never throws: a failed email must not undo or block a payment.
 */
export async function emailSubscriptionInvoice(db: Db, paymentId: string, opts: { to?: string[]; resend?: boolean } = {}) {
  try {
    const inv = await buildSubscriptionInvoice(db, paymentId);
    if (!inv) return { sent: 0, recipients: [] as string[] };
    const recipients = opts.to?.length ? opts.to : await ownerEmails(db, inv.tenant_id);
    const billingUrl = `${(env("SITE_URL") ?? "https://matbex.com").replace(/\/$/, "")}/billing`;
    let sent = 0;
    for (const to of recipients) {
      const r = await sendEmail({
        to,
        subject: `Matbex tax invoice ${inv.invoice_number}`,
        html: invoiceEmailHtml(inv, billingUrl),
        template: "subscription-invoice",
        idempotencyKey: opts.resend ? undefined : `subscription-invoice-${inv.invoice_number}-${to}`,
        metadata: { tenant_id: inv.tenant_id, payment_id: inv.payment_id, invoice_number: inv.invoice_number },
      }).catch(() => ({ sent: false }));
      if (r.sent) sent++;
    }
    return { sent, recipients };
  } catch (e) {
    console.error("[subscription-invoice] email failed", e);
    return { sent: 0, recipients: [] as string[] };
  }
}
