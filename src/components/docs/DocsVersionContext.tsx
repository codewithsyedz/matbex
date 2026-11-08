import { createContext, useContext, useMemo, useState, ReactNode } from "react";
import { useDocsVersions, DocsVersion } from "@/hooks/useDocsVersions";

type Ctx = {
  selected: DocsVersion | null;
  setSelectedId: (id: string | null) => void;
  versions: DocsVersion[];
  current: DocsVersion | null;
  isLoading: boolean;
};

const DocsVersionContext = createContext<Ctx | null>(null);

export function DocsVersionProvider({ children }: { children: ReactNode }) {
  const { data: versions, isLoading } = useDocsVersions();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const value = useMemo<Ctx>(() => {
    const list = versions || [];
    const current = list.find((v) => v.is_current) || list[0] || null;
    const selected = selectedId ? list.find((v) => v.id === selectedId) || current : current;
    return {
      selected: selected || null,
      setSelectedId,
      versions: list,
      current: current || null,
      isLoading,
    };
  }, [versions, selectedId, isLoading]);

  return <DocsVersionContext.Provider value={value}>{children}</DocsVersionContext.Provider>;
}

export function useDocsVersionContext() {
  const ctx = useContext(DocsVersionContext);
  if (!ctx) {
    // Render-safe fallback so blocks outside the provider still work.
    return { selected: null, setSelectedId: () => {}, versions: [], current: null, isLoading: false } as Ctx;
  }
  return ctx;
}