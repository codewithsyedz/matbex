import { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { Receipt } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RouteSeo } from "@/components/seo/RouteSeo";
import { PageTransition } from "@/components/PageTransition";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";

export default function CogsCalculator() {
  const title = "Free COGS Calculator for Restaurants (Opening + Purchases − Closing) | Matbex";
  const description =
    "Calculate Cost of Goods Sold, COGS %, prime cost and gross margin for your restaurant. Free, no signup. Saudi Arabia (SAR).";

  const [opening, setOpening] = useState(45000);
  const [purchases, setPurchases] = useState(82000);
  const [closing, setClosing] = useState(38000);
  const [sales, setSales] = useState(285000);
  const [labor, setLabor] = useState(72000);

  const cogs = Math.max(0, opening + purchases - closing);
  const cogsPct = sales > 0 ? (cogs / sales) * 100 : 0;
  const grossProfit = sales - cogs;
  const grossMarginPct = sales > 0 ? (grossProfit / sales) * 100 : 0;
  const primeCost = cogs + labor;
  const primeCostPct = sales > 0 ? (primeCost / sales) * 100 : 0;

  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

  const health = useMemo(() => {
    if (sales <= 0) return { label: "", color: "" };
    if (primeCostPct <= 60) return { label: "On target — healthy prime cost", color: "text-emerald-600" };
    if (primeCostPct <= 65) return { label: "Acceptable — watch food & labor", color: "text-amber-600" };
    return { label: "Too high — investigate waste, theft or pricing", color: "text-red-600" };
  }, [primeCostPct, sales]);

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: title,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: "https://matbex.com/tools/cogs-calculator",
      offers: { "@type": "Offer", price: "0", priceCurrency: "SAR" },
    },
    {
      "@context": "https://schema.org",
      "@type": "HowTo",
      name: "How to calculate restaurant COGS",
      step: [
        { "@type": "HowToStep", name: "Opening inventory", text: "Value of all inventory on hand at the start of the period." },
        { "@type": "HowToStep", name: "Add purchases", text: "Sum every purchase invoice received during the period (food + beverage)." },
        { "@type": "HowToStep", name: "Subtract closing inventory", text: "Value of all inventory on hand at the end of the period (from your stocktake)." },
        { "@type": "HowToStep", name: "Result", text: "COGS = Opening + Purchases − Closing. Divide by sales for COGS %." },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        { "@type": "Question", name: "What is the COGS formula for restaurants?", acceptedAnswer: { "@type": "Answer", text: "COGS = Opening Inventory + Purchases − Closing Inventory. The result represents the cost of inventory consumed during the period." } },
        { "@type": "Question", name: "What is a good COGS percentage?", acceptedAnswer: { "@type": "Answer", text: "Most full-service restaurants in Saudi Arabia target 28–32%. Quick-service can be 22–28%. The combined prime cost (COGS + labor) should stay at or below 60% of sales." } },
        { "@type": "Question", name: "Why is my COGS higher than my food cost %?", acceptedAnswer: { "@type": "Answer", text: "Food cost % is theoretical — it assumes perfect portioning and zero waste. COGS is actual. The gap is waste, over-portioning, theft or stocktake errors. Matbex highlights the variance every week." } },
      ],
    },
  ];

  return (
    <PageTransition>
      <RouteSeo title={title} description={description} path="/tools/cogs-calculator" />
      <Helmet>
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>
      <div className="min-h-screen bg-background">
        <LandingHeader />
        <main className="container mx-auto px-4 py-12 max-w-4xl">
          <nav className="text-sm text-muted-foreground mb-4">
            <Link to="/" className="hover:text-foreground">Home</Link> /{" "}
            <Link to="/tools" className="hover:text-foreground">Free Tools</Link> /{" "}
            <span className="text-foreground">COGS Calculator</span>
          </nav>

          <div className="flex items-center gap-3 mb-3">
            <Receipt className="w-8 h-8 text-primary" />
            <h1 className="text-3xl md:text-4xl font-light tracking-tight">Restaurant COGS Calculator</h1>
          </div>
          <p className="text-muted-foreground mb-8 max-w-2xl">
            <strong>COGS = Opening Inventory + Purchases − Closing Inventory.</strong> Enter your period numbers below
            to see actual COGS, prime cost and gross margin. All amounts in SAR.
          </p>

          <div className="grid md:grid-cols-2 gap-4 mb-6">
            <Field label="Opening inventory (SAR)" value={opening} onChange={setOpening} />
            <Field label="Purchases this period (SAR)" value={purchases} onChange={setPurchases} />
            <Field label="Closing inventory (SAR)" value={closing} onChange={setClosing} />
            <Field label="Net sales this period (SAR)" value={sales} onChange={setSales} />
            <Field label="Labor cost this period (SAR)" value={labor} onChange={setLabor} />
          </div>

          <div className="grid md:grid-cols-3 gap-4 mb-6">
            <Stat label="COGS" value={`${fmt(cogs)} SAR`} sub={`${cogsPct.toFixed(1)}% of sales`} />
            <Stat label="Gross profit" value={`${fmt(grossProfit)} SAR`} sub={`${grossMarginPct.toFixed(1)}% margin`} />
            <Stat label="Prime cost" value={`${fmt(primeCost)} SAR`} sub={`${primeCostPct.toFixed(1)}% of sales`} accent={health.color} />
          </div>

          {health.label && (
            <div className={`p-4 rounded-xl border border-border bg-card mb-10 ${health.color}`}>
              {health.label}
            </div>
          )}

          <section className="prose prose-sm max-w-none text-muted-foreground space-y-4 mb-10">
            <h2 className="text-foreground text-xl font-light">What COGS actually tells you</h2>
            <p>
              COGS is the single most important number on a restaurant P&amp;L. It measures the value of inventory you
              actually consumed in a period — regardless of when you paid the supplier. The formula
              <strong> Opening + Purchases − Closing</strong> works because anything you started with, plus what you
              bought, minus what's left on the shelf, must have been used (sold, wasted or stolen).
            </p>
            <h2 className="text-foreground text-xl font-light">Prime cost &amp; the 60% rule</h2>
            <p>
              <strong>Prime cost = COGS + Labor.</strong> Successful Saudi restaurants keep prime cost at or below 60% of sales.
              If yours is climbing, the next question isn't "raise prices" — it's "is COGS or labor moving?" Matbex separates the two
              automatically and shows the trend by week.
            </p>
            <h2 className="text-foreground text-xl font-light">Stop calculating, start tracking</h2>
            <p>
              Matbex computes COGS from your purchase invoices and weekly stocktakes — no spreadsheet, no end-of-month surprise.
              See <Link to="/blog/restaurant-cogs-guide-ksa" className="text-primary hover:underline">the full COGS guide for KSA</Link>
              {" "}or <Link to="/sa/restaurant-pos" className="text-primary hover:underline">open the platform</Link>.
            </p>
          </section>

          <div className="flex flex-wrap gap-3 text-sm">
            <Link className="text-primary hover:underline" to="/tools/food-cost-calculator">→ Food Cost Calculator</Link>
            <Link className="text-primary hover:underline" to="/tools/menu-price-calculator">→ Menu Price Calculator</Link>
          </div>
        </main>
        <LandingFooter />
      </div>
    </PageTransition>
  );
}

function Field({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <Input type="number" min={0} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
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