import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tags, RotateCcw, Save, Info } from "lucide-react";
import { toast } from "sonner";

interface CategoryRow {
  id: string;
  name: string;
  inventory_account_code: string | null;
  cogs_account_code: string | null;
}

interface StandardCat {
  key: string;
  display_name: string;
  inventory_account_code: string;
  inventory_account_name: string;
  cogs_account_code: string;
  cogs_account_name: string;
}

interface AccountRow {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
}

export default function IngredientCategoryMappings() {
  const { restaurant } = useAuth();
  const qc = useQueryClient();
  const restaurantId = restaurant?.id;

  // Local pending edits keyed by category id
  const [pending, setPending] = useState<Record<string, { inv?: string | null; cogs?: string | null }>>({});

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ["ing-category-mappings", restaurantId],
    queryFn: async () => {
      const { data, error } = await db
        .from("inventory_categories")
        .select("id, name, inventory_account_code, cogs_account_code")
        .eq("restaurant_id", restaurantId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as CategoryRow[];
    },
    enabled: !!restaurantId,
  });

  const { data: standards = [] } = useQuery({
    queryKey: ["standard-ingredient-categories"],
    queryFn: async () => {
      const { data, error } = await db
        .from("standard_ingredient_categories" as any)
        .select("*")
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as unknown as StandardCat[];
    },
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["coa-asset-cogs", restaurantId],
    queryFn: async () => {
      const { data, error } = await db
        .from("chart_of_accounts")
        .select("id, account_code, account_name, account_type")
        .in("account_type", ["asset", "cogs", "expense"])
        .eq("is_active", true)
        .order("account_code");
      if (error) throw error;
      return (data ?? []) as AccountRow[];
    },
  });

  const inventoryAccounts = useMemo(
    () => accounts.filter((a) => a.account_type === "asset" && a.account_code.startsWith("1")),
    [accounts]
  );
  const cogsAccounts = useMemo(
    () => accounts.filter((a) => a.account_type === "cogs" || a.account_code.startsWith("5")),
    [accounts]
  );

  const standardByName = useMemo(() => {
    const m: Record<string, StandardCat> = {};
    standards.forEach((s) => { m[s.display_name.toLowerCase()] = s; });
    return m;
  }, [standards]);

  // Reset pending when categories load
  useEffect(() => { setPending({}); }, [categories.length]);

  const dirtyCount = Object.keys(pending).length;

  const setOverride = (id: string, field: "inv" | "cogs", value: string | null) => {
    setPending((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
  };

  const resetRow = (id: string) => {
    setPending((prev) => ({ ...prev, [id]: { inv: null, cogs: null } }));
  };

  const saveAll = useMutation({
    mutationFn: async () => {
      const updates = Object.entries(pending);
      for (const [id, patch] of updates) {
        const dbPatch: any = {};
        if ("inv" in patch) dbPatch.inventory_account_code = patch.inv ?? null;
        if ("cogs" in patch) dbPatch.cogs_account_code = patch.cogs ?? null;
        if (Object.keys(dbPatch).length === 0) continue;
        const { error } = await db
          .from("inventory_categories")
          .update(dbPatch)
          .eq("id", id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(`Saved ${dirtyCount} mapping${dirtyCount === 1 ? "" : "s"}`);
      setPending({});
      qc.invalidateQueries({ queryKey: ["ing-category-mappings", restaurantId] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to save"),
  });

  const effective = (cat: CategoryRow, field: "inv" | "cogs") => {
    const p = pending[cat.id];
    if (p && field in p) return p[field];
    return field === "inv" ? cat.inventory_account_code : cat.cogs_account_code;
  };

  const fallback = (cat: CategoryRow, field: "inv" | "cogs") => {
    const std = standardByName[cat.name.toLowerCase()];
    if (!std) return field === "inv" ? "1200" : "5000";
    return field === "inv" ? std.inventory_account_code : std.cogs_account_code;
  };

  return (
    <>
      <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
        <div className="flex items-center justify-between gap-4 min-h-[56px]">
          <div className="flex items-center gap-3 min-w-[240px] flex-1">
            <Tags className="h-7 w-7 text-primary" />
            <div>
              <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">Ingredient Account Mappings</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Override the Inventory and COGS accounts each ingredient category posts to.
                Leaving a field blank uses the seeded default.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => saveAll.mutate()}
              disabled={dirtyCount === 0 || saveAll.isPending}
            >
              <Save className="h-4 w-4 mr-1.5" />
              {saveAll.isPending ? "Saving…" : `Save${dirtyCount ? ` (${dirtyCount})` : ""}`}
            </Button>
          </div>
        </div>

        <Card className="bg-muted/30 border-muted">
          <CardContent className="pt-6 flex gap-3 items-start">
            <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
            <div className="text-xs text-muted-foreground">
              When a sale consumes an ingredient, the system posts <span className="font-mono">DR COGS</span> /{" "}
              <span className="font-mono">CR Inventory</span>. The accounts are resolved per ingredient
              with this priority: <strong>item-level override → category mapping (this page) → seeded default</strong>.
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Categories</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-sm text-muted-foreground py-8 text-center">Loading…</div>
            ) : categories.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                No ingredient categories yet. Create them in Inventory → Categories.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead>Inventory account (DR on purchase / CR on sale)</TableHead>
                    <TableHead>COGS account (DR on sale)</TableHead>
                    <TableHead className="w-24"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categories.map((cat) => {
                    const invVal = effective(cat, "inv") ?? "";
                    const cogsVal = effective(cat, "cogs") ?? "";
                    const isDirty = !!pending[cat.id];
                    const usingDefault = !invVal && !cogsVal;
                    return (
                      <TableRow key={cat.id} className={isDirty ? "bg-primary/5" : ""}>
                        <TableCell>
                          <div className="font-medium">{cat.name}</div>
                          {usingDefault && (
                            <Badge variant="outline" className="text-[10px] mt-1">Using default</Badge>
                          )}
                          {isDirty && (
                            <Badge variant="secondary" className="text-[10px] mt-1 ml-1">Unsaved</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <AccountPicker
                            value={invVal}
                            onChange={(v) => setOverride(cat.id, "inv", v || null)}
                            options={inventoryAccounts}
                            placeholderCode={fallback(cat, "inv")}
                          />
                        </TableCell>
                        <TableCell>
                          <AccountPicker
                            value={cogsVal}
                            onChange={(v) => setOverride(cat.id, "cogs", v || null)}
                            options={cogsAccounts}
                            placeholderCode={fallback(cat, "cogs")}
                          />
                        </TableCell>
                        <TableCell>
                          {(cat.inventory_account_code || cat.cogs_account_code || isDirty) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => resetRow(cat.id)}
                              title="Reset to seeded default"
                            >
                              <RotateCcw className="h-4 w-4 mr-1" /> Reset
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function AccountPicker({
  value, onChange, options, placeholderCode,
}: {
  value: string;
  onChange: (v: string) => void;
  options: AccountRow[];
  placeholderCode: string;
}) {
  const placeholder = options.find((o) => o.account_code === placeholderCode);
  return (
    <Select value={value || "__default__"} onValueChange={(v) => onChange(v === "__default__" ? "" : v)}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={`Default (${placeholderCode})`} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__default__">
          Use default ({placeholderCode}{placeholder ? ` - ${placeholder.account_name}` : ""})
        </SelectItem>
        {options.map((a) => (
          <SelectItem key={a.id} value={a.account_code}>
            <span className="font-mono text-xs mr-2">{a.account_code}</span>{a.account_name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}