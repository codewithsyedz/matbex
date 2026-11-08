import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

const KEY = "pos.menuCols";

function defaultCols(): 2 | 3 | 4 | 6 {
  if (typeof window === "undefined") return 4;
  return window.innerWidth < 768 ? 2 : 4;
}

function isValidCols(n: number): n is 2 | 3 | 4 | 6 {
  return [2, 3, 4, 6].includes(n);
}

async function loadCols(): Promise<2 | 3 | 4 | 6> {
  try {
    if (Capacitor.isNativePlatform()) {
      const { value } = await Preferences.get({ key: KEY });
      const n = Number(value);
      if (isValidCols(n)) return n;
    }
    const saved = localStorage.getItem(KEY);
    const n = Number(saved);
    if (isValidCols(n)) return n;
  } catch {
    // fall back to default
  }
  return defaultCols();
}

async function saveCols(cols: 2 | 3 | 4 | 6) {
  try {
    if (Capacitor.isNativePlatform()) {
      await Preferences.set({ key: KEY, value: String(cols) });
    }
    localStorage.setItem(KEY, String(cols));
  } catch {
    // ignore storage errors
  }
}

export function usePosGridColumns() {
  const [menuCols, setMenuCols] = useState<2 | 3 | 4 | 6>(defaultCols);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadCols().then((cols) => {
      if (!cancelled) {
        setMenuCols(cols);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (loaded) {
      saveCols(menuCols);
    }
  }, [menuCols, loaded]);

  return [menuCols, setMenuCols] as const;
}
