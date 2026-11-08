import { useEffect, useMemo, useState } from "react";
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
import { useBranch } from "@/contexts/BranchContext";
import { useAccountBranchVisibility } from "@/hooks/useAccountBranchVisibility";
import type { ChartOfAccount } from "@/hooks/useChartOfAccounts";
import { Eye, EyeOff } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: ChartOfAccount | null;
}

/**
 * Manage which branches see a Chart of Accounts entry.
 * Empty selection = visible to ALL branches (default).
 */
export function AccountBranchVisibilityDialog({ open, onOpenChange, account }: Props) {
  const { branches } = useBranch();
  const { rows, isLoading, save } = useAccountBranchVisibility(account?.id ?? null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [restrict, setRestrict] = useState(false);

  // Hydrate from DB rows when account changes / data loads.
  useEffect(() => {
    if (!open) return;
    const ids = new Set(rows.map((r) => r.branch_id));
    setSelected(ids);
    setRestrict(ids.size > 0);
  }, [open, rows]);

  const allBranchIds = useMemo(() => branches.map((b) => b.id), [branches]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    const ids = restrict ? Array.from(selected) : [];
    await save.mutateAsync(ids);
    onOpenChange(false);
  };

  const summary = restrict
    ? `${selected.size} of ${branches.length} branches`
    : "Visible to all branches";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {restrict ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            Branch visibility
          </DialogTitle>
          <DialogDescription>
            {account ? (
              <>
                <span className="font-mono text-xs mr-1">{account.account_code}</span>
                {account.account_name}
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <label className="flex items-center gap-3 rounded-md border p-3 cursor-pointer">
            <Checkbox
              checked={restrict}
              onCheckedChange={(c) => setRestrict(Boolean(c))}
            />
            <div className="flex-1">
              <div className="text-sm font-medium">Restrict to specific branches</div>
              <div className="text-xs text-muted-foreground">
                Leave unchecked to keep this account visible across every branch.
              </div>
            </div>
          </label>

          {restrict && (
            <div className="space-y-2 max-h-72 overflow-auto border rounded-md p-3">
              {branches.length === 0 ? (
                <p className="text-sm text-muted-foreground">No branches available.</p>
              ) : (
                <>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Pick the branches that may use this account.</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="underline"
                        onClick={() => setSelected(new Set(allBranchIds))}
                      >
                        All
                      </button>
                      <button
                        type="button"
                        className="underline"
                        onClick={() => setSelected(new Set())}
                      >
                        None
                      </button>
                    </div>
                  </div>
                  {branches.map((b) => (
                    <label
                      key={b.id}
                      className="flex items-center gap-2 py-1 cursor-pointer"
                    >
                      <Checkbox
                        checked={selected.has(b.id)}
                        onCheckedChange={() => toggle(b.id)}
                      />
                      <span className="text-sm">{b.name}</span>
                      {b.is_primary ? (
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          primary
                        </span>
                      ) : null}
                    </label>
                  ))}
                </>
              )}
            </div>
          )}

          <p className="text-xs text-muted-foreground">{summary}</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isLoading || save.isPending}
          >
            {save.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}