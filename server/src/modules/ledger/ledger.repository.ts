/**
 * Data access for manual journal entries. Modules run as the table owner: every query here is
 * scoped by tenant_id. Ledger triggers still run on these writes (account tenant, branch,
 * fiscal lock, reversal mirror, account balance), so the database stays the last check.
 */
import type { ServiceTx } from "../shared/db.js";

export interface Batch {
  id: string;
  tenant_id: string;
  batch_date: string;
  description: string;
  reference_number: string | null;
  entry_type: string;
  approval_status: string;
  is_posted: boolean;
  branch_id: string | null;
}

export interface LedgerLine {
  id: string;
  account_id: string;
  debit: number | null;
  credit: number | null;
  description: string | null;
  reference_id: string | null;
  branch_id: string | null;
  transaction_date: string;
}

export function ledgerRepository({ tx }: ServiceTx) {
  return {
    /** Owner/manager/superadmin by the same rule as the database's approval checks. */
    async canApprove(userId: string, tenantId: string) {
      const [r] = await tx<{ ok: boolean }[]>`
        select public.is_superadmin(${userId}::uuid)
            or public.has_tenant_role(${userId}::uuid, ${tenantId}::uuid, 'owner'::public.app_role)
            or public.has_tenant_role(${userId}::uuid, ${tenantId}::uuid, 'manager'::public.app_role) as ok`;
      return r.ok;
    },

    async profileTenant(userId: string) {
      const [r] = await tx<{ tenant_id: string | null }[]>`select tenant_id from public.profiles where id = ${userId}`;
      return r?.tenant_id ?? null;
    },

    async today(restaurantId: string) {
      const [r] = await tx<{ day: string }[]>`
        select ((now() at time zone coalesce(r.timezone, 'Asia/Riyadh'))::date)::text as day
          from public.restaurants r where r.id = ${restaurantId}`;
      return r.day;
    },

    /** Account ids from `ids` that are missing, inactive or belong to another business. */
    async invalidAccounts(tenantId: string, ids: string[]) {
      const rows = await tx<{ id: string }[]>`
        select a.id from unnest(${ids}::uuid[]) as a(id)
         where not exists (select 1 from public.chart_of_accounts c
                            where c.id = a.id and c.tenant_id = ${tenantId} and coalesce(c.is_active, true))`;
      return rows.map((r) => r.id);
    },

    async branchInTenant(tenantId: string, branchId: string) {
      const [r] = await tx<{ ok: boolean }[]>`
        select exists (select 1 from public.branches b join public.restaurants r on r.id = b.restaurant_id
                        where b.id = ${branchId} and r.tenant_id = ${tenantId}) as ok`;
      return r.ok;
    },

    async canAccessBranch(branchId: string | null) {
      const [r] = await tx<{ ok: boolean }[]>`select public.can_access_journal_branch(${branchId}::uuid) as ok`;
      return r.ok;
    },

    /** Locked by a tenant-wide or a restaurant fiscal period lock (the two ledger triggers). */
    async periodLocked(tenantId: string, restaurantId: string, day: string) {
      const [r] = await tx<{ locked: boolean }[]>`
        select exists (select 1 from public.fiscal_period_locks
                        where tenant_id = ${tenantId} and is_locked and unlocked_at is null
                          and ${day}::date between period_start and period_end)
            or public.is_period_locked(${restaurantId}::uuid, ${day}::date) as locked`;
      return r.locked;
    },

    async batch(tenantId: string, id: string, lock = false) {
      const rows = lock
        ? await tx<Batch[]>`
            select id, tenant_id, batch_date::text as batch_date, description, reference_number, entry_type,
                   approval_status, is_posted, branch_id
              from public.journal_entry_batches where id = ${id} and tenant_id = ${tenantId} for update`
        : await tx<Batch[]>`
            select id, tenant_id, batch_date::text as batch_date, description, reference_number, entry_type,
                   approval_status, is_posted, branch_id
              from public.journal_entry_batches where id = ${id} and tenant_id = ${tenantId}`;
      return rows[0] ?? null;
    },

    /** The entry's own posted lines (not reversal lines that point back at it). */
    async liveLines(tenantId: string, batchId: string) {
      return tx<LedgerLine[]>`
        select id, account_id, debit::float8 as debit, credit::float8 as credit, description, reference_id,
               branch_id, transaction_date::text as transaction_date
          from public.account_transactions
         where tenant_id = ${tenantId} and batch_id = ${batchId} and reference_type = 'journal_entry'
           and not coalesce(is_voided, false)
         order by created_at, id`;
    },

    async countVoidedLines(tenantId: string, batchId: string) {
      const [r] = await tx<{ n: number }[]>`
        select count(*)::int as n from public.account_transactions
         where tenant_id = ${tenantId} and batch_id = ${batchId} and reference_type = 'journal_entry' and is_voided`;
      return r.n;
    },

    /** Batch id of an existing live reversal of any of these lines. */
    async reversalOf(tenantId: string, lineIds: string[]) {
      const [r] = await tx<{ batch_id: string }[]>`
        select batch_id from public.account_transactions
         where tenant_id = ${tenantId} and original_transaction_id = any(${lineIds}::uuid[])
           and not coalesce(is_voided, false)
         limit 1`;
      return r?.batch_id ?? null;
    },

    async insertPostedBatch(b: {
      tenantId: string; date: string; description: string; referenceNumber: string | null;
      entryType: string; branchId: string | null; userId: string;
    }) {
      const [r] = await tx<{ id: string }[]>`
        insert into public.journal_entry_batches
          (tenant_id, batch_date, description, reference_number, entry_type, journal_type, branch_id,
           created_by, is_posted, posted_at, posted_by, approval_status, approved_by, approved_at)
        values (${b.tenantId}, ${b.date}, ${b.description}, ${b.referenceNumber}, ${b.entryType}, ${b.entryType},
                ${b.branchId}, ${b.userId}, true, now(), ${b.userId}, 'approved', ${b.userId}, now())
        returning id`;
      return r.id;
    },

    async insertLines(rows: {
      tenantId: string; accountId: string; date: string; debit: number | null; credit: number | null;
      description: string; referenceType: string; referenceId: string; batchId: string;
      branchId: string | null; userId: string; originalId?: string | null;
    }[]) {
      for (const l of rows) {
        await tx`
          insert into public.account_transactions
            (tenant_id, account_id, transaction_date, debit, credit, description, reference_type, reference_id,
             batch_id, branch_id, created_by, original_transaction_id)
          values (${l.tenantId}, ${l.accountId}, ${l.date}, ${l.debit}, ${l.credit}, ${l.description}, ${l.referenceType},
                  ${l.referenceId}, ${l.batchId}, ${l.branchId}, ${l.userId}, ${l.originalId ?? null})`;
      }
    },

    async submitPending(input: {
      description: string; entryType: string; date: string; referenceNumber: string | null;
      branchId: string | null; lines: { account_id: string; debit: number | null; credit: number | null; description: string | null }[];
    }) {
      const [r] = await tx<{ id: string }[]>`
        select public.submit_pending_journal_entry(
          ${input.description}, ${input.entryType}, ${input.entryType}, ${input.date}::date,
          ${input.referenceNumber}, ${JSON.stringify(input.lines)}::jsonb, ${input.branchId}::uuid) as id`;
      return r.id;
    },

    async voidLines(tenantId: string, ids: string[], userId: string, reason: string) {
      await tx`
        update public.account_transactions
           set is_voided = true, voided_at = now(), voided_by = ${userId}, void_reason = ${reason}
         where tenant_id = ${tenantId} and id = any(${ids}::uuid[]) and not coalesce(is_voided, false)`;
    },

    async audit(action: string, batchId: string, data: unknown, tenantId: string) {
      await tx`select public.log_audit(${action}, 'journal_entry_batch', ${batchId}::uuid, null, ${JSON.stringify(data)}::jsonb, ${tenantId}::uuid)`;
    },
  };
}
