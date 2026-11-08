import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Copy, Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceRestaurantId: string;
  tenantId: string;
  sourceItemCount: number;
}

interface BranchRow {
  id: string;
  name: string;
}

export function CopyMenuToBranchDialog({
  open,
  onOpenChange,
  sourceRestaurantId,
  tenantId,
  sourceItemCount,
}: Props) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [overwrite, setOverwrite] = useState(false);

  // Other branches (restaurants) in the same tenant
  const { data: branches = [], isLoading } = useQuery({
    queryKey: ["copy-menu-branches", tenantId, sourceRestaurantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("restaurants")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .neq("id", sourceRestaurantId)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data || []) as BranchRow[];
    },
    enabled: open && !!tenantId,
  });

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const copyMutation = useMutation({
    mutationFn: async () => {
      if (selected.length === 0) throw new Error("Select at least one branch");

      // Fetch source items
      const { data: sourceItems, error: srcErr } = await supabase
        .from("menu_items")
        .select(
          "name, category, selling_price, quarter_price, half_price, full_price, is_active, image_url, description, is_chefs_special, is_market_price, allergens, dietary_tags, nutritional_info, vat_category, vat_exemption_reason_code, available_online, print_route"
        )
        .eq("restaurant_id", sourceRestaurantId);
      if (srcErr) throw srcErr;
      if (!sourceItems || sourceItems.length === 0) throw new Error("No items to copy");

      let totalInserted = 0;
      let totalSkipped = 0;
      let totalUpdated = 0;
      const insertedIds: string[] = [];
      const updatedSnapshots: { id: string; payload: any }[] = [];

      for (const targetId of selected) {
        // Existing names in target
        const { data: existing, error: exErr } = await supabase
          .from("menu_items")
          .select(
            "id, name, category, selling_price, quarter_price, half_price, full_price, is_active, image_url, description, is_chefs_special, is_market_price, allergens, dietary_tags, nutritional_info, vat_category, vat_exemption_reason_code, available_online, print_route"
          )
          .eq("restaurant_id", targetId);
        if (exErr) throw exErr;
        const existingMap = new Map(
          (existing || []).map((r: any) => [r.name.trim().toLowerCase(), r])
        );

        const toInsert: any[] = [];
        const toUpdate: { id: string; payload: any }[] = [];

        for (const item of sourceItems) {
          const key = item.name.trim().toLowerCase();
          const existingRow = existingMap.get(key) as any;
          if (existingRow) {
            if (overwrite) {
              toUpdate.push({ id: existingRow.id as string, payload: { ...item } });
              // Snapshot original row so undo can restore it.
              const { id: _id, ...rest } = existingRow;
              updatedSnapshots.push({ id: existingRow.id, payload: rest });
            } else {
              totalSkipped++;
            }
          } else {
            toInsert.push({ ...item, restaurant_id: targetId });
          }
        }

        if (toInsert.length > 0) {
          const { data: insData, error: insErr } = await supabase
            .from("menu_items")
            .insert(toInsert)
            .select("id");
          if (insErr) throw insErr;
          totalInserted += toInsert.length;
          (insData || []).forEach((r: any) => insertedIds.push(r.id));
        }
        for (const u of toUpdate) {
          const { error: upErr } = await supabase
            .from("menu_items")
            .update(u.payload)
            .eq("id", u.id);
          if (upErr) throw upErr;
          totalUpdated++;
        }
      }

      return { totalInserted, totalSkipped, totalUpdated, insertedIds, updatedSnapshots };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["menu-items"] });
      qc.invalidateQueries({ queryKey: ["live-menu-items"] });
      const canUndo = r.insertedIds.length > 0 || r.updatedSnapshots.length > 0;
      toast.success(
        `Copied: ${r.totalInserted} added, ${r.totalUpdated} updated, ${r.totalSkipped} skipped`,
        canUndo
          ? {
              duration: 10000,
              action: {
                label: "Undo",
                onClick: () => undoCopy(r.insertedIds, r.updatedSnapshots),
              },
            }
          : undefined
      );
      onOpenChange(false);
      setSelected([]);
      setOverwrite(false);
    },
    onError: (e: any) => toast.error(e?.message || "Failed to copy menu"),
  });

  const undoCopy = async (
    insertedIds: string[],
    updatedSnapshots: { id: string; payload: any }[]
  ) => {
    const toastId = toast.loading("Undoing menu copy…");
    try {
      if (insertedIds.length > 0) {
        // Chunk to keep the URL length reasonable.
        const chunkSize = 100;
        for (let i = 0; i < insertedIds.length; i += chunkSize) {
          const chunk = insertedIds.slice(i, i + chunkSize);
          const { error } = await supabase
            .from("menu_items")
            .delete()
            .in("id", chunk);
          if (error) throw error;
        }
      }
      for (const snap of updatedSnapshots) {
        const { error } = await supabase
          .from("menu_items")
          .update(snap.payload)
          .eq("id", snap.id);
        if (error) throw error;
      }
      qc.invalidateQueries({ queryKey: ["menu-items"] });
      qc.invalidateQueries({ queryKey: ["live-menu-items"] });
      toast.success(
        `Reverted ${insertedIds.length} added and ${updatedSnapshots.length} updated item${
          updatedSnapshots.length === 1 ? "" : "s"
        }`,
        { id: toastId }
      );
    } catch (e: any) {
      toast.error(e?.message || "Failed to undo copy", { id: toastId });
    }
  };

  const allSelected = useMemo(
    () => branches.length > 0 && selected.length === branches.length,
    [branches, selected]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Copy menu to other branches</DialogTitle>
          <DialogDescription>
            Copy {sourceItemCount} menu item{sourceItemCount === 1 ? "" : "s"} from the
            current branch to the selected destination branches.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading branches…
            </div>
          ) : branches.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No other branches available.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Destination branches</Label>
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() =>
                    setSelected(allSelected ? [] : branches.map((b) => b.id))
                  }
                >
                  {allSelected ? "Clear all" : "Select all"}
                </button>
              </div>
              <ScrollArea className="max-h-60 border border-border rounded-md">
                <div className="p-2 space-y-1">
                  {branches.map((b) => (
                    <label
                      key={b.id}
                      className="flex items-center gap-2 p-2 rounded hover:bg-accent cursor-pointer text-sm"
                    >
                      <Checkbox
                        checked={selected.includes(b.id)}
                        onCheckedChange={() => toggle(b.id)}
                      />
                      <span>{b.name}</span>
                    </label>
                  ))}
                </div>
              </ScrollArea>

              <label className="flex items-start gap-2 text-sm pt-2 cursor-pointer">
                <Checkbox
                  checked={overwrite}
                  onCheckedChange={(c) => setOverwrite(!!c)}
                  className="mt-0.5"
                />
                <span className="text-muted-foreground">
                  Overwrite items with the same name on the destination. When off,
                  duplicates are skipped.
                </span>
              </label>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => copyMutation.mutate()}
            disabled={
              selected.length === 0 || copyMutation.isPending || sourceItemCount === 0
            }
            className="gap-1.5"
          >
            {copyMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            Copy menu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
