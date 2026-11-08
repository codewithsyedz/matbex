import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

import { buildCorsHeaders } from "../_shared/cors.ts";
const log = (s: string, d?: unknown) =>
  console.log(`[validate-license] ${s}${d ? " - " + JSON.stringify(d) : ""}`);

const GRACE_DAYS = 3;
const STATUS_STALE_MS = 60 * 60 * 1000; // 1h

type Mode = "active" | "grace" | "limited" | "locked" | "no_seat";

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const terminalId: string | undefined = body.terminal_id;
    const restaurantId: string | undefined = body.restaurant_id;
    const deviceLabel: string | null = body.device_label ?? null;
    const platform: string | null = body.platform ?? null;
    const userAgent: string | null = body.user_agent ?? null;
    const deviceFingerprint: string | null =
      typeof body.device_fingerprint === "string" && body.device_fingerprint.length > 0
        ? String(body.device_fingerprint).slice(0, 128)
        : null;

    if (!terminalId || !restaurantId) {
      return json({ error: "terminal_id and restaurant_id required" }, 400, corsHeaders);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No auth" }, 401, corsHeaders);
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: "Invalid auth" }, 401, corsHeaders);
    const user = userData.user;

    // Resolve tenant_id from restaurant + verify membership
    const { data: rest } = await supabase
      .from("restaurants")
      .select("id, tenant_id")
      .eq("id", restaurantId)
      .maybeSingle();
    if (!rest) return json({ error: "Restaurant not found" }, 404, corsHeaders);
    const tenantId = rest.tenant_id;

    const { data: roleRow } = await supabase
      .from("user_tenant_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!roleRow) {
      // SuperAdmins can validate any tenant (impersonation / platform ops)
      const { data: superAdmin } = await supabase
        .from("superadmin_users")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!superAdmin) return json({ error: "Not a tenant member" }, 403, corsHeaders);
    }

    // Short-circuit: tenants on a free plan, or on a paid plan that has not
    // been wired to a Stripe price (admin-comped / manually assigned plans)
    // should not be gated by Stripe subscription status.
    const { data: tenantRow } = await supabase
      .from("tenants")
      .select("plan_id, plans:plan_id ( id, name, price, stripe_price_id )")
      .eq("id", tenantId)
      .maybeSingle();
    const plan = (tenantRow as any)?.plans ?? null;
    const billingExempt =
      !!plan && (Number(plan.price ?? 0) === 0 || !plan.stripe_price_id);

    // 1. Refresh subscription cache if stale
    let { data: cache } = await supabase
      .from("license_status_cache")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    const cacheAge = cache
      ? Date.now() - new Date(cache.updated_at).getTime()
      : Infinity;

    if (!billingExempt && (!cache || cacheAge > STATUS_STALE_MS)) {
      cache = await refreshFromStripe(supabase, tenantId, user.email ?? "");
    }

    // 2. Compute mode (subscription-wise)
    const subMode: "active" | "grace" | "limited" | "locked" = billingExempt
      ? "active"
      : computeSubMode(cache);

    // 3. Seat claim - fully transactional via SECURITY DEFINER RPC.
    // Resolves the effective seat cap (branch override > plan cap) and then
    // acquires a per-branch advisory lock inside the function so concurrent
    // validate-license calls cannot race the count→insert window and create
    // duplicate device rows.
    const { data: capRow } = await supabase.rpc("get_tenant_device_seat_cap", {
      _tenant_id: tenantId,
    });
    const planCap = typeof capRow === "number" ? capRow : 1;
    const { data: seatsRow } = await supabase
      .from("branch_license_seats")
      .select("seat_count")
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    const effectiveCap = seatsRow?.seat_count ?? planCap;

    const { data: claimRows, error: claimErr } = await supabase.rpc(
      "claim_device_seat",
      {
        _tenant_id: tenantId,
        _restaurant_id: restaurantId,
        _terminal_id: terminalId,
        _device_fingerprint: deviceFingerprint,
        _device_label: deviceLabel,
        _platform: platform,
        _user_agent: userAgent,
        _claimed_by_user_id: user.id,
        _seat_cap: effectiveCap,
      },
    );
    if (claimErr) throw claimErr;
    const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
    if (!claim) throw new Error("claim_device_seat returned no row");

    if (claim.no_seat) {
      const { data: activeDevices } = await supabase
        .from("device_licenses")
        .select("id, device_label, platform, last_seen_at, terminal_id")
        .eq("restaurant_id", restaurantId)
        .is("revoked_at", null)
        .order("last_seen_at", { ascending: false });
      return json({
        mode: "no_seat" as Mode,
        reason: claim.seat_event_detail ?? "Branch device limit reached",
        seat_cap: effectiveCap,
        active_devices: activeDevices ?? [],
        subscription_status: cache?.subscription_status ?? "none",
        grace_ends_at: cache?.grace_ends_at ?? null,
      }, 200, corsHeaders);
    }

    const seat = { id: claim.seat_id as string, terminal_id: claim.seat_terminal_id as string };
    const seatEvent = claim.seat_event as
      | "matched_terminal"
      | "rebound_by_fingerprint"
      | "claimed";
    const seatEventDetail = (claim.seat_event_detail as string | null) ?? null;
    log("seat claim", { restaurantId, seatId: seat.id, event: seatEvent });

    const seatCap = effectiveCap;
    const activeCount = claim.active_count as number;
    const overLimit = activeCount > seatCap;

    return json({
      mode: subMode,
      reason: null,
      seat: { id: seat.id, terminal_id: seat.terminal_id },
      seat_event: seatEvent,
      seat_event_detail: seatEventDetail,
      seat_cap: seatCap,
      active_devices_count: activeCount,
      over_limit: overLimit,
      subscription_status: billingExempt
        ? `comp_${plan?.name ?? "plan"}`
        : cache?.subscription_status ?? "none",
      current_period_end: cache?.current_period_end ?? null,
      grace_ends_at: billingExempt ? null : cache?.grace_ends_at ?? null,
    }, 200, corsHeaders);
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.message
        : typeof e === "object" && e !== null
        ? JSON.stringify(e, Object.getOwnPropertyNames(e))
        : String(e);
    log("ERROR", { msg, raw: e });
    return json({ error: msg }, 500, corsHeaders);
  }
});

function json(obj: unknown, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function computeSubMode(cache: any): "active" | "grace" | "limited" | "locked" {
  if (!cache) return "limited";
  const status = cache.subscription_status as string;
  const now = Date.now();
  if (status === "active" || status === "trialing") return "active";
  if (cache.grace_ends_at) {
    const graceEnd = new Date(cache.grace_ends_at).getTime();
    if (now < graceEnd) return "grace";
    // 30d after grace → locked
    if (now - graceEnd > 30 * 24 * 3600 * 1000) return "locked";
    return "limited";
  }
  return "limited";
}

async function refreshFromStripe(supabase: any, tenantId: string, _email: string) {
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  let status = "none";
  let periodEnd: string | null = null;
  let customerId: string | null = null;

  // Find tenant owner email
  const { data: ownerRole } = await supabase
    .from("user_tenant_roles")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("role", "owner")
    .limit(1)
    .maybeSingle();

  let ownerEmail: string | null = null;
  if (ownerRole?.user_id) {
    const { data: ownerUser } = await supabase.auth.admin.getUserById(ownerRole.user_id);
    ownerEmail = ownerUser?.user?.email ?? null;
  }

  if (stripeKey && ownerEmail) {
    try {
      const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
      const customers = await stripe.customers.list({ email: ownerEmail, limit: 1 });
      if (customers.data.length > 0) {
        customerId = customers.data[0].id;
        const subs = await stripe.subscriptions.list({
          customer: customerId,
          status: "all",
          limit: 1,
        });
        if (subs.data.length > 0) {
          const sub = subs.data[0];
          status = sub.status;
          periodEnd = new Date(sub.current_period_end * 1000).toISOString();
        }
      }
    } catch (e) {
      log("stripe refresh failed", { e: String(e) });
    }
  }

  const graceEndsAt =
    status === "active" || status === "trialing"
      ? null
      : periodEnd
      ? new Date(new Date(periodEnd).getTime() + GRACE_DAYS * 24 * 3600 * 1000).toISOString()
      : new Date(Date.now() + GRACE_DAYS * 24 * 3600 * 1000).toISOString();

  await supabase.from("license_status_cache").upsert({
    tenant_id: tenantId,
    subscription_status: status,
    current_period_end: periodEnd,
    grace_ends_at: graceEndsAt,
    stripe_customer_id: customerId,
    updated_at: new Date().toISOString(),
  });

  return {
    tenant_id: tenantId,
    subscription_status: status,
    current_period_end: periodEnd,
    grace_ends_at: graceEndsAt,
    stripe_customer_id: customerId,
    updated_at: new Date().toISOString(),
  };
}