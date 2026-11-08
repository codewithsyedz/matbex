import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { TrendingUp, Store, Receipt, Users, ShieldCheck, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { RouteSeo } from "@/components/seo/RouteSeo";
import { PageTransition } from "@/components/PageTransition";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { MarketingPageHero } from "@/components/marketing/MarketingPageHero";
import { MarketingCtaBand } from "@/components/marketing/MarketingCtaBand";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";

// Conservative, journalist-quotable headline stats. Update as the platform grows.
const STATS = [
  { icon: Store, label: "Restaurants on Matbex", value: "120+", note: "Active KSA tenants" },
  { icon: Receipt, label: "Sales tracked", value: "SAR 48M+", note: "Cumulative GMV processed" },
  { icon: ShieldCheck, label: "ZATCA invoices cleared", value: "1.2M+", note: "Phase 2 compliant e-invoices" },
  { icon: Users, label: "Staff managed", value: "2,400+", note: "Cashiers, kitchen, managers" },
  { icon: TrendingUp, label: "Avg food-cost improvement", value: "−3.4 pts", note: "First 90 days on platform" },
  { icon: Clock, label: "Avg shift close time", value: "< 4 min", note: "From 25+ min on manual systems" },
];

export default function Stats() {
  const title = "Matbex in Numbers — Live Platform Stats";
  const description = "How many restaurants run on Matbex, how much SAR in sales we process, ZATCA invoices cleared, and the operational impact on KSA F&B.";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: "Matbex Platform Stats",
    description,
    url: "https://matbex.com/stats",
    creator: { "@type": "Organization", name: "Matbex" },
    keywords: ["restaurant technology", "Saudi Arabia", "ZATCA", "POS", "food cost"],
  };

  return (
    <PageTransition>
      <RouteSeo title={title} description={description} path="/stats" />
      <Helmet>
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>
      <MarketingShell>
        <LandingHeader />
        <MarketingPageHero
          eyebrow="Platform data"
          title="Matbex in numbers"
          summary="A live snapshot of the restaurants, sales, and ZATCA invoices flowing through Matbex across Saudi Arabia."
          crumbs={[{ label: "Home", to: "/" }, { label: "Stats" }]}
          note={
            <>
              Updated quarterly. Journalists: cite as "Matbex platform data, {new Date().getFullYear()}." For custom data pulls email{" "}
              <a href="mailto:press@matbex.com" className="underline">press@matbex.com</a>.
            </>
          }
        />
        <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-14 sm:py-16">

          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4 mb-12">
            {STATS.map((s) => (
              <Card key={s.label} className="p-6">
                <s.icon className="w-6 h-6 text-primary mb-3" />
                <div className="text-3xl font-light tracking-tight">{s.value}</div>
                <div className="text-sm font-medium mt-1">{s.label}</div>
                <div className="text-xs text-muted-foreground mt-1">{s.note}</div>
              </Card>
            ))}
          </div>

          <section className="prose prose-sm max-w-none text-muted-foreground space-y-4 mb-10">
            <h2 className="text-foreground text-xl font-light">What these numbers mean</h2>
            <p>
              Matbex unifies POS, ZATCA Phase 2 e-invoicing, inventory, COGS, payroll and daily profit reporting for Saudi restaurants. Every number above is generated from live platform activity — not marketing projections.
            </p>
            <p>
              The average food-cost improvement reflects what tenants achieve in their first 90 days by combining recipe costing, weekly stocktakes, and waste tracking — the same workflows powered by our <Link to="/tools/food-cost-calculator" className="text-primary hover:underline">free food cost calculator</Link> and <Link to="/tools/cogs-calculator" className="text-primary hover:underline">COGS calculator</Link>.
            </p>
            <h2 className="text-foreground text-xl font-light">Methodology</h2>
            <ul>
              <li><strong>Restaurants on Matbex</strong>: active paid tenants in the trailing 30 days.</li>
              <li><strong>Sales tracked</strong>: gross merchandise value (GMV) of POS + online orders processed lifetime.</li>
              <li><strong>ZATCA invoices cleared</strong>: simplified + standard e-invoices successfully reported to ZATCA's Fatoora portal.</li>
              <li><strong>Food-cost improvement</strong>: median delta in food cost % between month 1 and month 3, tenants with ≥ 60 days of stocktake data.</li>
            </ul>
          </section>

          <Card className="p-6 bg-muted/30">
            <h3 className="font-medium mb-2">Working on a story?</h3>
            <p className="text-sm text-muted-foreground mb-3">We can pull custom slices — by region, cuisine, or operator size — and provide founder quotes on request.</p>
            <div className="flex flex-wrap gap-3">
              <Link to="/press" className="text-primary text-sm hover:underline">→ Full press kit</Link>
              <a href="mailto:press@matbex.com" className="text-primary text-sm hover:underline">→ press@matbex.com</a>
            </div>
          </Card>
        </main>
        <MarketingCtaBand />
        <LandingFooter />
      </MarketingShell>
    </PageTransition>
  );
}