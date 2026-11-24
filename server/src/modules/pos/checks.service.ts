/**
 * Open checks / running tabs (docs/plans/open-checks.md, phase 2b.1).
 *
 * A check holds an order while guests eat. Lines are priced on the server when added and keep
 * that price; "send" turns the unsent lines into a kitchen round (one ticket); "pay" records
 * the check through the ordinary sale code (recordSale, or recordBillSplit for a split bill)
 * in the same transaction, so receipts, ZATCA, stock, cash events and reports work as for any
 * sale. Table status follows the check: open → seated, send → ordered, pay → dirty, void → free.
 *
 * Every write locks the check row, checks `expectedVersion` (409 check_changed when another
 * terminal changed it since) and bumps the version; the outbox trigger on pos_checks sends the
 * change to every terminal.
 */
import { badRequest, HttpError } from "../../lib/errors.js";

const conflict = (msg: string, code: string) => new HttpError(409, msg, code);
import type { DbClaims } from "../../db.js";
import { inServiceTx, type ServiceTx } from "../shared/db.js";
import { requireRestaurantRole } from "../shared/access.js";
import { salesRepository } from "./sales.repository.js";
import { checksRepository, type CheckRow, type LineRow } from "./checks.repository.js";
import { checkSaleInput, priceSale, recordSale } from "./sales.service.js";
import { recordBillSplit } from "./bill-split.service.js";
import { priceFor } from "./pricing.js";
import type {
  AddLinesInput, CheckDetail, CheckLineInput, CheckSummary, EditLineInput, OpenCheckInput, PayCheckInput, PayCheckResult, VoidInput,
} from "./checks.schema.js";
import type { CreateSaleInput, CreateSaleResult } from "./sales.schema.js";
import { DEFAULT_PRICES_VAT_INCLUSIVE, lineGross, roundMoney, splitListed, sumMoney, VAT_RATE } from "../../../../src/lib/vatInclusive.ts";

const CHECK_ROLES = ["owner", "manager", "cashier", "waiter"] as const;
const PAY_ENTITY = "api.pos.check_pay";

type Claims = DbClaims & { sub: string };
type Repo = ReturnType<typeof checksRepository>;

async function withAccess<T>(claims: Claims, restaurantId: string, fn: (t: ServiceTx, repo: Repo) => Promise<T>) {
  return inServiceTx(claims, async (t) => {
    await requireRestaurantRole(t.tx, claims.sub, restaurantId, [...CHECK_ROLES]);
    return fn(t, checksRepository(t));
  });
}

/** The open check, locked, at the version the terminal expects. */
async function lockOpen(repo: Repo, restaurantId: string, checkId: string, expectedVersion?: number) {
  const check = await repo.check(restaurantId, checkId, { lock: true });
  if (!check) throw new HttpError(404, "Check not found", "check_not_found");
  if (check.status !== "open") throw conflict(`This check is already ${check.status}`, "check_closed");
  if (expectedVersion != null && expectedVersion !== check.version) {
    throw new HttpError(409, "Someone else changed this check; reload it and try again", "check_changed", { version: check.version });
  }
  return check;
}

/** The sale request shape of check lines, at their stored prices. */
function saleLines(lines: { menu_item_id: string | null; combo_id: string | null; size: string; quantity: number; unit_price: number }[]): CreateSaleInput["lines"] {
  return lines.map((l) =>
    l.combo_id
      ? { comboId: l.combo_id, quantity: l.quantity, unitPrice: Number(l.unit_price) }
      : { menuItemId: l.menu_item_id!, size: l.size as "regular", quantity: l.quantity, unitPrice: Number(l.unit_price) },
  );
}

/**
 * Prices new lines on the server: every item/combo must belong to the restaurant and be
 * active (priceSale's checks), and a price the terminal showed must still be current
 * (409 price_changed). Returns each line with the price it keeps.
 */
async function priceNewLines(t: ServiceTx, restaurantId: string, branchId: string | null, lines: CheckLineInput[]) {
  const sales = salesRepository(t);
  const q = await priceSale(t, sales, { restaurantId, branchId, lines: lines.map((l) => ({ ...l, note: undefined })) as CreateSaleInput["lines"] }, { offline: false, saleAt: null });
  const itemIds = [...new Set(lines.flatMap((l) => (l.menuItemId ? [l.menuItemId] : [])))];
  const comboIds = [...new Set(lines.flatMap((l) => (l.comboId ? [l.comboId] : [])))];
  const prices = new Map((await sales.menuPrices(restaurantId, branchId, q.day, itemIds)).map((p) => [p.id, p] as const));
  const combos = new Map((await sales.combos(restaurantId, comboIds)).map((c) => [c.id, c] as const));
  return lines.map((l) => ({
    menuItemId: l.menuItemId ?? null,
    comboId: l.comboId ?? null,
    size: l.comboId ? "regular" : l.size ?? "regular",
    quantity: l.quantity,
    unitPrice: l.comboId ? roundMoney(combos.get(l.comboId)!.price) : roundMoney(priceFor(prices.get(l.menuItemId!)!, l.size ?? "regular")),
    note: l.note?.trim() || null,
  }));
}

function kitchenLabel(check: CheckRow, tableLabel: string | null) {
  return [tableLabel ? `Table ${tableLabel}` : check.name, check.check_number].filter(Boolean).join(" · ");
}

async function vatOf(t: ServiceTx, restaurantId: string, branchId: string | null) {
  const v = await salesRepository(t).vatSettings(restaurantId, branchId);
  return {
    rate: v.branch?.vatRate != null ? Number(v.branch.vatRate) / 100 : VAT_RATE,
    inclusive: v.branch?.inclusive ?? DEFAULT_PRICES_VAT_INCLUSIVE,
  };
}

function totalsOf(linesTotal: number, vat: { rate: number; inclusive: boolean }) {
  const { net, vat: tax, gross } = splitListed(roundMoney(linesTotal), vat.rate, vat.inclusive);
  return { subtotal: net, tax, total: gross };
}

async function detail(t: ServiceTx, repo: Repo, restaurantId: string, checkId: string): Promise<CheckDetail> {
  const c = await repo.check(restaurantId, checkId);
  if (!c) throw new HttpError(404, "Check not found", "check_not_found");
  const [lines, rounds] = [await repo.lines(restaurantId, checkId), await repo.rounds(restaurantId, checkId)];
  const active = lines.filter((l) => l.status === "active");
  const linesTotal = sumMoney(active.map((l) => lineGross(l.unit_price, l.quantity)));
  return {
    ...summaryOf(c, {
      itemCount: active.reduce((s, l) => s + l.quantity, 0),
      unsentCount: active.filter((l) => !l.round_id).reduce((s, l) => s + l.quantity, 0),
      ...totalsOf(linesTotal, await vatOf(t, restaurantId, c.branch_id)),
    }),
    customerId: c.customer_id,
    notes: c.notes,
    lines: lines.map(lineOf),
    rounds: rounds.map((r) => ({ id: r.id, number: r.number, sentAt: r.sent_at, kdsTicketId: r.kds_ticket_id })),
  };
}

function summaryOf(c: CheckRow, x: { itemCount: number; unsentCount: number; subtotal: number; tax: number; total: number }): CheckSummary {
  return {
    id: c.id, checkNumber: c.check_number, name: c.name, status: c.status, branchId: c.branch_id, tableId: c.table_id,
    tableLabel: c.table_label, guestCount: c.guest_count, serverId: c.server_id, openedAt: String(c.opened_at), version: c.version, ...x,
  };
}

function lineOf(l: LineRow) {
  return {
    id: l.id, menuItemId: l.menu_item_id, comboId: l.combo_id, name: l.name, size: l.size, quantity: l.quantity,
    unitPrice: Number(l.unit_price), lineTotal: lineGross(Number(l.unit_price), l.quantity), note: l.note,
    roundNumber: l.round_number, status: l.status, createdAt: l.created_at,
  };
}

/** Sends unsent lines as a kitchen round and moves the table to "ordered". */
async function send(repo: Repo, restaurantId: string, check: CheckRow, userId: string) {
  const label = kitchenLabel(check, await repo.tableLabel(restaurantId, check.table_id));
  const round = await repo.sendRound(restaurantId, check, userId, label);
  if (round && check.table_id) await repo.setTableStatus(restaurantId, check.table_id, "ordered");
  return round;
}

// ---- reads ---------------------------------------------------------------------------

export async function listOpenChecks(q: { restaurantId: string; branchId?: string | null }, claims: Claims): Promise<CheckSummary[]> {
  return withAccess(claims, q.restaurantId, async (t, repo) => {
    const rows = await repo.openChecks(q.restaurantId, q.branchId ?? null);
    const vats = new Map<string, { rate: number; inclusive: boolean }>();
    const out: CheckSummary[] = [];
    for (const r of rows) {
      const key = r.branch_id ?? "";
      if (!vats.has(key)) vats.set(key, await vatOf(t, q.restaurantId, r.branch_id));
      out.push(summaryOf(r, { itemCount: r.item_count, unsentCount: r.unsent_count, ...totalsOf(r.lines_total, vats.get(key)!) }));
    }
    return out;
  });
}

export async function getCheck(id: string, restaurantId: string, claims: Claims) {
  return withAccess(claims, restaurantId, (t, repo) => detail(t, repo, restaurantId, id));
}

// ---- writes --------------------------------------------------------------------------

export async function openCheck(input: OpenCheckInput, claims: Claims): Promise<CheckDetail> {
  const userId = claims.sub;
  if (!input.tableId && !input.name?.trim()) throw badRequest("A check needs a table or a name", "check_needs_table_or_name");
  if (input.send && !input.lines?.length) throw badRequest("Nothing to send", "nothing_to_send");
  return withAccess(claims, input.restaurantId, async (t, repo) => {
    let branchId = input.branchId ?? null;
    if (input.tableId) {
      const table = await repo.table(input.restaurantId, input.tableId);
      if (!table) throw badRequest("Table not found for this restaurant", "table_not_found");
      if (branchId && table.branch_id && table.branch_id !== branchId) throw badRequest("The table belongs to another branch", "table_branch_mismatch");
      branchId = branchId ?? table.branch_id;
    }
    if (branchId) {
      const v = await salesRepository(t).vatSettings(input.restaurantId, branchId);
      if (!v.branchFound) throw badRequest("Branch not found for this restaurant", "branch_not_found");
    }
    if (input.customerId && !(await salesRepository(t).customer(input.restaurantId, input.customerId))) {
      throw badRequest("Customer not found for this restaurant", "customer_not_found");
    }
    const priced = input.lines?.length ? await priceNewLines(t, input.restaurantId, branchId, input.lines) : [];

    let checkId: string;
    try {
      checkId = await repo.insertCheck({
        restaurantId: input.restaurantId, branchId, tableId: input.tableId ?? null, checkNumber: await repo.nextCheckNumber(input.restaurantId),
        name: input.name?.trim() || null, guestCount: input.guestCount ?? null, serverId: userId, customerId: input.customerId ?? null,
        notes: input.notes?.trim() || null, openedBy: userId,
      });
    } catch (e) {
      if ((e as { code?: string }).code === "23505" && String((e as Error).message).includes("pos_checks_open_table_key")) {
        throw conflict("This table already has an open check", "table_has_open_check");
      }
      throw e;
    }
    if (input.tableId) await repo.setTableStatus(input.restaurantId, input.tableId, "seated", { guestCount: input.guestCount ?? null, serverId: userId });
    if (priced.length) await repo.insertLines(input.restaurantId, checkId, userId, priced);
    if (input.send) {
      const check = (await repo.check(input.restaurantId, checkId, { lock: true }))!;
      await send(repo, input.restaurantId, check, userId);
    }
    return detail(t, repo, input.restaurantId, checkId);
  });
}

export async function addLines(id: string, input: AddLinesInput, claims: Claims): Promise<CheckDetail> {
  return withAccess(claims, input.restaurantId, async (t, repo) => {
    const check = await lockOpen(repo, input.restaurantId, id, input.expectedVersion);
    const priced = await priceNewLines(t, input.restaurantId, check.branch_id, input.lines);
    await repo.insertLines(input.restaurantId, id, claims.sub, priced);
    if (input.send) await send(repo, input.restaurantId, check, claims.sub);
    await repo.bump(input.restaurantId, id);
    return detail(t, repo, input.restaurantId, id);
  });
}

export async function editLine(id: string, lineId: string, input: EditLineInput, claims: Claims): Promise<CheckDetail> {
  if (input.quantity == null && input.note === undefined) throw badRequest("Nothing to change", "nothing_to_change");
  return withAccess(claims, input.restaurantId, async (t, repo) => {
    await lockOpen(repo, input.restaurantId, id, input.expectedVersion);
    const line = await repo.line(input.restaurantId, id, lineId);
    if (!line || line.status !== "active") throw new HttpError(404, "Line not found", "line_not_found");
    if (line.round_id) throw conflict("This item was already sent to the kitchen", "line_sent");
    await repo.updateLine(input.restaurantId, lineId, { quantity: input.quantity, note: input.note === undefined ? undefined : input.note?.trim() || null });
    await repo.bump(input.restaurantId, id);
    return detail(t, repo, input.restaurantId, id);
  });
}

/** Removes a line that was not sent yet. Voiding sent items (with waste) is phase 2b.2. */
export async function voidLine(id: string, lineId: string, input: VoidInput, claims: Claims): Promise<CheckDetail> {
  return withAccess(claims, input.restaurantId, async (t, repo) => {
    await lockOpen(repo, input.restaurantId, id, input.expectedVersion);
    const line = await repo.line(input.restaurantId, id, lineId);
    if (!line || line.status !== "active") throw new HttpError(404, "Line not found", "line_not_found");
    if (line.round_id) throw conflict("This item was already sent to the kitchen; a manager has to void it", "line_sent");
    await repo.voidLine(input.restaurantId, lineId, claims.sub, input.reason?.trim() || null);
    await repo.bump(input.restaurantId, id);
    return detail(t, repo, input.restaurantId, id);
  });
}

export async function sendCheck(id: string, input: { restaurantId: string; expectedVersion?: number }, claims: Claims): Promise<CheckDetail> {
  return withAccess(claims, input.restaurantId, async (t, repo) => {
    const check = await lockOpen(repo, input.restaurantId, id, input.expectedVersion);
    const round = await send(repo, input.restaurantId, check, claims.sub);
    if (!round) throw badRequest("Nothing new to send to the kitchen", "nothing_to_send");
    await repo.bump(input.restaurantId, id);
    await repo.emit(input.restaurantId, id, "pos.check.sent", { check_id: id, round: round.number, kds_ticket_id: round.ticketId });
    return detail(t, repo, input.restaurantId, id);
  });
}

/** Voids a check nothing of which reached the kitchen; the table is free again. */
export async function voidCheck(id: string, input: VoidInput, claims: Claims): Promise<CheckDetail> {
  return withAccess(claims, input.restaurantId, async (t, repo) => {
    const check = await lockOpen(repo, input.restaurantId, id, input.expectedVersion);
    if (await repo.hasSentRounds(input.restaurantId, id)) {
      throw conflict("Items of this check were sent to the kitchen; a manager has to void them", "check_sent");
    }
    await repo.close(input.restaurantId, id, "void", claims.sub, input.reason?.trim() || null);
    if (check.table_id) await repo.setTableStatus(input.restaurantId, check.table_id, "free");
    await repo.bump(input.restaurantId, id);
    return detail(t, repo, input.restaurantId, id);
  });
}

/**
 * Pays the check: unsent lines are sent to the kitchen first (nothing is served unbilled),
 * then the active lines are recorded at their stored prices as one sale (`payments`) or one
 * sale per guest (`parts`, split bill), all in this transaction with the check closing.
 * Retrying with the same Idempotency-Key returns the first result.
 */
export async function payCheck(
  id: string,
  input: PayCheckInput,
  opts: { claims: Claims; idempotencyKey?: string | null; terminal?: string | null },
): Promise<PayCheckResult> {
  const userId = opts.claims.sub;
  return withAccess(opts.claims, input.restaurantId, async (t, repo) => {
    const sales = salesRepository(t);
    let idemId: string | null = null;
    if (opts.idempotencyKey) {
      const claim = await sales.claimIdempotencyKey(input.restaurantId, opts.idempotencyKey, opts.terminal || `web:${userId}`, PAY_ENTITY);
      if (!claim.claimed) {
        if (claim.existing?.entityType !== PAY_ENTITY || claim.existing?.status !== "completed") {
          throw new HttpError(409, "This idempotency key was already used for another request", "idempotency_conflict");
        }
        return { ...(claim.existing.response as PayCheckResult), replayed: true };
      }
      idemId = claim.id;
    }

    const check = await lockOpen(repo, input.restaurantId, id, input.expectedVersion);
    await send(repo, input.restaurantId, check, userId);
    const active = (await repo.lines(input.restaurantId, id)).filter((l) => l.status === "active");
    if (!active.length) throw badRequest("The check has no items to pay", "check_empty");

    const base = {
      restaurantId: input.restaurantId,
      branchId: check.branch_id,
      shiftId: input.shiftId ?? null,
      customerId: input.customerId ?? check.customer_id ?? null,
      tableId: check.table_id,
      lines: saleLines(active),
      documentDiscount: input.documentDiscount,
      documentSurcharge: input.documentSurcharge,
    };

    let saleResults: CreateSaleResult[];
    let billGroupId: string | null = null;
    if (input.parts?.length) {
      const res = await recordBillSplit(t, { ...base, parts: input.parts }, userId, undefined, { checkId: id });
      saleResults = res.sales;
      billGroupId = res.billGroupId;
    } else {
      const saleInput: CreateSaleInput = { ...base, payments: input.payments ?? null };
      const ctx = { ...checkSaleInput(saleInput, userId), checkId: id, priceLocked: true };
      saleResults = [await recordSale(t, sales, saleInput, ctx)];
    }

    await repo.close(input.restaurantId, id, "paid", userId);
    if (check.table_id) await repo.setTableStatus(input.restaurantId, check.table_id, "dirty");
    await repo.bump(input.restaurantId, id);
    await repo.emit(input.restaurantId, id, "pos.check.paid", {
      check_id: id, receipts: saleResults.map((s) => s.receiptNumber), bill_group_id: billGroupId,
    });
    const result: PayCheckResult = { check: await detail(t, repo, input.restaurantId, id), sales: saleResults, billGroupId };
    if (idemId) await sales.completeIdempotencyKey(idemId, result, input.shiftId ?? null);
    return result;
  });
}

export type { Claims as CheckClaims };
