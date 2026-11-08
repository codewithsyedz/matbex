import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

/** Keep in sync with RecordExpenseDialog + InventoryLinkAudit. */
const INVENTORY_BACKED_CATEGORY_RE =
  /\b(meat|chicken|beef|lamb|mutton|fish|seafood|poultry|food|ingredient|produce|vegetables?|veg|fruits?|groceries|grocery|spices?|flour|rice|bread|oils?|dairy|milk|cheese|yog(?:h)?urt|cream|butter|labneh|ghee|beverages?|drinks?|sodas?|juices?|waters?|coffee|tea|gas|cylinder|propane|lpg|packaging|container|wrap|napkin|disposable|takeaway|bag)\b/i;

type Category = {
  id: string;
  name: string;
  branch_id: string | null;
  default_inventory_item_id: string | null;
};

type InvItem = {
  id: string;
  name: string;
  unit: string | null;
  branch_id: string | null;
};

/** Score how well an inventory item name matches a category name. */
function suggestFor(categoryName: string, items: InvItem[]): InvItem | null {
  const tokens = categoryName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
  if (tokens.length === 0) return null;
  let best: { item: InvItem; score: number } | null = null;
  for (const item of items) {
    const n = (item.name || "").toLowerCase();
    let score = 0;
    for (const t of tokens) if (n.includes(t)) score += t.length;
    if (score > 0 && (!best || score > best.score)) best = { item, score };
  }
  return best?.item ?? null;
}

export default function InventoryLinkRules() {
  const { restaurant } = useAuth();
  const { activeBranchId } = useBranch();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const { data: categories = [] } = useQuery({
    queryKey: ["expense-categories-rules", restaurant?.id, activeBranchId],
    enabled: !!restaurant?.id,
    queryFn: async (): Promise<Category[]> => {
      const { data, error } = await (supabase as any)
        .from("expense_categories")
        .select("id, name, branch_id, default_inventory_item_id")
        .eq("restaurant_id", restaurant!.id)
        .order("name");
      if (error) throw error;
      const rows = (data ?? []) as Category[];
      const visible = rows.filter(
        (r) => !r.branch_id || r.branch_id === activeBranchId
      );
      // Dedupe by lower-case name, prefer branch-scoped row over shared.
      const map = new Map<string, Category>();
      for (const r of visible) {
        const key = r.name.toLowerCase();
        const existing = map.get(key);
        if (!existing || (r.branch_id && !existing.branch_id)) map.set(key, r);
      }
      return Array.from(map.values());
    },
  });

  const { data: items = [] } = useQuery({
    queryKey: ["inventory-items-rules", restaurant?.id, activeBranchId],
    enabled: !!restaurant?.id,
    queryFn: async (): Promise<InvItem[]> => {
      const { data, error } = await (supabase as any)
        .from("inventory_items")
        .select("id, name, unit, branch_id, is_active")
        .eq("restaurant_id", restaurant!.id)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []).filter(
        (it: any) => !it.branch_id || it.branch_id === activeBranchId
      );
    },
  });

  const inventoryBacked = useMemo(
    () =>
      categories.filter((c) => INVENTORY_BACKED_CATEGORY_RE.test(c.name || "")),
    [categories]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return inventoryBacked;
    return inventoryBacked.filter((c) => c.name.toLowerCase().includes(q));
  }, [inventoryBacked, search]);

  const mutation = useMutation({
    mutationFn: async (params: { id: string; itemId: string | null }) => {
      const { error } = await (supabase as any)
        .from("expense_categories")
        .update({ default_inventory_item_id: params.itemId })
        .eq("id", params.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expense-categories-rules"] });
      qc.invalidateQueries({ queryKey: ["expense-categories"] });
      toast.success("Rule saved");
    },
    onError: (e: any) => toast.error("Save failed", { description: e.message }),
    onSettled: () => setSaving(null),
  });

  const currentFor = (c: Category) =>
    drafts[c.id] !== undefined ? drafts[c.id] : c.default_inventory_item_id;

  const applyAutoSuggestAll = () => {
    const next: Record<string, string | null> = { ...drafts };
    let count = 0;
    for (const c of filtered) {
      if (currentFor(c)) continue;
      const s = suggestFor(c.name, items);
      if (s) {
        next[c.id] = s.id;
        count++;
      }
    }
    setDrafts(next);
    toast.success(count > 0 ? `Suggested ${count} mapping(s)` : "No new suggestions");
  };

  const saveAll = async () => {
    const entries = Object.entries(drafts).filter(([id, value]) => {
      const orig = categories.find((c) => c.id === id)?.default_inventory_item_id ?? null;
      return (value ?? null) !== orig;
    });
    if (entries.length === 0) {
      toast.info("No changes to save");
      return;
    }
    for (const [id, itemId] of entries) {
      setSaving(id);
      await mutation.mutateAsync({ id, itemId });
    }
    setDrafts({});
  };

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Link to="/expenses" className="inline-flex items-center gap-1 hover:text-foreground">
              <ArrowLeft className="h-3.5 w-3.5" /> Expenses
            </Link>
          </div>
          <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">
            Inventory Link Rules
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            For each inventory-backed expense category, pick the inventory item that should be
            auto-linked when a cashier records an expense.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={applyAutoSuggestAll}>
            <Sparkles className="h-4 w-4" />
            Auto-suggest empties
          </Button>
          <Button size="sm" className="gap-1.5" onClick={saveAll}>
            <Save className="h-4 w-4" />
            Save changes
          </Button>
        </div>
      </header>

      <Card className="mb-4">
        <CardContent className="pt-6 flex flex-wrap gap-3 items-center">
          <Input
            placeholder="Search categories…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
          <Badge variant="outline">{inventoryBacked.length} inventory-backed</Badge>
          <Badge variant="secondary">{items.length} inventory items available</Badge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Category → default inventory item</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Default inventory item</TableHead>
                <TableHead className="w-[140px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-10">
                    No inventory-backed categories found.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((c) => {
                  const value = currentFor(c) ?? "__none__";
                  const dirty =
                    drafts[c.id] !== undefined &&
                    (drafts[c.id] ?? null) !== (c.default_inventory_item_id ?? null);
                  const suggestion = !currentFor(c) ? suggestFor(c.name, items) : null;
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>
                        {c.branch_id ? (
                          <Badge variant="outline">Branch</Badge>
                        ) : (
                          <Badge variant="secondary">Shared</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Select
                            value={value}
                            onValueChange={(v) =>
                              setDrafts((d) => ({
                                ...d,
                                [c.id]: v === "__none__" ? null : v,
                              }))
                            }
                          >
                            <SelectTrigger className="w-[280px]">
                              <SelectValue placeholder="No default" />
                            </SelectTrigger>
                            <SelectContent className="max-h-72">
                              <SelectItem value="__none__">— No default —</SelectItem>
                              {items.map((it) => (
                                <SelectItem key={it.id} value={it.id}>
                                  {it.name}
                                  {it.unit ? ` (${it.unit})` : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {suggestion && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="gap-1 text-xs"
                              onClick={() =>
                                setDrafts((d) => ({ ...d, [c.id]: suggestion.id }))
                              }
                            >
                              <Sparkles className="h-3 w-3" />
                              Use “{suggestion.name}”
                            </Button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {dirty && (
                          <Button
                            size="sm"
                            disabled={saving === c.id}
                            onClick={async () => {
                              setSaving(c.id);
                              await mutation.mutateAsync({
                                id: c.id,
                                itemId: drafts[c.id] ?? null,
                              });
                              setDrafts((d) => {
                                const { [c.id]: _, ...rest } = d;
                                return rest;
                              });
                            }}
                          >
                            Save
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}