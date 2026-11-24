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
import { requireRestaurantRole, type RestaurantAccess } from "../shared/access.js";
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

async function withAccess<T>(claims: Claims, restaurantId: string, fn: (t: ServiceTx, repo: Repo, access: RestaurantAccess) => Promise<T>) {
  return inServiceTx(claims, async (t) => {
    const access = await requireRestaurantRole(t.tx, claims.sub, restaurantId, [...CHECK_ROLES]);
    return fn(t, checksRepository(t), access);
  });
}

/**
 * Manager-level actions (voiding items already sent to the kitchen, waiving the service
 * charge): an owner/manager by role, or anyone else with the restaurant's admin PIN.
 */
async function managerApproval(repo: Repo, access: RestaurantAccess, restaurantId: string, userId: string, adminPin?: string | null) {
  if (access.superadmin || access.roles.some((r) => r === "owner" || r === "manager")) return { approval: "role" as const, approvedBy: userId };
  if (adminPin && /^\d{4,12}$/.test(adminPin) && (await repo.adminPinMatches(restaurantId, adminPin))) {
    return { approval: "admin_pin" as const, approvedBy: null };
  }
  throw new HttpError(403, adminPin ? "Incorrect admin PIN" : "A manager or the admin PIN is needed", adminPin ? "admin_pin_invalid" : "manager_required");
}

function requireReason(reason?: string | null) {
  const r = reason?.trim();
  if (!r || r.length < 3) throw badRequest("Give a reason (at least 3 characters)", "reason_required");
  return r;
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
      ...withService(linesTotal, await repo.serviceChargePercent(restaurantId, c.branch_id), c.service_charge_waived, await vatOf(t, restaurantId, c.branch_id)),
    }),
    serviceChargeWaiveReason: c.service_charge_waived ? (c as CheckRow & { service_charge_waive_reason?: string | null }).service_charge_waive_reason ?? null : null,
    customerId: c.customer_id,
    notes: c.notes,
    lines: lines.map(lineOf),
    rounds: rounds.map((r) => ({ id: r.id, number: r.number, sentAt: r.sent_at, kdsTicketId: r.kds_ticket_id })),
  };
}

/**
 * Totals with the branch service charge: a percent of the lines (listed amounts, before VAT is
 * split), unless waived on this check. Paying charges it as the sale's document surcharge.
 */
function withService(linesTotal: number, percent: number, waived: boolean, vat: { rate: number; inclusive: boolean }) {
  const serviceCharge = waived || !(percent > 0) ? 0 : roundMoney((linesTotal * percent) / 100);
  return { ...totalsOf(linesTotal + serviceCharge, vat), linesTotal: roundMoney(linesTotal), serviceChargePercent: percent, serviceCharge, serviceChargeWaived: waived };
}

function summaryOf(c: CheckRow, x: Omit<CheckSummary, "id" | "checkNumber" | "name" | "status" | "branchId" | "tableId" | "tableLabel" | "guestCount" | "serverId" | "openedAt" | "version">): CheckSummary {
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
  return withAccess(claims, q.restaurantId, (t, repo) => listOpenChecksIn(t, repo, q.restaurantId, q.branchId ?? null));
}

async function listOpenChecksIn(t: ServiceTx, repo: Repo, restaurantId: string, branchId: string | null): Promise<CheckSummary[]> {
  const q = { restaurantId, branchId };
  {
    const rows = await repo.openChecks(q.restaurantId, q.branchId ?? null);
    const vats = new Map<string, { rate: number; inclusive: boolean; pct: number }>();
    const out: CheckSummary[] = [];
    for (const r of rows) {
      const key = r.branch_id ?? "";
      if (!vats.has(key)) vats.set(key, { ...(await vatOf(t, q.restaurantId, r.branch_id)), pct: await repo.serviceChargePercent(q.restaurantId, r.branch_id) });
      const v = vats.get(key)!;
      out.push(summaryOf(r, { itemCount: r.item_count, unsentCount: r.unsent_count, ...withService(r.lines_total, v.pct, r.service_charge_waived, v) }));
    }
    return out;
  }
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

/**
 * Removes a line, or `quantity` units of it. Not sent yet: anyone. Already sent to the
 * kitchen: a manager (or the admin PIN) with a reason; its kitchen item is cancelled and the
 * units are recorded as waste of their recipe ingredients (stock lowered, expense posted).
 */
export async function voidLine(id: string, lineId: string, input: VoidInput, claims: Claims): Promise<CheckDetail> {
  return withAccess(claims, input.restaurantId, async (t, repo, access) => {
    const check = await lockOpen(repo, input.restaurantId, id, input.expectedVersion);
    const line = await repo.lineFull(input.restaurantId, id, lineId);
    if (!line || line.status !== "active") throw new HttpError(404, "Line not found", "line_not_found");
    const quantity = Math.min(input.quantity ?? line.quantity, line.quantity);
    if (!line.round_id) {
      await repo.voidUnits(input.restaurantId, line, quantity, { userId: claims.sub, reason: input.reason?.trim() || null, approval: "unsent", approvedBy: null });
    } else {
      const reason = requireReason(input.reason);
      const ok = await managerApproval(repo, access, input.restaurantId, claims.sub, input.adminPin);
      await voidSentUnits(repo, input.restaurantId, check, line, quantity, claims.sub, reason, ok);
    }
    await repo.bump(input.restaurantId, id);
    return detail(t, repo, input.restaurantId, id);
  });
}

async function voidSentUnits(
  repo: Repo,
  restaurantId: string,
  check: CheckRow,
  line: { id: string; menu_item_id: string | null; combo_id: string | null; quantity: number },
  quantity: number,
  userId: string,
  reason: string,
  ok: { approval: string; approvedBy: string | null },
) {
  const voidedId = await repo.voidUnits(restaurantId, line, quantity, { userId, reason, ...ok });
  await repo.cancelKitchenUnits(restaurantId, line.id, quantity, line.quantity);
  await repo.recordWaste(restaurantId, {
    lineId: voidedId, menuItemId: line.menu_item_id, comboId: line.combo_id, quantity, userId,
    notes: `Voided from ${check.check_number}: ${reason}`,
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

/**
 * Voids a whole check; the table is free again. If items were sent to the kitchen, a manager
 * (or the admin PIN) and a reason are needed, and every sent item is voided as waste.
 */
export async function voidCheck(id: string, input: VoidInput, claims: Claims): Promise<CheckDetail> {
  return withAccess(claims, input.restaurantId, async (t, repo, access) => {
    const check = await lockOpen(repo, input.restaurantId, id, input.expectedVersion);
    let reason = input.reason?.trim() || null;
    if (await repo.hasSentRounds(input.restaurantId, id)) {
      reason = requireReason(input.reason);
      const ok = await managerApproval(repo, access, input.restaurantId, claims.sub, input.adminPin);
      for (const l of (await repo.lines(input.restaurantId, id)).filter((x) => x.status === "active" && x.round_id)) {
        const line = (await repo.lineFull(input.restaurantId, id, l.id))!;
        await voidSentUnits(repo, input.restaurantId, check, line, line.quantity, claims.sub, reason, ok);
      }
    }
    await repo.close(input.restaurantId, id, "void", claims.sub, reason);
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

    // The branch service charge is the sale's document surcharge (computed here, never sent by
    // the terminal), so it is in the VAT base and on the ZATCA invoice.
    const linesTotal = sumMoney(active.map((l) => lineGross(Number(l.unit_price), l.quantity)));
    const service = withService(linesTotal, await repo.serviceChargePercent(input.restaurantId, check.branch_id), check.service_charge_waived, { rate: 0, inclusive: true });
    const base = {
      restaurantId: input.restaurantId,
      branchId: check.branch_id,
      shiftId: input.shiftId ?? null,
      customerId: input.customerId ?? check.customer_id ?? null,
      tableId: check.table_id,
      lines: saleLines(active),
      documentSurcharge: service.serviceCharge,
    };

    let saleResults: CreateSaleResult[];
    let billGroupId: string | null = null;
    if (input.parts?.length) {
      const res = await recordBillSplit(t, { ...base, parts: input.parts }, userId, undefined, { checkId: id, serviceChargeFromSurcharge: true });
      saleResults = res.sales;
      billGroupId = res.billGroupId;
    } else {
      const saleInput: CreateSaleInput = { ...base, payments: input.payments ?? null };
      const ctx = { ...checkSaleInput(saleInput, userId), checkId: id, priceLocked: true, serviceChargeFromSurcharge: true };
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

/** Moves a check to another free table of its branch; the old table needs clearing. */
export async function moveCheck(id: string, input: { restaurantId: string; expectedVersion?: number; tableId: string }, claims: Claims): Promise<CheckDetail> {
  return withAccess(claims, input.restaurantId, async (t, repo) => {
    const check = await lockOpen(repo, input.restaurantId, id, input.expectedVersion);
    if (check.table_id === input.tableId) throw badRequest("The check is already on this table", "same_table");
    const table = await repo.table(input.restaurantId, input.tableId);
    if (!table) throw badRequest("Table not found for this restaurant", "table_not_found");
    if (check.branch_id && table.branch_id && table.branch_id !== check.branch_id) throw badRequest("The table belongs to another branch", "table_branch_mismatch");
    try {
      await repo.moveTo(input.restaurantId, id, input.tableId);
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw conflict("That table already has an open check", "table_has_open_check");
      throw e;
    }
    const sent = await repo.hasSentRounds(input.restaurantId, id);
    await repo.setTableStatus(input.restaurantId, input.tableId, sent ? "ordered" : "seated", { guestCount: check.guest_count, serverId: check.server_id });
    if (check.table_id) await repo.setTableStatus(input.restaurantId, check.table_id, "dirty");
    await repo.bump(input.restaurantId, id);
    return detail(t, repo, input.restaurantId, id);
  });
}

/** Merges another open check of the branch into this one (tables pushed together). */
export async function mergeChecks(id: string, input: { restaurantId: string; expectedVersion?: number; fromCheckId: string }, claims: Claims): Promise<CheckDetail> {
  if (id === input.fromCheckId) throw badRequest("A check can't be merged into itself", "same_check");
  return withAccess(claims, input.restaurantId, async (t, repo) => {
    // Lock both in a fixed order so two terminals merging the same pair can't deadlock.
    const [firstId, secondId] = [id, input.fromCheckId].sort();
    const first = await lockOpen(repo, input.restaurantId, firstId, firstId === id ? input.expectedVersion : undefined);
    const second = await lockOpen(repo, input.restaurantId, secondId, secondId === id ? input.expectedVersion : undefined);
    const [into, from] = firstId === id ? [first, second] : [second, first];
    if ((into.branch_id ?? null) !== (from.branch_id ?? null)) throw badRequest("Checks of different branches can't be merged", "branch_mismatch");
    await repo.mergeInto(input.restaurantId, into.id, from.id, claims.sub);
    if (from.table_id) await repo.setTableStatus(input.restaurantId, from.table_id, "dirty");
    await repo.bump(input.restaurantId, from.id);
    await repo.bump(input.restaurantId, into.id);
    return detail(t, repo, input.restaurantId, into.id);
  });
}

/** The guest bill before payment (not a tax invoice); the table shows "billing". */
export async function prebill(id: string, input: { restaurantId: string; expectedVersion?: number }, claims: Claims): Promise<CheckDetail> {
  return withAccess(claims, input.restaurantId, async (t, repo) => {
    const check = await lockOpen(repo, input.restaurantId, id, input.expectedVersion);
    if (check.table_id) await repo.setTableStatus(input.restaurantId, check.table_id, "billing");
    await repo.bump(input.restaurantId, id);
    return detail(t, repo, input.restaurantId, id);
  });
}

/** Waives (manager or admin PIN, with a reason) or restores the service charge on a check. */
export async function setServiceCharge(
  id: string,
  input: { restaurantId: string; expectedVersion?: number; waived: boolean; reason?: string | null; adminPin?: string | null },
  claims: Claims,
): Promise<CheckDetail> {
  return withAccess(claims, input.restaurantId, async (t, repo, access) => {
    await lockOpen(repo, input.restaurantId, id, input.expectedVersion);
    let reason: string | null = null;
    if (input.waived) {
      reason = requireReason(input.reason);
      await managerApproval(repo, access, input.restaurantId, claims.sub, input.adminPin);
    }
    await repo.setServiceChargeWaived(input.restaurantId, id, input.waived, claims.sub, reason);
    await repo.bump(input.restaurantId, id);
    return detail(t, repo, input.restaurantId, id);
  });
}

/** Open-checks report for a business day: open checks now, paid checks, service charge, voids and waste. */
export async function checksReport(q: { restaurantId: string; branchId?: string | null; day?: string | null }, claims: Claims) {
  return withAccess(claims, q.restaurantId, async (t, repo, access) => {
    if (!access.superadmin && !access.roles.some((r) => r === "owner" || r === "manager")) {
      throw new HttpError(403, "Only owners and managers see this report", "role_forbidden");
    }
    const day = q.day ?? (await repo.businessDay(q.restaurantId));
    const open = await listOpenChecksIn(t, repo, q.restaurantId, q.branchId ?? null);
    const voids = await repo.voidsOfDay(q.restaurantId, q.branchId ?? null, day);
    const totals = await repo.dayTotals(q.restaurantId, q.branchId ?? null, day);
    return {
      day,
      open: { count: open.length, total: roundMoney(open.reduce((s, c) => s + c.total, 0)), checks: open },
      paid: { checks: totals.paid_checks, sales: roundMoney(totals.checks_sales), serviceCharge: roundMoney(totals.service_charge) },
      voids: {
        count: voids.length,
        value: roundMoney(voids.reduce((s, v) => s + v.line_total, 0)),
        wasteCost: roundMoney(voids.reduce((s, v) => s + v.waste_cost, 0)),
        items: voids.map((v) => ({ checkNumber: v.check_number, name: v.name, quantity: v.quantity, reason: v.reason, approval: v.approval, voidedBy: v.voided_by, voidedAt: v.voided_at, value: v.line_total, wasteCost: roundMoney(v.waste_cost) })),
      },
    };
  });
}

export type { Claims as CheckClaims };
