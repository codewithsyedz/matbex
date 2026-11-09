import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { db } from "@/integrations/db/client";
import { subscribeEvents } from "@/integrations/db/events";
import { useAuth } from "@/contexts/AuthContext";

export type KdsTicketStatus = "new" | "in_progress" | "ready" | "served" | "cancelled";
export type KdsItemStatus = "pending" | "in_progress" | "ready" | "served" | "cancelled";

export interface KdsStation {
  id: string;
  restaurant_id: string;
  name: string;
  station_type: string;
  active: boolean;
  sort_order: number;
}

export interface KdsTicketItem {
  id: string;
  ticket_id: string;
  menu_item_id: string | null;
  name_snapshot: string;
  size_label: string | null;
  quantity: number;
  notes: string | null;
  station_id: string | null;
  status: KdsItemStatus;
}

export interface KdsTicket {
  id: string;
  restaurant_id: string;
  ticket_number: string;
  source: string;
  source_order_id: string | null;
  table_label: string | null;
  status: KdsTicketStatus;
  priority: number;
  notes: string | null;
  created_at: string;
  started_at: string | null;
  ready_at: string | null;
  served_at: string | null;
  items?: KdsTicketItem[];
}

const ACTIVE: KdsTicketStatus[] = ["new", "in_progress", "ready"];

export function useKdsStations() {
  const { restaurant } = useAuth();
  const qc = useQueryClient();
  const rid = restaurant?.id;

  const query = useQuery({
    queryKey: ["kds-stations", rid],
    queryFn: async () => {
      if (!rid) return [] as KdsStation[];
      const { data, error } = await db
        .from("pos_kds_stations" as any)
        .select("*")
        .eq("restaurant_id", rid)
        .order("sort_order");
      if (error) throw error;
      return (data || []) as unknown as KdsStation[];
    },
    enabled: !!rid,
  });

  const create = useMutation({
    mutationFn: async (input: { name: string; station_type?: string }) => {
      if (!rid) throw new Error("No restaurant");
      const { error } = await db.from("pos_kds_stations" as any).insert({
        restaurant_id: rid,
        name: input.name,
        station_type: input.station_type || "kitchen",
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kds-stations"] }),
  });

  const update = useMutation({
    mutationFn: async ({ id, ...patch }: { id: string } & Partial<KdsStation>) => {
      const { error } = await db.from("pos_kds_stations" as any).update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kds-stations"] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("pos_kds_stations" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kds-stations"] }),
  });

  return { stations: query.data || [], isLoading: query.isLoading, create, update, remove };
}

export function useKdsTickets(stationId?: string | "all") {
  const { restaurant } = useAuth();
  const qc = useQueryClient();
  const rid = restaurant?.id;

  const query = useQuery({
    queryKey: ["kds-tickets", rid, stationId ?? "all"],
    queryFn: async () => {
      if (!rid) return [] as KdsTicket[];
      const { data: tickets, error } = await db
        .from("pos_kds_tickets" as any)
        .select("*")
        .eq("restaurant_id", rid)
        .in("status", ACTIVE)
        .order("created_at", { ascending: true });
      if (error) throw error;
      const ids = (tickets || []).map((t: any) => t.id);
      if (ids.length === 0) return [] as KdsTicket[];
      let itemsQ = db
        .from("pos_kds_ticket_items" as any)
        .select("*")
        .in("ticket_id", ids);
      if (stationId && stationId !== "all") {
        itemsQ = itemsQ.eq("station_id", stationId);
      }
      const { data: items, error: e2 } = await itemsQ;
      if (e2) throw e2;
      const byTicket = new Map<string, KdsTicketItem[]>();
      (items || []).forEach((it: any) => {
        const arr = byTicket.get(it.ticket_id) || [];
        arr.push(it as KdsTicketItem);
        byTicket.set(it.ticket_id, arr);
      });
      const result = (tickets as any[])
        .map((t) => ({ ...t, items: byTicket.get(t.id) || [] }) as KdsTicket)
        .filter((t) => stationId === "all" || !stationId || t.items!.length > 0);
      return result;
    },
    enabled: !!rid,
    // Safety net only; changes arrive as events.
    refetchInterval: 30000,
  });

  // Live updates: outbox events over Socket.IO (src/integrations/db/events.ts). Any ticket or
  // item change refetches; reconnecting also refetches, covering events missed while offline.
  useEffect(() => {
    if (!rid) return;
    const refresh = () => qc.invalidateQueries({ queryKey: ["kds-tickets", rid] });
    return subscribeEvents("kds", rid, refresh, refresh);
  }, [rid, qc]);

  const setTicketStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: KdsTicketStatus }) => {
      const patch: any = { status };
      const now = new Date().toISOString();
      if (status === "in_progress") patch.started_at = now;
      if (status === "ready") patch.ready_at = now;
      if (status === "served") patch.served_at = now;
      if (status === "cancelled") patch.cancelled_at = now;
      const { error } = await db.from("pos_kds_tickets" as any).update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kds-tickets"] }),
  });

  const setItemStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: KdsItemStatus }) => {
      const { error } = await db.from("pos_kds_ticket_items" as any).update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kds-tickets"] }),
  });

  return { tickets: query.data || [], isLoading: query.isLoading, setTicketStatus, setItemStatus };
}
