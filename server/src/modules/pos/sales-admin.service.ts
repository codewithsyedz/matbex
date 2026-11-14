/**
 * Back-office sales: amount-only entries, voids, edits and line corrections. Each runs in one
 * transaction and keeps the side effects the database does not handle on its own in step:
 * the shift drawer (cash_events), food-cost rows (inventory_usage), kitchen tickets and the
 * live event. Recipe stock and provisional COGS move through the sales_items triggers.
 *
 * Rules shared by every change to an existing sale:
 * - a voided sale and a void entry are final;
 * - a sale already reported or cleared with ZATCA cannot change (issue a credit note);
 * - a credit sale on a settlement invoice cannot be voided (take it off the invoice first).
 */
import { randomInt } from "node:crypto";
import { badRequest, HttpError } from "../../lib/errors.js";
import type { DbClaims } from "../../db.js";
import { inServiceTx } from "../shared/db.js";
import { requireRestaurantRole, type RestaurantRole } from "../shared/access.js";
import { salesRepository } from "./sales.repository.js";
import { salesAdminRepository, type LockedSale } from "./sales-admin.repository.js";
import type { EditInput, LineInput, SaleRow, SummaryInput, SummaryKind, VoidInput } from "./sales-admin.schema.js";
import { lineGross, roundMoney, splitInclusive, splitListed, sumMoney, VAT_RATE, DEFAULT_PRICES_VAT_INCLUSIVE } from "../../../../src/lib/vatInclusive.ts";

type Claims = DbClaims & { sub: string };

const MANAGERS: RestaurantRole[] = ["owner", "manager"];
const BACK_OFFICE: RestaurantRole[] = ["owner", "manager", "accountant"];
const ZATCA_FINAL = new Set(["REPORTED", "CLEARED", "CLEARED_SIM"]);

const conflict = (msg: string, code: string) => new HttpError(409, msg, code);

function assertChangeable(sale: LockedSale) {
  if (sale.voids_transaction_id) throw conflict("This entry voids another sale and cannot be changed", "is_void");
  if (sale.voided_at) throw conflict("This sale has been voided", "already_voided");
  if (sale.zatca_clearance_status && ZATCA_FINAL.has(sale.zatca_clearance_status)) {
    throw conflict("This invoice was reported to ZATCA; issue a credit note instead", "zatca_reported");
  }
}

async function loadSale(repo: ReturnType<typeof salesAdminRepository>, restaurantId: string, saleId: string) {
  const sale = await repo.lockSale(restaurantId, saleId);
  if (!sale) throw new HttpError(404, "Sale not found", "sale_not_found");
  return sale;
}

async function openShiftOrThrow(repo: ReturnType<typeof salesAdminRepository>, restaurantId: string, shiftId: string) {
  const s = await repo.shift(restaurantId, shiftId);
  if (!s) throw badRequest("Shift not found for this restaurant", "shift_not_found");
  if (s.status !== "open") throw badRequest("Shift is not open", "shift_closed");
  return s;
}

const RECEIPT_PREFIX: Record<Exclude<SummaryKind, "manual">, string> = {
  end_of_day: "EOD",
  end_of_day_no_pos: "EOD-NOPOS",
  backfill_adjustment: "BACKFILL-ADJ",
};

/**
 * POST /api/v1/pos/sales/summary: sales entered as amounts, without lines.
 * - manual: one sale (optionally backdated, optionally into an open shift's drawer), numbered
 *   in the restaurant's RCP-YYYYMMDD-NNNN sequence;
 * - end_of_day / end_of_day_no_pos: the day's cash and card totals when the POS was not used;
 * - backfill_adjustment: the difference between a backfilled day and what was recorded (may be
 *   negative).
 * Amounts include VAT; it is split out with the branch rate unless vatPercent is given.
 */
export async function recordSummary(input: SummaryInput, claims: Claims) {
  const entries = input.entries.map((e) => ({ ...e, total: roundMoney(e.total) }));
  if (entries.some((e) => e.total === 0)) throw badRequest("Amounts must not be zero", "zero_amount");
  if (input.kind !== "backfill_adjustment" && entries.some((e) => e.total < 0)) {
    throw badRequest("Only backfill adjustments can be negative", "negative_amount");
  }
  if (input.kind === "manual") {
    if (entries.length !== 1) throw badRequest("A manual sale has one amount", "one_entry");
    if (input.businessDate) throw badRequest("Use createdAt for manual sales", "use_created_at");
    if (input.createdAt && new Date(input.createdAt).getTime() > Date.now() + 5 * 60_000) {
      throw badRequest("Sale date is in the future", "future_date");
    }
  } else {
    if (!input.businessDate) throw badRequest("businessDate is required", "business_date_required");
    if (input.shiftId || input.createdAt) throw badRequest("Day totals are not tied to a shift or a time", "not_allowed");
    if (new Set(entries.map((e) => e.paymentMethod)).size !== entries.length) {
      throw badRequest("One amount per payment method", "duplicate_method");
    }
  }

  return inServiceTx(claims, async (t) => {
    const repo = salesAdminRepository(t);
    const roles: RestaurantRole[] = input.kind === "manual" ? [...BACK_OFFICE, "cashier"] : BACK_OFFICE;
    await requireRestaurantRole(t.tx, claims.sub, input.restaurantId, roles);

    const vat = await salesRepository(t).vatSettings(input.restaurantId, input.branchId);
    if (!vat.branchFound) throw badRequest("Branch not found for this restaurant", "branch_not_found");
    const rate = input.vatPercent != null ? input.vatPercent / 100 : vat.branch?.vatRate != null ? Number(vat.branch.vatRate) / 100 : VAT_RATE;
    if (input.shiftId) await openShiftOrThrow(repo, input.restaurantId, input.shiftId);

    let at: string;
    let day: string;
    if (input.kind === "manual") {
      ({ at, day } = await repo.businessDay(input.restaurantId, input.createdAt ?? null));
    } else {
      const noon = await repo.noonOf(input.restaurantId, input.businessDate!);
      if (input.businessDate! > noon.today) throw badRequest("Date cannot be in the future", "future_date");
      at = noon.at;
      day = input.businessDate!;
    }

    const prefix = input.kind === "manual" ? null : `${RECEIPT_PREFIX[input.kind]}-${day.replaceAll("-", "")}`;
    const created: SaleRow[] = [];
    for (const e of entries) {
      const { net, vat: tax, gross } = splitInclusive(e.total, rate);
      const receipt = prefix
        ? `${prefix}-${e.paymentMethod.toUpperCase()}-${String(randomInt(0, 10000)).padStart(4, "0")}`
        : await salesRepository(t).nextReceiptNumber(input.restaurantId, day);
      const sale = await repo.insertSale({
        restaurantId: input.restaurantId,
        branchId: input.branchId ?? vat.branch?.id ?? null,
        shiftId: input.shiftId ?? null,
        paymentMethod: e.paymentMethod,
        subtotal: net,
        tax,
        total: gross,
        receiptNumber: receipt,
        settlement: "paid",
        createdAt: at,
      });
      if (input.shiftId) {
        await repo.insertCashEvent({
          restaurantId: input.restaurantId, shiftId: input.shiftId, type: "sale", amount: gross,
          paymentMethod: e.paymentMethod, userId: claims.sub, description: `Sale ${receipt}`, saleId: sale.id,
        });
      }
      created.push(sale);
    }
    return { transactions: created, receiptPrefix: prefix };
  });
}

/**
 * POST /api/v1/pos/sales/:id/void. Records a negative mirror sale (receipt VOID-<original>)
 * so totals net out everywhere, puts recipe stock back and voids its provisional COGS, removes
 * its food-cost rows, cancels its open kitchen ticket and, for a paid sale, pays the refund out
 * of an open shift's drawer. A credit (unpaid) sale is settled instead, which clears it from
 * the customer's balance.
 */
export async function voidSale(saleId: string, input: VoidInput, claims: Claims) {
  return inServiceTx(claims, async (t) => {
    const repo = salesAdminRepository(t);
    await requireRestaurantRole(t.tx, claims.sub, input.restaurantId, MANAGERS);
    const sale = await loadSale(repo, input.restaurantId, saleId);
    assertChangeable(sale);
    if (sale.total <= 0) throw conflict("Only sales with a positive total can be voided", "not_voidable");
    if (sale.settlement_invoice_id) {
      throw conflict("This sale is on a settlement invoice; remove it from the invoice first", "in_settlement");
    }

    // Which drawer pays the refund: the one asked for, else the sale's own shift while open.
    let refundShift: string | null = null;
    if (input.shiftId) refundShift = (await openShiftOrThrow(repo, input.restaurantId, input.shiftId)).id;
    else if (sale.shift_id && (await repo.shift(input.restaurantId, sale.shift_id))?.status === "open") refundShift = sale.shift_id;

    const reason = input.reason.trim();
    await repo.reverseStock(sale.id, `void: ${reason}`);

    const credit = sale.settlement_status === "unpaid";
    const mirror = await repo.insertSale({
      restaurantId: input.restaurantId,
      branchId: sale.branch_id,
      shiftId: credit ? null : refundShift,
      paymentMethod: sale.payment_method,
      subtotal: -sale.subtotal,
      tax: -sale.tax,
      total: -sale.total,
      receiptNumber: `VOID-${sale.receipt_number ?? sale.id.slice(0, 8)}`,
      settlement: credit ? "settled" : "paid",
      customerId: sale.customer_id,
      createdAt: new Date().toISOString(),
      voidsTransactionId: sale.id,
    });
    await repo.markVoided(sale.id, claims.sub, reason, credit);

    const cashRefunded = !credit && sale.settlement_status === "paid" && !!refundShift;
    if (cashRefunded) {
      await repo.insertCashEvent({
        restaurantId: input.restaurantId, shiftId: refundShift!, type: "refund", amount: sale.total,
        paymentMethod: sale.payment_method, userId: claims.sub,
        description: `Void ${sale.receipt_number ?? sale.id} - ${reason}`, saleId: mirror.id,
      });
    }
    await repo.cancelKitchenTickets(input.restaurantId, sale.id);
    await repo.emitEvent(input.restaurantId, sale.id, "pos.sale.voided", {
      sale: { id: sale.id, receipt_number: sale.receipt_number, total: sale.total, void_id: mirror.id },
    });
    return { void: mirror, cashRefunded, refundShiftId: cashRefunded ? refundShift : null };
  });
}

/**
 * PATCH /api/v1/pos/sales/:id. Amount and VAT changes are for amount-only sales; a sale with
 * lines changes through its lines so stock and totals stay consistent. Moving a sale to another
 * shift moves its drawer entry with it (taking it out of every shift removes the entry).
 */
export async function editSale(saleId: string, input: EditInput, claims: Claims) {
  return inServiceTx(claims, async (t) => {
    const repo = salesAdminRepository(t);
    const access = await requireRestaurantRole(t.tx, claims.sub, input.restaurantId, BACK_OFFICE);
    const sale = await loadSale(repo, input.restaurantId, saleId);
    // Re-tagging the branch is allowed on any sale (it changes no amount); everything else
    // follows the usual rules.
    if (Object.keys(input).some((k) => k !== "restaurantId" && k !== "branchId")) assertChangeable(sale);

    let row: SaleRow = sale;
    if (input.total != null || input.vatPercent != null) {
      if (sale.line_count > 0) throw conflict("This sale has lines; change the lines instead", "has_lines");
      const gross = roundMoney(input.total ?? sale.total);
      const rate = input.vatPercent != null ? input.vatPercent / 100 : sale.subtotal ? sale.tax / sale.subtotal : VAT_RATE;
      const { net, vat: tax } = splitInclusive(gross, rate);
      row = await repo.updateSaleAmounts(sale.id, { subtotal: net, tax, total: gross, paymentMethod: input.paymentMethod });
      if (row.settlement_status === "paid") await repo.updateSaleCashEvents(input.restaurantId, sale.id, { amount: gross, paymentMethod: input.paymentMethod });
    } else if (input.paymentMethod) {
      row = await repo.setPaymentMethod(sale.id, input.paymentMethod);
      await repo.updateSaleCashEvents(input.restaurantId, sale.id, { paymentMethod: input.paymentMethod });
    }

    if (input.branchId !== undefined && input.branchId !== sale.branch_id) {
      if (input.branchId && !(await repo.branchBelongs(input.restaurantId, input.branchId))) {
        throw badRequest("Branch not found for this restaurant", "branch_not_found");
      }
      const before = { branch_id: sale.branch_id };
      row = await repo.setBranch(sale.id, input.branchId);
      await repo.auditLog({ userId: claims.sub, tenantId: access.tenantId, action: "sale_branch_reassign", saleId: sale.id, before, after: { branch_id: input.branchId } });
    }

    if (input.shiftId !== undefined && input.shiftId !== sale.shift_id) {
      if (input.shiftId) {
        await openShiftOrThrow(repo, input.restaurantId, input.shiftId);
        row = await repo.setSaleShift(sale.id, input.shiftId);
        const existing = await repo.saleCashEvents(input.restaurantId, sale.id);
        if (existing.some((e) => e.event_type === "sale")) {
          await repo.updateSaleCashEvents(input.restaurantId, sale.id, { shiftId: input.shiftId });
        } else if (row.settlement_status === "paid") {
          await repo.insertCashEvent({
            restaurantId: input.restaurantId, shiftId: input.shiftId, type: "sale", amount: row.total,
            paymentMethod: row.payment_method, userId: claims.sub, description: `Sale ${row.receipt_number ?? row.id}`, saleId: sale.id,
          });
        }
      } else {
        row = await repo.setSaleShift(sale.id, null);
        await repo.deleteSaleCashEvents(input.restaurantId, sale.id);
      }
    }
    return { transaction: row };
  });
}

async function recomputeFromLines(
  t: Parameters<Parameters<typeof inServiceTx>[1]>[0],
  repo: ReturnType<typeof salesAdminRepository>,
  sale: LockedSale,
  restaurantId: string,
) {
  const vat = await salesRepository(t).vatSettings(restaurantId, sale.branch_id);
  const rate = vat.branch?.vatRate != null ? Number(vat.branch.vatRate) / 100 : VAT_RATE;
  const inclusive = vat.branch?.inclusive ?? DEFAULT_PRICES_VAT_INCLUSIVE;
  const listed = sumMoney((await repo.lineTotals(sale.id)).map((l) => l.total_price));
  const { net, vat: tax, gross } = splitListed(listed, rate, inclusive);
  const row = await repo.updateSaleAmounts(sale.id, { subtotal: net, tax, total: gross });
  if (row.settlement_status === "paid") await repo.updateSaleCashEvents(restaurantId, sale.id, { amount: gross });
  return row;
}

/** PATCH /api/v1/pos/sales/:id/lines/:lineId: new quantity and/or price for one line. */
export async function editLine(saleId: string, lineId: string, input: LineInput, claims: Claims) {
  return inServiceTx(claims, async (t) => {
    const repo = salesAdminRepository(t);
    await requireRestaurantRole(t.tx, claims.sub, input.restaurantId, MANAGERS);
    const sale = await loadSale(repo, input.restaurantId, saleId);
    assertChangeable(sale);
    const line = await repo.line(sale.id, lineId);
    if (!line) throw new HttpError(404, "Line not found on this sale", "line_not_found");

    // Replace the line: the delete trigger puts the old quantity's stock back, the insert
    // trigger takes the new quantity, each with its provisional COGS.
    const unitPrice = roundMoney(input.unitPrice);
    await repo.deleteLine(line.id);
    const newId = await repo.insertLine({
      restaurantId: input.restaurantId, saleId: sale.id, menuItemId: line.menu_item_id,
      quantity: input.quantity, unitPrice, totalPrice: lineGross(unitPrice, input.quantity), branchId: line.branch_id,
    });
    const day = (await repo.businessDay(input.restaurantId, sale.created_at)).day;
    await salesRepository(t).recordSaleUsage({
      restaurantId: input.restaurantId, saleItemIds: [newId], userId: claims.sub,
      shiftId: sale.shift_id, day, receiptNumber: sale.receipt_number ?? sale.id,
    });
    const row = await recomputeFromLines(t, repo, sale, input.restaurantId);
    return { transaction: row, lineId: newId };
  });
}

/** DELETE /api/v1/pos/sales/:id/lines/:lineId. The last line cannot go; void the sale instead. */
export async function deleteLine(saleId: string, lineId: string, restaurantId: string, claims: Claims) {
  return inServiceTx(claims, async (t) => {
    const repo = salesAdminRepository(t);
    await requireRestaurantRole(t.tx, claims.sub, restaurantId, MANAGERS);
    const sale = await loadSale(repo, restaurantId, saleId);
    assertChangeable(sale);
    const line = await repo.line(sale.id, lineId);
    if (!line) throw new HttpError(404, "Line not found on this sale", "line_not_found");
    if (sale.line_count <= 1) throw conflict("This is the sale's only line; void the sale instead", "last_line");
    await repo.deleteLine(line.id);
    const row = await recomputeFromLines(t, repo, sale, restaurantId);
    return { transaction: row };
  });
}

/**
 * What a sale's subtotal/VAT/total should be, from its lines (branch rate and pricing mode,
 * document discount/surcharge) or, for an amount-only sale, from its total with VAT inside.
 */
export async function expectedTotals(
  t: Parameters<Parameters<typeof inServiceTx>[1]>[0],
  repo: ReturnType<typeof salesAdminRepository>,
  sale: LockedSale,
  restaurantId: string,
) {
  const vat = await salesRepository(t).vatSettings(restaurantId, sale.branch_id);
  const rate = vat.branch?.vatRate != null ? Number(vat.branch.vatRate) / 100 : VAT_RATE;
  const inclusive = vat.branch?.inclusive ?? DEFAULT_PRICES_VAT_INCLUSIVE;
  if (sale.line_count === 0) {
    const { net, vat: tax, gross } = splitInclusive(sale.total, rate);
    return { subtotal: net, tax, total: gross, rate, inclusive };
  }
  const adj = await repo.documentAdjustments(sale.id);
  const listed = roundMoney(sumMoney((await repo.lineTotals(sale.id)).map((l) => l.total_price)) - adj.discount + adj.surcharge);
  const { net, vat: tax, gross } = splitListed(listed, rate, inclusive);
  return { subtotal: net, tax, total: gross, rate, inclusive };
}

/**
 * POST /api/v1/pos/sales/:id/vat-reconcile (VAT audit). Recomputes the split on the server with
 * the branch's own rate AND pricing mode; the audit screen used to assume VAT-inclusive prices
 * everywhere, so on a VAT-exclusive branch it flagged correct sales and its "fix" would have
 * rewritten their totals. Records an audit_logs entry with before/after.
 */
export async function reconcileVat(saleId: string, restaurantId: string, claims: Claims) {
  return inServiceTx(claims, async (t) => {
    const repo = salesAdminRepository(t);
    const access = await requireRestaurantRole(t.tx, claims.sub, restaurantId, BACK_OFFICE);
    const sale = await loadSale(repo, restaurantId, saleId);
    assertChangeable(sale);
    const want = await expectedTotals(t, repo, sale, restaurantId);
    const before = { subtotal: sale.subtotal, tax: sale.tax, total: sale.total };
    const after = { subtotal: want.subtotal, tax: want.tax, total: want.total };
    if (before.subtotal === after.subtotal && before.tax === after.tax && before.total === after.total) {
      return { changed: false, before, after };
    }
    const row = await repo.updateSaleAmounts(sale.id, after);
    if (row.settlement_status === "paid" && before.total !== after.total) {
      await repo.updateSaleCashEvents(restaurantId, sale.id, { amount: after.total });
    }
    await repo.auditLog({ userId: claims.sub, tenantId: access.tenantId, action: "vat_reconcile", saleId: sale.id, before, after });
    return { changed: true, before, after };
  });
}
