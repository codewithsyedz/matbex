import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, CopyPlus, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { db } from "@/integrations/db/client";

type Entity = "expense_category" | "supplier";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entity: Entity;
  restaurantId: string;
  /**
   * The branch to copy FROM. `null` means tenant-wide / shared rows.
   * The target picker excludes this branch.
   */
  sourceBranchId?: string | null;
  /** Pre-select a target branch. Pass `"__ALL__"` to default to "All other branches". */
  defaultTargetBranch?: string;
}

const TABLE: Record<Entity, "expense_categories" | "suppliers"> = {
  expense_category: "expense_categories",
  supplier: "suppliers",
};

const TITLE: Record<Entity, string> = {
  expense_category: "Copy categories",
  supplier: "Copy suppliers",
};

/**
 * Bulk-copies any number of expense categories or suppliers into ONE target
 * branch. Only "shared" (NULL branch) records are eligible as sources, since
 * branch-specific copies already belong to a branch.
 */
export function BulkCopyToBranchDialog({
  open,
  onOpenChange,
  entity,
  restaurantId,
  sourceBranchId = null,
  defaultTargetBranch,
}: Props) {
  const qc = useQueryClient();
  const [targetBranch, setTargetBranch] = useState<string>(defaultTargetBranch ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setSearch("");
      setTargetBranch(defaultTargetBranch ?? "");
    }
  }, [open, defaultTargetBranch]);

  const { data: branches = [] } = useQuery({
    queryKey: ["branches-for-bulk-copy", restaurantId, sourceBranchId],
    enabled: !!restaurantId && open,
    queryFn: async () => {
      const { data, error } = await db
        .from("branches")
        .select("id, name, code, is_primary")
        .eq("restaurant_id", restaurantId)
        .is("deleted_at", null)
        .eq("is_active", true)
        .order("is_primary", { ascending: false })
        .order("name");
      if (error) throw error;
      // Exclude the source branch — you can't copy a record onto itself.
      return (data || []).filter((b: any) => b.id !== sourceBranchId);
    },
  });

  const { data: items = [] } = useQuery<any[]>({
    queryKey: ["bulk-copy-items", entity, restaurantId],
    enabled: !!restaurantId && open,
    queryFn: async () => {
      const { data, error } = await db
        .from(TABLE[entity])
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  // Names already present in the target branch — disable those rows
  const alreadyInBranchNames = useMemo(() => {
    if (!targetBranch || targetBranch === "__ALL__") return new Set<string>();
    return new Set(
      items
        .filter((i: any) => i.branch_id === targetBranch)
        .map((i: any) => (i.name as string).toLowerCase())
    );
  }, [items, targetBranch]);

  // Per-branch name sets (used when copying to all branches)
  const namesByBranch = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const i of items) {
      if (!i.branch_id) continue;
      const set = map.get(i.branch_id) || new Set<string>();
      set.add((i.name as string).toLowerCase());
      map.set(i.branch_id, set);
    }
    return map;
  }, [items]);

  // Source list = rows visible in the chosen source branch. That's the
  // branch-scoped rows PLUS the tenant-wide (NULL branch) shared pool,
  // since shared items appear in every branch. When `sourceBranchId` is
  // null, only the shared pool is shown.
  const sourceRows = useMemo(
    () =>
      items.filter((i: any) =>
        sourceBranchId
          ? i.branch_id === sourceBranchId || !i.branch_id
          : !i.branch_id
      ),
    [items, sourceBranchId]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sourceRows;
    return sourceRows.filter((i: any) => i.name.toLowerCase().includes(q));
  }, [sourceRows, search]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const eligible = filtered.filter(
      (i: any) => !alreadyInBranchNames.has(i.name.toLowerCase())
    );
    if (eligible.every((i: any) => selected.has(i.id))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(eligible.map((i: any) => i.id)));
    }
  };

  const handleCopy = async () => {
    if ((!targetBranch || selected.size === 0)) return;
    setSubmitting(true);
    try {
      const sources = items.filter((i: any) => selected.has(i.id));
      const targetBranches =
        targetBranch === "__ALL__"
          ? branches.map((b: any) => b.id)
          : [targetBranch];

      const rows: any[] = [];
      for (const branchId of targetBranches) {
        const existing = namesByBranch.get(branchId) || new Set<string>();
        const newRows =
          entity === "expense_category"
            ? sources
                .filter((s: any) => !existing.has(s.name.toLowerCase()))
                .map((s: any) => ({
                  restaurant_id: restaurantId,
                  branch_id: branchId,
                  name: s.name,
                  color: s.color ?? null,
                  account_id: s.account_id ?? null,
                }))
            : sources
                .filter((s: any) => !existing.has(s.name.toLowerCase()))
                .map((s: any) => ({
                  restaurant_id: restaurantId,
                  branch_id: branchId,
                  name: s.name,
                  contact_name: s.contact_name ?? null,
                  email: s.email ?? null,
                  phone: s.phone ?? null,
                  address: s.address ?? null,
                  notes: s.notes ?? null,
                  is_active: s.is_active ?? true,
                }));
        rows.push(...newRows);
      }

      if (rows.length === 0) {
        toast.info("All selected items already exist in every target branch.");
        setSubmitting(false);
        return;
      }

      const { error } = await db.from(TABLE[entity]).insert(rows as any);
      if (error) throw error;

      const targetCount = targetBranch === "__ALL__" ? targetBranches.length : 1;
      toast.success(
        `Copied ${sources.length} ${
          entity === "expense_category" ? "categories" : "suppliers"
        } to ${targetCount === 1 ? "1 branch" : `${targetCount} branches`}`
      );
      qc.invalidateQueries({
        queryKey:
          entity === "expense_category"
            ? ["expense-categories"]
            : ["suppliers"],
      });
      qc.invalidateQueries({ queryKey: ["suppliers-active"] });
      qc.invalidateQueries({ queryKey: ["bulk-copy-items"] });
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Copy failed");
    } finally {
      setSubmitting(false);
    }
  };

  const eligibleVisible = filtered.filter(
    (i: any) => !alreadyInBranchNames.has(i.name.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="h-4 w-4" />
            {TITLE[entity]}
          </DialogTitle>
          <DialogDescription>
            Pick one branch or all other branches, then choose which{" "}
            {entity === "expense_category" ? "categories" : "suppliers"} to
            duplicate. Items already present in a target branch are skipped
            automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Target branch</Label>
            {branches.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No other active branches available to copy to.
              </p>
            )}
            <Select value={targetBranch} onValueChange={setTargetBranch}>
              <SelectTrigger>
                <SelectValue placeholder="Select a branch" />
              </SelectTrigger>
              <SelectContent>
                {branches.length > 1 && (
                  <SelectItem value="__ALL__">
                    <span className="font-medium">All other branches</span>
                    <span className="ml-1 text-muted-foreground">
                      ({branches.length} branches)
                    </span>
                  </SelectItem>
                )}
                {branches.map((b: any) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                    {b.code ? ` · ${b.code}` : ""}
                    {b.is_primary ? " (Primary)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label>
                {entity === "expense_category" ? "Categories" : "Suppliers"} to
                copy
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  ({sourceRows.length} available)
                </span>
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={toggleAll}
                disabled={eligibleVisible.length === 0}
                className="h-7 text-xs"
              >
                {eligibleVisible.every((i: any) => selected.has(i.id)) &&
                eligibleVisible.length > 0
                  ? "Clear"
                  : "Select all"}
              </Button>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="pl-8 h-9"
              />
            </div>
            <ScrollArea className="h-[280px] rounded-md border">
              <div className="p-1">
                {filtered.length === 0 && (
                  <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                    No {entity === "expense_category" ? "categories" : "suppliers"}{" "}
                    available to copy.
                  </p>
                )}
                {filtered.map((i: any) => {
                  const already = alreadyInBranchNames.has(
                    i.name.toLowerCase()
                  );
                  return (
                    <label
                      key={i.id}
                      className={`flex items-center justify-between gap-3 rounded-sm px-2 py-1.5 ${
                        already
                          ? "opacity-50"
                          : "cursor-pointer hover:bg-muted/50"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Checkbox
                          checked={selected.has(i.id)}
                          disabled={already}
                          onCheckedChange={() => !already && toggle(i.id)}
                        />
                        {entity === "expense_category" && (
                          <span
                            className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: i.color || "#888" }}
                          />
                        )}
                        <span className="text-sm truncate">{i.name}</span>
                      </div>
                      {already && (
                        <Badge variant="outline" className="text-[10px]">
                          Already in branch
                        </Badge>
                      )}
                    </label>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleCopy}
            disabled={submitting || !targetBranch || selected.size === 0}
          >
            {submitting
              ? "Copying…"
              : targetBranch === "__ALL__"
                ? `Copy ${selected.size || ""} to all branches`.trim()
                : `Copy ${selected.size || ""} to branch`.trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}