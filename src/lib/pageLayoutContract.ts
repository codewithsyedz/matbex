/**
 * Page layout contract — canonical spacing/margin rules derived from the
 * VAT Return page (src/pages/VatReturn.tsx), which is the reference layout.
 *
 * These rules are enforced by
 * src/lib/__tests__/pageLayoutSpacing.regression.test.ts so that spacing or
 * margin drift is caught automatically instead of visually.
 */

export const CANONICAL = {
  /** Root page wrapper of an authenticated (in-shell) page. */
  // Updated 2026-11-11 to the layout the app actually uses (97 pages): the previous
  // max-w-6xl / py-4 / font-light tokens described a design the app had moved away from.
  containerWidth: "max-w-7xl",
  containerVertical: ["py-5", "md:py-7"],
  containerRhythm: ["space-y-5", "md:space-y-6"],
  /** Page title typography. */
  h1: ["text-2xl", "md:text-3xl", "font-semibold", "tracking-tight"],
  /** Card rhythm. */
  cardHeaderPadding: "pb-3",
  cardTitleType: ["text-base", "font-medium"],
} as const;

export type LayoutRuleId =
  | "root-container"
  | "container-vertical-rhythm"
  | "h1-typography"
  | "card-header-padding"
  | "card-title-typography";

export interface LayoutViolation {
  rule: LayoutRuleId;
  detail: string;
}

const classAttrs = (tag: string, source: string): string[] => {
  const re = new RegExp(`<${tag}\\b[^>]*?>`, "gs");
  const out: string[] = [];
  for (const m of source.match(re) ?? []) {
    const cls = m.match(/className=(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/s);
    out.push(cls ? (cls[1] ?? cls[2] ?? cls[3] ?? "") : "");
  }
  return out;
};

const containerAttrs = (source: string): string[] =>
  (source.match(/["'`][^"'`]*\bcontainer\b[^"'`]*["'`]/g) ?? []).map((s) => s.slice(1, -1));

const has = (cls: string, token: string) =>
  new RegExp(`(^|[\\s"'\`])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[\\s"'\`])`).test(cls);

/** Analyse one page file and return every spacing/margin contract violation. */
export function auditPageLayout(source: string): LayoutViolation[] {
  const violations: LayoutViolation[] = [];

  const containers = containerAttrs(source).filter((c) => has(c, CANONICAL.containerWidth));
  if (containers.length === 0) {
    violations.push({
      rule: "root-container",
      detail: `no root wrapper with "container ... ${CANONICAL.containerWidth}"`,
    });
  } else {
    const ok = containers.some(
      (c) =>
        CANONICAL.containerVertical.every((t) => has(c, t)) &&
        CANONICAL.containerRhythm.every((t) => has(c, t)),
    );
    if (!ok) {
      violations.push({
        rule: "container-vertical-rhythm",
        detail: `root container must use ${[...CANONICAL.containerVertical, ...CANONICAL.containerRhythm].join(" ")} (found: ${containers.join(" | ")})`,
      });
    }
  }

  for (const cls of classAttrs("h1", source)) {
    const missing = CANONICAL.h1.filter((t) => !has(cls, t));
    if (missing.length) {
      violations.push({ rule: "h1-typography", detail: `<h1> missing ${missing.join(", ")}` });
      break;
    }
  }

  for (const cls of classAttrs("CardHeader", source)) {
    if (cls && !has(cls, CANONICAL.cardHeaderPadding) && !/pb-\d/.test(cls)) {
      violations.push({
        rule: "card-header-padding",
        detail: `<CardHeader className="${cls}"> must keep ${CANONICAL.cardHeaderPadding}`,
      });
      break;
    }
  }

  for (const cls of classAttrs("CardTitle", source)) {
    if (/\btext-(xs|sm|lg|xl|2xl|3xl)\b/.test(cls)) {
      violations.push({
        rule: "card-title-typography",
        detail: `<CardTitle className="${cls}"> overrides the canonical ${CANONICAL.cardTitleType.join(" ")}`,
      });
      break;
    }
  }

  return violations;
}
