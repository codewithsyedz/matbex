import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { format } from "date-fns";
import { History, Landmark, Receipt } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  diffAuditEvent,
  describeCorrection,
  GROUP_LABEL,
  type AuditFieldGroup,
} from "@/lib/installmentAuditDiff";

interface AuditEvent {
  id: string;
  entity_type: string;
  action: string;
  summary: string | null;
  actor_id: string | null;
  created_at: string;
  asset_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
}

function useInstallmentAudit(planId?: string | null, enabled = true) {
  return useQuery({
    queryKey: ["installment-audit", planId],
    enabled: !!planId && enabled,
    queryFn: async () => {
      const { data, error } = await db
        .from("installment_audit_events")
        .select(
          "id, entity_type, action, summary, actor_id, created_at, asset_id, old_data, new_data",
        )
        .eq("plan_id", planId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const events = (data ?? []) as AuditEvent[];

      const actorIds = Array.from(
        new Set(events.map((e) => e.actor_id).filter(Boolean) as string[]),
      );
      let names: Record<string, string> = {};
      if (actorIds.length) {
        const { data: profiles } = await db
          .from("profiles")
          .select("id, full_name")
          .in("id", actorIds);
        names = Object.fromEntries(
          (profiles ?? []).map((p: any) => [p.id, p.full_name ?? "Unknown user"]),
        );
      }
      return events.map((e) => ({
        ...e,
        actorName: e.actor_id ? names[e.actor_id] ?? "Unknown user" : "System",
      }));
    },
  });
}

const ACTION_LABEL: Record<string, string> = {
  plan_created: "Purchase created",
  plan_updated: "Purchase updated",
  plan_rescheduled: "Schedule changed",
  plan_status_changed: "Status changed",
  invoice_updated: "Invoice attachment",
  asset_linked: "Asset linked",
  asset_class_updated: "Asset class changed",
  asset_registered: "Fixed asset registered",
  asset_updated: "Fixed asset updated",
  asset_status_changed: "Asset status changed",
  asset_depreciated: "Depreciation posted",
};

const GROUP_STYLE: Record<AuditFieldGroup, string> = {
  vat: "border-amber-500/40 text-amber-600 dark:text-amber-400",
  finance: "border-primary/40 text-primary",
  asset: "border-sky-500/40 text-sky-600 dark:text-sky-400",
  schedule: "border-muted-foreground/40 text-muted-foreground",
  other: "border-muted-foreground/30 text-muted-foreground",
};

function ChangedFields({ event }: { event: AuditEvent }) {
  const changes = diffAuditEvent(event.entity_type, event.old_data, event.new_data);
  if (!changes.length) return null;
  const reason = describeCorrection(changes);

  return (
    <div className="mt-1.5 space-y-1.5">
      {reason && (
        <p className="text-xs font-medium text-amber-600 dark:text-amber-400">{reason}</p>
      )}
      <ul className="space-y-1 rounded-md border bg-muted/30 p-2">
        {changes.map((c) => (
          <li key={c.field} className="flex flex-wrap items-center gap-1.5 text-xs">
            <Badge
              variant="outline"
              className={`text-[10px] ${GROUP_STYLE[c.group]}`}
            >
              {GROUP_LABEL[c.group]}
            </Badge>
            <span className="font-medium">{c.label}</span>
            <span className="text-muted-foreground line-through">{c.from}</span>
            <span className="text-muted-foreground">→</span>
            <span className="font-medium">{c.to}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function InstallmentAuditTrailDialog({
  planId,
  title,
  open,
  onOpenChange,
}: {
  planId: string | null;
  title?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: events, isLoading } = useInstallmentAudit(planId, open);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Audit trail</DialogTitle>
          <DialogDescription>
            Every change to {title ?? "this installment purchase"} and its fixed asset
            registration, with timestamp and user.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-3">
          {isLoading && <p className="text-sm text-muted-foreground">Loading history…</p>}
          {!isLoading && (events?.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">
              No audit events recorded for this purchase yet.
            </p>
          )}
          <ol className="relative space-y-4 border-l pl-5">
            {events?.map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -left-[27px] top-1 flex h-4 w-4 items-center justify-center rounded-full bg-muted">
                  {e.entity_type === "fixed_asset" ? (
                    <Landmark className="h-2.5 w-2.5" />
                  ) : (
                    <Receipt className="h-2.5 w-2.5" />
                  )}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">
                    {ACTION_LABEL[e.action] ?? e.action}
                  </span>
                  <Badge variant="outline" className="text-[10px] capitalize">
                    {e.entity_type === "fixed_asset" ? "Fixed asset" : "Installment plan"}
                  </Badge>
                </div>
                {e.summary && (
                  <p className="text-sm text-muted-foreground">{e.summary}</p>
                )}
                <ChangedFields event={e} />
                <p className="text-xs text-muted-foreground">
                  {format(new Date(e.created_at), "dd MMM yyyy, HH:mm")} · {e.actorName}
                </p>
              </li>
            ))}
          </ol>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

export function InstallmentAuditTrailButton({
  planId,
  title,
  onOpen,
}: {
  planId: string;
  title?: string;
  onOpen: () => void;
}) {
  return (
    <Button size="sm" variant="ghost" className="mt-1" onClick={onOpen}>
      <History className="h-3.5 w-3.5 mr-1" />
      Audit trail
    </Button>
  );
}
