import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { RouteSeo } from "@/components/seo/RouteSeo";
import { ArticleLayout } from "@/components/marketing/ArticleLayout";

/**
 * Cornerstone blog post: Restaurant COGS playbook for KSA operators.
 * Target: "restaurant cogs", "food cost percentage", "cogs formula restaurant", "ksa restaurant accounting".
 */
export default function RestaurantCogsGuide() {
  const title = "Restaurant COGS in Saudi Arabia: An Operator's Playbook (2026)";
  const description =
    "How real KSA restaurant operators measure, control, and lower Cost of Goods Sold. The COGS formula, target ratios, weekly cadence, common leaks, and the accounting entries that make it all add up.";
  const path = "/blog/restaurant-cogs-guide-ksa";
  const url = `https://matbex.com${path}`;
  const datePublished = "2026-05-30";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: title,
    description,
    inLanguage: "en",
    datePublished,
    dateModified: datePublished,
    author: { "@type": "Organization", name: "Matbex" },
    publisher: {
      "@type": "Organization",
      name: "Matbex",
      logo: { "@type": "ImageObject", url: "https://matbex.com/og-image.png" },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    image: ["https://matbex.com/og-image.png"],
    keywords:
      "restaurant COGS, food cost percentage, cost of goods sold formula, KSA restaurant accounting, inventory variance, restaurant profit",
  };

  return (
    <>
      <RouteSeo title={title} description={description} path={path} ogType="article" />
      <Helmet>
        <link rel="alternate" hrefLang="en" href={url} />
        <meta name="article:published_time" content={`${datePublished}T00:00:00Z`} />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>


      <ArticleLayout eyebrow="Operations · Profitability" title={title} meta="Published May 30, 2026 · 12 min read">

        <article className="prose prose-lg max-w-none text-gray-700 leading-relaxed space-y-6">
          <p className="text-xl text-gray-700">
            Most restaurants in Saudi Arabia do not have a margin problem. They have a
            <em> measurement </em>problem. Cost of Goods Sold — COGS — is the single number that
            decides whether you are running a kitchen or a charity. This playbook is how disciplined
            operators measure it, week by week.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">The COGS formula, properly stated</h2>
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 not-prose my-6">
            <p className="text-lg font-mono text-gray-900">
              COGS = Opening Inventory + Purchases − Closing Inventory
            </p>
          </div>
          <p>
            Three numbers. Each one has a way of going wrong. <strong>Opening inventory</strong> is
            the closing of last period — if last period was sloppy, this one starts compromised.
            <strong> Purchases</strong> is every invoice that hit the kitchen, including the cash
            run to the wholesaler that the manager forgot to log. <strong>Closing inventory</strong>
            is whatever is physically on the shelves at the moment you count.
          </p>
          <p>
            COGS as a <strong>percentage of net sales</strong> is what you actually manage:
          </p>
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 not-prose my-6">
            <p className="text-lg font-mono text-gray-900">
              Food Cost % = COGS ÷ Net Food Sales × 100
            </p>
          </div>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">Target ratios for Saudi restaurants</h2>
          <p>Healthy benchmarks, by concept:</p>
          <ul className="list-disc ps-6 space-y-2">
            <li><strong>Quick-service (shawarma, burgers, broasted):</strong> 28–32%</li>
            <li><strong>Casual dining:</strong> 30–34%</li>
            <li><strong>Premium / steakhouse / seafood:</strong> 34–38%</li>
            <li><strong>Specialty coffee:</strong> 18–24% on beverage, 45–55% on food</li>
          </ul>
          <p>
            Anything above 38% in QSR or 40% in casual is bleeding. Anything below 25% usually
            means under-portioning, supplier kickbacks, or an inventory count that wasn&apos;t real.
            Use these ratios alongside the{" "}
            <Link to="/blog/menu-engineering-matrix-guide" className="text-[#00713A] underline">
              menu engineering matrix
            </Link>{" "}
            to decide whether a high-cost item is worth keeping.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">Why monthly COGS is useless</h2>
          <p>
            A 30-day count tells you a problem existed somewhere in the last month. That is too
            late. By the time the variance shows up in the P&amp;L, the chicken has been over-portioned
            for three weeks and the saffron has walked out the back door.
          </p>
          <p>The cadence that actually works:</p>
          <ul className="list-disc ps-6 space-y-2">
            <li>
              <strong>Daily:</strong>{" "}
              <Link to="/blog/zatca-phase-2-restaurant-guide" className="text-[#00713A] underline">
                ZATCA-compliant POS
              </Link>{" "}
              driven theoretical COGS — what <em>should</em> have been used given what was sold.
            </li>
            <li><strong>Weekly:</strong> Physical count on the 5–10 highest-cost items (proteins, dairy, oils, premium produce).</li>
            <li><strong>Monthly:</strong> Full physical count, full variance reconciliation against the ledger.</li>
          </ul>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">Theoretical vs. actual COGS — the variance that matters</h2>
          <p>
            <strong>Theoretical COGS</strong> = sum of recipe costs for every menu item sold.
            <strong>Actual COGS</strong> = what your physical count says you used.
          </p>
          <p>The gap is the <strong>variance</strong>, and it has only four sources:</p>
          <ol className="list-decimal ps-6 space-y-2">
            <li><strong>Portioning drift</strong> — staff giving away grams.</li>
            <li><strong>Waste and spoilage</strong> — legitimate, but must be logged separately, not buried in COGS.</li>
            <li><strong>Theft</strong> — staff meals undocumented, takeout for friends, cash sales rung as voids.</li>
            <li><strong>Recipe drift</strong> — the kitchen quietly upgraded the cheese and never told the menu.</li>
          </ol>
          <p>
            A variance over <strong>2%</strong> of food sales is a fire. Most operators discover it
            three months late. The right system surfaces it the morning after the week closes.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">Accounting entries that make COGS real</h2>
          <p>
            COGS is not a single account — it is a <strong>discipline</strong> that ties three
            workflows together. The double-entry pattern:
          </p>
          <ul className="list-disc ps-6 space-y-3">
            <li>
              <strong>On purchase:</strong> Debit <em>Inventory (1300)</em>, Credit <em>Accounts Payable (2100)</em>.
              Goods sit as an asset until consumed.
            </li>
            <li>
              <strong>On consumption (sale):</strong> Debit <em>COGS (5100)</em>, Credit <em>Inventory (1300)</em>.
              Triggered by recipe deduction when the POS posts a sale.
            </li>
            <li>
              <strong>On waste:</strong> Debit <em>Waste &amp; Spoilage (6100)</em>, Credit <em>Inventory (1300)</em>.
              Never mix into COGS — the line manager who is failing at waste needs visibility.
            </li>
            <li>
              <strong>On stock count adjustment:</strong> Debit/Credit <em>Inventory Variance (5150)</em> against
              <em> Inventory</em>. This is the unexplained gap — the early-warning signal.
            </li>
          </ul>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">Five leaks worth checking this week</h2>
          <ol className="list-decimal ps-6 space-y-2">
            <li>The <strong>chicken yield</strong>. Whole-bird purchases vs. plated portions almost always under-perform recipe assumptions.</li>
            <li><strong>Beverage pour</strong>. A 10% over-pour on cold drinks is invisible to the eye and devastating to margin.</li>
            <li><strong>Bread and rice waste</strong> at family-meal counts. Often 8–15% of consumption.</li>
            <li><strong>Supplier price creep</strong>. Last invoice vs. previous, by item. Set alerts at 5%.</li>
            <li><strong>Free meals and comps</strong>. Should be a separate account, not folded into discounts.</li>
          </ol>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">What good looks like</h2>
          <ul className="list-disc ps-6 space-y-2">
            <li>Theoretical COGS calculated automatically from every POS sale.</li>
            <li>Weekly physical count on high-cost items takes under 30 minutes.</li>
            <li>Variance alert in the owner&apos;s inbox the morning after the count.</li>
            <li>Monthly P&amp;L closes within 3 business days, not 3 weeks.</li>
            <li>Every supplier invoice posts to AP and inventory in a single step, not three.</li>
          </ul>

          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-8 my-12 not-prose">
            <h3 className="text-xl font-semibold text-gray-900 mb-3">Run COGS like an operator, not an accountant</h3>
            <p className="text-gray-600 mb-6">
              Matbex tracks theoretical COGS from every sale, runs weekly variance the morning
              after your count, and posts the entries to the ledger automatically. Free to start.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild className="bg-[#007a3d] hover:bg-[#006b33] text-white">
                <Link to="/register">Start free trial</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/sa/restaurant-pos">Restaurant POS overview</Link>
              </Button>
            </div>
          </div>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">Further reading</h2>
          <ul className="list-disc ps-6 space-y-2">
            <li><Link to="/blog/menu-engineering-matrix-guide" className="text-[#00713A] underline">Menu engineering matrix: how restaurant operators build profitable menus</Link></li>
            <li><Link to="/blog/zatca-phase-2-restaurant-guide" className="text-[#00713A] underline">ZATCA Phase 2 for restaurants: the complete operator guide</Link></li>
            <li><Link to="/sa/restaurant-pos" className="text-[#00713A] underline">Restaurant POS for Saudi Arabia</Link></li>
            <li><Link to="/ar" className="text-[#00713A] underline">الصفحة الرئيسية بالعربية</Link></li>
          </ul>
        </article>
      </ArticleLayout>
    </>
  );
}