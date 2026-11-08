import * as XLSX from "xlsx";

export interface SheetRow {
  vendor_name: string;
  txn_date: string;
  paid_by_name: string;
  amount: number;
  notes: string;
  status: string;
  cost_center: string;
  /** Raw account text from the sheet ("5100", "5100 - Kitchen Equipment"). */
  account: string;
}

export type MappableField = keyof SheetRow;

export const MAPPABLE_FIELDS: { field: MappableField; label: string; required?: boolean; aliases: string[] }[] = [
  { field: "vendor_name", label: "Vendor / item", aliases: ["vendor", "supplier", "payee", "item", "description", "particulars"] },
  { field: "txn_date", label: "Date", aliases: ["date", "txn date", "payment date", "invoice date"] },
  { field: "amount", label: "Amount", required: true, aliases: ["amount", "total", "value", "price", "debit"] },
  { field: "paid_by_name", label: "Paid by", aliases: ["paid by", "paidby", "partner", "payer", "paid_by"] },
  { field: "cost_center", label: "Cost centre", aliases: ["cost center", "cost centre", "costcenter", "branch", "location", "project", "department"] },
  { field: "account", label: "Account", aliases: ["account", "account code", "gl account", "gl code", "ledger account", "ledger", "coa", "head", "account head", "nominal"] },
  { field: "notes", label: "Notes", aliases: ["notes", "note", "remarks", "comment", "comments"] },
  { field: "status", label: "Status", aliases: ["status", "payment status"] },
];

export type ColumnMapping = Partial<Record<MappableField, string>>;

export interface RawSheet {
  headers: string[];
  rows: Record<string, unknown>[];
}

export interface ParsedWorkbook {
  sheetNames: string[];
  sheets: Record<string, RawSheet>;
}

const today = () => new Date().toISOString().slice(0, 10);

export function normaliseDate(raw: unknown): string {
  if (raw == null || raw === "") return today();
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.toISOString().slice(0, 10);
  if (typeof raw === "number") {
    const parsed = XLSX.SSF.parse_date_code(raw);
    if (parsed) {
      const m = String(parsed.m).padStart(2, "0");
      const d = String(parsed.d).padStart(2, "0");
      return `${parsed.y}-${m}-${d}`;
    }
    return today();
  }
  const v = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const dmy = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime()) ? today() : parsed.toISOString().slice(0, 10);
}

export function toAmount(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  if (raw == null) return 0;
  const n = Number(String(raw).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Best-guess mapping from a sheet's headers to our fields. */
export function autoMap(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<string>();
  for (const { field, aliases } of MAPPABLE_FIELDS) {
    const exact = headers.find((h) => !used.has(h) && aliases.includes(h.trim().toLowerCase()));
    const fuzzy =
      exact ??
      headers.find(
        (h) => !used.has(h) && aliases.some((a) => h.trim().toLowerCase().includes(a)),
      );
    if (fuzzy) {
      mapping[field] = fuzzy;
      used.add(fuzzy);
    }
  }
  return mapping;
}

export function applyMapping(rows: Record<string, unknown>[], mapping: ColumnMapping): SheetRow[] {
  const get = (row: Record<string, unknown>, field: MappableField) => {
    const col = mapping[field];
    return col ? row[col] : undefined;
  };
  const text = (v: unknown) => (v == null ? "" : String(v).trim());
  return rows
    .map((row) => ({
      vendor_name: text(get(row, "vendor_name")),
      txn_date: normaliseDate(get(row, "txn_date")),
      paid_by_name: text(get(row, "paid_by_name")),
      amount: toAmount(get(row, "amount")),
      notes: text(get(row, "notes")),
      status: text(get(row, "status")),
      cost_center: text(get(row, "cost_center")),
      account: text(get(row, "account")),
    }))
    .filter((r) => r.amount > 0);
}

export async function parseProjectWorkbook(file: File): Promise<ParsedWorkbook> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { cellDates: true });
  const sheets: Record<string, RawSheet> = {};
  const sheetNames: string[] = [];
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { defval: "" });
    if (rows.length === 0) continue;
    const headers = Array.from(new Set(rows.flatMap((r) => Object.keys(r)))).filter(
      (h) => h && !/^__EMPTY/.test(h),
    );
    sheets[name] = { headers, rows };
    sheetNames.push(name);
  }
  return { sheetNames, sheets };
}

export interface VendorGroup {
  label: string;
  amount: number;
  count: number;
}

export function groupByVendor(rows: SheetRow[], byCostCentre = false): VendorGroup[] {
  const map = new Map<string, VendorGroup>();
  for (const r of rows) {
    const base = r.vendor_name || "Unlabelled";
    const label = byCostCentre && r.cost_center ? `${r.cost_center} · ${base}` : base;
    const key = label.toLowerCase();
    const existing = map.get(key);
    if (existing) {
      existing.amount += r.amount;
      existing.count += 1;
    } else {
      map.set(key, { label, amount: r.amount, count: 1 });
    }
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}
