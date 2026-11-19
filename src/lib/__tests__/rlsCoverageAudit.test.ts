/**
 * Coverage audit for the RLS contract tests.
 *
 * The cross-tenant and cross-branch contract tests are only useful if every
 * tenant-scoped table is actually in their parametrised list. This meta-test
 * fails when someone introduces a new tenant-scoped table without adding it
 * to `rlsTenantIsolation.contract.test.ts` (or to the explicit exempt set
 * below for legitimate exceptions like internal queue/staging tables).
 *
 * The "list of tenant-scoped public tables" comes from the generated
 * `src/integrations/db/types.ts`, so it stays current with the
 * schema automatically — no manual list to maintain.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = process.cwd();
const TYPES_PATH = join(REPO_ROOT, "src/integrations/db/types.ts");
const TENANT_TEST_PATH = join(
  REPO_ROOT,
  "src/lib/__tests__/rlsTenantIsolation.contract.test.ts",
);
const BRANCH_TEST_PATH = join(
  REPO_ROOT,
  "src/lib/__tests__/rlsBranchPinIsolation.contract.test.ts",
);

/**
 * Tables that legitimately don't need to appear in the per-tenant contract
 * test. Keep this list short and justified.
 */
const TENANT_AUDIT_EXEMPT = new Set<string>([
  // Platform-level tables that have a tenant_id for analytics but are
  // intentionally readable cross-tenant by SuperAdmins / pg_cron workers.
  "client_errors",
  "audit_logs",
  "superadmin_audit_logs",
  "tenant_costs",
  "tenant_usage_daily",
  "tenant_usage_metrics",
  "platform_metrics",
  // Notification / email queues processed by workers.
  "email_queue",
  "notification_queue",
  "webhook_deliveries",
  // Public-by-design metadata (e.g. live menu, branding) read without auth.
  "restaurant_branding",
  "live_menu_snapshots",
]);

const BRANCH_AUDIT_EXEMPT = new Set<string>([
  // Branch-pinned tables that legitimately need cross-branch reads.
  "menu_items",
  "inventory_items",
  "inventory_categories",
  "suppliers",
  "recipes",
  "recipe_items",
  "menu_categories",
]);

/**
 * Parse `public.Tables` from the generated types.ts. Returns the set of
 * table names that declare a given column (in their Row type).
 *
 * The generated file structure looks like:
 *
 *   Tables: {
 *     some_table: {
 *       Row: {
 *         id: string
 *         tenant_id: string | null
 *         ...
 *       }
 *       ...
 *     }
 *     ...
 *   }
 */
function tablesWithColumn(typesSrc: string, column: string): Set<string> {
  const result = new Set<string>();
  // Anchor on "    Tables: {" — public schema is the first top-level entry
  // and indentation in the generated file is 4 spaces per level.
  const tablesIdx = typesSrc.indexOf("    Tables: {");
  if (tablesIdx === -1) return result;

  // Walk lines from tablesIdx onward, tracking brace depth so we stop at
  // the matching close-brace for the Tables block.
  const tail = typesSrc.slice(tablesIdx);
  const lines = tail.split("\n");
  // We start *on* the `Tables: {` line. depth is the brace-nesting level
  // before the current line's braces are applied. After we consume the
  // opening `Tables: {` line, depth becomes 1. Table headers therefore
  // appear at depth === 1.
  let depth = 0;
  let currentTable: string | null = null;
  let currentTableDepth = -1;
  let inRow = false;
  let rowDepth = -1;

  const tableHeaderRe = /^ {6}([a-z][a-z0-9_]*):\s*\{/;
  const rowHeaderRe = /^\s+Row:\s*\{/;
  const columnRe = new RegExp(`^\\s+${column}\\s*:`);

  for (const line of lines) {
    // Update depth based on braces on this line (after we read it for
    // headers — order matters).
    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;

    const headerMatch = line.match(tableHeaderRe);
    if (headerMatch && depth === 1) {
      currentTable = headerMatch[1];
      currentTableDepth = depth;
      inRow = false;
    } else if (currentTable && rowHeaderRe.test(line)) {
      inRow = true;
      rowDepth = depth;
    } else if (currentTable && inRow && columnRe.test(line)) {
      result.add(currentTable);
    }

    depth += opens - closes;

    if (inRow && depth <= rowDepth) inRow = false;
    if (currentTable && depth <= currentTableDepth) currentTable = null;

    // Stop once we leave the Tables block entirely.
    if (depth < 1) break;
  }

  return result;
}

function tablesListedInTest(testPath: string, constName: string): Set<string> {
  if (!existsSync(testPath)) return new Set();
  const src = readFileSync(testPath, "utf8");
  const block = new RegExp(
    `const\\s+${constName}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as\\s+const`,
  ).exec(src);
  if (!block) return new Set();
  const names = [...block[1].matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
  return new Set(names);
}

describe("RLS contract-test coverage audit", () => {
  const typesSrc = readFileSync(TYPES_PATH, "utf8");

  it("every tenant-scoped public table is covered by the cross-tenant contract test", () => {
    const tenantTables = tablesWithColumn(typesSrc, "tenant_id");
    const covered = tablesListedInTest(
      TENANT_TEST_PATH,
      "TENANT_PRIVATE_TABLES",
    );

    const missing = [...tenantTables].filter(
      (t) => !covered.has(t) && !TENANT_AUDIT_EXEMPT.has(t),
    );

    expect(
      missing,
      `These tenant-scoped tables are not in TENANT_PRIVATE_TABLES (add them, or justify and add to TENANT_AUDIT_EXEMPT):\n  ${missing.join("\n  ")}`,
    ).toHaveLength(0);
  });

  it("every branch-pinned public table is covered by the cross-branch contract test", () => {
    // Restaurant ≈ branch in this codebase.
    const branchTables = tablesWithColumn(typesSrc, "restaurant_id");
    const covered = tablesListedInTest(
      BRANCH_TEST_PATH,
      "BRANCH_PINNED_TABLES",
    );

    // If the branch contract test has no list yet, treat as informational
    // (don't block CI on a test that hasn't onboarded its parametrised list).
    if (covered.size === 0) {
      expect(branchTables.size).toBeGreaterThan(0);
      return;
    }

    const missing = [...branchTables].filter(
      (t) => !covered.has(t) && !BRANCH_AUDIT_EXEMPT.has(t),
    );

    expect(
      missing,
      `These branch-pinned tables are not in BRANCH_PINNED_TABLES (add them, or justify and add to BRANCH_AUDIT_EXEMPT):\n  ${missing.join("\n  ")}`,
    ).toHaveLength(0);
  });
});