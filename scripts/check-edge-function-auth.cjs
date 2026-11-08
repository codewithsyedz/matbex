#!/usr/bin/env node
/**
 * CI guard: every server function listed as "public" (no JWT required) MUST either
 * (a) call requireUser() / db.auth.getClaims() in code, or
 * (b) be explicitly allowlisted as a public endpoint (webhooks, OAuth
 *     callbacks, public OTP issuers, etc).
 *
 * One forgotten auth check on a verify_jwt = false function = open endpoint.
 * Reads server/functions/functions.config.json as the source of truth for
 * which functions skip JWT verification, then scans each function's index.ts.
 *
 * Allowlist lives at scripts/.edge-auth-allowlist.json - keep it short and
 * justify every entry with a "reason" field.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONFIG = path.join(ROOT, "server", "functions", "functions.config.json");
const FUNCTIONS_DIR = path.join(ROOT, "server", "functions");
const ALLOWLIST_PATH = path.join(__dirname, ".edge-auth-allowlist.json");

const AUTH_PATTERNS = [
  /requireUser\s*\(/,
  /getClaims\s*\(/,
  /verifyWebhookSignature/i, // webhook-style auth
  /validateCustomerJwt/i,
  /guardCronCaller\s*\(/, // cron secret or SuperAdmin JWT guard
  /requireSuperAdminOrCron\s*\(/,
  /requireSuperAdmin\s*\(/,
];

function parsePublicFunctions(json) {
  const cfg = JSON.parse(json);
  return new Set(Array.isArray(cfg.public) ? cfg.public : []);
}

function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(ALLOWLIST_PATH, "utf8"));
  } catch (e) {
    console.error(`Could not parse ${ALLOWLIST_PATH}:`, e.message);
    process.exit(2);
  }
}

/**
 * Each allowlist entry should be { reason, added_at: "YYYY-MM-DD" }. Entries
 * older than this many days print a (non-failing) nag so reviewers re-justify
 * each public endpoint at least twice a year. Missing `added_at` is treated
 * as "needs justification" so the legacy entries get touched on next edit.
 */
const STALE_AFTER_DAYS = 180;

function listStaleEntries(allow) {
  const now = Date.now();
  const stale = [];
  for (const [name, meta] of Object.entries(allow)) {
    if (name.startsWith("_")) continue; // skip _doc and similar metadata keys
    if (!meta || typeof meta !== "object") continue;
    const addedAt = meta.added_at;
    if (!addedAt) {
      stale.push({ name, age: null });
      continue;
    }
    const ts = Date.parse(addedAt);
    if (Number.isNaN(ts)) {
      stale.push({ name, age: null });
      continue;
    }
    const ageDays = Math.floor((now - ts) / (1000 * 60 * 60 * 24));
    if (ageDays > STALE_AFTER_DAYS) stale.push({ name, age: ageDays });
  }
  return stale;
}

function scanFunction(name) {
  const dir = path.join(FUNCTIONS_DIR, name);
  if (!fs.existsSync(dir)) return { found: false, hasAuth: false };
  // Look at index.ts first, but fall back to any *.ts file in the folder.
  const candidates = [path.join(dir, "index.ts")];
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith(".ts") && f !== "index.ts") candidates.push(path.join(dir, f));
  }
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, "utf8");
    if (AUTH_PATTERNS.some((re) => re.test(src))) {
      return { found: true, hasAuth: true };
    }
  }
  return { found: true, hasAuth: false };
}

function main() {
  if (!fs.existsSync(CONFIG)) {
    console.error(`functions.config.json not found at ${CONFIG}`);
    process.exit(2);
  }
  const skipJwt = parsePublicFunctions(fs.readFileSync(CONFIG, "utf8"));
  const allow = loadAllowlist();

  const violations = [];
  for (const name of skipJwt) {
    if (allow[name]) continue; // explicitly public - documented in allowlist
    const { found, hasAuth } = scanFunction(name);
    if (!found) {
      violations.push(`  ✗ ${name} - declared in functions.config.json but folder missing`);
      continue;
    }
    if (!hasAuth) {
      violations.push(
        `  ✗ ${name} - verify_jwt = false and no requireUser/getClaims/webhook-sig found`,
      );
    }
  }

  if (violations.length > 0) {
    console.error("Edge function auth check failed:");
    console.error(violations.join("\n"));
    console.error(
      `\nFix: import { requireUser } from "../_shared/auth.ts" and call it,` +
        ` or add the function to scripts/.edge-auth-allowlist.json with a reason.`,
    );
    process.exit(1);
  }

  console.log(
    `Edge function auth check passed (${skipJwt.size} verify_jwt=false functions, ` +
      `${Object.keys(allow).length} allowlisted as public).`,
  );

  const stale = listStaleEntries(allow);
  if (stale.length > 0) {
    console.log(
      `ℹ ${stale.length} allowlist entr${stale.length === 1 ? "y is" : "ies are"} older than ${STALE_AFTER_DAYS} days — re-justify or remove:`,
    );
    for (const { name, age } of stale) {
      console.log(`    - ${name}${age == null ? " (no added_at)" : ` (${age}d)`}`);
    }
  }
}

main();