/**
 * The cutover copies production over the tables migrations already updated, so a migration that
 * changes existing rows must also be repeated in db/post-copy-repairs.sql (or say why not there).
 * Without this check the change would silently disappear on cutover day.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const DIR = join(ROOT, "db/migrations");
/** Migrations before this are already on production. */
const FIRST_NEW = "20260828";
const repairs = readFileSync(join(ROOT, "db/post-copy-repairs.sql"), "utf8");

const DATA_CHANGE = new RegExp(
  [
    String.raw`\bUPDATE\s+(?:ONLY\s+)?[\w.]+(?:\s+(?!SET\b)\w+)?\s+SET\b`,
    String.raw`\bINSERT\s+INTO\s+(?!_)[\w.]+`,
    String.raw`\bDELETE\s+FROM\s+(?!_)[\w.]+`,
    String.raw`\b(?:SELECT|PERFORM)\s+public\.\w+\(`,
  ].join("|"),
  "i",
);

/** The SQL that runs when the migration is applied, without comments or function bodies. */
function topLevel(sql: string) {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)[\s\S]*?\$(\w*)\$[\s\S]*?\$\1\$/gi, "");
}

const changing = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql") && f >= FIRST_NEW)
  .sort()
  .filter((f) => DATA_CHANGE.test(topLevel(readFileSync(join(DIR, f), "utf8"))));
const listed = (kind: string) => [...repairs.matchAll(new RegExp(`^-- ${kind}: (\\S+)`, "gm"))].map((m) => m[1]);

describe("post-copy repairs", () => {
  it("cover every new migration that changes existing data", () => {
    const known = new Set([...listed("repairs"), ...listed("no-repair")]);
    expect(changing.filter((f) => !known.has(f))).toEqual([]);
  });

  it("name only migrations that exist, in migration order", () => {
    const files = new Set(readdirSync(DIR));
    expect([...listed("repairs"), ...listed("no-repair")].filter((f) => !files.has(f))).toEqual([]);
    const order = listed("repairs");
    expect(order).toEqual([...order].sort());
  });
});
