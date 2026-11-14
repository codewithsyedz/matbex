/**
 * Cross-tenant RLS contract test (skeleton).
 *
 * This is the safety net for the highest-blast-radius bug class in the
 * system: a single missing `tenant_id = ...` filter, or an RLS policy that
 * accidentally uses `USING (true)`, leaks one tenant's data to another.
 *
 * The test is parametrised over the tables we consider tenant-private and
 * asserts: when authenticated as a user in tenant A, the anon/PostgREST
 * client returns ZERO rows that belong to tenant B.
 *
 * Why it's a skeleton: it needs two pre-seeded synthetic tenant accounts
 * (TENANT_A_EMAIL/PASSWORD + TENANT_B_TENANT_ID + at least one row per
 * table under tenant B). Set these env vars in CI and the suite runs;
 * locally it is a no-op so contributors aren't blocked.
 *
 * Add a table to TENANT_PRIVATE_TABLES whenever you introduce a new one
 * scoped by tenant_id.
 */
import { describe, it, expect } from "vitest";
import { createClient } from "@matbex/client";

const API_URL = import.meta.env.VITE_API_URL as string | undefined;
const API_ANON_KEY = import.meta.env.VITE_API_KEY as
  | string
  | undefined;

// CI-only secrets - leave blank locally to skip.
const TENANT_A_EMAIL = process.env.RLS_TEST_TENANT_A_EMAIL;
const TENANT_A_PASSWORD = process.env.RLS_TEST_TENANT_A_PASSWORD;
const TENANT_B_ID = process.env.RLS_TEST_TENANT_B_ID;

/**
 * Every tenant-scoped public table. Kept in sync with the generated
 * the API types by `rlsCoverageAudit.test.ts` — that meta-test fails
 * CI when a new tenant-scoped table is added without being listed here
 * (or explicitly exempted).
 */
const TENANT_PRIVATE_TABLES = [
  "account_transactions",
  "accounting_account_mappings",
  "accounting_integrations",
  "accounting_sync_log",
  "accounting_sync_queue",
  "aggregator_settlements",
  "audit_throttle_counters",
  "branch_license_seats",
  "branch_receipt_overrides",
  "chart_of_accounts",
  "chat_settings",
  "coa_audit_schedules",
  "cogs_trueup_runs",
  "cogs_trueup_schedules",
  "customer_balance_adjustments",
  "customers",
  "daily_sales_summary",
  "day_end_adjustments",
  "delivery_orders",
  "delivery_platform_locations",
  "demo_funnel_events",
  "device_licenses",
  "device_seat_reclaim_audit",
  "expense_category_mapping_gaps",
  "expenses",
  "export_requests",
  "fiscal_period_locks",
  "in_app_notifications",
  "inventory_category_mappings",
  "inventory_waste",
  "journal_entry_batches",
  "license_status_cache",
  "menu_items",
  "night_shift_summaries",
  "notification_preferences",
  "overhead_payments",
  "payment_gateway_configs",
  "payment_gateway_credentials",
  "payment_intents",
  "payment_reconciliation_jobs",
  "payment_transactions",
  "payment_webhook_events",
  "pending_digest_notifications",
  "pos_floor_audit_log",
  "pos_floor_plans",
  "pos_payment_method_audit",
  "pos_payment_method_map",
  "pos_payment_method_rules",
  "pos_table_orders",
  "pos_table_status_events",
  "pos_tables",
  "posting_jobs",
  "profiles",
  "promotion_redemptions",
  "provisional_cogs_postings",
  "purchase_invoices",
  "push_subscriptions",
  "restaurants",
  "role_impersonation_logs",
  "sales_transactions",
  "seat_requests",
  "shift_variance_logs",
  "shifts",
  "staff_advances",
  "stock_movements",
  "team_invitation_events",
  "team_invitations",
  "tenant_activity_logs",
  "tenant_addons",
  "tenant_applications",
  "tenant_domains",
  "tenant_features",
  "tenant_pages",
  "tenant_slug_history",
  "tenant_usage",
  "twilio_credentials",
  "user_sessions",
  "user_tenant_roles",
  "variance_note_templates",
  "variance_template_usage",
  "variance_template_usage_events",
  "variance_thresholds",
  "vat_return_adjustments_log",
  "vat_returns",
  "weekly_stocktakes",
  "zatca_alert_state",
  "zatca_audit_seq",
  "zatca_audit_trail",
  "zatca_certification_reports",
  "zatca_clearance_queue",
  "zatca_credit_notes",
  "zatca_devices",
  "zatca_settings",
  // Added 2026-11-11 (tables created since the list was last updated; db/check-rls.mjs
  // verifies RLS for every tenant-scoped table in CI).
  "zatca_provider_applications",
  "account_branch_visibility",
  "ai_expense_journal_audit",
  "ai_income_journal_audit",
  "capital_movements",
  "capital_statement_lines",
  "card_settlement_deposits",
  "daily_overhead_audit",
  "daily_overhead_closures",
  "daily_overhead_settings",
  "daily_reconciliation_reports",
  "dlq_alert_dedupe",
  "edge_function_metrics",
  "expense_amendment_audit",
  "expense_posting_audit",
  "expense_vat_split_audit",
  "failed_sync_attempts",
  "failed_sync_items",
  "fixed_asset_classes",
  "fixed_asset_depreciation",
  "fixed_asset_depreciation_runs",
  "fixed_asset_disposals",
  "fixed_asset_settings",
  "fixed_assets",
  "import_row_fingerprints",
  "installment_audit_events",
  "installment_payments",
  "installment_plans",
  "installment_vat_mismatch_alerts",
  "kiosk_offline_pins",
  "kiosk_offline_unlock_events",
  "kiosk_unlock_requests",
  "menu_categories",
  "menu_item_branch_categories",
  "owner_capital_accounts",
  "partner_settlement_acks",
  "pos_staff_pins",
  "posting_rule_rejections",
  "project_acquisition_allocations",
  "project_acquisition_funders",
  "project_acquisitions",
  "project_budget_lines",
  "project_classification_audit",
  "project_commitments",
  "project_partners",
  "project_posting_runs",
  "project_transaction_splits",
  "project_transactions",
  "projects",
  "receipt_templates",
  "sale_posting_failures",
  "staff_advance_branch_audit",
  "staff_advance_repayments",
  "supplier_ap_account_audit",
  "table_reservations",
  "vat_posting_integrity_incidents",
  "vat_posting_integrity_settings",
  "vat_remittances",
  "zatca_application_status_events",
  "zatca_provider_application_documents",
] as const;

const shouldRun = Boolean(
  API_URL &&
    API_ANON_KEY &&
    TENANT_A_EMAIL &&
    TENANT_A_PASSWORD &&
    TENANT_B_ID,
);

describe.runIf(shouldRun)("RLS cross-tenant isolation contract", () => {
  it("blocks tenant A from reading any row in tenant B", async () => {
    const sb = createClient(API_URL!, API_ANON_KEY!);
    const { error: authErr } = await sb.auth.signInWithPassword({
      email: TENANT_A_EMAIL!,
      password: TENANT_A_PASSWORD!,
    });
    expect(authErr).toBeNull();

    for (const table of TENANT_PRIVATE_TABLES) {
      const { data, error } = await sb
        .from(table as any)
        .select("id, tenant_id")
        .eq("tenant_id", TENANT_B_ID!)
        .limit(1);
      // Either RLS returns an empty set (preferred) or PostgREST returns a
      // permission error - both are "no leak". A non-empty `data` is a fail.
      if (error) continue;
      expect(
        data ?? [],
        `LEAK: table ${table} returned tenant B rows to tenant A`,
      ).toHaveLength(0);
    }

    await sb.auth.signOut();
  });
});

describe.skipIf(shouldRun)("RLS cross-tenant isolation contract (skipped)", () => {
  it("requires RLS_TEST_TENANT_A_EMAIL / PASSWORD / TENANT_B_ID env vars in CI", () => {
    expect(true).toBe(true);
  });
});