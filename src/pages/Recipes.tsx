import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ChefHat, AlertTriangle, CheckCircle2, Plus, Trash2, Search } from "lucide-react";

type Status = "missing" | "incomplete" | "complete";

interface RecipeStatusRow {
  menu_item_id: string;
  restaurant_id: string;
  menu_item_name: string;
  is_active: boolean;
  ingredient_count: number;
  theoretical_food_cost: number | null;
  status: Status;
}

interface IngredientRow {
  id?: string;
  inventory_item_id: string;
  quantity_required: number;
  unit: string | null;
  _new?: boolean;
  _dirty?: boolean;
  _deleted?: boolean;
}

const UNIT_OPTIONS = ["g", "kg", "ml", "l", "pcs", "tbsp", "tsp", "cup", "oz", "lb"];

export default function Recipes() {
  const { t } = useTranslation();
  const { restaurant } = useAuth();
  const { format } = useCurrency();
  const qc = useQueryClient();
  const restaurantId = restaurant?.id;

  const [tab, setTab] = useState<Status | "all">("missing");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<RecipeStatusRow | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["recipe-status", restaurantId],
    queryFn: async () => {
      const { data, error } = await db
        .from("menu_items_recipe_status" as any)
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("menu_item_name");
      if (error) throw error;
      return (data ?? []) as unknown as RecipeStatusRow[];
    },
    enabled: !!restaurantId,
  });

  // Beverages are tracked as finished-good purchases (COGS 5002), not by
  // ingredient recipes - exclude them from the BOM workspace entirely.
  const { data: beverageIds = [] } = useQuery({
    queryKey: ["menu-items-beverage-ids", restaurantId],
    queryFn: async () => {
      const { data, error } = await db
        .from("menu_items")
        .select("id")
        .eq("restaurant_id", restaurantId)
        .ilike("category", "%bever%");
      if (error) throw error;
      return (data ?? []).map((r: any) => r.id as string);
    },
    enabled: !!restaurantId,
  });
  const beverageSet = useMemo(() => new Set(beverageIds), [beverageIds]);
  const visibleRows = useMemo(
    () => rows.filter((r) => !beverageSet.has(r.menu_item_id)),
    [rows, beverageSet],
  );

  const counts = useMemo(() => {
    const c = { missing: 0, incomplete: 0, complete: 0, all: visibleRows.length };
    visibleRows.forEach((r) => { c[r.status] = (c[r.status] ?? 0) + 1; });
    return c;
  }, [visibleRows]);

  const filtered = useMemo(() => {
    return visibleRows
      .filter((r) => tab === "all" || r.status === tab)
      .filter((r) => r.menu_item_name.toLowerCase().includes(search.toLowerCase()));
  }, [visibleRows, tab, search]);

  return (
    <>
      <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
        <div className="flex items-center gap-3">
          <ChefHat className="h-7 w-7 text-primary" />
          <div>
              <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">{t("app.recipes.title")}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t("app.recipes.subtitle")}
            </p>
          </div>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
            <CardTitle className="text-base font-medium">{t("app.recipes.menuItems")}</CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("app.recipes.searchPlaceholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
          </CardHeader>
          <CardContent>
            <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
              <TabsList>
                <TabsTrigger value="missing">
                  {t("app.recipes.tabs.missing")} <Badge variant="destructive" className="ml-2">{counts.missing}</Badge>
                </TabsTrigger>
                <TabsTrigger value="incomplete">
                  {t("app.recipes.tabs.incomplete")} <Badge variant="secondary" className="ml-2">{counts.incomplete}</Badge>
                </TabsTrigger>
                <TabsTrigger value="complete">
                  {t("app.recipes.tabs.complete")} <Badge variant="outline" className="ml-2">{counts.complete}</Badge>
                </TabsTrigger>
                <TabsTrigger value="all">{t("app.recipes.tabs.all")} <Badge variant="outline" className="ml-2">{counts.all}</Badge></TabsTrigger>
              </TabsList>

              <TabsContent value={tab} className="mt-4">
                {isLoading ? (
                  <div className="text-sm text-muted-foreground py-8 text-center">{t("app.recipes.loading")}</div>
                ) : filtered.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-8 text-center">
                    {t("app.recipes.noMatches")}
                  </div>
                ) : (
                  <div className="divide-y rounded-md border">
                    {filtered.map((r) => (
                      <div
                        key={r.menu_item_id}
                        className="flex items-center justify-between gap-4 p-4 hover:bg-muted/40 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <StatusIcon status={r.status} />
                          <div className="min-w-0">
                            <div className="font-medium truncate">{r.menu_item_name}</div>
                            <div className="text-xs text-muted-foreground">
                              {t("app.recipes.ingredients", { count: r.ingredient_count })}
                              {r.theoretical_food_cost != null && r.theoretical_food_cost > 0 && (
                                <> · {t("app.recipes.theoreticalCost", { cost: format(Number(r.theoretical_food_cost)) })}</>
                              )}
                              {!r.is_active && <> · {t("app.recipes.inactive")}</>}
                            </div>
                          </div>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                          {t("app.recipes.editRecipe")}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      {editing && restaurantId && (
        <RecipeEditorDialog
          item={editing}
          restaurantId={restaurantId}
          onClose={() => setEditing(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["recipe-status", restaurantId] });
          }}
        />
      )}
    </>
  );
}

function StatusIcon({ status }: { status: Status }) {
  if (status === "complete") return <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />;
  if (status === "incomplete") return <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />;
  return <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />;
}

function RecipeEditorDialog({
  item, restaurantId, onClose, onSaved,
}: {
  item: RecipeStatusRow;
  restaurantId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<IngredientRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const { data: inventory = [] } = useQuery({
    queryKey: ["inventory-items-for-recipe", restaurantId],
    queryFn: async () => {
      const { data, error } = await db
        .from("inventory_items")
        .select("id, name, unit, stock_unit")
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  useQuery({
    queryKey: ["recipe-ingredients", item.menu_item_id],
    queryFn: async () => {
      const { data, error } = await db
        .from("recipe_ingredients")
        .select("id, inventory_item_id, quantity_required, unit")
        .eq("menu_item_id", item.menu_item_id)
        .eq("restaurant_id", restaurantId);
      if (error) throw error;
      setRows((data ?? []).map((r: any) => ({
        id: r.id,
        inventory_item_id: r.inventory_item_id,
        quantity_required: Number(r.quantity_required),
        unit: r.unit,
      })));
      setLoaded(true);
      return data;
    },
  });

  const addRow = () => {
    setRows((p) => [
      ...p,
      { inventory_item_id: "", quantity_required: 1, unit: "g", _new: true, _dirty: true },
    ]);
  };

  const update = (idx: number, patch: Partial<IngredientRow>) => {
    setRows((p) => p.map((r, i) => (i === idx ? { ...r, ...patch, _dirty: true } : r)));
  };

  const remove = (idx: number) => {
    setRows((p) => p.flatMap((r, i) => {
      if (i !== idx) return [r];
      if (r._new) return [];
      return [{ ...r, _deleted: true }];
    }));
  };

  const save = useMutation({
    mutationFn: async () => {
      // Validate
      const active = rows.filter((r) => !r._deleted);
      for (const r of active) {
        if (!r.inventory_item_id) throw new Error("Pick an ingredient for every row.");
        if (!r.quantity_required || r.quantity_required <= 0) throw new Error("Quantity must be > 0.");
        if (!r.unit) throw new Error("Unit is required for every ingredient.");
      }
      const ids = active.map((r) => r.inventory_item_id);
      if (new Set(ids).size !== ids.length) throw new Error("Duplicate ingredients are not allowed.");

      // Deletes
      const toDelete = rows.filter((r) => r._deleted && r.id).map((r) => r.id!) as string[];
      if (toDelete.length) {
        const { error } = await db.from("recipe_ingredients").delete().in("id", toDelete);
        if (error) throw error;
      }

      // Upserts (inserts for new, updates for dirty existing)
      const inserts = rows
        .filter((r) => r._new && !r._deleted)
        .map((r) => ({
          menu_item_id: item.menu_item_id,
          restaurant_id: restaurantId,
          inventory_item_id: r.inventory_item_id,
          quantity_required: r.quantity_required,
          unit: r.unit,
        }));
      if (inserts.length) {
        const { error } = await db.from("recipe_ingredients").insert(inserts);
        if (error) throw error;
      }

      const updates = rows.filter((r) => !r._new && !r._deleted && r._dirty && r.id);
      for (const r of updates) {
        const { error } = await db
          .from("recipe_ingredients")
          .update({
            inventory_item_id: r.inventory_item_id,
            quantity_required: r.quantity_required,
            unit: r.unit,
          })
          .eq("id", r.id!);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Recipe saved");
      qc.invalidateQueries({ queryKey: ["recipe-ingredients", item.menu_item_id] });
      onSaved();
      onClose();
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to save recipe"),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        description={`Recipe for "${item.menu_item_name}" - ${rows.filter((r) => !r._deleted).length} ingredient${rows.filter((r) => !r._deleted).length === 1 ? "" : "s"}.`}
        className="max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle>Edit recipe - {item.menu_item_name}</DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          {!loaded ? (
            <div className="text-sm text-muted-foreground py-6 text-center">Loading…</div>
          ) : (
            <div className="space-y-3">
              {rows.filter((r) => !r._deleted).length === 0 && (
                <div className="text-sm text-muted-foreground py-4 text-center border rounded-md">
                  No ingredients yet. Add the first one below.
                </div>
              )}
              {rows.map((r, idx) => {
                if (r._deleted) return null;
                return (
                  <div key={r.id ?? `new-${idx}`} className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-6">
                      <Label className="text-xs">Ingredient</Label>
                      <Select
                        value={r.inventory_item_id}
                        onValueChange={(v) => update(idx, { inventory_item_id: v })}
                      >
                        <SelectTrigger><SelectValue placeholder="Pick ingredient" /></SelectTrigger>
                        <SelectContent>
                          {inventory.map((inv: any) => (
                            <SelectItem key={inv.id} value={inv.id}>
                              {inv.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-3">
                      <Label className="text-xs">Quantity</Label>
                      <Input
                        type="number"
                        step="0.001"
                        min="0"
                        value={r.quantity_required}
                        onChange={(e) => update(idx, { quantity_required: Number(e.target.value) })}
                      />
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs">Unit</Label>
                      <Select
                        value={r.unit ?? ""}
                        onValueChange={(v) => update(idx, { unit: v })}
                      >
                        <SelectTrigger><SelectValue placeholder="Unit" /></SelectTrigger>
                        <SelectContent>
                          {UNIT_OPTIONS.map((u) => (
                            <SelectItem key={u} value={u}>{u}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => remove(idx)}
                        aria-label="Remove ingredient"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}

              <Button variant="outline" size="sm" onClick={addRow} className="mt-2">
                <Plus className="h-4 w-4 mr-1" /> Add ingredient
              </Button>
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save recipe"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}