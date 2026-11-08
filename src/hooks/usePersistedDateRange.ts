import { useCallback, useEffect, useState } from "react";

const PREFIX = "matbex:date-range:";

function parse(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Date range filter that persists across sessions in localStorage so users
 * don't have to re-pick their reporting window on every visit.
 */
export function usePersistedDateRange(
  key: string,
  defaults: { from: Date; to: Date },
) {
  const storageKey = `${PREFIX}${key}`;

  const [range, setRange] = useState<{ from: Date; to: Date }>(() => {
    if (typeof window === "undefined") return defaults;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return defaults;
      const saved = JSON.parse(raw) as { from?: string; to?: string };
      return {
        from: parse(saved.from ?? null) ?? defaults.from,
        to: parse(saved.to ?? null) ?? defaults.to,
      };
    } catch {
      return defaults;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          from: range.from.toISOString(),
          to: range.to.toISOString(),
        }),
      );
    } catch {
      /* storage unavailable (private mode) — filter still works in-memory */
    }
  }, [storageKey, range.from, range.to]);

  const setFrom = useCallback((from: Date) => setRange((p) => ({ ...p, from })), []);
  const setTo = useCallback((to: Date) => setRange((p) => ({ ...p, to })), []);
  const reset = useCallback(() => {
    setRange(defaults);
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      /* noop */
    }
    // defaults are stable per call-site usage
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  return { from: range.from, to: range.to, setFrom, setTo, reset };
}
