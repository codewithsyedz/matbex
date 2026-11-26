/**
 * Manual journal entries: post, void, reverse. Each runs in one transaction
 * (docs/plans/ledger-integrity.md, phase B).
 *
 * - Posting: the entry is checked here (two or more lines, one side each, debits = credits to
 *   the cent, accounts and branch in the caller's business, open period). Owners and managers
 *   post directly; accountants (when the business allows them to post journals) submit it for
 *   approval through submit_pending_journal_entry, which notifies owners and managers, and
 *   approve_journal_entry posts it later.
 * - Void: flags every line of the entry voided (flag-only, like every void in the ledger) while
 *   its period is open. Owner/manager only.
 * - Reverse: posts a mirror entry (reference_type journal_entry_reversal, each line linked to the
 *   line it reverses) dated in an open period, for entries in a locked period or when the
 *   correction should show in the current month. Owner/manager only.
 * Only manual entries (lines with reference_type 'journal_entry') are handled here. Postings from
 * sales, expenses, payroll and so on are corrected from their source document, and AP
 * settlement batches through the payment reversal flow.
 */
import { badRequest, forbidden, HttpError, notFound } from "../../lib/errors.js";
import type { DbClaims } from "../../db.js";
import { inServiceTx } from "../shared/db.js";
import { requireRestaurantRole } from "../shared/access.js";
import { ledgerRepository } from "./ledger.repository.js";
import type { CreateJournalInput, JournalEntryResult, ReverseInput, VoidInput } from "./ledger.schema.js";
import { roundMoney, sumMoney } from "../../../../src/lib/vatInclusive.ts";

type Claims = DbClaims & { sub: string };
const conflict = (msg: string, code: string, details?: unknown) => new HttpError(409, msg, code, details);
const periodLocked = (day: string) =>
  conflict(`The period containing ${day} is locked. Reverse the entry in an open period instead.`, "period_locked", { date: day });
const isSettlementBatch = (ref: string | null) => !!ref && (ref.startsWith("EXPPAY-") || ref.startsWith("EXPPAYREV-"));

/** Database refusals that reach us despite the checks above, as 4xx instead of 500. */
function mapDbError(e: unknown): never {
  if (e instanceof HttpError) throw e;
  const err = e as { code?: string; message?: string };
  const msg = err.message ?? "";
  if (err.code === "55006" || /locked period|period containing .* is locked/i.test(msg)) {
    throw conflict("This date is in a locked period.", "period_locked");
  }
  if (err.code === "42501" || /not authori[sz]ed|not allowed|only owners/i.test(msg)) throw forbidden(msg, "role_forbidden");
  if (/unbalanced|out of balance/i.test(msg)) throw badRequest(msg, "unbalanced");
  if (/immutable|cannot be edited|BRANCH_LINE_MISMATCH|REVERSAL_/i.test(msg)) throw conflict(msg, "ledger_rejected");
  throw e;
}

export function normalizeLines(lines: CreateJournalInput["lines"]) {
  const out = lines.map((l, i) => {
    const debit = roundMoney(Number(l.debit ?? 0));
    const credit = roundMoney(Number(l.credit ?? 0));
    if (debit > 0 && credit > 0) throw badRequest(`Line ${i + 1} has both a debit and a credit`, "line_both_sides");
    if (debit <= 0 && credit <= 0) throw badRequest(`Line ${i + 1} needs a debit or a credit`, "line_empty");
    return { accountId: l.accountId, debit: debit > 0 ? debit : null, credit: credit > 0 ? credit : null, description: l.description?.trim() || null };
  });
  const totalDebit = sumMoney(out.map((l) => l.debit ?? 0));
  const totalCredit = sumMoney(out.map((l) => l.credit ?? 0));
  if (totalDebit !== totalCredit) {
    throw new HttpError(400, `Debits (${totalDebit.toFixed(2)}) must equal credits (${totalCredit.toFixed(2)})`, "unbalanced",
      { totalDebit, totalCredit });
  }
  return { lines: out, totalDebit };
}

export async function createJournalEntry(input: CreateJournalInput, claims: Claims): Promise<JournalEntryResult> {
  const { lines, totalDebit } = normalizeLines(input.lines);
  const description = input.description.trim();
  if (!description) throw badRequest("A description is required", "description_required");
  const entryType = input.entryType ?? "adjustment";
  const branchId = input.branchId ?? null;

  return inServiceTx(claims, async (t) => {
    const repo = ledgerRepository(t);
    const access = await requireRestaurantRole(t.tx, claims.sub, input.restaurantId, ["owner", "manager", "accountant"]);
    const tenantId = access.tenantId;

    const bad = await repo.invalidAccounts(tenantId, [...new Set(lines.map((l) => l.accountId))]);
    if (bad.length) throw new HttpError(400, "One or more accounts are not active accounts of this business", "account_invalid", { accountIds: bad });
    if (branchId) {
      if (!(await repo.branchInTenant(tenantId, branchId))) throw forbidden("Branch does not belong to this business", "branch_forbidden");
      if (!(await repo.canAccessBranch(branchId))) throw forbidden("You do not have access to this branch", "branch_forbidden");
    }
    if (await repo.periodLocked(tenantId, input.restaurantId, input.date)) {
      throw conflict(`The period containing ${input.date} is locked. Choose a date in an open period.`, "period_locked", { date: input.date });
    }

    try {
      if (await repo.canApprove(claims.sub, tenantId)) {
        const id = await repo.insertPostedBatch({
          tenantId, date: input.date, description, referenceNumber: input.referenceNumber ?? null, entryType, branchId, userId: claims.sub,
        });
        await repo.insertLines(lines.map((l) => ({
          tenantId, accountId: l.accountId, date: input.date, debit: l.debit, credit: l.credit,
          description: l.description ?? description, referenceType: "journal_entry", referenceId: id, batchId: id,
          branchId, userId: claims.sub,
        })));
        return { id, status: "posted", date: input.date, totalDebit, lineCount: lines.length };
      }

      // Accountant: the approval queue (submit_pending_journal_entry checks the business allows it).
      if ((await repo.profileTenant(claims.sub)) !== tenantId) throw forbidden("Switch to this business to submit entries", "tenant_mismatch");
      const id = await repo.submitPending({
        description, entryType, date: input.date, referenceNumber: input.referenceNumber ?? null, branchId,
        lines: lines.map((l) => ({ account_id: l.accountId, debit: l.debit, credit: l.credit, description: l.description })),
      });
      return { id, status: "pending", date: input.date, totalDebit, lineCount: lines.length };
    } catch (e) {
      mapDbError(e);
    }
  });
}

/** Loads a posted manual entry the caller may correct, with its live lines. */
async function correctable(repo: ReturnType<typeof ledgerRepository>, claims: Claims, tenantId: string, id: string) {
  if (!(await repo.canApprove(claims.sub, tenantId))) {
    throw forbidden("Only an owner or manager can void or reverse a journal entry. Submit a correcting entry instead.", "role_forbidden");
  }
  const batch = await repo.batch(tenantId, id, true);
  if (!batch) throw notFound("Journal entry not found", "journal_entry_not_found");
  if (isSettlementBatch(batch.reference_number)) {
    throw conflict("Supplier payment entries are corrected with the payment reversal flow.", "entry_protected");
  }
  if (batch.approval_status !== "approved" || !batch.is_posted) {
    throw conflict(`This entry is ${batch.approval_status}, not posted`, "entry_not_posted");
  }
  if (!(await repo.canAccessBranch(batch.branch_id))) throw forbidden("You do not have access to this branch", "branch_forbidden");
  const lines = await repo.liveLines(tenantId, id);
  if (!lines.length) {
    if (await repo.countVoidedLines(tenantId, id)) throw conflict("This entry is already voided", "already_voided");
    throw conflict("This entry was posted by another part of Matbex. Correct it from its source document.", "not_manual_entry");
  }
  const reversal = await repo.reversalOf(tenantId, lines.map((l) => l.id));
  if (reversal) throw conflict("This entry has already been reversed", "already_reversed", { reversalId: reversal });
  return { batch, lines };
}

export async function voidJournalEntry(id: string, input: VoidInput, claims: Claims): Promise<JournalEntryResult> {
  const reason = input.reason.trim();
  return inServiceTx(claims, async (t) => {
    const repo = ledgerRepository(t);
    const access = await requireRestaurantRole(t.tx, claims.sub, input.restaurantId, ["owner", "manager"]);
    const { batch, lines } = await correctable(repo, claims, access.tenantId, id);
    const dates = [...new Set([batch.batch_date, ...lines.map((l) => l.transaction_date)])];
    for (const day of dates) {
      if (await repo.periodLocked(access.tenantId, input.restaurantId, day)) throw periodLocked(day);
    }
    try {
      await repo.voidLines(access.tenantId, lines.map((l) => l.id), claims.sub, reason);
      await repo.audit("JOURNAL_ENTRY_VOIDED", id, { reason, line_ids: lines.map((l) => l.id) }, access.tenantId);
    } catch (e) {
      mapDbError(e);
    }
    return { id, status: "voided", date: batch.batch_date, totalDebit: sumMoney(lines.map((l) => l.debit ?? 0)), lineCount: lines.length };
  });
}

export async function reverseJournalEntry(id: string, input: ReverseInput, claims: Claims): Promise<JournalEntryResult> {
  const reason = input.reason.trim();
  return inServiceTx(claims, async (t) => {
    const repo = ledgerRepository(t);
    const access = await requireRestaurantRole(t.tx, claims.sub, input.restaurantId, ["owner", "manager"]);
    const tenantId = access.tenantId;
    const { batch, lines } = await correctable(repo, claims, tenantId, id);
    const day = input.date ?? (await repo.today(input.restaurantId));
    if (day < batch.batch_date) throw badRequest("A reversal cannot be dated before the entry it reverses", "date_before_original");
    if (await repo.periodLocked(tenantId, input.restaurantId, day)) {
      throw conflict(`The period containing ${day} is locked. Choose a date in an open period.`, "period_locked", { date: day });
    }
    const description = `Reversal of: ${batch.description} (${reason})`.slice(0, 500);
    try {
      const reversalId = await repo.insertPostedBatch({
        tenantId, date: day, description, referenceNumber: batch.reference_number, entryType: "reversal",
        branchId: batch.branch_id, userId: claims.sub,
      });
      await repo.insertLines(lines.map((l) => ({
        tenantId, accountId: l.account_id, date: day, debit: l.credit, credit: l.debit,
        description: `REVERSAL: ${l.description ?? batch.description}`.slice(0, 500),
        referenceType: "journal_entry_reversal", referenceId: l.reference_id ?? id, batchId: reversalId,
        branchId: l.branch_id, userId: claims.sub, originalId: l.id,
      })));
      await repo.audit("JOURNAL_ENTRY_REVERSED", id, { reason, reversal_id: reversalId, date: day }, tenantId);
      return { id: reversalId, status: "posted", date: day, totalDebit: sumMoney(lines.map((l) => l.credit ?? 0)), lineCount: lines.length, reversalOf: id };
    } catch (e) {
      mapDbError(e);
    }
  });
}
