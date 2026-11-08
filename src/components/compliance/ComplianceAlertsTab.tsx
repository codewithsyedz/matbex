import { useMemo, useState } from "react";
import { BellRing, CheckCheck, Check, Clock, RotateCcw, Repeat2, ShieldCheck } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  COMPLIANCE_ALERT_KIND_LABELS,
  useComplianceAlerts,
  type ComplianceAlert,
  type ComplianceAlertKind,
  type ComplianceAlertSeverity,
} from "@/hooks/useComplianceAlerts";

const KIND_ICONS: Record<ComplianceAlertKind, typeof Clock> = {
  overdue_action: Clock,
  repeat_violation: Repeat2,
  approval_pending: ShieldCheck,
};

const SEVERITY_VARIANT: Record<ComplianceAlertSeverity, "destructive" | "secondary" | "outline"> = {
  critical: "destructive",
  high: "secondary",
  medium: "outline",
};

interface Props {
  onOpenViolation?: (violationId: string) => void;
  onOpenChecklists?: () => void;
}

export function ComplianceAlertsTab({ onOpenViolation, onOpenChecklists }: Props) {
  const { alerts, isLoading, acknowledge, acknowledgeMany, undoAcknowledge } = useComplianceAlerts();

  const [kind, setKind] = useState<ComplianceAlertKind | "all">("all");
  const [severity, setSeverity] = useState<ComplianceAlertSeverity | "all">("all");
  const [state, setState] = useState<"unread" | "acknowledged" | "all">("unread");
  const [search, setSearch] = useState("");
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const counts = useMemo(() => {
    const open = alerts.filter((a) => !a.ack);
    return {
      open: open.length,
      overdue: open.filter((a) => a.kind === "overdue_action").length,
      repeat: open.filter((a) => a.kind === "repeat_violation").length,
      approvals: open.filter((a) => a.kind === "approval_pending").length,
    };
  }, [alerts]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return alerts.filter((a) => {
      if (kind !== "all" && a.kind !== kind) return false;
      if (severity !== "all" && a.severity !== severity) return false;
      if (state === "unread" && a.ack) return false;
      if (state === "acknowledged" && !a.ack) return false;
      if (term) {
        const hay = `${a.title} ${a.description} ${a.branchName ?? ""}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [alerts, kind, severity, state, search]);

  const openInList = filtered.filter((a) => !a.ack);

  const handleOpen = (a: ComplianceAlert) => {
    if (a.kind === "approval_pending" && a.key.startsWith("approval:checklist")) {
      onOpenChecklists?.();
      return;
    }
    if (a.entityId) onOpenViolation?.(a.entityId);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Unacknowledged" value={counts.open} icon={BellRing} accent />
        <StatCard label="Overdue actions" value={counts.overdue} icon={Clock} />
        <StatCard label="Repeated violations" value={counts.repeat} icon={Repeat2} />
        <StatCard label="Approvals pending" value={counts.approvals} icon={ShieldCheck} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between pb-3">
          <CardTitle className="text-base font-medium">Alert inbox</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search alerts…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full sm:w-48"
            />
            <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
              <SelectTrigger className="h-9 w-full sm:w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All alert types</SelectItem>
                {(Object.keys(COMPLIANCE_ALERT_KIND_LABELS) as ComplianceAlertKind[]).map((k) => (
                  <SelectItem key={k} value={k}>{COMPLIANCE_ALERT_KIND_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={severity} onValueChange={(v) => setSeverity(v as typeof severity)}>
              <SelectTrigger className="h-9 w-full sm:w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severity</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
              </SelectContent>
            </Select>
            <Select value={state} onValueChange={(v) => setState(v as typeof state)}>
              <SelectTrigger className="h-9 w-full sm:w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unread">Unacknowledged</SelectItem>
                <SelectItem value="acknowledged">Acknowledged</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              disabled={!openInList.length || acknowledgeMany.isPending}
              onClick={() => acknowledgeMany.mutate(openInList)}
            >
              <CheckCheck className="mr-2 h-4 w-4" />
              Acknowledge all ({openInList.length})
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
              <ShieldCheck className="h-8 w-8 text-primary/60" />
              No compliance alerts match these filters.
            </div>
          ) : (
            filtered.map((a) => {
              const Icon = KIND_ICONS[a.kind];
              return (
                <div
                  key={a.key}
                  className={`rounded-lg border p-3 transition-colors ${
                    a.ack ? "bg-muted/30 opacity-80" : "bg-card hover:bg-accent/40"
                  }`}
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="flex min-w-0 gap-3">
                      <div className="mt-0.5 rounded-md bg-muted p-2">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleOpen(a)}
                            className="truncate text-left text-sm font-medium hover:underline"
                          >
                            {a.title}
                          </button>
                          <Badge variant={SEVERITY_VARIANT[a.severity]} className="capitalize">
                            {a.severity}
                          </Badge>
                          <Badge variant="outline">{COMPLIANCE_ALERT_KIND_LABELS[a.kind]}</Badge>
                        </div>
                        <p className="line-clamp-2 text-xs text-muted-foreground">{a.description}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {a.branchName ?? "All branches"} · {a.occurredAt}
                          {a.ageDays != null && a.ageDays > 0 ? ` · ${a.ageDays}d` : ""}
                          {a.ack ? " · acknowledged" : ""}
                          {a.ack?.note ? ` — “${a.ack.note}”` : ""}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {a.ack ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={undoAcknowledge.isPending}
                          onClick={() => undoAcknowledge.mutate(a.ack!.id)}
                        >
                          <RotateCcw className="mr-2 h-4 w-4" />
                          Undo
                        </Button>
                      ) : noteFor === a.key ? (
                        <div className="flex items-center gap-2">
                          <Input
                            autoFocus
                            value={note}
                            placeholder="Optional note…"
                            onChange={(e) => setNote(e.target.value)}
                            className="h-9 w-44"
                          />
                          <Button
                            size="sm"
                            disabled={acknowledge.isPending}
                            onClick={async () => {
                              await acknowledge.mutateAsync({ alert: a, note });
                              setNoteFor(null);
                              setNote("");
                            }}
                          >
                            <Check className="mr-2 h-4 w-4" />
                            Save
                          </Button>
                        </div>
                      ) : (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => { setNoteFor(a.key); setNote(""); }}>
                            Note
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={acknowledge.isPending}
                            onClick={() => acknowledge.mutate({ alert: a })}
                          >
                            <Check className="mr-2 h-4 w-4" />
                            Acknowledge
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number;
  icon: typeof Clock;
  accent?: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-6 flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={`text-2xl font-light ${accent && value > 0 ? "text-destructive" : ""}`}>{value}</p>
        </div>
        <Icon className={`h-5 w-5 ${accent && value > 0 ? "text-destructive" : "text-muted-foreground"}`} />
      </CardContent>
    </Card>
  );
}

