import { useMemo, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LockedFeatureScreen } from "@/components/LockedFeatureScreen";
import { BranchBadge } from "@/components/branch/BranchBadge";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { RefreshCw, Smartphone, Monitor, Search, Check, Pencil, X, Zap } from "lucide-react";
import { useTerminalStateRefresh } from "@/hooks/useTerminalStateRefresh";

const UNASSIGNED = "__unassigned__";
const ALL = "__all__";

interface TerminalRow {
  id: string | null;
  terminal_uid: string;
  name: string;
  branch_id: string | null;
  branch_label: string | null;
  platform: string | null;
  app_version: string | null;
  active: boolean;
  paired_at: string | null;
  last_seen_at: string | null;
  /** Most recent POS write (sale sync) from this terminal, if any. */
  last_activity_at?: string | null;
  /** Branch derived from the signed-in cashier's assigned branch (licence devices). */
  resolved_branch_id?: string | null;
  /** True when the device only exists as an active licence (never registered in pos_terminals). */
  licenceOnly?: boolean;
}

const ONLINE_WINDOW_MS = 10 * 60 * 1000;

/** Freshest signal of life: heartbeat OR real POS activity (sales sync). */
function lastSignalAt(t: TerminalRow): number | null {
  const stamps = [t.last_seen_at, t.last_activity_at]
    .filter(Boolean)
    .map((s) => new Date(s as string).getTime())
    .filter((n) => !Number.isNaN(n));
  return stamps.length ? Math.max(...stamps) : null;
}

function pairingStatus(t: TerminalRow) {
  if (!t.active) return { label: "Revoked", variant: "destructive" as const };
  const signal = lastSignalAt(t);
  if (signal !== null && Date.now() - signal < ONLINE_WINDOW_MS) {
    return { label: "Online", variant: "default" as const };
  }
  if (!t.paired_at && !t.last_seen_at) return { label: "Not paired", variant: "outline" as const };
  return { label: "Paired", variant: "secondary" as const };
}

/** "14:32 · 3 min ago" — exact clock time plus a human helper. */
function formatSignal(iso: string) {
  const d = new Date(iso);
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  const helper =
    mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : formatDistanceToNow(d, { addSuffix: true });
  return { clock: format(d, "MMM d, HH:mm"), helper, full: d.toLocaleString() };
}

export default function TerminalBranchSettings() {
  const { restaurant, hasRole } = useAuth();
  const { branches } = useBranch();
  const queryClient = useQueryClient();
  const isAdmin = hasRole("owner") || hasRole("manager");
  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState<string>(ALL);
  const [showRevoked, setShowRevoked] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const refreshState = useTerminalStateRefresh();

  const { data: terminals = [], isFetching, refetch } = useQuery({
    queryKey: ["terminal-branch-settings", restaurant?.id],
    enabled: !!restaurant?.id && isAdmin,
    queryFn: async () => {
      const activitySince = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
      const [termRes, licRes, staffRes, activityRes] = await Promise.all([
        supabase
          .from("pos_terminals")
          .select(
            "id, terminal_uid, name, branch_id, branch_label, platform, app_version, active, paired_at, last_seen_at"
          )
          .eq("restaurant_id", restaurant!.id),
        supabase
          .from("device_licenses")
          .select(
            "terminal_id, device_label, platform, last_seen_at, claimed_at, revoked_at, claimed_by_user_id"
          )
          .eq("restaurant_id", restaurant!.id),
        supabase
          .from("staff")
          .select("user_id, assigned_branch_id")
          .eq("restaurant_id", restaurant!.id)
          .not("user_id", "is", null),
        // Recent POS writes (sale syncs) prove a tablet is alive even when its
        // licence heartbeat is stale.
        supabase
          .from("pos_idempotency_keys")
          .select("terminal_uid, created_at")
          .eq("restaurant_id", restaurant!.id)
          .gte("created_at", activitySince),
      ]);
      if (termRes.error) throw termRes.error;
      if (licRes.error) throw licRes.error;

      const activityByTerminal = new Map<string, string>();
      for (const a of activityRes.data ?? []) {
        if (!a.terminal_uid || !a.created_at) continue;
        const prev = activityByTerminal.get(a.terminal_uid);
        if (!prev || new Date(a.created_at) > new Date(prev)) {
          activityByTerminal.set(a.terminal_uid, a.created_at);
        }
      }

      const branchByUser = new Map<string, string | null>();
      for (const s of staffRes.data ?? []) {
        if (s.user_id && s.assigned_branch_id) branchByUser.set(s.user_id, s.assigned_branch_id);
      }

      /** Latest non-revoked licence per terminal (falls back to latest revoked one). */
      const licByTerminal = new Map<string, any>();
      for (const l of licRes.data ?? []) {
        if (!l.terminal_id) continue;
        const prev = licByTerminal.get(l.terminal_id);
        const better =
          !prev ||
          (!l.revoked_at && prev.revoked_at) ||
          (!!l.revoked_at === !!prev.revoked_at &&
            new Date(l.last_seen_at ?? 0) > new Date(prev.last_seen_at ?? 0));
        if (better) licByTerminal.set(l.terminal_id, l);
      }

      const rows: TerminalRow[] = (termRes.data ?? []).map((t: any) => {
        const lic = licByTerminal.get(t.terminal_uid);
        const lastSeen =
          [t.last_seen_at, lic?.last_seen_at]
            .filter(Boolean)
            .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
        return {
          ...t,
          last_seen_at: lastSeen,
          last_activity_at: activityByTerminal.get(t.terminal_uid) ?? null,
          paired_at: t.paired_at ?? lic?.claimed_at ?? null,
          platform: t.platform ?? lic?.platform ?? null,
          active: t.active && !(lic && lic.revoked_at),
          resolved_branch_id:
            t.branch_id ??
            (lic?.claimed_by_user_id ? branchByUser.get(lic.claimed_by_user_id) ?? null : null),
        } as TerminalRow;
      });

      // Devices that paired through a licence but were never registered in pos_terminals.
      const known = new Set(rows.map((r) => r.terminal_uid));
      for (const [terminalUid, lic] of licByTerminal) {
        if (known.has(terminalUid)) continue;
        const derived = lic.claimed_by_user_id ? branchByUser.get(lic.claimed_by_user_id) ?? null : null;
        rows.push({
          id: null,
          terminal_uid: terminalUid,
          name: lic.device_label?.includes("Android") ? "Android terminal" : "Unnamed terminal",
          branch_id: derived,
          branch_label: null,
          platform: lic.platform ?? null,
          app_version: null,
          active: !lic.revoked_at,
          paired_at: lic.claimed_at ?? null,
          last_seen_at: lic.last_seen_at ?? null,
          last_activity_at: activityByTerminal.get(terminalUid) ?? null,
          resolved_branch_id: derived,
          licenceOnly: true,
        });
      }

      return rows.sort((a, b) => (lastSignalAt(b) ?? 0) - (lastSignalAt(a) ?? 0));
    },
  });

  const repin = useMutation({
    mutationFn: async ({
      id,
      branchId,
      terminalUid,
      name,
    }: { id: string | null; branchId: string | null; terminalUid: string; name?: string }) => {
      if (id) {
        const { error } = await supabase
          .from("pos_terminals")
          .update({ branch_id: branchId })
          .eq("id", id);
        if (error) throw error;
        return;
      }
      // Licence-only device: register it so the pin persists.
      const { error } = await supabase.from("pos_terminals").upsert(
        {
          restaurant_id: restaurant!.id,
          terminal_uid: terminalUid,
          branch_id: branchId,
          name: name || "Unnamed terminal",
        },
        { onConflict: "restaurant_id,terminal_uid" }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Terminal branch updated");
      queryClient.invalidateQueries({ queryKey: ["terminal-branch-settings", restaurant?.id] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not update terminal branch"),
  });

  const rename = useMutation({
    mutationFn: async ({
      id,
      name,
      terminalUid,
      branchId,
    }: { id: string | null; name: string; terminalUid: string; branchId: string | null }) => {
      if (id) {
        const { error } = await supabase.from("pos_terminals").update({ name }).eq("id", id);
        if (error) throw error;
        return;
      }
      const { error } = await supabase.from("pos_terminals").upsert(
        { restaurant_id: restaurant!.id, terminal_uid: terminalUid, name, branch_id: branchId },
        { onConflict: "restaurant_id,terminal_uid" }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Terminal renamed");
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ["terminal-branch-settings", restaurant?.id] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not rename terminal"),
  });

  const branchName = (id: string | null) =>
    branches.find((b) => b.id === id)?.name ?? null;

  const displayName = (t: TerminalRow) =>
    t.name?.trim() ||
    `${branchName(t.branch_id) ?? "Unassigned"} · Terminal ${t.terminal_uid.slice(0, 6)}`;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return terminals.filter((t) => {
      if (!showRevoked && !t.active) return false;
      if (branchFilter === UNASSIGNED && t.branch_id) return false;
      if (branchFilter !== ALL && branchFilter !== UNASSIGNED && t.branch_id !== branchFilter)
        return false;
      if (!q) return true;
      return (
        displayName(t).toLowerCase().includes(q) ||
        t.terminal_uid?.toLowerCase().includes(q) ||
        (branchName(t.branch_id) ?? "").toLowerCase().includes(q)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminals, search, branchFilter, showRevoked, branches]);

  /** Terminals grouped by branch so each branch's devices are visually separated. */
  const groups = useMemo(() => {
    const map = new Map<string, { id: string | null; name: string; items: TerminalRow[] }>();
    for (const t of rows) {
      const key = t.branch_id ?? UNASSIGNED;
      if (!map.has(key)) {
        map.set(key, {
          id: t.branch_id,
          name: branchName(t.branch_id) ?? "Unassigned",
          items: [],
        });
      }
      map.get(key)!.items.push(t);
    }
    return Array.from(map.values()).sort((a, b) => {
      if (!a.id) return 1;
      if (!b.id) return -1;
      return a.name.localeCompare(b.name);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, branches]);

  const unassignedCount = terminals.filter((t) => t.active && !t.branch_id).length;

  if (!isAdmin) {
    return (
      <LockedFeatureScreen
        featureName="Terminal Branch Settings"
        description="Only owners and managers can re-pin POS terminals to a branch."
      />
    );
  }

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">Terminal Branch Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Re-pin each Android / POS terminal to a branch. Menu prices, VAT rate and sales are
            recorded against the branch selected here.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => refreshState.mutate({ label: "all branches" })}
            disabled={refreshState.isPending}
            title="Force every terminal to reload its menu, prices, VAT rate and branch on the next heartbeat"
          >
            <Zap className={`h-4 w-4 ${refreshState.isPending ? "animate-pulse" : ""}`} /> Refresh terminal state
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </header>

      {unassignedCount > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
          {unassignedCount} active terminal{unassignedCount > 1 ? "s are" : " is"} not pinned to a
          branch — they fall back to the primary branch pricing.
        </div>
      )}

      {/* Per-branch counts */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {branches
          .filter((b) => b.is_active)
          .map((b) => {
            const all = terminals.filter((t) => t.branch_id === b.id);
            const online = all.filter((t) => pairingStatus(t).label === "Online").length;
            return (
              <button
                key={b.id}
                onClick={() => setBranchFilter(branchFilter === b.id ? ALL : b.id)}
                className={`text-left rounded-lg border p-3 transition-colors ${
                  branchFilter === b.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                }`}
              >
                <BranchBadge branchId={b.id} name={b.name} size="sm" />
                <p className="mt-2 text-2xl font-light tabular-nums">{all.length}</p>
                <p className="text-xs text-muted-foreground">
                  {online} online · {all.filter((t) => !t.active).length} revoked
                </p>
              </button>
            );
          })}
      </div>

      <Card>
        <CardHeader className="gap-3 pb-3">
          <div>
            <CardTitle className="text-base font-medium">Terminals ({rows.length})</CardTitle>
            <CardDescription>Pairing status reflects the last time the device contacted the server.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative max-w-sm flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search terminals…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={branchFilter} onValueChange={setBranchFilter}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="All branches" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All branches</SelectItem>
                <SelectItem value={UNASSIGNED}>Unassigned only</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Switch id="show-revoked" checked={showRevoked} onCheckedChange={setShowRevoked} />
              <Label htmlFor="show-revoked" className="text-sm text-muted-foreground">
                Show revoked
              </Label>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[min(560px,65vh)] w-full">
            <div>
              {rows.length === 0 && (
                <p className="p-6 text-sm text-muted-foreground">No terminals found.</p>
              )}
              {groups.map((g) => (
                <div key={g.id ?? UNASSIGNED}>
                  <div className="sticky top-0 z-10 flex items-center gap-2 bg-muted/60 backdrop-blur px-4 py-2 border-y border-border">
                    <BranchBadge branchId={g.id} name={g.id ? g.name : null} size="sm" untaggedLabel="Unassigned" />
                    <span className="text-xs text-muted-foreground">
                      {g.items.length} terminal{g.items.length > 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="divide-y divide-border">
              {g.items.map((t) => {
                const status = pairingStatus(t);
                return (
                  <div key={t.terminal_uid} className="flex flex-wrap items-center gap-4 p-4">
                    <div className="flex items-start gap-3 min-w-[220px] flex-1">
                      {t.platform?.toLowerCase().includes("android") ? (
                        <Smartphone className="h-4 w-4 mt-1 text-muted-foreground" />
                      ) : (
                        <Monitor className="h-4 w-4 mt-1 text-muted-foreground" />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {editingId === t.terminal_uid ? (
                            <div className="flex items-center gap-1">
                              <Input
                                autoFocus
                                value={draftName}
                                onChange={(e) => setDraftName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && draftName.trim())
                                    rename.mutate({
                                      id: t.id,
                                      name: draftName.trim(),
                                      terminalUid: t.terminal_uid,
                                      branchId: t.branch_id,
                                    });
                                  if (e.key === "Escape") setEditingId(null);
                                }}
                                className="h-8 w-[200px]"
                                placeholder="Terminal name"
                              />
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                disabled={!draftName.trim() || rename.isPending}
                                onClick={() =>
                                  rename.mutate({
                                    id: t.id,
                                    name: draftName.trim(),
                                    terminalUid: t.terminal_uid,
                                    branchId: t.branch_id,
                                  })
                                }
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                onClick={() => setEditingId(null)}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : (
                            <button
                              className="group inline-flex items-center gap-1.5 min-w-0"
                              onClick={() => {
                                setEditingId(t.terminal_uid);
                                setDraftName(t.name ?? "");
                              }}
                            >
                              <span
                                className={`font-medium truncate ${!t.name?.trim() ? "text-muted-foreground italic" : ""}`}
                              >
                                {displayName(t)}
                              </span>
                              <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
                            </button>
                          )}
                          <Badge variant={status.variant} className="text-xs">{status.label}</Badge>
                          {t.last_seen_at ? (
                            (() => {
                              const s = formatSignal(t.last_seen_at);
                              return (
                                <span
                                  className="text-xs text-muted-foreground whitespace-nowrap"
                                  title={`Last heartbeat: ${s.full}`}
                                >
                                  {s.clock} · {s.helper}
                                </span>
                              );
                            })()
                          ) : (
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              no heartbeat yet
                            </span>
                          )}
                          <BranchBadge
                            branchId={t.branch_id}
                            name={branchName(t.branch_id)}
                            size="sm"
                            untaggedLabel="Unassigned"
                          />
                        </div>
                        <p className="text-xs text-muted-foreground font-mono truncate">
                          {t.terminal_uid}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t.platform ?? "unknown platform"}
                          {t.app_version ? ` · v${t.app_version}` : ""}
                          {" · "}
                          {t.last_seen_at
                            ? `last seen ${formatDistanceToNow(new Date(t.last_seen_at), { addSuffix: true })}`
                            : "never seen"}
                          {t.paired_at
                            ? ` · paired ${formatDistanceToNow(new Date(t.paired_at), { addSuffix: true })}`
                            : ""}
                          {t.last_activity_at
                            ? ` · sale activity ${formatDistanceToNow(new Date(t.last_activity_at), { addSuffix: true })}`
                            : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="whitespace-nowrap"
                      disabled={refreshState.isPending || !t.active}
                      onClick={() =>
                        refreshState.mutate({
                          branchId: t.branch_id,
                          terminalUid: t.terminal_uid,
                          label: displayName(t),
                        })
                      }
                      title="Reload this terminal's menu, prices and VAT without closing the shift"
                    >
                      <Zap className="h-4 w-4" /> Refresh state
                    </Button>
                    <Select
                      value={t.branch_id ?? UNASSIGNED}
                      onValueChange={(v) =>
                        repin.mutate({
                          id: t.id,
                          branchId: v === UNASSIGNED ? null : v,
                          terminalUid: t.terminal_uid,
                          name: t.name,
                        })
                      }
                      disabled={repin.isPending}
                    >
                      <SelectTrigger className="w-[240px]">
                        <SelectValue placeholder="Select branch" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNASSIGNED}>Unassigned (primary branch)</SelectItem>
                        {branches
                          .filter((b) => b.is_active || b.id === t.branch_id)
                          .map((b) => (
                            <SelectItem key={b.id} value={b.id}>
                              {b.name}
                              {b.is_primary ? " (primary)" : ""}
                              {!b.is_active ? " — inactive" : ""}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    </div>
                  </div>
                );
              })}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
