import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  KIOSK_PIN_ITERATIONS,
  KioskPinMaterial,
  cachePinMaterial,
  generateSalt,
  hashPin,
  readCachedPinMaterial,
  takeQueuedUnlockEvents,
  validatePinFormat,
} from "@/lib/kioskPin";

const QK = ["kiosk-offline-pin"] as const;

/**
 * Reads the restaurant's emergency kiosk PIN hash, mirrors it into local
 * storage for offline use, and lets owners/managers set or rotate it.
 */
export function useKioskOfflinePin() {
  const { restaurant, tenant, user } = useAuth();
  const restaurantId = restaurant?.id ?? null;
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: [...QK, restaurantId],
    enabled: !!restaurantId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<KioskPinMaterial | null> => {
      const { data, error } = await db
        .from("kiosk_offline_pins" as never)
        .select("pin_hash, pin_salt, iterations, rotated_at")
        .eq("restaurant_id", restaurantId!)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as KioskPinMaterial) ?? null;
    },
  });

  // Mirror the hash locally so the tablet can verify with no internet.
  useEffect(() => {
    if (restaurantId && query.data) cachePinMaterial(restaurantId, query.data);
  }, [restaurantId, query.data]);

  // Flush any unlock events recorded while offline.
  useEffect(() => {
    if (!restaurantId) return;
    const pending = takeQueuedUnlockEvents().filter((e) => e.restaurant_id === restaurantId);
    if (pending.length === 0) return;
    void db.from("kiosk_offline_unlock_events" as never).insert(pending as never);
  }, [restaurantId]);

  const setPin = useMutation({
    mutationFn: async (pin: string) => {
      const formatError = validatePinFormat(pin);
      if (formatError) throw new Error(formatError);
      if (!restaurantId || !tenant?.id) throw new Error("Missing restaurant context");
      const pin_salt = generateSalt();
      const pin_hash = await hashPin(pin, pin_salt, KIOSK_PIN_ITERATIONS);
      const payload = {
        restaurant_id: restaurantId,
        tenant_id: tenant.id,
        pin_hash,
        pin_salt,
        iterations: KIOSK_PIN_ITERATIONS,
        updated_by_user_id: user?.id ?? null,
        rotated_at: new Date().toISOString(),
      };
      const { error } = await db
        .from("kiosk_offline_pins" as never)
        .upsert(payload as never, { onConflict: "restaurant_id" });
      if (error) throw error;
      cachePinMaterial(restaurantId, { pin_hash, pin_salt, iterations: KIOSK_PIN_ITERATIONS });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...QK, restaurantId] }),
  });

  return {
    material: query.data ?? null,
    cachedOnDevice: restaurantId ? !!readCachedPinMaterial(restaurantId) : false,
    isLoading: query.isLoading,
    setPin: setPin.mutateAsync,
    savingPin: setPin.isPending,
  };
}