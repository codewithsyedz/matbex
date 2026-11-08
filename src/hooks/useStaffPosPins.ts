import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  cacheStaffPins,
  generateSalt,
  hashPin,
  STAFF_PIN_ITERATIONS,
  validateStaffPinFormat,
  type StaffPinRecord,
} from "@/lib/pos/staffPin";

const QK = ["pos-staff-pins"] as const;

interface PinRow {
  id: string;
  user_id: string;
  display_name: string | null;
  pin_hash: string;
  pin_salt: string;
  iterations: number;
  is_active: boolean;
  rotated_at: string;
}

/**
 * Reads every till PIN hash for the restaurant, mirrors them into local
 * storage for offline sign-in, and lets owners/managers (or the staff member
 * themselves) set or clear a PIN.
 */
export function useStaffPosPins() {
  const { restaurant, tenant, user } = useAuth();
  const restaurantId = restaurant?.id ?? null;
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: [...QK, restaurantId],
    enabled: !!restaurantId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<PinRow[]> => {
      const { data, error } = await supabase
        .from("pos_staff_pins")
        .select("id, user_id, display_name, pin_hash, pin_salt, iterations, is_active, rotated_at")
        .eq("restaurant_id", restaurantId!)
        .eq("is_active", true);
      if (error) throw error;
      return (data ?? []) as PinRow[];
    },
  });

  // Mirror hashes locally so the tablet can sign staff in with no internet.
  useEffect(() => {
    if (!restaurantId || !query.data) return;
    const roster: StaffPinRecord[] = query.data.map((r) => ({
      user_id: r.user_id,
      display_name: r.display_name || "Staff",
      pin_hash: r.pin_hash,
      pin_salt: r.pin_salt,
      iterations: r.iterations || STAFF_PIN_ITERATIONS,
    }));
    cacheStaffPins(restaurantId, roster);
  }, [restaurantId, query.data]);

  const setPin = useMutation({
    mutationFn: async (input: { userId: string; displayName: string; pin: string }) => {
      const formatError = validateStaffPinFormat(input.pin);
      if (formatError) throw new Error(formatError);
      if (!restaurantId || !tenant?.id) throw new Error("Missing restaurant context");
      const pin_salt = generateSalt();
      const pin_hash = await hashPin(input.pin, pin_salt, STAFF_PIN_ITERATIONS);
      const { error } = await supabase.from("pos_staff_pins").upsert(
        {
          tenant_id: tenant.id,
          restaurant_id: restaurantId,
          user_id: input.userId,
          display_name: input.displayName,
          pin_hash,
          pin_salt,
          iterations: STAFF_PIN_ITERATIONS,
          is_active: true,
          updated_by_user_id: user?.id ?? null,
          rotated_at: new Date().toISOString(),
        },
        { onConflict: "restaurant_id,user_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });

  const clearPin = useMutation({
    mutationFn: async (userId: string) => {
      if (!restaurantId) throw new Error("Missing restaurant context");
      const { error } = await supabase
        .from("pos_staff_pins")
        .delete()
        .eq("restaurant_id", restaurantId)
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });

  return {
    pins: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    setPin,
    clearPin,
  };
}
