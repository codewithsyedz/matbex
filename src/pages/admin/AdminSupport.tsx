import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNowStrict } from "date-fns";
import { AlertTriangle, CheckCircle2, Eye, Inbox, Loader2, Lock, Send, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ViewAsTenantDialog } from "@/components/admin/ViewAsTenantDialog";
import { callAdminSupport } from "@/lib/admin/supportAccess";
import { planLabel } from "@/lib/billing/planLabel";

type Status = "open" | "waiting_on_customer" | "resolved";
interface ListRow {
  id: string; number: number; tenant_id: string; tenant_name: string; user_name: string | null; user_email: string | null;
  category: string; subject: string; status: Status; priority: "normal" | "high" | "urgent"; assigned_to: string | null;
  last_message_at: string; last_message_by: "customer" | "support"; created_at: string; page_path: string | null; error_count: number;
}
interface Detail {
  request: ListRow & { page_title: string | null; user_agent: string | null; viewport: string | null; app_version: string | null; branch_id: string | null;
    recent_errors: { occurred_at: string; route: string | null; error_name: string | null; error_message: string | null; release: string | null }[] };
  tenant: { id: string; name: string; status: string | null; plan: string | null };
  messages: { id: string; author_kind: "customer" | "support"; author_name: string | null; body: string; internal: boolean; created_at: string }[];
  others: { id: string; number: number; subject: string; status: Status; created_at: string }[];
  access: { id: string; actor_name: string | null; reason: string; started_at: string; ended_at: string | null }[];
}

const STATUS: Record<Status, string> = { open: "Needs reply", waiting_on_customer: "Waiting on customer", resolved: "Solved" };
const CATEGORY: Record<string, string> = { question: "Question", problem: "Problem", billing: "Billing", feature: "Feature request", other: "Other" };

export default function AdminSupport() {
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<Status | "all">("open");
  const selected = params.get("request");
  const list = useQuery({
    queryKey: ["admin-support", status],
    queryFn: () => callAdminSupport<{ requests: ListRow[]; counts: Record<Status, number> }>({ action: "list", status }),
    refetchInterval: 60_000,
  });

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Support</h1>
        <p>Help requests sent from inside the app, with the page and errors the user saw.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["open", "waiting_on_customer", "resolved", "all"] as const).map((s) => (
          <Button key={s} size="sm" variant={status === s ? "default" : "outline"} onClick={() => setStatus(s)}>
            {s === "all" ? "All" : STATUS[s]}
            {s !== "all" && list.data && <span className="ms-1.5 tabular-nums opacity-80">{list.data.counts[s]}</span>}
          </Button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card className="border-border/40">
          <CardHeader className="pb-3"><CardTitle className="text-base font-medium">Requests</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {list.isLoading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : list.error ? (
              <p className="text-sm text-destructive">{(list.error as Error).message}</p>
            ) : !list.data?.requests.length ? (
              <div className="flex flex-col items-center gap-2 py-8 text-sm text-muted-foreground"><Inbox className="h-6 w-6" />Nothing here.</div>
            ) : list.data.requests.map((r) => (
              <button key={r.id} type="button" onClick={() => setParams({ request: r.id })}
                className={`w-full rounded-md border p-3 text-start transition-colors hover:bg-muted/50 ${r.id === selected ? "border-primary bg-primary/5" : "border-border/60"}`}>
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{r.subject}</span>
                  {r.priority !== "normal" && <Badge variant="destructive" className="shrink-0 capitalize">{r.priority}</Badge>}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  #{r.number} · {r.tenant_name} · {CATEGORY[r.category] ?? r.category}
                  {r.error_count ? ` · ${r.error_count} error${r.error_count > 1 ? "s" : ""}` : ""}
                  {" · "}{r.last_message_by === "customer" ? "customer" : "we"} wrote {formatDistanceToNowStrict(new Date(r.last_message_at))} ago
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
        {selected ? <RequestDetail key={selected} id={selected} /> : (
          <Card className="hidden border-border/40 lg:block">
            <CardContent className="py-16 text-center text-sm text-muted-foreground">Choose a request.</CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function RequestDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const [resolve, setResolve] = useState(false);
  const [viewAs, setViewAs] = useState(false);
  const d = useQuery({ queryKey: ["admin-support-request", id], queryFn: () => callAdminSupport<Detail>({ action: "get", request_id: id }) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["admin-support-request", id] }); void qc.invalidateQueries({ queryKey: ["admin-support"] }); };

  const send = useMutation({
    mutationFn: () => callAdminSupport({ action: "reply", request_id: id, body: reply.trim(), internal, resolve: !internal && resolve }),
    onSuccess: () => { setReply(""); setResolve(false); refresh(); toast.success(internal ? "Note added" : "Reply sent to the customer"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const set = useMutation({
    mutationFn: (patch: Record<string, unknown>) => callAdminSupport({ action: "set", request_id: id, ...patch }),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  if (d.isLoading) return <Card className="border-border/40"><CardContent className="p-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>;
  if (d.error || !d.data) return <Card className="border-border/40"><CardContent className="p-6 text-sm text-destructive">{(d.error as Error)?.message ?? "Not found"}</CardContent></Card>;
  const { request: r, tenant, messages, others, access } = d.data;

  return (
    <Card className="border-border/40">
      <CardHeader className="space-y-3 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base font-medium">{r.subject}</CardTitle>
            <CardDescription>
              #{r.number} · <Link to={`/admin/tenants/${tenant.id}`} className="hover:underline">{tenant.name}</Link> ({planLabel(tenant.plan)})
              {" · "}{r.user_name ?? r.user_email}{r.user_email && r.user_name ? ` <${r.user_email}>` : ""} · {format(new Date(r.created_at), "d MMM yyyy, HH:mm")}
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => setViewAs(true)}><Eye className="h-4 w-4 mr-1" />View as business</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={r.status} onValueChange={(v) => set.mutate({ status: v })}>
            <SelectTrigger className="h-8 w-48"><SelectValue /></SelectTrigger>
            <SelectContent>{(Object.keys(STATUS) as Status[]).map((s) => <SelectItem key={s} value={s}>{STATUS[s]}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={r.priority} onValueChange={(v) => set.mutate({ priority: v })}>
            <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="normal">Normal</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="urgent">Urgent</SelectItem></SelectContent>
          </Select>
          {!r.assigned_to && <Button size="sm" variant="ghost" onClick={() => set.mutate({ assign_to_me: true })}><UserCheck className="h-4 w-4 mr-1" />Assign to me</Button>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          {messages.map((m) => (
            <div key={m.id} className={`max-w-[92%] rounded-lg px-3 py-2 text-sm ${m.internal ? "border border-dashed border-amber-500/50 bg-amber-500/10" : m.author_kind === "support" ? "ms-auto bg-primary/10" : "bg-muted"}`}>
              <div className="mb-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                {m.internal && <Lock className="h-3 w-3" />}{m.internal ? `Internal note · ${m.author_name ?? ""}` : m.author_kind === "support" ? "Matbex support" : (m.author_name ?? "Customer")}
                {" · "}{format(new Date(m.created_at), "d MMM, HH:mm")}
              </div>
              <div className="whitespace-pre-wrap break-words">{m.body}</div>
            </div>
          ))}
        </div>

        <div className="space-y-2 border-t pt-3">
          <Textarea rows={3} maxLength={5000} value={reply} onChange={(e) => setReply(e.target.value)}
            placeholder={internal ? "Internal note (the customer never sees it)…" : "Reply to the customer (emailed to them)…"} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2"><Checkbox checked={internal} onCheckedChange={(v) => setInternal(v === true)} />Internal note</label>
              {!internal && <label className="flex items-center gap-2"><Checkbox checked={resolve} onCheckedChange={(v) => setResolve(v === true)} />Mark as solved</label>}
            </div>
            <Button size="sm" onClick={() => send.mutate()} disabled={!reply.trim() || send.isPending}>
              {send.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : internal ? <Lock className="h-4 w-4 mr-1" /> : <Send className="h-4 w-4 mr-1" />}
              {internal ? "Add note" : resolve ? "Reply and solve" : "Send reply"}
            </Button>
          </div>
        </div>

        <div className="grid gap-3 border-t pt-3 text-sm md:grid-cols-2">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">What they were looking at</p>
            <p>{r.page_path ? <span className="font-mono text-xs break-all">{r.page_path}</span> : "—"}</p>
            {r.page_title && <p className="text-muted-foreground">{r.page_title}</p>}
            <p className="text-xs text-muted-foreground">{[r.viewport && `screen ${r.viewport}`, r.app_version && `release ${r.app_version}`].filter(Boolean).join(" · ")}</p>
            {r.user_agent && <p className="text-xs text-muted-foreground break-all">{r.user_agent}</p>}
          </div>
          <div className="space-y-1">
            <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><AlertTriangle className="h-3.5 w-3.5" />Errors in the hour before ({r.recent_errors.length})</p>
            {r.recent_errors.length === 0 ? <p className="text-muted-foreground">None recorded.</p> : (
              <ul className="space-y-1">
                {r.recent_errors.map((e, i) => (
                  <li key={i} className="rounded bg-muted/60 px-2 py-1 font-mono text-xs break-all">
                    {format(new Date(e.occurred_at), "HH:mm:ss")} {e.route ?? ""} — {e.error_name ?? "Error"}: {(e.error_message ?? "").slice(0, 160)}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {others.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Other requests from {tenant.name}</p>
              <ul className="space-y-0.5">{others.map((o) => <li key={o.id}>#{o.number} {o.subject} · <span className="text-muted-foreground">{STATUS[o.status]}</span></li>)}</ul>
            </div>
          )}
          {access.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Viewed as the business for this request</p>
              <ul className="space-y-0.5">{access.map((a) => <li key={a.id}>{a.actor_name} · {format(new Date(a.started_at), "d MMM, HH:mm")}{a.ended_at ? "" : " (open)"}</li>)}</ul>
            </div>
          )}
        </div>
        {r.status === "resolved" && <p className="flex items-center gap-1 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4" />Solved. A reply from the customer reopens it.</p>}
      </CardContent>
      <ViewAsTenantDialog tenant={{ id: tenant.id, name: tenant.name }} requestId={r.id} defaultReason={`Help request #${r.number}: ${r.subject}`.slice(0, 300)}
        open={viewAs} onOpenChange={setViewAs} />
    </Card>
  );
}
