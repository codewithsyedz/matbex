import { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LockedFeatureScreen } from "@/components/LockedFeatureScreen";
import { BranchBadge } from "@/components/branch/BranchBadge";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/integrations/db/client";
import { RefreshCw, Search, Monitor } from "lucide-react";

/**
 * Read-only report mirroring the terminal-api branch resolution order:
 *   1. branch the last signed-in cashier is pinned to (staff.assigned_branch_id)
 *   2. branch the terminal itself is pinned to (pos_terminals.branch_id)
 *   3. the restaurant's primary branch
 */
type Source = "user" | "terminal" | "primary" | "none";

const SOURCE_LABEL: Record<Source, string> = {
  user: "From cashier login",
  terminal: "From terminal pin",
  primary: "Primary branch fallback",
  none: "Unresolved",
};

function seenStatus(lastSeen: string | null, active: boolean) {
  if (!active) return { label: "Revoked", variant: "destructive" as const };
  if (!lastSeen) return { label: "Never seen", variant: "outline" as const };
  const age = Date.now() - new Date(lastSeen).getTime();
  if (age < 10 * 60 * 1000) return { label: "Online", variant: "default" as const };
  if (age < 24 * 60 * 60 * 1000) return { label: "Idle", variant: "secondary" as const };
  return { label: "Offline", variant: "outline" as const };
}

export default function TerminalPricingReport() {
  const { restaurant, hasRole } = useAuth();
  const isAdmin = hasRole("owner") || hasRole("manager");
  const [search, setSearch] = useState("");

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["terminal-pricing-report", restaurant?.id],
    enabled: !!restaurant?.id && isAdmin,
    queryFn: async () => {
      const rid = restaurant!.id;
      const [terminalsRes, branchesRes, auditRes, staffRes] = await Promise.all([
        db
          .from("pos_terminals")
          .select("id, terminal_uid, name, branch_id, platform, app_version, active, last_seen_at")
          .eq("restaurant_id", rid)
          .order("last_seen_at", { ascending: false, nullsFirst: false }),
        db
          .from("branches")
          .select("id, name, code, is_primary, vat_rate, is_active")
          .eq("restaurant_id", rid),
        db
          .from("pos_terminal_audit")
          .select("terminal_id, cashier_id, created_at")
          .eq("restaurant_id", rid)
          .not("cashier_id", "is", null)
          .order("created_at", { ascending: false })
          .limit(1000),
        db
          .from("staff")
          .select("user_id, name, assigned_branch_id")
          .eq("restaurant_id", rid)
          .not("user_id", "is", null),
      ]);
      if (terminalsRes.error) throw terminalsRes.error;
      if (branchesRes.error) throw branchesRes.error;

      return {
        terminals: terminalsRes.data ?? [],
        branches: (branchesRes.data ?? []) as any[],
        audit: (auditRes.data ?? []) as any[],
        staff: (staffRes.data ?? []) as any[],
      };
    },
  });

  const rows = useMemo(() => {
    if (!data) return [];
    const branchById = new Map(data.branches.map((b: any) => [b.id, b]));
    const primary = data.branches.find((b: any) => b.is_primary) ?? null;
    const staffByUser = new Map(data.staff.map((s: any) => [s.user_id, s]));

    // Most recent cashier per terminal (audit is already ordered desc).
    const lastCashier = new Map<string, { cashier_id: string; created_at: string }>();
    for (const a of data.audit) {
      if (a.terminal_id && !lastCashier.has(a.terminal_id)) {
        lastCashier.set(a.terminal_id, { cashier_id: a.cashier_id, created_at: a.created_at });
      }
    }

    return data.terminals.map((t: any) => {
      const last = lastCashier.get(t.id) ?? null;
      const staff = last ? staffByUser.get(last.cashier_id) : null;

      let branch: any = null;
      let source: Source = "none";
      if (staff?.assigned_branch_id && branchById.has(staff.assigned_branch_id)) {
        branch = branchById.get(staff.assigned_branch_id);
        source = "user";
      } else if (t.branch_id && branchById.has(t.branch_id)) {
        branch = branchById.get(t.branch_id);
        source = "terminal";
      } else if (primary) {
        branch = primary;
        source = "primary";
      }

      return {
        ...t,
        lastUserName: staff?.name ?? (last ? "Unknown user" : null),
        lastUserAt: last?.created_at ?? null,
        branch,
        source,
        vatRate: branch?.vat_rate == null ? 15 : Number(branch.vat_rate),
      };
    });
  }, [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r: any) =>
      [r.name, r.terminal_uid, r.branch?.name, r.lastUserName]
        .filter(Boolean)
        .some((v: string) => v.toLowerCase().includes(q))
    );
  }, [rows, search]);

  if (!isAdmin) {
    return (
      <LockedFeatureScreen
        featureName="Terminal pricing report"
        description="Only owners and managers can view terminal pricing assignments."
      />
    );
  }

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">Terminal Pricing Report</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Which branch prices each POS terminal is serving, based on the last cashier login.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="gap-3 pb-3">
          <div>
            <CardTitle className="text-base font-medium">
              Terminals ({filtered.length})
            </CardTitle>
            <CardDescription>
              Resolution order: cashier's pinned branch → terminal pin → primary branch.
            </CardDescription>
          </div>
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search terminal, branch or user…"
              className="pl-9"
            />
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Terminal</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead>Last cashier</TableHead>
                <TableHead>Pricing branch</TableHead>
                <TableHead>Resolved from</TableHead>
                <TableHead className="text-right">VAT</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                    No terminals found.
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((t: any) => {
                const status = seenStatus(t.last_seen_at, t.active);
                return (
                  <TableRow key={t.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Monitor className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <div className="font-medium">{t.name}</div>
                          <div className="font-mono text-xs text-muted-foreground">
                            {t.terminal_uid}
                            {t.app_version ? ` · v${t.app_version}` : ""}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {t.last_seen_at
                        ? `${formatDistanceToNow(new Date(t.last_seen_at))} ago`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {t.lastUserName ?? <span className="text-muted-foreground">—</span>}
                      {t.lastUserAt && (
                        <div className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(t.lastUserAt))} ago
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {t.branch ? (
                        <BranchBadge branchId={t.branch.id} name={t.branch.name} />
                      ) : (
                        <span className="text-sm text-muted-foreground">Unresolved</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={t.source === "user" ? "default" : "secondary"}>
                        {SOURCE_LABEL[t.source as Source]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {t.branch ? `${t.vatRate}%` : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}