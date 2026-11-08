import { describe, expect, it } from "vitest";
import { parseAmountStrict, parseDateStrict, validateRows, validationReportCsv } from "../importValidation";

const mapping = { vendor_name: "Vendor", txn_date: "Date", amount: "Amount" } as const;

describe("parseAmountStrict", () => {
  it("parses formatted numbers and brackets", () => {
    expect(parseAmountStrict("1,250.50").value).toBe(1250.5);
    expect(parseAmountStrict("(400)").value).toBe(-400);
  });
  it("rejects junk", () => {
    expect(parseAmountStrict("n/a").value).toBeNull();
    expect(parseAmountStrict("").value).toBeNull();
  });
});

describe("parseDateStrict", () => {
  it("parses ISO and DD/MM/YYYY", () => {
    expect(parseDateStrict("2026-06-10").value).toBe("2026-06-10");
    expect(parseDateStrict("10/06/2026").value).toBe("2026-06-10");
  });
  it("rejects impossible dates", () => {
    expect(parseDateStrict("31/02/2026").value).toBeNull();
    expect(parseDateStrict("hello").value).toBeNull();
  });
});

describe("validateRows", () => {
  it("blocks bad rows and keeps good ones", () => {
    const report = validateRows(
      [
        { Vendor: "Asrar", Date: "2026-06-10", Amount: "3,500" },
        { Vendor: "Bad", Date: "31/02/2026", Amount: "abc" },
        { Vendor: "", Date: "", Amount: "100" },
        { Vendor: "", Date: "", Amount: "" },
      ],
      mapping,
    );
    expect(report.validRows).toHaveLength(2);
    expect(report.errorCount).toBe(1);
    expect(report.blankRows).toBe(1);
    expect(report.rows[1].rowNumber).toBe(3);
    expect(report.rows[2].issues.some((i) => i.severity === "warning")).toBe(true);
  });

  it("exports a csv error report", () => {
    const report = validateRows([{ Vendor: "X", Date: "x", Amount: "0" }], mapping);
    const csv = validationReportCsv(report);
    expect(csv.split("\n").length).toBeGreaterThan(1);
  });
});
