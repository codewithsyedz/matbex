import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";

export type ChannelKey = "direct" | "hungerstation" | "jahez" | "mrsool" | "talabat" | "qr" | "waiter";

export interface ChannelRow {
  channel: ChannelKey;
  gross: number;
  commission: number;
  net: number;
  orders: number;
  aov: number;
  margin_pct: number;
}

/** One platform's reconciled payouts on one day (v_channel_profitability, from the ledger). */
interface RawRow {
  tenant_id: string;
  channel: string;
  transaction_date: string;
  gross: number | null;
  commission: number | null;
  net: number | null;
}

export function useChannelProfitability(from: Date, to: Date) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;

  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["channel-pnl", tenantId, fromStr, toStr],
    enabled: !!tenantId,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await db
        .from("v_channel_profitability" as never)
        .select("*")
        .eq("tenant_id", tenantId!)
        .gte("transaction_date", fromStr)
        .lte("transaction_date", toStr);
      if (error) throw error;
      return (data ?? []) as unknown as RawRow[];
    },
  });

  // Order-count from online_orders aligned to same range (for AOV)
  const { data: orderCounts = {} } = useQuery({
    queryKey: ["channel-pnl-counts", tenantId, fromStr, toStr],
    enabled: !!tenantId,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await db
        .from("online_orders")
        .select("channel, payment_status, created_at")
        .eq("payment_status", "paid")
        .gte("created_at", from.toISOString())
        .lte("created_at", to.toISOString());
      if (error) throw error;
      const out: Record<string, number> = {};
      (data ?? []).forEach((r: { channel: string | null }) => {
        const k = r.channel ?? "direct";
        out[k] = (out[k] ?? 0) + 1;
      });
      return out;
    },
  });

  const channels = useMemo(() => {
    const byChannel = new Map<string, ChannelRow>();
    for (const r of rows) {
      const c = (r.channel || "direct") as ChannelKey;
      const cur = byChannel.get(c) ?? {
        channel: c, gross: 0, commission: 0, net: 0, orders: 0, aov: 0, margin_pct: 0,
      };
      cur.gross += Number(r.gross ?? 0);
      cur.commission += Number(r.commission ?? 0);
      cur.net += Number(r.net ?? 0);
      byChannel.set(c, cur);
    }
    const out = Array.from(byChannel.values()).map((r) => {
      r.orders = orderCounts[r.channel] ?? 0;
      r.aov = r.orders ? r.gross / r.orders : 0;
      r.margin_pct = r.gross > 0 ? ((r.net) / r.gross) * 100 : 0;
      return r;
    });
    return out.sort((a, b) => b.net - a.net);
  }, [rows, orderCounts]);

  const totals = useMemo(() => {
    return channels.reduce(
      (acc, r) => {
        acc.gross += r.gross;
        acc.commission += r.commission;
        acc.net += r.net;
        acc.orders += r.orders;
        return acc;
      },
      { gross: 0, commission: 0, net: 0, orders: 0 }
    );
  }, [channels]);

  return { channels, totals, isLoading };
}