import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, GitBranch } from "lucide-react";
import { toast } from "sonner";
import {
  useChartOfAccounts,
  type ChartOfAccount,
  ACCOUNT_CODE_RANGES,
} from "@/hooks/useChartOfAccounts";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentAccount: ChartOfAccount | null;
}

interface BranchRow {
  id: string;
  name: string;
}

export function CreateBranchSubAccountsDialog({
  open,
  onOpenChange,
  parentAccount,
}: Props) {
  const { profile, restaurant } = useAuth();
  const tenantId = profile?.tenant_id;
  const restaurantId = restaurant?.id;
  const { accounts, createAccount } = useChartOfAccounts();

  const [selected, setSelected] = useState<string[]>([]);
  const [suffixSeparator, setSuffixSeparator] = useState(" / ");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setSelected([]);
    }
  }, [open, parentAccount?.id]);

  const { data: branches = [], isLoading: branchesLoading } = useQuery({
    queryKey: ["coa-sub-account-branches", restaurantId],
    enabled: open && !!restaurantId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("branches")
        .select("id, name")
        .eq("restaurant_id", restaurantId!)
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data || []) as BranchRow[];
    },
  });

  // Next available code in the parent's type range, skipping any in use.
  const usedCodes = useMemo(
    () => new Set(accounts.map((a) => a.account_code)),
    [accounts],
  );

  const nextCode = (startFrom: number, max: number): number | null => {
    for (let i = startFrom; i <= max; i++) {
      if (!usedCodes.has(String(i))) return i;
    }
    return null;
  };

  const previews = useMemo(() => {
    if (!parentAccount) return [] as { branchId: string; code: string; name: string }[];
    const range = ACCOUNT_CODE_RANGES[parentAccount.account_type];
    const parentNum = parseInt(parentAccount.account_code, 10);
    const max = parseInt(range.max, 10);
    const taken = new Set(usedCodes);
    const rows: { branchId: string; code: string; name: string }[] = [];
    let cursor = parentNum + 1;
    for (const bId of selected) {
      const branch = branches.find((b) => b.id === bId);
      if (!branch) continue;
      // find next free code
      while (cursor <= max && taken.has(String(cursor))) cursor++;
      if (cursor > max) break;
      const code = String(cursor);
      taken.add(code);
      rows.push({
        branchId: bId,
        code,
        name: `${parentAccount.account_name}${suffixSeparator}${branch.name}`,
      });
      cursor++;
    }
    return rows;
  }, [parentAccount, selected, branches, usedCodes, suffixSeparator]);

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const handleCreate = async () => {
    if (!parentAccount || previews.length === 0) return;
    setBusy(true);
    try {
      let created = 0;
      for (const row of previews) {
        await createAccount.mutateAsync({
          account_code: row.code,
          account_name: row.name,
          account_type: parentAccount.account_type,
          parent_id: parentAccount.id,
          description: `Branch sub-account of ${parentAccount.account_code} ${parentAccount.account_name}`,
        });
        created++;
      }
      toast.success(`Created ${created} branch sub-account${created === 1 ? "" : "s"}`);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || "Failed to create sub-accounts");
    } finally {
      setBusy(false);
    }
  };

  const range = parentAccount
    ? ACCOUNT_CODE_RANGES[parentAccount.account_type]
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5" />
            Create branch sub-accounts
          </DialogTitle>
          <DialogDescription>
            {parentAccount
              ? `Create a child account under ${parentAccount.account_code} ${parentAccount.account_name} for each selected branch. Child codes are auto-assigned within the ${range?.label}.`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Branches</Label>
            {branchesLoading ? (
              <div className="flex items-center text-muted-foreground text-sm py-3">
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading branches…
              </div>
            ) : branches.length === 0 ? (
              <p className="text-sm text-muted-foreground py-3">
                No active branches found.
              </p>
            ) : (
              <ScrollArea className="max-h-48 border border-border rounded-md">
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
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="separator" className="text-sm font-medium">
              Name separator
            </Label>
            <Input
              id="separator"
              value={suffixSeparator}
              onChange={(e) => setSuffixSeparator(e.target.value)}
              maxLength={6}
            />
            <p className="text-xs text-muted-foreground">
              e.g. "COGS - Food <span className="font-medium">/</span> Riyadh"
            </p>
          </div>

          {previews.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Preview</Label>
              <div className="border border-border rounded-md text-sm">
                {previews.map((p) => (
                  <div
                    key={p.branchId}
                    className="flex items-center justify-between px-3 py-1.5 border-b last:border-0 border-border"
                  >
                    <span className="font-mono text-muted-foreground">{p.code}</span>
                    <span className="truncate ml-3">{p.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={busy || previews.length === 0}
            className="gap-1.5"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />}
            Create {previews.length || ""} sub-account{previews.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
