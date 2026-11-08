import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { auditPageLayout, CANONICAL } from "@/lib/pageLayoutContract";

const ROOT = process.cwd();
const PAGES = join(ROOT, "src/pages");
const baseline = JSON.parse(
  readFileSync(join(ROOT, "scripts/.page-layout-baseline.json"), "utf8"),
) as { exempt: Record<string, string[]> };

const pageFiles = (): string[] => {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".tsx")) out.push(relative(ROOT, p));
    }
  };
  walk(PAGES);
  return out.sort();
};

const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

describe("VAT Return spacing contract (visual regression guard)", () => {
  it("the reference page still defines the canonical spacing tokens", () => {
    const sales = read("src/pages/Sales.tsx");
    expect(sales).toContain(
      `container mx-auto ${CANONICAL.containerWidth} ${CANONICAL.containerVertical.join(" ")} ${CANONICAL.containerRhythm.join(" ")}`,
    );
    expect(read("src/pages/VatReturn.tsx")).toContain(CANONICAL.h1.join(" "));
  });

  it("no aligned page drifts from the container / header / card spacing rules", () => {
    const drifted: string[] = [];
    for (const file of pageFiles()) {
      if (baseline.exempt[file]) continue;
      const violations = auditPageLayout(read(file));
      if (violations.length) {
        drifted.push(`${file}: ${violations.map((v) => `[${v.rule}] ${v.detail}`).join("; ")}`);
      }
    }
    expect(drifted, `Spacing drift from the VAT Return layout:\n${drifted.join("\n")}`).toEqual([]);
  });

  it("exempt pages only carry their recorded violations (list must shrink, never grow)", () => {
    const regressions: string[] = [];
    const fixed: string[] = [];
    for (const [file, allowed] of Object.entries(baseline.exempt)) {
      let source: string;
      try {
        source = read(file);
      } catch {
        continue; // page deleted/renamed
      }
      const rules = [...new Set(auditPageLayout(source).map((v) => v.rule))];
      const extra = rules.filter((r) => !allowed.includes(r));
      if (extra.length) regressions.push(`${file}: new violations ${extra.join(", ")}`);
      if (rules.length === 0) fixed.push(file);
    }
    expect(regressions, `New spacing violations on exempt pages:\n${regressions.join("\n")}`).toEqual([]);
    expect(
      fixed,
      `These pages now match the VAT Return layout — remove them from scripts/.page-layout-baseline.json:\n${fixed.join("\n")}`,
    ).toEqual([]);
  });
});
