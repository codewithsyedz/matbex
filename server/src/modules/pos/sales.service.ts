/**
 * POS sales: records a sale and everything that belongs to it in ONE transaction:
 * the sale, its lines, the shift cash event, reorder requests, the idempotency record and an
 * outbox event. Database triggers keep doing their part in the same transaction:
 * on sales_transactions (credit limit, customer balance, receipt/ZATCA validation, kitchen
 * ticket) and on sales_items (recipe stock deduction and provisional COGS posting).
 *
 * Prices: each line is priced here from the menu item and the branch's price list for the
 * sale's business day (size tier: regular/quarter/half/full). A terminal that sends the price
 * it displayed gets 409 price_changed when that is stale, so the cashier never charges one
 * amount while the receipt says another. Offline replays (input.offline) are charged at the
 * terminal's prices, because the customer already paid them.
 *
 * Totals are computed with the same VAT code the POS screen uses (src/lib/vatInclusive.ts),
 * from the branch's VAT rate and pricing mode.
 */
import { badRequest, HttpError } from "../../lib/errors.js";
import type { DbClaims } from "../../db.js";
import { inServiceTx, type ServiceTx } from "../shared/db.js";
import { requireRestaurantRole } from "../shared/access.js";
import { salesRepository } from "./sales.repository.js";
import type { CreateSaleInput, CreateSaleResult, SaleLineSize, SaleQuote } from "./sales.schema.js";
import { DEFAULT_PRICES_VAT_INCLUSIVE, lineGross, roundMoney, splitListed, sumMoney, VAT_RATE } from "../../../../src/lib/vatInclusive.ts";

const SALE_ROLES = ["owner", "manager", "cashier", "waiter"] as const;
/** How far back an offline sale may be replayed. */
const OFFLINE_MAX_AGE_MS = 30 * 24 * 3600_000;

type PriceRow = { selling: number; quarter: number; half: number; full: number };

/** Same tier rule as the POS cart (RecordSale addToCart): a missing tier falls back to the regular price. */
export function priceFor(p: PriceRow, size: SaleLineSize = "regular"): number {
  if (size === "quarter" && p.quarter > 0) return p.quarter;
  if (size === "half" && p.half > 0) return p.half;
  if (size === "full" && p.full > 0) return p.full;
  return p.selling;
}

export interface CreateSaleOptions {
  claims: DbClaims & { sub: string };
  idempotencyKey?: string | null;
  terminal?: string | null;
}

/**
 * Checks every reference in the order against the restaurant and prices it: menu items,
 * shift, customer, table, branch; the business day; line prices (server price list unless
 * `offline`); totals with the branch's VAT settings. Reads only.
 */
async function priceSale(
  t: ServiceTx,
  repo: ReturnType<typeof salesRepository>,
  input: CreateSaleInput,
  { offline, saleAt }: { offline: boolean; saleAt: string | null },
) {
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
      // An offline sale was rung up while the shift was open; it may have closed since.
      if (!offline && shift.status && shift.status !== "open") throw badRequest("Shift is not open", "shift_closed");
    }
    if (input.customerId && !(await repo.customer(input.restaurantId, input.customerId))) {
      throw badRequest("Customer not found for this restaurant", "customer_not_found");
    }
    if (input.tableId && !(await repo.tableBelongs(input.restaurantId, input.tableId))) {
      throw badRequest("Table not found for this restaurant", "table_not_found");
    }
    const vat = await repo.vatSettings(input.restaurantId, input.branchId);
    if (!vat.branchFound) throw badRequest("Branch not found for this restaurant", "branch_not_found");

    // ---- business day (restaurant time zone) ----------------------------------------------
    const [{ day, created_at }] = await t.tx<{ day: string; created_at: string }[]>`
      select to_char((coalesce(${saleAt}::timestamptz, now()) at time zone coalesce(r.timezone, 'Asia/Riyadh'))::date, 'YYYY-MM-DD') as day,
             coalesce(${saleAt}::timestamptz, now())::text as created_at
      from public.restaurants r where r.id = ${input.restaurantId}`;

    // ---- prices ----------------------------------------------------------------------------
    const branchId = input.branchId ?? vat.branch?.id ?? null;
    // Branch price lists apply when the terminal names its branch; without one the terminal
    // shows base menu prices (all-branches view), so those are what we charge.
    const prices = new Map((await repo.menuPrices(input.restaurantId, input.branchId ?? null, day, ids)).map((p) => [p.id, p]));
    const changed: { menuItemId: string; size: SaleLineSize; shown: number; current: number }[] = [];
    const priced = input.lines.map((l) => {
      const size = l.size ?? "regular";
      const current = roundMoney(priceFor(prices.get(l.menuItemId)!, size));
      if (offline) return { ...l, unitPrice: roundMoney(l.unitPrice!) };
      if (l.unitPrice != null && Math.abs(roundMoney(l.unitPrice) - current) >= 0.005) {
        changed.push({ menuItemId: l.menuItemId, size, shown: roundMoney(l.unitPrice), current });
      }
      return { ...l, unitPrice: current };
    });
    if (changed.length) {
      throw new HttpError(409, "Prices changed since the menu was loaded; refresh and check the order", "price_changed", { lines: changed });
    }

    // ---- totals (same rounding as the POS screen) ----------------------------------------
    const rate = vat.branch?.vatRate != null ? Number(vat.branch.vatRate) / 100 : VAT_RATE;
    const inclusive = vat.branch?.inclusive ?? DEFAULT_PRICES_VAT_INCLUSIVE;
    const lines = priced.map((l) => ({ ...l, lineTotal: lineGross(l.unitPrice, l.quantity) }));
    const documentDiscount = roundMoney(input.documentDiscount ?? 0);
    const documentSurcharge = roundMoney(input.documentSurcharge ?? 0);
    const linesTotal = sumMoney(lines.map((l) => l.lineTotal));
    if (documentDiscount > linesTotal + documentSurcharge) throw badRequest("Discount is larger than the order", "discount_too_large");
    const listed = roundMoney(linesTotal - documentDiscount + documentSurcharge);
    const { net: subtotal, vat: tax, gross: total } = splitListed(listed, rate, inclusive);

    return { byId, branchId, day, created_at, lines, subtotal, tax, total, rate, inclusive, documentDiscount, documentSurcharge };
}

/**
 * POST /api/v1/pos/sales/quote: what the server would charge for this order right now,
 * without recording anything. Card-terminal flows charge the quoted total, then record the
 * sale with the same prices.
 */
export async function quoteSale(input: CreateSaleInput, opts: { claims: DbClaims & { sub: string } }): Promise<SaleQuote> {
  return inServiceTx(opts.claims, async (t) => {
    const repo = salesRepository(t);
    await requireRestaurantRole(t.tx, opts.claims.sub, input.restaurantId, [...SALE_ROLES]);
    const q = await priceSale(t, repo, { ...input, lines: input.lines.map((l) => ({ ...l, unitPrice: undefined })) }, { offline: false, saleAt: null });
    return {
      lines: q.lines.map((l) => ({ menuItemId: l.menuItemId, size: l.size ?? "regular", quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.lineTotal })),
      subtotal: q.subtotal,
      tax: q.tax,
      total: q.total,
      documentDiscount: q.documentDiscount,
      documentSurcharge: q.documentSurcharge,
      vatRate: q.rate,
      pricesVatInclusive: q.inclusive,
      branchId: q.branchId,
    };
  });
}

export async function createSale(input: CreateSaleInput, opts: CreateSaleOptions): Promise<{ result: CreateSaleResult; replayed: boolean }> {
  const userId = opts.claims.sub;
  const settlement = input.settlement ?? "paid";
  const offline = input.offline ?? null;
  const subtype = input.invoice?.subtype ?? "SIMPLIFIED";

  // ---- input rules that need no database --------------------------------------------
  if (settlement === "unpaid" && !input.customerId) throw badRequest("Customer is required for unpaid sales", "customer_required");
  if (input.cardTerminal) {
    if (input.paymentMethod !== "card") throw badRequest("A card terminal approval needs payment method card", "card_terminal_mismatch");
    if (input.cardTerminal.status !== "approved") throw badRequest("The card terminal did not approve the charge", "card_not_approved");
  }
  if (offline) {
    if (input.createdAt) throw badRequest("Use offline.createdAt for offline sales", "backdate_not_allowed");
    const at = new Date(offline.createdAt).getTime();
    if (at > Date.now() + 5 * 60_000) throw badRequest("Sale date is in the future", "future_date");
    if (at < Date.now() - OFFLINE_MAX_AGE_MS) throw badRequest("Offline sale is older than 30 days", "offline_too_old");
    if (input.lines.some((l) => l.unitPrice == null)) throw badRequest("Offline sales must carry the price that was charged", "price_required");
  }
  if (input.createdAt) {
    if (settlement !== "unpaid") throw badRequest("Only unpaid (credit) sales can be backdated", "backdate_not_allowed");
    if (new Date(input.createdAt).getTime() > Date.now() + 5 * 60_000) throw badRequest("Sale date is in the future", "future_date");
  }
  const saleAt = offline?.createdAt ?? input.createdAt ?? null;
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

    const { byId, branchId, day, created_at, lines, subtotal, tax, total, documentDiscount, documentSurcharge } = await priceSale(t, repo, input, { offline: !!offline, saleAt });

    // ---- receipt number: the printed one for offline replays, else the next in sequence ----
    const receiptNumber = offline?.receiptNumber ?? (await repo.nextReceiptNumber(input.restaurantId, day));

    // ---- writes ----------------------------------------------------------------------------
    const sale = await repo.insertSale({
      restaurantId: input.restaurantId,
      branchId,
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
      documentDiscount: String(documentDiscount),
      documentSurcharge: String(documentSurcharge),
      ...(input.cardTerminal
        ? {
            halaStatus: input.cardTerminal.status,
            halaReference: input.cardTerminal.reference ?? null,
            halaResponse: input.cardTerminal.response ?? null,
            halaChargedAt: new Date().toISOString(),
          }
        : {}),
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

    // The drawer receives what the customer paid: the VAT-inclusive total, and nothing for a
    // credit (unpaid) sale. Shift close (CloseShiftModal) expects exactly these amounts.
    if (input.shiftId && settlement === "paid") {
      await repo.insertCashEvent({
        shiftId: input.shiftId,
        restaurantId: input.restaurantId,
        eventType: "sale",
        amount: String(total),
        paymentMethod: input.paymentMethod,
        createdBy: userId,
        description: `${offline ? "Offline POS Sale" : "POS Sale"} ${receiptNumber}`,
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
      lowStock: lowStock.map((r) => ({ inventoryItemId: r.inventory_item_id, name: r.name, currentStock: r.current_stock, reorderLevel: r.reorder_level ?? 0 })),
    };

    await repo.emitEvent(input.restaurantId, sale.id, {
      sale: { id: sale.id, receipt_number: receiptNumber, total, payment_method: input.paymentMethod, settlement_status: settlement, branch_id: result.transaction.branch_id, offline: !!offline },
    });
    if (idemId) await repo.completeIdempotencyKey(idemId, result, input.shiftId ?? null);
    return { result, replayed: false };
  });
}
