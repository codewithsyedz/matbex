import { useState, useEffect, useCallback, createContext, useContext } from "react";

export interface RegionInfo {
  code: string;
  name: string;
  currency: string;
  currencySymbol: string;
  flag: string;
  exchangeRate: number; // Rate to convert from USD
}

export const SUPPORTED_REGIONS: RegionInfo[] = [
  { code: "SA", name: "Saudi Arabia", currency: "SAR", currencySymbol: "ريال", flag: "🇸🇦", exchangeRate: 3.75 },
  { code: "AE", name: "UAE", currency: "AED", currencySymbol: "د.إ", flag: "🇦🇪", exchangeRate: 3.67 },
  { code: "US", name: "United States", currency: "USD", currencySymbol: "$", flag: "🇺🇸", exchangeRate: 1 },
  { code: "GB", name: "United Kingdom", currency: "GBP", currencySymbol: "£", flag: "🇬🇧", exchangeRate: 0.79 },
  { code: "EU", name: "Europe", currency: "EUR", currencySymbol: "€", flag: "🇪🇺", exchangeRate: 0.92 },
];

const REGION_STORAGE_KEY = "matbex-region";

interface RegionContextValue {
  region: RegionInfo;
  setRegion: (code: string) => void;
  isDetecting: boolean;
  formatPrice: (usdPrice: number, showSymbol?: boolean) => string;
}

const RegionContext = createContext<RegionContextValue | undefined>(undefined);

export function useRegion() {
  const context = useContext(RegionContext);
  if (!context) {
    throw new Error("useRegion must be used within RegionProvider");
  }
  return context;
}

export function useRegionProvider() {
  const [region, setRegionState] = useState<RegionInfo>(
    SUPPORTED_REGIONS.find(r => r.code === "SA") || SUPPORTED_REGIONS[0]
  );
  const [isDetecting, setIsDetecting] = useState(true);

  // Detect region from browser timezone/locale or stored preference
  useEffect(() => {
    const detectRegion = async () => {
      // Check for stored preference first
      const storedRegion = localStorage.getItem(REGION_STORAGE_KEY);
      if (storedRegion) {
        const found = SUPPORTED_REGIONS.find(r => r.code === storedRegion);
        if (found) {
          setRegionState(found);
          setIsDetecting(false);
          return;
        }
      }

      try {
        // Try to detect based on timezone
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        
        // Saudi Arabia timezones
        if (timezone.includes("Riyadh") || timezone.includes("Asia/Riyadh")) {
          const sa = SUPPORTED_REGIONS.find(r => r.code === "SA")!;
          setRegionState(sa);
          localStorage.setItem(REGION_STORAGE_KEY, "SA");
          setIsDetecting(false);
          return;
        }

        // UAE timezones
        if (timezone.includes("Dubai") || timezone.includes("Asia/Dubai")) {
          const ae = SUPPORTED_REGIONS.find(r => r.code === "AE")!;
          setRegionState(ae);
          localStorage.setItem(REGION_STORAGE_KEY, "AE");
          setIsDetecting(false);
          return;
        }

        // UK timezones
        if (timezone.includes("London") || timezone.includes("Europe/London")) {
          const gb = SUPPORTED_REGIONS.find(r => r.code === "GB")!;
          setRegionState(gb);
          localStorage.setItem(REGION_STORAGE_KEY, "GB");
          setIsDetecting(false);
          return;
        }

        // European timezones
        if (timezone.includes("Europe/") && !timezone.includes("London")) {
          const eu = SUPPORTED_REGIONS.find(r => r.code === "EU")!;
          setRegionState(eu);
          localStorage.setItem(REGION_STORAGE_KEY, "EU");
          setIsDetecting(false);
          return;
        }

        // US timezones
        if (timezone.includes("America/")) {
          const us = SUPPORTED_REGIONS.find(r => r.code === "US")!;
          setRegionState(us);
          localStorage.setItem(REGION_STORAGE_KEY, "US");
          setIsDetecting(false);
          return;
        }

        // Default to Saudi Arabia as the primary market
        const sa = SUPPORTED_REGIONS.find(r => r.code === "SA")!;
        setRegionState(sa);
        localStorage.setItem(REGION_STORAGE_KEY, "SA");
      } catch (error) {
        console.error("Region detection failed:", error);
        // Default to Saudi Arabia
        const sa = SUPPORTED_REGIONS.find(r => r.code === "SA")!;
        setRegionState(sa);
      } finally {
        setIsDetecting(false);
      }
    };

    detectRegion();
  }, []);

  const setRegion = useCallback((code: string) => {
    const found = SUPPORTED_REGIONS.find(r => r.code === code);
    if (found) {
      setRegionState(found);
      localStorage.setItem(REGION_STORAGE_KEY, code);
    }
  }, []);

  const formatPrice = useCallback((usdPrice: number, showSymbol = true): string => {
    const convertedPrice = Math.round(usdPrice * region.exchangeRate);
    
    if (showSymbol) {
      // For RTL currencies like SAR and AED, put symbol after
      if (region.code === "SA" || region.code === "AE") {
        return `${convertedPrice} ${region.currencySymbol}`;
      }
      return `${region.currencySymbol}${convertedPrice}`;
    }
    
    return convertedPrice.toString();
  }, [region]);

  return {
    region,
    setRegion,
    isDetecting,
    formatPrice,
  };
}

export { RegionContext };
