import { useState, useEffect, useCallback, createContext, useContext } from "react";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES, REGION_LANGUAGE_MAP, LanguageCode, LANGUAGE_STORAGE_KEY } from "@/i18n/config";

interface LanguageContextValue {
  language: LanguageCode;
  setLanguage: (code: LanguageCode) => void;
  dir: "ltr" | "rtl";
  isRTL: boolean;
  syncWithRegion: (regionCode: string) => void;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within LanguageProvider");
  }
  return context;
}

export function useLanguageProvider() {
  const { i18n } = useTranslation();
  const [language, setLanguageState] = useState<LanguageCode>(
    (i18n.language?.split("-")[0] as LanguageCode) || "en"
  );

  const dir = SUPPORTED_LANGUAGES.find((l) => l.code === language)?.dir || "ltr";
  const isRTL = dir === "rtl";

  useEffect(() => {
    // Sync state with i18n
    const currentLang = i18n.language?.split("-")[0] as LanguageCode;
    if (currentLang && currentLang !== language) {
      setLanguageState(currentLang);
    }
  }, [i18n.language, language]);

  const setLanguage = useCallback(
    (code: LanguageCode) => {
      i18n.changeLanguage(code);
      setLanguageState(code);
      localStorage.setItem(LANGUAGE_STORAGE_KEY, code);
    },
    [i18n]
  );

  const syncWithRegion = useCallback(
    (regionCode: string) => {
      // Only sync if user hasn't manually set a language
      const storedLang = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (!storedLang) {
        const suggestedLang = REGION_LANGUAGE_MAP[regionCode] || "en";
        setLanguage(suggestedLang);
      }
    },
    [setLanguage]
  );

  return {
    language,
    setLanguage,
    dir,
    isRTL,
    syncWithRegion,
  };
}

export { LanguageContext, SUPPORTED_LANGUAGES };
