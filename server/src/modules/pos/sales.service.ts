/**
 * POS sales: records a sale and everything that belongs to it in ONE transaction:
 * the sale, its lines, the shift cash event, reorder requests, the idempotency record and an
 * outbox event. Database triggers keep doing their part in the same transaction:
 * on sales_transactions (credit limit, customer balance, receipt/ZATCA validation, kitchen
 * ticket) and on sales_items (recipe stock deduction and provisional COGS posting).
 *
 * Totals are computed here with the same VAT code the POS screen uses
 * (src/lib/vatInclusive.ts), from the branch's VAT rate and pricing mode. The client's line
 * prices are taken as given (size variants, branch prices and market prices are priced on
 * the terminal today); moving price lists server-side is a follow-up.
 */
import { badRequest, HttpError } from "../../lib/errors.js";
import type { DbClaims } from "../../db.js";
import { inServiceTx } from "../shared/db.js";
import { requireRestaurantRole } from "../shared/access.js";
import { salesRepository } from "./sales.repository.js";
import type { CreateSaleInput, CreateSaleResult } from "./sales.schema.js";
import { DEFAULT_PRICES_VAT_INCLUSIVE, lineGross, roundMoney, splitListed, sumMoney, VAT_RATE } from "../../../../src/lib/vatInclusive.ts";

const SALE_ROLES = ["owner", "manager", "cashier", "waiter"] as const;

export interface CreateSaleOptions {
  claims: DbClaims & { sub: string };
  idempotencyKey?: string | null;
  terminal?: string | null;
}

export async function createSale(input: CreateSaleInput, opts: CreateSaleOptions): Promise<{ result: CreateSaleResult; replayed: boolean }> {
  const userId = opts.claims.sub;
  const settlement = input.settlement ?? "paid";
  const subtype = input.invoice?.subtype ?? "SIMPLIFIED";

  // ---- input rules that need no database --------------------------------------------
  if (settlement === "unpaid" && !input.customerId) throw badRequest("Customer is required for unpaid sales", "customer_required");
  if (input.createdAt) {
    if (settlement !== "unpaid") throw badRequest("Only unpaid (credit) sales can be backdated", "backdate_not_allowed");
    if (new Date(input.createdAt).getTime() > Date.now() + 5 * 60_000) throw badRequest("Sale date is in the future", "future_date");
  }
  if (subtype === "STANDARD") {
    const name = input.invoice?.buyerName?.trim();
    const vat = input.invoice?.buyerVat?.trim() ?? "";
    const other = input.invoice?.buyerOtherId?.trim() ?? "";
    if (!name) throw badRequest("Buyer name is required for Standard (B2B) invoices", "buyer_name_required");
    if (vat && !/^\d{15}$/.test(vat)) throw badRequest("Buyer VAT number must be exactly 15 digits", "buyer_vat_invalid");
    if (!vat && !other) throw badRequest("Standard (B2B) invoices need a 15-digit VAT number or another buyer ID", "buyer_id_required");
  }

  return inServiceTx(opts.claims, async (t) => {
    const repo = salesRepository(t);
    await requireRestaurantRole(t.tx, userId, input.restaurantId, [...SALE_ROLES]);

    // ---- idempotency: a retried request returns the first response ----------------------
    let idemId: string | null = null;
    if (opts.idempotencyKey) {
      const claim = await repo.claimIdempotencyKey(input.restaurantId, opts.idempotencyKey, opts.terminal || `web:${userId}`);
      if (!claim.claimed) {
        if (claim.existing?.entityType !== "api.pos.sale" || claim.existing?.status !== "completed") {
          throw new HttpError(409, "This idempotency key was already used for another request", "idempotency_conflict");
        }
        return { result: claim.existing.response as CreateSaleResult, replayed: true };
      }
      idemId = claim.id;
    }

    // ---- references must belong to this restaurant ---------------------------------------
    const ids = [...new Set(input.lines.map((l) => l.menuItemId))];
    const items = await repo.activeMenuItems(input.restaurantId, ids);
    const byId = new Map(items.map((i) => [i.id, i]));
    const unknown = ids.filter((id) => !byId.has(id));
    if (unknown.length) throw badRequest(`Unknown menu items for this restaurant: ${unknown.join(", ")}`, "menu_item_not_found");
    const inactive = items.filter((i) => i.isActive === false);
    if (inactive.length) throw badRequest(`Menu items are inactive: ${inactive.map((i) => i.name).join(", ")}`, "menu_item_inactive");

    if (input.shiftId) {
      const shift = await repo.openShift(input.restaurantId, input.shiftId);
      if (!shift) throw badRequest("Shift not found for this restaurant", "shift_not_found");
      if (shift.status && shift.status !== "open") throw badRequest("Shift is not open", "shift_closed");
    }
    if (input.customerId && !(await repo.customer(input.restaurantId, input.customerId))) {
      throw badRequest("Customer not found for this restaurant", "customer_not_found");
    }
    if (input.tableId && !(await repo.tableBelongs(input.restaurantId, input.tableId))) {
      throw badRequest("Table not found for this restaurant", "table_not_found");
    }
    const vat = await repo.vatSettings(input.restaurantId, input.branchId);
    if (!vat.branchFound) throw badRequest("Branch not found for this restaurant", "branch_not_found");

    // ---- totals (same rounding as the POS screen) ----------------------------------------
    const rate = vat.branch?.vatRate != null ? Number(vat.branch.vatRate) / 100 : VAT_RATE;
    const inclusive = vat.branch?.inclusive ?? DEFAULT_PRICES_VAT_INCLUSIVE;
    const lines = input.lines.map((l) => ({ ...l, unitPrice: roundMoney(l.unitPrice), lineTotal: lineGross(l.unitPrice, l.quantity) }));
    const listed = sumMoney(lines.map((l) => l.lineTotal));
    const { net: subtotal, vat: tax, gross: total } = splitListed(listed, rate, inclusive);

    // ---- business day and receipt number --------------------------------------------------
    const [{ day, created_at }] = await t.tx<{ day: string; created_at: string }[]>`
      select to_char((coalesce(${input.createdAt ?? null}::timestamptz, now()) at time zone coalesce(r.timezone, 'Asia/Riyadh'))::date, 'YYYY-MM-DD') as day,
             coalesce(${input.createdAt ?? null}::timestamptz, now())::text as created_at
      from public.restaurants r where r.id = ${input.restaurantId}`;
    const receiptNumber = await repo.nextReceiptNumber(input.restaurantId, day);

    // ---- writes ----------------------------------------------------------------------------
    const sale = await repo.insertSale({
      restaurantId: input.restaurantId,
      branchId: input.branchId ?? vat.branch?.id ?? null,
      shiftId: input.shiftId ?? null,
      paymentMethod: input.paymentMethod,
      subtotal: String(subtotal),
      tax: String(tax),
      total: String(total),
      receiptNumber,
      customerId: input.customerId ?? null,
      settlementStatus: settlement,
      createdAt: created_at,
      zatcaInvoiceSubtype: subtype,
      zatcaBuyerName: subtype === "STANDARD" ? input.invoice?.buyerName?.trim() ?? null : null,
      zatcaBuyerVatNumber: subtype === "STANDARD" ? input.invoice?.buyerVat?.trim() || null : null,
      zatcaBuyerAddress: subtype === "STANDARD" ? input.invoice?.buyerAddress?.trim() || null : null,
      tableId: input.tableId ?? null,
    });

    const saleItems = await repo.insertItems(
      lines.map((l) => ({
        restaurantId: input.restaurantId,
        transactionId: sale.id,
        menuItemId: l.menuItemId,
        quantity: l.quantity,
        unitPrice: String(l.unitPrice),
        totalPrice: String(l.lineTotal),
      })),
    );

    if (input.shiftId) {
      await repo.insertCashEvent({
        shiftId: input.shiftId,
        restaurantId: input.restaurantId,
        eventType: "sale",
        amount: String(subtotal),
        paymentMethod: input.paymentMethod,
        createdBy: userId,
        description: `POS Sale ${receiptNumber}`,
        referenceType: "sales_transaction",
        referenceId: sale.id,
      });
    }

    await repo.recordSaleUsage({
      restaurantId: input.restaurantId,
      saleItemIds: saleItems.map((i) => i.id),
      userId,
      shiftId: input.shiftId ?? null,
      day,
      receiptNumber,
    });

    const lowStock = await repo.createReorderRequests({
      restaurantId: input.restaurantId,
      sold: lines.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity, name: byId.get(l.menuItemId)?.name ?? "" })),
    });

    const result: CreateSaleResult = {
      transaction: {
        id: sale.id,
        receipt_number: receiptNumber,
        subtotal,
        tax,
        total,
        settlement_status: settlement,
        payment_method: input.paymentMethod,
        created_at: sale.createdAt,
        branch_id: sale.branchId ?? null,
      },
      receiptNumber,
      salesItems: saleItems.map((i) => ({
        menu_item_id: i.menuItemId,
        quantity: i.quantity,
        unit_price: Number(i.unitPrice),
        total_price: Number(i.totalPrice),
      })),
      lowStock: lowStock.map((r) => ({ inventoryItemId: r.inventory_item_id, currentStock: r.current_stock, reorderLevel: r.reorder_level ?? 0 })),
    };

    await repo.emitEvent(input.restaurantId, sale.id, {
      sale: { id: sale.id, receipt_number: receiptNumber, total, payment_method: input.paymentMethod, settlement_status: settlement, branch_id: result.transaction.branch_id },
    });
    if (idemId) await repo.completeIdempotencyKey(idemId, result, input.shiftId ?? null);
    return { result, replayed: false };
  });
}
