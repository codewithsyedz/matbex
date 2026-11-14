import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { Clock, Inbox, MailCheck, TrendingUp } from "lucide-react";

type Row = {
  id: string;
  name: string;
  email: string;
  status: string | null;
  created_at: string;
  handled_at: string | null;
  source_path: string | null;
  referrer: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  device: string | null;
  language: string | null;
};

const RANGES = [
  { key: "7", label: "Last 7 days" },
  { key: "30", label: "Last 30 days" },
  { key: "90", label: "Last 90 days" },
] as const;

function sourceOf(r: Row) {
  if (r.utm_source) return r.utm_source;
  if (!r.referrer) return "Direct / bookmark";
  try {
    return new URL(r.referrer).hostname.replace(/^www\./, "");
  } catch {
    return r.referrer;
  }
}

function tally(rows: Row[], pick: (r: Row) => string | null) {
  const map = new Map<string, number>();
  for (const r of rows) {
    const key = pick(r);
    if (!key) continue;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function Bars({ data, total, empty }: { data: [string, number][]; total: number; empty: string }) {
  if (!data.length) return <p className="text-sm text-muted-foreground py-6">{empty}</p>;
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

function Stat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Inbox;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Icon className="h-4 w-4" />
          {label}
        </div>
        <div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function formatHours(h: number | null) {
  if (h === null) return "—";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} days`;
}

export default function AdminEnquiries() {
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("30");

  const since = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - Number(range));
    return d.toISOString();
  }, [range]);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["admin-enquiry-analytics", range],
    queryFn: async () => {
      const { data, error } = await db
        .from("contact_messages")
        .select(
          "id, name, email, status, created_at, handled_at, source_path, referrer, utm_source, utm_campaign, device, language",
        )
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  // Form funnel: how many visitors saw the form, started typing, and sent it.
  const { data: funnel } = useQuery({
    queryKey: ["admin-enquiry-funnel", range],
    queryFn: async () => {
      const { data, error } = await db
        .from("enquiry_form_events")
        .select("event, session_id")
        .gte("created_at", since)
        .limit(20000);
      if (error) throw error;
      const uniq = (event: string) =>
        new Set(
          (data ?? [])
            .filter((r) => r.event === event)
            .map((r) => r.session_id ?? Math.random().toString()),
        ).size;
      return { views: uniq("view"), starts: uniq("start"), submits: uniq("submit") };
    },
  });



  const total = rows.length;
  const replied = rows.filter((r) => r.handled_at);
  const waiting = rows.filter((r) => !r.handled_at);

  const responseHours = replied
    .map((r) => (new Date(r.handled_at!).getTime() - new Date(r.created_at).getTime()) / 3_600_000)
    .filter((h) => h >= 0)
    .sort((a, b) => a - b);
  const medianHours = responseHours.length
    ? responseHours[Math.floor(responseHours.length / 2)]
    : null;
  const within24 = responseHours.filter((h) => h <= 24).length;

  const oldestWaiting = waiting.length
    ? Math.max(
        ...waiting.map((r) => (Date.now() - new Date(r.created_at).getTime()) / 3_600_000),
      )
    : null;

  // Daily arrivals across the selected window.
  const days = Number(range);
  const buckets = useMemo(() => {
    const out: { day: string; count: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      out.push({ day: d.toISOString().slice(0, 10), count: 0 });
    }
    const index = new Map(out.map((b, i) => [b.day, i]));
    for (const r of rows) {
      const key = new Date(r.created_at).toISOString().slice(0, 10);
      const i = index.get(key);
      if (i !== undefined) out[i].count++;
    }
    return out;
  }, [rows, days]);
  const peak = Math.max(1, ...buckets.map((b) => b.count));

  const sources = tally(rows, sourceOf);
  const pages = tally(rows, (r) => r.source_path ?? "Unknown page");
  const devices = tally(rows, (r) => r.device ?? "unknown");

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Residency enquiries</h1>
          <p className="text-sm text-muted-foreground">
            How many enquiries arrive, where they come from, and how quickly they get a reply.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Tabs value={range} onValueChange={(v) => setRange(v as typeof range)}>
            <TabsList>
              {RANGES.map((r) => (
                <TabsTrigger key={r.key} value={r.key}>
                  {r.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Link
            to="/admin/contact-messages"
            className="text-sm font-medium text-primary hover:underline"
          >
            Open inbox
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              icon={Inbox}
              label="Enquiries received"
              value={String(total)}
              hint={`${(total / Math.max(1, days)).toFixed(1)} per day on average`}
            />
            <Stat
              icon={MailCheck}
              label="Replied"
              value={String(replied.length)}
              hint={`${waiting.length} still waiting`}
            />
            <Stat
              icon={Clock}
              label="Typical reply time"
              value={formatHours(medianHours)}
              hint={
                responseHours.length
                  ? `${Math.round((within24 / responseHours.length) * 100)}% answered within 24 h`
                  : "No replies logged yet"
              }
            />
            <Stat
              icon={TrendingUp}
              label="Longest wait"
              value={formatHours(oldestWaiting)}
              hint={oldestWaiting === null ? "Nothing outstanding" : "Oldest unanswered enquiry"}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Form conversion</CardTitle>
            </CardHeader>
            <CardContent>
              {!funnel || funnel.views === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  No form views recorded in this period yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {[
                    { label: "Saw the form", value: funnel.views },
                    { label: "Started filling it in", value: funnel.starts },
                    { label: "Sent an enquiry", value: funnel.submits },
                  ].map((step) => (
                    <div key={step.label} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span>{step.label}</span>
                        <span className="font-medium tabular-nums">
                          {step.value}
                          <span className="ml-2 text-muted-foreground">
                            {Math.round((step.value / Math.max(1, funnel.views)) * 100)}%
                          </span>
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{
                            width: `${Math.min(100, (step.value / Math.max(1, funnel.views)) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground pt-1">
                    {Math.round((funnel.submits / Math.max(1, funnel.views)) * 100)}% of visitors
                    who saw the form submitted an enquiry.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>



          <Card>
            <CardHeader>
              <CardTitle className="text-base">Enquiries per day</CardTitle>
            </CardHeader>
            <CardContent>
              {total === 0 ? (
                <p className="text-sm text-muted-foreground py-6">
                  No enquiries in this period yet.
                </p>
              ) : (
                <div className="flex items-end gap-[3px] h-40">
                  {buckets.map((b) => (
                    <div
                      key={b.day}
                      className="flex-1 min-w-[2px] rounded-t bg-primary/80 hover:bg-primary transition-colors"
                      style={{ height: `${(b.count / peak) * 100}%`, minHeight: 2 }}
                      title={`${b.day}: ${b.count} enquir${b.count === 1 ? "y" : "ies"}`}
                    />
                  ))}
                </div>
              )}
              <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                <span>{buckets[0]?.day}</span>
                <span>{buckets[buckets.length - 1]?.day}</span>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Where enquiries come from</CardTitle>
              </CardHeader>
              <CardContent>
                <Bars data={sources} total={total} empty="No sources recorded yet." />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Page they enquired from</CardTitle>
              </CardHeader>
              <CardContent>
                <Bars data={pages} total={total} empty="No pages recorded yet." />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle className="text-base">Latest enquiries</CardTitle>
              <div className="flex gap-2">
                {devices.map(([d, c]) => (
                  <Badge key={d} variant="secondary">
                    {d}: {c}
                  </Badge>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">Nothing here yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-muted-foreground">
                      <tr className="text-left">
                        <th className="py-2 pr-4 font-medium">Who</th>
                        <th className="py-2 pr-4 font-medium">Source</th>
                        <th className="py-2 pr-4 font-medium">Received</th>
                        <th className="py-2 font-medium">Replied</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 15).map((r) => (
                        <tr key={r.id} className="border-t border-border/60">
                          <td className="py-2 pr-4">
                            <div className="font-medium">{r.name}</div>
                            <div className="text-xs text-muted-foreground">{r.email}</div>
                          </td>
                          <td className="py-2 pr-4">{sourceOf(r)}</td>
                          <td className="py-2 pr-4 text-muted-foreground">
                            {new Date(r.created_at).toLocaleString()}
                          </td>
                          <td className="py-2">
                            {r.handled_at ? (
                              <span className="text-muted-foreground">
                                {formatHours(
                                  (new Date(r.handled_at).getTime() -
                                    new Date(r.created_at).getTime()) /
                                    3_600_000,
                                )}{" "}
                                later
                              </span>
                            ) : (
                              <Badge variant="outline">Waiting</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
