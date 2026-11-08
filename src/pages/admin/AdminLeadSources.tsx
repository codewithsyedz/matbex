import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { sourceLabel } from "@/lib/leadAttribution";

type Row = {
  id: string; lead_type: string; email: string | null; created_at: string;
  lead_ref: string | null;
  utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; utm_content: string | null;
  gclid: string | null; fbclid: string | null; referrer: string | null; landing_path: string | null;
  ad_consent: string | null; country: string | null;
};

const TYPE_LABEL: Record<string, string> = { trial: "Free trial sign-up", signup: "Sign-up", demo: "Demo booking", enquiry: "Enquiry" };

export default function AdminLeadSources() {
  const [from, setFrom] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));

  const q = useQuery({
    queryKey: ["admin-lead-sources", from, to],
    queryFn: async () => {
      const { data, error } = await supabase.from("lead_attributions")
        .select("id, lead_type, lead_ref, email, created_at, utm_source, utm_medium, utm_campaign, utm_content, gclid, fbclid, referrer, landing_path, ad_consent, country")
        .gte("created_at", `${from}T00:00:00`).lte("created_at", `${to}T23:59:59`)
        .order("created_at", { ascending: false }).limit(1000);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const bookings = useQuery({
    queryKey: ["admin-lead-bookings", q.data?.map((r) => r.id)],
    enabled: !!q.data?.length,
    queryFn: async () => {
      const ids = (q.data ?? []).filter((r) => r.lead_type === "demo" && r.lead_ref).map((r) => r.lead_ref as string);
      if (!ids.length) return [];
      const { data, error } = await supabase.from("contact_messages")
        .select("id,name,company,phone,preferred_date,preferred_slot,status").in("id", ids);
      if (error) throw error;
      return data ?? [];
    },
  });
  const bookingById = new Map((bookings.data ?? []).map((b) => [b.id, b]));

  const grouped = useMemo(() => {
    const m = new Map<string, { source: string; campaign: string; trial: number; demo: number; enquiry: number; total: number }>();
    for (const r of q.data ?? []) {
      const source = sourceLabel(r);
      const campaign = r.utm_campaign ?? "—";
      const k = `${source}|${campaign}`;
      const g = m.get(k) ?? { source, campaign, trial: 0, demo: 0, enquiry: 0, total: 0 };
      if (r.lead_type === "trial" || r.lead_type === "signup") g.trial++;
      else if (r.lead_type === "demo") g.demo++;
      else g.enquiry++;
      g.total++;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [q.data]);

  return (
    <div className="container mx-auto max-w-6xl space-y-5 p-4 md:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold"><Target className="h-6 w-6 text-primary" />Lead sources</h1>
          <p className="text-sm text-muted-foreground">Which ad, campaign or website brought each free-trial sign-up and demo booking.</p>
        </div>
        <div className="flex gap-2">
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-9 w-[150px]" />
          <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="h-9 w-[150px]" />
        </div>
      </header>

      <Card className="overflow-hidden">
        <CardHeader className="border-b py-4"><CardTitle className="text-base">By source and campaign</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Source</TableHead><TableHead>Campaign</TableHead><TableHead className="text-end">Trial sign-ups</TableHead><TableHead className="text-end">Demo bookings</TableHead><TableHead className="text-end">Enquiries</TableHead><TableHead className="text-end">Total</TableHead></TableRow></TableHeader>
            <TableBody>
              {grouped.length === 0 ? <TableRow><TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">{q.isLoading ? "Loading…" : q.error ? "Could not load leads." : "No leads in this period yet."}</TableCell></TableRow>
                : grouped.map((g) => (
                  <TableRow key={`${g.source}|${g.campaign}`}>
                    <TableCell className="font-medium">{g.source}</TableCell><TableCell>{g.campaign}</TableCell>
                    <TableCell className="text-end tabular-nums">{g.trial}</TableCell><TableCell className="text-end tabular-nums">{g.demo}</TableCell>
                    <TableCell className="text-end tabular-nums">{g.enquiry}</TableCell><TableCell className="text-end font-semibold tabular-nums">{g.total}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="border-b py-4"><CardTitle className="text-base">Every lead <Badge variant="outline" className="ms-1">{q.data?.length ?? 0}</Badge></CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[900px]">
            <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Type</TableHead><TableHead>Email</TableHead><TableHead>Demo request · Riyadh time</TableHead><TableHead>Source</TableHead><TableHead>Campaign / ad</TableHead><TableHead>First page</TableHead><TableHead>Country</TableHead></TableRow></TableHeader>
            <TableBody>
              {(q.data ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap font-mono text-xs">{format(new Date(r.created_at), "d MMM yyyy HH:mm")}</TableCell>
                  <TableCell className="text-sm">{TYPE_LABEL[r.lead_type] ?? r.lead_type}</TableCell>
                  <TableCell className="text-sm">{r.email ?? "—"}</TableCell>
                  <TableCell className="min-w-[220px] text-xs">{(() => {
                    const b = r.lead_ref ? bookingById.get(r.lead_ref) : undefined;
                    return b ? <div className="space-y-1"><div className="font-medium">{b.name} · {b.company}</div><div>{b.preferred_date} · {b.preferred_slot}</div><div className="text-muted-foreground">{b.phone || "—"} · {b.status}</div><a className="text-primary underline" href="/admin/enquiries">Open enquiries</a></div> : r.lead_type === "demo" ? bookings.error ? "Booking details unavailable" : "—" : "—";
                  })()}</TableCell>
                  <TableCell className="text-sm">{sourceLabel(r)}</TableCell>
                  <TableCell className="text-xs">{[r.utm_campaign, r.utm_content].filter(Boolean).join(" · ") || "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{r.landing_path ?? "—"}</TableCell>
                  <TableCell className="text-xs">{r.country ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
