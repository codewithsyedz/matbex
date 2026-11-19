/**
 * Regression suite: pending journal entries must always be branch-scoped.
 *
 * Covers the state of the data after the branch backfill migration:
 *   - the 171 backfilled batches land in exactly one branch view each
 *   - still-untagged legacy batches never leak into a branch view
 *   - a pinned branch always wins over the selected branch
 *   - the row cap is high enough to not truncate the busiest branch
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  TENANT_ID,
  BRANCH_MAIN,
  BRANCH_WADI,
  allBatches,
  BACKFILL,
  expectedPending,
} from "@/test/fixtures/journalBranchFixtures";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/integrations/db/client", async () => {
  const { createDbTableMock } = await import("@/test/utils/dbTableMock");
  const fixtures = await import("@/test/fixtures/journalBranchFixtures");
  const mock = createDbTableMock({
    journal_entry_batches: fixtures.allBatches,
  });
  return {
    db: {
      from: mock.db.from,
      rpc: vi.fn(async () => ({ data: null, error: null })),
      channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
      removeChannel: () => {},
    },
  };
});

const authState = { user: { id: "u1" }, profile: { tenant_id: TENANT_ID }, isManager: true };
const branchState: {
  activeBranchId: string | null;
  pinnedBranchId: string | null;
  isAllBranches: boolean;
} = { activeBranchId: null, pinnedBranchId: null, isAllBranches: true };

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/contexts/BranchContext", () => ({ useBranch: () => branchState }));

const { useJournalEntries } = await import("@/hooks/useJournalEntries");

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return React.createElement(QueryClientProvider, { client }, children);
}

async function loadBatches(scope: Partial<typeof branchState>) {
  Object.assign(branchState, { activeBranchId: null, pinnedBranchId: null, isAllBranches: false }, scope);
  const { result } = renderHook(() => useJournalEntries(), { wrapper });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  return result.current.batches;
}

const pendingOf = (rows: any[]) => rows.filter((b) => b.approval_status === "pending");

beforeEach(() => {
  Object.assign(branchState, { activeBranchId: null, pinnedBranchId: null, isAllBranches: true });
});

describe("useJournalEntries branch scoping", () => {
  it("Main Branch view shows only Main batches (incl. its backfilled share)", async () => {
    const rows = await loadBatches({ activeBranchId: BRANCH_MAIN });
    expect(rows.every((b) => b.branch_id === BRANCH_MAIN)).toBe(true);
    expect(pendingOf(rows)).toHaveLength(expectedPending.main);
    expect(rows.filter((b: any) => b._backfilled)).toHaveLength(BACKFILL.main);
  });

  it("Al-Wadi view shows only Wadi batches and never Main or untagged rows", async () => {
    const rows = await loadBatches({ activeBranchId: BRANCH_WADI });
    expect(rows.every((b) => b.branch_id === BRANCH_WADI)).toBe(true);
    expect(pendingOf(rows)).toHaveLength(expectedPending.wadi);
    expect(rows.some((b) => b.branch_id === null)).toBe(false);
    expect(rows.filter((b: any) => b._backfilled)).toHaveLength(BACKFILL.wadi);
  });

  it("branch views never leak the other tenant's batches", async () => {
    for (const branchId of [BRANCH_MAIN, BRANCH_WADI]) {
      const rows = await loadBatches({ activeBranchId: branchId });
      expect(rows.every((b) => b.tenant_id === TENANT_ID)).toBe(true);
    }
  });

  it("the two branch views partition the backfilled batches exactly once", async () => {
    const main = await loadBatches({ activeBranchId: BRANCH_MAIN });
    const wadi = await loadBatches({ activeBranchId: BRANCH_WADI });
    const ids = [...main, ...wadi].filter((b: any) => b._backfilled).map((b) => b.id);
    expect(ids).toHaveLength(BACKFILL.total);
    expect(new Set(ids).size).toBe(BACKFILL.total);
  });

  it("All branches shows tenant-wide rows including still-untagged batches", async () => {
    const rows = await loadBatches({ isAllBranches: true, activeBranchId: BRANCH_MAIN });
    expect(pendingOf(rows)).toHaveLength(expectedPending.all);
    expect(rows.filter((b) => b.branch_id === null)).toHaveLength(expectedPending.untagged);
    expect(rows.some((b) => b.tenant_id !== TENANT_ID)).toBe(false);
  });

  it("a pinned branch overrides the selected branch and the all-branches toggle", async () => {
    const rows = await loadBatches({
      pinnedBranchId: BRANCH_WADI,
      activeBranchId: BRANCH_MAIN,
      isAllBranches: true,
    });
    expect(rows.every((b) => b.branch_id === BRANCH_WADI)).toBe(true);
    expect(pendingOf(rows)).toHaveLength(expectedPending.wadi);
  });

  it("does not truncate the busiest branch (row cap regression)", async () => {
    const rows = await loadBatches({ activeBranchId: BRANCH_MAIN });
    // Fixture is smaller than production, so assert against the source cap too.
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("src/hooks/useJournalEntries.ts", "utf8"),
    );
    const cap = Number(src.match(/\.limit\((\d+)\)/)?.[1] ?? 0);
    expect(cap).toBeGreaterThanOrEqual(1000);
    expect(rows.length).toBeLessThan(cap);
  });
});
