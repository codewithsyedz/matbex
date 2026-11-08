import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { History, UserMinus, UserPlus, PencilLine } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const db = supabase as any;

type Row = Record<string, any> | null;

interface AuditRow {
  id: string;
  action: string;
  entity_id: string | null;
  user_id: string | null;
  created_at: string;
  old_data: Row;
  new_data: Row;
}

/** Fields worth surfacing to a finance reviewer, in display order. */
const TRACKED: { key: string; label: string; kind: "pct" | "money" | "account" | "text" | "bool" }[] = [
  { key: "partner_name", label: "Partner name", kind: "text" },
  { key: "ownership_pct", label: "Ownership %", kind: "pct" },
  { key: "opening_capital", label: "Opening capital", kind: "money" },
  { key: "capital_account_id", label: "Capital account", kind: "account" },
  { key: "loan_account_id", label: "Loan account", kind: "account" },
  { key: "payable_account_id", label: "Due-to-partner account", kind: "account" },
  { key: "owner_capital_account_id", label: "Linked bank capital account", kind: "account" },
  { key: "is_active", label: "Active", kind: "bool" },
];

function useProjectPartnerAudit(projectId?: string | null) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;

  return useQuery({
    queryKey: ["project-partner-audit", tenantId, projectId],
    enabled: !!tenantId && !!projectId,
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { data, error } = await db
        .from("audit_logs")
        .select("id, action, entity_id, user_id, created_at, old_data, new_data")
        .eq("tenant_id", tenantId)
        .eq("entity_type", "project_partners")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;

      const events = ((data ?? []) as AuditRow[]).filter((e) => {
        const pid = e.new_data?.project_id ?? e.old_data?.project_id;
        return pid === projectId;
      });

      const accountIds = new Set<string>();
      for (const e of events) {
        for (const f of TRACKED.filter((t) => t.kind === "account")) {
          const a = e.old_data?.[f.key];
          const b = e.new_data?.[f.key];
          if (a) accountIds.add(a);
          if (b) accountIds.add(b);
        }
      }

      let accountLabels: Record<string, string> = {};
      if (accountIds.size) {
        const { data: accs } = await db
          .from("chart_of_accounts")
          .select("id, account_code, account_name")
          .in("id", Array.from(accountIds));
        accountLabels = Object.fromEntries(
          (accs ?? []).map((a: any) => [a.id, `${a.account_code} - ${a.account_name}`]),
        );
      }

      const userIds = Array.from(new Set(events.map((e) => e.user_id).filter(Boolean) as string[]));
      let actors: Record<string, string> = {};
      if (userIds.length) {
        const { data: profiles } = await db
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds);
        actors = Object.fromEntries(
          (profiles ?? []).map((p: any) => [p.id, p.full_name ?? "Unknown user"]),
        );
      }

      return { events, accountLabels, actors };
    },
  });
}

const fmtValue = (
  kind: (typeof TRACKED)[number]["kind"],
  value: unknown,
  accountLabels: Record<string, string>,
) => {
  if (value === null || value === undefined || value === "") return "—";
  switch (kind) {
    case "pct":
      return `${Number(value).toFixed(2)}%`;
    case "money":
      return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2 });
    case "account":
      return accountLabels[String(value)] ?? "Unlinked account";
    case "bool":
      return value ? "Yes" : "No";
    default:
      return String(value);
  }
};

export function ProjectPartnerAuditPanel({ projectId }: { projectId?: string | null }) {
  const { data, isLoading, error } = useProjectPartnerAudit(projectId);
  const events = data?.events ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          Partner audit trail
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Every partner added or removed, plus ownership and ledger account changes.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted-foreground">Loading history…</p>}
        {!isLoading && error && (
          <p className="text-sm text-muted-foreground">
            You do not have permission to view the audit history for this project.
          </p>
        )}
        {!isLoading && !error && events.length === 0 && (
          <p className="text-sm text-muted-foreground">No partner changes recorded yet.</p>
        )}
        {!isLoading && !error && events.length > 0 && (
          <ScrollArea className="max-h-[420px] pr-3">
            <ol className="relative space-y-4 border-l pl-5">
              {events.map((e) => {
                const isInsert = e.action === "INSERT";
                const isDelete = e.action === "DELETE";
                const record = e.new_data ?? e.old_data ?? {};
                const changes = TRACKED.map((f) => ({
                  field: f,
                  from: e.old_data?.[f.key],
                  to: e.new_data?.[f.key],
                })).filter(
                  (c) =>
                    !isInsert &&
                    !isDelete &&
                    JSON.stringify(c.from ?? null) !== JSON.stringify(c.to ?? null),
                );

                if (!isInsert && !isDelete && changes.length === 0) return null;

                const Icon = isInsert ? UserPlus : isDelete ? UserMinus : PencilLine;

                return (
                  <li key={e.id} className="relative">
                    <span className="absolute -left-[27px] flex h-4 w-4 items-center justify-center rounded-full bg-background ring-2 ring-border">
                      <Icon className="h-2.5 w-2.5 text-muted-foreground" />
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={isDelete ? "destructive" : isInsert ? "default" : "secondary"}>
                        {isInsert ? "Partner added" : isDelete ? "Partner removed" : "Updated"}
                      </Badge>
                      <span className="text-sm font-medium">
                        {record.partner_name ?? "Partner"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(e.created_at), "dd MMM yyyy HH:mm")}
                        {e.user_id ? ` · ${data?.actors[e.user_id] ?? "Unknown user"}` : " · System"}
                      </span>
                    </div>

                    {(isInsert || isDelete) && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Ownership{" "}
                        {fmtValue("pct", record.ownership_pct, data?.accountLabels ?? {})} · Opening
                        capital{" "}
                        {fmtValue("money", record.opening_capital, data?.accountLabels ?? {})}
                      </p>
                    )}

                    {changes.length > 0 && (
                      <ul className="mt-1.5 space-y-1">
                        {changes.map((c) => (
                          <li key={c.field.key} className="text-xs">
                            <span className="text-muted-foreground">{c.field.label}: </span>
                            <span className="line-through opacity-70">
                              {fmtValue(c.field.kind, c.from, data?.accountLabels ?? {})}
                            </span>
                            <span className="mx-1">→</span>
                            <span className="font-medium">
                              {fmtValue(c.field.kind, c.to, data?.accountLabels ?? {})}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ol>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
