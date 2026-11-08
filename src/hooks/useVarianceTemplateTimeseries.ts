import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  startOfDay,
  startOfWeek,
  startOfMonth,
  addDays,
  addWeeks,
  addMonths,
  format,
  differenceInCalendarDays,
} from "date-fns";

export type Granularity = "day" | "week" | "month";

export interface TimeseriesBucket {
  bucketISO: string; // start of bucket
  label: string;
  total: number;
  short: number;
  over: number;
  zero: number;
}

export interface TemplateTimeseries {
  templateKey: string;
  buckets: TimeseriesBucket[];
  total: number;
  short: number;
  over: number;
}

export interface TimeseriesResult {
  granularity: Granularity;
  byTemplate: Record<string, TemplateTimeseries>;
}

function pickGranularity(fromISO: string, toISO: string): Granularity {
  const days = differenceInCalendarDays(new Date(toISO), new Date(fromISO));
  if (days <= 21) return "day";
  if (days <= 120) return "week";
  return "month";
}

function bucketStart(d: Date, g: Granularity): Date {
  if (g === "day") return startOfDay(d);
  if (g === "week") return startOfWeek(d, { weekStartsOn: 1 });
  return startOfMonth(d);
}

function bucketNext(d: Date, g: Granularity): Date {
  if (g === "day") return addDays(d, 1);
  if (g === "week") return addWeeks(d, 1);
  return addMonths(d, 1);
}

function bucketLabel(d: Date, g: Granularity): string {
  if (g === "day") return format(d, "MMM d");
  if (g === "week") return format(d, "MMM d");
  return format(d, "MMM yyyy");
}

export function useVarianceTemplateTimeseries({
  fromISO,
  toISO,
}: {
  fromISO: string;
  toISO: string;
}) {
  const { tenant, restaurant } = useAuth();

  return useQuery({
    queryKey: [
      "variance-template-timeseries",
      tenant?.id,
      restaurant?.id,
      fromISO,
      toISO,
    ],
    queryFn: async (): Promise<TimeseriesResult> => {
      if (!tenant?.id) return { granularity: "day", byTemplate: {} };
      const granularity = pickGranularity(fromISO, toISO);

      const { data, error } = await supabase
        .from("variance_template_usage_events")
        .select("template_key, variance_amount, used_at")
        .eq("tenant_id", tenant.id)
        .or(
          `restaurant_id.eq.${
            restaurant?.id ?? "00000000-0000-0000-0000-000000000000"
          },restaurant_id.is.null`
        )
        .gte("used_at", fromISO)
        .lte("used_at", toISO)
        .order("used_at", { ascending: true })
        .limit(5000);

      if (error) throw error;

      // Build empty bucket spine
      const start = bucketStart(new Date(fromISO), granularity);
      const end = new Date(toISO);
      const spine: { iso: string; label: string }[] = [];
      let cursor = start;
      while (cursor <= end) {
        spine.push({ iso: cursor.toISOString(), label: bucketLabel(cursor, granularity) });
        cursor = bucketNext(cursor, granularity);
      }

      const byTemplate: Record<string, TemplateTimeseries> = {};
      const ensure = (key: string): TemplateTimeseries => {
        if (!byTemplate[key]) {
          byTemplate[key] = {
            templateKey: key,
            buckets: spine.map((s) => ({
              bucketISO: s.iso,
              label: s.label,
              total: 0,
              short: 0,
              over: 0,
              zero: 0,
            })),
            total: 0,
            short: 0,
            over: 0,
          };
        }
        return byTemplate[key];
      };

      for (const row of data ?? []) {
        const key = row.template_key as string;
        const tseries = ensure(key);
        const used = new Date(row.used_at as string);
        const bStart = bucketStart(used, granularity);
        const bIso = bStart.toISOString();
        const bucket =
          tseries.buckets.find((b) => b.bucketISO === bIso) ??
          tseries.buckets[tseries.buckets.length - 1];
        if (!bucket) continue;
        const v = Number(row.variance_amount ?? 0);
        bucket.total += 1;
        tseries.total += 1;
        if (v < 0) {
          bucket.short += 1;
          tseries.short += 1;
        } else if (v > 0) {
          bucket.over += 1;
          tseries.over += 1;
        } else {
          bucket.zero += 1;
        }
      }

      return { granularity, byTemplate };
    },
    enabled: !!tenant?.id,
  });
}
