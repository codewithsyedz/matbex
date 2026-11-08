import { useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { Calculator } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { RouteSeo } from "@/components/seo/RouteSeo";
import { PageTransition } from "@/components/PageTransition";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";

export default function MenuPriceCalculator() {
  const title = "Menu Price Calculator — Reverse Food Cost % to Selling Price | Matbex";
  const description =
    "Enter ingredient cost and target food cost %; get the right menu price, markup and gross margin per plate. Free, no signup. Saudi Arabia.";

  const [ingredientCost, setIngredientCost] = useState(12);
  const [targetPct, setTargetPct] = useState(30);
  const [vatPct, setVatPct] = useState(15);

  const suggested = targetPct > 0 ? (ingredientCost / (targetPct / 100)) : 0;
  const rounded = Math.ceil(suggested); // round up to nearest SAR
  const margin = rounded - ingredientCost;
  const markup = ingredientCost > 0 ? ((margin / ingredientCost) * 100) : 0;
  const priceWithVat = rounded * (1 + vatPct / 100);

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: title,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: "https://matbex.com/tools/menu-price-calculator",
      offers: { "@type": "Offer", price: "0", priceCurrency: "SAR" },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        { "@type": "Question", name: "How do you reverse-engineer a menu price from food cost %?", acceptedAnswer: { "@type": "Answer", text: "Menu price = Ingredient cost ÷ Target food cost %. Example: 12 SAR of ingredients at a 30% target = 12 ÷ 0.30 = 40 SAR." } },
        { "@type": "Question", name: "Should menu prices include VAT?", acceptedAnswer: { "@type": "Answer", text: "In Saudi Arabia restaurants typically display VAT-inclusive prices. The calculator shows both the ex-VAT working price and the final price with 15% VAT applied." } },
        { "@type": "Question", name: "What target food cost % should I use?", acceptedAnswer: { "@type": "Answer", text: "Use 28–32% for full-service, 22–28% for QSR, 18–24% for beverages. Lower the target for items that take more labor or have higher waste." } },
      ],
    },
  ];

  return (
    <PageTransition>
      <RouteSeo title={title} description={description} path="/tools/menu-price-calculator" />
      <Helmet>
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>
      <div className="min-h-screen bg-background">
        <LandingHeader />
        <main className="container mx-auto px-4 py-12 max-w-4xl">
          <nav className="text-sm text-muted-foreground mb-4">
            <Link to="/" className="hover:text-foreground">Home</Link> /{" "}
            <Link to="/tools" className="hover:text-foreground">Free Tools</Link> /{" "}
            <span className="text-foreground">Menu Price Calculator</span>
          </nav>

          <div className="flex items-center gap-3 mb-3">
            <Calculator className="w-8 h-8 text-primary" />
            <h1 className="text-3xl md:text-4xl font-light tracking-tight">Menu Price Calculator</h1>
          </div>
          <p className="text-muted-foreground mb-8 max-w-2xl">
            Enter the cost of ingredients per plate and your target food cost %. We'll compute the menu price that hits
            your margin — and the VAT-inclusive price guests will see.
          </p>

          <div className="grid md:grid-cols-2 gap-6 mb-8">
            <div>
              <Label>Ingredient cost per plate (SAR)</Label>
              <Input type="number" min={0} step="0.5" value={ingredientCost} onChange={(e) => setIngredientCost(Number(e.target.value))} />
            </div>
            <div>
              <Label>VAT % (KSA = 15)</Label>
              <Input type="number" min={0} value={vatPct} onChange={(e) => setVatPct(Number(e.target.value))} />
            </div>
            <div className="md:col-span-2">
              <Label>Target food cost %: <span className="text-primary font-medium">{targetPct}%</span></Label>
              <Slider
                value={[targetPct]}
                onValueChange={(v) => setTargetPct(v[0])}
                min={15}
                max={45}
                step={1}
                className="mt-3"
              />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>15% (high margin)</span><span>30% (typical)</span><span>45% (premium)</span>
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-4 gap-4 mb-10">
            <Stat label="Theoretical price" value={`${suggested.toFixed(2)} SAR`} />
            <Stat label="Suggested menu price" value={`${rounded} SAR`} accent="text-primary" sub="rounded up" />
            <Stat label="Markup" value={`${markup.toFixed(0)}%`} sub={`${margin.toFixed(2)} SAR margin`} />
            <Stat label="Price with VAT" value={`${priceWithVat.toFixed(2)} SAR`} sub={`incl. ${vatPct}% VAT`} />
          </div>

          <section className="prose prose-sm max-w-none text-muted-foreground space-y-4 mb-10">
            <h2 className="text-foreground text-xl font-light">The formula</h2>
            <p>
              <strong>Menu price = Ingredient cost ÷ Target food cost %.</strong> If a plate's ingredients cost
              12 SAR and your target is 30%, the math is 12 ÷ 0.30 = <strong>40 SAR</strong>. The remaining 70% covers
              labor, rent, utilities, marketing — and profit.
            </p>
            <h2 className="text-foreground text-xl font-light">Round, then test</h2>
            <p>
              We always round up to the next whole riyal — guests perceive 40 SAR as a fairer price than 39.40 SAR,
              and the extra 60 halalas covers the waste your stocktake will eventually reveal. Test new prices on a
              single branch for two weeks before rolling out chain-wide.
            </p>
            <h2 className="text-foreground text-xl font-light">Where this gets harder</h2>
            <p>
              Real pricing has to account for combo deals, modifier upsells, aggregator commission (Hungerstation, Jahez,
              ToYou take 18–25%) and ZATCA-inclusive display. Matbex models all of that automatically and shows
              channel-level profit per plate.
            </p>
          </section>

          <div className="flex flex-wrap gap-3 text-sm">
            <Link className="text-primary hover:underline" to="/tools/food-cost-calculator">→ Food Cost Calculator</Link>
            <Link className="text-primary hover:underline" to="/tools/cogs-calculator">→ COGS Calculator</Link>
            <Link className="text-primary hover:underline" to="/sa/delivery-aggregators">→ Delivery aggregator margin guide</Link>
          </div>
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
      {sub && <div className="text-xs mt-1 text-muted-foreground">{sub}</div>}
    </div>
  );
}