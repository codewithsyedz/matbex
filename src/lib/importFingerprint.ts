/**
 * Durable duplicate-import detection.
 *
 * Every spreadsheet row that reaches the database is fingerprinted and the
 * fingerprint is stored in `import_row_fingerprints`. A later import of the
 * same source row is recognised even across sessions, files and users, so a
 * re-uploaded sheet can never silently re-post or overwrite historical
 * accounting records.
 *
 * Pure module - no React, no the API.
 */

/** Import scopes are namespaces: the same fingerprint may legitimately exist in two importers. */
export const IMPORT_SCOPES = {
  projectTransactions: "project_transactions",
  acquisitionAllocations: "acquisition_allocations",
  expenses: "expenses",
} as const;

export type ImportScope = (typeof IMPORT_SCOPES)[keyof typeof IMPORT_SCOPES];

export interface FingerprintInput {
  vendor_name?: string | null;
  txn_date: string;
  amount: number | string;
  notes?: string | null;
  /** Extra discriminators (cost centre, account code, paid-by…). */
  extra?: (string | number | null | undefined)[];
}

const norm = (v: unknown) =>
  String(v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, " ")
    .trim();

/** Deterministic, stable across browsers/sessions (FNV-1a 64-ish, hex encoded). */
export function hashString(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0"));
}

/** Canonical string a fingerprint is built from - useful in tests and debugging. */
export function fingerprintPayload(row: FingerprintInput): string {
  return [
    norm(row.txn_date),
    norm(row.vendor_name),
    Number(row.amount || 0).toFixed(2),
    norm(row.notes),
    ...(row.extra ?? []).map(norm),
  ].join("|");
}

/** Content fingerprint: identical business content = identical hash, regardless of file name. */
export function rowFingerprint(row: FingerprintInput): string {
  return hashString(fingerprintPayload(row));
}

export interface KnownFingerprint {
  row_hash: string;
  source_file?: string | null;
  source_sheet?: string | null;
  source_row_number?: number | null;
  created_at?: string | null;
  target_id?: string | null;
}

export interface PriorImportHit {
  hash: string;
  prior: KnownFingerprint | null;
  /** Index of an earlier row in the SAME file carrying the same fingerprint. */
  duplicateOfRowIndex: number | null;
  /** True when this row must not be imported again. */
  blocked: boolean;
  reason: string | null;
}

/**
 * Check a batch of rows against fingerprints already recorded in the database
 * and against earlier rows in the same file.
 */
export function detectPriorImports(
  rows: FingerprintInput[],
  known: KnownFingerprint[],
): PriorImportHit[] {
  const index = new Map<string, KnownFingerprint>();
  known.forEach((k) => {
    if (!index.has(k.row_hash)) index.set(k.row_hash, k);
  });

  const seenInFile = new Map<string, number>();

  return rows.map((row, i) => {
    const hash = rowFingerprint(row);
    const prior = index.get(hash) ?? null;
    const firstInFile = seenInFile.get(hash);
    if (firstInFile === undefined) seenInFile.set(hash, i);

    if (prior) {
      const when = prior.created_at ? new Date(prior.created_at).toISOString().slice(0, 10) : null;
      const where = prior.source_file
        ? `"${prior.source_file}"${prior.source_row_number ? ` row ${prior.source_row_number}` : ""}`
        : "an earlier import";
      return {
        hash,
        prior,
        duplicateOfRowIndex: null,
        blocked: true,
        reason: `Already imported from ${where}${when ? ` on ${when}` : ""}.`,
      };
    }

    if (firstInFile !== undefined) {
      return {
        hash,
        prior: null,
        duplicateOfRowIndex: firstInFile,
        blocked: true,
        reason: `Identical to row ${firstInFile + 1} in this file.`,
      };
    }

    return { hash, prior: null, duplicateOfRowIndex: null, blocked: false, reason: null };
  });
}

export interface FingerprintRecord {
  tenant_id: string;
  scope: ImportScope;
  scope_ref: string | null;
  row_hash: string;
  source_file: string | null;
  source_sheet: string | null;
  source_row_number: number | null;
  row_preview: Record<string, unknown>;
  target_table: string | null;
  target_id: string | null;
  imported_by: string | null;
}

export function buildFingerprintRecords(params: {
  tenantId: string;
  scope: ImportScope;
  scopeRef?: string | null;
  sourceFile?: string | null;
  sourceSheet?: string | null;
  targetTable?: string | null;
  userId?: string | null;
  rows: { row: FingerprintInput; sourceRowNumber?: number | null; targetId?: string | null }[];
}): FingerprintRecord[] {
  const seen = new Set<string>();
  const out: FingerprintRecord[] = [];
  for (const item of params.rows) {
    const hash = rowFingerprint(item.row);
    if (seen.has(hash)) continue;
    seen.add(hash);
    out.push({
      tenant_id: params.tenantId,
      scope: params.scope,
      scope_ref: params.scopeRef ?? null,
      row_hash: hash,
      source_file: params.sourceFile ?? null,
      source_sheet: params.sourceSheet ?? null,
      source_row_number: item.sourceRowNumber ?? null,
      row_preview: {
        vendor_name: item.row.vendor_name ?? null,
        txn_date: item.row.txn_date,
        amount: Number(item.row.amount || 0),
        notes: item.row.notes ?? null,
      },
      target_table: params.targetTable ?? null,
      target_id: item.targetId ?? null,
      imported_by: params.userId ?? null,
    });
  }
  return out;
}
