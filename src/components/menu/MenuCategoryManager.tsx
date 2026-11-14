import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Plus, Trash2, Save, Building2, Globe, GripVertical, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  CATEGORY_COLORS,
  MenuCategory,
  categoryColorClass,
  slugifyCategoryKey,
  useMenuCategories,
} from "@/hooks/useMenuCategories";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Category counts by key, used to warn before deleting. */
  itemCounts: Record<string, number>;
}

const SHARED = "__shared__";

type CategoryFilter = "all" | "default" | "override" | "branch-only" | "inherited";

const FILTER_LABELS: Record<CategoryFilter, string> = {
  all: "All",
  default: "Tenant default",
  override: "Overridden",
  "branch-only": "Branch only",
  inherited: "Inherited",
};

const FILTER_STORAGE_KEY = "matbex.menu-category-filter";



export function MenuCategoryManager({ open, onOpenChange, itemCounts }: Props) {
  const { restaurant, tenant } = useAuth();
  const { branches } = useBranch();
  const qc = useQueryClient();
  const { allCategories, isLoading } = useMenuCategories();

  const [scope, setScope] = useState<string>(SHARED);
  const [filter, setFilter] = useState<CategoryFilter>("all");
  const [draft, setDraft] = useState({ name_en: "", name_ar: "", color: "blue" });
  const [edits, setEdits] = useState<Record<string, Partial<MenuCategory>>>({});
  const [deleting, setDeleting] = useState<MenuCategory | null>(null);
  const [reassignTo, setReassignTo] = useState<string>("");
  const [order, setOrder] = useState<string[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [selectedInherited, setSelectedInherited] = useState<Record<string, boolean>>({});
  const [reverting, setReverting] = useState<MenuCategory | null>(null);

  const branchId = scope === SHARED ? null : scope;

  // Reset the scope filter when switching between shared and branch scopes.
  useEffect(() => {
    setFilter("all");
  }, [scope]);

  // Restore the last-used category filter from localStorage on open.
  useEffect(() => {
    if (!open) return;
    try {
      const saved = localStorage.getItem(FILTER_STORAGE_KEY) as CategoryFilter | null;
      if (saved && saved in FILTER_LABELS) {
        setFilter(saved);
      }
    } catch {
      // Ignore storage errors (e.g. private browsing mode).
    }
  }, [open]);

  // Persist the active category filter whenever the user changes it.
  useEffect(() => {
    try {
      localStorage.setItem(FILTER_STORAGE_KEY, filter);
    } catch {
      // Ignore storage errors.
    }
  }, [filter]);



  const baseRows = useMemo(
    () =>
      allCategories
        .filter((c) => (branchId ? c.branch_id === branchId : !c.branch_id))
        .sort((a, b) => a.display_order - b.display_order || a.name_en.localeCompare(b.name_en)),
    [allCategories, branchId],
  );

  // Keep a local ordering so drag-and-drop feels instant; it is reconciled
  // with the server list whenever the scope or data changes.
  useEffect(() => {
    setOrder(baseRows.map((r) => r.id));
  }, [baseRows]);

  const rows = useMemo(() => {
    const byId = new Map(baseRows.map((r) => [r.id, r]));
    const ordered = order.map((id) => byId.get(id)).filter(Boolean) as MenuCategory[];
    const missing = baseRows.filter((r) => !order.includes(r.id));
    return [...ordered, ...missing];
  }, [baseRows, order]);

  const sharedKeys = useMemo(
    () => new Set(allCategories.filter((c) => !c.branch_id).map((c) => c.key)),
    [allCategories],
  );

  /** Tenant defaults that this branch has not overridden yet. */
  const inheritedRows = useMemo(() => {
    if (!branchId) return [] as MenuCategory[];
    return allCategories.filter((c) => !c.branch_id && !rows.some((r) => r.key === c.key));
  }, [allCategories, branchId, rows]);

  const filteredRows = useMemo(() => {
    if (filter === "all") return rows;
    if (!branchId) return filter === "default" ? rows : [];
    return rows.filter((row) => {
      const hasShared = sharedKeys.has(row.key);
      if (filter === "override") return row.branch_id && hasShared;
      if (filter === "branch-only") return row.branch_id && !hasShared;
      return false; // default / inherited are surfaced via filteredInheritedRows
    });
  }, [rows, filter, branchId, sharedKeys]);

  const filteredInheritedRows = useMemo(() => {
    if (!branchId) return [];
    if (filter === "all" || filter === "default" || filter === "inherited") return inheritedRows;
    return [];
  }, [inheritedRows, filter, branchId]);


  useEffect(() => {
    setSelectedInherited({});
  }, [branchId, filter]);

  const selectedInheritedRows = useMemo(
    () => filteredInheritedRows.filter((c) => selectedInherited[c.id]),
    [filteredInheritedRows, selectedInherited],
  );


  /** How many branch-specific overrides exist per shared category key. */
  const overrideCounts = useMemo(() => {
    const m: Record<string, number> = {};
    allCategories
      .filter((c) => c.branch_id)
      .forEach((c) => {
        m[c.key] = (m[c.key] || 0) + 1;
      });
    return m;
  }, [allCategories]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["menu-categories"] });
    qc.invalidateQueries({ queryKey: ["menu-items"] });
  };

  const reorderMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const updates = ids.map((id, index) =>
        db
          .from("menu_categories")
          .update({ display_order: index + 1 } as any)
          .eq("id", id),
      );
      const results = await Promise.all(updates);
      const failed = results.find((r) => r.error);
      if (failed?.error) throw failed.error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Category order saved");
    },
    onError: () => {
      setOrder(baseRows.map((r) => r.id));
      toast.error("Failed to save category order");
    },
  });

  const handleDrop = (targetId: string) => {
    const sourceId = dragId;
    setDragId(null);
    setOverId(null);
    if (!sourceId || sourceId === targetId) return;
    const current = rows.map((r) => r.id);
    const from = current.indexOf(sourceId);
    const to = current.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = [...current];
    next.splice(to, 0, next.splice(from, 1)[0]);
    setOrder(next);
    reorderMutation.mutate(next);
  };

  const addMutation = useMutation({
    mutationFn: async () => {
      const name = draft.name_en.trim();
      if (!name) throw new Error("English name is required");
      const key = slugifyCategoryKey(name);
      if (!key) throw new Error("Enter a name with latin letters or numbers");
      if (rows.some((r) => r.key === key)) throw new Error("That category already exists in this scope");
      const { error } = await db.from("menu_categories").insert({
        tenant_id: tenant?.id,
        restaurant_id: restaurant?.id,
        branch_id: branchId,
        key,
        name_en: name,
        name_ar: draft.name_ar.trim() || null,
        color: draft.color,
        display_order: (rows[rows.length - 1]?.display_order ?? 0) + 1,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      setDraft({ name_en: "", name_ar: "", color: "blue" });
      invalidate();
      toast.success("Category added");
    },
    onError: (e: any) => toast.error(e.message || "Failed to add category"),
  });

  const saveMutation = useMutation({
    mutationFn: async (row: MenuCategory) => {
      const patch = edits[row.id];
      if (!patch) return;
      const { error } = await db
        .from("menu_categories")
        .update({
          name_en: (patch.name_en ?? row.name_en) || row.name_en,
          name_ar: (patch.name_ar ?? row.name_ar) || null,
          color: patch.color ?? row.color,
          display_order: Number(patch.display_order ?? row.display_order) || 0,
          is_active: patch.is_active ?? row.is_active,
        } as any)
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: (_d, row) => {
      setEdits((p) => {
        const n = { ...p };
        delete n[row.id];
        return n;
      });
      invalidate();
      toast.success("Category updated");
    },
    onError: () => toast.error("Failed to update category"),
  });

  const copyToBranch = useMutation({
    mutationFn: async (row: MenuCategory) => {
      const { error } = await db.from("menu_categories").insert({
        tenant_id: tenant?.id,
        restaurant_id: restaurant?.id,
        branch_id: branchId,
        key: row.key,
        name_en: row.name_en,
        name_ar: row.name_ar,
        color: row.color,
        display_order: row.display_order,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Override created for this branch");
    },
    onError: () => toast.error("Failed to create branch override"),
  });

  const bulkOverride = useMutation({
    mutationFn: async (cats: MenuCategory[]) => {
      if (!cats.length) throw new Error("Select at least one category");
      const { error } = await db.from("menu_categories").insert(
        cats.map((row) => ({
          tenant_id: tenant?.id,
          restaurant_id: restaurant?.id,
          branch_id: branchId,
          key: row.key,
          name_en: row.name_en,
          name_ar: row.name_ar,
          color: row.color,
          display_order: row.display_order,
        })) as any,
      );
      if (error) throw error;
      return cats.length;
    },
    onSuccess: (count) => {
      setSelectedInherited({});
      invalidate();
      toast.success(`${count} branch override${count > 1 ? "s" : ""} created`);
    },
    onError: (e: any) => toast.error(e.message || "Failed to create branch overrides"),
  });

  /** Deletes the branch-specific copy so the branch falls back to the tenant default. */
  const revertOverride = useMutation({
    mutationFn: async (row: MenuCategory) => {
      const { error } = await db.from("menu_categories").delete().eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      setReverting(null);
      invalidate();
      toast.success("Reverted to the tenant default");
    },
    onError: () => toast.error("Failed to revert override"),
  });

  // Live list of the menu items that will be moved by the bulk reassign step.
  const { data: affectedItems = [], isLoading: loadingAffected } = useQuery({
    queryKey: ["menu-category-affected-items", restaurant?.id, deleting?.key],
    enabled: !!restaurant?.id && !!deleting && !deleting.branch_id,
    queryFn: async () => {
      const { data, error } = await db
        .from("menu_items")
        .select("id, name, category")
        .eq("restaurant_id", restaurant!.id)
        .eq("category", deleting!.key)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data || []) as { id: string; name: string; category: string }[];
    },
  });

  const affectedCount = deleting?.branch_id
    ? 0
    : affectedItems.length || itemCounts[deleting?.key || ""] || 0;

  // Deleting a shared category must first move its items elsewhere.
  const needsReassign = !!deleting && !deleting.branch_id && affectedCount > 0;
  const [movedCount, setMovedCount] = useState(0);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!deleting) return;
      let moved = 0;
      if (needsReassign) {
        if (!reassignTo) throw new Error("Choose a category to move the items to");
        // Bulk reassign: every affected item moves to the replacement in one statement.
        const { data: movedRows, error: moveErr } = await db
          .from("menu_items")
          .update({ category: reassignTo })
          .eq("restaurant_id", restaurant?.id)
          .eq("category", deleting.key)
          .select("id");
        if (moveErr) throw moveErr;
        moved = movedRows?.length ?? affectedCount;
      }
      setMovedCount(moved);

      if (deleting.branch_id) {
        const { error } = await db.from("menu_categories").delete().eq("id", deleting.id);
        if (error) throw error;
      } else {
        // Removing a shared category also removes its per-branch overrides so
        // no branch keeps pointing at a key that no longer exists.
        const { error } = await db
          .from("menu_categories")
          .delete()
          .eq("restaurant_id", restaurant?.id)
          .eq("key", deleting.key);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      const moved = movedCount > 0 ? ` · ${movedCount} item(s) moved` : "";
      setDeleting(null);
      setReassignTo("");
      invalidate();
      qc.invalidateQueries({ queryKey: ["menu-category-affected-items"] });
      toast.success(`Category deleted${moved}`);
    },
    onError: (e: any) => toast.error(e.message || "Failed to delete category"),
  });

  const reassignTargets = allCategories.filter(
    (c) => !c.branch_id && c.key !== deleting?.key,
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Menu categories</DialogTitle>
            <DialogDescription>
              Shared categories apply to every branch. Add a branch scope to rename,
              recolour or extend them for one location only.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Scope</Label>
              <Select value={scope} onValueChange={setScope}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SHARED}>All branches (shared)</SelectItem>
                  {branches.filter((b) => b.is_active).map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Show</Label>
                <span className="text-[11px] text-muted-foreground">
                  {filter === "all" ? "Drag the handle to reorder" : "Reordering disabled while filtering"}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(FILTER_LABELS) as CategoryFilter[]).map((key) => (
                  <Button
                    key={key}
                    type="button"
                    size="sm"
                    variant={filter === key ? "default" : "outline"}
                    className="h-7 text-[11px] px-2.5"
                    onClick={() => setFilter(key)}
                  >
                    {FILTER_LABELS[key]}
                  </Button>
                ))}
              </div>
            </div>

            <ScrollArea className="max-h-[45vh] pr-3">

              <div className="space-y-2">
                {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
                {!isLoading && filteredRows.length === 0 && filteredInheritedRows.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No categories match this filter.
                  </p>
                )}

                {filteredRows.map((row) => {
                  const patch = edits[row.id] || {};
                  const dirty = Object.keys(patch).length > 0;
                  return (
                    <div
                      key={row.id}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (filter === "all" && dragId && overId !== row.id) setOverId(row.id);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (filter === "all") handleDrop(row.id);
                      }}
                      className={`grid grid-cols-12 gap-2 items-center rounded-md border p-2 transition-colors ${
                        dragId === row.id ? "opacity-50" : ""
                      } ${overId === row.id && dragId !== row.id ? "border-primary bg-primary/5" : ""}`}
                    >
                      <div
                        draggable={filter === "all"}
                        onDragStart={() => filter === "all" && setDragId(row.id)}
                        onDragEnd={() => {
                          setDragId(null);
                          setOverId(null);
                        }}
                        title={filter === "all" ? "Drag to reorder" : "Reordering disabled while filtering"}
                        aria-label={`Reorder ${row.name_en}`}
                        className={`col-span-1 flex items-center justify-center ${filter === "all" ? "cursor-grab active:cursor-grabbing" : "cursor-not-allowed opacity-50"} text-muted-foreground`}
                      >
                        <GripVertical className="h-4 w-4" />
                      </div>

                      <Input
                        className="col-span-3 h-8 text-xs"
                        value={(patch.name_en ?? row.name_en) as string}
                        onChange={(e) =>
                          setEdits((p) => ({ ...p, [row.id]: { ...patch, name_en: e.target.value } }))
                        }
                        placeholder="English name"
                      />
                      <Input
                        className="col-span-3 h-8 text-xs"
                        dir="rtl"
                        value={(patch.name_ar ?? row.name_ar ?? "") as string}
                        onChange={(e) =>
                          setEdits((p) => ({ ...p, [row.id]: { ...patch, name_ar: e.target.value } }))
                        }
                        placeholder="الاسم بالعربية"
                      />
                      <Select
                        value={(patch.color ?? row.color ?? "blue") as string}
                        onValueChange={(v) =>
                          setEdits((p) => ({ ...p, [row.id]: { ...patch, color: v } }))
                        }
                      >
                        <SelectTrigger className="col-span-2 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CATEGORY_COLORS.map((c) => (
                            <SelectItem key={c} value={c}>
                              {c}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="col-span-3 flex items-center justify-end gap-1">
                        {branchId ? (
                          <Badge
                            variant="secondary"
                            className="text-[10px] gap-1"
                            title={
                              sharedKeys.has(row.key)
                                ? "Overrides the tenant-default category for this branch"
                                : "Exists only in this branch"
                            }
                          >
                            <Building2 className="h-3 w-3" />
                            {sharedKeys.has(row.key) ? "Override" : "Branch only"}
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-[10px] gap-1"
                            title={
                              overrideCounts[row.key]
                                ? `${overrideCounts[row.key]} branch override(s) exist for this category`
                                : "Tenant default — inherited by every branch"
                            }
                          >
                            <Globe className="h-3 w-3" />
                            {overrideCounts[row.key]
                              ? `Default · ${overrideCounts[row.key]} override${overrideCounts[row.key] > 1 ? "s" : ""}`
                              : "Default"}
                          </Badge>
                        )}
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${categoryColorClass(patch.color ?? row.color)}`}
                        >
                          {itemCounts[row.key] || 0}
                        </Badge>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          disabled={!dirty || saveMutation.isPending}
                          onClick={() => saveMutation.mutate(row)}
                        >
                          <Save className="h-3.5 w-3.5" />
                        </Button>
                        {branchId && sharedKeys.has(row.key) && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            title="Revert to tenant default"
                            onClick={() => setReverting(row)}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive"
                          onClick={() => {
                            setDeleting(row);
                            setReassignTo("");
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}

                {/* Shared categories not yet overridden for this branch */}
                {branchId && filteredInheritedRows.length > 0 && (
                  <div className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1.5">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox
                        checked={
                          selectedInheritedRows.length === filteredInheritedRows.length &&
                          filteredInheritedRows.length > 0
                        }
                        onCheckedChange={(v) =>
                          setSelectedInherited(
                            v
                              ? Object.fromEntries(filteredInheritedRows.map((c) => [c.id, true]))
                              : {},
                          )
                        }
                        aria-label="Select all inherited categories"
                      />
                      Inherited defaults ({filteredInheritedRows.length})
                      {selectedInheritedRows.length > 0
                        ? ` · ${selectedInheritedRows.length} selected`
                        : ""}
                    </label>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1"
                      disabled={selectedInheritedRows.length === 0 || bulkOverride.isPending}
                      onClick={() => bulkOverride.mutate(selectedInheritedRows)}
                    >
                      <Building2 className="h-3.5 w-3.5" />
                      Override selected
                    </Button>
                  </div>
                )}
                {branchId &&
                  filteredInheritedRows.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center justify-between rounded-md border border-dashed p-2"
                      >

                        <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <Checkbox
                            checked={!!selectedInherited[c.id]}
                            onCheckedChange={(v) =>
                              setSelectedInherited((p) => ({ ...p, [c.id]: !!v }))
                            }
                            aria-label={`Select ${c.name_en}`}
                          />
                          <Globe className="h-3.5 w-3.5" />
                          {c.name_en}
                          {c.name_ar ? ` · ${c.name_ar}` : ""}
                          <Badge
                            variant="outline"
                            className="text-[10px]"
                            title="Inherited from the tenant default — not customised for this branch"
                          >
                            Inherited
                          </Badge>
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs gap-1"
                          disabled={copyToBranch.isPending || bulkOverride.isPending}
                          title="Create a branch-specific copy you can rename or recolour"
                          onClick={() => copyToBranch.mutate(c)}
                        >
                          <Building2 className="h-3.5 w-3.5" /> Override here
                        </Button>
                      </div>
                    ))}
              </div>
            </ScrollArea>

            <div className="rounded-md border p-3 space-y-2">
              <Label className="text-xs">
                New category {branchId ? "for this branch" : "(all branches)"}
              </Label>
              <div className="grid grid-cols-12 gap-2">
                <Input
                  className="col-span-4 h-8 text-xs"
                  placeholder="English name"
                  value={draft.name_en}
                  onChange={(e) => setDraft({ ...draft, name_en: e.target.value })}
                />
                <Input
                  className="col-span-4 h-8 text-xs"
                  dir="rtl"
                  placeholder="الاسم بالعربية"
                  value={draft.name_ar}
                  onChange={(e) => setDraft({ ...draft, name_ar: e.target.value })}
                />
                <Select value={draft.color} onValueChange={(v) => setDraft({ ...draft, color: v })}>
                  <SelectTrigger className="col-span-2 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_COLORS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  className="col-span-2 h-8 gap-1"
                  disabled={addMutation.isPending}
                  onClick={() => addMutation.mutate()}
                >
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!reverting} onOpenChange={(v) => !v && setReverting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revert “{reverting?.name_en}” to the tenant default?</AlertDialogTitle>
            <AlertDialogDescription>
              This branch will stop using its own copy and inherit the shared category again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {reverting && (
            <div className="rounded-md border p-3 text-xs space-y-1.5">
              {(() => {
                const def = allCategories.find((c) => !c.branch_id && c.key === reverting.key);
                return (
                  <>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">English name</span>
                      <span>
                        {reverting.name_en} → <strong>{def?.name_en ?? "—"}</strong>
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Arabic name</span>
                      <span dir="rtl">
                        {reverting.name_ar || "—"} → <strong>{def?.name_ar || "—"}</strong>
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Colour</span>
                      <span>
                        {reverting.color || "—"} → <strong>{def?.color ?? "—"}</strong>
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Menu items affected</span>
                      <span>
                        {itemCounts[reverting.key] || 0} item(s) keep this category — only the
                        branch-specific naming/colour is removed.
                      </span>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={revertOverride.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (reverting) revertOverride.mutate(reverting);
              }}
            >
              Revert to default
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.name_en}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.branch_id
                ? "This removes the branch override only. The shared category stays available."
                : needsReassign
                  ? `${affectedCount} menu item(s) use this category. Pick one replacement category — every affected item is moved in a single action, then the category (and its branch overrides) is removed.`
                  : loadingAffected
                    ? "Checking which menu items use this category…"
                    : "No menu items use this category."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {needsReassign && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label className="text-xs">Move all {affectedCount} item(s) to</Label>
              <Select value={reassignTo} onValueChange={setReassignTo}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {reassignTargets.map((c) => (
                    <SelectItem key={c.id} value={c.key}>
                      {c.name_en}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              </div>

              {affectedItems.length > 0 && (
                <div className="rounded-md border bg-muted/30 p-2">
                  <p className="text-[11px] font-medium mb-1">Items to be moved</p>
                  <ScrollArea className="max-h-32 pr-2">
                    <ul className="space-y-0.5">
                      {affectedItems.map((i) => (
                        <li key={i.id} className="text-[11px] text-muted-foreground truncate">
                          • {i.name}
                        </li>
                      ))}
                    </ul>
                  </ScrollArea>
                </div>
              )}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={(needsReassign && !reassignTo) || deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                deleteMutation.mutate();
              }}
            >
              {needsReassign
                ? `Move ${affectedCount} item(s) & delete`
                : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}