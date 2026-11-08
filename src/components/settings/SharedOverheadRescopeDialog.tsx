import { useEffect, useMemo, useState } from "react";
import { qk } from "@/lib/query/queryKeys";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Split } from "lucide-react";
import { toast } from "sonner";
import { useCurrency } from "@/hooks/useCurrency";

export interface RescopeItem {
  id: string;
  name: string;
  monthly_amount: number;
  branch_id: string | null;
  is_active: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: RescopeItem[];
  branches: { id: string; name: string }[];
}

const KEEP = "__keep__";

export function SharedOverheadRescopeDialog({ open, onOpenChange, items, branches }: Props) {
  const queryClient = useQueryClient();
  const { format: formatCurrency } = useCurrency();
  const [choices, setChoices] = useState<Record<string, string>>({});

  const sharedItems = useMemo(
    () => items.filter((i) => !i.branch_id).sort((a, b) => a.name.localeCompare(b.name)),
    [items]
  );

  useEffect(() => {
    if (open) setChoices({});
  }, [open]);

  // A shared item "duplicates" a branch item when a branch already has an item with the same name.
  const duplicateBranchesFor = (name: string) => {
    const lower = name.trim().toLowerCase();
    return items
      .filter((i) => i.branch_id && i.name.trim().toLowerCase() === lower)
      .map((i) => branches.find((b) => b.id === i.branch_id)?.name ?? "Branch");
  };

  const changed = sharedItems.filter((i) => choices[i.id] && choices[i.id] !== KEEP);

  const applyMutation = useMutation({
    mutationFn: async () => {
      for (const item of changed) {
        const { error } = await supabase
          .from("overhead_allocation")
          .update({ branch_id: choices[item.id] } as any)
          .eq("id", item.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["overhead-allocations"] });
      queryClient.invalidateQueries({ queryKey: ["shared-overhead-data"] });
      queryClient.invalidateQueries({ queryKey: qk.dailyProfit.entityAll("overhead") });
      queryClient.invalidateQueries({ queryKey: ["overhead-payments"] });
      toast.success(`Re-scoped ${changed.length} shared item${changed.length === 1 ? "" : "s"}`);
      onOpenChange(false);
    },
    onError: () => toast.error("Failed to re-scope overhead items"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Split className="h-4 w-4" />
            Re-scope shared overhead
          </DialogTitle>
          <DialogDescription>
            Shared costs are added to every branch. Assign each one to the branch it actually belongs to so
            branch fixed cost stops double-counting duplicates.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[55vh] pr-3">
          <div className="space-y-2">
            {sharedItems.length === 0 && (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No shared overhead items — everything is already branch-specific.
              </p>
            )}
            {sharedItems.map((item) => {
              const dupes = duplicateBranchesFor(item.name);
              return (
                <div key={item.id} className="flex items-center gap-3 rounded-lg border p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium truncate">{item.name}</p>
                      {!item.is_active && <Badge variant="outline" className="text-xs">Inactive</Badge>}
                      {dupes.length > 0 && (
                        <Badge variant="outline" className="gap-1 text-xs text-warning border-warning/40">
                          <AlertTriangle className="h-3 w-3" />
                          Duplicate of {dupes.join(", ")}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatCurrency(Number(item.monthly_amount))}/mo · counted in every branch today
                    </p>
                  </div>
                  <Select
                    value={choices[item.id] ?? KEEP}
                    onValueChange={(v) => setChoices((p) => ({ ...p, [item.id]: v }))}
                  >
                    <SelectTrigger className="h-9 w-48 shrink-0">
                      <SelectValue placeholder="Assign branch" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={KEEP}>Keep shared</SelectItem>
                      {branches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {changed.length} of {sharedItems.length} shared item{sharedItems.length === 1 ? "" : "s"} will be re-scoped
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              onClick={() => applyMutation.mutate()}
              disabled={changed.length === 0 || applyMutation.isPending}
            >
              Apply changes
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
