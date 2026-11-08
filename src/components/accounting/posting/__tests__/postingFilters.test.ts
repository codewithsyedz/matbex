import { describe, it, expect } from "vitest";
import {
  emptyPostingFilters,
  filterImbalanced,
  filterUnposted,
} from "../postingFilters";

const baseUnposted = [
  {
    id: "e1",
    expense_date: "2026-06-01",
    amount: 100,
    description: "Chicken purchase",
    branch_id: "b1",
    account_id: null,
    approval_status: "approved",
    status: "approved",
    classification: {
      status: "ready",
      reason_code: "ready",
      reason_detail: "",
    },
    branch: { name: "Riyadh HQ" },
    account: { account_code: "5000", account_name: "COGS" },
  },
  {
    id: "e2",
    expense_date: "2026-06-20",
    amount: 50,
    description: "Detergent",
    branch_id: "b2",
    account_id: null,
    approval_status: "pending",
    status: "pending",
    classification: {
      status: "blocked",
      reason_code: "pending_approval",
      reason_detail: "Awaiting approval",
    },
    branch: { name: "Al-Wadi" },
    account: null,
  },
] as any;

const baseImbalanced = [
  {
    id: "e1",
    expense_date: "2026-06-01",
    amount: 100,
    description: "Chicken purchase",
    branch_id: "b1",
    status: "approved",
    dr_total: 100,
    cr_total: 0,
    diff: 100,
    branch: { name: "Riyadh HQ" },
  },
  {
    id: "e3",
    expense_date: "2026-05-15",
    amount: 200,
    description: "Gas refill",
    branch_id: "b2",
    status: "approved",
    dr_total: 200,
    cr_total: 50,
    diff: 150,
    branch: { name: "Al-Wadi" },
  },
] as any;

describe("filterUnposted", () => {
  it("returns everything with empty filters", () => {
    expect(filterUnposted(baseUnposted, emptyPostingFilters)).toHaveLength(2);
  });

  it("filters by reason code", () => {
    const out = filterUnposted(baseUnposted, { ...emptyPostingFilters, reasonCode: "ready" });
    expect(out.map((r) => r.id)).toEqual(["e1"]);
  });

  it("filters by store/branch", () => {
    const out = filterUnposted(baseUnposted, { ...emptyPostingFilters, branchId: "b2" });
    expect(out.map((r) => r.id)).toEqual(["e2"]);
  });

  it("filters by date range", () => {
    const out = filterUnposted(baseUnposted, {
      ...emptyPostingFilters,
      dateFrom: "2026-06-10",
      dateTo: "2026-06-30",
    });
    expect(out.map((r) => r.id)).toEqual(["e2"]);
  });

  it("filters by shift via lookup", () => {
    const out = filterUnposted(
      baseUnposted,
      { ...emptyPostingFilters, shiftId: "shift-a" },
      { e1: "shift-a", e2: "shift-b" },
    );
    expect(out.map((r) => r.id)).toEqual(["e1"]);
  });

  it("search is case-insensitive across description and account", () => {
    const out = filterUnposted(baseUnposted, { ...emptyPostingFilters, search: "COGS" });
    expect(out.map((r) => r.id)).toEqual(["e1"]);
  });

  it("stacks multiple filters with AND semantics", () => {
    const out = filterUnposted(baseUnposted, {
      ...emptyPostingFilters,
      branchId: "b1",
      reasonCode: "ready",
      dateFrom: "2026-06-01",
      dateTo: "2026-06-01",
    });
    expect(out.map((r) => r.id)).toEqual(["e1"]);
  });
});

describe("filterImbalanced", () => {
  it("filters by store and date range together", () => {
    const out = filterImbalanced(baseImbalanced, {
      ...emptyPostingFilters,
      branchId: "b2",
      dateFrom: "2026-05-01",
      dateTo: "2026-05-31",
    });
    expect(out.map((r) => r.id)).toEqual(["e3"]);
  });

  it("returns empty when shift lookup yields no match", () => {
    const out = filterImbalanced(
      baseImbalanced,
      { ...emptyPostingFilters, shiftId: "ghost-shift" },
      { e1: "shift-a", e3: "shift-b" },
    );
    expect(out).toHaveLength(0);
  });
});