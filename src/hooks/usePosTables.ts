import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface PosTable {
  id: string;
  tenant_id: string;
  restaurant_id: string;
  branch_id: string | null;
  label: string;
  code: string;
  capacity: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PosTableOrder {
  id: string;
  table_id: string;
  restaurant_id: string;
  guest_name: string | null;
  items: Array<{
    menu_item_id: string;
    name: string;
    size?: string;
    price: number;
    qty: number;
    notes?: string;
  }>;
  subtotal: number;
  tax: number;
  total: number;
  status: "submitted" | "accepted" | "paid" | "cancelled";
  notes: string | null;
  submitted_at: string;
  paid_at: string | null;
}

export function usePosTables() {
  const { restaurant } = useAuth();
  const qc = useQueryClient();
  const restaurantId = restaurant?.id;

  const tablesQuery = useQuery({
    queryKey: ["pos-tables", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [] as PosTable[];
      const { data, error } = await supabase
        .from("pos_tables")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .is("deleted_at", null)
        .order("label");
      if (error) throw error;
      return (data || []) as PosTable[];
    },
    enabled: !!restaurantId,
  });

  const createTable = useMutation({
    mutationFn: async (input: { label: string; code: string; capacity: number; branch_id?: string | null }) => {
      if (!restaurant?.id || !restaurant?.tenant_id) throw new Error("No restaurant");
      const { data, error } = await supabase
        .from("pos_tables")
        .insert({
          tenant_id: restaurant.tenant_id,
          restaurant_id: restaurant.id,
          branch_id: input.branch_id ?? null,
          label: input.label,
          code: input.code,
          capacity: input.capacity,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pos-tables"] }),
  });

  const updateTable = useMutation({
    mutationFn: async ({ id, ...patch }: { id: string } & Partial<Omit<PosTable, "id" | "tenant_id" | "restaurant_id">>) => {
      const { error } = await supabase.from("pos_tables").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pos-tables"] }),
  });

  const deleteTable = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("pos_tables")
        .update({ deleted_at: new Date().toISOString(), is_active: false })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pos-tables"] }),
  });

  return {
    tables: tablesQuery.data || [],
    isLoading: tablesQuery.isLoading,
    createTable,
    updateTable,
    deleteTable,
  };
}

export function usePosTableOrders() {
  const { restaurant } = useAuth();
  const restaurantId = restaurant?.id;

  return useQuery({
    queryKey: ["pos-table-orders", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [] as PosTableOrder[];
      const { data, error } = await supabase
        .from("pos_table_orders")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .is("deleted_at", null)
        .order("submitted_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []) as unknown as PosTableOrder[];
    },
    enabled: !!restaurantId,
    refetchInterval: 15000,
  });
}