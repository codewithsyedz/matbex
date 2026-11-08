import { describe, it, expect } from "vitest";
import {
  buildClosingReport,
  closingReportToCsv,
  CLOSING_REPORT_HEADERS,
} from "../dailyClosingReport";

const branchNames = new Map([
  ["b1", "Riyadh HQ"],
  ["b2", "Al-Wadi"],
]);

describe("buildClosingReport", () => {
  it("splits gross/net/VAT and payment methods per branch and day", () => {
    const { rows, totals } = buildClosingReport({
      branchNames,
      txRows: [
        {
          branch_id: "b1",
          created_at: "2026-08-01T09:00:00Z",
          total: 115,
          subtotal: 100,
          tax: 15,
          payment_method: "cash",
        },
        {
          branch_id: "b1",
          created_at: "2026-08-01T11:00:00Z",
          total: 230,
          subtotal: 200,
          tax: 30,
          payment_method: "card",
        },
        {
          branch_id: "b2",
          created_at: "2026-08-01T11:00:00Z",
          total: 57.5,
          subtotal: 50,
          tax: 7.5,
          payment_method: "cash",
        },
      ],
      summaryRows: [],
      adjRows: [],
    });

    expect(rows).toHaveLength(2);
    const hq = rows.find((r) => r.branchId === "b1")!;
    expect(hq.gross).toBe(345);
    expect(hq.net).toBe(300);
    expect(hq.vat).toBe(45);
    expect(hq.cash).toBe(115);
    expect(hq.card).toBe(230);
    expect(hq.status).toBe("open");
    expect(totals.gross).toBe(402.5);
    expect(totals.vat).toBe(52.5);
  });

  it("treats delivery receipts separately from cash/card", () => {
    const { rows } = buildClosingReport({
      branchNames,
      txRows: [
        {
          branch_id: "b1",
          created_at: "2026-08-01T09:00:00Z",
          total: 100,
          tax: 13.04,
          payment_method: "card",
          is_delivery: true,
        },
      ],
      summaryRows: [],
      adjRows: [],
    });
    expect(rows[0].delivery).toBe(100);
    expect(rows[0].card).toBe(0);
  });

  it("computes reconciliation delta = declared − (POS + active adjustments)", () => {
    const { rows } = buildClosingReport({
      branchNames,
      txRows: [
        { branch_id: "b1", created_at: "2026-08-01T09:00:00Z", total: 1000, tax: 130.43 },
      ],
      summaryRows: [
        {
          branch_id: "b1",
          sales_date: "2026-08-01",
          total_sales: 1300,
          cash_sales: 900,
          card_sales: 400,
          pos_reported_total: 1300,
          variance_status: "resolved",
        },
      ],
      adjRows: [
        { branch_id: "b1", business_date: "2026-08-01", amount: 300 },
        // reversed original + its mirror must be ignored
        {
          branch_id: "b1",
          business_date: "2026-08-01",
          amount: 50,
          reversed_at: "2026-08-01T12:00:00Z",
        },
        {
          branch_id: "b1",
          business_date: "2026-08-01",
          amount: -50,
          reversal_of_id: "abc",
        },
      ],
    });

    const r = rows[0];
    expect(r.adjustments).toBe(300);
    expect(r.declared).toBe(1300);
    expect(r.delta).toBe(0);
    expect(r.status).toBe("closed");
    // declared payment split overrides raw POS split
    expect(r.cash).toBe(900);
    expect(r.card).toBe(400);
  });

  it("flags a non-zero delta when the declared close disagrees", () => {
    const { rows } = buildClosingReport({
      branchNames,
      txRows: [{ branch_id: "b2", created_at: "2026-08-02T09:00:00Z", total: 500 }],
      summaryRows: [{ branch_id: "b2", sales_date: "2026-08-02", total_sales: 460 }],
      adjRows: [],
    });
    expect(rows[0].delta).toBe(-40);
  });

  it("keeps branches separate and never merges unassigned rows into a branch", () => {
    const { rows } = buildClosingReport({
      branchNames,
      txRows: [
        { branch_id: null, created_at: "2026-08-01T09:00:00Z", total: 10 },
        { branch_id: "b1", created_at: "2026-08-01T09:00:00Z", total: 20 },
      ],
      summaryRows: [],
      adjRows: [],
    });
    expect(rows.map((r) => r.branchName).sort()).toEqual(["Riyadh HQ", "Unassigned"]);
  });
});

describe("closingReportToCsv", () => {
  it("emits a header, one line per row and a TOTAL line", () => {
    const { rows, totals } = buildClosingReport({
      branchNames,
      txRows: [
        { branch_id: "b1", created_at: "2026-08-01T09:00:00Z", total: 115, tax: 15 },
      ],
      summaryRows: [],
      adjRows: [],
    });
    const csv = closingReportToCsv(rows, totals);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain(CLOSING_REPORT_HEADERS[0]);
    expect(lines[1]).toContain("Riyadh HQ");
    expect(lines[2]).toContain("TOTAL");
  });
});