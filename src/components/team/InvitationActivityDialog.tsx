import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import {
  Mail,
  RefreshCw,
  AlertCircle,
  XCircle,
  CheckCircle,
  Clock,
  Bell,
  Loader2,
} from "lucide-react";

type EventType =
  | "sent"
  | "resent"
  | "failed"
  | "cancelled"
  | "accepted"
  | "expired"
  | "reminded";

interface InvitationEvent {
  id: string;
  event_type: EventType;
  message: string | null;
  error_detail: string | null;
  actor_email: string | null;
  created_at: string;
  metadata: Record<string, any> | null;
}

const EVENT_META: Record<EventType, { label: string; icon: any; className: string }> = {
  sent:      { label: "Sent",      icon: Mail,        className: "bg-primary/10 text-primary border-primary/20" },
  resent:    { label: "Resent",    icon: RefreshCw,   className: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
  failed:    { label: "Failed",    icon: AlertCircle, className: "bg-destructive/10 text-destructive border-destructive/20" },
  cancelled: { label: "Cancelled", icon: XCircle,     className: "bg-muted text-muted-foreground border-muted" },
  accepted:  { label: "Accepted",  icon: CheckCircle, className: "bg-green-500/10 text-green-600 border-green-500/20" },
  expired:   { label: "Expired",   icon: Clock,       className: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20" },
  reminded:  { label: "Reminded",  icon: Bell,        className: "bg-indigo-500/10 text-indigo-600 border-indigo-500/20" },
};

interface Props {
  invitationId: string | null;
  email?: string;
  onClose: () => void;
}

export function InvitationActivityDialog({ invitationId, email, onClose }: Props) {
  const [events, setEvents] = useState<InvitationEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!invitationId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const { data, error } = await (supabase as any)
        .from("team_invitation_events")
        .select("id, event_type, message, error_detail, actor_email, created_at, metadata")
        .eq("invitation_id", invitationId)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (error) {
        console.error("Failed to load invitation events:", error);
        setEvents([]);
        setError(
          error.message?.toLowerCase().includes("permission") || error.code === "42501"
            ? "You don't have permission to view this invitation's activity."
            : "We couldn't load the activity log. Please check your connection and try again."
        );
      } else {
        setEvents(data || []);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [invitationId, reloadKey]);

  return (
    <Dialog open={!!invitationId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Invitation activity</DialogTitle>
          <DialogDescription>
            {email ? `Audit trail for ${email}` : "Audit trail for this invitation"}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-2">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Loading activity…
            </div>
          ) : error ? (
            <Alert variant="destructive" className="my-2">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Couldn't load activity</AlertTitle>
              <AlertDescription className="space-y-3">
                <p>{error}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setReloadKey((k) => k + 1)}
                >
                  <RefreshCw className="h-3.5 w-3.5 mr-2" />
                  Try again
                </Button>
              </AlertDescription>
            </Alert>
          ) : events.length === 0 ? (
            <div className="text-center py-10 text-sm text-muted-foreground">
              No activity recorded for this invitation yet.
            </div>
          ) : (
            <ol className="relative border-l border-border ml-3 space-y-5 py-2">
              {events.map((evt) => {
                const meta = EVENT_META[evt.event_type] ?? EVENT_META.sent;
                const Icon = meta.icon;
                return (
                  <li key={evt.id} className="ml-5">
                    <span className="absolute -left-[11px] flex h-5 w-5 items-center justify-center rounded-full bg-background border border-border">
                      <Icon className="h-3 w-3 text-muted-foreground" />
                    </span>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className={meta.className}>
                        {meta.label}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(evt.created_at), { addSuffix: true })}
                      </span>
                    </div>
                    {evt.message && (
                      <p className="text-sm text-foreground mt-1">{evt.message}</p>
                    )}
                    {evt.error_detail && (
                      <p className="text-xs text-destructive mt-1">{evt.error_detail}</p>
                    )}
                    {evt.actor_email && (
                      <p className="text-xs text-muted-foreground mt-1">
                        by {evt.actor_email}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}