import { useState, useEffect } from "react";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useTableChanges } from "@/hooks/useTableChanges";

export interface Shift {
  id: string;
  status: "open" | "closing" | "closed";
  opening_float: number;
  expected_cash: number | null;
  counted_cash: number | null;
  variance: number | null;
  stock_variance_pct: number | null;
  stock_variance_explanation: string | null;
  deposit_amount: number | null;
  notes: string | null;
  opened_at: string;
  closed_at: string | null;
  cashier_user_id: string;
  cashier_staff_id: string | null;
  drawer_id: string;
  template_id: string | null;
  cashier_name?: string;
  drawer_name?: string;
}

export interface Staff {
  id: string;
  name: string;
  role: string;
  is_active: boolean;
}

export interface Drawer {
  id: string;
  name: string;
  is_active: boolean;
}

export interface ShiftTemplate {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  default_float: number;
}

export function useShiftsData() {
  const { restaurant } = useAuth();
  const { activeBranchId } = useBranch();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [drawers, setDrawers] = useState<Drawer[]>([]);
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [staffMembers, setStaffMembers] = useState<Staff[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchShifts = async () => {
    if (!restaurant?.id) return;

    try {
      let shiftsQuery = db
        .from("shifts")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .order("opened_at", { ascending: false });
      if (activeBranchId) shiftsQuery = shiftsQuery.eq("branch_id", activeBranchId);
      const { data: shiftsData, error } = await shiftsQuery;

      if (error) throw error;

      // Get drawer names
      let drawersQ = db
        .from("drawers")
        .select("id, name")
        .eq("restaurant_id", restaurant.id);
      if (activeBranchId) drawersQ = drawersQ.eq("branch_id", activeBranchId);
      const { data: drawersData } = await drawersQ;

      const drawerMap = new Map<string, string>(drawersData?.map((d) => [d.id, d.name]) || []);

      // Get staff names for cashier mapping
      const staffIds = [...new Set(shiftsData?.map((s) => s.cashier_staff_id).filter(Boolean) || [])] as string[];
      const { data: staffData } = staffIds.length > 0 
        ? await db.from("staff").select("id, name").in("id", staffIds)
        : { data: [] };

      const staffMap = new Map<string, string>(staffData?.map((s): [string, string] => [s.id, s.name]) || []);

      // Fallback to profiles for legacy data
      const userIds = [...new Set(shiftsData?.filter(s => !s.cashier_staff_id).map((s) => s.cashier_user_id) || [])] as string[];
      const { data: profilesData } = userIds.length > 0
        ? await db.from("profiles").select("id, full_name").in("id", userIds)
        : { data: [] };

      const profileMap = new Map<string, string>(profilesData?.map((p): [string, string] => [p.id, p.full_name || "Unknown"]) || []);

      const enrichedShifts: Shift[] = (shiftsData || []).map((shift) => ({
        ...shift,
        status: shift.status as "open" | "closing" | "closed",
        cashier_name: shift.cashier_staff_id 
          ? (staffMap.get(shift.cashier_staff_id) || "Unknown Staff")
          : (profileMap.get(shift.cashier_user_id) || "Unknown"),
        drawer_name: drawerMap.get(shift.drawer_id) || "Unknown Drawer",
      }));

      setShifts(enrichedShifts);
    } catch (error) {
      console.error("Error fetching shifts:", error);
    }
  };

  const fetchStaff = async () => {
    if (!restaurant?.id) return;

    try {
      const { data, error } = await db
        .from("staff")
        .select("id, name, role, is_active")
        .eq("restaurant_id", restaurant.id)
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      setStaffMembers(data || []);
    } catch (error) {
      console.error("Error fetching staff:", error);
    }
  };

  const fetchDrawers = async () => {
    if (!restaurant?.id) return;

    try {
      let q = db
        .from("drawers")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .eq("is_active", true);
      if (activeBranchId) q = q.eq("branch_id", activeBranchId);
      const { data, error } = await q;

      if (error) throw error;
      setDrawers(data || []);
    } catch (error) {
      console.error("Error fetching drawers:", error);
    }
  };

  const fetchTemplates = async () => {
    if (!restaurant?.id) return;

    try {
      const { data, error } = await db
        .from("shift_templates")
        .select("*")
        .eq("restaurant_id", restaurant.id);

      if (error) throw error;
      setTemplates(data || []);
    } catch (error) {
      console.error("Error fetching templates:", error);
    }
  };

  const fetchAll = async () => {
    setIsLoading(true);
    await Promise.all([fetchShifts(), fetchDrawers(), fetchTemplates(), fetchStaff()]);
    setIsLoading(false);
  };

  useEffect(() => {
    if (restaurant?.id) {
      fetchAll();
    }
    // refetch when branch switch happens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurant?.id, activeBranchId]);

  // Live updates for shifts (event channel, topic "sales").
  useTableChanges({
    topic: "sales",
    restaurantId: restaurant?.id,
    tables: ["shifts"],
    onChange: () => fetchShifts(),
  });

  const getOpenShiftForDrawer = (drawerId: string) => {
    return shifts.find((s) => s.drawer_id === drawerId && s.status === "open");
  };

  return {
    shifts,
    drawers,
    templates,
    staffMembers,
    isLoading,
    refetch: fetchAll,
    getOpenShiftForDrawer,
  };
}
