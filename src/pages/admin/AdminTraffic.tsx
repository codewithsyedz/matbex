import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart3, Globe, Smartphone, Users } from "lucide-react";

type Row = {
  path: string;
  referrer: string | null;
  device: string | null;
  session_id: string | null;
  created_at: string;
};

const RANGES = [
  { key: "7", label: "Last 7 days" },
  { key: "30", label: "Last 30 days" },
  { key: "90", label: "Last 90 days" },
] as const;

function tally(rows: Row[], pick: (r: Row) => string | null) {
  const map = new Map<string, number>();
  for (const r of rows) {
    const key = pick(r);
    if (!key) continue;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function Bars({
  data,
  total,
  empty,
}: {
  data: [string, number][];
  total: number;
  empty: string;
}) {
  if (!data.length) {
    return <p className="text-sm text-muted-foreground py-6">{empty}</p>;
  }
  return (
    <ul className="space-y-3">
      {data.slice(0, 12).map(([label, count]) => (
        <li key={label}>
          <div className="flex items-center justify-between gap-4 text-sm mb-1">
            <span className="truncate font-medium">{label}</span>
            <span className="tabular-nums text-muted-foreground">
              {count} · {total ? Math.round((count / total) * 100) : 0}%
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${total ? (count / total) * 100 : 0}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function AdminTraffic() {
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("30");

  const since = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - Number(range));
    return d.toISOString();
  }, [range]);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["admin-page-views", range],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("page_views")
        .select("path, referrer, device, session_id, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const total = rows.length;
  const visitors = new Set(rows.map((r) => r.session_id ?? "")).size;
  const pages = tally(rows, (r) => r.path);
  const sources = tally(rows, (r) => {
    if (!r.referrer) return "Direct / bookmark";
    try {
      return new URL(r.referrer).hostname.replace(/^www\./, "");
    } catch {
      return r.referrer;
    }
  });
  const devices = tally(rows, (r) => r.device ?? "unknown");
  const mobileShare = total
    ? Math.round(((devices.find(([d]) => d === "mobile")?.[1] ?? 0) / total) * 100)
    : 0;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Visitor traffic</h1>
          <p className="text-sm text-muted-foreground">
            Which public pages people land on, and where they came from.
          </p>
        </div>
        <Tabs value={range} onValueChange={(v) => setRange(v as typeof range)}>
          <TabsList>
            {RANGES.map((r) => (
              <TabsTrigger key={r.key} value={r.key}>
                {r.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { icon: BarChart3, label: "Page views", value: total },
          { icon: Users, label: "Visits", value: visitors },
          { icon: Smartphone, label: "On a phone", value: `${mobileShare}%` },
        ].map(({ icon: Icon, label, value }) => (
          <Card key={label}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <Icon className="h-4 w-4" />
                {label}
              </div>
              {isLoading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <p className="text-3xl font-light tabular-nums">{value}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top pages</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <Bars data={pages} total={total} empty="No visits recorded yet." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="h-4 w-4" /> Where they came from
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <Bars data={sources} total={total} empty="No sources recorded yet." />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        {devices.map(([label, count]) => (
          <Badge key={label} variant="secondary" className="capitalize">
            {label}: {count}
          </Badge>
        ))}
      </div>
    </div>
  );
}
