import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guard test: every Radix-style *Content component in src/components/ui that
 * wraps a `*Primitive.Content` MUST render a sibling `*Primitive.Description`
 * (visible or sr-only) so Radix never logs the
 *   "Missing Description for {DialogContent}" accessibility warning at runtime.
 *
 * The test scans the ui directory as text - no React render needed.
 */

const UI_DIR = resolve(__dirname, "../ui");

// Files that intentionally don't expose a *Content wrapper of their own.
const EXEMPT_FILES = new Set<string>([]);

// Only Radix Dialog-family primitives + vaul require a Description for a11y.
// Other primitives (Popover, Tooltip, DropdownMenu, HoverCard, …) do not.
const DIALOG_LIKE_PREFIXES = [
  "DialogPrimitive",
  "AlertDialogPrimitive",
  "SheetPrimitive",
  "DrawerPrimitive",
];

function findContentWrappers(source: string) {
  return DIALOG_LIKE_PREFIXES.filter((p) =>
    new RegExp(`${p}\\.Content\\b`).test(source),
  );
}

describe("dialog Description guard", () => {
  const files = readdirSync(UI_DIR).filter((f) => f.endsWith(".tsx"));

  for (const file of files) {
    if (EXEMPT_FILES.has(file)) continue;
    const fullPath = resolve(UI_DIR, file);
    const source = readFileSync(fullPath, "utf8");
    const prefixes = findContentWrappers(source);
    if (prefixes.length === 0) continue;

    for (const prefix of prefixes) {
      it(`${file} renders ${prefix}.Description alongside ${prefix}.Content`, () => {
        const hasDescription = new RegExp(
          `${prefix}\\.Description\\b`,
        ).test(source);
        expect(
          hasDescription,
          `Expected ${file} to render <${prefix}.Description> inside its ${prefix}.Content wrapper ` +
            `(use the sr-only fallback pattern from DialogContent). ` +
            `Without it, Radix logs "Missing Description for {DialogContent}" at runtime.`,
        ).toBe(true);
      });
    }
  }

  it("scanned at least one Radix-style Content wrapper (sanity)", () => {
    const anyHit = files.some((f) =>
      findContentWrappers(readFileSync(resolve(UI_DIR, f), "utf8")).length > 0,
    );
    expect(anyHit).toBe(true);
  });
});