/**
 * Field-level diffing for installment / fixed-asset audit events.
 * Surfaces exactly which VAT and finance-charge fields were corrected.
 */

export type AuditFieldGroup = "vat" | "finance" | "asset" | "schedule" | "other";

export interface AuditFieldChange {
  field: string;
  label: string;
  group: AuditFieldGroup;
  from: string;
  to: string;
}

type FieldFormat = "money" | "percent" | "bool" | "int" | "text" | "date";

interface FieldSpec {
  label: string;
  group: AuditFieldGroup;
  format: FieldFormat;
}

const PLAN_FIELDS: Record<string, FieldSpec> = {
  vat_rate: { label: "VAT rate", group: "vat", format: "percent" },
  vat_amount: { label: "VAT on goods", group: "vat", format: "money" },
  price_includes_vat: { label: "Price includes VAT", group: "vat", format: "bool" },
  vat_on_finance_charge: { label: "VAT on finance charge", group: "vat", format: "bool" },
  finance_vat_amount: { label: "VAT on finance charge amount", group: "vat", format: "money" },
  finance_charge: { label: "Finance charge", group: "finance", format: "money" },
  cash_price: { label: "Cash price (net of VAT)", group: "finance", format: "money" },
  total_payable: { label: "Total payable", group: "finance", format: "money" },
  installment_count: { label: "Installments", group: "schedule", format: "int" },
  first_due_date: { label: "First due date", group: "schedule", format: "date" },
  frequency: { label: "Frequency", group: "schedule", format: "text" },
  status: { label: "Status", group: "other", format: "text" },
  description: { label: "Description", group: "other", format: "text" },
  supplier_name: { label: "Supplier", group: "other", format: "text" },
  provider: { label: "Provider", group: "other", format: "text" },
  purchase_date: { label: "Purchase date", group: "other", format: "date" },
};

const ASSET_FIELDS: Record<string, FieldSpec> = {
  cost: { label: "Capitalised cost", group: "asset", format: "money" },
  vat_amount: { label: "VAT amount", group: "vat", format: "money" },
  salvage_value: { label: "Salvage value", group: "asset", format: "money" },
  useful_life_months: { label: "Useful life (months)", group: "asset", format: "int" },
  depreciation_method: { label: "Depreciation method", group: "asset", format: "text" },
  class_id: { label: "Asset class", group: "asset", format: "text" },
  in_service_date: { label: "In-service date", group: "asset", format: "date" },
  acquisition_date: { label: "Acquisition date", group: "asset", format: "date" },
  name: { label: "Asset name", group: "asset", format: "text" },
  status: { label: "Status", group: "other", format: "text" },
  accumulated_depreciation: {
    label: "Accumulated depreciation",
    group: "asset",
    format: "money",
  },
};

function formatValue(value: unknown, format: FieldFormat): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (format) {
    case "money":
      return `﷼ ${Number(value).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    case "percent":
      return `${Number(value)}%`;
    case "bool":
      return value ? "Yes" : "No";
    case "int":
      return String(Number(value));
    case "date":
      return String(value).slice(0, 10);
    default:
      return String(value);
  }
}

function isEqual(a: unknown, b: unknown, format: FieldFormat): boolean {
  if (format === "money" || format === "percent" || format === "int") {
    const na = a === null || a === undefined ? null : Number(a);
    const nb = b === null || b === undefined ? null : Number(b);
    if (na === null || nb === null) return na === nb;
    return Math.abs(na - nb) < 0.005;
  }
  return a === b;
}

export function diffAuditEvent(
  entityType: string,
  oldData: Record<string, unknown> | null | undefined,
  newData: Record<string, unknown> | null | undefined,
): AuditFieldChange[] {
  if (!oldData || !newData) return [];
  const specs = entityType === "fixed_asset" ? ASSET_FIELDS : PLAN_FIELDS;
  const changes: AuditFieldChange[] = [];

  for (const [field, spec] of Object.entries(specs)) {
    const before = oldData[field];
    const after = newData[field];
    if (isEqual(before, after, spec.format)) continue;
    changes.push({
      field,
      label: spec.label,
      group: spec.group,
      from: formatValue(before, spec.format),
      to: formatValue(after, spec.format),
    });
  }

  const order: AuditFieldGroup[] = ["vat", "finance", "asset", "schedule", "other"];
  return changes.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
}

export const GROUP_LABEL: Record<AuditFieldGroup, string> = {
  vat: "VAT correction",
  finance: "Finance charge",
  asset: "Asset register",
  schedule: "Schedule",
  other: "Details",
};

/** Short human reason string, e.g. "VAT rate, Finance charge corrected". */
export function describeCorrection(changes: AuditFieldChange[]): string | null {
  const relevant = changes.filter((c) => c.group === "vat" || c.group === "finance");
  if (!relevant.length) return null;
  return `${relevant.map((c) => c.label).join(", ")} corrected`;
}
