import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { BranchBadge } from "@/components/branch/BranchBadge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle2, XCircle, Download, ShieldCheck, Send } from "lucide-react";

type ActionKind = "approved" | "rejected" | "posted";

interface AuditEvent {
  key: string;
  batchId: string;
  action: ActionKind;
  at: string;
  actorId: string | null;
  branchId: string | null;
  description: string;
  reference: string | null;
  batchDate: string;
  entryType: string;
  reason: string | null;
}

const actionMeta: Record<ActionKind, { label: string; icon: typeof CheckCircle2; className: string }> = {
  approved: { label: "Approved", icon: CheckCircle2, className: "text-primary" },
  rejected: { label: "Rejected", icon: XCircle, className: "text-destructive" },
  posted: { label: "Posted", icon: Send, className: "text-muted-foreground" },
};

export function JournalEntryAuditTrail() {
  const { profile, isManager, isAccountant } = useAuth();
  const { branches, activeBranch, activeBranchId, isAllBranches, pinnedBranchId } = useBranch();
  const tenantId = profile?.tenant_id;
  const scopedBranchId = pinnedBranchId ?? (isAllBranches ? null : activeBranchId ?? null);
  const [actionFilter, setActionFilter] = useState<"all" | ActionKind>("all");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["journal-entry-audit", tenantId, scopedBranchId ?? "all"],
    enabled: !!tenantId,
    queryFn: async () => {
      let q = db
        .from("journal_entry_batches")
        .select(
          "id, batch_date, description, reference_number, entry_type, branch_id, approval_status, approved_by, approved_at, rejected_by, rejected_at, rejection_reason, is_posted, posted_by, posted_at"
        )
        .eq("tenant_id", tenantId!)
        .or("approved_at.not.is.null,rejected_at.not.is.null,posted_at.not.is.null")
        .order("created_at", { ascending: false })
        .limit(200);
      if (scopedBranchId) {
        q = q.or(`branch_id.eq.${scopedBranchId},branch_id.is.null`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  const events = useMemo<AuditEvent[]>(() => {
    const out: AuditEvent[] = [];
    for (const b of rows as any[]) {
      const base = {
        batchId: b.id,
        branchId: b.branch_id as string | null,
        description: b.description as string,
        reference: b.reference_number as string | null,
        batchDate: b.batch_date as string,
        entryType: b.entry_type as string,
      };
      if (b.approved_at) {
        out.push({ ...base, key: `${b.id}-a`, action: "approved", at: b.approved_at, actorId: b.approved_by, reason: null });
      }
      if (b.rejected_at) {
        out.push({ ...base, key: `${b.id}-r`, action: "rejected", at: b.rejected_at, actorId: b.rejected_by, reason: b.rejection_reason ?? null });
      }
      if (b.posted_at) {
        out.push({ ...base, key: `${b.id}-p`, action: "posted", at: b.posted_at, actorId: b.posted_by, reason: null });
      }
    }
    return out.sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime());
  }, [rows]);

  const actorIds = useMemo(
    () => Array.from(new Set(events.map((e) => e.actorId).filter(Boolean) as string[])),
    [events]
  );

  const { data: actorNames = {} } = useQuery({
    queryKey: ["journal-entry-audit-actors", actorIds.join(",")],
    enabled: actorIds.length > 0,
    queryFn: async () => {
      const { data, error } = await db
        .from("profiles")
        .select("id, full_name")
        .in("id", actorIds);
      if (error) throw error;
      const map: Record<string, string> = {};
      (data || []).forEach((p: any) => {
        map[p.id] = p.full_name || p.id.slice(0, 8);
      });
      return map;
    },
  });

  if (!isManager && !isAccountant) return null;

  const branchName = (id?: string | null) =>
    id ? branches.find((b) => b.id === id)?.name ?? null : null;
  const scopeLabel = scopedBranchId ? activeBranch?.name ?? "Current branch" : "All branches";
  const actorName = (id: string | null) => (id ? actorNames[id] ?? `${id.slice(0, 8)}…` : "System");

  const filtered = actionFilter === "all" ? events : events.filter((e) => e.action === actionFilter);

  const exportCsv = () => {
    const header = ["Timestamp", "Action", "Actor", "Branch", "Entry date", "Description", "Reference", "Type", "Reason"];
    const lines = filtered.map((e) =>
      [
        new Date(e.at).toISOString(),
        actionMeta[e.action].label,
        actorName(e.actorId),
        branchName(e.branchId) ?? "Untagged",
        e.batchDate,
        e.description,
        e.reference ?? "",
        e.entryType,
        e.reason ?? "",
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `journal-approval-audit-${scopeLabel.replace(/\s+/g, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-3">
        <div>
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Journal Approval Audit Trail
          </CardTitle>
          <CardDescription>
            Who approved, rejected, or posted each journal entry — with timestamps. Scope: {scopeLabel}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Select value={actionFilter} onValueChange={(v) => setActionFilter(v as typeof actionFilter)}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actions</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="posted">Posted</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="h-4 w-4 mr-1" />
            CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No approval activity recorded for this scope yet.</p>
        ) : (
          <ScrollArea className="max-h-[420px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Entry</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((e) => {
                  const meta = actionMeta[e.action];
                  const Icon = meta.icon;
                  return (
                    <TableRow key={e.key}>
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        {new Date(e.at).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center gap-1 text-sm ${meta.className}`}>
                          <Icon className="h-3.5 w-3.5" />
                          {meta.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">{actorName(e.actorId)}</TableCell>
                      <TableCell>
                        <BranchBadge
                          name={branchName(e.branchId)}
                          branchId={e.branchId}
                          size="sm"
                          untaggedLabel="Untagged"
                        />
                      </TableCell>
                      <TableCell className="max-w-[320px]">
                        <div className="truncate text-sm">{e.description}</div>
                        <div className="text-xs text-muted-foreground">
                          {e.batchDate} · {e.reference || "no reference"} ·{" "}
                          <Badge variant="outline" className="h-4 px-1 text-[10px] align-middle">
                            {e.entryType}
                          </Badge>
                          {e.reason ? ` · ${e.reason}` : ""}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}