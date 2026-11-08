import React, { useEffect } from "react";
import { LanguageContext, useLanguageProvider } from "@/hooks/useLanguage";
import { useRegion } from "@/hooks/useRegion";

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const languageValue = useLanguageProvider();

  return (
    <LanguageContext.Provider value={languageValue}>
      {children}
    </LanguageContext.Provider>
  );
}

// Combined provider that syncs language with region
export function LanguageRegionProvider({ children }: { children: React.ReactNode }) {
  const languageValue = useLanguageProvider();
  const { region } = useRegion();

  // Sync language with region on initial load
  useEffect(() => {
    languageValue.syncWithRegion(region.code);
  }, [region.code]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <LanguageContext.Provider value={languageValue}>
      {children}
    </LanguageContext.Provider>
  );
}
