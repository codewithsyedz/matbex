import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Who is currently served at the till on this device.
 * Persisted locally so a page refresh (or an offline reload) keeps the shift
 * going, and auto-locked after a period of no interaction.
 */
export interface TillStaff {
  user_id: string;
  display_name: string;
  since: string;
}

const KEY = "matbex.till.session";
export const TILL_IDLE_LOCK_MS = 10 * 60 * 1000;

function read(): TillStaff | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TillStaff;
    return parsed?.user_id ? parsed : null;
  } catch {
    return null;
  }
}

export function useTillSession(enabled = true) {
  const [staff, setStaff] = useState<TillStaff | null>(() => (enabled ? read() : null));
  const lastActivity = useRef(Date.now());

  const unlock = useCallback((next: { user_id: string; display_name: string }) => {
    const value: TillStaff = { ...next, since: new Date().toISOString() };
    try {
      localStorage.setItem(KEY, JSON.stringify(value));
    } catch {
      /* ignore */
    }
    lastActivity.current = Date.now();
    setStaff(value);
  }, []);

  const lock = useCallback(() => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    setStaff(null);
  }, []);

  // Idle auto-lock: any pointer/key activity resets the timer.
  useEffect(() => {
    if (!enabled || !staff) return;
    const touch = () => {
      lastActivity.current = Date.now();
    };
    const events: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "touchstart"];
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivity.current >= TILL_IDLE_LOCK_MS) lock();
    }, 30_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      window.clearInterval(timer);
    };
  }, [enabled, staff, lock]);

  return useMemo(() => ({ staff, unlock, lock }), [staff, unlock, lock]);
}
