/**
 * Re-records scripts/.page-layout-baseline.json from the current pages. Run deliberately,
 * e.g. after changing CANONICAL in src/lib/pageLayoutContract.ts:
 *   UPDATE_LAYOUT_BASELINE=1 npx vitest run src/lib/__tests__/updatePageLayoutBaseline.test.ts
 * Without the variable it does nothing (so the normal test run never rewrites it).
 */
import { it } from "vitest";
import { readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { join, relative } from "path";
import { auditPageLayout } from "@/lib/pageLayoutContract";

it.skipIf(!process.env.UPDATE_LAYOUT_BASELINE)("re-record page layout baseline", () => {
  const ROOT = process.cwd();
  const file = join(ROOT, "scripts/.page-layout-baseline.json");
  const baseline = JSON.parse(readFileSync(file, "utf8"));
  const pages: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".tsx")) pages.push(relative(ROOT, p));
    }
  };
  walk(join(ROOT, "src/pages"));
  const exempt: Record<string, string[]> = {};
  for (const p of pages.sort()) {
    const rules = [...new Set(auditPageLayout(readFileSync(join(ROOT, p), "utf8")).map((v) => v.rule))].sort();
    if (rules.length) exempt[p] = rules;
  }
  writeFileSync(file, JSON.stringify({ ...baseline, exempt }, null, 2) + "\n");
  console.log(`${Object.keys(exempt).length} pages with recorded violations`);
});
