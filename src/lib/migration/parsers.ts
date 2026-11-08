/**
 * Lightweight CSV parsing + per-entity validators for the migration assistant.
 * No external dependencies - handles quoted fields, escaped quotes, and CRLF.
 */

export type EntityType = "menu" | "inventory" | "customers" | "staff";

export interface FieldSpec {
  key: string;
  label: string;
  required?: boolean;
  aliases?: string[]; // alternative header names from common POS exports
  type?: "string" | "number" | "boolean";
  example?: string;
}

export interface EntitySpec {
  type: EntityType;
  label: string;
  description: string;
  targetTable: string;
  fields: FieldSpec[];
}

export const ENTITY_SPECS: Record<EntityType, EntitySpec> = {
  menu: {
    type: "menu",
    label: "Menu items",
    description: "Products sold through the POS - names, categories, prices.",
    targetTable: "menu_items",
    fields: [
      { key: "name", label: "Item name", required: true, aliases: ["item", "product", "title", "menu_item"], example: "Chicken Shawarma" },
      { key: "category", label: "Category", aliases: ["group", "section", "menu_group"], example: "Main" },
      { key: "selling_price", label: "Selling price", required: true, type: "number", aliases: ["price", "unit_price", "amount"], example: "25.00" },
      { key: "description", label: "Description", aliases: ["desc"], example: "" },
      { key: "vat_category", label: "VAT category (S/Z/E/O)", aliases: ["tax_code", "vat"], example: "S" },
    ],
  },
  inventory: {
    type: "inventory",
    label: "Inventory items",
    description: "Stock items with units, costs, and opening balances.",
    targetTable: "inventory_items",
    fields: [
      { key: "name", label: "Item name", required: true, aliases: ["ingredient", "product"], example: "Chicken breast" },
      { key: "unit", label: "Unit", required: true, aliases: ["uom", "measure"], example: "kg" },
      { key: "unit_cost", label: "Unit cost", required: true, type: "number", aliases: ["cost", "price"], example: "18.50" },
      { key: "current_stock", label: "Opening stock", type: "number", aliases: ["stock", "quantity", "qty"], example: "25" },
      { key: "reorder_level", label: "Reorder level", type: "number", aliases: ["par", "min_stock"], example: "5" },
      { key: "category", label: "Category", aliases: ["group"], example: "Proteins" },
    ],
  },
  customers: {
    type: "customers",
    label: "Customers",
    description: "Customer accounts, contact info, and credit balances.",
    targetTable: "customers",
    fields: [
      { key: "name", label: "Customer name", required: true, aliases: ["full_name", "customer"], example: "Acme Catering" },
      { key: "phone", label: "Phone", aliases: ["mobile", "tel"], example: "+966500000000" },
      { key: "email", label: "Email", aliases: ["mail"], example: "info@acme.com" },
      { key: "address", label: "Address", aliases: ["location"], example: "" },
      { key: "credit_limit", label: "Credit limit", type: "number", aliases: ["limit"], example: "1000" },
      { key: "current_balance", label: "Opening balance", type: "number", aliases: ["balance", "outstanding"], example: "0" },
    ],
  },
  staff: {
    type: "staff",
    label: "Staff",
    description: "Team members with roles and pay structure (no logins created).",
    targetTable: "staff",
    fields: [
      { key: "name", label: "Full name", required: true, aliases: ["full_name", "employee"], example: "Ali Khan" },
      { key: "role", label: "Role", required: true, aliases: ["position", "job_title"], example: "cashier" },
      { key: "phone", label: "Phone", aliases: ["mobile"], example: "+966500000000" },
      { key: "payment_type", label: "Payment type (hourly|monthly)", aliases: ["pay_type"], example: "monthly" },
      { key: "hourly_rate", label: "Hourly rate", type: "number", aliases: ["rate"], example: "0" },
      { key: "monthly_salary", label: "Monthly salary", type: "number", aliases: ["salary"], example: "3000" },
    ],
  },
};

// ---------- CSV parsing ----------

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else { field += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { cur.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        cur.push(field); field = "";
        if (cur.some(v => v.length > 0)) rows.push(cur);
        cur = [];
      } else field += c;
    }
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    if (cur.some(v => v.length > 0)) rows.push(cur);
  }
  return rows;
}

export interface ParsedFile {
  headers: string[];
  rows: Record<string, string>[];
  suggestedMapping: Record<string, string>; // entityFieldKey -> csvHeader
}

export function readCsv(text: string, spec: EntitySpec): ParsedFile {
  const grid = parseCsv(text);
  if (grid.length === 0) return { headers: [], rows: [], suggestedMapping: {} };
  const headers = grid[0].map(h => h.trim());
  const rows = grid.slice(1).map(r => {
    const o: Record<string, string> = {};
    headers.forEach((h, idx) => { o[h] = (r[idx] ?? "").trim(); });
    return o;
  });
  const lc = headers.map(h => h.toLowerCase().replace(/[\s_-]+/g, ""));
  const suggestedMapping: Record<string, string> = {};
  for (const f of spec.fields) {
    const candidates = [f.key, ...(f.aliases ?? [])].map(s => s.toLowerCase().replace(/[\s_-]+/g, ""));
    const idx = lc.findIndex(h => candidates.includes(h));
    if (idx >= 0) suggestedMapping[f.key] = headers[idx];
  }
  return { headers, rows, suggestedMapping };
}

// ---------- Normalization + validation ----------

export interface RowOutcome {
  rowNumber: number;
  raw: Record<string, string>;
  normalized: Record<string, unknown> | null;
  errors: string[];
  status: "valid" | "invalid";
}

export function normalizeAndValidate(
  rows: Record<string, string>[],
  mapping: Record<string, string>,
  spec: EntitySpec,
): RowOutcome[] {
  return rows.map((raw, i) => {
    const errors: string[] = [];
    const normalized: Record<string, unknown> = {};
    for (const f of spec.fields) {
      const src = mapping[f.key];
      const rawVal = src ? (raw[src] ?? "").trim() : "";
      if (!rawVal) {
        if (f.required) errors.push(`${f.label} is required`);
        continue;
      }
      if (f.type === "number") {
        const n = Number(rawVal.replace(/[, ]/g, ""));
        if (Number.isNaN(n)) errors.push(`${f.label} must be a number (got "${rawVal}")`);
        else normalized[f.key] = n;
      } else if (f.type === "boolean") {
        normalized[f.key] = ["1", "true", "yes", "y"].includes(rawVal.toLowerCase());
      } else {
        normalized[f.key] = rawVal;
      }
    }
    // entity-specific tweaks
    if (spec.type === "menu" && normalized.vat_category) {
      const v = String(normalized.vat_category).toUpperCase();
      if (!["S", "Z", "E", "O"].includes(v)) errors.push("VAT category must be S, Z, E, or O");
      else normalized.vat_category = v;
    }
    if (spec.type === "staff" && normalized.payment_type) {
      const v = String(normalized.payment_type).toLowerCase();
      if (!["hourly", "monthly"].includes(v)) errors.push("Payment type must be hourly or monthly");
      else normalized.payment_type = v;
    }
    return {
      rowNumber: i + 2, // header is row 1
      raw,
      normalized: errors.length === 0 ? normalized : null,
      errors,
      status: errors.length === 0 ? "valid" : "invalid",
    };
  });
}

// ---------- CSV template download ----------

export function buildTemplateCsv(spec: EntitySpec): string {
  const header = spec.fields.map(f => f.key).join(",");
  const example = spec.fields.map(f => csvEscape(f.example ?? "")).join(",");
  return `${header}\n${example}\n`;
}

function csvEscape(v: string): string {
  if (v.includes(",") || v.includes('"') || v.includes("\n")) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}