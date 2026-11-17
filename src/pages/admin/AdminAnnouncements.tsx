import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, Megaphone, Pencil, Plus, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/integrations/db/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { AnnouncementBanner, type Announcement, type AnnouncementSeverity } from "@/components/layout/AnnouncementBanner";
import { planLabel } from "@/lib/billing/planLabel";

interface Row {
  id: string; title: string; body: string | null; severity: AnnouncementSeverity;
  audience: "all" | "trial" | "paying" | "plans"; plans: string[] | null;
  link_url: string | null; link_label: string | null;
  starts_at: string; ends_at: string | null; published: boolean; created_at: string;
}

const SEVERITY: Record<AnnouncementSeverity, string> = {
  info: "News", feature: "New feature", maintenance: "Planned maintenance", warning: "Action needed", critical: "Outage / urgent",
};
const AUDIENCE: Record<Row["audience"], string> = { all: "Everyone", trial: "Businesses on trial", paying: "Paying businesses", plans: "Selected plans" };

function state(r: Row): { label: string; variant: "default" | "secondary" | "outline" } {
  const now = Date.now();
  if (!r.published) return { label: "Draft", variant: "outline" };
  if (new Date(r.starts_at).getTime() > now) return { label: "Scheduled", variant: "secondary" };
  if (r.ends_at && new Date(r.ends_at).getTime() <= now) return { label: "Ended", variant: "outline" };
  return { label: "Live", variant: "default" };
}

/** datetime-local value for an ISO time, in the viewer's time zone. */
const toLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export default function AdminAnnouncements() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Row | "new" | null>(null);

  const list = useQuery({
    queryKey: ["admin-announcements"],
    queryFn: async () => {
      const [a, d] = await Promise.all([
        db.from("platform_announcements").select("*").order("created_at", { ascending: false }).limit(100),
        db.from("announcement_dismissals").select("announcement_id"),
      ]);
      if (a.error) throw a.error;
      const dismissed = new Map<string, number>();
      for (const x of d.data ?? []) dismissed.set(x.announcement_id, (dismissed.get(x.announcement_id) ?? 0) + 1);
      return { rows: (a.data ?? []) as Row[], dismissed };
    },
  });
  const plans = useQuery({
    queryKey: ["admin-announcement-plans"],
    queryFn: async () => (await db.from("plans").select("name").eq("is_active", true).order("price")).data?.map((p) => p.name) ?? [],
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["admin-announcements"] });
    void qc.invalidateQueries({ queryKey: ["active-announcements"] });
  };

  const end = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("platform_announcements").update({ ends_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Announcement ended"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("platform_announcements").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Announcement deleted"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Announcements</h1>
          <p>Banners shown at the top of the app: releases, planned maintenance, billing changes, outages.</p>
        </div>
        <Button onClick={() => setEditing("new")}><Plus className="h-4 w-4 mr-2" />New announcement</Button>
      </div>

      <Card className="border-border/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">All announcements</CardTitle>
          <CardDescription>Users can close a banner, except outages; closing hides it for that user only.</CardDescription>
        </CardHeader>
        <CardContent>
          {list.isLoading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : !list.data?.rows.length ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
              <Megaphone className="h-6 w-6" />No announcements yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Announcement</TableHead><TableHead>Type</TableHead><TableHead>Audience</TableHead>
                  <TableHead>Shown</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Closed by</TableHead><TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.rows.map((r) => {
                  const s = state(r);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="max-w-xs">
                        <div className="font-medium">{r.title}</div>
                        {r.body && <div className="truncate text-xs text-muted-foreground">{r.body}</div>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{SEVERITY[r.severity]}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.audience === "plans" ? (r.plans ?? []).map(planLabel).join(", ") : AUDIENCE[r.audience]}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {format(new Date(r.starts_at), "d MMM, HH:mm")} – {r.ends_at ? format(new Date(r.ends_at), "d MMM, HH:mm") : "until ended"}
                      </TableCell>
                      <TableCell><Badge variant={s.variant}>{s.label}</Badge></TableCell>
                      <TableCell className="text-right tabular-nums">{list.data.dismissed.get(r.id) ?? 0}</TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        <Button size="sm" variant="ghost" title="Edit" onClick={() => setEditing(r)}><Pencil className="h-4 w-4" /></Button>
                        {s.label === "Live" && (
                          <Button size="sm" variant="ghost" title="End now" disabled={end.isPending} onClick={() => end.mutate(r.id)}><Square className="h-4 w-4" /></Button>
                        )}
                        <Button size="sm" variant="ghost" title="Delete" disabled={remove.isPending}
                          onClick={() => { if (window.confirm(`Delete "${r.title}"?`)) remove.mutate(r.id); }}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AnnouncementDialog row={editing} plans={plans.data ?? []} onClose={() => setEditing(null)} onSaved={refresh} />
    </div>
  );
}

function AnnouncementDialog({ row, plans, onClose, onSaved }: { row: Row | "new" | null; plans: string[]; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [severity, setSeverity] = useState<AnnouncementSeverity>("info");
  const [audience, setAudience] = useState<Row["audience"]>("all");
  const [picked, setPicked] = useState<string[]>([]);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [published, setPublished] = useState(true);

  useEffect(() => {
    if (!row) return;
    const r = row === "new" ? null : row;
    setTitle(r?.title ?? ""); setBody(r?.body ?? ""); setSeverity(r?.severity ?? "info");
    setAudience(r?.audience ?? "all"); setPicked(r?.plans ?? []);
    setLinkUrl(r?.link_url ?? ""); setLinkLabel(r?.link_label ?? "");
    setStarts(toLocal(r?.starts_at ?? new Date().toISOString())); setEnds(toLocal(r?.ends_at ?? null));
    setPublished(r?.published ?? true);
  }, [row]);

  const linkOk = !linkUrl.trim() || /^(https:\/\/|\/)/.test(linkUrl.trim());
  const endsOk = !ends || !starts || new Date(ends) > new Date(starts);
  const valid = title.trim().length >= 3 && linkOk && endsOk && (audience !== "plans" || picked.length > 0);

  const save = useMutation({
    mutationFn: async () => {
      const values = {
        title: title.trim(), body: body.trim() || null, severity, audience,
        plans: audience === "plans" ? picked : null,
        link_url: linkUrl.trim() || null, link_label: linkUrl.trim() ? (linkLabel.trim() || null) : null,
        starts_at: starts ? new Date(starts).toISOString() : new Date().toISOString(),
        ends_at: ends ? new Date(ends).toISOString() : null,
        published,
      };
      const { data: auth } = await db.auth.getUser();
      const q = row && row !== "new"
        ? db.from("platform_announcements").update(values).eq("id", row.id)
        : db.from("platform_announcements").insert({ ...values, created_by: auth.user?.id ?? null });
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Announcement saved"); onClose(); onSaved(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const preview: Announcement = {
    id: "preview", title: title.trim() || "Your title", body: body.trim() || null, severity,
    link_url: linkUrl.trim() || null, link_label: linkLabel.trim() || null, starts_at: "", ends_at: null,
  };

  return (
    <Dialog open={!!row} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{row === "new" ? "New announcement" : "Edit announcement"}</DialogTitle>
          <DialogDescription>Shown as a banner at the top of every page for the chosen businesses.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="an-title">Title</Label>
            <Input id="an-title" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Planned maintenance on Friday 02:00–03:00" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="an-body">Details (optional)</Label>
            <Textarea id="an-body" rows={2} maxLength={600} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Type</Label>
            <Select value={severity} onValueChange={(v) => setSeverity(v as AnnouncementSeverity)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{(Object.keys(SEVERITY) as AnnouncementSeverity[]).map((k) => <SelectItem key={k} value={k}>{SEVERITY[k]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Show to</Label>
            <Select value={audience} onValueChange={(v) => setAudience(v as Row["audience"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{(Object.keys(AUDIENCE) as Row["audience"][]).map((k) => <SelectItem key={k} value={k}>{AUDIENCE[k]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {audience === "plans" && (
            <div className="flex flex-wrap gap-x-4 gap-y-2 sm:col-span-2">
              {plans.map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={picked.includes(p)} onCheckedChange={(v) => setPicked((cur) => (v === true ? [...cur, p] : cur.filter((x) => x !== p)))} />
                  {planLabel(p)}
                </label>
              ))}
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="an-link">Link (optional)</Label>
            <Input id="an-link" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="/billing or https://…" />
            {!linkOk && <p className="text-xs text-destructive">Use a path in the app (/billing) or an https:// address.</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="an-label">Link text</Label>
            <Input id="an-label" value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} placeholder="Learn more" disabled={!linkUrl.trim()} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="an-start">Show from</Label>
            <Input id="an-start" type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="an-end">Until (optional)</Label>
            <Input id="an-end" type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} />
            {!endsOk && <p className="text-xs text-destructive">Must be after the start.</p>}
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Switch checked={published} onCheckedChange={setPublished} />Published (off keeps it as a draft)
          </label>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Preview</p>
          <div className="overflow-hidden rounded-md border"><AnnouncementBanner items={[preview]} preview /></div>
        </div>
        <DialogFooter>
          <Button onClick={() => save.mutate()} disabled={!valid || save.isPending}>
            {save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
