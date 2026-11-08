import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { Calculator, ChefHat, Receipt, ArrowRight } from "lucide-react";
import { RouteSeo } from "@/components/seo/RouteSeo";
import { PageTransition } from "@/components/PageTransition";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";

/**
 * Free tools hub — link bait landing page that lists every Matbex calculator.
 * Targets head terms like "restaurant food cost calculator", "cogs calculator",
 * "menu pricing calculator" and funnels traffic into the product.
 */
export default function ToolsHub() {
  const title = "Free Restaurant Calculators — Food Cost, COGS & Menu Pricing | Matbex";
  const description =
    "Free, no-signup calculators for Saudi restaurants: food cost per plate, COGS (Opening + Purchases − Closing) and target menu pricing. Built by Matbex.";
  const url = "https://matbex.com/tools";

  const tools = [
    {
      href: "/tools/food-cost-calculator",
      icon: ChefHat,
      title: "Food Cost Calculator",
      desc: "Plate cost + food cost % from your recipe ingredients. Add unlimited rows, see margin instantly.",
    },
    {
      href: "/tools/cogs-calculator",
      icon: Receipt,
      title: "COGS Calculator",
      desc: "Cost of Goods Sold = Opening Inventory + Purchases − Closing Inventory. Plus prime cost & gross margin.",
    },
    {
      href: "/tools/menu-price-calculator",
      icon: Calculator,
      title: "Menu Price Calculator",
      desc: "Reverse-engineer the right menu price from a target food cost % and your ingredient cost.",
    },
  ];

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: title,
    description,
    url,
    inLanguage: "en",
    publisher: { "@type": "Organization", name: "Matbex", url: "https://matbex.com" },
    hasPart: tools.map((t) => ({
      "@type": "WebApplication",
      name: t.title,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: `https://matbex.com${t.href}`,
      offers: { "@type": "Offer", price: "0", priceCurrency: "SAR" },
    })),
  };

  return (
    <PageTransition>
      <RouteSeo title={title} description={description} path="/tools" />
      <Helmet>
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>
      <div className="min-h-screen bg-background">
        <LandingHeader />
        <main className="container mx-auto px-4 py-16 max-w-5xl">
          <nav className="text-sm text-muted-foreground mb-6">
            <Link to="/" className="hover:text-foreground">Home</Link> / <span className="text-foreground">Free Tools</span>
          </nav>
          <h1 className="text-4xl md:text-5xl font-light tracking-tight mb-4">Free Restaurant Calculators</h1>
          <p className="text-lg text-muted-foreground mb-12 max-w-2xl">
            No signup. No email. Run the numbers in your browser — the same formulas Matbex uses under the hood to track
            every Saudi restaurant on the platform.
          </p>

          <div className="grid md:grid-cols-3 gap-6">
            {tools.map((t) => (
              <Link
                key={t.href}
                to={t.href}
                className="group p-6 rounded-2xl border border-border hover:border-primary/50 hover:shadow-lg transition-all bg-card"
              >
                <t.icon className="w-8 h-8 text-primary mb-4" />
                <h2 className="text-xl font-medium mb-2">{t.title}</h2>
                <p className="text-sm text-muted-foreground mb-4">{t.desc}</p>
                <span className="text-sm text-primary inline-flex items-center gap-1 group-hover:gap-2 transition-all">
                  Open calculator <ArrowRight className="w-4 h-4" />
                </span>
              </Link>
            ))}
          </div>

          <section className="mt-16 p-8 rounded-2xl bg-muted/30 border border-border">
            <h2 className="text-2xl font-light mb-3">Why we ship these for free</h2>
            <p className="text-muted-foreground mb-4">
              Most restaurant operators in Saudi Arabia track food cost on a whiteboard — or not at all. These tools are
              a no-friction way to see the same numbers Matbex calculates automatically from your sales, purchases and
              stocktakes. When you're ready to stop typing into a calculator, the full platform is free to start.
            </p>
            <div className="flex flex-wrap gap-3 text-sm">
              <Link className="text-primary hover:underline" to="/blog/restaurant-cogs-guide-ksa">Read: COGS guide for KSA restaurants</Link>
              <span className="text-muted-foreground">·</span>
              <Link className="text-primary hover:underline" to="/sa/restaurant-pos">Matbex POS for Saudi Arabia</Link>
              <span className="text-muted-foreground">·</span>
              <Link className="text-primary hover:underline" to="/sa/zatca-e-invoicing">ZATCA Phase 2 e-invoicing</Link>
            </div>
          </section>
        </main>
        <LandingFooter />
      </div>
    </PageTransition>
  );
}