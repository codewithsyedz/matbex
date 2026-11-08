import { useCallback } from "react";
import { useTranslation } from "react-i18next";

/**
 * Overlay Arabic on top of English CMS content without DB changes.
 *
 * - When the active language is Arabic, returns the i18n translation for `key`.
 *   Falls back to `fallback` if the key is missing.
 * - When the active language is English, returns `fallback` (typically the
 *   CMS-driven English string), and falls back to the translation if no
 *   fallback was supplied.
 *
 * Example:
 *   const tt = useLocaleText();
 *   <h1>{tt("landing.hero.headline", hero?.headline)}</h1>
 */
export function useLocaleText() {
  const { t, i18n } = useTranslation();
  const isAr = (i18n.language || "").toLowerCase().startsWith("ar");

  return useCallback(
    (key: string, fallback?: string | null) => {
      if (isAr) {
        const translated = t(key);
        // i18next returns the key itself when no translation exists.
        if (translated && translated !== key) return translated;
        return fallback ?? "";
      }
      if (fallback != null && fallback !== "") return fallback;
      const translated = t(key);
      return translated === key ? (fallback ?? "") : translated;
    },
    [isAr, t],
  );
}

export function useIsArabic() {
  const { i18n } = useTranslation();
  return (i18n.language || "").toLowerCase().startsWith("ar");
}
