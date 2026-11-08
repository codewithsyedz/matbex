import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
// =====================================================================
// pos-sync edge function
// ---------------------------------------------------------------------
// Receives a batch of offline POS items (orders, payments, invoices,
// cash drawer events) from the client sync engine and persists them
// safely with idempotency guarantees.
//
// Each batch item carries an Idempotency-Key. If the server has already
// seen that key for this restaurant, it returns the cached response
// instead of re-inserting -> safe retries, no duplicates.
//
// Headers honored on the request:
//   Authorization: Bearer <user JWT>          (required)
//   X-Terminal-Id: <client UUID>              (required)
//   X-Branch-Id:   <restaurant_id>            (required)
//   X-Request-Id:  <client request id>        (optional, echoed back)
//
// Body shape:
//   { items: Array<{ idempotency_key, entity_type, operation, payload, dependency_key? }> }
//
// Response:
//   { results: Array<{ idempotency_key, status, server_id?, error?, duplicated? }> }
// =====================================================================

import { createClient } from "@matbex/client";

import { buildCorsHeaders } from "../_shared/cors.ts";
import { validateBatch, type BatchItem, type EntityType, type Operation } from "./eventSchema.ts";

interface BranchContext {
  vatRate: number | null;
}

interface ItemResult {
  idempotency_key: string;
  status: "ok" | "duplicate" | "failed";
  server_id?: string | null;
  error?: string;
  entity_type: EntityType;
}

const API_URL = env("API_URL")!;
const SERVICE_ROLE_KEY = env("SERVICE_ROLE_KEY")!;
const ANON_KEY = env("ANON_KEY")!;

// Cache of validated shift_id -> branch_id to avoid repeated lookups within a batch.
async function assertShiftBelongsToBranch(
  admin: ReturnType<typeof createClient>,
  shiftId: string,
  branchId: string,
  cache: Record<string, string>,
): Promise<void> {
  if (cache[shiftId]) {
    if (cache[shiftId] !== branchId) {
      throw new Error("shift_id does not belong to this branch");
    }
    return;
  }
  const { data, error } = await admin
    .from("shifts")
    .select("id, restaurant_id")
    .eq("id", shiftId)
    .maybeSingle();
  if (error) throw new Error(`shift lookup failed: ${error.message}`);
  if (!data) throw new Error("shift_id not found");
  if ((data as any).restaurant_id !== branchId) {
    throw new Error("shift_id does not belong to this branch");
  }
  cache[shiftId] = branchId;
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  // Bound to this request's CORS headers — the module-level helper below has
  // no access to them.
  const json = (payload: unknown, status = 200, requestId?: string) =>
    jsonResponse(corsHeaders, payload, status, requestId);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const terminalUid = req.headers.get("X-Terminal-Id") ?? "";
    const branchId = req.headers.get("X-Branch-Id") ?? "";
    const requestId = req.headers.get("X-Request-Id") ?? crypto.randomUUID();

    if (!authHeader || !terminalUid || !branchId) {
      return json({ error: "Missing required headers" }, 400, requestId);
    }

    // 1. Validate caller via user JWT
    const userClient = createClient(API_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "Unauthorized" }, 401, requestId);
    }
    const userId = userData.user.id;

    // 2. Confirm caller has access to this restaurant
    const { data: access, error: accessErr } = await userClient.rpc(
      "can_access_restaurant",
      { _restaurant_id: branchId },
    );
    if (accessErr || access !== true) {
      return json({ error: "Forbidden for this restaurant" }, 403, requestId);
    }

    // 3. Parse + validate body (typed event schema — Epic B2)
    const rawBody = await req.json().catch(() => ({}));
    const parsed = validateBatch(rawBody);
    if (!parsed.ok) {
      return json(
        { error: "invalid_batch", field_errors: parsed.errors },
        400,
        requestId,
      );
    }
    const items = parsed.items;
    if (items.length === 0) {
      return json({ error: "No items in batch" }, 400, requestId);
    }
    if (items.length > 200) {
      return json({ error: "Batch too large (max 200)" }, 413, requestId);
    }

    // 4. Service-role client for privileged inserts (RLS bypass), still scoped per call
    const admin = createClient(API_URL, SERVICE_ROLE_KEY);

    // 5. Touch terminal heartbeat (best-effort)
    // Also: if the terminal exists and has been revoked (active=false),
    // reject the batch up-front so a revoked device cannot sync new sales.
    const { data: existingTerm } = await admin
      .from("pos_terminals")
      .select("id, active")
      .eq("restaurant_id", branchId)
      .eq("terminal_uid", terminalUid)
      .maybeSingle();
    if (existingTerm && existingTerm.active === false) {
      return json({ error: "Terminal has been revoked. Re-register it to continue." }, 403, requestId);
    }
    admin
      .from("pos_terminals")
      .upsert(
        {
          restaurant_id: branchId,
          terminal_uid: terminalUid,
          last_seen_at: new Date().toISOString(),
          user_agent: req.headers.get("User-Agent") ?? null,
        },
        { onConflict: "restaurant_id,terminal_uid", ignoreDuplicates: false },
      )
      .then(() => {});

    // 6. Order items so dependencies sync first: ORDER -> PAYMENT -> INVOICE -> CASH_DRAWER
    const order: Record<EntityType, number> = {
      ORDER: 0,
      PAYMENT: 1,
      INVOICE: 2,
      CASH_DRAWER: 3,
      RETURN: 4,
    };
    items.sort((a, b) => (order[a.entity_type] ?? 99) - (order[b.entity_type] ?? 99));

    // localKey => server id, so PAYMENT/INVOICE items can resolve their parent ORDER
    const localToServer: Record<string, string> = {};
    // shift_id -> branch_id cache for cross-tenant validation
    const shiftBranchCache: Record<string, string> = {};

    const results: ItemResult[] = [];

    // Branch VAT rate is constant for the whole batch — look it up once instead
    // of once per order (one fewer round trip per item).
    const branchCtx: BranchContext = { vatRate: null };

    // Wall-clock budget: return whatever finished instead of letting the
    // gateway kill the request (502/520) and strand the entire batch.
    const startedAt = Date.now();
    const TIME_BUDGET_MS = 40_000;
    let processed = 0;

    for (const item of items) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        console.warn(
          `[pos-sync] time budget reached after ${processed}/${items.length} items`,
        );
        break;
      }
      const result = await processItem({
        admin,
        item,
        userId,
        terminalUid,
        branchId,
        requestId,
        localToServer,
        shiftBranchCache,
        branchCtx,
      });
      results.push(result);
      processed++;
    }

    return json(
      {
        results,
        request_id: requestId,
        partial: processed < items.length,
        remaining: items.length - processed,
      },
      200,
      requestId,
    );
  } catch (err) {
    console.error("[pos-sync] fatal", err);
    return json({ error: (err as Error).message ?? "Internal error" }, 500);
  }
});

function jsonResponse(
  corsHeaders: Record<string, string>,
  payload: unknown,
  status = 200,
  requestId?: string,
) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      ...(requestId ? { "X-Request-Id": requestId } : {}),
    },
  });
}

// ---------------------------------------------------------------------
// Per-item processing (idempotent)
// ---------------------------------------------------------------------
async function processItem(args: {
  admin: ReturnType<typeof createClient>;
  item: BatchItem;
  userId: string;
  terminalUid: string;
  branchId: string;
  requestId: string;
  localToServer: Record<string, string>;
  shiftBranchCache: Record<string, string>;
  branchCtx: BranchContext;
}): Promise<ItemResult> {
  const { admin, item, userId, terminalUid, branchId, requestId, localToServer, shiftBranchCache, branchCtx } = args;

  // 1. Check idempotency cache
  const { data: existing } = await admin
    .from("pos_idempotency_keys")
    .select("response, status")
    .eq("restaurant_id", branchId)
    .eq("idempotency_key", item.idempotency_key)
    .maybeSingle();

  if (existing) {
    const serverId = (existing.response as any)?.server_id ?? null;
    if (serverId) localToServer[item.idempotency_key] = serverId;
    // Count the replay so posting monitors can surface terminals whose acks
    // never landed. Never fail the sync because of monitoring.
    try {
      await admin.rpc("record_idempotency_replay", {
        _restaurant_id: branchId,
        _idempotency_key: item.idempotency_key,
      });
    } catch (e) {
      console.warn("[pos-sync] replay counter failed", (e as Error).message);
    }
    return {
      idempotency_key: item.idempotency_key,
      status: "duplicate",
      server_id: serverId,
      entity_type: item.entity_type,
    };
  }

  // 2. Dispatch by entity type
  try {
    let serverId: string | null = null;
    switch (item.entity_type) {
      case "ORDER":
        serverId = await syncOrder(admin, item, branchId, userId, shiftBranchCache, branchCtx);
        break;
      case "PAYMENT":
        serverId = await syncPayment(admin, item, branchId, userId, localToServer, shiftBranchCache);
        break;
      case "INVOICE":
        // INVOICE is a soft concept here: receipt_number lives on the order itself.
        // We just acknowledge it so the client can mark it synced.
        serverId = await syncInvoice(admin, item, branchId, localToServer);
        break;
      case "CASH_DRAWER":
        serverId = await syncCashDrawer(admin, item, branchId, userId, shiftBranchCache);
        break;
      case "RETURN":
        serverId = await syncReturn(admin, item, branchId, userId, shiftBranchCache);
        break;
      default:
        throw new Error(`Unknown entity_type: ${item.entity_type}`);
    }

    // 3. Record idempotency success
    await admin.from("pos_idempotency_keys").insert({
      restaurant_id: branchId,
      terminal_uid: terminalUid,
      idempotency_key: item.idempotency_key,
      entity_type: item.entity_type,
      request_id: requestId,
      response: { server_id: serverId },
      status: "completed",
    });

    if (serverId) localToServer[item.idempotency_key] = serverId;

    return {
      idempotency_key: item.idempotency_key,
      status: "ok",
      server_id: serverId,
      entity_type: item.entity_type,
    };
  } catch (err) {
    const message = (err as Error).message ?? "unknown error";
    console.error("[pos-sync] item failed", item.idempotency_key, message);
    return {
      idempotency_key: item.idempotency_key,
      status: "failed",
      error: message,
      entity_type: item.entity_type,
    };
  }
}

// ---------------------------------------------------------------------
// Entity-specific writers - kept defensive: only known columns get sent.
// ---------------------------------------------------------------------
async function syncOrder(
  admin: ReturnType<typeof createClient>,
  item: BatchItem,
  branchId: string,
  userId: string,
  shiftBranchCache: Record<string, string>,
  branchCtx: BranchContext,
): Promise<string> {
  const p = item.payload as any;

  // Validate shift_id belongs to this branch before persisting (cross-tenant guard).
  if (p.shift_id) {
    await assertShiftBelongsToBranch(admin, String(p.shift_id), branchId, shiftBranchCache);
  }
  const items = Array.isArray(p.items) ? p.items : [];
  const gross = Math.round(items.reduce(
    (sum: number, it: any) => sum + Number(it.total_price ?? Number(it.unit_price ?? 0) * Number(it.quantity ?? 1)),
    0,
  ) * 100) / 100;
  if (branchCtx.vatRate === null) {
    const { data: branch } = await admin
      .from("branches")
      .select("vat_rate")
      .eq("id", branchId)
      .maybeSingle();
    branchCtx.vatRate = Number(branch?.vat_rate ?? 15);
  }
  const rate = branchCtx.vatRate / 100;
  const net = gross > 0 ? Math.round((gross / (1 + rate)) * 100) / 100 : Number(p.subtotal ?? 0);
  const vat = gross > 0 ? Math.round((gross - net) * 100) / 100 : Number(p.tax ?? 0);
  const txInsert: Record<string, unknown> = {
    restaurant_id: branchId,
    shift_id: p.shift_id ?? null,
    payment_method: p.payment_method ?? "cash",
    subtotal: net,
    tax: vat,
    total: gross || Number(p.total ?? p.subtotal ?? 0),
    receipt_number: p.receipt_number,
    customer_id: p.customer_id ?? null,
    settlement_status: p.settlement_status ?? "paid",
    created_at: p.created_at ?? new Date().toISOString(),
  };

  const { data: tx, error: txErr } = await admin
    .from("sales_transactions")
    .insert(txInsert)
    .select("id")
    .single();
  if (txErr) throw new Error(`order insert: ${txErr.message}`);

  // Items
  if (items.length > 0) {
    const rows = items.map((it: any) => ({
      restaurant_id: branchId,
      transaction_id: tx.id,
      menu_item_id: it.menu_item_id,
      quantity: Number(it.quantity ?? 1),
      unit_price: Number(it.unit_price ?? 0),
      total_price: Number(it.total_price ?? Number(it.unit_price ?? 0) * Number(it.quantity ?? 1)),
    }));
    const { error: itemsErr } = await admin.from("sales_items").insert(rows);
    if (itemsErr) throw new Error(`order items insert: ${itemsErr.message}`);
  }

  return tx.id as string;
}

async function syncPayment(
  admin: ReturnType<typeof createClient>,
  item: BatchItem,
  branchId: string,
  userId: string,
  localToServer: Record<string, string>,
  shiftBranchCache: Record<string, string>,
): Promise<string | null> {
  const p = item.payload as any;
  // Resolve parent order if it was synced earlier in this batch
  const orderServerId =
    (item.dependency_key && localToServer[item.dependency_key]) || p.order_server_id || null;

  // Payments are recorded as cash_events linked to the shift for hybrid POS accounting.
  const shiftId = p.shift_id ?? null;
  if (!shiftId) {
    // No shift -> nothing to record on the cash drawer side. Treat as success.
    return orderServerId;
  }
  await assertShiftBelongsToBranch(admin, String(shiftId), branchId, shiftBranchCache);

  const { data, error } = await admin
    .from("cash_events")
    .insert({
      shift_id: shiftId,
      restaurant_id: branchId,
      event_type: "sale",
      amount: Number(p.amount ?? 0),
      payment_method: p.payment_method ?? "cash",
      created_by: userId,
      description: p.description ?? `Offline POS Sale ${p.receipt_number ?? ""}`.trim(),
    })
    .select("id")
    .single();
  if (error) throw new Error(`payment insert: ${error.message}`);
  return data.id as string;
}

async function syncInvoice(
  _admin: ReturnType<typeof createClient>,
  item: BatchItem,
  _branchId: string,
  localToServer: Record<string, string>,
): Promise<string | null> {
  // The invoice/receipt number is stored on the order row itself, so no separate
  // table write is required. We just resolve & acknowledge so the client clears it.
  const orderServerId =
    (item.dependency_key && localToServer[item.dependency_key]) || null;
  return orderServerId;
}

async function syncCashDrawer(
  admin: ReturnType<typeof createClient>,
  item: BatchItem,
  branchId: string,
  userId: string,
  shiftBranchCache: Record<string, string>,
): Promise<string> {
  const p = item.payload as any;
  if (!p.shift_id) throw new Error("shift_id required for cash drawer event");
  await assertShiftBelongsToBranch(admin, String(p.shift_id), branchId, shiftBranchCache);
  const { data, error } = await admin
    .from("cash_events")
    .insert({
      shift_id: p.shift_id,
      restaurant_id: branchId,
      event_type: p.event_type ?? "drop",
      amount: Number(p.amount ?? 0),
      payment_method: p.payment_method ?? "cash",
      created_by: userId,
      description: p.description ?? "Offline cash drawer event",
    })
    .select("id")
    .single();
  if (error) throw new Error(`cash_event insert: ${error.message}`);
  return data.id as string;
}

/**
 * A refund reverses a sale: it writes a negative sales transaction (so sales
 * reports net out) and, when a shift is open, a matching cash drawer refund
 * event.
 */
async function syncReturn(
  admin: ReturnType<typeof createClient>,
  item: BatchItem,
  branchId: string,
  userId: string,
  shiftBranchCache: Record<string, string>,
): Promise<string> {
  const p = item.payload as any;
  const shiftId = p.shift_id ?? null;
  if (shiftId) await assertShiftBelongsToBranch(admin, String(shiftId), branchId, shiftBranchCache);

  const total = Math.abs(Number(p.total ?? 0));
  const subtotal = Math.abs(Number(p.subtotal ?? 0));
  const tax = Math.abs(Number(p.tax ?? 0));
  if (!(total > 0)) throw new Error("refund total must be greater than zero");

  const { data: tx, error: txErr } = await admin
    .from("sales_transactions")
    .insert({
      restaurant_id: branchId,
      shift_id: shiftId,
      payment_method: p.payment_method ?? "cash",
      subtotal: -subtotal,
      tax: -tax,
      total: -total,
      receipt_number: p.refund_reference,
      settlement_status: "paid",
      created_at: p.created_at ?? new Date().toISOString(),
    })
    .select("id")
    .single();
  if (txErr) throw new Error(`refund insert: ${txErr.message}`);

  if (shiftId) {
    const { error: cashErr } = await admin.from("cash_events").insert({
      shift_id: shiftId,
      restaurant_id: branchId,
      event_type: "refund",
      amount: -total,
      payment_method: p.payment_method ?? "cash",
      created_by: userId,
      description: `Refund ${p.refund_reference ?? ""} for ${p.original_receipt_number ?? "sale"}${p.reason ? ` - ${p.reason}` : ""}`.trim(),
    });
    if (cashErr) throw new Error(`refund cash event: ${cashErr.message}`);
  }

  return tx.id as string;
}
