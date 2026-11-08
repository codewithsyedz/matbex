import { describe, expect, it } from "vitest";
import {
  buildFingerprintRecords,
  detectPriorImports,
  fingerprintPayload,
  rowFingerprint,
  IMPORT_SCOPES,
} from "@/lib/importFingerprint";

const row = (o: Partial<Parameters<typeof rowFingerprint>[0]> = {}) => ({
  vendor_name: "Asrar",
  txn_date: "2026-06-10",
  amount: 3500,
  notes: "Electrical rough-in",
  ...o,
});

describe("rowFingerprint", () => {
  it("is stable for the same content", () => {
    expect(rowFingerprint(row())).toBe(rowFingerprint(row()));
  });

  it("ignores casing, punctuation and amount formatting", () => {
    expect(rowFingerprint(row())).toBe(
      rowFingerprint(row({ vendor_name: " ASRAR. ", amount: "3500.00", notes: "Electrical  rough in" })),
    );
  });

  it("changes when the amount changes", () => {
    expect(rowFingerprint(row())).not.toBe(rowFingerprint(row({ amount: 3501 })));
  });

  it("changes when a discriminator changes", () => {
    expect(rowFingerprint(row({ extra: ["CC1"] }))).not.toBe(rowFingerprint(row({ extra: ["CC2"] })));
  });

  it("exposes the canonical payload", () => {
    expect(fingerprintPayload(row())).toContain("3500.00");
  });
});

describe("detectPriorImports", () => {
  it("blocks rows already recorded in the database", () => {
    const known = [
      { row_hash: rowFingerprint(row()), source_file: "june.xlsx", source_row_number: 4, created_at: "2026-06-20T00:00:00Z" },
    ];
    const [hit] = detectPriorImports([row()], known);
    expect(hit.blocked).toBe(true);
    expect(hit.reason).toContain("june.xlsx");
    expect(hit.reason).toContain("row 4");
  });

  it("blocks a row repeated inside the same file", () => {
    const hits = detectPriorImports([row(), row()], []);
    expect(hits[0].blocked).toBe(false);
    expect(hits[1].blocked).toBe(true);
    expect(hits[1].duplicateOfRowIndex).toBe(0);
  });

  it("allows genuinely new rows", () => {
    const hits = detectPriorImports([row(), row({ amount: 900 })], []);
    expect(hits.every((h) => !h.blocked)).toBe(true);
  });
});

describe("buildFingerprintRecords", () => {
  it("emits one record per unique row with tenant + scope", () => {
    const records = buildFingerprintRecords({
      tenantId: "t1",
      scope: IMPORT_SCOPES.projectTransactions,
      scopeRef: "p1",
      sourceFile: "june.xlsx",
      sourceSheet: "Sheet1",
      targetTable: "project_transactions",
      userId: "u1",
      rows: [{ row: row(), sourceRowNumber: 2 }, { row: row(), sourceRowNumber: 3 }],
    });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      tenant_id: "t1",
      scope: "project_transactions",
      scope_ref: "p1",
      source_file: "june.xlsx",
      source_row_number: 2,
      imported_by: "u1",
    });
  });
});
