import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

export const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English", dir: "ltr", flag: "🇺🇸" },
  { code: "ar", name: "العربية", dir: "rtl", flag: "🇸🇦" },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];

const LANGUAGE_STORAGE_KEY = "matbex-language";

// Map regions to default languages
export const REGION_LANGUAGE_MAP: Record<string, LanguageCode> = {
  SA: "ar",
  AE: "ar",
  US: "en",
  GB: "en",
  EU: "en",
};

// Lazy-load locale JSON so the 150+ KiB of translations are not
// inlined into the entry bundle. Each locale ships as its own chunk
// and is fetched only when its language activates.
const loadLocale = async (lng: string) => {
  if (i18n.hasResourceBundle(lng, "translation")) return;
  const mod =
    lng === "ar"
      ? await import("./locales/ar.json")
      : await import("./locales/en.json");
  i18n.addResourceBundle(lng, "translation", (mod as any).default ?? mod, true, true);
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {},
    fallbackLng: "en",
    supportedLngs: ["en", "ar"],
    partialBundledLanguages: true,
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ["localStorage"],
    },
    interpolation: {
      escapeValue: false,
    },
  });

// Fetch the active language's bundle on init, and any future switches.
void loadLocale(i18n.language || "en").then(() => {
  // Re-render consumers once translations are available.
  i18n.changeLanguage(i18n.language);
});
i18n.on("languageChanged", (lng) => {
  void loadLocale(lng);
});

i18n.on("languageChanged", (lng) => {
  const language = SUPPORTED_LANGUAGES.find((l) => l.code === lng);
  if (language) {
    document.documentElement.dir = language.dir;
    document.documentElement.lang = lng;
  }
});

// Set initial direction
const initialLang = SUPPORTED_LANGUAGES.find((l) => l.code === i18n.language);
if (initialLang) {
  document.documentElement.dir = initialLang.dir;
  document.documentElement.lang = i18n.language;
}

export { LANGUAGE_STORAGE_KEY };
export default i18n;
