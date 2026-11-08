import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { getTerminalId } from "@/lib/offline/terminal";
import { exitKioskMode, isNativeKioskAvailable } from "@/lib/kiosk";

interface UnlockRequest {
  id: string;
  reason: string | null;
  expires_at: string;
}

const POLL_MS = 20_000;

/**
 * Runs on paired Android terminals. Watches for a pending remote
 * "exit kiosk" request issued from the admin console and, when one lands,
 * releases Android lock-task mode and acknowledges the request.
 */
export function KioskUnlockListener() {
  const { restaurant } = useAuth();
  const restaurantId = restaurant?.id;
  const handling = useRef(false);

  useEffect(() => {
    if (!restaurantId || !isNativeKioskAvailable()) return;

    let cancelled = false;
    let timer: number | undefined;

    const check = async () => {
      if (cancelled || handling.current) return;
      try {
        const terminalId = await getTerminalId();
        const { data, error } = await db
          .from("kiosk_unlock_requests" as never)
          .select("id, reason, expires_at")
          .eq("restaurant_id", restaurantId)
          .eq("terminal_id", terminalId)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(1);
        if (error || cancelled) return;

        const req = (data as unknown as UnlockRequest[])?.[0];
        if (!req) return;

        handling.current = true;

        if (new Date(req.expires_at).getTime() < Date.now()) {
          await db
            .from("kiosk_unlock_requests" as never)
            .update({ status: "expired" } as never)
            .eq("id", req.id);
          handling.current = false;
          return;
        }

        const res = await exitKioskMode();
        if (res.ok) {
          await db
            .from("kiosk_unlock_requests" as never)
            .update({
              status: "acknowledged",
              acknowledged_at: new Date().toISOString(),
              acknowledged_platform: navigator.userAgent.slice(0, 200),
            } as never)
            .eq("id", req.id);
          toast.success("Kiosk mode released by an administrator", {
            description: req.reason || "You can now leave the Matbex app.",
            duration: 10_000,
          });
        } else {
          toast.error("Remote kiosk exit failed", { description: res.error });
        }
        handling.current = false;
      } catch {
        handling.current = false;
      }
    };

    void check();
    timer = window.setInterval(check, POLL_MS);

    const channel = db
      .channel(`kiosk-unlock-${restaurantId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "kiosk_unlock_requests" },
        () => void check(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      db.removeChannel(channel);
    };
  }, [restaurantId]);

  return null;
}