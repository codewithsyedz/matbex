import { describe, expect, it } from "vitest";
import { analyseImport, defaultAction, matchExisting, mergePatch } from "../importDedupe";

const existing = [
  { id: "a", vendor_name: "Asrar", txn_date: "2026-06-10", amount: 3500, notes: "Electrical rough-in" },
  { id: "b", vendor_name: null, txn_date: "2026-06-14", amount: 40000, notes: null },
];

describe("importDedupe", () => {
  it("flags an exact duplicate", () => {
    const m = matchExisting(
      { vendor_name: "asrar ", txn_date: "2026-06-10", amount: 3500, notes: "Electrical  rough in!" },
      existing,
    );
    expect(m.strength).toBe("exact");
    expect(m.existing?.id).toBe("a");
    expect(defaultAction(m)).toBe("skip");
  });

  it("flags a likely duplicate when notes differ", () => {
    const m = matchExisting(
      { vendor_name: "Asrar", txn_date: "2026-06-10", amount: 3500, notes: "different" },
      existing,
    );
    expect(m.strength).toBe("likely");
    expect(defaultAction(m)).toBe("import");
  });

  it("returns no match for a new row", () => {
    const m = matchExisting({ vendor_name: "New", txn_date: "2026-06-11", amount: 10, notes: "" }, existing);
    expect(m.strength).toBeNull();
    expect(m.existing).toBeNull();
  });

  it("detects duplicates within the same file", () => {
    const rows = [
      { vendor_name: "X", txn_date: "2026-07-01", amount: 100, notes: "n" },
      { vendor_name: "X", txn_date: "2026-07-01", amount: 100, notes: "n" },
    ];
    const res = analyseImport(rows, existing);
    expect(res[0].strength).toBeNull();
    expect(res[1].duplicateOfRowIndex).toBe(0);
  });

  it("builds a merge patch only for new information", () => {
    expect(mergePatch({ vendor_name: "Asrar", txn_date: "2026-06-10", amount: 3500, notes: "Electrical rough-in" }, existing[0])).toEqual({});
    expect(
      mergePatch({ vendor_name: "Contractor", txn_date: "2026-06-14", amount: 40000, notes: "instalment" }, existing[1]),
    ).toEqual({ vendor_name: "Contractor", notes: "instalment" });
  });
});
