// =====================================================================
// Offline POS service
// ---------------------------------------------------------------------
// Public API the POS UI calls to record an offline sale + payment.
// Always queues to IndexedDB; the sync engine drains it when online.
// =====================================================================

import { put, STORES } from "./db";
import { protectPayload } from "./crypto";
import { generateLocalReceiptNumber, getTerminalId, buildIdempotencyKey } from "./terminal";
import type { OfflineRecord, SyncQueueItem, VersionVector } from "./types";
import { runSync } from "./syncEngine";
import { isOnline } from "./connectivity";
import { requestBackgroundSync } from "./backgroundSync";
import { computeChecksum } from "./checksum";
import { nextLamport } from "./lamport";
import { lineGross, splitListed, sumMoney, VAT_RATE, DEFAULT_PRICES_VAT_INCLUSIVE } from "@/lib/vatInclusive";

/**
 * Build the { version, checksum } pair every new offline row must carry.
 * Extracted so the sync engine and future write paths reuse the exact same
 * canonicalisation rules.
 */
async function stampIntegrity(
  terminalId: string,
  payload: unknown,
): Promise<{ version: VersionVector; checksum: string }> {
  const [lamport, checksum] = await Promise.all([
    nextLamport(),
    computeChecksum(payload),
  ]);
  return { version: { device: terminalId, lamport }, checksum };
}

export interface OfflineCartItem {
  menu_item_id: string;
  name: string;
  quantity: number;
  unit_price: number;
}

export interface RecordOfflineSaleInput {
  branchId: string;
  cashierId: string;
  shiftId: string | null;
  paymentMethod: string;
  customerId?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  isUnpaid?: boolean;
  items: OfflineCartItem[];
  notes?: string;
  vatRate?: number;
  /** Branch pricing mode: true = listed prices already include VAT. */
  pricesVatInclusive?: boolean;
  /** Resolved pricing branch label, printed on the receipt. */
  branchName?: string | null;
}

export interface RecordOfflineSaleResult {
  localOrderId: string;
  receiptNumber: string;
  total: number;
  offline: boolean;
}

export async function recordOfflineSale(
  input: RecordOfflineSaleInput,
): Promise<RecordOfflineSaleResult> {
  const terminalId = await getTerminalId();
  const now = new Date();
  const businessDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const listedTotal = sumMoney(input.items.map((i) => lineGross(i.unit_price, i.quantity)));
  const { net: subtotal, vat: tax, gross: total } = splitListed(
    listedTotal,
    input.vatRate ?? VAT_RATE,
    input.pricesVatInclusive ?? DEFAULT_PRICES_VAT_INCLUSIVE,
  );
  const receiptNumber = await generateLocalReceiptNumber(now);

  const orderLocalId = crypto.randomUUID();
  const paymentLocalId = crypto.randomUUID();
  const invoiceLocalId = crypto.randomUUID();

  const orderPayload = await protectPayload({
    receipt_number: receiptNumber,
    payment_method: input.paymentMethod,
    subtotal,
    tax,
    total,
    customer_id: input.customerId ?? null,
    customer_phone: input.customerPhone ?? null,
    customer_email: input.customerEmail ?? null,
    settlement_status: input.isUnpaid ? "unpaid" : "paid",
    shift_id: input.shiftId,
    notes: input.notes ?? null,
    // Persist the branch + VAT rate that produced these totals so the
    // receipt always shows the same branch the prices were resolved from.
    branch_name: input.branchName ?? null,
    vat_rate: input.vatRate ?? VAT_RATE,
    prices_vat_inclusive: input.pricesVatInclusive ?? DEFAULT_PRICES_VAT_INCLUSIVE,
    created_at: now.toISOString(),
    items: input.items.map((it) => ({
      menu_item_id: it.menu_item_id,
      quantity: it.quantity,
      unit_price: it.unit_price,
      total_price: it.unit_price * it.quantity,
    })),
  });

  const baseRec = (local_id: string): Omit<OfflineRecord, "payload"> => ({
    local_id,
    server_id: null,
    branch_id: input.branchId,
    cashier_id: input.cashierId,
    terminal_id: terminalId,
    business_date: businessDate,
    status: "PENDING",
    retry_count: 0,
    error_message: null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    synced_at: null,
  });

  const orderIntegrity = await stampIntegrity(terminalId, orderPayload);
  const orderRec: OfflineRecord = {
    ...baseRec(orderLocalId),
    payload: orderPayload,
    ...orderIntegrity,
  };
  await put(STORES.orders, orderRec);

  // Payment record (cash drawer event when shift is open)
  const paymentPayload = await protectPayload({
    amount: total,
    payment_method: input.paymentMethod,
    shift_id: input.shiftId,
    receipt_number: receiptNumber,
    description: `Offline POS Sale ${receiptNumber}`,
  });
  const paymentIntegrity = await stampIntegrity(terminalId, paymentPayload);
  await put(STORES.payments, {
    ...baseRec(paymentLocalId),
    payload: paymentPayload,
    ...paymentIntegrity,
  });

  // Invoice (logical record; receipt_number is on the order itself)
  const invoicePayload = {
    receipt_number: receiptNumber,
    total,
    order_local_id: orderLocalId,
  };
  const invoiceIntegrity = await stampIntegrity(terminalId, invoicePayload);
  await put(STORES.invoices, {
    ...baseRec(invoiceLocalId),
    payload: invoicePayload,
    ...invoiceIntegrity,
  });

  // Build sync queue entries with explicit dependencies.
  const orderKey = buildIdempotencyKey(terminalId, "ORDER", orderLocalId);
  const paymentKey = buildIdempotencyKey(terminalId, "PAYMENT", paymentLocalId);
  const invoiceKey = buildIdempotencyKey(terminalId, "INVOICE", invoiceLocalId);

  const queueRow = (
    extra: Pick<SyncQueueItem, "entity_type" | "entity_local_id" | "idempotency_key"> & {
      dependency_key?: string | null;
    },
  ): SyncQueueItem => ({
    queue_id: crypto.randomUUID(),
    operation: "CREATE",
    status: "PENDING",
    retry_count: 0,
    last_attempt_at: null,
    next_retry_at: null,
    error_message: null,
    created_at: now.toISOString(),
    dependency_key: extra.dependency_key ?? null,
    ...extra,
  });

  await put(
    STORES.queue,
    queueRow({ entity_type: "ORDER", entity_local_id: orderLocalId, idempotency_key: orderKey }),
  );
  await put(
    STORES.queue,
    queueRow({
      entity_type: "PAYMENT",
      entity_local_id: paymentLocalId,
      idempotency_key: paymentKey,
      dependency_key: orderKey,
    }),
  );
  await put(
    STORES.queue,
    queueRow({
      entity_type: "INVOICE",
      entity_local_id: invoiceLocalId,
      idempotency_key: invoiceKey,
      dependency_key: orderKey,
    }),
  );

  // Fire-and-forget sync attempt; UI doesn't block on it.
  if (isOnline()) {
    void runSync({ branchId: input.branchId, terminalId });
  }
  // Always ask the SW to handle this batch as well - that way it survives
  // a tab/page close and will retry in the background.
  void requestBackgroundSync();

  return {
    localOrderId: orderLocalId,
    receiptNumber,
    total,
    offline: !isOnline(),
  };
}

export interface RecordOfflineCashEventInput {
  branchId: string;
  cashierId: string;
  shiftId: string;
  eventType: "drop" | "payout" | "open" | "close";
  amount: number;
  paymentMethod?: string;
  description?: string;
}

export async function recordOfflineCashEvent(
  input: RecordOfflineCashEventInput,
): Promise<{ localId: string; offline: boolean }> {
  const terminalId = await getTerminalId();
  const now = new Date();
  const localId = crypto.randomUUID();
  const businessDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const payload = await protectPayload({
    shift_id: input.shiftId,
    event_type: input.eventType,
    amount: input.amount,
    payment_method: input.paymentMethod ?? "cash",
    description: input.description ?? `Offline ${input.eventType}`,
  });
  const cashIntegrity = await stampIntegrity(terminalId, payload);
  await put(STORES.cashDrawer, {
    local_id: localId,
    server_id: null,
    branch_id: input.branchId,
    cashier_id: input.cashierId,
    terminal_id: terminalId,
    business_date: businessDate,
    payload,
    status: "PENDING",
    retry_count: 0,
    error_message: null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    synced_at: null,
    ...cashIntegrity,
  } satisfies OfflineRecord);

  await put(STORES.queue, {
    queue_id: crypto.randomUUID(),
    entity_type: "CASH_DRAWER",
    entity_local_id: localId,
    operation: "CREATE",
    idempotency_key: buildIdempotencyKey(terminalId, "CASH_DRAWER", localId),
    dependency_key: null,
    status: "PENDING",
    retry_count: 0,
    last_attempt_at: null,
    next_retry_at: null,
    error_message: null,
    created_at: now.toISOString(),
  } satisfies SyncQueueItem);

  if (isOnline()) void runSync({ branchId: input.branchId, terminalId });
  void requestBackgroundSync();
  return { localId, offline: !isOnline() };
}
/* ---------------------------------------------------------------------
 * Refunds
 * ---------------------------------------------------------------------
 * A refund is queued as a RETURN entity. It carries the original receipt
 * number so the server can reverse the sale, and it works offline exactly
 * like a sale: queued locally, drained by the sync engine.
 * ------------------------------------------------------------------- */

export interface RecordOfflineRefundInput {
  branchId: string;
  cashierId: string;
  shiftId: string | null;
  /** Receipt number printed on the original sale. */
  originalReceiptNumber: string;
  amount: number;
  paymentMethod: string;
  reason: string;
  vatRate?: number;
  pricesVatInclusive?: boolean;
}

export interface RecordOfflineRefundResult {
  localId: string;
  refundReference: string;
  offline: boolean;
}

export async function recordOfflineRefund(
  input: RecordOfflineRefundInput,
): Promise<RecordOfflineRefundResult> {
  if (!(input.amount > 0)) throw new Error("Refund amount must be greater than zero");
  const terminalId = await getTerminalId();
  const now = new Date();
  const localId = crypto.randomUUID();
  const businessDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const { net, vat, gross } = splitListed(
    input.amount,
    input.vatRate ?? VAT_RATE,
    input.pricesVatInclusive ?? DEFAULT_PRICES_VAT_INCLUSIVE,
  );
  const refundReference = `RF-${await generateLocalReceiptNumber(now)}`;

  const payload = await protectPayload({
    shift_id: input.shiftId,
    original_receipt_number: input.originalReceiptNumber,
    refund_reference: refundReference,
    payment_method: input.paymentMethod,
    reason: input.reason,
    subtotal: net,
    tax: vat,
    total: gross,
    created_at: now.toISOString(),
  });
  const integrity = await stampIntegrity(terminalId, payload);

  await put(STORES.returns, {
    local_id: localId,
    server_id: null,
    branch_id: input.branchId,
    cashier_id: input.cashierId,
    terminal_id: terminalId,
    business_date: businessDate,
    payload,
    status: "PENDING",
    retry_count: 0,
    error_message: null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    synced_at: null,
    ...integrity,
  } satisfies OfflineRecord);

  await put(STORES.queue, {
    queue_id: crypto.randomUUID(),
    entity_type: "RETURN",
    entity_local_id: localId,
    operation: "REFUND",
    idempotency_key: buildIdempotencyKey(terminalId, "RETURN", localId),
    dependency_key: null,
    status: "PENDING",
    retry_count: 0,
    last_attempt_at: null,
    next_retry_at: null,
    error_message: null,
    created_at: now.toISOString(),
  } satisfies SyncQueueItem);

  if (isOnline()) void runSync({ branchId: input.branchId, terminalId });
  void requestBackgroundSync();
  return { localId, refundReference, offline: !isOnline() };
}
