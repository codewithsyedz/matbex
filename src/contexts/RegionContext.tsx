import React from "react";
import { RegionContext, useRegionProvider } from "@/hooks/useRegion";

export function RegionProvider({ children }: { children: React.ReactNode }) {
  const regionValue = useRegionProvider();
  
  return (
    <RegionContext.Provider value={regionValue}>
      {children}
    </RegionContext.Provider>
  );
}
