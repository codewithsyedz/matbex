import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Plus,
  Star,
  Search,
  Pencil,
  Archive,
  ArchiveRestore,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  PauseCircle,
  PlayCircle,
  Power,
  PowerOff,
} from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";

interface Location {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  status: string;
  is_primary: boolean;
  created_at: string;
  paused_until: string | null;
  paused_reason: string | null;
}

interface Props {
  tenantId: string;
  onChanged?: () => void;
}

const EMPTY = { name: "", currency: "SAR", timezone: "Asia/Riyadh" };

const CURRENCIES = ["SAR", "AED", "KWD", "BHD", "QAR", "OMR", "USD", "EUR", "GBP"];
const TIMEZONES = [
  "Asia/Riyadh",
  "Asia/Dubai",
  "Asia/Kuwait",
  "Asia/Bahrain",
  "Asia/Qatar",
  "Asia/Muscat",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "UTC",
];

export function TenantLocationsManager({ tenantId, onChanged }: Props) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<Location | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Location | null>(null);
  const [inactiveTarget, setInactiveTarget] = useState<Location | null>(null);
  const [pauseTarget, setPauseTarget] = useState<Location | null>(null);
  const [pauseDays, setPauseDays] = useState<number>(3);
  const [pauseReason, setPauseReason] = useState<string>("");
  const [working, setWorking] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "inactive" | "archived" | "all">("active");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [sortKey, setSortKey] = useState<"name" | "status" | "created">("created");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const fetchLocations = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("restaurants")
      .select("id, name, currency, timezone, status, is_primary, created_at, paused_until, paused_reason")
      .eq("tenant_id", tenantId)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setLocations((data || []) as Location[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchLocations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = locations.filter((l) => {
      if (statusFilter === "active" && l.status !== "active") return false;
      if (statusFilter === "inactive" && l.status !== "inactive") return false;
      if (statusFilter === "archived" && l.status !== "archived") return false;
      if (!q) return true;
      return (
        l.name.toLowerCase().includes(q) ||
        l.currency.toLowerCase().includes(q) ||
        l.timezone.toLowerCase().includes(q)
      );
    });

    const dir = sortDir === "asc" ? 1 : -1;
    const cmp = (a: string | null, b: string | null) => {
      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;
      return String(a).localeCompare(String(b)) * dir;
    };

    list.sort((a, b) => {
      // Primary location always pinned to the top
      if (a.is_primary && !b.is_primary) return -1;
      if (!a.is_primary && b.is_primary) return 1;
      switch (sortKey) {
        case "status":
          return cmp(a.status, b.status);
        case "created":
          return cmp(a.created_at, b.created_at);
        case "name":
        default:
          return cmp(a.name.toLowerCase(), b.name.toLowerCase());
      }
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations, search, statusFilter, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedItems = useMemo(
    () => filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filtered, safePage, pageSize],
  );

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, pageSize, sortKey, sortDir]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setDialogOpen(true);
  };

  const openEdit = (l: Location) => {
    setEditing(l);
    setForm({ name: l.name, currency: l.currency, timezone: l.timezone });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Location name is required");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const { error } = await supabase
          .from("restaurants")
          .update({
            name: form.name.trim(),
            currency: form.currency,
            timezone: form.timezone,
          })
          .eq("id", editing.id);
        if (error) throw error;
        toast.success("Location updated");
      } else {
        const isFirst = locations.length === 0;
        const { error } = await supabase.from("restaurants").insert({
          tenant_id: tenantId,
          name: form.name.trim(),
          currency: form.currency,
          timezone: form.timezone,
          is_primary: isFirst,
          status: "active",
        });
        if (error) throw error;
        toast.success("Location created");
      }
      setDialogOpen(false);
      setEditing(null);
      await fetchLocations();
      onChanged?.();
    } catch (err: any) {
      toast.error(err?.message || "Failed to save location");
    } finally {
      setSaving(false);
    }
  };

  const confirmArchive = async () => {
    if (!archiveTarget) return;
    setWorking(true);
    try {
      const nextStatus = archiveTarget.status === "archived" ? "active" : "archived";
      const { error } = await supabase
        .from("restaurants")
        .update({ status: nextStatus })
        .eq("id", archiveTarget.id);
      if (error) throw error;
      toast.success(nextStatus === "archived" ? "Location archived" : "Location restored");
      setArchiveTarget(null);
      await fetchLocations();
      onChanged?.();
    } catch (err: any) {
      toast.error(err?.message || "Failed to update location");
    } finally {
      setWorking(false);
    }
  };

  const confirmInactive = async () => {
    if (!inactiveTarget) return;
    if (inactiveTarget.is_primary && inactiveTarget.status === "active") {
      toast.error("Primary locations cannot be marked inactive");
      return;
    }
    setWorking(true);
    try {
      const nextStatus = inactiveTarget.status === "inactive" ? "active" : "inactive";
      const { error } = await supabase
        .from("restaurants")
        .update({ status: nextStatus })
        .eq("id", inactiveTarget.id);
      if (error) throw error;
      toast.success(
        nextStatus === "inactive"
          ? "Location marked inactive — automated emails paused"
          : "Location reactivated",
      );
      setInactiveTarget(null);
      await fetchLocations();
      onChanged?.();
    } catch (err: any) {
      toast.error(err?.message || "Failed to update location");
    } finally {
      setWorking(false);
    }
  };

  const isPausedNow = (l: Location) =>
    !!l.paused_until && new Date(l.paused_until).getTime() > Date.now();

  const openPause = (l: Location) => {
    setPauseTarget(l);
    setPauseDays(3);
    setPauseReason(l.paused_reason ?? "");
  };

  const confirmPause = async () => {
    if (!pauseTarget) return;
    if (pauseDays < 1 || pauseDays > 90) {
      toast.error("Pause duration must be between 1 and 90 days");
      return;
    }
    setWorking(true);
    try {
      const until = new Date();
      until.setDate(until.getDate() + pauseDays);
      const { error } = await supabase
        .from("restaurants")
        .update({
          paused_until: until.toISOString(),
          paused_reason: pauseReason.trim() || null,
        })
        .eq("id", pauseTarget.id);
      if (error) throw error;
      toast.success(`Branch paused for ${pauseDays} day${pauseDays === 1 ? "" : "s"}`);
      setPauseTarget(null);
      await fetchLocations();
      onChanged?.();
    } catch (err: any) {
      toast.error(err?.message || "Failed to pause branch");
    } finally {
      setWorking(false);
    }
  };

  const resumeBranch = async (l: Location) => {
    setWorking(true);
    try {
      const { error } = await supabase
        .from("restaurants")
        .update({ paused_until: null, paused_reason: null })
        .eq("id", l.id);
      if (error) throw error;
      toast.success("Branch resumed — emails will start sending again");
      await fetchLocations();
      onChanged?.();
    } catch (err: any) {
      toast.error(err?.message || "Failed to resume branch");
    } finally {
      setWorking(false);
    }
  };

  return (
    <Card className="border-border/40">
      <CardHeader className="flex flex-row items-start justify-between gap-3 flex-wrap pb-3">
        <div>
          <CardTitle className="text-base font-medium">Restaurant Locations</CardTitle>
          <CardDescription>
            {locations.filter((l) => l.status === "active").length} active
            {locations.filter((l) => l.status === "inactive").length > 0 &&
              ` · ${locations.filter((l) => l.status === "inactive").length} inactive`}
            {locations.filter((l) => l.status === "archived").length > 0 &&
              ` · ${locations.filter((l) => l.status === "archived").length} archived`}
          </CardDescription>
        </div>
        <Button size="sm" onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" /> Add location
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, currency, or timezone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
          <div className="text-xs text-muted-foreground ml-auto">
            {filtered.length} of {locations.length}
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <button
                  onClick={() => toggleSort("name")}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  Name <ArrowUpDown className="h-3 w-3 opacity-60" />
                </button>
              </TableHead>
              <TableHead>Currency</TableHead>
              <TableHead>Timezone</TableHead>
              <TableHead>
                <button
                  onClick={() => toggleSort("status")}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  Status <ArrowUpDown className="h-3 w-3 opacity-60" />
                </button>
              </TableHead>
              <TableHead>
                <button
                  onClick={() => toggleSort("created")}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  Created <ArrowUpDown className="h-3 w-3 opacity-60" />
                </button>
              </TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  Loading locations…
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No locations match the current filters.
                </TableCell>
              </TableRow>
            ) : (
              paginatedItems.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {l.name}
                      {l.is_primary && (
                        <Badge className="gap-1 bg-primary/10 text-primary border-primary/20 hover:bg-primary/10">
                          <Star className="h-3 w-3" /> Primary
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">
                    {l.currency}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">{l.timezone}</TableCell>
                  <TableCell>
                    {l.status === "archived" ? (
                      <Badge variant="destructive">Archived</Badge>
                    ) : l.status === "inactive" ? (
                      <Badge variant="secondary" className="gap-1 bg-slate-200 text-slate-700 border-slate-300 hover:bg-slate-200">
                        <PowerOff className="h-3 w-3" />
                        Inactive
                      </Badge>
                    ) : l.status === "suspended" ? (
                      <Badge variant="secondary">Suspended</Badge>
                    ) : isPausedNow(l) ? (
                      <Badge variant="secondary" className="gap-1 bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100">
                        <PauseCircle className="h-3 w-3" />
                        Paused · resumes {formatDistanceToNow(new Date(l.paused_until!), { addSuffix: true })}
                      </Badge>
                    ) : (
                      <Badge variant="default">Active</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {format(new Date(l.created_at), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(l)} className="gap-1">
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                    {l.status === "active" && (
                      isPausedNow(l) ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => resumeBranch(l)}
                          disabled={working}
                          className="gap-1 text-emerald-600 hover:text-emerald-600"
                        >
                          <PlayCircle className="h-3.5 w-3.5" /> Resume
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openPause(l)}
                          className="gap-1 text-amber-600 hover:text-amber-600"
                        >
                          <PauseCircle className="h-3.5 w-3.5" /> Pause
                        </Button>
                      )
                    )}
                    {l.status !== "archived" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setInactiveTarget(l)}
                        disabled={l.is_primary && l.status === "active"}
                        className={
                          l.status === "inactive"
                            ? "gap-1 text-emerald-600 hover:text-emerald-600"
                            : "gap-1 text-slate-600 hover:text-slate-700"
                        }
                        title={
                          l.is_primary && l.status === "active"
                            ? "Primary locations cannot be deactivated"
                            : undefined
                        }
                      >
                        {l.status === "inactive" ? (
                          <>
                            <Power className="h-3.5 w-3.5" /> Activate
                          </>
                        ) : (
                          <>
                            <PowerOff className="h-3.5 w-3.5" /> Deactivate
                          </>
                        )}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setArchiveTarget(l)}
                      disabled={l.is_primary && l.status === "active"}
                      className={
                        l.status === "archived"
                          ? "gap-1 text-emerald-600 hover:text-emerald-600"
                          : "gap-1 text-destructive hover:text-destructive"
                      }
                    >
                      {l.status === "archived" ? (
                        <>
                          <ArchiveRestore className="h-3.5 w-3.5" /> Restore
                        </>
                      ) : (
                        <>
                          <Archive className="h-3.5 w-3.5" /> Archive
                        </>
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {filtered.length > 0 && (
          <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Rows per page</span>
              <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                <SelectTrigger className="h-8 w-[72px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[10, 25, 50, 100].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>
                {(safePage - 1) * pageSize + 1}–
                {Math.min(safePage * pageSize, filtered.length)} of{" "}
                {filtered.length}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit location" : "Add location"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="l-name">Name</Label>
              <Input
                id="l-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Riyadh HQ"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Currency</Label>
                <Select
                  value={form.currency}
                  onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Timezone</Label>
                <Select
                  value={form.timezone}
                  onValueChange={(v) => setForm((f) => ({ ...f, timezone: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map((tz) => (
                      <SelectItem key={tz} value={tz}>
                        {tz}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Create location"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!archiveTarget} onOpenChange={(o) => !o && setArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-center gap-3">
              <div
                className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${
                  archiveTarget?.status === "archived"
                    ? "bg-emerald-100 text-emerald-600"
                    : "bg-destructive/10 text-destructive"
                }`}
              >
                {archiveTarget?.status === "archived" ? (
                  <ArchiveRestore className="h-5 w-5" />
                ) : (
                  <AlertTriangle className="h-5 w-5" />
                )}
              </div>
              <AlertDialogTitle className="text-lg">
                {archiveTarget?.status === "archived"
                  ? "Restore this location?"
                  : "Archive this location?"}
              </AlertDialogTitle>
            </div>
            <AlertDialogDescription className="text-sm leading-relaxed pt-1">
              You are about to{" "}
              <span className="font-semibold text-foreground">
                {archiveTarget?.status === "archived" ? "restore" : "archive"}
              </span>{" "}
              <span className="font-semibold text-foreground">{archiveTarget?.name}</span>.
              {archiveTarget?.status === "archived" ? (
                <>
                  {" "}This will reactivate the location and make it visible across the app again.
                </>
              ) : (
                <>
                  {" "}This will hide it from active lists. All existing data (sales, shifts,
                  inventory) remains intact and the location can be restored at any time. Primary
                  locations cannot be archived.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmArchive();
              }}
              disabled={working}
              className={
                archiveTarget?.status === "archived"
                  ? "bg-emerald-600 text-white hover:bg-emerald-700"
                  : "bg-destructive text-destructive-foreground hover:bg-destructive/90"
              }
            >
              {working
                ? "Working…"
                : archiveTarget?.status === "archived"
                ? "Yes, restore"
                : "Yes, archive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!inactiveTarget} onOpenChange={(o) => !o && setInactiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-center gap-3">
              <div
                className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${
                  inactiveTarget?.status === "inactive"
                    ? "bg-emerald-100 text-emerald-600"
                    : "bg-slate-200 text-slate-700"
                }`}
              >
                {inactiveTarget?.status === "inactive" ? (
                  <Power className="h-5 w-5" />
                ) : (
                  <PowerOff className="h-5 w-5" />
                )}
              </div>
              <AlertDialogTitle className="text-lg">
                {inactiveTarget?.status === "inactive"
                  ? "Reactivate this location?"
                  : "Mark this location as inactive?"}
              </AlertDialogTitle>
            </div>
            <AlertDialogDescription className="text-sm leading-relaxed pt-1">
              You are about to{" "}
              <span className="font-semibold text-foreground">
                {inactiveTarget?.status === "inactive" ? "reactivate" : "deactivate"}
              </span>{" "}
              <span className="font-semibold text-foreground">{inactiveTarget?.name}</span>.
              {inactiveTarget?.status === "inactive" ? (
                <> The location will resume normal operation and automated emails will start sending again.</>
              ) : (
                <> The location stays in the system with all of its data, but operations are paused indefinitely and automated emails will stop. Use Archive instead if you want to soft-delete it. Primary locations cannot be deactivated.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmInactive();
              }}
              disabled={working}
              className={
                inactiveTarget?.status === "inactive"
                  ? "bg-emerald-600 text-white hover:bg-emerald-700"
                  : "bg-slate-700 text-white hover:bg-slate-800"
              }
            >
              {working
                ? "Working…"
                : inactiveTarget?.status === "inactive"
                ? "Yes, reactivate"
                : "Yes, deactivate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!pauseTarget} onOpenChange={(o) => !o && setPauseTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PauseCircle className="h-5 w-5 text-amber-600" />
              Temporarily turn off {pauseTarget?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground leading-relaxed">
              The branch stays in the system but the platform will{" "}
              <span className="font-medium text-foreground">stop sending automated emails</span>{" "}
              (daily profit summary, WhatsApp summary, inventory expiry alerts) until the pause ends.
              The branch resumes automatically.
            </p>
            <div>
              <Label htmlFor="pause-days">Pause for</Label>
              <div className="flex items-center gap-2 mt-1">
                <Input
                  id="pause-days"
                  type="number"
                  min={1}
                  max={90}
                  value={pauseDays}
                  onChange={(e) => setPauseDays(Math.max(1, Number(e.target.value) || 1))}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">day(s)</span>
                <span className="text-xs text-muted-foreground ml-auto">
                  Resumes{" "}
                  {format(
                    new Date(Date.now() + pauseDays * 24 * 60 * 60 * 1000),
                    "MMM d, yyyy",
                  )}
                </span>
              </div>
            </div>
            <div>
              <Label htmlFor="pause-reason">Reason (optional)</Label>
              <Input
                id="pause-reason"
                value={pauseReason}
                onChange={(e) => setPauseReason(e.target.value)}
                placeholder="e.g. Renovation, public holiday closure"
                maxLength={200}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPauseTarget(null)} disabled={working}>
              Cancel
            </Button>
            <Button
              onClick={confirmPause}
              disabled={working}
              className="bg-amber-600 text-white hover:bg-amber-700"
            >
              {working ? "Pausing…" : "Pause branch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
