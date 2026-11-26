import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";

export interface ZatcaDevice {
  id: string;
  tenant_id: string;
  restaurant_id: string;
  name: string;
  serial_number: string;
  model: string | null;
  otp: string | null;
  registration_status: "PENDING" | "REGISTERED" | "REVOKED";
  csr: string | null;
  compliance_csid: string | null;
  production_csid: string | null;
  csid_expires_at: string | null;
  icv_counter: number;
  last_pih: string | null;
  registered_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Columns a browser may read. The device's private key and CSID secrets stay on the server
 * (migration 20261110180818); asking for "*" would be refused.
 */
const DEVICE_COLUMNS =
  "id, tenant_id, restaurant_id, name, serial_number, model, otp, registration_status, csr, compliance_csid, production_csid, csid_expires_at, icv_counter, last_pih, registered_at, revoked_at, created_at, updated_at";

export type ZatcaDeviceInput = {
  name: string;
  serial_number: string;
  model?: string | null;
  otp?: string | null;
};

const QK = ["zatca-devices"] as const;

export function useZatcaDevices() {
  const { tenant, restaurant } = useAuth();
  const tenantId = tenant?.id ?? null;
  const restaurantId = restaurant?.id ?? null;
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: [...QK, restaurantId],
    enabled: !!restaurantId,
    queryFn: async (): Promise<ZatcaDevice[]> => {
      const { data, error } = await db
        .from("zatca_devices" as never)
        .select(DEVICE_COLUMNS)
        .eq("restaurant_id", restaurantId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as unknown as ZatcaDevice[]) ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async (input: ZatcaDeviceInput) => {
      if (!tenantId || !restaurantId) throw new Error("Missing tenant/restaurant context");
      const { data, error } = await db
        .from("zatca_devices" as never)
        .insert(({
          tenant_id: tenantId,
          restaurant_id: restaurantId,
          name: input.name,
          serial_number: input.serial_number,
          model: input.model ?? null,
          otp: input.otp ?? null,
        }) as never)
        .select(DEVICE_COLUMNS)
        .single();
      if (error) throw error;
      return data as unknown as ZatcaDevice;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...QK, restaurantId] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("zatca_devices" as never).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...QK, restaurantId] }),
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db
        .from("zatca_devices" as never)
        .update(({ registration_status: "REVOKED", revoked_at: new Date().toISOString() }) as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...QK, restaurantId] }),
  });

  return {
    devices: query.data ?? [],
    loading: query.isLoading,
    create: create.mutateAsync,
    creating: create.isPending,
    remove: remove.mutateAsync,
    revoke: revoke.mutateAsync,
  };
}