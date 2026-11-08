export type DuplicateStrength = "exact" | "likely" | null;

export interface DedupeCandidate {
  vendor_name?: string | null;
  txn_date: string;
  amount: number;
  notes?: string | null;
}

export interface ExistingTxn extends DedupeCandidate {
  id: string;
  status?: string | null;
}

export type DuplicateAction = "import" | "skip" | "merge";

export interface DuplicateMatch<T extends ExistingTxn = ExistingTxn> {
  strength: DuplicateStrength;
  existing: T | null;
  /** Index of an earlier row in the same file that this row duplicates. */
  duplicateOfRowIndex: number | null;
  reasons: string[];
}

export const normalizeText = (v: string | null | undefined) =>
  (v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const sameAmount = (a: number, b: number) => Math.abs(Number(a) - Number(b)) < 0.005;

export const dedupeKey = (r: DedupeCandidate) =>
  [r.txn_date, normalizeText(r.vendor_name), Number(r.amount).toFixed(2), normalizeText(r.notes)].join("|");

/**
 * Match one imported row against existing project transactions.
 * "exact" = date + vendor + amount + notes all match.
 * "likely" = date + amount match (and vendor matches when both sides have one).
 */
export function matchExisting<T extends ExistingTxn>(row: DedupeCandidate, existing: T[]): DuplicateMatch<T> {
  const date = row.txn_date;
  const vendor = normalizeText(row.vendor_name);
  const notes = normalizeText(row.notes);

  let likely: T | null = null;
  for (const e of existing) {
    if (e.txn_date !== date || !sameAmount(e.amount, row.amount)) continue;
    const eVendor = normalizeText(e.vendor_name);
    const eNotes = normalizeText(e.notes);
    if (eVendor === vendor && eNotes === notes) {
      return {
        strength: "exact",
        existing: e,
        duplicateOfRowIndex: null,
        reasons: ["Same date", "Same vendor", "Same amount", "Same notes"],
      };
    }
    if (!likely && (!vendor || !eVendor || eVendor === vendor)) likely = e;
  }

  if (likely) {
    const reasons = ["Same date", "Same amount"];
    if (vendor && normalizeText(likely.vendor_name) === vendor) reasons.push("Same vendor");
    else reasons.push("Notes or vendor differ");
    return { strength: "likely", existing: likely, duplicateOfRowIndex: null, reasons };
  }

  return { strength: null, existing: null, duplicateOfRowIndex: null, reasons: [] };
}

/** Analyse a whole import batch: matches against existing rows and against earlier rows in the file. */
export function analyseImport<T extends ExistingTxn>(
  rows: DedupeCandidate[],
  existing: T[],
): DuplicateMatch<T>[] {
  const seen = new Map<string, number>();
  return rows.map((row, i) => {
    const key = dedupeKey(row);
    const prior = seen.get(key);
    if (prior === undefined) seen.set(key, i);
    if (prior !== undefined) {
      return {
        strength: "exact",
        existing: null,
        duplicateOfRowIndex: prior,
        reasons: [`Identical to row ${prior + 1} in this file`],
      };
    }
    return matchExisting(row, existing);
  });
}

export const defaultAction = (m: DuplicateMatch): DuplicateAction =>
  m.strength === "exact" ? "skip" : "import";

/** Fields worth copying onto the existing record when merging. */
export function mergePatch(row: DedupeCandidate, existing: ExistingTxn) {
  const patch: Record<string, unknown> = {};
  if (row.vendor_name && !existing.vendor_name) patch.vendor_name = row.vendor_name;
  const rowNotes = (row.notes ?? "").trim();
  const exNotes = (existing.notes ?? "").trim();
  if (rowNotes && normalizeText(rowNotes) !== normalizeText(exNotes)) {
    patch.notes = exNotes ? `${exNotes}\n${rowNotes}` : rowNotes;
  }
  if (!sameAmount(row.amount, existing.amount)) patch.amount = row.amount;
  return patch;
}
