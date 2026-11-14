import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mergeReconciledSales,
  reconcileDaySales,
  buildDayBreakdown,
  pickDayPaymentBreakdown,
  fetchReconciledSalesByDay,
} from "../reconciledSales";

// ---- mergeReconciledSales ----------------------------------------------------

describe("mergeReconciledSales", () => {
  it("sums raw POS rows per business day", () => {
    const r = mergeReconciledSales({
      txRows: [
        { total: 100, created_at: "2026-06-17T10:00:00Z" },
        { total: 50, created_at: "2026-06-17T12:00:00Z" },
        { total: 25, created_at: "2026-06-18T09:00:00Z" },
      ],
      summaryRows: [],
      adjRows: [],
    });
    expect(r.rawTxByDay.get("2026-06-17")).toBe(150);
    expect(r.rawTxByDay.get("2026-06-18")).toBe(25);
    expect(r.total).toBe(175);
  });

  it("adds net active adjustments and skips reversed/reversal rows", () => {
    const r = mergeReconciledSales({
      txRows: [{ total: 1000, created_at: "2026-06-17T10:00:00Z" }],
      summaryRows: [],
      adjRows: [
        // active overage
        { amount: 100, business_date: "2026-06-17", reversed_at: null, reversal_of_id: null },
        // reversed original (excluded)
        { amount: 50, business_date: "2026-06-17", reversed_at: "2026-06-17T11:00:00Z", reversal_of_id: null },
        // reversal mirror (excluded)
        { amount: -50, business_date: "2026-06-17", reversed_at: null, reversal_of_id: "abc" },
      ],
    });
    expect(r.adjustmentsByDay.get("2026-06-17")).toBe(100);
    expect(r.perDay.get("2026-06-17")).toBe(1100);
    expect(r.total).toBe(1100);
  });

  it("daily_sales_summary overrides POS + adjustments (closed day wins)", () => {
    const r = mergeReconciledSales({
      txRows: [{ total: 1000, created_at: "2026-06-17T10:00:00Z" }],
      summaryRows: [
        {
          sales_date: "2026-06-17",
          total_sales: 1425,
          cash_sales: 1083,
          card_sales: 342,
          delivery_sales: 0,
          other_sales: 0,
        },
      ],
      adjRows: [
        { amount: 200, business_date: "2026-06-17", reversed_at: null, reversal_of_id: null },
      ],
    });
    expect(r.perDay.get("2026-06-17")).toBe(1425);
    expect(r.summaryByDay.get("2026-06-17")).toBe(1425);
    expect(r.summaryDetailByDay.get("2026-06-17")).toEqual({
      total: 1425,
      cash: 1083,
      card: 342,
      delivery: 0,
      other: 0,
    });
  });
});

// ---- reconcileDaySales -------------------------------------------------------

describe("reconcileDaySales", () => {
  it("uses summary when available", () => {
    const v = reconcileDaySales("2026-06-17", 1000, {
      summaryByDay: new Map([["2026-06-17", 1425]]),
      adjustmentsByDay: new Map([["2026-06-17", 200]]),
    });
    expect(v).toBe(1425);
  });

  it("falls back to raw + adjustments", () => {
    const v = reconcileDaySales("2026-06-17", 1000, {
      summaryByDay: new Map(),
      adjustmentsByDay: new Map([["2026-06-17", 200]]),
    });
    expect(v).toBe(1200);
  });

  it("returns raw when no summary and no adjustments", () => {
    const v = reconcileDaySales("2026-06-17", 1000, {
      summaryByDay: new Map(),
      adjustmentsByDay: new Map(),
    });
    expect(v).toBe(1000);
  });
});

// ---- buildDayBreakdown -------------------------------------------------------

describe("buildDayBreakdown", () => {
  it("labels source as 'summary' when closed daily summary exists", () => {
    const b = buildDayBreakdown("2026-06-17", {
      rawTxByDay: new Map([["2026-06-17", 1000]]),
      adjustmentsByDay: new Map([["2026-06-17", 200]]),
      summaryByDay: new Map([["2026-06-17", 1425]]),
    });
    expect(b).toEqual({ rawPos: 1000, adjustments: 200, final: 1425, source: "summary" });
  });

  it("labels source as 'adjusted' when only adjustments exist", () => {
    const b = buildDayBreakdown("2026-06-17", {
      rawTxByDay: new Map([["2026-06-17", 1000]]),
      adjustmentsByDay: new Map([["2026-06-17", -75]]),
      summaryByDay: new Map(),
    });
    expect(b).toEqual({ rawPos: 1000, adjustments: -75, final: 925, source: "adjusted" });
  });

  it("labels source as 'raw' when neither summary nor adjustments", () => {
    const b = buildDayBreakdown("2026-06-17", {
      rawTxByDay: new Map([["2026-06-17", 1000]]),
      adjustmentsByDay: new Map(),
      summaryByDay: new Map(),
    });
    expect(b.source).toBe("raw");
    expect(b.final).toBe(1000);
  });
});

// ---- pickDayPaymentBreakdown ------------------------------------------------

describe("pickDayPaymentBreakdown", () => {
  it("uses summary cash/card when closed summary exists; keeps raw unpaid", () => {
    const r = pickDayPaymentBreakdown("2026-06-17", 900, 300, 50, {
      summaryDetailByDay: new Map([
        [
          "2026-06-17",
          { total: 1425, cash: 1083, card: 342, delivery: 0, other: 0 },
        ],
      ]),
    });
    expect(r).toEqual({ cash: 1083, card: 342, unpaid: 50, source: "summary" });
  });

  it("falls back to raw POS values when no summary", () => {
    const r = pickDayPaymentBreakdown("2026-06-17", 900, 300, 50, {
      summaryDetailByDay: new Map(),
    });
    expect(r).toEqual({ cash: 900, card: 300, unpaid: 50, source: "raw" });
  });
});

// ---- fetchReconciledSalesByDay (integration over the db mock) ---------

vi.mock("@/integrations/db/client", () => {
  type Row = Record<string, any>;
  const tables: Record<string, Row[]> = {
    sales_transactions: [],
    daily_sales_summary: [],
    day_end_adjustments: [],
  };
  const builder = (table: string) => {
    let rows = tables[table] ?? [];
    const api: any = {
      select: () => api,
      order: () => api,
      is: () => api,
      // Paging, as PostgREST: inclusive row window.
      range: (from: number, to: number) => {
        rows = rows.slice(from, to + 1);
        return api;
      },
      eq: (_c: string, _v: any) => api,
      gte: (_c: string, _v: any) => api,
      lt: (_c: string, _v: any) => api,
      lte: (_c: string, _v: any) => api,
      then: (resolve: any) => Promise.resolve({ data: rows, error: null }).then(resolve),
    };
    return api;
  };
  return {
    db: {
      from: (t: string) => builder(t),
    },
    __setTable: (t: string, rows: Row[]) => {
      tables[t] = rows;
    },
  };
});

describe("fetchReconciledSalesByDay", () => {
  beforeEach(async () => {
    const mod: any = await import("@/integrations/db/client");
    mod.__setTable("sales_transactions", [
      { total: 1000, created_at: "2026-06-17T10:00:00Z" },
    ]);
    mod.__setTable("daily_sales_summary", [
      {
        sales_date: "2026-06-17",
        total_sales: 1425,
        cash_sales: 1083,
        card_sales: 342,
        delivery_sales: 0,
        other_sales: 0,
      },
    ]);
    mod.__setTable("day_end_adjustments", [
      { amount: 100, business_date: "2026-06-17", reversed_at: null, reversal_of_id: null },
    ]);
  });

  afterEach(() => vi.clearAllMocks());

  it("merges all three sources with summary overriding the per-day total", async () => {
    const r = await fetchReconciledSalesByDay({
      restaurantId: "r1",
      dateFrom: "2026-06-17",
      dateTo: "2026-06-17",
    });
    expect(r.rawTxByDay.get("2026-06-17")).toBe(1000);
    expect(r.adjustmentsByDay.get("2026-06-17")).toBe(100);
    expect(r.summaryByDay.get("2026-06-17")).toBe(1425);
    expect(r.perDay.get("2026-06-17")).toBe(1425);
    expect(r.total).toBe(1425);
    expect(r.summaryDetailByDay.get("2026-06-17")?.cash).toBe(1083);
  });
});