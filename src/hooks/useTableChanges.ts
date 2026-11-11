import { useEffect, useRef } from "react";
import { subscribeEvents, type EventTopic } from "@/integrations/db/events";

/** Payload of the generic row-change events (platform.trg_outbox_row_change). */
export interface RowChange {
  table: string;
  op: "insert" | "update" | "delete";
  id: string | null;
  branch_id?: string | null;
  [extra: string]: unknown;
}

/**
 * Run `onChange` when rows of `tables` change in this restaurant, via the event channel
 * (Socket.IO, transactional outbox). Events carry ids only, so `onChange` should refetch
 * (typically queryClient.invalidateQueries). Bursts (a sale writes its lines, the sale and a
 * cash event together) are merged into one call after `debounceMs`. After a reconnect, when
 * events may have been missed, `onChange` runs once too.
 *
 * `branchId`: ignore changes tagged with another branch (rows without a branch still count).
 */
export function useTableChanges(opts: {
  topic: EventTopic;
  restaurantId: string | null | undefined;
  tables: string[];
  onChange: (change: RowChange | null) => void;
  branchId?: string | null;
  filter?: (change: RowChange) => boolean;
  debounceMs?: number;
  enabled?: boolean;
}) {
  const { topic, restaurantId, branchId, enabled = true, debounceMs = 250 } = opts;
  const tablesKey = opts.tables.join(",");
  const latest = useRef(opts);
  latest.current = opts;

  useEffect(() => {
    if (!enabled || !restaurantId) return;
    const tables = new Set(tablesKey.split(","));
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last: RowChange | null = null;
    const fire = (change: RowChange | null) => {
      last = change;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        latest.current.onChange(last);
      }, debounceMs);
    };
    const unsubscribe = subscribeEvents(
      topic,
      restaurantId,
      (e) => {
        const change = e.payload as unknown as RowChange;
        if (!change?.table || !tables.has(change.table)) return;
        if (branchId && change.branch_id && change.branch_id !== branchId) return;
        if (latest.current.filter && !latest.current.filter(change)) return;
        fire(change);
      },
      () => fire(null),
    );
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [topic, restaurantId, branchId, tablesKey, enabled, debounceMs]);
}
