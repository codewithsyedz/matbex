import { useState } from "react";
import { qk } from "@/lib/query/queryKeys";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Plus, Trash2, Building2, Lightbulb, Wifi, DollarSign, Pencil, Check, X, Split } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/hooks/useCurrency";
import { useBranch } from "@/contexts/BranchContext";
import { BranchBadge } from "@/components/branch/BranchBadge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SharedOverheadRescopeDialog } from "@/components/settings/SharedOverheadRescopeDialog";

interface OverheadItem {
  id: string;
  name: string;
  monthly_amount: number;
  daily_amount: number | null;
  is_active: boolean;
  branch_id: string | null;
}

const defaultOverheads = [
  { name: "Rent", icon: Building2 },
  { name: "Utilities", icon: Lightbulb },
  { name: "Internet & Phone", icon: Wifi },
  { name: "Insurance", icon: DollarSign },
];

export function OverheadAllocationSettings() {
  const { restaurant } = useAuth();
  const { format: formatCurrency } = useCurrency();
  const { branches, activeBranchId, isAllBranches, activeBranch } = useBranch();
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{ name: string; monthly: string; branch: string }>({
    name: "",
    monthly: "",
    branch: "__shared__",
  });
  const [newItem, setNewItem] = useState({ name: "", monthly: "" });
  const [newBranchScope, setNewBranchScope] = useState<string>("__inherit__");
  const [isAdding, setIsAdding] = useState(false);
  const [rescopeOpen, setRescopeOpen] = useState(false);

  const { data: overheads, isLoading } = useQuery({
    queryKey: ["overhead-allocations", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await db
        .from("overhead_allocation")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as OverheadItem[];
    },
    enabled: !!restaurant?.id,
  });

  // Branch filter: "__all__" = every item, "__shared__" = shared only, or a branch id
  // (branch id shows that branch's items + shared ones)
  const [branchFilter, setBranchFilter] = useState<string>(
    isAllBranches || !activeBranchId ? "__all__" : activeBranchId
  );

  const visibleOverheads = (overheads || []).filter((r) => {
    if (branchFilter === "__all__") return true;
    if (branchFilter === "__shared__") return !r.branch_id;
    return !r.branch_id || r.branch_id === branchFilter;
  });

  const createMutation = useMutation({
    mutationFn: async (item: { name: string; monthly_amount: number; branch_id: string | null }) => {
      if (!restaurant?.id) throw new Error("No restaurant");
      const { data, error } = await db
        .from("overhead_allocation")
        .insert({
          restaurant_id: restaurant.id,
          name: item.name,
          monthly_amount: item.monthly_amount,
          is_active: true,
          branch_id: item.branch_id,
        } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["overhead-allocations"] });
      queryClient.invalidateQueries({ queryKey: qk.dailyProfit.entityAll("overhead") });
      toast.success("Overhead item added");
      setNewItem({ name: "", monthly: "" });
      setNewBranchScope("__inherit__");
      setIsAdding(false);
    },
    onError: () => toast.error("Failed to add overhead item"),
  });

  const updateMutation = useMutation({
    mutationFn: async (item: { id: string; name: string; monthly_amount: number; branch_id: string | null }) => {
      const { error } = await db
        .from("overhead_allocation")
        .update({
          name: item.name,
          monthly_amount: item.monthly_amount,
          branch_id: item.branch_id,
        } as any)
        .eq("id", item.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["overhead-allocations"] });
      queryClient.invalidateQueries({ queryKey: qk.dailyProfit.entityAll("overhead") });
      toast.success("Overhead updated");
      setEditingId(null);
    },
    onError: () => toast.error("Failed to update overhead"),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await db
        .from("overhead_allocation")
        .update({ is_active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["overhead-allocations"] });
      queryClient.invalidateQueries({ queryKey: qk.dailyProfit.entityAll("overhead") });
    },
    onError: () => toast.error("Failed to toggle overhead"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db
        .from("overhead_allocation")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["overhead-allocations"] });
      queryClient.invalidateQueries({ queryKey: qk.dailyProfit.entityAll("overhead") });
      toast.success("Overhead item removed");
    },
    onError: () => toast.error("Failed to remove overhead"),
  });

  const totalMonthly = visibleOverheads.filter(o => o.is_active).reduce((sum, o) => sum + Number(o.monthly_amount), 0);
  const totalDaily = totalMonthly / 30;

  const startEditing = (item: OverheadItem) => {
    setEditingId(item.id);
    setEditValues({
      name: item.name,
      monthly: item.monthly_amount.toString(),
      branch: item.branch_id ?? "__shared__",
    });
  };

  const saveEditing = () => {
    if (!editingId) return;
    const monthly = parseFloat(editValues.monthly);
    if (!editValues.name.trim() || isNaN(monthly) || monthly < 0) {
      toast.error("Please enter valid values");
      return;
    }
    updateMutation.mutate({
      id: editingId,
      name: editValues.name.trim(),
      monthly_amount: monthly,
      branch_id: editValues.branch === "__shared__" ? null : editValues.branch,
    });
  };

  const handleAdd = () => {
    const monthly = parseFloat(newItem.monthly);
    if (!newItem.name.trim() || isNaN(monthly) || monthly <= 0) {
      toast.error("Please enter a name and valid amount");
      return;
    }
    const branchId =
      newBranchScope === "__inherit__"
        ? (isAllBranches ? null : activeBranchId)
        : newBranchScope === "__shared__"
          ? null
          : newBranchScope;
    createMutation.mutate({ name: newItem.name.trim(), monthly_amount: monthly, branch_id: branchId });
  };

  const getIconForName = (name: string) => {
    const lower = name.toLowerCase();
    if (lower.includes("rent")) return Building2;
    if (lower.includes("utilit") || lower.includes("electric") || lower.includes("water") || lower.includes("gas")) return Lightbulb;
    if (lower.includes("internet") || lower.includes("phone") || lower.includes("wifi")) return Wifi;
    return DollarSign;
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-64 mt-1" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-3">
        <div className="space-y-1">
          <CardTitle className="text-base font-medium">Overhead Allocation</CardTitle>
          <CardDescription>
            Configure fixed monthly costs to allocate daily for accurate profit calculation
            {branchFilter === "__all__"
              ? " — showing all branches"
              : branchFilter === "__shared__"
                ? " — showing shared costs only"
                : ` — showing ${branches.find((b) => b.id === branchFilter)?.name ?? "this branch"} + shared costs`}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() => setRescopeOpen(true)}
            disabled={!(overheads || []).some((o) => !o.branch_id)}
          >
            <Split className="h-4 w-4 mr-2" />
            Re-scope shared
            {(overheads || []).filter((o) => !o.branch_id).length > 0 && (
              <span className="ml-1 text-xs text-muted-foreground">
                ({(overheads || []).filter((o) => !o.branch_id).length})
              </span>
            )}
          </Button>
          <Select value={branchFilter} onValueChange={setBranchFilter}>
          <SelectTrigger className="h-9 w-[220px]">
            <SelectValue placeholder="Filter by branch" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All branches</SelectItem>
            <SelectItem value="__shared__">Shared only</SelectItem>
            {branches.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name} + shared
              </SelectItem>
            ))}
          </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <SharedOverheadRescopeDialog
          open={rescopeOpen}
          onOpenChange={setRescopeOpen}
          items={(overheads || []).map((o) => ({
            id: o.id,
            name: o.name,
            monthly_amount: Number(o.monthly_amount),
            branch_id: o.branch_id,
            is_active: o.is_active,
          }))}
          branches={branches.map((b) => ({ id: b.id, name: b.name }))}
        />
        {/* Summary */}
        <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
          <div>
            <p className="text-sm text-muted-foreground">Total Monthly Overhead</p>
            <p className="text-2xl font-semibold">{formatCurrency(totalMonthly)}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Daily Allocation</p>
            <p className="text-lg font-medium text-primary">{formatCurrency(totalDaily)}/day</p>
          </div>
        </div>

        {/* Overhead Items */}
        <div className="space-y-2">
          {visibleOverheads.map((item) => {
            const Icon = getIconForName(item.name);
            const isEditing = editingId === item.id;

            return (
              <div
                key={item.id}
                className={cn(
                  "flex items-center gap-4 p-3 rounded-lg border transition-colors",
                  item.is_active ? "bg-card" : "bg-muted/30 opacity-60"
                )}
              >
                <div className="p-2 rounded-md bg-accent/50">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
                
                {isEditing ? (
                  <>
                    <Input
                      value={editValues.name}
                      onChange={(e) => setEditValues(v => ({ ...v, name: e.target.value }))}
                      className="flex-1 h-8"
                    />
                    <Select
                      value={editValues.branch}
                      onValueChange={(v) => setEditValues((prev) => ({ ...prev, branch: v }))}
                    >
                      <SelectTrigger className="w-44 h-8">
                        <SelectValue placeholder="Scope" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__shared__">Shared (all branches)</SelectItem>
                        {branches.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        value={editValues.monthly}
                        onChange={(e) => setEditValues(v => ({ ...v, monthly: e.target.value }))}
                        className="w-28 h-8"
                      />
                      <span className="text-xs text-muted-foreground">/mo</span>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={saveEditing}>
                      <Check className="h-4 w-4 text-success" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditingId(null)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-sm">{item.name}</p>
                        <BranchBadge
                          size="sm"
                          name={
                            item.branch_id
                              ? branches.find((b) => b.id === item.branch_id)?.name ?? "Branch"
                              : null
                          }
                          branchId={item.branch_id}
                          untaggedLabel="Shared"
                          className={!item.branch_id ? "border-border text-muted-foreground" : undefined}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatCurrency(Number(item.daily_amount || 0))}/day
                      </p>
                    </div>
                    <p className="text-sm font-medium">{formatCurrency(item.monthly_amount)}/mo</p>
                    <Switch
                      checked={item.is_active}
                      onCheckedChange={(checked) => toggleMutation.mutate({ id: item.id, is_active: checked })}
                    />
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEditing(item)}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => deleteMutation.mutate(item.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Add New */}
        {isAdding ? (
          <div className="flex items-center gap-3 p-3 rounded-lg border border-dashed">
            <Input
              placeholder="Name (e.g., Rent)"
              value={newItem.name}
              onChange={(e) => setNewItem(v => ({ ...v, name: e.target.value }))}
              className="flex-1"
            />
            <Select value={newBranchScope} onValueChange={setNewBranchScope}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Scope" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__inherit__">
                  {isAllBranches || !activeBranchId
                    ? "Shared (all branches)"
                    : `Current: ${activeBranch?.name ?? "branch"}`}
                </SelectItem>
                <SelectItem value="__shared__">Shared (all branches)</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                placeholder="Monthly amount"
                value={newItem.monthly}
                onChange={(e) => setNewItem(v => ({ ...v, monthly: e.target.value }))}
                className="w-32"
              />
            </div>
            <Button size="sm" onClick={handleAdd} disabled={createMutation.isPending}>
              Add
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setIsAdding(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" className="w-full" onClick={() => setIsAdding(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Overhead Item
          </Button>
        )}

        {/* Quick Add Suggestions */}
        {(!overheads || overheads.length < 4) && !isAdding && (
          <div className="pt-2">
            <p className="text-xs text-muted-foreground mb-2">Quick add:</p>
            <div className="flex flex-wrap gap-2">
              {defaultOverheads
                .filter(d => !overheads?.some(o => o.name.toLowerCase() === d.name.toLowerCase()))
                .map((item) => (
                  <Button
                    key={item.name}
                    variant="secondary"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      setNewItem({ name: item.name, monthly: "" });
                      setIsAdding(true);
                    }}
                  >
                    <item.icon className="h-3 w-3 mr-1" />
                    {item.name}
                  </Button>
                ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
