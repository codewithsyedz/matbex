import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Mail, MailWarning, MailCheck, RefreshCw } from "lucide-react";

type Message = {
  id: string;
  name: string;
  email: string;
  message: string | null;
  kind: string | null;
  company: string | null;
  phone: string | null;
  preferred_date: string | null;
  preferred_slot: string | null;
  created_at: string;
};

type SendLog = {
  id: string;
  template_name: string;
  recipient_email: string;
  status: string;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "enquiry", label: "Enquiries" },
  { key: "demo", label: "Demo bookings" },
  { key: "problem", label: "Needs attention" },
] as const;

function StatusBadge({ status }: { status?: string }) {
  if (!status) {
    return <Badge variant="outline">No email recorded</Badge>;
  }
  if (status === "sent") {
    return (
      <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">
        <MailCheck className="h-3 w-3 mr-1" /> Sent
      </Badge>
    );
  }
  if (status === "suppressed") {
    return (
      <Badge variant="secondary">
        <MailWarning className="h-3 w-3 mr-1" /> Blocked
      </Badge>
    );
  }
  return (
    <Badge variant="destructive">
      <MailWarning className="h-3 w-3 mr-1" /> Failed
    </Badge>
  );
}

function formatWhen(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function AdminEmailInbox() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");

  const messagesQuery = useQuery({
    queryKey: ["admin-email-inbox", "messages"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contact_messages")
        .select(
          "id, name, email, message, kind, company, phone, preferred_date, preferred_slot, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Message[];
    },
  });

  const logsQuery = useQuery({
    queryKey: ["admin-email-inbox", "logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_send_log")
        .select("id, template_name, recipient_email, status, error_message, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as SendLog[];
    },
  });

  const loading = messagesQuery.isLoading || logsQuery.isLoading;

  const rows = useMemo(() => {
    const logs = logsQuery.data ?? [];
    const byContact = new Map<string, SendLog[]>();
    for (const log of logs) {
      const contactId = (log.metadata as { contact_id?: string } | null)?.contact_id;
      if (!contactId) continue;
      const list = byContact.get(contactId) ?? [];
      list.push(log);
      byContact.set(contactId, list);
    }

    return (messagesQuery.data ?? []).map((message) => {
      const related = byContact.get(message.id) ?? [];
      const team = related.find((l) => l.template_name.endsWith("notification"));
      const visitor = related.find((l) => l.template_name.endsWith("confirmation"));
      const problem =
        (team && team.status !== "sent") || (visitor && visitor.status !== "sent") || !team;
      return { message, team, visitor, problem };
    });
  }, [messagesQuery.data, logsQuery.data]);

  const visible = rows.filter(({ message, problem }) => {
    if (filter === "all") return true;
    if (filter === "problem") return problem;
    return (message.kind ?? "enquiry") === filter;
  });

  const stats = useMemo(() => {
    const total = rows.length;
    const delivered = rows.filter((r) => r.team?.status === "sent").length;
    const failed = rows.filter((r) => r.team && r.team.status !== "sent").length;
    const missing = rows.filter((r) => !r.team).length;
    return { total, delivered, failed, missing };
  }, [rows]);

  const refresh = () => {
    messagesQuery.refetch();
    logsQuery.refetch();
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Mail className="h-5 w-5" /> Email Inbox
          </h1>
          <p className="text-sm text-muted-foreground">
            Every enquiry and demo booking with the emails it triggered.
          </p>
        </div>
        <Button variant="outline" onClick={refresh} className="min-h-[44px]">
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Messages", value: stats.total },
          { label: "Team email sent", value: stats.delivered },
          { label: "Email failed", value: stats.failed },
          { label: "No email recorded", value: stats.missing },
        ].map((card) => (
          <Card key={card.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold tabular-nums">{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
        <TabsList>
          {FILTERS.map((f) => (
            <TabsTrigger key={f.key} value={f.key} className="min-h-[40px]">
              {f.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nothing here yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map(({ message, team, visitor }) => (
            <Card key={message.id}>
              <CardContent className="p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium truncate">{message.name}</span>
                      <Badge variant="outline">
                        {(message.kind ?? "enquiry") === "demo" ? "Demo booking" : "Enquiry"}
                      </Badge>
                    </div>
                    <a
                      className="text-sm text-primary hover:underline break-all"
                      href={`mailto:${message.email}`}
                    >
                      {message.email}
                    </a>
                    {message.company && (
                      <p className="text-sm text-muted-foreground">{message.company}</p>
                    )}
                    {message.preferred_date && (
                      <p className="text-sm text-muted-foreground">
                        Requested {message.preferred_date}
                        {message.preferred_slot ? ` · ${message.preferred_slot}` : ""}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatWhen(message.created_at)}
                  </span>
                </div>

                {message.message && (
                  <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                    {message.message}
                  </p>
                )}

                <div className="grid gap-2 sm:grid-cols-2 pt-1 border-t">
                  <div className="pt-2 space-y-1">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Team notification
                    </p>
                    <StatusBadge status={team?.status} />
                    {team?.error_message && (
                      <p className="text-xs text-destructive break-words">{team.error_message}</p>
                    )}
                  </div>
                  <div className="pt-2 space-y-1">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Visitor confirmation
                    </p>
                    <StatusBadge status={visitor?.status} />
                    {visitor?.error_message && (
                      <p className="text-xs text-destructive break-words">
                        {visitor.error_message}
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
