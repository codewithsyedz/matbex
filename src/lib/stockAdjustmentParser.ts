import type { } from "react";

export type AdjustmentDirection = "add" | "remove";

export const VALID_REASON_CODES = [
  "stocktake_correction",
  "damaged",
  "expired",
  "theft_loss",
  "transfer_in",
  "transfer_out",
  "opening_balance",
  "other",
] as const;

export type ValidReasonCode = (typeof VALID_REASON_CODES)[number];

export const REASON_LABELS: Record<ValidReasonCode, string> = {
  stocktake_correction: "Stocktake correction",
  damaged: "Damaged / broken",
  expired: "Expired",
  theft_loss: "Theft / loss",
  transfer_in: "Transfer in",
  transfer_out: "Transfer out",
  opening_balance: "Opening balance",
  other: "Other",
};

export interface RawCsvRow {
  rowNumber: number;
  raw: Record<string, string>;
}

export interface ParsedAdjustmentRow {
  rowNumber: number;
  itemName: string;
  itemId?: string;
  direction: AdjustmentDirection;
  quantity: number;
  reasonCode: ValidReasonCode;
  referenceNumber: string | null;
  notes: string | null;
  // Computed at validation time:
  stockBefore?: number;
  stockAfter?: number;
  stockUnit?: string;
  errors: string[];
  warnings: string[];
}

const REQUIRED_HEADERS = [
  "item_name",
  "direction",
  "quantity",
  "reason_code",
];

/**
 * Tiny RFC-4180-ish CSV splitter.
 * Handles quoted fields, escaped quotes, and commas inside quotes.
 */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === ",") {
        out.push(cur);
        cur = "";
      } else if (ch === '"') {
        inQuotes = true;
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export interface CsvParseResult {
  rows: RawCsvRow[];
  headerErrors: string[];
  headers: string[];
}

export function parseAdjustmentCsv(content: string): CsvParseResult {
  const text = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!text) {
    return { rows: [], headerErrors: ["File is empty"], headers: [] };
  }
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return {
      rows: [],
      headerErrors: ["CSV must contain a header row and at least one data row"],
      headers: [],
    };
  }
  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/^"|"$/g, ""));
  const headerErrors: string[] = [];
  for (const req of REQUIRED_HEADERS) {
    if (!headers.includes(req)) {
      headerErrors.push(`Missing required column: ${req}`);
    }
  }
  if (headerErrors.length > 0) {
    return { rows: [], headerErrors, headers };
  }

  const rows: RawCsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const raw: Record<string, string> = {};
    headers.forEach((h, idx) => {
      raw[h] = (cols[idx] ?? "").trim();
    });
    rows.push({ rowNumber: i + 1, raw });
  }
  return { rows, headerErrors: [], headers };
}

export interface InventoryItemLookup {
  id: string;
  name: string;
  current_stock: number;
  unit: string | null;
  stock_unit: string | null;
}

export function validateAdjustmentRows(
  rows: RawCsvRow[],
  items: InventoryItemLookup[],
): ParsedAdjustmentRow[] {
  // Build a case-insensitive name -> item map. Detect ambiguous names.
  const nameMap = new Map<string, InventoryItemLookup[]>();
  for (const it of items) {
    const k = it.name.trim().toLowerCase();
    const arr = nameMap.get(k) || [];
    arr.push(it);
    nameMap.set(k, arr);
  }

  // Track running projected stock per item across the file so we can warn on
  // cumulative negative balance even when row-level stays positive.
  const projected = new Map<string, number>();

  const out: ParsedAdjustmentRow[] = [];
  for (const r of rows) {
    const errors: string[] = [];
    const warnings: string[] = [];
    const itemName = (r.raw.item_name || "").trim();
    const directionRaw = (r.raw.direction || "").trim().toLowerCase();
    const qtyRaw = (r.raw.quantity || "").trim();
    const reasonRaw = (r.raw.reason_code || "").trim().toLowerCase();
    const referenceNumber = (r.raw.reference_number || "").trim() || null;
    const notes = (r.raw.notes || "").trim() || null;

    // item_name + lookup
    let itemId: string | undefined;
    let item: InventoryItemLookup | undefined;
    if (!itemName) {
      errors.push("item_name is required");
    } else {
      const matches = nameMap.get(itemName.toLowerCase()) || [];
      if (matches.length === 0) {
        errors.push(`No active inventory item named "${itemName}"`);
      } else if (matches.length > 1) {
        errors.push(`Multiple inventory items named "${itemName}" - rename one to be unique`);
      } else {
        item = matches[0];
        itemId = item.id;
      }
    }

    // direction
    let direction: AdjustmentDirection = "add";
    if (directionRaw !== "add" && directionRaw !== "remove") {
      errors.push(`direction must be "add" or "remove" (got "${r.raw.direction}")`);
    } else {
      direction = directionRaw as AdjustmentDirection;
    }

    // quantity
    const qty = parseFloat(qtyRaw);
    if (!qtyRaw) {
      errors.push("quantity is required");
    } else if (!Number.isFinite(qty) || qty <= 0) {
      errors.push(`quantity must be a positive number (got "${qtyRaw}")`);
    }

    // reason_code
    let reasonCode: ValidReasonCode = "other";
    if (!reasonRaw) {
      errors.push("reason_code is required");
    } else if (!(VALID_REASON_CODES as readonly string[]).includes(reasonRaw)) {
      errors.push(
        `reason_code "${r.raw.reason_code}" is not valid. Allowed: ${VALID_REASON_CODES.join(", ")}`,
      );
    } else {
      reasonCode = reasonRaw as ValidReasonCode;
    }

    // Projected stock check (only when item + qty + direction are valid)
    let stockBefore: number | undefined;
    let stockAfter: number | undefined;
    let stockUnit: string | undefined;
    if (item && Number.isFinite(qty) && qty > 0 && errors.length === 0) {
      const signed = direction === "add" ? qty : -qty;
      const running = projected.get(item.id);
      stockBefore = running ?? (Number(item.current_stock) || 0);
      stockAfter = stockBefore + signed;
      stockUnit = item.stock_unit || item.unit || "unit";
      projected.set(item.id, stockAfter);
      if (stockAfter < 0) {
        warnings.push(
          `Would drop stock to ${stockAfter.toFixed(2)} ${stockUnit} (negative)`,
        );
      }
    }

    out.push({
      rowNumber: r.rowNumber,
      itemName,
      itemId,
      direction,
      quantity: Number.isFinite(qty) && qty > 0 ? qty : 0,
      reasonCode,
      referenceNumber,
      notes,
      stockBefore,
      stockAfter,
      stockUnit,
      errors,
      warnings,
    });
  }
  return out;
}