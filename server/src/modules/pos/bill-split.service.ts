/**
 * Split bill at checkout, by item (docs/plans/split-payments.md, phase 2a).
 *
 * POST /api/v1/pos/sales/bill-split records one cart divided between guests as one sale per
 * part, in ONE transaction under one idempotency key: either every part is saved or none is.
 * Each part goes through the same code as POST /api/v1/pos/sales (recordSale: server prices,
 * tenders and card approvals, cash events, stock, kitchen ticket, live event), gets its own
 * receipt number and simplified invoice, and carries the shared bill_group_id.
 *
 * Before anything is written the parts must be exactly the cart (assertPartsMatchCart) and the
 * whole cart is priced once, so a stale price or an oversized discount fails the whole bill. A
 * document discount/surcharge is spread over the parts by their lines totals, the last part
 * taking the rounding (spreadAmount). Offline replays keep the receipt number printed for each
 * part.
 *
 * Splitting evenly or by amount is not this endpoint: that is one sale paid by several tenders
 * (POST /api/v1/pos/sales with payments).
 */
import { randomUUID } from "node:crypto";
import { badRequest, HttpError } from "../../lib/errors.js";
import type { DbClaims } from "../../db.js";
import { inServiceTx, type ServiceTx } from "../shared/db.js";
import { requireRestaurantRole } from "../shared/access.js";
import { salesRepository } from "./sales.repository.js";
import { checkSaleInput, priceSale, recordSale } from "./sales.service.js";
import type { CreateSaleInput } from "./sales.schema.js";
import { assertPartsMatchCart, spreadAmount } from "./bill-split.js";
import type { BillSplitInput, BillSplitQuote, BillSplitResult } from "./bill-split.schema.js";

const SALE_ROLES = ["owner", "manager", "cashier", "waiter"] as const;
const ENTITY = "api.pos.bill_split";

export interface BillSplitOptions {
  claims: DbClaims & { sub: string };
  idempotencyKey?: string | null;
  terminal?: string | null;
}

/** The sale request for part `i`, before its discount/surcharge share is known. */
function partInput(input: BillSplitInput, i: number): CreateSaleInput {
  const part = input.parts[i];
  return {
    restaurantId: input.restaurantId,
    branchId: input.branchId ?? null,
    shiftId: input.shiftId ?? null,
    customerId: input.customerId ?? null,
    tableId: input.tableId ?? null,
    lines: part.lines,
    payments: part.payments ?? null,
    settlement: "paid",
    offline: input.offline ? { receiptNumber: input.offline.receiptNumbers[i], createdAt: input.offline.createdAt } : null,
  };
}

/** Rules that need no database: parts = cart, offline receipt numbers, each part's own sale rules. */
function checkBillSplit(input: BillSplitInput, userId: string, { quote = false } = {}) {
  assertPartsMatchCart(input.lines, input.parts);
  if (input.offline) {
    const nums = input.offline.receiptNumbers;
    if (nums.length !== input.parts.length) throw badRequest("Offline split bills need one receipt number per part", "receipt_numbers_mismatch");
    if (new Set(nums).size !== nums.length) throw badRequest("Each part needs its own receipt number", "receipt_numbers_mismatch");
  }
  if (quote) return [];
  return input.parts.map((_, i) => checkSaleInput(partInput(input, i), userId));
}

/**
 * Prices the cart and each part, and spreads the cart's discount/surcharge over the parts.
 * Reads only; the cart pricing fails the whole bill on a stale price or a discount larger
 * than the order.
 */
async function priceParts(t: ServiceTx, repo: ReturnType<typeof salesRepository>, input: BillSplitInput, { offline, saleAt }: { offline: boolean; saleAt: string | null }) {
  const cart = await priceSale(t, repo, {
    restaurantId: input.restaurantId, branchId: input.branchId, shiftId: input.shiftId, customerId: input.customerId,
    tableId: input.tableId, lines: input.lines, documentDiscount: input.documentDiscount, documentSurcharge: input.documentSurcharge,
  }, { offline, saleAt });
  const weights: number[] = [];
  for (let i = 0; i < input.parts.length; i++) {
    const q = await priceSale(t, repo, { ...partInput(input, i), lines: input.parts[i].lines, documentDiscount: 0, documentSurcharge: 0 }, { offline, saleAt });
    weights.push(q.linesTotal);
  }
  const discounts = spreadAmount(cart.documentDiscount, weights);
  const surcharges = spreadAmount(cart.documentSurcharge, weights);
  return { cart, discounts, surcharges };
}

export async function quoteBillSplit(input: BillSplitInput, opts: { claims: DbClaims & { sub: string } }): Promise<BillSplitQuote> {
  checkBillSplit(input, opts.claims.sub, { quote: true });
  return inServiceTx(opts.claims, async (t) => {
    const repo = salesRepository(t);
    await requireRestaurantRole(t.tx, opts.claims.sub, input.restaurantId, [...SALE_ROLES]);
    // Quotes are what the server charges now: the terminal's prices are ignored.
    const unpriced = { ...input, offline: null, lines: input.lines.map((l) => ({ ...l, unitPrice: undefined })), parts: input.parts.map((p) => ({ lines: p.lines.map((l) => ({ ...l, unitPrice: undefined })) })) };
    const { discounts, surcharges } = await priceParts(t, repo, unpriced, { offline: false, saleAt: null });
    const parts: BillSplitQuote["parts"] = [];
    for (let i = 0; i < unpriced.parts.length; i++) {
      const q = await priceSale(t, repo, { ...partInput(unpriced, i), documentDiscount: discounts[i], documentSurcharge: surcharges[i] }, { offline: false, saleAt: null });
      parts.push({ subtotal: q.subtotal, tax: q.tax, total: q.total, documentDiscount: q.documentDiscount, documentSurcharge: q.documentSurcharge });
    }
    return { parts, total: Math.round(parts.reduce((a, p) => a + p.total * 100, 0)) / 100 };
  });
}

/**
 * Records every part inside the caller's transaction (role checked, idempotency claimed).
 * Exported for the database tests, which run it in a transaction they roll back.
 */
export async function recordBillSplit(t: ServiceTx, input: BillSplitInput, userId: string, billGroupId = randomUUID()): Promise<BillSplitResult> {
  const ctxs = checkBillSplit(input, userId);
  const repo = salesRepository(t);
  const offline = !!input.offline;
  const saleAt = input.offline?.createdAt ?? null;
  const { discounts, surcharges } = await priceParts(t, repo, input, { offline, saleAt });

  const sales: BillSplitResult["sales"] = [];
  for (let i = 0; i < input.parts.length; i++) {
    const sale = await recordSale(
      t,
      repo,
      { ...partInput(input, i), documentDiscount: discounts[i], documentSurcharge: surcharges[i] },
      { ...ctxs[i], billGroupId },
    ).catch((e: unknown) => {
      // Name the part, so the cashier knows whose payment to fix; nothing has been saved.
      if (e instanceof HttpError) throw new HttpError(e.status, `Guest ${i + 1}: ${e.message}`, e.code, { ...(e.details as object | undefined), part: i + 1 });
      throw e;
    });
    sales.push({ ...sale, billPart: { groupId: billGroupId, index: i + 1, count: input.parts.length } });
  }
  return { billGroupId, sales };
}

export async function createBillSplit(input: BillSplitInput, opts: BillSplitOptions): Promise<{ result: BillSplitResult; replayed: boolean }> {
  const userId = opts.claims.sub;
  checkBillSplit(input, userId);
  return inServiceTx(opts.claims, async (t) => {
    const repo = salesRepository(t);
    await requireRestaurantRole(t.tx, userId, input.restaurantId, [...SALE_ROLES]);

    let idemId: string | null = null;
    if (opts.idempotencyKey) {
      const claim = await repo.claimIdempotencyKey(input.restaurantId, opts.idempotencyKey, opts.terminal || `web:${userId}`, ENTITY);
      if (!claim.claimed) {
        if (claim.existing?.entityType !== ENTITY || claim.existing?.status !== "completed") {
          throw new HttpError(409, "This idempotency key was already used for another request", "idempotency_conflict");
        }
        return { result: claim.existing.response as BillSplitResult, replayed: true };
      }
      idemId = claim.id;
    }

    const result = await recordBillSplit(t, input, userId);
    if (idemId) await repo.completeIdempotencyKey(idemId, result, input.shiftId ?? null);
    return { result, replayed: false };
  });
}
