import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Standalone, iframe-friendly version of the Food Cost Calculator.
// No site chrome, no navigation. Designed to be embedded on third-party
// blogs and supplier sites. Every embed = an "Powered by Matbex" backlink.

interface Ingredient {
  id: string;
  name: string;
  qty: number;
  unitCost: number;
}

const uid = () => Math.random().toString(36).slice(2, 9);

export default function FoodCostEmbed() {
  const [menuPrice, setMenuPrice] = useState<number>(45);
  const [yieldServings, setYieldServings] = useState<number>(1);
  const [items, setItems] = useState<Ingredient[]>([
    { id: uid(), name: "Chicken breast", qty: 0.25, unitCost: 35 },
    { id: uid(), name: "Rice", qty: 0.15, unitCost: 8 },
    { id: uid(), name: "Sauce & spices", qty: 1, unitCost: 2.5 },
  ]);

  // Allow embedding host to auto-resize the iframe to content height.
  useEffect(() => {
    const post = () => {
      try {
        window.parent?.postMessage(
          { type: "matbex:embed:resize", height: document.documentElement.scrollHeight },
          "*",
        );
      } catch {
        /* noop */
      }
    };
    post();
    const ro = new ResizeObserver(post);
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, []);

  const totalRecipeCost = useMemo(
    () => items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.unitCost) || 0), 0),
    [items],
  );
  const perPlate = yieldServings > 0 ? totalRecipeCost / yieldServings : 0;
  const foodCostPct = menuPrice > 0 ? (perPlate / menuPrice) * 100 : 0;
  const grossMargin = menuPrice - perPlate;
  const status = foodCostPct === 0 ? "" : foodCostPct < 25 ? "Excellent" : foodCostPct < 32 ? "Healthy" : foodCostPct < 38 ? "Watch" : "Too high";
  const statusColor = foodCostPct < 32 ? "text-emerald-600" : foodCostPct < 38 ? "text-amber-600" : "text-red-600";

  const update = (id: string, patch: Partial<Ingredient>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  return (
    <div className="bg-background text-foreground min-h-[300px]">
      <Helmet>
        <meta name="robots" content="noindex, follow" />
      </Helmet>
      <div className="p-4 md:p-6 max-w-2xl mx-auto">
        <div className="flex items-baseline justify-between mb-4">
          <h1 className="text-xl font-medium">Food Cost Calculator</h1>
          <a
            href="https://www.matbex.com/tools/food-cost-calculator?utm_source=embed&utm_medium=widget"
            target="_blank"
            rel="noopener"
            className="text-xs text-muted-foreground hover:text-primary"
          >
            Powered by Matbex ↗
          </a>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <Label className="text-xs">Menu price (SAR)</Label>
            <Input type="number" min={0} value={menuPrice} onChange={(e) => setMenuPrice(Number(e.target.value))} />
          </div>
          <div>
            <Label className="text-xs">Yields (plates)</Label>
            <Input type="number" min={1} value={yieldServings} onChange={(e) => setYieldServings(Number(e.target.value))} />
          </div>
        </div>

        <div className="rounded-lg border border-border p-3 mb-4">
          <div className="grid grid-cols-12 gap-2 text-[10px] uppercase tracking-wide text-muted-foreground mb-1 px-1">
            <div className="col-span-5">Ingredient</div>
            <div className="col-span-3">Qty</div>
            <div className="col-span-3">Unit cost</div>
            <div className="col-span-1" />
          </div>
          {items.map((i) => (
            <div key={i.id} className="grid grid-cols-12 gap-2 mb-2 items-center">
              <Input className="col-span-5 h-8 text-sm" value={i.name} onChange={(e) => update(i.id, { name: e.target.value })} />
              <Input className="col-span-3 h-8 text-sm" type="number" min={0} step="0.01" value={i.qty} onChange={(e) => update(i.id, { qty: Number(e.target.value) })} />
              <Input className="col-span-3 h-8 text-sm" type="number" min={0} step="0.01" value={i.unitCost} onChange={(e) => update(i.id, { unitCost: Number(e.target.value) })} />
              <button
                className="col-span-1 text-muted-foreground hover:text-destructive justify-self-center"
                onClick={() => setItems((p) => p.filter((x) => x.id !== i.id))}
                aria-label="Remove ingredient"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="mt-1 h-8"
            onClick={() => setItems((p) => [...p, { id: uid(), name: "", qty: 1, unitCost: 0 }])}
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> Add ingredient
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
          <Mini label="Recipe cost" value={`${totalRecipeCost.toFixed(2)}`} />
          <Mini label="Per plate" value={`${perPlate.toFixed(2)}`} />
          <Mini label="Food cost %" value={`${foodCostPct.toFixed(1)}%`} accent={statusColor} sub={status} />
          <Mini label="Margin/plate" value={`${grossMargin.toFixed(2)}`} />
        </div>

        <a
          href="https://www.matbex.com/tools/food-cost-calculator?utm_source=embed&utm_medium=widget&utm_campaign=cta"
          target="_blank"
          rel="noopener"
          className="block text-center text-sm text-primary hover:underline"
        >
          Get the full version + automated stocktakes → matbex.com
        </a>
      </div>
    </div>
  );
}

function Mini({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="p-2 rounded-md border border-border bg-card">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-lg font-light leading-tight mt-0.5 ${accent ?? ""}`}>{value}</div>
      {sub && <div className={`text-[10px] mt-0.5 ${accent ?? "text-muted-foreground"}`}>{sub}</div>}
    </div>
  );
}