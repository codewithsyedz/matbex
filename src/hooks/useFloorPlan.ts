import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type TableStatus = "free" | "seated" | "ordered" | "billing" | "dirty";
export type TableShape = "rect" | "circle";

export interface FloorPlan {
  id: string;
  tenant_id: string;
  restaurant_id: string;
  branch_id: string | null;
  name: string;
  width: number;
  height: number;
  is_default: boolean;
}

export interface FloorTable {
  id: string;
  tenant_id: string;
  restaurant_id: string;
  branch_id: string | null;
  floor_plan_id: string | null;
  label: string;
  code: string;
  capacity: number;
  is_active: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  shape: TableShape;
  rotation: number;
  status: TableStatus;
  seated_at: string | null;
  server_id: string | null;
  guest_count: number | null;
}

export function useFloorPlans() {
  const { restaurant } = useAuth();
  const qc = useQueryClient();
  const restaurantId = restaurant?.id;

  const plansQuery = useQuery({
    queryKey: ["floor-plans", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [] as FloorPlan[];
      const { data, error } = await supabase
        .from("pos_floor_plans")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .is("deleted_at", null)
        .order("created_at");
      if (error) throw error;
      return (data || []) as FloorPlan[];
    },
    enabled: !!restaurantId,
  });

  const createPlan = useMutation({
    mutationFn: async (input: { name: string; width?: number; height?: number; is_default?: boolean }) => {
      if (!restaurant?.id || !restaurant?.tenant_id) throw new Error("No restaurant");
      const { data, error } = await supabase
        .from("pos_floor_plans")
        .insert({
          tenant_id: restaurant.tenant_id,
          restaurant_id: restaurant.id,
          name: input.name,
          width: input.width ?? 1000,
          height: input.height ?? 700,
          is_default: input.is_default ?? false,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["floor-plans"] }),
  });

  const updatePlan = useMutation({
    mutationFn: async ({ id, ...patch }: { id: string } & Partial<FloorPlan>) => {
      const { error } = await supabase.from("pos_floor_plans").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["floor-plans"] }),
  });

  const deletePlan = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("pos_floor_plans")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["floor-plans"] }),
  });

  return { plans: plansQuery.data || [], isLoading: plansQuery.isLoading, createPlan, updatePlan, deletePlan };
}

export function useFloorTables(floorPlanId: string | null) {
  const { restaurant } = useAuth();
  const qc = useQueryClient();
  const restaurantId = restaurant?.id;

  const tablesQuery = useQuery({
    queryKey: ["floor-tables", restaurantId, floorPlanId],
    queryFn: async () => {
      if (!restaurantId) return [] as FloorTable[];
      let q = supabase
        .from("pos_tables")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .is("deleted_at", null)
        .order("label");
      if (floorPlanId) q = q.eq("floor_plan_id", floorPlanId);
      else q = q.is("floor_plan_id", null);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as FloorTable[];
    },
    enabled: !!restaurantId,
  });

  // Realtime subscription
  useEffect(() => {
    if (!restaurantId) return;
    const ch = supabase
      .channel(`pos_tables_${restaurantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pos_tables", filter: `restaurant_id=eq.${restaurantId}` },
        () => qc.invalidateQueries({ queryKey: ["floor-tables", restaurantId] })
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [restaurantId, qc]);

  const createTable = useMutation({
    mutationFn: async (input: Partial<FloorTable> & { label: string; code: string }) => {
      if (!restaurant?.id || !restaurant?.tenant_id) throw new Error("No restaurant");
      const { data, error } = await supabase
        .from("pos_tables")
        .insert({
          tenant_id: restaurant.tenant_id,
          restaurant_id: restaurant.id,
          floor_plan_id: floorPlanId,
          label: input.label,
          code: input.code,
          capacity: input.capacity ?? 4,
          x: input.x ?? 40,
          y: input.y ?? 40,
          width: input.width ?? 80,
          height: input.height ?? 80,
          shape: input.shape ?? "rect",
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["floor-tables"] }),
  });

  const updateTable = useMutation({
    mutationFn: async ({ id, ...patch }: { id: string } & Partial<FloorTable>) => {
      const { error } = await supabase.from("pos_tables").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["floor-tables"] }),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status, guest_count }: { id: string; status: TableStatus; guest_count?: number }) => {
      const patch: Record<string, unknown> = { status };
      if (status === "seated") {
        patch.seated_at = new Date().toISOString();
        if (guest_count !== undefined) patch.guest_count = guest_count;
      } else if (status === "free") {
        patch.seated_at = null;
        patch.guest_count = null;
        patch.server_id = null;
      }
      const { error } = await supabase.from("pos_tables").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["floor-tables"] }),
  });

  const deleteTable = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("pos_tables")
        .update({ deleted_at: new Date().toISOString(), is_active: false })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["floor-tables"] }),
  });

  return {
    tables: tablesQuery.data || [],
    isLoading: tablesQuery.isLoading,
    createTable,
    updateTable,
    setStatus,
    deleteTable,
  };
}