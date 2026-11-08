import { useCachedQuery } from "@/lib/redisCache";
import { dashboardQueryOptions } from "@/lib/query/queryPolicy";
import { qk } from "@/lib/query/queryKeys";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { supabase } from "@/integrations/supabase/client";
import { getRestaurantDayBoundsUTC } from "@/lib/timezone";
import { format } from "date-fns";
import { useDaypartSettings, getDaypartFor, type DaypartConfig, type DayPart as DPType } from "./useDaypartSettings";

export type DayPart = DPType;

export interface AnalyticsRow {
  id: string;
  total: number;
  created_at: string;
  hour: number; // 0-23 in restaurant TZ
  weekday: number; // 0=Sun
  ymd: string; // YYYY-MM-DD in restaurant TZ
  daypart: DayPart;
  isoWeek: string; // YYYY-Www
  yearMonth: string; // YYYY-MM
  payment_method: string;
}

export interface TopSeller {
  menu_item_id: string;
  name: string;
  qty: number;
  revenue: number;
}

export interface SalesAnalytics {
  rows: AnalyticsRow[];
  items: { transaction_id: string; menu_item_id: string; quantity: number; total_price: number }[];
  itemNameById: Record<string, string>;
  totals: {
    orders: number;
    revenue: number;
    avgTicket: number;
    days: number;
    avgOrdersPerDay: number;
    avgOrdersPerHour: number; // across operating hours observed
    peakHour: number | null;
    peakHourOrders: number;
    peakWeekday: number | null;
  };
  byHour: { hour: number; orders: number; revenue: number }[];
  byDaypart: { daypart: DayPart; orders: number; revenue: number }[];
  byWeekday: { weekday: number; label: string; orders: number; revenue: number }[];
  byWeek: { week: string; orders: number; revenue: number }[];
  byMonth: { month: string; orders: number; revenue: number }[];
  topOverall: TopSeller[];
  topByHour: Record<number, TopSeller[]>;
  topByWeek: Record<string, TopSeller[]>;
}

function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

/** ISO week label YYYY-Www computed in restaurant tz parts. */
function isoWeekLabel(d: Date): string {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (tmp.getUTCDay() + 6) % 7;
  tmp.setUTCDate(tmp.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((tmp.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${tmp.getUTCFullYear()}-W${pad(week)}`;
}

/** Get YYYY-MM-DD / hour / weekday in target TZ via Intl. */
function partsInTz(iso: string, tz: string) {
  const dt = new Date(iso);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  });
  const parts = fmt.formatToParts(dt).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== "literal") acc[p.type] = p.value;
    return acc;
  }, {});
  const hour = parseInt(parts.hour === "24" ? "0" : parts.hour, 10);
  const ymd = `${parts.year}-${parts.month}-${parts.day}`;
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = weekdayMap[parts.weekday] ?? 0;
  return { hour, ymd, weekday };
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function useSalesAnalytics(from: Date, to: Date) {
  const { restaurant } = useAuth();
  const { activeBranchId, pinnedBranchId } = useBranch();
  const branchId = pinnedBranchId ?? activeBranchId ?? null;
  const tz = restaurant?.timezone || "Asia/Riyadh";
  const restaurantId = restaurant?.id;
  const { config: daypartCfg } = useDaypartSettings();

  return useCachedQuery({
    queryKey: qk.salesTrends.entity("analytics", { restaurantId, branchId, extra: [tz, from.toISOString(), to.toISOString(), JSON.stringify(daypartCfg ?? null)] }),
    ...dashboardQueryOptions(),
    enabled: !!restaurantId,
    staleTime: 2 * 60 * 1000,
    queryFn: async (): Promise<SalesAnalytics> => {
      const startBounds = getRestaurantDayBoundsUTC(from, tz);
      const endBounds = getRestaurantDayBoundsUTC(to, tz);

      // 1) Transactions in window
      let txQuery = supabase
        .from("sales_transactions")
        .select("id, total, created_at, payment_method")
        .eq("restaurant_id", restaurantId!)
        .gte("created_at", startBounds.start.toISOString())
        .lt("created_at", endBounds.endExclusive.toISOString());
      if (branchId) txQuery = txQuery.eq("branch_id", branchId);
      const { data: txs, error: txErr } = await txQuery
        .order("created_at", { ascending: true })
        .limit(20000);
      if (txErr) throw txErr;

      const txList = txs ?? [];
      const txIds = txList.map((t) => t.id);

      // 2) Items for those transactions (chunk to keep URL short)
      let items: { transaction_id: string; menu_item_id: string; quantity: number; total_price: number }[] = [];
      const CHUNK = 200;
      for (let i = 0; i < txIds.length; i += CHUNK) {
        const slice = txIds.slice(i, i + CHUNK);
        if (!slice.length) break;
        const { data, error } = await supabase
          .from("sales_items")
          .select("transaction_id, menu_item_id, quantity, total_price")
          .in("transaction_id", slice);
        if (error) throw error;
        if (data) items = items.concat(data as any);
      }

      // 3) Menu item names
      const menuIds = Array.from(new Set(items.map((i) => i.menu_item_id)));
      const nameById = new Map<string, string>();
      if (menuIds.length) {
        const { data: mitems } = await supabase
          .from("menu_items")
          .select("id, name")
          .in("id", menuIds);
        (mitems ?? []).forEach((m: any) => nameById.set(m.id, m.name));
      }

      // Build analytics rows
      const rows: AnalyticsRow[] = txList.map((t) => {
        const { hour, ymd, weekday } = partsInTz(t.created_at as string, tz);
        const d = new Date(`${ymd}T00:00:00`);
        return {
          id: t.id as string,
          total: Number(t.total) || 0,
          created_at: t.created_at as string,
          hour, weekday, ymd,
          daypart: getDaypartFor(hour, daypartCfg),
          isoWeek: isoWeekLabel(d),
          yearMonth: ymd.slice(0, 7),
          payment_method: String(t.payment_method ?? "other"),
        };
      });

      const orders = rows.length;
      const revenue = rows.reduce((s, r) => s + r.total, 0);
      const dayKeys = new Set(rows.map((r) => r.ymd));
      const days = dayKeys.size || 1;

      // by hour
      const hourMap = new Map<number, { orders: number; revenue: number }>();
      for (let h = 0; h < 24; h++) hourMap.set(h, { orders: 0, revenue: 0 });
      rows.forEach((r) => {
        const slot = hourMap.get(r.hour)!;
        slot.orders++; slot.revenue += r.total;
      });
      const byHour = Array.from(hourMap.entries()).map(([hour, v]) => ({ hour, ...v }));
      const operatingHours = byHour.filter((b) => b.orders > 0).length || 1;

      let peakHour: number | null = null, peakHourOrders = 0;
      byHour.forEach((b) => { if (b.orders > peakHourOrders) { peakHourOrders = b.orders; peakHour = b.hour; } });

      // by daypart
      const dpMap = new Map<DayPart, { orders: number; revenue: number }>();
      (["Morning", "Noon", "Evening", "Late Night"] as DayPart[]).forEach((d) => dpMap.set(d, { orders: 0, revenue: 0 }));
      rows.forEach((r) => { const s = dpMap.get(r.daypart)!; s.orders++; s.revenue += r.total; });
      const byDaypart = Array.from(dpMap.entries()).map(([daypart, v]) => ({ daypart, ...v }));

      // by weekday
      const wdMap = new Map<number, { orders: number; revenue: number }>();
      for (let w = 0; w < 7; w++) wdMap.set(w, { orders: 0, revenue: 0 });
      rows.forEach((r) => { const s = wdMap.get(r.weekday)!; s.orders++; s.revenue += r.total; });
      const byWeekday = Array.from(wdMap.entries()).map(([weekday, v]) => ({ weekday, label: WEEKDAY_LABELS[weekday], ...v }));
      let peakWeekday: number | null = null; let peakWdOrders = 0;
      byWeekday.forEach((b) => { if (b.orders > peakWdOrders) { peakWdOrders = b.orders; peakWeekday = b.weekday; } });

      // by week
      const weekMap = new Map<string, { orders: number; revenue: number }>();
      rows.forEach((r) => {
        const s = weekMap.get(r.isoWeek) ?? { orders: 0, revenue: 0 };
        s.orders++; s.revenue += r.total; weekMap.set(r.isoWeek, s);
      });
      const byWeek = Array.from(weekMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([week, v]) => ({ week, ...v }));

      // by month
      const monthMap = new Map<string, { orders: number; revenue: number }>();
      rows.forEach((r) => {
        const s = monthMap.get(r.yearMonth) ?? { orders: 0, revenue: 0 };
        s.orders++; s.revenue += r.total; monthMap.set(r.yearMonth, s);
      });
      const byMonth = Array.from(monthMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([month, v]) => ({ month, ...v }));

      // Top sellers - need tx -> hour/week mapping
      const txMeta = new Map<string, AnalyticsRow>();
      rows.forEach((r) => txMeta.set(r.id, r));

      const accumulate = (map: Map<string, TopSeller>, key: string, qty: number, revenue: number) => {
        const cur = map.get(key) ?? { menu_item_id: key, name: nameById.get(key) ?? "Unknown", qty: 0, revenue: 0 };
        cur.qty += qty; cur.revenue += revenue;
        map.set(key, cur);
      };

      const overallMap = new Map<string, TopSeller>();
      const hourMaps = new Map<number, Map<string, TopSeller>>();
      const weekMaps = new Map<string, Map<string, TopSeller>>();

      items.forEach((it) => {
        const meta = txMeta.get(it.transaction_id);
        if (!meta) return;
        const qty = Number(it.quantity) || 0;
        const rev = Number(it.total_price) || 0;
        accumulate(overallMap, it.menu_item_id, qty, rev);
        if (!hourMaps.has(meta.hour)) hourMaps.set(meta.hour, new Map());
        accumulate(hourMaps.get(meta.hour)!, it.menu_item_id, qty, rev);
        if (!weekMaps.has(meta.isoWeek)) weekMaps.set(meta.isoWeek, new Map());
        accumulate(weekMaps.get(meta.isoWeek)!, it.menu_item_id, qty, rev);
      });

      const sortTop = (m: Map<string, TopSeller>, n = 10) =>
        Array.from(m.values()).sort((a, b) => b.qty - a.qty).slice(0, n);

      const topOverall = sortTop(overallMap, 15);
      const topByHour: Record<number, TopSeller[]> = {};
      hourMaps.forEach((v, k) => { topByHour[k] = sortTop(v, 5); });
      const topByWeek: Record<string, TopSeller[]> = {};
      weekMaps.forEach((v, k) => { topByWeek[k] = sortTop(v, 5); });

      return {
        rows,
        items,
        itemNameById: Object.fromEntries(nameById),
        totals: {
          orders,
          revenue,
          avgTicket: orders ? revenue / orders : 0,
          days,
          avgOrdersPerDay: orders / days,
          avgOrdersPerHour: orders / (days * operatingHours),
          peakHour,
          peakHourOrders,
          peakWeekday,
        },
        byHour, byDaypart, byWeekday, byWeek, byMonth,
        topOverall, topByHour, topByWeek,
      };
    },
  });
}

export const WEEKDAY_LABELS_EXPORT = WEEKDAY_LABELS;
export function formatHourLabel(h: number) {
  const suffix = h >= 12 ? "PM" : "AM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}${suffix}`;
}
export function rangeLabel(from: Date, to: Date) {
  return `${format(from, "MMM d")} – ${format(to, "MMM d, yyyy")}`;
}