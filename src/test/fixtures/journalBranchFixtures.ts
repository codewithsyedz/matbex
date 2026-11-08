/**
 * Deterministic fixtures for the pending-journal-entry branch-scoping suite.
 *
 * Mirrors the production shape after the branch backfill migration:
 *   - 171 previously-untagged batches that were backfilled to a branch
 *     (`_backfilled: true` marks them, it is not a DB column)
 *   - a handful of natively-tagged batches per branch
 *   - legacy batches that are still `branch_id = null`
 *
 * Every expectation below is derived from these rows, so dropping the
 * `branch_id` filter (or loosening it to "branch OR null") fails the tests.
 */
export const TENANT_ID = "tenant-0001";
export const BRANCH_MAIN = "branch-main";
export const BRANCH_WADI = "branch-wadi";

export type JournalBatchRow = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  batch_date: string;
  approval_status: "pending" | "approved" | "rejected";
  is_posted: boolean;
  description: string;
  created_at: string;
  entry_type: string;
  _backfilled?: boolean;
};

/** How the 171 backfilled batches were split by the migration. */
export const BACKFILL = {
  total: 171,
  main: 135,
  wadi: 36,
};

const dayOf = (i: number) => {
  // Spread across 2026-06-24 .. 2026-08-03 (the real pending window).
  const start = Date.UTC(2026, 5, 24);
  const d = new Date(start + (i % 41) * 86_400_000);
  return d.toISOString().slice(0, 10);
};

function makeBackfilled(): JournalBatchRow[] {
  const rows: JournalBatchRow[] = [];
  for (let i = 0; i < BACKFILL.total; i++) {
    const branch = i < BACKFILL.main ? BRANCH_MAIN : BRANCH_WADI;
    rows.push({
      id: `bf-${i}`,
      tenant_id: TENANT_ID,
      branch_id: branch,
      batch_date: dayOf(i),
      approval_status: "pending",
      is_posted: false,
      description: `Backfilled day-end batch ${i}`,
      created_at: `${dayOf(i)}T10:00:00.000Z`,
      entry_type: "adjustment",
      _backfilled: true,
    });
  }
  return rows;
}

export const backfilledBatches = makeBackfilled();

/** Natively branch-tagged entries created after the migration. */
export const nativeBatches: JournalBatchRow[] = [
  { id: "n1", tenant_id: TENANT_ID, branch_id: BRANCH_MAIN, batch_date: "2026-08-01", approval_status: "pending", is_posted: false, description: "Main correction", created_at: "2026-08-01T08:00:00.000Z", entry_type: "correction" },
  { id: "n2", tenant_id: TENANT_ID, branch_id: BRANCH_MAIN, batch_date: "2026-08-02", approval_status: "approved", is_posted: true, description: "Main approved", created_at: "2026-08-02T08:00:00.000Z", entry_type: "adjustment" },
  { id: "n3", tenant_id: TENANT_ID, branch_id: BRANCH_WADI, batch_date: "2026-08-02", approval_status: "pending", is_posted: false, description: "Wadi day-end", created_at: "2026-08-02T09:00:00.000Z", entry_type: "adjustment" },
  { id: "n4", tenant_id: TENANT_ID, branch_id: BRANCH_WADI, batch_date: "2026-08-03", approval_status: "approved", is_posted: true, description: "Wadi approved", created_at: "2026-08-03T09:00:00.000Z", entry_type: "adjustment" },
];

/** Legacy rows the backfill could not resolve — must never leak into a branch view. */
export const untaggedBatches: JournalBatchRow[] = [
  { id: "u1", tenant_id: TENANT_ID, branch_id: null, batch_date: "2026-06-25", approval_status: "pending", is_posted: false, description: "Untagged manual journal", created_at: "2026-06-25T07:00:00.000Z", entry_type: "adjustment" },
  { id: "u2", tenant_id: TENANT_ID, branch_id: null, batch_date: "2026-07-15", approval_status: "pending", is_posted: false, description: "Untagged opening balance", created_at: "2026-07-15T07:00:00.000Z", entry_type: "opening_balance" },
];

/** Another tenant — must never appear in any view. */
export const otherTenantBatches: JournalBatchRow[] = [
  { id: "x1", tenant_id: "tenant-other", branch_id: BRANCH_MAIN, batch_date: "2026-08-01", approval_status: "pending", is_posted: false, description: "Other tenant", created_at: "2026-08-01T07:00:00.000Z", entry_type: "adjustment" },
];

export const allBatches: JournalBatchRow[] = [
  ...backfilledBatches,
  ...nativeBatches,
  ...untaggedBatches,
  ...otherTenantBatches,
];

export const expectedPending = {
  /** 135 backfilled + n1 */
  main: BACKFILL.main + 1,
  /** 36 backfilled + n3 */
  wadi: BACKFILL.wadi + 1,
  untagged: untaggedBatches.length,
  /** Consolidated view includes untagged rows but never the other tenant. */
  all: BACKFILL.total + 2 + untaggedBatches.length,
};
