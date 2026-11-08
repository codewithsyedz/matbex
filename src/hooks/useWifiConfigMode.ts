import { useCallback, useEffect, useRef, useState } from "react";
import { enterKioskMode, openWifiSettings } from "@/lib/kiosk";

const STORAGE_KEY = "matbex.kiosk.wifiConfigUntil";
export const WIFI_CONFIG_WINDOW_MS = 60_000;

function readDeadline(): number {
  const raw = Number(localStorage.getItem(STORAGE_KEY) ?? 0);
  return Number.isFinite(raw) ? raw : 0;
}

/**
 * Temporary "Wi-Fi config mode": releases Android lock-task for a fixed 60s
 * window so the operator can open the Wi-Fi picker, then automatically
 * re-locks kiosk mode. The deadline is persisted so the re-lock still happens
 * after the app is backgrounded while the user is inside Android settings.
 */
export function useWifiConfigMode() {
  const [remainingMs, setRemainingMs] = useState(() =>
    Math.max(0, readDeadline() - Date.now()),
  );
  const [relocking, setRelocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const relockingRef = useRef(false);

  const relock = useCallback(async () => {
    if (relockingRef.current) return { ok: true };
    relockingRef.current = true;
    setRelocking(true);
    localStorage.removeItem(STORAGE_KEY);
    setRemainingMs(0);
    const res = await enterKioskMode();
    if (!res.ok) setError(res.error ?? "Could not re-lock kiosk mode");
    setRelocking(false);
    relockingRef.current = false;
    return res;
  }, []);

  const start = useCallback(async () => {
    setError(null);
    const res = await openWifiSettings(true);
    if (!res.ok) {
      setError(res.error ?? "Could not open Wi-Fi settings");
      return res;
    }
    const deadline = Date.now() + WIFI_CONFIG_WINDOW_MS;
    localStorage.setItem(STORAGE_KEY, String(deadline));
    setRemainingMs(WIFI_CONFIG_WINDOW_MS);
    return res;
  }, []);

  const extend = useCallback(() => {
    const deadline = Date.now() + WIFI_CONFIG_WINDOW_MS;
    localStorage.setItem(STORAGE_KEY, String(deadline));
    setRemainingMs(WIFI_CONFIG_WINDOW_MS);
  }, []);

  // Countdown + auto re-lock. Runs off wall-clock so backgrounding can't stall it.
  useEffect(() => {
    const tick = () => {
      const deadline = readDeadline();
      if (!deadline) {
        setRemainingMs(0);
        return;
      }
      const left = deadline - Date.now();
      setRemainingMs(Math.max(0, left));
      if (left <= 0) void relock();
    };
    tick();
    const id = window.setInterval(tick, 500);
    const onVisible = () => tick();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [relock]);

  return {
    active: remainingMs > 0,
    remainingMs,
    remainingSec: Math.ceil(remainingMs / 1000),
    relocking,
    error,
    start,
    extend,
    relock,
  };
}
