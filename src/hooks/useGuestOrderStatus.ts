/**
 * The guest's QR order status (docs/plans/open-checks.md, 2b.3): the order placed from this
 * table is remembered for the browser tab, and its status is polled through guest_get_order
 * (needs the order's access token) until staff accept or reject it.
 */
import { useEffect, useState } from "react";
import { db } from "@/integrations/db/client";

export type PlacedOrder = { id: string; access_token: string };

export interface GuestOrderState {
  found: boolean;
  status?: "submitted" | "accepted" | "paid" | "cancelled";
  reject_reason?: string | null;
}

const placedKey = (code: string) => `guest-order:${code}`;

export function loadPlaced(code: string | undefined): PlacedOrder | null {
  if (!code) return null;
  try {
    const raw = sessionStorage.getItem(placedKey(code));
    return raw ? (JSON.parse(raw) as PlacedOrder) : null;
  } catch {
    return null;
  }
}

export function savePlaced(code: string | undefined, order: PlacedOrder | null) {
  if (!code) return;
  try {
    if (order) sessionStorage.setItem(placedKey(code), JSON.stringify(order));
    else sessionStorage.removeItem(placedKey(code));
  } catch {
    /* private mode: the status still shows until the page is reloaded */
  }
}

/** Polls the order's status (guest_get_order, needs the order's access token) until staff decide. */
export function useGuestOrderStatus(order: PlacedOrder | null, intervalMs = 10_000) {
  const [state, setState] = useState<GuestOrderState | null>(null);
  useEffect(() => {
    setState(null);
    if (!order) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const { data: res } = await db.rpc("guest_get_order", { p_id: order.id, p_token: order.access_token });
      if (stopped) return;
      const next = (res as unknown as GuestOrderState) ?? null;
      if (next) setState(next);
      if (!next || (next.found && next.status === "submitted")) timer = setTimeout(tick, intervalMs);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [order, intervalMs]);
  return state;
}
