#!/usr/bin/env node
/**
 * Gap #9 — Automated heading-hierarchy lint.
 *
 * Scans every `.tsx` / `.jsx` file under `src/` and flags any forward jump
 * of more than one heading level (e.g. <h1> → <h3>, <h2> → <h5>) within
 * the same file. Going back to a higher level (h3 → h2) is fine.
 *
 * Usage:
 *   node scripts/check-heading-hierarchy.cjs            # lint
 *   node scripts/check-heading-hierarchy.cjs --json     # machine readable
 *
 * Exit code is non-zero when violations are found, so this is wireable
 * into CI / pre-commit hooks (`npm run lint:headings`).
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "src");
const HEADING_RE = /<h([1-6])\b/gi;
const SKIP_DIRS = new Set(["node_modules", "__tests__", "test", "tests"]);
const ALLOWLIST_PATH = path.join(__dirname, ".heading-lint-allowlist.json");

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(t|j)sx$/.test(entry.name)) out.push(full);
  }
  return out;
}

function lineFor(src, index) {
  return src.slice(0, index).split("\n").length;
}

function check(file) {
  const src = fs.readFileSync(file, "utf8");
  const headings = [];
  let m;
  while ((m = HEADING_RE.exec(src))) {
    headings.push({ level: Number(m[1]), line: lineFor(src, m.index) });
  }
  if (headings.length === 0) return [];

  const violations = [];
  let prev = null;
  for (const h of headings) {
    if (prev !== null && h.level > prev && h.level - prev > 1) {
      violations.push({
        file: path.relative(path.join(__dirname, ".."), file),
        line: h.line,
        message: `Heading skip: <h${prev}> → <h${h.level}> (jump of ${h.level - prev})`,
      });
    }
    prev = h.level;
  }
  return violations;
}

const files = walk(ROOT);
const allViolations = files.flatMap(check);

let allowlist = [];
try {
  allowlist = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, "utf8"));
} catch {
  allowlist = [];
}
const allowKey = (v) => `${v.file}:${v.message}`;
const allowed = new Set(allowlist.map(allowKey));
const newViolations = allViolations.filter((v) => !allowed.has(allowKey(v)));
const staleAllowlist = allowlist.filter(
  (a) => !allViolations.some((v) => allowKey(v) === allowKey(a)),
);

const json = process.argv.includes("--json");
if (json) {
  process.stdout.write(JSON.stringify(allViolations, null, 2) + "\n");
} else if (newViolations.length === 0) {
  console.log(
    `✓ Heading hierarchy clean across ${files.length} files (${allowlist.length} known issue${allowlist.length === 1 ? "" : "s"} in allowlist).`,
  );
  if (staleAllowlist.length > 0) {
    console.log(
      `ℹ ${staleAllowlist.length} allowlist entr${staleAllowlist.length === 1 ? "y is" : "ies are"} stale — fixed, please remove from scripts/.heading-lint-allowlist.json.`,
    );
  }
} else {
  console.error(`✗ NEW heading hierarchy violations (${newViolations.length}):\n`);
  for (const v of newViolations) {
    console.error(`  ${v.file}:${v.line}  ${v.message}`);
  }
  console.error(
    "\nFix: insert the missing intermediate level, or restructure so headings step one level at a time."
  );
}

process.exit(newViolations.length === 0 ? 0 : 1);