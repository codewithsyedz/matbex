import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTableChanges } from "@/hooks/useTableChanges";

export type OnlineOrderStatus =
  | "pending"
  | "confirmed"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "completed"
  | "cancelled";

export interface OnlineOrder {
  id: string;
  restaurant_id: string;
  order_number: number;
  order_type: "delivery" | "pickup";
  status: OnlineOrderStatus;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  delivery_address: any;
  delivery_notes: string | null;
  subtotal: number;
  delivery_fee: number;
  tax: number;
  total: number;
  payment_method: "cash" | "card" | "online";
  payment_status: "pending" | "paid" | "refunded";
  requested_for: string | null;
  confirmed_at: string | null;
  ready_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  sales_transaction_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface OnlineOrderItem {
  id: string;
  order_id: string;
  menu_item_id: string | null;
  name_snapshot: string;
  variant: string | null;
  qty: number;
  unit_price: number;
  line_total: number;
  notes: string | null;
}

export function useOnlineOrders(restaurantId?: string | null) {
  const qc = useQueryClient();

  const orders = useQuery({
    queryKey: ["online-orders", restaurantId],
    enabled: !!restaurantId,
    queryFn: async () => {
      const { data, error } = await (db as any)
        .from("online_orders")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as OnlineOrder[];
    },
  });

  // New and updated online orders, over the event channel (topic "pos").
  useTableChanges({
    topic: "pos",
    restaurantId,
    tables: ["online_orders"],
    onChange: () => qc.invalidateQueries({ queryKey: ["online-orders", restaurantId] }),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: OnlineOrderStatus }) => {
      const { error } = await (db as any)
        .from("online_orders")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["online-orders", restaurantId] }),
  });

  return { orders, updateStatus };
}

export function useOnlineOrderDetail(orderId?: string) {
  return useQuery({
    queryKey: ["online-order", orderId],
    enabled: !!orderId,
    refetchInterval: 5000,
    queryFn: async () => {
      // Use SECURITY DEFINER RPCs that return redacted, safe-by-default data.
      const [orderRes, itemsRes]: any = await Promise.all([
        (db as any).rpc("public_get_online_order", { p_id: orderId }),
        (db as any).rpc("public_get_online_order_items", { p_order_id: orderId }),
      ]);
      if (orderRes.error) throw orderRes.error;
      if (itemsRes.error) throw itemsRes.error;
      const orderRow = Array.isArray(orderRes.data) ? orderRes.data[0] : orderRes.data;
      return {
        order: (orderRow ?? null) as OnlineOrder | null,
        items: ((itemsRes.data ?? []) as OnlineOrderItem[]),
      };
    },
  });
}

export function useOnlineOrderSettings(restaurantId?: string | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["online-ordering-settings", restaurantId],
    enabled: !!restaurantId,
    queryFn: async () => {
      const { data, error } = await (db as any)
        .from("online_ordering_settings")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const save = useMutation({
    mutationFn: async (patch: Record<string, any>) => {
      if (!restaurantId) throw new Error("No restaurant");
      const { error } = await (db as any)
        .from("online_ordering_settings")
        .upsert({ restaurant_id: restaurantId, ...patch }, { onConflict: "restaurant_id" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["online-ordering-settings", restaurantId] }),
  });

  return { ...query, save };
}