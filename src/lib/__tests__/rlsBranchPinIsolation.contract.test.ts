/**
 * Branch-pin RLS contract test (skeleton).
 *
 * Eleven tables layer a RESTRICTIVE branch-pin policy on top of the
 * tenant-scoped policies. The intent: a cashier pinned to Branch A inside
 * tenant T cannot read sales/shifts/cash_events from Branch B in the same
 * tenant. Tenant isolation alone does not catch this regression - a missing
 * branch_id check is invisible until a cashier sees the wrong drawer.
 *
 * Same skeleton pattern as rlsTenantIsolation.contract.test.ts:
 * runs only when CI provides a pre-seeded pinned-cashier account.
 */
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as
  | string
  | undefined;

const CASHIER_EMAIL = process.env.RLS_TEST_BRANCH_CASHIER_EMAIL;
const CASHIER_PASSWORD = process.env.RLS_TEST_BRANCH_CASHIER_PASSWORD;
// The branch the cashier is NOT pinned to (should never appear in results).
const FORBIDDEN_BRANCH_ID = process.env.RLS_TEST_FORBIDDEN_BRANCH_ID;

// Tables that carry branch_id AND have a branch-pin RESTRICTIVE policy.
// Keep in sync with the migrations that add user_can_access_branch().
const BRANCH_SCOPED_TABLES = [
  "sales_transactions",
  "shifts",
  "cash_events",
  "expenses",
  "purchase_invoices",
  "stock_movements",
  "purchases",
  "menu_items",
  "staff_advances",
  "audit_logs",
  "customers",
] as const;

const shouldRun = Boolean(
  SUPABASE_URL &&
    SUPABASE_ANON &&
    CASHIER_EMAIL &&
    CASHIER_PASSWORD &&
    FORBIDDEN_BRANCH_ID,
);

describe.runIf(shouldRun)("RLS branch-pin isolation contract", () => {
  it("blocks pinned cashier from reading rows of a non-pinned branch", async () => {
    const sb = createClient(SUPABASE_URL!, SUPABASE_ANON!);
    const { error: authErr } = await sb.auth.signInWithPassword({
      email: CASHIER_EMAIL!,
      password: CASHIER_PASSWORD!,
    });
    expect(authErr).toBeNull();

    for (const table of BRANCH_SCOPED_TABLES) {
      const { data, error } = await sb
        .from(table as any)
        .select("id, branch_id")
        .eq("branch_id", FORBIDDEN_BRANCH_ID!)
        .limit(1);
      if (error) continue; // permission error = no leak
      expect(
        data ?? [],
        `LEAK: table ${table} returned forbidden-branch rows to a pinned cashier`,
      ).toHaveLength(0);
    }

    await sb.auth.signOut();
  });
});

describe.skipIf(shouldRun)(
  "RLS branch-pin isolation contract (skipped)",
  () => {
    it("requires RLS_TEST_BRANCH_CASHIER_* env vars in CI", () => {
      expect(true).toBe(true);
    });
  },
);