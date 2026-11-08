/**
 * Audit trail for blocked saves.
 *
 * Whenever a posting rule (client-side mirror or database trigger) refuses a
 * save, we persist what was attempted, which rule fired, and exactly which
 * fields/accounts caused the rejection — so the block is reviewable later
 * instead of vanishing with the toast.
 */
import type { RuleViolation } from "@/lib/accountPostingRules";

export type RejectionSource =
  | "expense_form"
  | "chart_of_accounts"
  | "journal_entry"
  | "acquisition_import"
  | "project_import"
  | "other";

export type RejectionOrigin = "client" | "database";

export interface RejectionField {
  /** Machine name of the form field, e.g. "account_id". */
  field: string;
  /** Human label shown in the audit trail, e.g. "Expense account". */
  label: string;
  /** Value the user attempted to save, rendered as text. */
  value: string | null;
}

export interface RejectionContext {
  tenantId?: string | null;
  branchId?: string | null;
  userId?: string | null;
  source: RejectionSource;
  origin?: RejectionOrigin;
  route?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  attemptedAmount?: number | null;
  attemptedDate?: string | null;
  fields?: RejectionField[];
  /** Free-form snapshot of the attempted values (no secrets). */
  values?: Record<string, unknown>;
}

export interface PostingRejectionRow {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  user_id: string | null;
  occurred_at: string;
  rule: string;
  source: string;
  origin: string;
  title: string;
  message: string;
  route: string | null;
  entity_type: string | null;
  entity_id: string | null;
  attempted_amount: number | null;
  attempted_date: string | null;
  offending_accounts: { label: string; note: string }[];
  offending_fields: RejectionField[];
  attempted_values: Record<string, unknown>;
}

export const REJECTION_SOURCE_LABELS: Record<string, string> = {
  expense_form: "Record expense",
  chart_of_accounts: "Chart of accounts",
  journal_entry: "Journal entry",
  acquisition_import: "Acquisition import",
  project_import: "Project sheet import",
  other: "Other",
};

export const REJECTION_RULE_LABELS: Record<string, string> = {
  partner_funding_as_revenue: "Partner funding vs revenue",
  expense_to_fixed_asset: "Expense charged to a fixed asset",
  partner_account_as_expense: "Partner account used as expense",
};

const trim = (v: string | null | undefined, max = 500) =>
  typeof v === "string" ? v.slice(0, max) : null;

/** Drops empty fields and normalises values to short strings. */
export function normaliseFields(fields: RejectionField[] = []): RejectionField[] {
  return fields
    .filter((f) => f && f.field)
    .map((f) => ({
      field: f.field,
      label: f.label || f.field,
      value:
        f.value === null || f.value === undefined || f.value === ""
          ? null
          : trim(String(f.value), 200),
    }));
}

/** Builds the insert payload for `posting_rule_rejections`. */
export function buildRejectionRecord(
  violation: RuleViolation,
  ctx: RejectionContext,
): Record<string, unknown> | null {
  if (!ctx.tenantId) return null;
  return {
    tenant_id: ctx.tenantId,
    branch_id: ctx.branchId ?? null,
    user_id: ctx.userId ?? null,
    rule: violation.rule,
    source: ctx.source,
    origin: ctx.origin ?? "client",
    title: trim(violation.title, 300) ?? violation.rule,
    message: trim(violation.message, 2000) ?? "",
    route: trim(ctx.route ?? null, 300),
    entity_type: ctx.entityType ?? null,
    entity_id: ctx.entityId ?? null,
    attempted_amount:
      typeof ctx.attemptedAmount === "number" && Number.isFinite(ctx.attemptedAmount)
        ? ctx.attemptedAmount
        : null,
    attempted_date: ctx.attemptedDate || null,
    offending_accounts: violation.offending ?? [],
    offending_fields: normaliseFields(ctx.fields),
    attempted_values: ctx.values ?? {},
  };
}

export interface RejectionSummary {
  total: number;
  byRule: Record<string, number>;
  bySource: Record<string, number>;
  last24h: number;
}

export function summariseRejections(rows: PostingRejectionRow[]): RejectionSummary {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const byRule: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  let last24h = 0;
  for (const r of rows) {
    byRule[r.rule] = (byRule[r.rule] ?? 0) + 1;
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    if (new Date(r.occurred_at).getTime() >= cutoff) last24h += 1;
  }
  return { total: rows.length, byRule, bySource, last24h };
}

const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export function rejectionsToCsv(rows: PostingRejectionRow[]): string {
  const header = [
    "When",
    "Rule",
    "Screen",
    "Detected by",
    "Title",
    "Message",
    "Amount",
    "Entry date",
    "Offending accounts",
    "Offending fields",
  ];
  const lines = rows.map((r) =>
    [
      r.occurred_at,
      REJECTION_RULE_LABELS[r.rule] ?? r.rule,
      REJECTION_SOURCE_LABELS[r.source] ?? r.source,
      r.origin === "database" ? "Ledger (database)" : "Form validation",
      r.title,
      r.message,
      r.attempted_amount ?? "",
      r.attempted_date ?? "",
      (r.offending_accounts ?? []).map((a) => a.label).join(" | "),
      (r.offending_fields ?? [])
        .map((f) => `${f.label}=${f.value ?? "(empty)"}`)
        .join(" | "),
    ]
      .map(esc)
      .join(","),
  );
  return [header.map(esc).join(","), ...lines].join("\n");
}
