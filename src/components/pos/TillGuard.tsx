import { type ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useStaffPosPins } from "@/hooks/useStaffPosPins";
import { useTillSession } from "@/hooks/useTillSession";
import { readCachedStaffPins } from "@/lib/pos/staffPin";
import { isOnline } from "@/lib/offline/connectivity";
import { TillLockScreen } from "./TillLockScreen";
import { TillTools } from "./TillTools";

/**
 * Wraps the till screen with per-staff PIN sign-in and the offline till tools
 * (cash drawer, refunds, sync status).
 *
 * When no PINs exist for the restaurant the guard stays out of the way, so
 * existing single-operator setups keep working exactly as before.
 */
export function TillGuard({ children }: { children: ReactNode }) {
  const { restaurant } = useAuth();
  const restaurantId = restaurant?.id ?? null;

  // Keeps the local PIN roster fresh whenever the terminal is online.
  useStaffPosPins();

  const hasRoster = restaurantId ? readCachedStaffPins(restaurantId).length > 0 : false;
  const { staff, unlock, lock } = useTillSession(hasRoster);

  if (!restaurantId || !hasRoster) return <>{children}</>;

  if (!staff) {
    return (
      <TillLockScreen
        restaurantId={restaurantId}
        restaurantName={restaurant?.name ?? null}
        online={isOnline()}
        onUnlock={unlock}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TillTools restaurantId={restaurantId} staff={staff} onLock={lock} />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
