import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

import { buildCorsHeaders } from "../_shared/cors.ts";
import { guardCronCaller } from "../_shared/cronGuard.ts";
const GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";
const APP_URL = "https://www.matbex.com";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const STATUS_CALLBACK_URL = SUPABASE_URL
  ? `${SUPABASE_URL}/functions/v1/twilio-status-webhook`
  : "";

// Mirror src/hooks/useProfitLoss.ts fallbacks
const FALLBACK_FOOD_COST_PCT = 0.28;
const FALLBACK_BEVERAGE_COST_PCT = 0.05;

interface SendBody {
  restaurant_id?: string;
  user_id?: string;
  date?: string; // YYYY-MM-DD (Riyadh local)
  dryRun?: boolean;
  test?: boolean; // when true, send to a single subscription only (current user)
  preview?: boolean; // when true, return message + breakdown without sending or requiring a subscription
  cutoffCheck?: boolean; // when true, resolve a simulated UTC instant to its Riyadh-local day + window + counts
  atUtc?: string; // ISO UTC timestamp to use for cutoffCheck (defaults to now)
}

function ymdRiyadh(d = new Date()): string {
  // Asia/Riyadh is UTC+3 with no DST
  const shifted = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

// Riyadh-local day bounds expressed as UTC ISO strings
function riyadhDayBoundsUTC(ymd: string): { startISO: string; endExclusiveISO: string } {
  const start = new Date(`${ymd}T00:00:00+03:00`);
  const endExclusive = new Date(start);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  return { startISO: start.toISOString(), endExclusiveISO: endExclusive.toISOString() };
}

function fmtSAR(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(n));
}

function pctDelta(curr: number, prev: number): string {
  if (!prev) return curr > 0 ? "▲ new" : "-";
  const d = ((curr - prev) / Math.abs(prev)) * 100;
  const arrow = d >= 0 ? "▲" : "▼";
  return `${arrow} ${Math.abs(d).toFixed(0)}%`;
}

async function fetchDayMetrics(supabase: any, restaurantId: string, ymd: string) {
  const { startISO, endExclusiveISO } = riyadhDayBoundsUTC(ymd);

  const [
    { data: sales },
    { data: expenses },
    { data: shifts },
    { data: cogsSubs },
    { data: overhead },
    { data: staff },
  ] = await Promise.all([
    supabase
      .from("sales_transactions")
      .select("total")
      .eq("restaurant_id", restaurantId)
      .gte("created_at", startISO)
      .lt("created_at", endExclusiveISO),
    supabase
      .from("expenses")
      .select("id, amount, description, expense_date, payment_method, status, category:category_id(name)")
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null)
      .eq("approval_status", "approved")
      .eq("expense_date", ymd),
    supabase
      .from("shifts")
      .select("id, status, opened_at, closed_at, variance, opening_float, counted_cash, expected_cash, variance_explanation, sales_mode, cashier_staff_id, staff:cashier_staff_id(name)")
      .eq("restaurant_id", restaurantId)
      .gte("opened_at", startISO)
      .lt("opened_at", endExclusiveISO),
    supabase
      .from("daily_cogs_submissions")
      .select("cogs, opening_stock_value, purchases_value, closing_stock_value, shift_type, status")
      .eq("restaurant_id", restaurantId)
      .eq("status", "approved")
      .eq("submission_date", ymd),
    supabase
      .from("overhead_allocation")
      .select("name, monthly_amount")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true),
    supabase
      .from("staff")
      .select("monthly_salary, hourly_rate, termination_date, joined_date, is_active")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true),
  ]);

  const netSales = (sales ?? []).reduce((s: number, r: any) => s + Number(r.total ?? 0), 0);
  const salesCount = (sales ?? []).length;

  // COGS - use approved daily submissions when available; fallback to % of sales
  const hasRealCogs = Array.isArray(cogsSubs) && cogsSubs.length > 0;
  const foodCost = hasRealCogs
    ? cogsSubs.reduce((s: number, r: any) => s + Number(r.cogs ?? 0), 0)
    : netSales * FALLBACK_FOOD_COST_PCT;
  const beverageCost = hasRealCogs ? 0 : netSales * FALLBACK_BEVERAGE_COST_PCT;
  const totalCOGS = foodCost + beverageCost;
  const cogsPct = netSales > 0 ? (totalCOGS / netSales) * 100 : 0;

  // Daily-allocated labor (monthly payroll / 30) - matches useProfitLoss
  const staffCount = (staff ?? []).length;
  const monthlyPayroll = (staff ?? []).reduce((s: number, r: any) => {
    const salary = Number(r.monthly_salary) || 0;
    const hourlyEst = (Number(r.hourly_rate) || 0) * 160;
    return s + (salary > 0 ? salary : hourlyEst);
  }, 0);
  const dailyLabor = monthlyPayroll / 30;

  // Daily-allocated overhead
  const monthlyOverhead = (overhead ?? []).reduce(
    (s: number, r: any) => s + Number(r.monthly_amount ?? 0),
    0,
  );
  const dailyOverhead = monthlyOverhead / 30;

  const totalExpenses = (expenses ?? []).reduce(
    (s: number, r: any) => s + Number(r.amount ?? 0),
    0,
  );

  const profit = netSales - totalCOGS - dailyLabor - dailyOverhead - totalExpenses;

  const variance = (shifts ?? []).reduce(
    (s: number, r: any) => s + Number(r.variance ?? 0),
    0,
  );
  const openShifts = (shifts ?? []).filter((s: any) => s.status === "open").length;

  return {
    totalSales: netSales,
    totalCOGS,
    totalExpenses,
    dailyLabor,
    dailyOverhead,
    profit,
    cogsPct,
    variance,
    openShifts,
    isEstimated: !hasRealCogs,
    breakdown: {
      sales: { count: salesCount, total: netSales },
      cogs: {
        source: hasRealCogs ? "stocktake" : "estimate",
        foodCost,
        beverageCost,
        submissions: (cogsSubs ?? []).map((r: any) => ({
          shift_type: r.shift_type,
          opening: Number(r.opening_stock_value ?? 0),
          purchases: Number(r.purchases_value ?? 0),
          closing: Number(r.closing_stock_value ?? 0),
          cogs: Number(r.cogs ?? 0),
        })),
        fallbackFoodPct: FALLBACK_FOOD_COST_PCT,
        fallbackBeveragePct: FALLBACK_BEVERAGE_COST_PCT,
      },
      labor: { staffCount, monthlyPayroll, dailyLabor },
      overhead: {
        items: (overhead ?? []).map((r: any) => ({
          name: r.name,
          monthly: Number(r.monthly_amount ?? 0),
          daily: Number(r.monthly_amount ?? 0) / 30,
        })),
        monthlyOverhead,
        dailyOverhead,
      },
      expenses: {
        items: (expenses ?? []).map((r: any) => ({
          id: r.id,
          description: r.description ?? "(no description)",
          amount: Number(r.amount ?? 0),
          payment_method: r.payment_method ?? null,
          status: r.status ?? null,
          category: r?.category?.name ?? null,
        })),
        total: totalExpenses,
      },
      shifts: {
        total: (shifts ?? []).length,
        open: openShifts,
        variance,
        items: (shifts ?? []).map((s: any) => ({
          id: s.id,
          status: s.status,
          opened_at: s.opened_at,
          closed_at: s.closed_at,
          variance: Number(s.variance ?? 0),
          opening_float: Number(s.opening_float ?? 0),
          counted_cash: s.counted_cash == null ? null : Number(s.counted_cash),
          expected_cash: s.expected_cash == null ? null : Number(s.expected_cash),
          variance_explanation: s.variance_explanation ?? null,
          sales_mode: s.sales_mode ?? null,
          cashier_name: s?.staff?.name ?? null,
        })),
      },
    },
  };
}

function buildMessage(opts: {
  restaurantName: string;
  today: Awaited<ReturnType<typeof fetchDayMetrics>>;
  yesterday: Awaited<ReturnType<typeof fetchDayMetrics>>;
  ymd: string;
  summaryLink?: string;
  shiftsLink?: string;
  template?: string | null;
}) {
  const { restaurantName, today, yesterday, ymd, summaryLink, shiftsLink: shiftsLinkOpt, template } = opts;
  const dateLabel = new Date(ymd + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Riyadh",
  });
  const varianceTxt =
    today.variance === 0
      ? "balanced"
      : `${today.variance > 0 ? "+" : "-"}SAR ${fmtSAR(Math.abs(today.variance))}`;

  const link = summaryLink ?? `${APP_URL}/cockpit/summary/${ymd}`;
  const shiftsLink = shiftsLinkOpt ?? `${APP_URL}/cockpit/summary/${ymd}#shifts`;

  const vars: Record<string, string> = {
    restaurant_name: restaurantName,
    date: dateLabel,
    ymd,
    revenue: `SAR ${fmtSAR(today.totalSales)}`,
    revenue_delta: pctDelta(today.totalSales, yesterday.totalSales),
    cogs: `SAR ${fmtSAR(today.totalCOGS)}`,
    cogs_pct: `${today.cogsPct.toFixed(1)}%`,
    cogs_label: today.isEstimated ? "Est. " : "",
    labor: `SAR ${fmtSAR(today.dailyLabor)}`,
    overhead: `SAR ${fmtSAR(today.dailyOverhead)}`,
    expenses: `SAR ${fmtSAR(today.totalExpenses)}`,
    profit: `SAR ${fmtSAR(today.profit)}`,
    profit_delta: pctDelta(today.profit, yesterday.profit),
    variance: varianceTxt,
    open_shifts: String(today.openShifts),
    shift_status_line:
      today.openShifts > 0
        ? `⚠ ${today.openShifts} shift(s) still open`
        : `✓ All shifts closed`,
    est_note: today.isEstimated
      ? "_COGS estimated - submit today's stocktake for exact figures._"
      : "",
    summary_link: link,
    shifts_link: shiftsLink,
  };

  if (template && template.trim().length > 0) {
    return renderTemplate(template, vars);
  }

  return [
    `*${restaurantName}* - Daily P&L`,
    `_${dateLabel}_`,
    ``,
    `Revenue: SAR ${fmtSAR(today.totalSales)}  ${pctDelta(today.totalSales, yesterday.totalSales)}`,
    `${today.isEstimated ? "Est. " : ""}COGS: SAR ${fmtSAR(today.totalCOGS)} (${today.cogsPct.toFixed(1)}%)`,
    `Labor (allocated): SAR ${fmtSAR(today.dailyLabor)}`,
    `Overhead (allocated): SAR ${fmtSAR(today.dailyOverhead)}`,
    `Other expenses: SAR ${fmtSAR(today.totalExpenses)}`,
    `Net Profit: SAR ${fmtSAR(today.profit)}  ${pctDelta(today.profit, yesterday.profit)}`,
    `Cash variance: ${varianceTxt}`,
    today.openShifts > 0 ? `⚠ ${today.openShifts} shift(s) still open` : `✓ All shifts closed`,
    today.isEstimated ? `\n_COGS estimated - submit today's stocktake for exact figures._` : ``,
    ``,
    `View breakdown → ${link}`,
    `Shifts & cash → ${shiftsLink}`,
    ``,
    `_Matbex · reply STOP to unsubscribe_`,
  ].filter(Boolean).join("\n");
}

/**
 * Minimal mustache-style renderer. Replaces `{{var}}` (whitespace tolerant)
 * with the matching value. Unknown variables render as empty strings so
 * mis-typed placeholders never leak into the outbound message.
 */
function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_m, key) => {
    const v = vars[String(key).toLowerCase()];
    return v == null ? "" : String(v);
  });
}

async function loadTemplate(
  supabase: any,
  restaurantId: string,
  templateKey: string,
  channel = "whatsapp",
): Promise<string | null> {
  const { data } = await supabase
    .from("notification_templates")
    .select("body, enabled")
    .eq("restaurant_id", restaurantId)
    .eq("template_key", templateKey)
    .eq("channel", channel)
    .maybeSingle();
  if (!data || data.enabled === false) return null;
  return data.body as string;
}

/**
 * Checks the per-restaurant master toggle. Defaults to ENABLED when no row
 * exists so existing tenants don't suddenly stop receiving notifications.
 */
async function isChannelEnabled(
  supabase: any,
  restaurantId: string,
  channel: "whatsapp" | "sms",
): Promise<boolean> {
  const { data } = await supabase
    .from("restaurant_notification_channels")
    .select("enabled")
    .eq("restaurant_id", restaurantId)
    .eq("channel", channel)
    .maybeSingle();
  if (!data) return true; // default-on
  return data.enabled !== false;
}

/**
 * Generate a Supabase magic-link that signs the user in on a fresh device
 * and lands them on the cockpit summary for `ymd`. Falls back to the plain
 * URL if anything goes wrong (e.g. user has no email, admin call fails).
 */
async function buildAutoLoginLink(
  supabase: any,
  userId: string,
  ymd: string,
  nextPath?: string,
): Promise<{ link: string; magicGenerated: boolean; error?: string }> {
  const next = nextPath ?? `/cockpit/summary/${ymd}`;
  const fallback = `${APP_URL}${next}`;
  try {
    const { data: userRes, error: userErr } = await supabase.auth.admin.getUserById(userId);
    const email = userRes?.user?.email;
    if (userErr || !email) {
      return { link: fallback, magicGenerated: false, error: userErr?.message ?? "no-email" };
    }
    const redirectTo = `${APP_URL}/auth/callback?next=${encodeURIComponent(next)}`;
    const { data, error } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo },
    });
    if (error) return { link: fallback, magicGenerated: false, error: error.message };
    const action = data?.properties?.action_link;
    return { link: action ?? fallback, magicGenerated: !!action };
  } catch (e) {
    return { link: fallback, magicGenerated: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function sendWhatsApp(toE164: string, body: string): Promise<{ ok: boolean; error?: string; sid?: string }> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");
  const TWILIO_FROM = Deno.env.get("TWILIO_WHATSAPP_FROM") ?? "whatsapp:+14155238886"; // Twilio sandbox default

  if (!LOVABLE_API_KEY || !TWILIO_API_KEY) {
    return { ok: false, error: "Twilio credentials not configured" };
  }

  const params = new URLSearchParams({
    To: `whatsapp:${toE164}`,
    From: TWILIO_FROM,
    Body: body,
  });
  if (STATUS_CALLBACK_URL) {
    params.set("StatusCallback", STATUS_CALLBACK_URL);
  }

  const res = await fetch(`${GATEWAY_URL}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": TWILIO_API_KEY,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: `Twilio ${res.status}: ${data?.message || JSON.stringify(data)}` };
  }
  return { ok: true, sid: data.sid };
}

serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const unauthorized = await guardCronCaller(req, corsHeaders, { allowAnyUser: true });
  if (unauthorized) return unauthorized;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body: SendBody = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const ymd = body.date ?? ymdRiyadh();
    const dryRun = !!body.dryRun;

    // Cutoff check - verify Riyadh-local day boundary handling at a given UTC instant
    if (body.cutoffCheck) {
      if (!body.restaurant_id) {
        return new Response(JSON.stringify({ ok: false, error: "restaurant_id required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const at = body.atUtc ? new Date(body.atUtc) : new Date();
      if (isNaN(at.getTime())) {
        return new Response(JSON.stringify({ ok: false, error: "Invalid atUtc" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const resolvedYmd = ymdRiyadh(at);
      const { startISO, endExclusiveISO } = riyadhDayBoundsUTC(resolvedYmd);

      const [salesRes, expensesRes, shiftsRes] = await Promise.all([
        supabase
          .from("sales_transactions")
          .select("id", { count: "exact", head: true })
          .eq("restaurant_id", body.restaurant_id)
          .gte("created_at", startISO)
          .lt("created_at", endExclusiveISO),
        supabase
          .from("expenses")
          .select("id", { count: "exact", head: true })
          .eq("restaurant_id", body.restaurant_id)
          .is("deleted_at", null)
          .eq("approval_status", "approved")
          .eq("expense_date", resolvedYmd),
        supabase
          .from("shifts")
          .select("id", { count: "exact", head: true })
          .eq("restaurant_id", body.restaurant_id)
          .gte("opened_at", startISO)
          .lt("opened_at", endExclusiveISO),
      ]);

      return new Response(
        JSON.stringify({
          ok: true,
          atUtc: at.toISOString(),
          atRiyadh: new Date(at.getTime() + 3 * 60 * 60 * 1000)
            .toISOString()
            .replace("Z", "+03:00"),
          resolvedYmd,
          window: { startUTC: startISO, endExclusiveUTC: endExclusiveISO },
          counts: {
            sales: salesRes.count ?? 0,
            expenses: expensesRes.count ?? 0,
            shifts: shiftsRes.count ?? 0,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Preview mode - compute message + breakdown for a date without sending or needing a subscription
    if (body.preview) {
      if (!body.restaurant_id) {
        return new Response(JSON.stringify({ ok: false, error: "restaurant_id required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: restaurant } = await supabase
        .from("restaurants")
        .select("name")
        .eq("id", body.restaurant_id)
        .single();
      const restaurantName = restaurant?.name ?? "Your Restaurant";
      const yesterdayYmd = (() => {
        const d = new Date(ymd + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() - 1);
        return d.toISOString().slice(0, 10);
      })();
      const [today, yesterday] = await Promise.all([
        fetchDayMetrics(supabase, body.restaurant_id, ymd),
        fetchDayMetrics(supabase, body.restaurant_id, yesterdayYmd),
      ]);
      // Preview should not leak magic links - always use plain URL.
      const tpl = await loadTemplate(supabase, body.restaurant_id, "daily_summary");
      const message = buildMessage({ restaurantName, today, yesterday, ymd, template: tpl });
      return new Response(
        JSON.stringify({ ok: true, preview: true, ymd, message, today, yesterday, template_used: !!tpl }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Build subscription list
    let query = supabase
      .from("owner_whatsapp_subscriptions")
      .select("id, restaurant_id, user_id, phone_e164, last_sent_ymd, enabled")
      .eq("enabled", true);

    if (body.restaurant_id) query = query.eq("restaurant_id", body.restaurant_id);
    if (body.user_id) query = query.eq("user_id", body.user_id);

    const { data: subs, error: subsErr } = await query;
    if (subsErr) throw subsErr;

    const results: any[] = [];

    for (const sub of subs ?? []) {
      // Idempotency: skip if already sent today (unless test mode)
      if (!body.test && sub.last_sent_ymd === ymd) {
        results.push({ sub: sub.id, skipped: "already-sent-today" });
        continue;
      }

      // Restaurant-level master toggle
      const channelOn = await isChannelEnabled(supabase, sub.restaurant_id, "whatsapp");
      if (!channelOn) {
        results.push({ sub: sub.id, skipped: "channel-disabled" });
        continue;
      }

      const { data: restaurant } = await supabase
        .from("restaurants")
        .select("name, tenant_id, status, suspended_at, paused_until")
        .eq("id", sub.restaurant_id)
        .single();

      // Honour archived / suspended / temporarily-off branches.
      if (
        !restaurant ||
        restaurant.status !== "active" ||
        restaurant.suspended_at ||
        (restaurant.paused_until && new Date(restaurant.paused_until).getTime() > Date.now())
      ) {
        results.push({ sub: sub.id, skipped: "branch-not-emailable" });
        continue;
      }

      const restaurantName = restaurant?.name ?? "Your Restaurant";
      const tenantId = restaurant?.tenant_id ?? null;

      const yesterdayYmd = (() => {
        const d = new Date(ymd + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() - 1);
        return d.toISOString().slice(0, 10);
      })();

      const [today, yesterday] = await Promise.all([
        fetchDayMetrics(supabase, sub.restaurant_id, ymd),
        fetchDayMetrics(supabase, sub.restaurant_id, yesterdayYmd),
      ]);

      const [linkRes, shiftsLinkRes] = await Promise.all([
        buildAutoLoginLink(supabase, sub.user_id, ymd),
        buildAutoLoginLink(supabase, sub.user_id, ymd, `/cockpit/summary/${ymd}#shifts`),
      ]);
      const summaryLink = linkRes.link;
      const shiftsLink = shiftsLinkRes.link;
      const tpl = await loadTemplate(supabase, sub.restaurant_id, "daily_summary");
      const message = buildMessage({ restaurantName, today, yesterday, ymd, summaryLink, shiftsLink, template: tpl });
      const redirectTarget = `/cockpit/summary/${ymd}`;
      const shiftsRedirectTarget = `/cockpit/summary/${ymd}#shifts`;
      const phoneMasked = sub.phone_e164.replace(/.(?=.{4})/g, "•");

      if (dryRun) {
        results.push({ sub: sub.id, dryRun: true, message });
        continue;
      }

      const sendRes = await sendWhatsApp(sub.phone_e164, message);
      if (sendRes.ok) {
        await supabase
          .from("owner_whatsapp_subscriptions")
          .update({ last_sent_at: new Date().toISOString(), last_sent_ymd: ymd })
          .eq("id", sub.id);
      }

      // Audit log: visible to tenant owners and superadmins via existing RLS.
      try {
        await supabase.from("audit_logs").insert({
          tenant_id: tenantId,
          user_id: sub.user_id,
          action: sendRes.ok ? "whatsapp_summary_sent" : "whatsapp_summary_failed",
          entity_type: "whatsapp_summary",
          entity_id: sub.id,
          new_data: {
            ymd,
            restaurant_id: sub.restaurant_id,
            restaurant_name: restaurantName,
            phone_masked: phoneMasked,
            ok: sendRes.ok,
            twilio_sid: sendRes.sid ?? null,
            error: sendRes.error ?? null,
            redirect_target: redirectTarget,
            shifts_redirect_target: shiftsRedirectTarget,
            magic_link_generated: linkRes.magicGenerated,
            magic_link_error: linkRes.error ?? null,
            shifts_magic_link_generated: shiftsLinkRes.magicGenerated,
            shifts_magic_link_error: shiftsLinkRes.error ?? null,
            test: !!body.test,
          },
        });
      } catch (logErr) {
        console.error("audit_logs insert failed", logErr);
      }

      results.push({ sub: sub.id, ...sendRes });
    }

    return new Response(JSON.stringify({ ok: true, count: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});