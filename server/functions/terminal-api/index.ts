import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
// Standalone Terminal API for Android / native POS terminals.
// Auth: X-Terminal-Key (device key) + Authorization: Bearer <cashier JWT>.
// Pairing endpoint /pair is the only one that doesn't require X-Terminal-Key.
import { createClient } from "@matbex/client";

import { buildCorsHeaders } from "../_shared/cors.ts";

// Request-scoped CORS headers. Assigned at the top of every request so the
// module-level response helpers below can spread them without a ReferenceError.
let corsHeaders: Record<string, string> = buildCorsHeaders(new Request("https://matbex.com"));
import { withMetrics } from "../_shared/metrics.ts";
import { assertVersion, recordVersion, type VersionEnvelope } from "./versionGuard.ts";
const API_URL = env("API_URL")!;
const SERVICE_ROLE = env("SERVICE_ROLE_KEY")!;
const ANON_KEY = env("ANON_KEY")!;

const admin = createClient(API_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const API_VERSION = "1";

function ok(data: unknown, status = 200) {
  return new Response(
    JSON.stringify({ api_version: API_VERSION, data }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
function err(message: string, status = 400, code = "bad_request") {
  return new Response(
    JSON.stringify({ api_version: API_VERSION, error: { code, message } }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

function versionErr(check: {
  status: number;
  code: string;
  message: string;
  serverVersion: number | null;
  serverChecksum: string | null;
  clientVersion: number | null;
}) {
  return new Response(
    JSON.stringify({
      api_version: API_VERSION,
      error: {
        code: check.code,
        message: check.message,
        server_version: check.serverVersion,
        server_checksum: check.serverChecksum,
        client_version: check.clientVersion,
      },
    }),
    { status: check.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

function extractVersion(body: any): VersionEnvelope {
  return {
    version: body?._version ?? body?.version,
    checksum: body?._checksum ?? body?.checksum,
    entity_id: body?._entity_id,
  };
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function genDeviceKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  // url-safe base64
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface TerminalCtx {
  terminalId: string;
  restaurantId: string;
  cashierId: string;
  branchId: string | null;
  /** Where branchId came from: the cashier's pinned branch, the terminal, or the primary branch. */
  branchSource: "user" | "terminal" | "primary" | "none";
  cashierClient: ReturnType<typeof createClient>;
}

async function authenticate(req: Request): Promise<TerminalCtx | Response> {
  const deviceKey = req.headers.get("x-terminal-key");
  const auth = req.headers.get("authorization");
  if (!deviceKey) return err("Missing X-Terminal-Key header", 401, "no_terminal_key");
  if (!auth?.startsWith("Bearer ")) return err("Missing cashier Bearer token", 401, "no_cashier_token");

  const { data: termRows, error: termErr } = await admin.rpc("verify_terminal_key", { _key: deviceKey });
  if (termErr) return err(termErr.message, 500, "terminal_lookup_failed");
  const term = (termRows as Array<{ terminal_id: string; restaurant_id: string; active: boolean }>)?.[0];
  if (!term) return err("Unknown terminal key", 401, "invalid_terminal_key");
  if (!term.active) return err("Terminal has been revoked", 403, "terminal_revoked");

  // Cashier-scoped client (RLS enforced via the cashier's JWT).
  const cashierClient = createClient(API_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: u, error: uErr } = await cashierClient.auth.getUser();
  if (uErr || !u?.user) return err("Invalid cashier token", 401, "invalid_cashier_token");

  // Verify cashier belongs to this restaurant.
  const { data: roleRow } = await admin
    .from("user_tenant_roles")
    .select("user_id, restaurant_id, role")
    .eq("user_id", u.user.id)
    .eq("restaurant_id", term.restaurant_id)
    .limit(1)
    .maybeSingle();
  if (!roleRow) return err("Cashier does not belong to this terminal's restaurant", 403, "cashier_not_in_tenant");

  // Heartbeat
  await admin
    .from("pos_terminals")
    .update({
      last_seen_at: new Date().toISOString(),
      app_version: req.headers.get("x-app-version") ?? undefined,
      platform: req.headers.get("x-platform") ?? undefined,
    })
    .eq("id", term.terminal_id);

  const { data: terminalBranch } = await admin
    .from("pos_terminals")
    .select("branch_id")
    .eq("id", term.terminal_id)
    .maybeSingle();

  // Branch resolution order (prices, VAT and sales tagging all follow this):
  //   1. the branch the signed-in cashier is pinned to (staff.assigned_branch_id)
  //   2. the branch this terminal is pinned to
  //   3. the restaurant's primary branch
  let branchId: string | null = null;
  let branchSource: "user" | "terminal" | "primary" | "none" = "none";

  const { data: staffRow } = await admin
    .from("staff")
    .select("assigned_branch_id")
    .eq("user_id", u.user.id)
    .eq("restaurant_id", term.restaurant_id)
    .eq("is_active", true)
    .not("assigned_branch_id", "is", null)
    .limit(1)
    .maybeSingle();

  if (staffRow?.assigned_branch_id) {
    branchId = staffRow.assigned_branch_id as string;
    branchSource = "user";
  } else if (terminalBranch?.branch_id) {
    branchId = terminalBranch.branch_id as string;
    branchSource = "terminal";
  } else {
    const { data: primary } = await admin
      .from("branches")
      .select("id")
      .eq("restaurant_id", term.restaurant_id)
      .eq("is_active", true)
      .eq("is_primary", true)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (primary?.id) {
      branchId = primary.id as string;
      branchSource = "primary";
    }
  }

  return {
    terminalId: term.terminal_id,
    restaurantId: term.restaurant_id,
    cashierId: u.user.id,
    branchId,
    branchSource,
    cashierClient,
  };
}

async function checkIdempotency(terminalId: string, key: string | null) {
  if (!key) return null;
  const { data } = await admin
    .from("pos_terminal_audit")
    .select("response_snapshot, status_code")
    .eq("terminal_id", terminalId)
    .eq("idempotency_key", key)
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

async function recordAudit(opts: {
  terminalId: string | null;
  restaurantId: string | null;
  cashierId: string | null;
  endpoint: string;
  method: string;
  status: number;
  idempotencyKey: string | null;
  latencyMs: number;
  snapshot?: unknown;
  error?: string;
  requestId?: string | null;
}) {
  await admin.from("pos_terminal_audit").insert({
    terminal_id: opts.terminalId,
    restaurant_id: opts.restaurantId,
    cashier_id: opts.cashierId,
    endpoint: opts.endpoint,
    method: opts.method,
    status_code: opts.status,
    idempotency_key: opts.idempotencyKey,
    latency_ms: opts.latencyMs,
    request_id: opts.requestId ?? null,
    response_snapshot: opts.snapshot ? JSON.parse(JSON.stringify(opts.snapshot).slice(0, 8000)) : null,
    error: opts.error ?? null,
  });
}

// ----------------- Route handlers -----------------

/** POST /pair  body: { code, name, branch_label?, platform?, app_version? } */
async function handlePair(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { code, name, branch_label, platform, app_version } = body ?? {};
  if (!code || typeof code !== "string") return err("Missing pairing code");

  const { data: pair } = await admin
    .from("pos_terminal_pairing_codes")
    .select("*")
    .eq("code", code)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .limit(1)
    .maybeSingle();
  if (!pair) return err("Invalid or expired pairing code", 401, "invalid_code");

  const deviceKey = genDeviceKey();
  const keyHash = await sha256Hex(deviceKey);
  const keyPrefix = deviceKey.slice(0, 8);

  const { data: term, error: insErr } = await admin
    .from("pos_terminals")
    .insert({
      restaurant_id: pair.restaurant_id,
      terminal_uid: crypto.randomUUID(),
      name: (name as string)?.trim() || pair.default_name || "Android terminal",
      branch_label: (branch_label as string)?.trim() || pair.default_branch_label || null,
      registered_by: pair.created_by,
      active: true,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      paired_at: new Date().toISOString(),
      platform: platform ?? null,
      app_version: app_version ?? null,
      last_seen_at: new Date().toISOString(),
    })
    .select("id, restaurant_id, name, branch_label")
    .single();
  if (insErr) return err(insErr.message, 500, "pair_failed");

  await admin
    .from("pos_terminal_pairing_codes")
    .update({ consumed_at: new Date().toISOString(), consumed_terminal_id: term.id })
    .eq("id", pair.id);

  // device_key returned ONCE - never stored in plaintext server-side.
  return ok({
    terminal_id: term.id,
    restaurant_id: term.restaurant_id,
    name: term.name,
    branch_label: term.branch_label,
    device_key: deviceKey,
  });
}

/**
 * Restaurant-local calendar day (not UTC). Effective-dated branch prices are
 * stored as local dates, so using the UTC day would serve yesterday's prices
 * after 21:00 UTC in Asia/Riyadh (UTC+3).
 */
async function restaurantToday(restaurantId: string): Promise<string> {
  let tz = "Asia/Riyadh";
  try {
    const { data } = await admin
      .from("restaurants")
      .select("timezone")
      .eq("id", restaurantId)
      .maybeSingle();
    if ((data as any)?.timezone) tz = String((data as any).timezone);
  } catch { /* fall back to Asia/Riyadh */ }
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * Current menu-price version for a terminal's branch. Terminals poll this
 * cheap endpoint (or receive the realtime push) and only refetch /menu when
 * the version or the restaurant-local effective date changed.
 */
async function menuPriceVersion(
  restaurantId: string,
  branchId: string | null,
): Promise<number> {
  const { data } = await admin
    .from("pos_entity_versions")
    .select("version")
    .eq("restaurant_id", restaurantId)
    .eq("entity_type", "menu_prices")
    .eq("entity_id", branchId ?? "tenant")
    .maybeSingle();
  return data ? Number((data as any).version) : 0;
}

/** GET /menu/version */
async function handleMenuVersion(ctx: TerminalCtx) {
  const [version, effective_date] = await Promise.all([
    menuPriceVersion(ctx.restaurantId, ctx.branchId ?? null),
    restaurantToday(ctx.restaurantId),
  ]);
  return ok({ menu_version: version, effective_date, branch_id: ctx.branchId ?? null });
}

/** GET /menu */
async function handleMenu(ctx: TerminalCtx) {
  const { data, error } = await ctx.cashierClient
    .from("menu_items")
    .select("id, name, category, selling_price, half_price, full_price, quarter_price, image_url, is_active, is_chefs_special, is_market_price, description, allergens, dietary_tags")
    .eq("restaurant_id", ctx.restaurantId)
    .eq("is_active", true)
    .order("category")
    .order("name");
  if (error) return err(error.message, 500);
  let items = data ?? [];

  // Apply this terminal's branch price overrides (effective-dated).
  // Without this the device would keep serving tenant-wide base prices.
  if (ctx.branchId) {
    const today = await restaurantToday(ctx.restaurantId);
    const { data: overrides } = await admin.rpc("get_branch_menu_prices", {
      _branch_id: ctx.branchId,
      _at: today,
    });
    const map = new Map<string, any>();
    ((overrides as any[]) ?? []).forEach((o) => map.set(o.menu_item_id, o));
    if (map.size) {
      items = items.map((it: any) => {
        const o = map.get(it.id);
        if (!o) return it;
        const full = o.full_price != null ? Number(o.full_price) : it.full_price;
        return {
          ...it,
          quarter_price: o.quarter_price != null ? Number(o.quarter_price) : it.quarter_price,
          half_price: o.half_price != null ? Number(o.half_price) : it.half_price,
          full_price: full,
          selling_price: o.full_price != null ? Number(o.full_price) : it.selling_price,
        };
      });
    }
  }

  const branch = await resolveBranchInfo(ctx);
  const today = await restaurantToday(ctx.restaurantId);
  const menuVersion = await menuPriceVersion(ctx.restaurantId, branch.id);

  return ok({
    items,
    branch_id: branch.id,
    branch_name: branch.name,
    branch_source: ctx.branchSource,
    // Sync markers: the terminal stores these and refetches whenever either
    // one changes, so effective-dated price changes land automatically.
    menu_version: menuVersion,
    effective_date: today,
    // VAT rate belongs to the SAME resolved branch the prices came from,
    // so the terminal never mixes one branch's prices with another's VAT.
    vat_rate: branch.vatRate,
    // Pricing mode drives whether the terminal adds VAT on top of the listed
    // price or backs it out of it.
    prices_vat_inclusive: branch.pricesInclusive,
  });
}

/**
 * Single source of truth for the branch a terminal request is scoped to:
 * returns the resolved branch id, display name and VAT percentage.
 * Used by both /menu (pricing) and /sales (VAT math) so they can never diverge.
 */
async function resolveBranchInfo(
  ctx: TerminalCtx,
): Promise<{
  id: string | null;
  name: string | null;
  vatRate: number;
  pricesInclusive: boolean;
}> {
  if (!ctx.branchId)
    return { id: null, name: null, vatRate: 15, pricesInclusive: true };
  const { data: b } = await admin
    .from("branches")
    .select("id, name, vat_rate, prices_vat_inclusive")
    .eq("id", ctx.branchId)
    .maybeSingle();
  return {
    id: ctx.branchId,
    name: (b?.name as string) ?? null,
    vatRate: b?.vat_rate == null ? 15 : Number(b.vat_rate),
    pricesInclusive: (b as any)?.prices_vat_inclusive !== false,
  };
}

/** GET /customers?q= */
async function handleCustomers(ctx: TerminalCtx, url: URL) {
  const q = (url.searchParams.get("q") ?? "").trim();
  // Scope to the terminal's resolved branch so a Wadi tablet never sees
  // Main-branch customers. Untagged legacy rows stay visible.
  const branch = await resolveBranchInfo(ctx);
  let qb = ctx.cashierClient
    .from("customers")
    .select("id, name, phone, email, current_balance, credit_limit, credit_status")
    .eq("restaurant_id", ctx.restaurantId)
    .order("name")
    .limit(50);
  if (branch.id) qb = qb.or(`branch_id.eq.${branch.id},branch_id.is.null`);
  if (q) qb = qb.or(`name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`);
  const { data, error } = await qb;
  if (error) return err(error.message, 500);
  return ok({ customers: data });
}

/** GET /shifts/current */
async function handleCurrentShift(ctx: TerminalCtx) {
  const { data, error } = await ctx.cashierClient
    .from("shifts")
    .select("*")
    .eq("restaurant_id", ctx.restaurantId)
    .eq("status", "open")
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return err(error.message, 500);
  return ok({ shift: data });
}

/** POST /shifts/open  body: { opening_float, drawer_id?, notes? } */
async function handleOpenShift(ctx: TerminalCtx, body: any) {
  const env = extractVersion(body);
  const { data, error } = await ctx.cashierClient
    .from("shifts")
    .insert({
      restaurant_id: ctx.restaurantId,
      cashier_user_id: ctx.cashierId,
      drawer_id: body.drawer_id ?? null,
      status: "open",
      opening_float: Number(body.opening_float ?? 0),
      notes: body.notes ?? null,
      opened_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error) return err(error.message, 500);
  await recordVersion(admin, {
    restaurantId: ctx.restaurantId,
    entityType: "shift",
    entityId: String(data.id),
    version: Number(env.version ?? 0),
    checksum: env.checksum ?? null,
    terminalId: ctx.terminalId,
  });
  return ok({ shift: data }, 201);
}

/** POST /shifts/close  body: { shift_id, counted_cash, counted_card?, deposit_amount?, notes? } */
async function handleCloseShift(ctx: TerminalCtx, body: any) {
  if (!body.shift_id) return err("shift_id required");
  const env = extractVersion(body);
  const check = await assertVersion(admin, {
    restaurantId: ctx.restaurantId,
    entityType: "shift",
    entityId: String(body.shift_id),
    envelope: env,
  });
  if (!check.ok) return versionErr(check);
  const { data, error } = await ctx.cashierClient
    .from("shifts")
    .update({
      status: "closed",
      counted_cash: Number(body.counted_cash ?? 0),
      counted_card: body.counted_card != null ? Number(body.counted_card) : null,
      deposit_amount: body.deposit_amount != null ? Number(body.deposit_amount) : null,
      notes: body.notes ?? null,
      closed_at: new Date().toISOString(),
    })
    .eq("id", body.shift_id)
    .eq("restaurant_id", ctx.restaurantId)
    .select("*")
    .single();
  if (error) return err(error.message, 500);
  await recordVersion(admin, {
    restaurantId: ctx.restaurantId,
    entityType: "shift",
    entityId: String(body.shift_id),
    version: check.version,
    checksum: check.checksum,
    terminalId: ctx.terminalId,
  });
  return ok({ shift: data });
}

/** POST /shifts/cash-event body:{shift_id,event_type,amount,payment_method?,description?} */
async function handleCashEvent(ctx: TerminalCtx, body: any) {
  if (!body.shift_id || !body.event_type || body.amount == null) {
    return err("shift_id, event_type, amount required");
  }
  const env = extractVersion(body);
  const { data, error } = await ctx.cashierClient
    .from("cash_events")
    .insert({
      restaurant_id: ctx.restaurantId,
      shift_id: body.shift_id,
      event_type: body.event_type,
      amount: Number(body.amount),
      payment_method: body.payment_method ?? "cash",
      description: body.description ?? null,
      created_by: ctx.cashierId,
    })
    .select("*")
    .single();
  if (error) return err(error.message, 500);
  await recordVersion(admin, {
    restaurantId: ctx.restaurantId,
    entityType: "cash_event",
    entityId: String(data.id),
    version: Number(env.version ?? 0),
    checksum: env.checksum ?? null,
    terminalId: ctx.terminalId,
  });
  return ok({ cash_event: data }, 201);
}

/** POST /sales body:{ items:[{menu_item_id,quantity,unit_price}], payment_method, shift_id?, customer_id?, is_unpaid?, notes? } */
async function handleSale(ctx: TerminalCtx, body: any) {
  if (!Array.isArray(body.items) || body.items.length === 0) return err("items required");
  if (!body.payment_method) return err("payment_method required");
  const env = extractVersion(body);

  // If client supplied a client-side entity id, check monotonicity BEFORE insert
  // so duplicate/stale retries don't create a second sales row.
  if (env.entity_id) {
    const pre = await assertVersion(admin, {
      restaurantId: ctx.restaurantId,
      entityType: "sale",
      entityId: String(env.entity_id),
      envelope: env,
    });
    if (!pre.ok) return versionErr(pre);
  }

  const subtotal = body.items.reduce(
    (s: number, i: any) => s + Number(i.unit_price) * Number(i.quantity),
    0,
  );
  const listedTotal = Math.round(subtotal * 100) / 100;
  // Same resolved branch as /menu → prices and VAT always agree.
  const branch = await resolveBranchInfo(ctx);
  const vatPercent = branch.vatRate;
  const rate = vatPercent / 100;
  // Inclusive: listed total is the gross. Exclusive: VAT is added on top.
  const net = branch.pricesInclusive
    ? Math.round((listedTotal / (1 + rate)) * 100) / 100
    : listedTotal;
  const total = branch.pricesInclusive
    ? listedTotal
    : Math.round(listedTotal * (1 + rate) * 100) / 100;
  const tax = Math.round((total - net) * 100) / 100;
  const isUnpaid = !!body.is_unpaid;

  // Generate a receipt number using DB sequence pattern fallback (timestamp).
  const receiptNumber = `T-${Date.now().toString(36).toUpperCase()}`;

  const { data: tx, error: txErr } = await ctx.cashierClient
    .from("sales_transactions")
    .insert({
      restaurant_id: ctx.restaurantId,
      shift_id: body.shift_id ?? null,
      payment_method: body.payment_method,
      subtotal: net,
      tax,
      total,
      receipt_number: receiptNumber,
      customer_id: body.customer_id ?? null,
      branch_id: branch.id,
      settlement_status: isUnpaid ? "unpaid" : "paid",
      paid_amount: isUnpaid ? 0 : total,
    })
    .select("*")
    .single();
  if (txErr) return err(txErr.message, 500, "sale_failed");

  // Insert sale items if the table exists
  const lineItems = body.items.map((i: any) => ({
    sales_transaction_id: tx.id,
    menu_item_id: i.menu_item_id,
    quantity: Number(i.quantity),
    unit_price: Number(i.unit_price),
    total_price: Number(i.unit_price) * Number(i.quantity),
  }));
  await ctx.cashierClient.from("sales_transaction_items").insert(lineItems);

  await recordVersion(admin, {
    restaurantId: ctx.restaurantId,
    entityType: "sale",
    entityId: String(env.entity_id ?? tx.id),
    version: Number(env.version ?? 0),
    checksum: env.checksum ?? null,
    terminalId: ctx.terminalId,
  });

  return ok(
    {
      sale: tx,
      receipt_number: receiptNumber,
      branch_id: branch.id,
      branch_name: branch.name,
      branch_source: ctx.branchSource,
      vat_rate: vatPercent,
      prices_vat_inclusive: branch.pricesInclusive,
      // Receipt-ready breakdown
      totals: { net, vat: tax, gross: total },
    },
    201,
  );
}

/** POST /sales/:id/void  body: { reason? } */
async function handleVoidSale(ctx: TerminalCtx, id: string, body: any) {
  const env = extractVersion(body);
  const check = await assertVersion(admin, {
    restaurantId: ctx.restaurantId,
    entityType: "sale",
    entityId: String(id),
    envelope: env,
  });
  if (!check.ok) return versionErr(check);
  // Use ledger-safe update; trigger logic in DB will handle reversal entries.
  const { data, error } = await ctx.cashierClient
    .from("sales_transactions")
    .update({ settlement_status: "void" as any, paid_amount: 0, total: 0 })
    .eq("id", id)
    .eq("restaurant_id", ctx.restaurantId)
    .select("*")
    .single();
  if (error) return err(error.message, 500);
  await recordVersion(admin, {
    restaurantId: ctx.restaurantId,
    entityType: "sale",
    entityId: String(id),
    version: check.version,
    checksum: check.checksum,
    terminalId: ctx.terminalId,
  });
  return ok({ sale: data, reason: body?.reason ?? null });
}

/** GET /sales/today */
async function handleSalesToday(ctx: TerminalCtx) {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const { data, error } = await ctx.cashierClient
    .from("sales_transactions")
    .select("id, receipt_number, total, paid_amount, payment_method, settlement_status, created_at, customer_id")
    .eq("restaurant_id", ctx.restaurantId)
    .gte("created_at", dayStart.toISOString())
    .order("created_at", { ascending: false });
  if (error) return err(error.message, 500);
  return ok({ sales: data });
}

/** POST /settlements body:{ customer_id, amount, payment_method, notes? } */
async function handleSettlement(ctx: TerminalCtx, body: any) {
  if (!body.customer_id || body.amount == null) return err("customer_id and amount required");
  const { data, error } = await ctx.cashierClient
    .from("settlement_invoices")
    .insert({
      restaurant_id: ctx.restaurantId,
      customer_id: body.customer_id,
      total_amount: Number(body.amount),
      amount_paid: Number(body.amount),
      status: "paid",
      payment_method: body.payment_method ?? "cash",
      paid_by: ctx.cashierId,
      paid_at: new Date().toISOString(),
      notes: body.notes ?? null,
    })
    .select("*")
    .single();
  if (error) return err(error.message, 500);
  return ok({ settlement: data }, 201);
}

/** GET /health */
async function handleHealth(ctx: TerminalCtx) {
  return ok({
    ok: true,
    terminal_id: ctx.terminalId,
    restaurant_id: ctx.restaurantId,
    server_time: new Date().toISOString(),
  });
}

// ----------------- Router -----------------

serve(withMetrics("terminal-api", async (req) => {
  corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const started = Date.now();
  const url = new URL(req.url);
  // Strip the function prefix so paths look like /menu, /sales etc.
  const path = url.pathname.replace(/^\/terminal-api/, "") || "/";
  const idemKey = req.headers.get("idempotency-key");
  // Stable id for this request: echoed to the client via X-Request-Id and
  // stored on the audit row so support can trace a single call end-to-end.
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const withReqId = (res: Response) => {
    try { res.headers.set("X-Request-Id", requestId); } catch { /* immutable headers */ }
    return res;
  };

  try {
    // Public endpoint
    if (path === "/pair" && req.method === "POST") {
      const res = await handlePair(req);
      await recordAudit({
        terminalId: null, restaurantId: null, cashierId: null,
        endpoint: path, method: req.method, status: res.status,
        idempotencyKey: idemKey, latencyMs: Date.now() - started, requestId,
      });
      return withReqId(res);
    }

    const auth = await authenticate(req);
    if (auth instanceof Response) return auth;

    // Idempotency replay
    if (idemKey && req.method !== "GET") {
      const replay = await checkIdempotency(auth.terminalId, idemKey);
      if (replay) {
        return withReqId(new Response(JSON.stringify({ api_version: API_VERSION, data: replay.response_snapshot, replayed: true }), {
          status: replay.status_code ?? 200,
          headers: { ...corsHeaders, "Content-Type": "application/json", "X-Request-Id": requestId },
        }));
      }
    }

    let response: Response;
    const body = req.method === "GET" ? {} : await req.json().catch(() => ({}));
    const saleVoidMatch = path.match(/^\/sales\/([^/]+)\/void$/);

    if (path === "/menu" && req.method === "GET") response = await handleMenu(auth);
    else if (path === "/menu/version" && req.method === "GET") response = await handleMenuVersion(auth);
    else if (path === "/customers" && req.method === "GET") response = await handleCustomers(auth, url);
    else if (path === "/shifts/current" && req.method === "GET") response = await handleCurrentShift(auth);
    else if (path === "/shifts/open" && req.method === "POST") response = await handleOpenShift(auth, body);
    else if (path === "/shifts/close" && req.method === "POST") response = await handleCloseShift(auth, body);
    else if (path === "/shifts/cash-event" && req.method === "POST") response = await handleCashEvent(auth, body);
    else if (path === "/sales" && req.method === "POST") response = await handleSale(auth, body);
    else if (saleVoidMatch && req.method === "POST") response = await handleVoidSale(auth, saleVoidMatch[1], body);
    else if (path === "/sales/today" && req.method === "GET") response = await handleSalesToday(auth);
    else if (path === "/settlements" && req.method === "POST") response = await handleSettlement(auth, body);
    else if (path === "/health" && req.method === "GET") response = await handleHealth(auth);
    else response = err(`No route ${req.method} ${path}`, 404, "not_found");

    // Audit (capture snapshot of small responses for idempotency replay)
    let snapshot: unknown = null;
    // Always snapshot /menu so the branch-resolution troubleshooting panel can
    // show which branch/VAT was actually served for each fetch.
    if ((idemKey || path === "/menu") && response.status < 500) {
      try { snapshot = await response.clone().json(); } catch { snapshot = null; }
    }
    await recordAudit({
      terminalId: auth.terminalId,
      restaurantId: auth.restaurantId,
      cashierId: auth.cashierId,
      endpoint: path,
      method: req.method,
      status: response.status,
      idempotencyKey: idemKey,
      latencyMs: Date.now() - started,
      requestId,
      snapshot: snapshot && typeof snapshot === "object" && "data" in (snapshot as any) ? (snapshot as any).data : snapshot,
    });
    return withReqId(response);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("terminal-api error", message);
    return withReqId(err(message, 500, "server_error"));
  }
}));