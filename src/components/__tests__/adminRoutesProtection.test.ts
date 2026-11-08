import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guard test: every <Route> with a path starting with "/admin" MUST be
 * wrapped in <ProtectedAdminRoute>. This prevents a future refactor or
 * copy-paste from accidentally exposing a SuperAdmin page to tenants.
 *
 * The test parses the routes file as text rather than executing React, so
 * it stays fast and has no rendering dependencies.
 */

const ROUTES_FILE = resolve(__dirname, "../AnimatedRoutes.tsx");

function extractAdminRoutes(source: string): { path: string; element: string }[] {
  // Match each <Route path="/admin..." element={ ... } />
  // We greedily grab the element block by counting braces so nested JSX is fine.
  const results: { path: string; element: string }[] = [];
  const routeRe = /<Route\s+path=("\/admin[^"]*")\s+element=\{/g;
  let m: RegExpExecArray | null;
  while ((m = routeRe.exec(source)) !== null) {
    const path = m[1].slice(1, -1);
    let depth = 1;
    let i = routeRe.lastIndex;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      i++;
    }
    results.push({ path, element: source.slice(routeRe.lastIndex, i - 1) });
  }
  return results;
}

describe("admin route protection", () => {
  const source = readFileSync(ROUTES_FILE, "utf8");
  const adminRoutes = extractAdminRoutes(source);

  it("finds at least one /admin route (sanity check)", () => {
    expect(adminRoutes.length).toBeGreaterThan(0);
  });

  it("wraps every /admin route in <ProtectedAdminRoute>", () => {
    const unprotected = adminRoutes.filter(
      (r) => !/<ProtectedAdminRoute[\s>]/.test(r.element)
    );
    expect(
      unprotected,
      `These admin routes are missing <ProtectedAdminRoute>:\n${unprotected
        .map((r) => `  - ${r.path}`)
        .join("\n")}`
    ).toEqual([]);
  });

  it("does not wrap any /admin route in the tenant <ProtectedRoute>", () => {
    // ProtectedRoute (tenant guard) must never appear inside an /admin route.
    const wrongGuard = adminRoutes.filter((r) =>
      /<ProtectedRoute[\s>]/.test(r.element)
    );
    expect(
      wrongGuard,
      `These /admin routes use the tenant <ProtectedRoute> instead of <ProtectedAdminRoute>:\n${wrongGuard
        .map((r) => `  - ${r.path}`)
        .join("\n")}`
    ).toEqual([]);
  });
});