/**
 * Helpers to overlay locale-specific overrides stored in
 * `cms_pages.translations` / `cms_page_blocks.translations` on top of
 * the canonical English `config` / page fields.
 *
 * Shape: `{ "ar": { ...partial overrides... } }`
 *
 * For arrays (e.g. `items`, `tiers`, `faqs`) the overlay is
 * positional: index 0 in the override array overrides index 0 in the
 * source array. Missing indices fall back to the English value.
 */

type Json = any;

function isPlainObject(v: unknown): v is Record<string, Json> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Deep-merge `override` onto `base`. Override values win when present.
 * Arrays are merged positionally; objects are merged recursively;
 * scalars are replaced wholesale. `null`/`undefined` in the override
 * fall back to the base value (so partial translations don't blank
 * out fields).
 */
export function mergeLocaleOverride<T extends Json>(base: T, override: Json): T {
  if (override == null) return base;
  if (Array.isArray(base) && Array.isArray(override)) {
    const merged = base.map((item, i) =>
      i < override.length ? mergeLocaleOverride(item, override[i]) : item,
    );
    return merged as unknown as T;
  }
  if (isPlainObject(base) && isPlainObject(override)) {
    const out: Record<string, Json> = { ...(base as Record<string, Json>) };
    for (const [k, v] of Object.entries(override)) {
      if (v === undefined || v === null || v === "") continue;
      out[k] = mergeLocaleOverride((base as Record<string, Json>)[k], v);
    }
    return out as unknown as T;
  }
  // Scalar / type-mismatch: take the override (already known non-null).
  return override as T;
}

export function pickLocaleConfig<T extends Json>(
  config: T,
  translations: Record<string, Json> | null | undefined,
  locale: string,
): T {
  if (!translations) return config;
  const key = (locale || "").toLowerCase().split("-")[0];
  const override = translations[key];
  if (!override) return config;
  return mergeLocaleOverride(config, override);
}