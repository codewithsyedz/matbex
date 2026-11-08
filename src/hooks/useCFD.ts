// =====================================================================
// Customer-Facing Display (CFD) hooks.
// ---------------------------------------------------------------------
// Two transport modes share the same surface:
//   • Same-device: a BroadcastChannel pushes cart updates to /cfd
//     opened in another window on the same machine (HDMI second screen).
//   • Paired tablet: a dedicated tablet pairs with a code and subscribes
//     to the cfd_sessions row via the API Realtime.
// The publisher always broadcasts locally and only hits the DB when a
// session is paired, so we never burn writes when no CFD is active.
// =====================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";

export type CFDState = "idle" | "cart" | "payment" | "thankyou";

export interface CFDCartItem {
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
  size?: string | null;
}

export interface CFDSnapshot {
  state: CFDState;
  cart: CFDCartItem[];
  subtotal: number;
  tax: number;
  total: number;
  message?: string | null;
  orderRef?: string | null;
}

export interface CFDSession {
  id: string;
  restaurant_id: string;
  pair_code: string;
  label: string | null;
  state: CFDState;
  cart: CFDCartItem[];
  subtotal: number;
  tax: number;
  total: number;
  message: string | null;
  order_ref: string | null;
  last_paired_at: string | null;
}

const BROADCAST_CHANNEL = "matbex:cfd:v1";
const ACTIVE_SESSION_LS_KEY = "matbex.cfd.activeSessionId.v1";

function randomPairCode(): string {
  // 6 chars, alphanumeric, no ambiguous 0/O/1/I
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function broadcast(payload: CFDSnapshot) {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
  try {
    const ch = new BroadcastChannel(BROADCAST_CHANNEL);
    ch.postMessage(payload);
    ch.close();
  } catch {
    // Some browsers (older Safari) lack BroadcastChannel — silently ignore.
  }
}

// ---------------------------------------------------------------------
// Cashier-side publisher
// ---------------------------------------------------------------------
export function useCFDPublisher() {
  const { restaurant } = useAuth();
  const lastSent = useRef<string>("");

  const publish = useCallback(
    async (snap: CFDSnapshot) => {
      const fingerprint = JSON.stringify(snap);
      if (fingerprint === lastSent.current) return;
      lastSent.current = fingerprint;

      // 1) Local same-device broadcast (free & instant)
      broadcast(snap);

      // 2) Paired remote display, only when one is active for this restaurant
      if (!restaurant?.id) return;
      const sessionId =
        typeof window !== "undefined"
          ? window.localStorage.getItem(ACTIVE_SESSION_LS_KEY)
          : null;
      if (!sessionId) return;
      try {
        await db
          .from("cfd_sessions" as any)
          .update({
            state: snap.state,
            cart: snap.cart as unknown as object,
            subtotal: snap.subtotal,
            tax: snap.tax,
            total: snap.total,
            message: snap.message ?? null,
            order_ref: snap.orderRef ?? null,
          })
          .eq("id", sessionId)
          .eq("restaurant_id", restaurant.id);
      } catch {
        // Display will catch up on the next snapshot; never block the sale.
      }
    },
    [restaurant?.id],
  );

  return { publish };
}

// ---------------------------------------------------------------------
// Cashier-side: manage paired CFD sessions
// ---------------------------------------------------------------------
export function useCFDSessions() {
  const { restaurant } = useAuth();
  const qc = useQueryClient();
  const rid = restaurant?.id;

  const list = useQuery({
    queryKey: ["cfd-sessions", rid],
    queryFn: async () => {
      if (!rid) return [] as CFDSession[];
      const { data, error } = await db
        .from("cfd_sessions" as any)
        .select("*")
        .eq("restaurant_id", rid)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as CFDSession[];
    },
    enabled: !!rid,
  });

  const create = useMutation({
    mutationFn: async (label: string) => {
      if (!rid) throw new Error("No restaurant");
      const { data, error } = await db
        .from("cfd_sessions" as any)
        .insert({
          restaurant_id: rid,
          pair_code: randomPairCode(),
          label: label || null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as unknown as CFDSession;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cfd-sessions", rid] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db
        .from("cfd_sessions" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cfd-sessions", rid] }),
  });

  const activeSessionId =
    typeof window !== "undefined"
      ? window.localStorage.getItem(ACTIVE_SESSION_LS_KEY)
      : null;

  const setActive = useCallback((id: string | null) => {
    if (typeof window === "undefined") return;
    if (id) window.localStorage.setItem(ACTIVE_SESSION_LS_KEY, id);
    else window.localStorage.removeItem(ACTIVE_SESSION_LS_KEY);
  }, []);

  return {
    sessions: list.data ?? [],
    isLoading: list.isLoading,
    create: create.mutateAsync,
    remove: remove.mutateAsync,
    activeSessionId,
    setActive,
  };
}

// ---------------------------------------------------------------------
// Display-side: subscribe to a single CFD snapshot
// ---------------------------------------------------------------------
export function useCFDDisplay(params: {
  restaurantId?: string | null;
  pairCode?: string | null;
  localOnly?: boolean;
}) {
  const { restaurantId, pairCode, localOnly } = params;
  const [snapshot, setSnapshot] = useState<CFDSnapshot>({
    state: "idle",
    cart: [],
    subtotal: 0,
    tax: 0,
    total: 0,
    message: null,
    orderRef: null,
  });

  // BroadcastChannel (always on — same-device mode)
  useEffect(() => {
    if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(BROADCAST_CHANNEL);
    ch.onmessage = (ev) => {
      const data = ev.data as CFDSnapshot | null;
      if (data && typeof data === "object" && "state" in data) {
        setSnapshot(data);
      }
    };
    return () => ch.close();
  }, []);

  // Realtime row subscription (paired mode)
  useEffect(() => {
    if (localOnly) return;
    if (!restaurantId || !pairCode) return;

    let cancelled = false;

    const applyRow = (row: any) => {
      if (!row || cancelled) return;
      setSnapshot({
        state: (row.state as CFDState) ?? "idle",
        cart: Array.isArray(row.cart) ? (row.cart as CFDCartItem[]) : [],
        subtotal: Number(row.subtotal ?? 0),
        tax: Number(row.tax ?? 0),
        total: Number(row.total ?? 0),
        message: row.message ?? null,
        orderRef: row.order_ref ?? null,
      });
    };

    // Initial fetch + heartbeat via SECURITY DEFINER RPCs (anon SELECT/UPDATE
    // on cfd_sessions is closed for security; the display only ever needs
    // its own paired row).
    const fetchOnce = async () => {
      const { data }: any = await (db as any).rpc("cfd_get_session", {
        p_restaurant_id: restaurantId,
        p_pair_code: pairCode,
      });
      const row = Array.isArray(data) ? data[0] : data;
      if (row) applyRow(row);
    };
    const heartbeat = () => {
      void (db as any).rpc("cfd_heartbeat", {
        p_restaurant_id: restaurantId,
        p_pair_code: pairCode,
      });
    };

    void fetchOnce();
    heartbeat();

    // Poll every 1.5s — realtime replication is unavailable without anon
    // SELECT on cfd_sessions, and a CFD only renders a single paired row.
    const pollId = window.setInterval(() => {
      void fetchOnce();
    }, 1500);
    const beatId = window.setInterval(heartbeat, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      window.clearInterval(beatId);
    };
  }, [restaurantId, pairCode, localOnly]);

  return snapshot;
}

export const CFD_ACTIVE_SESSION_LS_KEY = ACTIVE_SESSION_LS_KEY;
export const CFD_BROADCAST_CHANNEL = BROADCAST_CHANNEL;

// ---------------------------------------------------------------------
// CFD idle-screen customization (branded heading + rotating promos)
// ---------------------------------------------------------------------
export interface CFDIdleSettings {
  restaurant_id: string;
  heading: string | null;
  subheading: string | null;
  show_logo: boolean;
  rotation_seconds: number;
}

export interface CFDPromo {
  id: string;
  restaurant_id: string;
  title: string;
  body: string | null;
  image_url: string | null;
  accent_color: string | null;
  starts_on: string | null;
  ends_on: string | null;
  days_of_week: number[] | null;
  start_time: string | null;
  end_time: string | null;
  sort_order: number;
  is_active: boolean;
}

const DEFAULT_IDLE: Omit<CFDIdleSettings, "restaurant_id"> = {
  heading: null,
  subheading: null,
  show_logo: true,
  rotation_seconds: 8,
};

/** Admin hook: load & mutate CFD idle settings + promos for the current tenant. */
export function useCFDIdleAdmin() {
  const { restaurant } = useAuth();
  const qc = useQueryClient();
  const rid = restaurant?.id;

  const settingsQ = useQuery({
    queryKey: ["cfd-idle-settings", rid],
    queryFn: async () => {
      if (!rid) return null;
      const { data, error } = await db
        .from("cfd_idle_settings" as any)
        .select("*")
        .eq("restaurant_id", rid)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as CFDIdleSettings) ?? { restaurant_id: rid, ...DEFAULT_IDLE };
    },
    enabled: !!rid,
  });

  const promosQ = useQuery({
    queryKey: ["cfd-promos", rid],
    queryFn: async () => {
      if (!rid) return [] as CFDPromo[];
      const { data, error } = await db
        .from("cfd_promos" as any)
        .select("*")
        .eq("restaurant_id", rid)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as CFDPromo[];
    },
    enabled: !!rid,
  });

  const saveSettings = useMutation({
    mutationFn: async (patch: Partial<Omit<CFDIdleSettings, "restaurant_id">>) => {
      if (!rid) throw new Error("No restaurant");
      const current = settingsQ.data ?? { restaurant_id: rid, ...DEFAULT_IDLE };
      const next = { ...current, ...patch, restaurant_id: rid };
      const { error } = await db
        .from("cfd_idle_settings" as any)
        .upsert(next, { onConflict: "restaurant_id" });
      if (error) throw error;
      return next;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cfd-idle-settings", rid] }),
  });

  const upsertPromo = useMutation({
    mutationFn: async (p: Partial<CFDPromo> & { id?: string; title: string }) => {
      if (!rid) throw new Error("No restaurant");
      const payload: any = { ...p, restaurant_id: rid };
      const { error } = await db.from("cfd_promos" as any).upsert(payload);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cfd-promos", rid] }),
  });

  const deletePromo = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("cfd_promos" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cfd-promos", rid] }),
  });

  return {
    settings: settingsQ.data ?? null,
    promos: promosQ.data ?? [],
    isLoading: settingsQ.isLoading || promosQ.isLoading,
    saveSettings: saveSettings.mutateAsync,
    upsertPromo: upsertPromo.mutateAsync,
    deletePromo: deletePromo.mutateAsync,
  };
}

/**
 * Return only the promos that are active *right now* given the
 * restaurant's local clock. Cheap & client-side — the CFD already
 * needs a tick to rotate anyway.
 */
export function filterActivePromos(promos: CFDPromo[], now: Date = new Date()): CFDPromo[] {
  const ymd = now.toISOString().slice(0, 10);
  const dow = now.getDay(); // 0-6, Sun-Sat
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:00`;

  return promos.filter((p) => {
    if (!p.is_active) return false;
    if (p.starts_on && ymd < p.starts_on) return false;
    if (p.ends_on && ymd > p.ends_on) return false;
    if (p.days_of_week && p.days_of_week.length > 0 && !p.days_of_week.includes(dow)) return false;
    if (p.start_time && hhmm < p.start_time) return false;
    if (p.end_time && hhmm > p.end_time) return false;
    return true;
  });
}

/** Display-side hook for the CFD page (no auth). */
export function usePublicCFDIdle(restaurantId: string | null | undefined) {
  const [settings, setSettings] = useState<CFDIdleSettings | null>(null);
  const [promos, setPromos] = useState<CFDPromo[]>([]);

  useEffect(() => {
    if (!restaurantId) return;
    let cancelled = false;
    void (async () => {
      const [{ data: s }, { data: p }] = await Promise.all([
        db.rpc("get_cfd_idle_settings" as any, { _restaurant_id: restaurantId }),
        db.rpc("get_cfd_promos" as any, { _restaurant_id: restaurantId }),
      ]);
      if (cancelled) return;
      const settingsRow = Array.isArray(s) ? s[0] : s;
      if (settingsRow) setSettings(settingsRow as unknown as CFDIdleSettings);
      setPromos((Array.isArray(p) ? p : p ? [p] : []) as unknown as CFDPromo[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  return { settings, promos };
}