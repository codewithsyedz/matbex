import { serve } from "../_runtime/serve.ts";
// Moyasar payouts (settlements) for the accountant's card settlement clearing: what Moyasar paid
// out to the restaurant's bank, matched against the Moyasar card payments Matbex recorded.
//
// POST { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }   (owners, managers, accountants)
// Uses the business's own Moyasar key (Settings → Payments). Read-only: recording a payout as a
// bank deposit stays the clearing page's post_card_settlement_deposit, with reference MOYASAR-<id>.
//
// Per payout: gross card takings (payments − refunds), Moyasar fees (per-transaction fees + the
// transfer fee, VAT included), net paid to the bank, how many lines match Matbex payments, and
// whether it was already recorded. Also: the Moyasar balance not yet paid out, and Matbex's own
// Moyasar takings for the period, for the comparison.

import { z } from "zod";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { requireUser, userHasTenantRole } from "../_shared/auth.ts";
import { loadTenantCredentials } from "../_shared/payments/registry.ts";
import { serviceClient } from "../_shared/payments/settle.ts";

const Body = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
const BASE = "https://api.moyasar.com/v1";
const MAX_PAGES = 10;
const sar = (halalas: number) => Math.round(Number(halalas || 0)) / 100;
const round2 = (n: number) => Math.round(n * 100) / 100;

interface SettlementLine { payment_id: string; type: string; payment_amount: number; amount: number; fee: number; transacted_at: string }
interface Settlement { id: string; amount: number; fee: number; tax: number; settlement_count: number; currency: string; created_at: string; invoice_url?: string }

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
  if (!parsed.success) return json({ error: "Choose a date range" }, 400);
  const { from, to } = parsed.data;

  const { data: profile } = await auth.db.from("profiles").select("tenant_id").eq("id", auth.userId).maybeSingle();
  const tenantId = profile?.tenant_id as string | undefined;
  if (!tenantId) return json({ error: "No business for this account" }, 403);
  if (!(await userHasTenantRole(auth.db, auth.userId, tenantId, ["owner", "manager", "accountant"]))) {
    return json({ error: "Owners, managers and accountants only" }, 403);
  }

  const key = (await loadTenantCredentials(tenantId, "moyasar")).MOYASAR_SECRET_KEY;
  if (!key) return json({ error: "Moyasar is not set up for this business (Settings → Payments)." }, 409);
  const get = async <T>(path: string): Promise<T> => {
    const r = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Basic ${btoa(`${key}:`)}`, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Moyasar: ${(body as { message?: string }).message ?? `HTTP ${r.status}`}`);
    return body as T;
  };
  const pages = async <T>(path: string, field: string): Promise<{ rows: T[]; truncated: boolean }> => {
    const rows: T[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const sep = path.includes("?") ? "&" : "?";
      const body = await get<Record<string, unknown>>(`${path}${sep}page=${page}`);
      rows.push(...((body[field] as T[]) ?? []));
      const meta = body.meta as { next_page?: number | null } | undefined;
      if (!meta?.next_page) return { rows, truncated: false };
    }
    return { rows, truncated: true };
  };

  try {
    const range = `created[gt]=${encodeURIComponent(`${from}T00:00:00+03:00`)}&created[lt]=${encodeURIComponent(`${to}T23:59:59+03:00`)}`;
    const [{ rows: settlements, truncated }, balance] = await Promise.all([
      pages<Settlement>(`/settlements?${range}`, "settlements"),
      get<{ currency: string; total: number; available: number; transferred: number }>("/balance").catch(() => null),
    ]);

    const db = serviceClient();
    // Matbex's Moyasar charges/refunds of this business (gateway_reference = Moyasar payment id).
    const { data: txns } = await db.from("payment_transactions")
      .select("kind, status, amount, gateway_reference, created_at")
      .eq("tenant_id", tenantId).eq("gateway", "moyasar").eq("status", "success")
      .in("kind", ["charge", "refund"]);
    const known = new Set((txns ?? []).map((t: { gateway_reference: string | null }) => t.gateway_reference).filter(Boolean));
    const inRange = (txns ?? []).filter((t: { created_at: string }) => {
      const d = new Date(t.created_at).toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
      return d >= from && d <= to;
    });
    const matbexCharges = round2(inRange.filter((t: any) => t.kind === "charge").reduce((s: number, t: any) => s + Number(t.amount), 0));
    const matbexRefunds = round2(inRange.filter((t: any) => t.kind === "refund").reduce((s: number, t: any) => s + Math.abs(Number(t.amount)), 0));

    const refs = settlements.map((s) => `MOYASAR-${s.id}`);
    const { data: recorded } = refs.length
      ? await db.from("card_settlement_deposits").select("reference, is_reversed").eq("tenant_id", tenantId).in("reference", refs)
      : { data: [] };
    const recordedRefs = new Set((recorded ?? []).filter((r: any) => !r.is_reversed).map((r: any) => r.reference));

    const payouts = [];
    for (const s of settlements) {
      const { rows: lines } = await pages<SettlementLine>(`/settlements/${encodeURIComponent(s.id)}/lines`, "lines");
      const payments = lines.filter((l) => l.type === "payment" || l.type === "installment");
      const refunds = lines.filter((l) => l.type === "refund");
      const other = lines.filter((l) => !["payment", "installment", "refund"].includes(l.type));
      const gross = round2(sar(payments.reduce((t, l) => t + l.payment_amount, 0)) - sar(refunds.reduce((t, l) => t + Math.abs(l.payment_amount), 0)));
      const txFees = sar(lines.reduce((t, l) => t + (l.fee || 0), 0));
      const net = round2(sar(s.amount) - sar(s.fee));
      const fees = round2(txFees + sar(s.fee));
      const dates = lines.map((l) => l.transacted_at).filter(Boolean).sort();
      payouts.push({
        id: s.id,
        reference: `MOYASAR-${s.id}`,
        date: new Date(s.created_at).toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" }),
        gross,
        fees,
        transfer_fee: sar(s.fee),
        net,
        // gross − fees should equal net; chargebacks and other lines make up any difference.
        other_lines: round2(net - (gross - fees)),
        other_types: [...new Set(other.map((l) => l.type))],
        transactions: lines.length,
        matched: lines.filter((l) => known.has(l.payment_id)).length,
        unmatched_payments: payments.filter((l) => !known.has(l.payment_id)).length,
        period_from: dates[0]?.slice(0, 10) ?? null,
        period_to: dates[dates.length - 1]?.slice(0, 10) ?? null,
        recorded: recordedRefs.has(`MOYASAR-${s.id}`),
        invoice_url: s.invoice_url ?? null,
      });
    }

    return json({
      from, to,
      payouts,
      truncated,
      totals: {
        payouts_gross: round2(payouts.reduce((t, p) => t + p.gross, 0)),
        payouts_fees: round2(payouts.reduce((t, p) => t + p.fees, 0)),
        payouts_net: round2(payouts.reduce((t, p) => t + p.net, 0)),
        matbex_charges: matbexCharges,
        matbex_refunds: matbexRefunds,
        matbex_net: round2(matbexCharges - matbexRefunds),
      },
      balance: balance ? { not_paid_out: sar(balance.total - balance.transferred), available: sar(balance.available) } : null,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Could not read Moyasar payouts" }, 424);
  }
});
