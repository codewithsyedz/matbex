import { useEffect, useRef } from "react";
import { db } from "@/integrations/db/client";
import { getTerminalId } from "@/lib/offline/terminal";

const PING_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Lightweight presence heartbeat.
 *
 * Bumps `last_seen_at` on the device license (and matching pos_terminals row)
 * every 5 minutes without invoking validate-license. This keeps the "Online"
 * badge accurate between the 6-hour full license validations.
 */
export function useDevicePresencePing(enabled: boolean) {
  const inFlight = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const ping = async () => {
      if (cancelled || inFlight.current) return;
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      inFlight.current = true;
      try {
        const { data: { session } } = await db.auth.getSession();
        if (!session?.access_token) return;
        const terminalId = await getTerminalId();
        if (!terminalId) return;
        await db.rpc("touch_device_presence", { p_terminal_id: terminalId });
      } catch (e) {
        // Presence is best-effort; never surface an error to the UI.
        console.debug("[presence] ping skipped", e);
      } finally {
        inFlight.current = false;
      }
    };

    void ping();
    const interval = window.setInterval(ping, PING_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void ping();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", ping);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", ping);
    };
  }, [enabled]);
}
