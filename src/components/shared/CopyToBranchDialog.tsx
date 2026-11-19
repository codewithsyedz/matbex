import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { db } from "@/integrations/db/client";

type Entity = "expense_category" | "supplier";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entity: Entity;
  restaurantId: string;
  source: Record<string, any> | null;
  /** Optional label shown in the header (e.g. category or supplier name) */
  sourceLabel?: string;
}

const ENTITY_LABEL: Record<Entity, string> = {
  expense_category: "expense category",
  supplier: "supplier",
};

/**
 * Copies a tenant-wide expense category or supplier to one or more branches
 * by duplicating the row with `branch_id` set. NULL branch_id = shared.
 */
export function CopyToBranchDialog({
  open,
  onOpenChange,
  entity,
  restaurantId,
  source,
  sourceLabel,
}: Props) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) setSelected(new Set());
  }, [open]);

  const { data: branches = [] } = useQuery({
    queryKey: ["branches-for-copy", restaurantId],
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
      return data || [];
    },
  });

  // Find branches that already have a copy of this record (by name)
  const { data: existing = [] } = useQuery({
    queryKey: [
      "copy-to-branch-existing",
      entity,
      restaurantId,
      source?.name,
    ],
    enabled: !!restaurantId && open && !!source?.name,
    queryFn: async () => {
      const table = entity === "expense_category" ? "expense_categories" : "suppliers";
      const { data, error } = await db
        .from(table)
        .select("branch_id")
        .eq("restaurant_id", restaurantId)
        .ilike("name", source!.name);
      if (error) throw error;
      return (data || []).map((r: any) => r.branch_id).filter(Boolean) as string[];
    },
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleCopy = async () => {
    if (!source || selected.size === 0) return;
    setSubmitting(true);
    try {
      const ids = Array.from(selected);
      if (entity === "expense_category") {
        const rows = ids.map((branch_id) => ({
          restaurant_id: restaurantId,
          branch_id,
          name: source.name,
          color: source.color ?? null,
          account_id: source.account_id ?? null,
        }));
        const { error } = await db.from("expense_categories").insert(rows);
        if (error) throw error;
      } else {
        const rows = ids.map((branch_id) => ({
          restaurant_id: restaurantId,
          branch_id,
          name: source.name,
          contact_name: source.contact_name ?? null,
          email: source.email ?? null,
          phone: source.phone ?? null,
          address: source.address ?? null,
          notes: source.notes ?? null,
          is_active: source.is_active ?? true,
        }));
        const { error } = await db.from("suppliers").insert(rows);
        if (error) throw error;
      }

      toast.success(
        `Copied ${ENTITY_LABEL[entity]} to ${ids.length} branch${ids.length === 1 ? "" : "es"}`
      );
      qc.invalidateQueries({
        queryKey:
          entity === "expense_category" ? ["expense-categories"] : ["suppliers"],
      });
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Copy failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="h-4 w-4" />
            Copy to branch
          </DialogTitle>
          <DialogDescription>
            Duplicate{" "}
            <span className="font-medium text-foreground">
              {sourceLabel || source?.name || "this item"}
            </span>{" "}
            into the selected branches. A NULL-branch record stays available
            tenant-wide.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[50vh] -mx-1 px-1">
          <div className="space-y-1.5">
            {branches.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No active branches found.
              </p>
            )}
            {branches.map((b: any) => {
              const already = existing.includes(b.id);
              const isSource = source?.branch_id === b.id;
              const disabled = already || isSource;
              return (
                <label
                  key={b.id}
                  className={`flex items-center justify-between gap-3 rounded-md border p-2.5 ${
                    disabled ? "opacity-60" : "cursor-pointer hover:bg-muted/40"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Checkbox
                      checked={selected.has(b.id)}
                      disabled={disabled}
                      onCheckedChange={() => !disabled && toggle(b.id)}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Label className="text-sm font-medium truncate">
                          {b.name}
                        </Label>
                        {b.is_primary && (
                          <Badge variant="secondary" className="text-[10px]">
                            Primary
                          </Badge>
                        )}
                      </div>
                      {b.code && (
                        <p className="text-[11px] text-muted-foreground">
                          {b.code}
                        </p>
                      )}
                    </div>
                  </div>
                  {(already || isSource) && (
                    <Badge variant="outline" className="text-[10px]">
                      {isSource ? "Source" : "Already copied"}
                    </Badge>
                  )}
                </label>
              );
            })}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleCopy}
            disabled={submitting || selected.size === 0}
          >
            {submitting
              ? "Copying…"
              : `Copy to ${selected.size || ""} branch${
                  selected.size === 1 ? "" : "es"
                }`.trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}