import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * Polls the public auth health endpoint. This deliberately bypasses the
 * the API client so an expired session or token refresh cannot be mistaken
 * for a backend outage.
 */
const POLL_MS = 60_000;
const DEGRADED_POLL_MS = 10_000;
const REQUEST_TIMEOUT_MS = 5_000;
const FAIL_THRESHOLD = 2;
const HEALTH_URL = `${import.meta.env.VITE_API_URL}/auth/v1/health`;
const PUBLISHABLE_KEY = import.meta.env.VITE_API_KEY;

async function pingBackend(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(HEALTH_URL, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: PUBLISHABLE_KEY
        ? {
            apikey: PUBLISHABLE_KEY,
            Authorization: `Bearer ${PUBLISHABLE_KEY}`,
          }
        : undefined,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function DegradedModeBanner() {
  const [failures, setFailures] = useState(0);
  const degraded = failures >= FAIL_THRESHOLD;

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    let consecutiveFailures = 0;

    const tick = async () => {
      const ok = await pingBackend();
      if (cancelled) return;
      consecutiveFailures = ok ? 0 : consecutiveFailures + 1;
      setFailures(consecutiveFailures);
      timer = window.setTimeout(
        tick,
        consecutiveFailures >= FAIL_THRESHOLD ? DEGRADED_POLL_MS : POLL_MS,
      );
    };

    // The endpoint is session-independent, so it is safe to check immediately.
    void tick();

    const onOnline = () => {
      if (timer !== null) window.clearTimeout(timer);
      setFailures(0);
      consecutiveFailures = 0;
      void tick();
    };
    window.addEventListener("online", onOnline);

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  if (!degraded) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 inset-x-0 z-[100] bg-amber-500/95 text-amber-950 text-sm shadow-md"
    >
      <div className="max-w-5xl mx-auto px-4 py-2 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
        <span className="flex-1">
          We&apos;re having trouble reaching our backend. Some data may be
          out of date while we recover - you don&apos;t need to refresh.
        </span>
      </div>
    </div>
  );
}