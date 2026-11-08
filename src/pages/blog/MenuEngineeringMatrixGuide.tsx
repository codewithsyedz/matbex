import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { RouteSeo } from "@/components/seo/RouteSeo";
import { ArticleLayout } from "@/components/marketing/ArticleLayout";

/**
 * Cornerstone blog post: menu engineering matrix for restaurant operators.
 * Target: "menu engineering matrix", "restaurant menu engineering", "menu matrix",
 * "stars plowhorses puzzles dogs", "menu profitability".
 */
export default function MenuEngineeringMatrixGuide() {
  const title = "Menu Engineering Matrix: Restaurant Profitability Guide";
  const description =
    "Master the menu engineering matrix: classify dishes as Stars, Plowhorses, Puzzles, and Dogs to increase contribution margin and reduce food cost.";
  const path = "/blog/menu-engineering-matrix-guide";
  const url = `https://matbex.com${path}`;
  const datePublished = "2026-08-14";

  const faq = [
    {
      q: "What is the menu engineering matrix?",
      a: "It is a four-box grid that plots every menu item by popularity (units sold) against contribution margin (menu price minus food cost). The four resulting groups are Stars, Plowhorses, Puzzles, and Dogs, and each one calls for a different action.",
    },
    {
      q: "What are Stars, Plowhorses, Puzzles, and Dogs?",
      a: "Stars are high popularity and high margin — protect them and keep quality consistent. Plowhorses are high popularity but low margin — re-engineer the recipe or nudge the price. Puzzles are high margin but low popularity — reposition, rename, or promote them. Dogs are low on both — fix, reprice, or remove them.",
    },
    {
      q: "Should I use contribution margin or food cost percentage?",
      a: "Use contribution margin in currency for the matrix. Food cost percentage can make a high-priced dish look bad even when it earns far more riyals per plate, which is the money that actually pays your rent and payroll.",
    },
    {
      q: "How often should a restaurant run menu engineering?",
      a: "Review monthly at minimum, and weekly for high-volume outlets or when ingredient prices are moving. A menu analysed once a year is usually already wrong by the time you reprint it.",
    },
    {
      q: "How much sales data do I need before the matrix is reliable?",
      a: "At least four weeks of sales covering normal trading, or one full fiscal month. Shorter windows get distorted by promotions, holidays, and one-off events.",
    },
    {
      q: "How do I calculate contribution margin for a dish?",
      a: "Subtract the recipe cost of the dish from its selling price excluding VAT. Include every component you plate — proteins, sides, sauces, garnish, and packaging for delivery orders.",
    },
    {
      q: "Should I delete every Dog on the menu?",
      a: "Not automatically. Check whether the item anchors a combo, serves a dietary need, or supports a key guest segment first. Remove it only when it fails on profit, popularity, and strategic value together.",
    },
    {
      q: "Does the matrix work for delivery and aggregator orders?",
      a: "Yes, but run delivery as its own matrix. Commission, packaging, and discounted channel pricing can turn a dine-in Star into a delivery Dog, so blending the channels hides the real result.",
    },
  ];

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
      "menu engineering matrix, restaurant menu engineering, menu matrix, stars plowhorses puzzles dogs, contribution margin, menu profitability, food cost percentage, restaurant menu design",
  };

  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };

  return (
    <>
      <RouteSeo title={title} description={description} path={path} ogType="article" />
      <Helmet>
        <link rel="alternate" hrefLang="en" href={url} />
        <meta name="article:published_time" content={`${datePublished}T00:00:00Z`} />
        <meta property="og:article:published_time" content={`${datePublished}T00:00:00Z`} />
        <meta property="og:article:modified_time" content={`${datePublished}T00:00:00Z`} />
        <meta property="og:article:author" content="Matbex" />
        <meta property="og:article:section" content="Restaurant Operations" />
        <meta property="og:article:tag" content="menu engineering matrix" />
        <meta property="og:article:tag" content="restaurant profitability" />
        <meta property="og:article:tag" content="food cost" />
        <meta property="og:article:tag" content="contribution margin" />
        <meta name="twitter:label1" content="Reading time" />
        <meta name="twitter:data1" content="10 minutes" />
        <meta name="twitter:label2" content="Topic" />
        <meta name="twitter:data2" content="Menu Engineering Matrix" />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
        <script type="application/ld+json">{JSON.stringify(faqLd)}</script>
      </Helmet>


      <ArticleLayout eyebrow="Operations · Profitability" title={title} meta="Published August 14, 2026 · 10 min read">

        <article className="prose prose-lg max-w-none text-gray-700 leading-relaxed space-y-6">
          <p className="text-xl text-gray-700">
            Menu engineering is not decoration. It is margin design. The menu engineering matrix
            tells you which dishes are building your profit, which are carrying your traffic, and
            which are quietly bleeding your kitchen. Every restaurant owner can run this exercise in
            a spreadsheet — but the operators who win run it every week, tied to real{" "}
            <Link to="/blog/restaurant-cogs-guide-ksa" className="text-primary underline">
              recipe costs and COGS discipline
            </Link>{" "}
            and live sales data.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">What is the menu engineering matrix?</h2>
          <p>
            The matrix plots every menu item on two axes: <strong>popularity</strong> (how often it
            sells) and <strong>contribution margin</strong> (what it earns after direct food cost).
            The result is four buckets that every restaurant operator should know by name:
          </p>

          <div className="overflow-x-auto not-prose my-8">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="py-3 pr-4 font-semibold text-gray-900">Category</th>
                  <th className="py-3 pr-4 font-semibold text-gray-900">Popularity</th>
                  <th className="py-3 pr-4 font-semibold text-gray-900">Contribution Margin</th>
                  <th className="py-3 font-semibold text-gray-900">Operator move</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-gray-100">
                  <td className="py-3 pr-4 font-semibold text-primary">Stars</td>
                  <td className="py-3 pr-4">High</td>
                  <td className="py-3 pr-4">High</td>
                  <td className="py-3">Promote, protect, and price with confidence.</td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-3 pr-4 font-semibold text-primary">Plowhorses</td>
                  <td className="py-3 pr-4">High</td>
                  <td className="py-3 pr-4">Low</td>
                  <td className="py-3">Raise price, reduce portion cost, or bundle.</td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-3 pr-4 font-semibold text-primary">Puzzles</td>
                  <td className="py-3 pr-4">Low</td>
                  <td className="py-3 pr-4">High</td>
                  <td className="py-3">Reposition, rename, or feature more visibly.</td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 font-semibold text-primary">Dogs</td>
                  <td className="py-3 pr-4">Low</td>
                  <td className="py-3 pr-4">Low</td>
                  <td className="py-3">Remove, de-feature, or fix the cost structure.</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">The numbers that matter</h2>
          <p>
            Do not rank dishes by{" "}
            <Link to="/blog/restaurant-cogs-guide-ksa" className="text-primary underline">
              food cost percentage
            </Link>{" "}
            alone. A dish with 20% food cost that sells twice a month is less valuable than a dish
            with 35% food cost that sells two hundred times. Contribution margin is the better lens.
          </p>
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 not-prose my-6">
            <p className="text-lg font-mono text-gray-900">
              Contribution Margin = Selling Price − Recipe Cost
            </p>
          </div>
          <p>
            To place items on the matrix, compare each one to the menu average. A simple method:
          </p>
          <ol className="list-decimal ps-6 space-y-2">
            <li>
              <strong>Popularity index:</strong> item quantity sold ÷ average quantity sold across
              all items. Above 1.0 = high popularity.
            </li>
            <li>
              <strong>Margin index:</strong> item contribution margin ÷ average contribution
              margin across all items. Above 1.0 = high margin.
            </li>
            <li>
              Plot each item. The intersection of the two indexes gives you its quadrant.
            </li>
          </ol>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">What to do in each quadrant</h2>

          <h3 className="text-xl font-semibold text-gray-900 pt-6">Stars: your profit engine</h3>
          <p>
            Stars sell well and earn well. Your job is to protect them. Keep recipe costs stable,
            train staff on consistent portioning, and avoid discounting them into Plowhorses. These
            items should be prominent on the menu, in your online ordering photos, and in staff
            upsell prompts.
          </p>

          <h3 className="text-xl font-semibold text-gray-900 pt-6">Plowhorses: traffic drivers that need a tune-up</h3>
          <p>
            Plowhorses are popular but thin on margin. Guests love them, so do not delete them
            blindly. Instead:
          </p>
          <ul className="list-disc ps-6 space-y-2">
            <li>Test a small price increase and watch volume elasticity.</li>
            <li>Negotiate better pricing on the dominant ingredient.</li>
            <li>Reduce waste by standardizing prep and portion.</li>
            <li>Bundle them with a high-margin Puzzle to lift the check average.</li>
          </ul>

          <h3 className="text-xl font-semibold text-gray-900 pt-6">Puzzles: hidden margin waiting for attention</h3>
          <p>
            Puzzles are profitable but under-ordered. The problem is usually visibility, naming, or
            placement. Move them to a prime menu position, rewrite the description to highlight
            premium ingredients, or have servers recommend them as a pairing. If they still do not
            move after a fair test, re-cost them or retire them.
          </p>

          <h3 className="text-xl font-semibold text-gray-900 pt-6">Dogs: the menu clutter</h3>
          <p>
            Dogs sell poorly and earn poorly. They consume prep time, inventory, and mental
            bandwidth. Remove them unless they serve a strategic purpose — a signature item that
            builds brand, a dietary option that closes group orders, or a loss-leader that drives
            beverage sales. If it is none of those, cut it.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">A real example: Saudi casual dining</h2>
          <p>
            Imagine a casual dining concept with these monthly numbers:
          </p>
          <ul className="list-disc ps-6 space-y-2">
            <li><strong>Chicken shawarma platter:</strong> 55 SAR price, 18 SAR recipe cost, 450 sold.</li>
            <li><strong>Lamb mandi:</strong> 85 SAR price, 38 SAR recipe cost, 120 sold.</li>
            <li><strong>Grilled shrimp skewers:</strong> 72 SAR price, 28 SAR recipe cost, 35 sold.</li>
            <li><strong>Stuffed vine leaves:</strong> 28 SAR price, 14 SAR recipe cost, 40 sold.</li>
          </ul>
          <p>
            The shawarma platter is a Star: high volume, strong margin. The lamb mandi is a Puzzle:
            great margin, but not ordered often enough. The shrimp skewers might be a Puzzle or a
            Star depending on the menu average. The vine leaves are a Dog unless they anchor a
            vegetarian section. This is the kind of clarity that turns menu debates into data
            decisions.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">Common menu engineering mistakes</h2>
          <ul className="list-disc ps-6 space-y-2">
            <li>
              <strong>Looking only at food cost percentage.</strong> A low food-cost item can still
              be a Dog if nobody orders it.
            </li>
            <li>
              <strong>Ignoring modifiers and combos.</strong> A Star burger becomes a Plowhorse if
              guests always add a discounted side.
            </li>
            <li>
              <strong>Running the matrix once a year.</strong> Supplier prices, seasonality, and
              guest habits change constantly.
            </li>
            <li>
              <strong>Deleting Puzzles too fast.</strong> They may only need better placement or a
              sharper description.
            </li>
          </ul>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">How Matbex turns the matrix into a live dashboard</h2>
          <p>
            The matrix is only useful if the numbers are current. Matbex connects your{" "}
            <Link to="/blog/zatca-phase-2-restaurant-guide" className="text-primary underline">
              ZATCA-compliant POS sales
            </Link>{" "}
            to your recipe costs, so every item shows its real contribution margin as the day
            progresses. When lamb prices jump, you see the margin move. When a dish starts selling
            above its usual velocity, you can promote it before the kitchen runs out.
          </p>
          <ul className="list-disc ps-6 space-y-2">
            <li>Recipe-level COGS updated from every sale and every purchase invoice.</li>
            <li>Branch-level pricing so each location can run its own matrix.</li>
            <li>Daily P&L that separates food cost, labor, and overhead by branch.</li>
            <li>Alerts when a Star drifts toward Plowhorse territory.</li>
          </ul>

          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-8 my-12 not-prose">
            <h3 className="text-xl font-semibold text-gray-900 mb-3">
              Build a menu that earns, not just sells
            </h3>
            <p className="text-gray-600 mb-6">
              Matbex tracks recipe costs, sales mix, and contribution margin in real time so you can
              run the menu engineering matrix every week instead of once a year.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild className="bg-primary hover:bg-primary/90 text-white">
                <Link to="/register">Start free trial</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/tools/menu-price-calculator">Menu price calculator</Link>
              </Button>
            </div>
          </div>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">
            Menu engineering FAQ
          </h2>
          <div className="not-prose divide-y divide-gray-200 border-y border-gray-200 my-8">
            {faq.map((item) => (
              <div key={item.q} className="py-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{item.q}</h3>
                <p className="text-gray-600 leading-relaxed">{item.a}</p>
              </div>
            ))}
          </div>

          <h2 className="text-2xl font-semibold text-gray-900 pt-8">Further reading</h2>
          <ul className="list-disc ps-6 space-y-2">
            <li>
              <Link to="/blog/restaurant-cogs-guide-ksa" className="text-primary underline">
                Restaurant COGS in Saudi Arabia: an operator&apos;s playbook
              </Link>
            </li>
            <li>
              <Link to="/blog/zatca-phase-2-restaurant-guide" className="text-primary underline">
                ZATCA Phase 2 for restaurants: the complete operator guide
              </Link>
            </li>
            <li>
              <Link to="/tools/food-cost-calculator" className="text-primary underline">
                Food cost calculator
              </Link>
            </li>
            <li>
              <Link to="/ar" className="text-primary underline">
                الصفحة الرئيسية بالعربية
              </Link>
            </li>
          </ul>
        </article>
      </ArticleLayout>
    </>
  );
}
