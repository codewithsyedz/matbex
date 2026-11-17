import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNowStrict } from "date-fns";
import { CheckCircle2, LifeBuoy, Loader2, MessageSquare, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/integrations/db/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { HELP_CATEGORIES, HelpRequestDialog, callSupport, type HelpCategory } from "@/components/support/HelpRequestDialog";

interface Req {
  id: string; number: number; subject: string; category: HelpCategory; status: "open" | "waiting_on_customer" | "resolved";
  user_name: string | null; created_at: string; last_message_at: string; last_message_by: "customer" | "support";
}
interface Msg { id: string; author_kind: "customer" | "support"; author_name: string | null; body: string; created_at: string }

const STATUS: Record<Req["status"], { label: string; variant: "default" | "secondary" | "outline" }> = {
  open: { label: "Waiting for Matbex", variant: "secondary" },
  waiting_on_customer: { label: "Replied", variant: "default" },
  resolved: { label: "Solved", variant: "outline" },
};

/** Help & support: the business's help requests (own requests; owners see all) and their threads. */
export default function Support() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [newOpen, setNewOpen] = useState(false);
  const selected = params.get("request");

  const list = useQuery({
    queryKey: ["support-requests"],
    queryFn: async () => {
      const { data, error } = await db.from("support_requests")
        .select("id, number, subject, category, status, user_name, created_at, last_message_at, last_message_by")
        .order("last_message_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data ?? []) as Req[];
    },
  });
  useEffect(() => {
    if (!selected && list.data?.length && window.matchMedia("(min-width: 1024px)").matches) setParams({ request: list.data[0].id }, { replace: true });
  }, [list.data, selected, setParams]);

  const current = list.data?.find((r) => r.id === selected) ?? null;

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Help &amp; support</h1>
          <p className="text-sm text-muted-foreground">Your questions to the Matbex team and our replies. We also reply by email.</p>
        </div>
        <Button onClick={() => setNewOpen(true)}><Plus className="h-4 w-4 mr-2" />New request</Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card className="border-border/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Your requests</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {list.isLoading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : !list.data?.length ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
                <LifeBuoy className="h-6 w-6" />No requests yet. Use “New request” or the life-ring button at the top of any page.
              </div>
            ) : list.data.map((r) => (
              <button key={r.id} type="button" onClick={() => setParams({ request: r.id })}
                className={`w-full rounded-md border p-3 text-start transition-colors hover:bg-muted/50 ${r.id === selected ? "border-primary bg-primary/5" : "border-border/60"}`}>
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{r.subject}</span>
                  <Badge variant={STATUS[r.status].variant} className="shrink-0">{STATUS[r.status].label}</Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  #{r.number} · {HELP_CATEGORIES[r.category]}{r.user_name ? ` · ${r.user_name}` : ""} · {formatDistanceToNowStrict(new Date(r.last_message_at))} ago
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        {current ? <Thread key={current.id} request={current} onChange={() => void qc.invalidateQueries({ queryKey: ["support-requests"] })} /> : (
          <Card className="hidden border-border/40 lg:block">
            <CardContent className="flex h-full flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <MessageSquare className="h-6 w-6" />Choose a request to see the conversation.
            </CardContent>
          </Card>
        )}
      </div>
      <HelpRequestDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}

function Thread({ request: r, onChange }: { request: Req; onChange: () => void }) {
  const qc = useQueryClient();
  const [reply, setReply] = useState("");
  const msgs = useQuery({
    queryKey: ["support-messages", r.id],
    queryFn: async () => {
      const { data, error } = await db.from("support_messages").select("id, author_kind, author_name, body, created_at").eq("request_id", r.id).order("created_at");
      if (error) throw error;
      return (data ?? []) as Msg[];
    },
  });
  const send = useMutation({
    mutationFn: () => callSupport({ action: "reply", request_id: r.id, body: reply.trim() }),
    onSuccess: () => { setReply(""); void qc.invalidateQueries({ queryKey: ["support-messages", r.id] }); onChange(); toast.success("Reply sent"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const solve = useMutation({
    mutationFn: () => callSupport({ action: "resolve", request_id: r.id }),
    onSuccess: () => { onChange(); toast.success("Marked as solved"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="border-border/40">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0 pb-3">
        <div className="min-w-0">
          <CardTitle className="text-base font-medium">{r.subject}</CardTitle>
          <CardDescription>#{r.number} · {HELP_CATEGORIES[r.category]} · opened {format(new Date(r.created_at), "d MMM yyyy, HH:mm")}</CardDescription>
        </div>
        {r.status !== "resolved" && (
          <Button size="sm" variant="outline" onClick={() => solve.mutate()} disabled={solve.isPending}>
            <CheckCircle2 className="h-4 w-4 mr-1" />Mark as solved
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          {msgs.isLoading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : (msgs.data ?? []).map((m) => (
            <div key={m.id} className={`max-w-[90%] rounded-lg px-3 py-2 text-sm ${m.author_kind === "support" ? "bg-primary/10" : "ms-auto bg-muted"}`}>
              <div className="mb-0.5 text-xs text-muted-foreground">
                {m.author_kind === "support" ? "Matbex support" : (m.author_name ?? "You")} · {format(new Date(m.created_at), "d MMM, HH:mm")}
              </div>
              <div className="whitespace-pre-wrap break-words">{m.body}</div>
            </div>
          ))}
        </div>
        <div className="space-y-2 border-t pt-3">
          <Textarea rows={3} maxLength={5000} value={reply} onChange={(e) => setReply(e.target.value)}
            placeholder={r.status === "resolved" ? "Reply to reopen this request…" : "Write a reply…"} />
          <div className="flex justify-end">
            <Button size="sm" onClick={() => send.mutate()} disabled={!reply.trim() || send.isPending}>
              {send.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}Send reply
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
