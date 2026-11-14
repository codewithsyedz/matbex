/**
 * Terminal API request/response CONTRACT test.
 *
 * The Android/native POS terminals are versioned independently of this backend.
 * Ledger posting logic (post_daily_sales_to_ledger, VAT restatement, AP
 * settlement, etc.) is changed frequently — none of those changes may alter the
 * wire contract the terminals depend on.
 *
 * This test pins the contract at the source level: routes, auth headers,
 * response envelope, per-endpoint payload keys and error codes. Any deliberate
 * contract change must bump API_VERSION and update the frozen snapshot below,
 * which forces a conscious "terminals need an update" decision.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = fs.readFileSync(
  path.resolve(process.cwd(), "server/functions/terminal-api/index.ts"),
  "utf8",
);

/** Frozen wire contract — DO NOT relax to make a test pass. */
const CONTRACT = {
  apiVersion: "1",
  authHeaders: ["x-terminal-key", "authorization"],
  optionalHeaders: ["idempotency-key", "x-request-id"],
  responseHeaders: ["X-Request-Id"],
  routes: [
    { method: "POST", path: "/pair", public: true },
    { method: "GET", path: "/menu" },
    { method: "GET", path: "/menu/version" },
    { method: "GET", path: "/customers" },
    { method: "GET", path: "/shifts/current" },
    { method: "POST", path: "/shifts/open" },
    { method: "POST", path: "/shifts/close" },
    { method: "POST", path: "/shifts/cash-event" },
    { method: "POST", path: "/sales" },
    { method: "POST", path: "/sales/:id/void" },
    { method: "GET", path: "/sales/today" },
    { method: "POST", path: "/settlements" },
    { method: "GET", path: "/health" },
  ],
  payloadKeys: {
    "/pair": ["terminal_id", "restaurant_id", "name", "branch_label", "device_key"],
    "/menu": [
      "items",
      "branch_id",
      "branch_name",
      "branch_source",
      "menu_version",
      "effective_date",
      "vat_rate",
      "prices_vat_inclusive",
    ],
    "/menu/version": ["menu_version", "effective_date", "branch_id"],
    "/customers": ["customers"],
    "/shifts/current": ["shift"],
    "/shifts/cash-event": ["cash_event"],
    "/sales": [
      "sale",
      "receipt_number",
      "branch_id",
      "branch_name",
      "branch_source",
      "vat_rate",
      "prices_vat_inclusive",
      "totals",
    ],
    "/sales/:id/void": ["sale", "reason"],
    "/sales/today": ["sales"],
    "/settlements": ["settlement"],
    "/health": ["ok", "terminal_id", "restaurant_id", "server_time"],
  } as Record<string, string[]>,
  errorCodes: [
    "no_terminal_key",
    "no_cashier_token",
    "invalid_terminal_key",
    "terminal_revoked",
    "invalid_cashier_token",
    "cashier_not_in_tenant",
    "terminal_lookup_failed",
    "not_found",
    "server_error",
  ],
} as const;

function routeLine(method: string, p: string): RegExp {
  if (p === "/sales/:id/void") {
    return /saleVoidMatch\s*&&\s*req\.method\s*===\s*"POST"/;
  }
  return new RegExp(
    `path\\s*===\\s*"${p.replace(/\//g, "\\/")}"\\s*&&\\s*req\\.method\\s*===\\s*"${method}"`,
  );
}

describe("Terminal API wire contract", () => {
  it("pins API_VERSION — bumping it means terminals must be updated", () => {
    expect(SRC).toContain(`const API_VERSION = "${CONTRACT.apiVersion}"`);
  });

  it("keeps the success envelope { api_version, data }", () => {
    expect(SRC).toMatch(/JSON\.stringify\(\{\s*api_version:\s*API_VERSION,\s*data\s*\}\)/);
  });

  it("keeps the error envelope { api_version, error: { code, message } }", () => {
    expect(SRC).toMatch(
      /api_version:\s*API_VERSION,\s*error:\s*\{\s*code,\s*message\s*\}/,
    );
  });

  it("keeps the version-conflict error envelope fields", () => {
    for (const key of ["server_version", "server_checksum", "client_version"]) {
      expect(SRC, `versionErr must expose ${key}`).toContain(`${key}:`);
    }
  });

  it.each(CONTRACT.routes)("still routes $method $path", (route) => {
    expect(SRC).toMatch(routeLine(route.method, route.path));
  });

  it("exposes no routes beyond the frozen list", () => {
    const found = [...SRC.matchAll(/path\s*===\s*"(\/[^"]*)"\s*&&\s*req\.method\s*===\s*"(GET|POST|PUT|PATCH|DELETE)"/g)]
      .map((m) => `${m[2]} ${m[1]}`)
      .sort();
    const expected = CONTRACT.routes
      .filter((r) => r.path !== "/sales/:id/void")
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    expect(found).toEqual(expected);
  });

  it("keeps /pair as the only unauthenticated route", () => {
    const routerIdx = SRC.search(/^serve\(/m);
    const router = SRC.slice(routerIdx);
    const pairIdx = router.indexOf('path === "/pair"');
    const authIdx = router.indexOf("const auth = await authenticate(req)");
    expect(pairIdx).toBeGreaterThan(-1);
    expect(authIdx).toBeGreaterThan(pairIdx);
  });

  it("requires the terminal key and cashier bearer token on every other route", () => {
    for (const h of CONTRACT.authHeaders) {
      expect(SRC).toContain(`req.headers.get("${h}")`);
    }
    expect(SRC).toContain('auth?.startsWith("Bearer ")');
  });

  it("honours idempotency replay and echoes X-Request-Id", () => {
    for (const h of CONTRACT.optionalHeaders) {
      expect(SRC).toContain(`req.headers.get("${h}")`);
    }
    expect(SRC).toMatch(/replayed:\s*true/);
    for (const h of CONTRACT.responseHeaders) {
      expect(SRC).toContain(`"${h}"`);
    }
  });

  it.each(Object.entries(CONTRACT.payloadKeys))(
    "%s response still contains every documented field",
    (route, keys) => {
      for (const key of keys as string[]) {
        expect(SRC, `${route} must return "${key}"`).toMatch(
          new RegExp(`\\b${key}\\s*[:,}]`),
        );
      }
    },
  );

  it("keeps the sale totals breakdown { net, vat, gross }", () => {
    expect(SRC).toMatch(/totals:\s*\{\s*net,\s*vat:\s*tax,\s*gross:\s*total\s*\}/);
  });

  it.each(CONTRACT.errorCodes)("keeps stable error code %s", (code) => {
    expect(SRC).toContain(`"${code}"`);
  });

  it("keeps CORS headers module-scoped (request-scoped const previously 500'd)", () => {
    expect(SRC).toMatch(/^let corsHeaders/m);
    expect(SRC).not.toMatch(/^\s+const corsHeaders\s*=/m);
    expect(SRC).toMatch(/corsHeaders = buildCorsHeaders\(req\)/);
  });

  it("does not leak ledger-posting internals into terminal responses", () => {
    // Terminals must never depend on GL details; posting happens server-side.
    const forbidden = [
      "journal_entries",
      "journal_batches",
      "post_daily_sales_to_ledger",
      "account_code",
      "journal_line",
      "gl_account",
      // "credit" alone is legitimate here (customer credit limits), so match
      // only accounting-style debit/credit leg fields.
      "debit_account",
      "credit_account",
    ];
    for (const token of forbidden) {
      expect(SRC, `terminal-api must stay ledger-agnostic (found "${token}")`)
        .not.toContain(token);
    }
  });
});
