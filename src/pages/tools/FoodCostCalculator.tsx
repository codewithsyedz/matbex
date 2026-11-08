import { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { Plus, Trash2, ChefHat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RouteSeo } from "@/components/seo/RouteSeo";
import { PageTransition } from "@/components/PageTransition";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";

interface Ingredient {
  id: string;
  name: string;
  qty: number;
  unitCost: number;
}

const uid = () => Math.random().toString(36).slice(2, 9);

export default function FoodCostCalculator() {
  const title = "Free Food Cost Calculator (Per Plate, in SAR) | Matbex";
  const description =
    "Calculate plate cost and food cost percentage from your recipe ingredients in seconds. Free, no signup. Built for Saudi restaurants.";

  const [menuPrice, setMenuPrice] = useState<number>(45);
  const [yieldServings, setYieldServings] = useState<number>(1);
  const [items, setItems] = useState<Ingredient[]>([
    { id: uid(), name: "Chicken breast", qty: 0.25, unitCost: 35 },
    { id: uid(), name: "Rice", qty: 0.15, unitCost: 8 },
    { id: uid(), name: "Sauce & spices", qty: 1, unitCost: 2.5 },
  ]);

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

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: title,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: "https://matbex.com/tools/food-cost-calculator",
      offers: { "@type": "Offer", price: "0", priceCurrency: "SAR" },
    },
    {
      "@context": "https://schema.org",
      "@type": "HowTo",
      name: "How to calculate food cost percentage",
      description: "Sum ingredient costs, divide by servings, divide by menu price.",
      step: [
        { "@type": "HowToStep", name: "Add ingredients", text: "List every ingredient in the recipe with quantity used and unit cost." },
        { "@type": "HowToStep", name: "Set yield", text: "Enter how many servings (plates) the recipe produces." },
        { "@type": "HowToStep", name: "Enter menu price", text: "Enter the selling price per plate in SAR." },
        { "@type": "HowToStep", name: "Read the result", text: "Food cost % = (cost per plate ÷ menu price) × 100. Aim for 28–32%." },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        { "@type": "Question", name: "What is a good food cost percentage for a restaurant?", acceptedAnswer: { "@type": "Answer", text: "For most full-service restaurants in Saudi Arabia, 28–32% is healthy. Quick-service and bakeries can run 22–28%. Anything above 35% usually signals waste, over-portioning or under-pricing." } },
        { "@type": "Question", name: "How do I calculate food cost per plate?", acceptedAnswer: { "@type": "Answer", text: "Add the cost of every ingredient used in the recipe, then divide by the number of plates the recipe yields. This calculator does it automatically." } },
        { "@type": "Question", name: "Should I include packaging and waste?", acceptedAnswer: { "@type": "Answer", text: "Yes — add packaging as a line item, and inflate ingredient quantities by your typical waste percentage (3–8%). Matbex tracks actual waste from your stocktakes so you don't have to estimate." } },
      ],
    },
  ];

  return (
    <PageTransition>
      <RouteSeo title={title} description={description} path="/tools/food-cost-calculator" />
      <Helmet>
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>
      <div className="min-h-screen bg-background">
        <LandingHeader />
        <main className="container mx-auto px-4 py-12 max-w-4xl">
          <nav className="text-sm text-muted-foreground mb-4">
            <Link to="/" className="hover:text-foreground">Home</Link> /{" "}
            <Link to="/tools" className="hover:text-foreground">Free Tools</Link> /{" "}
            <span className="text-foreground">Food Cost Calculator</span>
          </nav>

          <div className="flex items-center gap-3 mb-3">
            <ChefHat className="w-8 h-8 text-primary" />
            <h1 className="text-3xl md:text-4xl font-light tracking-tight">Food Cost Calculator</h1>
          </div>
          <p className="text-muted-foreground mb-8 max-w-2xl">
            Enter your recipe ingredients to see plate cost, food cost % and gross margin. All amounts in SAR.
          </p>

          <div className="grid md:grid-cols-3 gap-4 mb-6">
            <div>
              <Label>Menu price (SAR)</Label>
              <Input type="number" min={0} value={menuPrice} onChange={(e) => setMenuPrice(Number(e.target.value))} />
            </div>
            <div>
              <Label>Recipe yields (plates)</Label>
              <Input type="number" min={1} value={yieldServings} onChange={(e) => setYieldServings(Number(e.target.value))} />
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4 md:p-6 mb-6">
            <div className="grid grid-cols-12 gap-2 text-xs uppercase tracking-wide text-muted-foreground mb-2 px-1">
              <div className="col-span-5">Ingredient</div>
              <div className="col-span-3">Qty used</div>
              <div className="col-span-3">Unit cost (SAR)</div>
              <div className="col-span-1" />
            </div>
            {items.map((i) => (
              <div key={i.id} className="grid grid-cols-12 gap-2 mb-2 items-center">
                <Input className="col-span-5" value={i.name} onChange={(e) => update(i.id, { name: e.target.value })} />
                <Input className="col-span-3" type="number" min={0} step="0.01" value={i.qty} onChange={(e) => update(i.id, { qty: Number(e.target.value) })} />
                <Input className="col-span-3" type="number" min={0} step="0.01" value={i.unitCost} onChange={(e) => update(i.id, { unitCost: Number(e.target.value) })} />
                <button
                  className="col-span-1 text-muted-foreground hover:text-destructive justify-self-center"
                  onClick={() => setItems((p) => p.filter((x) => x.id !== i.id))}
                  aria-label="Remove ingredient"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => setItems((p) => [...p, { id: uid(), name: "", qty: 1, unitCost: 0 }])}
            >
              <Plus className="w-4 h-4 mr-1" /> Add ingredient
            </Button>
          </div>

          <div className="grid md:grid-cols-4 gap-4 mb-10">
            <Stat label="Total recipe cost" value={`${totalRecipeCost.toFixed(2)} SAR`} />
            <Stat label="Cost per plate" value={`${perPlate.toFixed(2)} SAR`} />
            <Stat label="Food cost %" value={`${foodCostPct.toFixed(1)}%`} accent={statusColor} sub={status} />
            <Stat label="Gross margin / plate" value={`${grossMargin.toFixed(2)} SAR`} />
          </div>

          <section className="prose prose-sm max-w-none text-muted-foreground space-y-4 mb-10">
            <h2 className="text-foreground text-xl font-light">How food cost percentage works</h2>
            <p>
              Food cost % is the share of your menu price that goes back out the door as raw ingredient cost.
              The formula is simple: <strong>(Cost per plate ÷ Menu price) × 100</strong>. A healthy range for
              full-service restaurants in Saudi Arabia is <strong>28–32%</strong>. Quick-service concepts often
              run a few points lower, premium steakhouses a few points higher.
            </p>
            <p>
              The number that actually matters is <strong>gross margin per plate × covers per day</strong> —
              not the percentage by itself. A 35% food cost on a 90 SAR plate beats a 25% food cost on a 22 SAR plate
              when volume is similar.
            </p>
            <h2 className="text-foreground text-xl font-light">Want this automated?</h2>
            <p>
              Matbex calculates plate cost for every recipe in your menu from live purchase prices, weekly stocktakes
              and POS sales — and flags items where food cost % drifts above target. <Link className="text-primary hover:underline" to="/sa/restaurant-pos">See the platform</Link>.
            </p>
          </section>

          <div className="flex flex-wrap gap-3 text-sm">
            <Link className="text-primary hover:underline" to="/tools/cogs-calculator">→ COGS Calculator</Link>
            <Link className="text-primary hover:underline" to="/tools/menu-price-calculator">→ Menu Price Calculator</Link>
            <Link className="text-primary hover:underline" to="/blog/restaurant-cogs-guide-ksa">→ Full COGS guide for KSA</Link>
          </div>

          <section className="mt-12 p-6 rounded-2xl border border-border bg-muted/30">
            <h2 className="text-xl font-light mb-2">Embed this calculator on your blog</h2>
            <p className="text-sm text-muted-foreground mb-3">
              Free to use. Paste the snippet below into any website. The widget auto-resizes and credits Matbex.
            </p>
            <pre className="text-xs bg-background border border-border rounded-md p-3 overflow-x-auto"><code>{`<iframe src="https://www.matbex.com/embed/food-cost-calculator" style="width:100%;border:0;min-height:560px" loading="lazy" title="Food Cost Calculator by Matbex"></iframe>
<script>window.addEventListener("message",function(e){if(e.data&&e.data.type==="matbex:embed:resize"){var f=document.querySelector('iframe[src*="matbex.com/embed/food-cost-calculator"]');if(f)f.style.height=e.data.height+"px";}});</script>`}</code></pre>
          </section>
        </main>
        <LandingFooter />
      </div>
    </PageTransition>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="p-4 rounded-xl border border-border bg-card">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-2xl font-light mt-1 ${accent ?? ""}`}>{value}</div>
      {sub && <div className={`text-xs mt-1 ${accent ?? "text-muted-foreground"}`}>{sub}</div>}
    </div>
  );
}