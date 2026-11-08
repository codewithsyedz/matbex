/**
 * Static contract: every Supabase read in `useDashboardData` must be scoped to
 * the active branch, and every cached query key must include the branch id.
 *
 * A source-level audit is used (instead of rendering the hook) because the hook
 * fans out into ~20 queries; this catches a dropped `branch_id` filter or a
 * branch-less query key at the point where it is introduced.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(join(process.cwd(), "src/hooks/useDashboardData.ts"), "utf8");

/** Columns that legitimately express "this row belongs to the active branch". */
const BRANCH_FILTER = /(branch_id|assigned_branch_id|p_branch_id|branchId)/;

/**
 * Queries that legitimately need no branch filter: pure id -> label lookups
 * that resolve ids already produced by a branch-scoped query above them.
 */
const LOOKUP_EXEMPT = new Set(["staffNames", "cashierProfiles"]);

function blocks(source: string): { name: string; body: string }[] {
  // Split on each `useQuery({` call site and keep the following body.
  const parts = source.split(/useQuery(?:<[^>]*>)?\s*\(\s*\{/).slice(1);
  return parts.map((body, i) => {
    const name = body.match(/entity\(\s*"([^"]+)"/)?.[1] ?? `query#${i}`;
    // Stop at the next query definition to keep bodies from bleeding together.
    return { name, body: body.slice(0, 2500) };
  });
}

describe("useDashboardData branch scoping", () => {
  const parsed = blocks(SRC);

  it("parses the dashboard query sites", () => {
    expect(parsed.length).toBeGreaterThan(5);
  });

  it("every query key is keyed by the active branch", () => {
    const offenders = parsed
      .filter((b) => /queryKey:/.test(b.body))
      .filter((b) => !LOOKUP_EXEMPT.has(b.name))
      .filter((b) => !/queryKey:[\s\S]{0,300}?branchId/.test(b.body))
      .map((b) => b.name);
    expect(offenders).toEqual([]);
  });

  it("every query body applies a branch filter", () => {
    const offenders = parsed
      .filter((b) => /supabase\s*\n?\s*\.?from\(|\.from\(|supabase\.rpc\(|fetch[A-Za-z]+\(/.test(b.body))
      .filter((b) => !LOOKUP_EXEMPT.has(b.name))
      .filter((b) => !BRANCH_FILTER.test(b.body))
      .map((b) => b.name);
    expect(offenders).toEqual([]);
  });

  it("staff-related reads scope on assigned_branch_id, not branch_id", () => {
    const staffReads = (SRC.match(/from\("staff"\)[\s\S]{0,600}/g) ?? [])
      // id -> name lookups are resolved from ids that are already branch-scoped
      .filter((read) => !/\.in\(/.test(read.slice(0, 200)));
    expect(staffReads.length).toBeGreaterThan(0);
    for (const read of staffReads) {
      expect(read).toMatch(/assigned_branch_id/);
      expect(read).not.toMatch(/\.eq\("branch_id"/);
    }
  });

  it("journal entry batch reads (wherever they appear) filter by branch", () => {
    const journalReads = SRC.match(/from\("journal_entry_batches"\)[\s\S]{0,600}/g) ?? [];
    for (const read of journalReads) {
      expect(read).toMatch(/branch_id/);
    }
  });
});
