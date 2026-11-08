import * as XLSX from "xlsx";
import type { ColumnMapping, MappableField, SheetRow } from "@/lib/projectSheetImport";

export type IssueSeverity = "error" | "warning";

export interface RowIssue {
  field: MappableField | "row";
  severity: IssueSeverity;
  message: string;
  raw?: string;
}

export interface ValidatedRow {
  /** 1-based position in the sheet body (excludes header). */
  rowNumber: number;
  row: SheetRow;
  issues: RowIssue[];
  valid: boolean;
}

export interface ValidationReport {
  rows: ValidatedRow[];
  validRows: SheetRow[];
  blankRows: number;
  errorCount: number;
  warningCount: number;
}

const MAX_AMOUNT = 1_000_000_000;
const KNOWN_STATUS = ["paid", "unpaid", "pending", "partial", "draft", "posted", "review"];

const text = (v: unknown) => (v == null ? "" : String(v).trim());
const todayISO = () => new Date().toISOString().slice(0, 10);

export function parseAmountStrict(raw: unknown): { value: number | null; reason?: string } {
  if (raw == null || text(raw) === "") return { value: null, reason: "Amount is required" };
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return { value: null, reason: "Amount is not a finite number" };
    return { value: raw };
  }
  let s = text(raw).replace(/[\s,'٬]/g, "");
  let negative = false;
  const bracket = s.match(/^\((.*)\)$/);
  if (bracket) {
    negative = true;
    s = bracket[1];
  }
  s = s.replace(/[^\d.\-+]/g, "");
  if (s === "" || !/^[+-]?\d*\.?\d+$/.test(s)) {
    return { value: null, reason: `"${text(raw)}" is not a number` };
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return { value: null, reason: `"${text(raw)}" is not a number` };
  return { value: negative ? -n : n };
}

export function parseDateStrict(raw: unknown): { value: string | null; reason?: string } {
  if (raw == null || text(raw) === "") return { value: null, reason: "Date is empty" };
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime())
      ? { value: null, reason: "Invalid date value" }
      : { value: raw.toISOString().slice(0, 10) };
  }
  if (typeof raw === "number") {
    const parsed = XLSX.SSF.parse_date_code(raw);
    if (!parsed) return { value: null, reason: `Serial ${raw} is not a valid date` };
    return {
      value: `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`,
    };
  }
  const v = text(raw);
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(v)) {
    const [y, m, d] = v.split("-").map(Number);
    return isRealDate(y, m, d)
      ? { value: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` }
      : { value: null, reason: `"${v}" is not a real calendar date` };
  }
  const dmy = v.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (dmy) {
    const d = Number(dmy[1]);
    const m = Number(dmy[2]);
    const y = Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]);
    if (!isRealDate(y, m, d)) {
      return { value: null, reason: `"${v}" is not a real calendar date (expected DD/MM/YYYY)` };
    }
    return { value: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
  }
  const parsed = new Date(v);
  if (Number.isNaN(parsed.getTime())) {
    return { value: null, reason: `"${v}" is not a recognised date (use YYYY-MM-DD or DD/MM/YYYY)` };
  }
  return { value: parsed.toISOString().slice(0, 10) };
}

function isRealDate(y: number, m: number, d: number) {
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Validates raw sheet rows against a column mapping, before anything is imported.
 * Rows with errors are excluded from `validRows`; warnings are informational.
 */
export function validateRows(
  rawRows: Record<string, unknown>[],
  mapping: ColumnMapping,
  opts: {
    requireVendor?: boolean;
    requireDate?: boolean;
    allowNegative?: boolean;
    /**
     * Resolves the sheet's Account text to a chart_of_accounts entry. Rows that
     * cannot be resolved are flagged so they are fixed before posting.
     */
    resolveAccount?: (raw: string) => { matched: boolean; reason: string } | null;
    requireAccount?: boolean;
  } = {},
): ValidationReport {
  const get = (row: Record<string, unknown>, field: MappableField) => {
    const col = mapping[field];
    return col ? row[col] : undefined;
  };

  const rows: ValidatedRow[] = [];
  let blankRows = 0;

  rawRows.forEach((raw, index) => {
    const isBlank = Object.values(raw).every((v) => text(v) === "");
    if (isBlank) {
      blankRows += 1;
      return;
    }

    const issues: RowIssue[] = [];

    // Amount — required
    const amountRaw = get(raw, "amount");
    const amount = parseAmountStrict(amountRaw);
    if (amount.value == null) {
      issues.push({ field: "amount", severity: "error", message: amount.reason!, raw: text(amountRaw) });
    } else if (amount.value === 0) {
      issues.push({ field: "amount", severity: "error", message: "Amount is zero", raw: text(amountRaw) });
    } else if (amount.value < 0 && !opts.allowNegative) {
      issues.push({
        field: "amount",
        severity: "error",
        message: "Amount is negative — credits cannot be imported here",
        raw: text(amountRaw),
      });
    } else if (Math.abs(amount.value) > MAX_AMOUNT) {
      issues.push({
        field: "amount",
        severity: "error",
        message: "Amount is implausibly large — check for a formatting error",
        raw: text(amountRaw),
      });
    }

    // Date
    const dateRaw = get(raw, "txn_date");
    const date = parseDateStrict(dateRaw);
    if (date.value == null) {
      const empty = text(dateRaw) === "";
      if (empty && !opts.requireDate) {
        issues.push({ field: "txn_date", severity: "warning", message: "No date — today's date will be used" });
      } else {
        issues.push({
          field: "txn_date",
          severity: "error",
          message: empty ? "Date is required" : date.reason!,
          raw: text(dateRaw),
        });
      }
    } else if (new Date(`${date.value}T00:00:00Z`).getTime() > Date.now() + 86400000) {
      issues.push({ field: "txn_date", severity: "warning", message: "Date is in the future", raw: date.value });
    } else if (Number(date.value.slice(0, 4)) < 2000) {
      issues.push({ field: "txn_date", severity: "warning", message: "Date looks wrong (before 2000)", raw: date.value });
    }

    // Vendor
    const vendor = text(get(raw, "vendor_name"));
    if (!vendor) {
      issues.push({
        field: "vendor_name",
        severity: opts.requireVendor ? "error" : "warning",
        message: opts.requireVendor ? "Vendor / item is required" : "No vendor — row will import as “Unlabelled”",
      });
    } else if (vendor.length > 200) {
      issues.push({ field: "vendor_name", severity: "error", message: "Vendor name exceeds 200 characters" });
    }

    const notes = text(get(raw, "notes"));
    if (notes.length > 1000) {
      issues.push({ field: "notes", severity: "error", message: "Notes exceed 1000 characters" });
    }

    const status = text(get(raw, "status"));
    if (status && !KNOWN_STATUS.includes(status.toLowerCase())) {
      issues.push({ field: "status", severity: "warning", message: `Unrecognised status “${status}” — will be ignored` });
    }

    // Account — resolved against the chart of accounts when a resolver is supplied
    const accountText = text(get(raw, "account"));
    if (mapping.account || opts.requireAccount) {
      if (!accountText) {
        issues.push({
          field: "account",
          severity: opts.requireAccount ? "error" : "warning",
          message: opts.requireAccount
            ? "Account is required"
            : "No account — pick one in the preview before posting",
        });
      } else if (opts.resolveAccount) {
        const res = opts.resolveAccount(accountText);
        if (res && !res.matched) {
          issues.push({
            field: "account",
            severity: opts.requireAccount ? "error" : "warning",
            message: res.reason,
            raw: accountText,
          });
        }
      }
    }

    const row: SheetRow = {
      vendor_name: vendor,
      txn_date: date.value ?? todayISO(),
      paid_by_name: text(get(raw, "paid_by_name")),
      amount: amount.value ?? 0,
      notes,
      status,
      cost_center: text(get(raw, "cost_center")),
      account: accountText,
    };

    rows.push({
      rowNumber: index + 2, // +1 for 0-index, +1 for the header row
      row,
      issues,
      valid: !issues.some((i) => i.severity === "error"),
    });
  });

  return {
    rows,
    validRows: rows.filter((r) => r.valid).map((r) => r.row),
    blankRows,
    errorCount: rows.filter((r) => !r.valid).length,
    warningCount: rows.filter((r) => r.valid && r.issues.length > 0).length,
  };
}

const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`;

export function validationReportCsv(report: ValidationReport): string {
  const lines = ["Sheet row,Severity,Field,Issue,Value"];
  for (const r of report.rows) {
    for (const issue of r.issues) {
      lines.push(
        [r.rowNumber, issue.severity, issue.field, csvCell(issue.message), csvCell(issue.raw ?? "")].join(","),
      );
    }
  }
  return lines.join("\n");
}

export function downloadValidationReport(report: ValidationReport, fileName = "import-validation-report.csv") {
  const blob = new Blob([validationReportCsv(report)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
