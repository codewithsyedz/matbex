/**
 * Static scanner for Radix dialog-family components.
 *
 * Given a map of source-file paths to raw source text (typically produced by
 * Vite's `import.meta.glob(..., { query: '?raw', eager: true })`), it returns
 * one row per `<DialogContent>`, `<AlertDialogContent>`, `<SheetContent>`, or
 * `<DrawerContent>` usage, flagging whether the call site passes a custom
 * `description=` prop or relies on the generic sr-only fallback injected by
 * our UI primitives.
 *
 * The scanner intentionally skips:
 *  - the primitive wrappers themselves (`src/components/ui/*.tsx`), which
 *    *define* these components rather than consume them
 *  - test files and this scanner itself
 */

export type DialogKind = "dialog" | "alert-dialog" | "sheet" | "drawer";

export interface DialogDescriptionRow {
  file: string;
  line: number;
  kind: DialogKind;
  hasCustomDescription: boolean;
  /** Trimmed snippet of the description prop value, when available. */
  descriptionPreview: string | null;
}

const TAG_TO_KIND: Record<string, DialogKind> = {
  DialogContent: "dialog",
  AlertDialogContent: "alert-dialog",
  SheetContent: "sheet",
  DrawerContent: "drawer",
};

const TAG_PATTERN = /<(DialogContent|AlertDialogContent|SheetContent|DrawerContent)\b/g;

function shouldSkipFile(path: string): boolean {
  if (path.includes("/__tests__/") || path.endsWith(".test.ts") || path.endsWith(".test.tsx")) {
    return true;
  }
  if (path.includes("/lib/a11y/scanDialogDescriptions")) return true;
  // Skip the primitive definitions themselves - they declare these components.
  if (/\/components\/ui\/(dialog|alert-dialog|sheet|drawer)\.tsx$/.test(path)) {
    return true;
  }
  return false;
}

/**
 * Returns the full JSX opening-tag text starting at `start` (the `<` index),
 * by walking forward and tracking JSX-expression brace depth so that a `>`
 * inside an embedded expression does not end the tag prematurely.
 * Returns null if no terminator is found within a reasonable window.
 */
function extractOpeningTag(source: string, start: number): string | null {
  const MAX = 4000;
  const end = Math.min(source.length, start + MAX);
  let depth = 0;
  for (let i = start; i < end; i++) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    else if (depth === 0 && ch === ">") {
      return source.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Extracts the literal/expression text for the first top-level `description=`
 * prop in an opening tag, or null if none is present.
 */
function extractDescriptionValue(openingTag: string): string | null {
  // Match `description=` only when it is a JSX attribute (preceded by whitespace
  // or the opening `<Tag`), not inside another identifier.
  const attrMatch = /\sdescription\s*=\s*/.exec(openingTag);
  if (!attrMatch) return null;
  const valueStart = attrMatch.index + attrMatch[0].length;
  const first = openingTag[valueStart];

  if (first === '"' || first === "'") {
    const end = openingTag.indexOf(first, valueStart + 1);
    if (end === -1) return null;
    return openingTag.slice(valueStart + 1, end);
  }

  if (first === "{") {
    let depth = 0;
    for (let i = valueStart; i < openingTag.length; i++) {
      const ch = openingTag[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          return openingTag.slice(valueStart + 1, i).trim();
        }
      }
    }
  }

  return null;
}

function previewOf(value: string | null): string | null {
  if (value == null) return null;
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return null;
  return collapsed.length > 160 ? `${collapsed.slice(0, 157)}…` : collapsed;
}

function relativePath(path: string): string {
  const idx = path.indexOf("/src/");
  return idx === -1 ? path : path.slice(idx + 1);
}

export function scanDialogDescriptions(
  sources: Record<string, string>,
): DialogDescriptionRow[] {
  const rows: DialogDescriptionRow[] = [];

  for (const [rawPath, source] of Object.entries(sources)) {
    if (shouldSkipFile(rawPath)) continue;
    if (typeof source !== "string" || source.length === 0) continue;
    if (!/(DialogContent|AlertDialogContent|SheetContent|DrawerContent)\b/.test(source)) {
      continue;
    }

    const file = relativePath(rawPath);
    TAG_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TAG_PATTERN.exec(source)) !== null) {
      const tagName = match[1];
      const kind = TAG_TO_KIND[tagName];
      if (!kind) continue;

      const tagStart = match.index;
      const opening = extractOpeningTag(source, tagStart);
      if (!opening) continue;

      const value = extractDescriptionValue(opening);
      const line = source.slice(0, tagStart).split("\n").length;

      rows.push({
        file,
        line,
        kind,
        hasCustomDescription: value !== null,
        descriptionPreview: previewOf(value),
      });
    }
  }

  rows.sort((a, b) => {
    if (a.hasCustomDescription !== b.hasCustomDescription) {
      return a.hasCustomDescription ? 1 : -1; // fallbacks first
    }
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.line - b.line;
  });

  return rows;
}