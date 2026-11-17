import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
// SuperAdmin billing console for Matbex's own subscriptions (two-factor SuperAdmin sessions only).
// POST { action, tenant_id, ... }:
//   overview         plan, paid-until date, provider, every payment with its refunds
//   extend           move the paid-until date (reason required)
//   record_offline   a bank transfer or other offline payment: priced from the plan (or a set
//                    amount), applied through apply_subscription_payment like an online payment,
//                    so it gets a tax invoice and moves the paid-until date; the invoice is emailed
//   refund           refund at Moyasar (online payments) or record an offline refund; issues a
//                    credit note number; can end the paid period now
//   resend_invoice   email the tax invoice to the owners again (resend_credit_note: a credit note)
//   document         invoice (payment_id) or credit note (refund_id) data, to print
// Every change is written to superadmin_audit_log.

import { z } from "zod";
import { createClient } from "@matbex/client";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { requireSuperAdmin } from "../_shared/superadmin.ts";
import { billedQuantity } from "../_shared/branchBillingPlan.ts";
import { moyasarAdapter } from "../_shared/payments/moyasar.ts";
import { platformCredentials } from "../_shared/billing/platformMoyasar.ts";
import { buildCreditNote, buildSubscriptionInvoice, emailCreditNote, emailSubscriptionInvoice } from "../_shared/billing/subscriptionInvoice.ts";
import { MATBEX_VAT_RATE, periodFactor, periodMonths, round2, withVat } from "../_shared/billing/subscriptionQuote.ts";

const Tenant = { tenant_id: z.string().uuid() };
const Body = z.union([
  z.object({ action: z.literal("overview"), ...Tenant }),
  z.object({ action: z.literal("extend"), ...Tenant, period_end: z.string().datetime({ offset: true }), reason: z.string().trim().min(3).max(300) }),
  z.object({
    action: z.literal("record_offline"), ...Tenant,
    plan_id: z.string().uuid(),
    period: z.enum(["month", "year"]),
    branches: z.number().int().min(1).max(500),
    method: z.enum(["bank_transfer", "cash", "other"]),
    reference: z.string().trim().min(2).max(120),
    // Amount excluding VAT; default = plan price × branches × period.
    subtotal: z.number().min(1).max(1_000_000).optional(),
    paid_on: z.string().date().optional(),
    note: z.string().trim().max(300).optional(),
  }),
  z.object({
    action: z.literal("refund"), ...Tenant,
    payment_id: z.string().uuid(),
    amount: z.number().min(0.01).max(1_000_000),
    reason: z.string().trim().min(3).max(300),
    end_period: z.boolean().default(false),
    // Online payments are refunded at Moyasar; true = the money was already returned another way.
    offline: z.boolean().default(false),
  }),
  z.object({ action: z.literal("resend_invoice"), ...Tenant, payment_id: z.string().uuid() }),
  z.object({ action: z.literal("resend_credit_note"), ...Tenant, refund_id: z.string().uuid() }),
  z.object({ action: z.literal("document"), ...Tenant, payment_id: z.string().uuid().optional(), refund_id: z.string().uuid().optional() }),
]);

serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let caller;
  try {
    caller = await requireSuperAdmin(req);
  } catch (e) {
    if (e instanceof Response) return new Response(await e.text(), { status: e.status, headers: { ...cors, "Content-Type": "application/json" } });
    return json({ error: "SuperAdmin access required" }, 403);
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, 400);
  const body = parsed.data;

  const db = createClient(env("API_URL") ?? "", env("SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
  const { data: tenant } = await db.from("tenants")
    .select("id, name, status, billing_provider, current_period_end, trial_ends_at, plan_id, plans:plan_id(id, name, price)")
    .eq("id", body.tenant_id).maybeSingle();
  if (!tenant) return json({ error: "Business not found" }, 404);

  const audit = (action_type: string, summary: string, context: Record<string, unknown>) =>
    db.from("superadmin_audit_log").insert({
      actor_user_id: caller.userId, action_type, target_type: "tenant", target_identifier: tenant.id, summary, context,
    });

  const branchCount = async () => {
    const { data: rest } = await db.from("restaurants").select("id").eq("tenant_id", tenant.id);
    const ids = (rest ?? []).map((r: { id: string }) => r.id);
    if (!ids.length) return 1;
    const { count } = await db.from("branches").select("id", { count: "exact", head: true })
      .in("restaurant_id", ids).is("deleted_at", null).neq("is_active", false);
    return billedQuantity(count ?? 0);
  };

  try {
    if (body.action === "overview") {
      const [{ data: payments }, { data: refunds }, { data: plans }, branches] = await Promise.all([
        db.from("subscription_payments")
          .select("id, kind, mode, method, status, amount, subtotal, vat_amount, refunded_amount, months, branches, invoice_number, moyasar_invoice_id, moyasar_payment_id, reference, note, period_start, period_end, paid_at, created_at, plans:plan_id(name), addons:addon_id(name)")
          .eq("tenant_id", tenant.id).order("created_at", { ascending: false }).limit(100),
        db.from("subscription_refunds").select("id, payment_id, amount, vat_amount, reason, method, moyasar_reference, credit_note_number, ended_period, created_at")
          .eq("tenant_id", tenant.id).order("created_at", { ascending: false }),
        db.from("plans").select("id, name, price").eq("is_active", true).order("price"),
        branchCount(),
      ]);
      const paid = (payments ?? []).filter((p: { status: string }) => p.status === "paid");
      return json({
        tenant: {
          id: tenant.id, name: tenant.name, status: tenant.status, billing_provider: tenant.billing_provider,
          current_period_end: tenant.current_period_end, trial_ends_at: tenant.trial_ends_at,
          plan: (tenant as any).plans ?? null,
        },
        branches,
        vat_rate: MATBEX_VAT_RATE,
        plans: plans ?? [],
        payments: payments ?? [],
        refunds: refunds ?? [],
        totals: {
          paid: round2(paid.reduce((s: number, p: { amount: number }) => s + Number(p.amount), 0)),
          refunded: round2(paid.reduce((s: number, p: { refunded_amount: number }) => s + Number(p.refunded_amount ?? 0), 0)),
        },
        moyasar_ready: !!env("MATBEX_MOYASAR_SECRET_KEY"),
      });
    }

    if (body.action === "extend") {
      const before = tenant.current_period_end;
      const end = new Date(body.period_end);
      const patch: Record<string, unknown> = { current_period_end: end.toISOString(), updated_at: new Date().toISOString() };
      // A date in the future brings a lapsed paid account back; trials are untouched.
      if (end.getTime() > Date.now() && ["past_due", "expired"].includes(String(tenant.status))) patch.status = "active";
      const { error } = await db.from("tenants").update(patch).eq("id", tenant.id);
      if (error) throw new Error(error.message);
      await audit("BILLING_PERIOD_CHANGED", `Paid-until date ${before ? String(before).slice(0, 10) : "none"} → ${end.toISOString().slice(0, 10)}: ${body.reason}`,
        { before, after: end.toISOString(), reason: body.reason, status_before: tenant.status, status_after: patch.status ?? tenant.status });
      return json({ ok: true, current_period_end: end.toISOString(), status: patch.status ?? tenant.status });
    }

    if (body.action === "record_offline") {
      const { data: plan } = await db.from("plans").select("id, name, price").eq("id", body.plan_id).eq("is_active", true).maybeSingle();
      if (!plan) return json({ error: "This plan is not available" }, 400);
      const listed = round2(Number(plan.price) * body.branches * periodFactor(body.period));
      const priced = withVat(body.subtotal ?? listed);
      if (priced.total < 1) return json({ error: "The amount is too small" }, 400);
      const periodEnd = tenant.current_period_end ? new Date(tenant.current_period_end) : null;
      const mode = periodEnd && periodEnd.getTime() > Date.now() ? "renew" : "new";

      const { data: row, error } = await db.from("subscription_payments").insert({
        tenant_id: tenant.id, kind: "plan", mode, plan_id: plan.id, months: periodMonths(body.period), branches: body.branches,
        subtotal: priced.subtotal, vat_rate: MATBEX_VAT_RATE, vat_amount: priced.vat, amount: priced.total,
        method: body.method, reference: body.reference, note: body.note ?? null, created_by: caller.userId,
      }).select("id").single();
      if (error || !row) throw new Error(error?.message ?? "Could not record the payment");
      const { data: applied, error: applyErr } = await db.rpc("apply_subscription_payment", { p_payment_id: row.id, p_moyasar_payment_id: null });
      if (applyErr) {
        await db.from("subscription_payments").update({ status: "failed", note: `Not applied: ${applyErr.message}` }).eq("id", row.id);
        throw new Error(applyErr.message);
      }
      // The paid date is the day the money arrived (the invoice keeps its own issue time).
      if (body.paid_on) await db.from("subscription_payments").update({ paid_at: new Date(`${body.paid_on}T12:00:00+03:00`).toISOString() }).eq("id", row.id);
      const mail = await emailSubscriptionInvoice(db, row.id);
      await audit("BILLING_OFFLINE_PAYMENT", `Recorded ${body.method.replace("_", " ")} of SAR ${priced.total.toFixed(2)} (ref ${body.reference}) for ${plan.name}`,
        { payment_id: row.id, plan: plan.name, period: body.period, branches: body.branches, ...priced, listed_subtotal: listed, reference: body.reference, emailed_to: mail.recipients.length });
      return json({ ok: true, payment_id: row.id, ...priced, period_end: (applied as { period_end?: string })?.period_end ?? null, emailed: mail.sent });
    }

    if (body.action === "refund") {
      const { data: p } = await db.from("subscription_payments")
        .select("id, status, method, amount, refunded_amount, moyasar_invoice_id, invoice_number")
        .eq("id", body.payment_id).eq("tenant_id", tenant.id).maybeSingle();
      if (!p || p.status !== "paid") return json({ error: "Only a paid payment of this business can be refunded" }, 400);
      const left = round2(Number(p.amount) - Number(p.refunded_amount ?? 0));
      const amount = round2(body.amount);
      if (amount > left) return json({ error: `At most SAR ${left.toFixed(2)} is left to refund on this payment` }, 400);

      let moyasarRef: string | null = null;
      const atMoyasar = p.method === "moyasar" && !!p.moyasar_invoice_id && !body.offline;
      if (atMoyasar) {
        const r = await moyasarAdapter.refundPayment(p.moyasar_invoice_id, amount, platformCredentials());
        if (r.status === "failed") return json({ error: "Moyasar did not refund the payment" }, 502);
        moyasarRef = r.refundReference ?? null;
      }
      const { data: rec, error } = await db.rpc("record_subscription_refund", {
        p_payment_id: p.id, p_amount: amount, p_reason: body.reason, p_method: atMoyasar ? "moyasar" : "offline",
        p_moyasar_reference: moyasarRef, p_end_period: body.end_period, p_actor: caller.userId,
      });
      if (error) {
        // Money already went back at Moyasar: keep a trace even though the record failed.
        await audit("BILLING_REFUND_UNRECORDED", `Moyasar refunded SAR ${amount.toFixed(2)} on ${p.invoice_number} but recording failed: ${error.message}`,
          { payment_id: p.id, amount, moyasar_reference: moyasarRef, error: error.message });
        throw new Error(error.message);
      }
      const r = rec as { refund_id: string; credit_note_number: string; vat_amount: number };
      const mail = await emailCreditNote(db, r.refund_id);
      await audit("BILLING_REFUND", `Refunded SAR ${amount.toFixed(2)} of ${p.invoice_number} (${atMoyasar ? "Moyasar" : "offline"}), credit note ${r.credit_note_number}: ${body.reason}`,
        { payment_id: p.id, amount, vat_amount: r.vat_amount, credit_note_number: r.credit_note_number, moyasar_reference: moyasarRef, ended_period: body.end_period, reason: body.reason, emailed_to: mail.recipients.length });
      return json({ ok: true, ...r, moyasar_reference: moyasarRef, emailed: mail.sent });
    }

    if (body.action === "document") {
      const doc = body.refund_id
        ? await buildCreditNote(db, body.refund_id, tenant.id)
        : body.payment_id ? await buildSubscriptionInvoice(db, body.payment_id, tenant.id) : null;
      if (!doc) return json({ error: "Document not found" }, 404);
      return json(doc);
    }

    if (body.action === "resend_credit_note") {
      const note = await buildCreditNote(db, body.refund_id, tenant.id);
      if (!note) return json({ error: "Credit note not found" }, 404);
      const mail = await emailCreditNote(db, body.refund_id, { resend: true });
      await audit("BILLING_CREDIT_NOTE_RESENT", `Resent credit note ${note.credit_note_number} to ${mail.recipients.length} owner(s)`, { refund_id: body.refund_id, sent: mail.sent });
      return json({ ok: true, sent: mail.sent, recipients: mail.recipients });
    }

    // resend_invoice
    const { data: own } = await db.from("subscription_payments").select("invoice_number").eq("id", body.payment_id).eq("tenant_id", tenant.id).maybeSingle();
    if (!own?.invoice_number) return json({ error: "This payment has no invoice" }, 400);
    const mail = await emailSubscriptionInvoice(db, body.payment_id, { resend: true });
    await audit("BILLING_INVOICE_RESENT", `Resent invoice ${own.invoice_number} to ${mail.recipients.length} owner(s)`, { payment_id: body.payment_id, sent: mail.sent });
    return json({ ok: true, sent: mail.sent, recipients: mail.recipients });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Billing action failed" }, 500);
  }
});
