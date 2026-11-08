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
import { Plus, Star, Trash2, Search, Pencil, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";

interface Restaurant {
  id: string;
  name: string;
}

interface Branch {
  id: string;
  restaurant_id: string;
  name: string;
  code: string | null;
  address: string | null;
  phone: string | null;
  is_primary: boolean;
  is_active: boolean;
  created_at: string;
  deleted_at: string | null;
}

interface Props {
  restaurants: Restaurant[];
}

const EMPTY = { name: "", code: "", address: "", phone: "" };

export function TenantBranchesManager({ restaurants }: Props) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [restaurantId, setRestaurantId] = useState<string>("");
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Branch | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [showArchived, setShowArchived] = useState(false);
  const [sortKey, setSortKey] = useState<"name" | "code" | "location" | "status" | "created">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);

  const restaurantIds = useMemo(() => restaurants.map((r) => r.id), [restaurants]);
  const restaurantName = (id: string) =>
    restaurants.find((r) => r.id === id)?.name ?? "-";

  const filteredBranches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = branches.filter((b) => {
      if (showArchived) {
        // When viewing archived, only show branches with deleted_at set
        if (!b.deleted_at) return false;
      } else {
        // When viewing active, only show branches without deleted_at
        if (b.deleted_at) return false;
        if (statusFilter === "active" && !b.is_active) return false;
        if (statusFilter === "inactive" && b.is_active) return false;
      }
      if (!q) return true;
      return (
        b.name.toLowerCase().includes(q) ||
        (b.code?.toLowerCase().includes(q) ?? false) ||
        (b.address?.toLowerCase().includes(q) ?? false)
      );
    });

    const dir = sortDir === "asc" ? 1 : -1;
    const cmp = (a: string | number | null, b: string | number | null) => {
      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;
      if (typeof a === "number" && typeof b === "number") return (a - b) * dir;
      return String(a).localeCompare(String(b)) * dir;
    };

    list.sort((a, b) => {
      // Primary branch always pinned to the top regardless of sort.
      if (a.is_primary && !b.is_primary) return -1;
      if (!a.is_primary && b.is_primary) return 1;
      switch (sortKey) {
        case "code":
          return cmp(a.code, b.code);
        case "location":
          return cmp(restaurantName(a.restaurant_id), restaurantName(b.restaurant_id));
        case "status":
          return cmp(Number(a.is_active), Number(b.is_active));
        case "created":
          return cmp(a.created_at, b.created_at);
        case "name":
        default:
          return cmp(a.name.toLowerCase(), b.name.toLowerCase());
      }
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branches, searchQuery, statusFilter, showArchived, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredBranches.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedBranches = useMemo(
    () => filteredBranches.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filteredBranches, safePage, pageSize],
  );

  // Reset to first page whenever filters/sort change.
  useEffect(() => {
    setPage(1);
  }, [searchQuery, statusFilter, showArchived, sortKey, sortDir, pageSize]);

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const fetchBranches = async () => {
    if (restaurantIds.length === 0) {
      setBranches([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const query = supabase
      .from("branches" as any)
      .select("id, restaurant_id, name, code, address, phone, is_primary, is_active, created_at, deleted_at")
      .in("restaurant_id", restaurantIds)
      .order("is_primary", { ascending: false })
      .order("name", { ascending: true });

    // If not showing archived, filter out deleted branches
    if (!showArchived) {
      (query as any).is("deleted_at", null);
    }

    const { data, error } = await query;
    if (error) {
      toast.error(error.message);
    } else {
      setBranches((data || []) as unknown as Branch[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchBranches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantIds.join(","), showArchived]);

  const openCreate = () => {
    setEditingBranch(null);
    setForm(EMPTY);
    setRestaurantId(restaurants[0]?.id ?? "");
    setDialogOpen(true);
  };

  const openEdit = (b: Branch) => {
    setEditingBranch(b);
    setForm({
      name: b.name,
      code: b.code ?? "",
      address: b.address ?? "",
      phone: b.phone ?? "",
    });
    setRestaurantId(b.restaurant_id);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (editingBranch) {
      await handleUpdate();
    } else {
      await handleCreate();
    }
  };

  const handleCreate = async () => {
    if (!restaurantId) {
      toast.error("Select a location");
      return;
    }
    if (!form.name.trim()) {
      toast.error("Branch name is required");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-branch", {
        body: {
          restaurant_id: restaurantId,
          name: form.name.trim(),
          code: form.code.trim() || null,
          address: form.address.trim() || null,
          phone: form.phone.trim() || null,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Branch created");
      setDialogOpen(false);
      fetchBranches();
    } catch (err: any) {
      toast.error(err?.message || "Failed to create branch");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingBranch) return;
    if (!form.name.trim()) {
      toast.error("Branch name is required");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("update_branch", {
        _branch_id: editingBranch.id,
        _name: form.name.trim(),
        _code: form.code.trim() || null,
        _address: form.address.trim() || null,
        _phone: form.phone.trim() || null,
        _restaurant_id: restaurantId || null,
      } as any);
      if (error) throw error;
      toast.success("Branch updated");
      setDialogOpen(false);
      setEditingBranch(null);
      fetchBranches();
    } catch (err: any) {
      toast.error(err?.message || "Failed to update branch");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { error } = await supabase
        .from("branches" as any)
        .update({ deleted_at: new Date().toISOString(), is_active: false })
        .eq("id", deleteTarget.id);
      if (error) throw error;
      toast.success("Branch archived");
      setDeleteTarget(null);
      fetchBranches();
    } catch (err: any) {
      toast.error(err?.message || "Failed to archive branch");
    } finally {
      setDeleting(false);
    }
  };

  const restoreBranch = async (b: Branch) => {
    try {
      const { error } = await supabase
        .from("branches" as any)
        .update({ deleted_at: null, is_active: true })
        .eq("id", b.id);
      if (error) throw error;
      toast.success("Branch restored");
      fetchBranches();
    } catch (err: any) {
      toast.error(err?.message || "Failed to restore branch");
    }
  };

  return (
    <Card className="border-border/40">
      <CardHeader className="flex flex-row items-start justify-between gap-3 flex-wrap pb-3">
        <div>
          <CardTitle className="text-base font-medium">Branches</CardTitle>
          <CardDescription>
            {showArchived
              ? `${branches.filter((b) => b.deleted_at).length} archived`
              : `${branches.filter((b) => !b.deleted_at).length} active across ${restaurants.length} location${restaurants.length === 1 ? "" : "s"}`}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center rounded-md border bg-muted p-0.5 text-xs">
            <button
              onClick={() => setShowArchived(false)}
              className={`px-3 py-1 rounded-sm transition-colors ${
                !showArchived ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              Active
            </button>
            <button
              onClick={() => setShowArchived(true)}
              className={`px-3 py-1 rounded-sm transition-colors ${
                showArchived ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              Archived
            </button>
          </div>
          {!showArchived && (
            <Button size="sm" onClick={openCreate} disabled={restaurants.length === 0} className="gap-2">
              <Plus className="h-4 w-4" /> Add branch
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, code, or address…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>
          {!showArchived && (
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
            >
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          )}
          <div className="text-xs text-muted-foreground ml-auto">
            {filteredBranches.length} of {branches.length}
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
              <TableHead>
                <button
                  onClick={() => toggleSort("location")}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  Location <ArrowUpDown className="h-3 w-3 opacity-60" />
                </button>
              </TableHead>
              <TableHead>
                <button
                  onClick={() => toggleSort("code")}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  Code <ArrowUpDown className="h-3 w-3 opacity-60" />
                </button>
              </TableHead>
              <TableHead>
                <button
                  onClick={() => toggleSort("status")}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  Status <ArrowUpDown className="h-3 w-3 opacity-60" />
                </button>
              </TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  Loading branches…
                </TableCell>
              </TableRow>
            ) : branches.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  {showArchived ? "No archived branches" : "No branches yet"}
                </TableCell>
              </TableRow>
            ) : filteredBranches.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  {showArchived
                    ? "No archived branches match the current filters."
                    : "No branches match the current filters."}
                </TableCell>
              </TableRow>
            ) : (
              paginatedBranches.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {b.name}
                      {b.is_primary && (
                        <Badge className="gap-1 bg-primary/10 text-primary border-primary/20 hover:bg-primary/10">
                          <Star className="h-3 w-3" /> Primary
                        </Badge>
                      )}
                    </div>
                    {b.address && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {b.address}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {restaurantName(b.restaurant_id)}
                  </TableCell>
                  <TableCell>
                    {b.code ? (
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {b.code}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {b.deleted_at ? (
                      <Badge variant="destructive">Archived</Badge>
                    ) : (
                      <Badge variant={b.is_active ? "default" : "secondary"}>
                        {b.is_active ? "Active" : "Inactive"}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {b.deleted_at ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => restoreBranch(b)}
                        className="gap-1"
                      >
                        <Plus className="h-3.5 w-3.5" /> Restore
                      </Button>
                    ) : (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(b)}
                          className="gap-1"
                        >
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteTarget(b)}
                          disabled={b.is_primary}
                          className="gap-1 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {filteredBranches.length > 0 && (
          <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Rows per page</span>
              <Select
                value={String(pageSize)}
                onValueChange={(v) => setPageSize(Number(v))}
              >
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
                {Math.min(safePage * pageSize, filteredBranches.length)} of{" "}
                {filteredBranches.length}
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
            <DialogTitle>
              {editingBranch ? "Edit branch" : "Add branch"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Location</Label>
              <Select
                value={restaurantId}
                onValueChange={setRestaurantId}
                disabled={!!editingBranch && editingBranch.is_primary}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select location" />
                </SelectTrigger>
                <SelectContent>
                  {restaurants.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editingBranch && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  {editingBranch.is_primary
                    ? "Primary branches stay with their location."
                    : "Moving a branch is only allowed if it has no sales, shifts, or other records yet."}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="b-name">Name</Label>
              <Input
                id="b-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Jeddah - Tahlia"
              />
            </div>
            <div>
              <Label htmlFor="b-code">Short code</Label>
              <Input
                id="b-code"
                value={form.code}
                onChange={(e) =>
                  setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))
                }
                placeholder="JED-01"
                maxLength={16}
              />
            </div>
            <div>
              <Label htmlFor="b-address">Address</Label>
              <Input
                id="b-address"
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="b-phone">Phone</Label>
              <Input
                id="b-phone"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving
                ? "Saving…"
                : editingBranch
                ? "Save changes"
                : "Create branch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this branch?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">
                {deleteTarget?.name}
              </span>{" "}
              will be archived and removed from active lists. Existing records
              keep their reference.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete branch"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}