import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "supabase", "functions");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) return walk(p);
    return p.endsWith(".ts") ? [p] : [];
  });
}

/**
 * Regression guard: `corsHeaders` is built per-request inside the handler.
 * A module-level helper (e.g. `function json(...)`) that spreads `corsHeaders`
 * throws `ReferenceError: corsHeaders is not defined` at runtime, which silently
 * breaks POS sync responses. Helpers must receive the headers as a parameter.
 */
describe("edge functions: corsHeaders scope", () => {
  const files = walk(ROOT);

  it("has edge function files to scan", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    if (!src.includes("corsHeaders")) continue;
    // Files that declare corsHeaders at module scope are safe by construction.
    if (/^(const|let)\s+corsHeaders/m.test(src)) continue;

    it(`${file.replace(ROOT, "")} does not reference corsHeaders from a module-level helper`, () => {
      const lines = src.split("\n");
      const offenders: string[] = [];
      let inTopLevelFn = false;
      let declaresLocally = false;

      lines.forEach((line, i) => {
        if (/^(export\s+)?(async\s+)?function\s+\w+/.test(line)) {
          inTopLevelFn = true;
          declaresLocally = false;
        } else if (/^}/.test(line)) {
          inTopLevelFn = false;
        }
        if (inTopLevelFn && /\bcorsHeaders\s*[:,)=]/.test(line) && /(const|let|corsHeaders\s*:)/.test(line)) {
          declaresLocally = true;
        }
        if (inTopLevelFn && !declaresLocally && /\.\.\.corsHeaders|\bcorsHeaders\b/.test(line) && !/corsHeaders\s*:/.test(line)) {
          offenders.push(`${i + 1}: ${line.trim()}`);
        }
      });

      expect(offenders, `corsHeaders used out of scope:\n${offenders.join("\n")}`).toEqual([]);
    });
  }
});
