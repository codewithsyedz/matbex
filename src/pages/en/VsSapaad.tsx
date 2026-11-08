import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RouteSeo } from "@/components/seo/RouteSeo";
import { PageTransition } from "@/components/PageTransition";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";

/**
 * English comparison page: Matbex vs Sapaad — Saudi Arabia.
 * Long-form 1,500+ word guide with FAQ + Breadcrumb schema for SEO.
 */
export default function VsSapaad() {
  const title = "Matbex vs Sapaad — Best Restaurant Platform in Saudi Arabia (2026)";
  const description =
    "In-depth Matbex vs Sapaad comparison for Saudi restaurants: ZATCA Phase 2, full double-entry accounting, real-time COGS, Arabic UX, pricing in SAR, migration playbook, and FAQs.";
  const path = "/sa/vs/sapaad";
  const url = `https://matbex.com${path}`;

  const rows: Array<{ feature: string; matbex: string | true; rival: string | true | false; note?: string }> = [
    { feature: "Built specifically for the Saudi market", matbex: true, rival: "Global platform", note: "Sapaad serves 15k+ restaurants across 6 markets; Matbex is KSA-focused." },
    { feature: "ZATCA Phase 2 e-invoicing — native, no third-party clearance vendor", matbex: true, rival: "Add-on" },
    { feature: "Full double-entry accounting (P&L, Balance Sheet, GL, Trial Balance)", matbex: true, rival: false, note: "Sapaad exports to Xero / QuickBooks — not a full accounting ledger." },
    { feature: "Real-time theoretical COGS tied to every sale", matbex: true, rival: "Reports only" },
    { feature: "Weekly stocktake wizard for high-cost items", matbex: true, rival: false },
    { feature: "Native Arabic UI with true RTL", matbex: true, rival: "Translated" },
    { feature: "Staff, shifts, advances and payroll inside one platform", matbex: true, rival: "Basic" },
    { feature: "Built-in website + live menu builder", matbex: true, rival: false },
    { feature: "Customer-facing display (CFD)", matbex: true, rival: true },
    { feature: "14-day free trial — no card required", matbex: true, rival: false, note: "Sapaad starts with a limited trial then a mandatory monthly subscription." },
    { feature: "Transparent SAR pricing", matbex: true, rival: "USD pricing" },
    { feature: "Same-day onboarding & Arabic-speaking support", matbex: true, rival: "Ticket-based" },
  ];

  const faqs = [
    {
      q: "Is Matbex a true alternative to Sapaad in Saudi Arabia?",
      a: "Yes. Matbex covers everything a single-country Saudi operator needs from Sapaad — POS, kitchen display, inventory, payments, delivery aggregator sync — and adds ZATCA Phase 2 clearance, full double-entry accounting, payroll and a website builder inside one subscription. Most Sapaad customers in KSA still pay separately for accounting software and a ZATCA vendor; with Matbex those are included.",
    },
    {
      q: "Does Matbex support ZATCA Phase 2 e-invoicing without an extra vendor?",
      a: "Yes. Matbex generates the UBL 2.1 XML, signs each invoice with a ZATCA-issued cryptographic certificate, embeds the QR code and clears the document with Fatoora in real time. No third-party middleware, no per-invoice clearance fee. See our ZATCA Phase 2 guide for the full technical breakdown.",
    },
    {
      q: "Can I migrate from Sapaad to Matbex without losing menu or sales history?",
      a: "Yes. Our migration team imports your menu, modifiers, recipes, suppliers, inventory levels and 24 months of sales history from Sapaad exports. Most single-branch operators complete migration in 48 hours; multi-branch chains run in parallel for a weekend cut-over.",
    },
    {
      q: "How does pricing compare to Sapaad?",
      a: "Sapaad starts around USD 79 per branch / month and prices accounting, payroll and ZATCA separately. Matbex starts at 149 SAR, with the Growth plan at 349 SAR per branch / month including ZATCA Phase 2, accounting and payroll. For a single branch the all-in cost is typically 60–75% lower.",
    },
    {
      q: "Does Matbex work with my existing hardware?",
      a: "Matbex runs on any Android tablet, iPad, Windows PC or thermal-printer terminal. We support ESC/POS printers, USB and Bluetooth cash drawers, customer displays and QZ Tray network printing — the same hardware Sapaad uses.",
    },
  ];

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: title,
      description,
      inLanguage: "en",
      datePublished: "2026-05-30",
      dateModified: "2026-06-02",
      author: { "@type": "Organization", name: "Matbex" },
      publisher: { "@type": "Organization", name: "Matbex", logo: { "@type": "ImageObject", url: "https://matbex.com/og-image.png" } },
      mainEntityOfPage: { "@type": "WebPage", "@id": url },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://matbex.com/" },
        { "@type": "ListItem", position: 2, name: "Compare", item: "https://matbex.com/sa/vs/sapaad" },
        { "@type": "ListItem", position: 3, name: "Matbex vs Sapaad", item: url },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqs.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ];

  return (
    <PageTransition className="min-h-screen bg-white">
      <RouteSeo title={title} description={description} path={path} ogType="article" />
      <Helmet>
        <link rel="alternate" hrefLang="en" href={url} />
        <link rel="alternate" hrefLang="ar" href="https://matbex.com/ar/vs/sapaad" />
        <link rel="alternate" hrefLang="x-default" href={url} />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>

      <LandingHeader />

      <main className="max-w-4xl mx-auto px-6 py-20">
        <nav aria-label="Breadcrumb" className="text-xs text-gray-500 mb-6">
          <Link to="/" className="hover:text-[#00713A]">Home</Link>
          <span className="mx-2">/</span>
          <span>Compare</span>
          <span className="mx-2">/</span>
          <span className="text-gray-700">Matbex vs Sapaad</span>
        </nav>

        <p className="text-xs font-semibold tracking-widest text-[#00713A] uppercase mb-4">Comparison · Restaurant Platforms</p>
        <h1 className="text-4xl md:text-5xl font-light tracking-tight text-gray-900 leading-tight mb-6">
          Matbex vs Sapaad
        </h1>
        <p className="text-lg text-gray-600 mb-12 leading-relaxed">
          Sapaad is a Dubai-headquartered global restaurant cloud platform serving more than
          15,000 restaurants across the Middle East, India and Southeast Asia. Matbex is
          purpose-built for <strong>Saudi Arabia</strong> — ZATCA Phase 2 native, full
          double-entry accounting inside the platform, an Arabic-first UX, and prices quoted in
          Saudi Riyals. This guide walks through every meaningful difference so you can pick the
          right platform for your operation in 2026.
        </p>

        <section className="border border-gray-200 rounded-2xl overflow-hidden mb-12">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left p-4 font-semibold text-gray-900">Feature</th>
                <th className="text-center p-4 font-semibold text-[#00713A]">Matbex</th>
                <th className="text-center p-4 font-semibold text-gray-600">Sapaad</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-gray-100 last:border-0">
                  <td className="p-4 text-gray-800">{r.feature}{r.note && <span className="block text-xs text-gray-500 mt-1">{r.note}</span>}</td>
                  <td className="p-4 text-center">{r.matbex === true ? <Check className="inline w-5 h-5 text-[#00713A]" /> : <span className="text-gray-700">{r.matbex}</span>}</td>
                  <td className="p-4 text-center">{r.rival === true ? <Check className="inline w-5 h-5 text-gray-400" /> : r.rival === false ? <X className="inline w-5 h-5 text-gray-300" /> : <span className="text-gray-600">{r.rival}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <article className="prose prose-lg max-w-none text-gray-700 leading-relaxed space-y-6">
          <h2 className="text-2xl font-semibold text-gray-900">The verdict in one paragraph</h2>
          <p>
            If you operate restaurants across multiple countries and already pay for Xero or
            QuickBooks, Sapaad is a mature, well-supported choice. If you operate only inside
            Saudi Arabia and want a single subscription that covers POS, ZATCA Phase 2, full
            accounting, inventory, payroll and a website, Matbex is purpose-built for that job
            and typically costs 60–75% less per branch once you add up Sapaad plus its
            mandatory third-party modules.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">1. ZATCA Phase 2 compliance</h2>
          <p>
            Phase 2 of the Saudi e-invoicing mandate is not optional. Every B2B and most B2C
            invoices must be issued in UBL 2.1 XML, signed with a ZATCA-issued cryptographic
            stamp, embedded with a Base64 QR, and either cleared (B2B) or reported (B2C) via
            the Fatoora portal in real time. Sapaad handles this through a third-party
            integration that is billed separately per branch. Matbex handles the entire
            lifecycle natively — onboarding the CSID, signing each invoice, archiving the
            cleared XML and tracking failures from a single dashboard. There is no extra
            invoice, no extra vendor and no extra contract. Read the deeper{" "}
            <Link to="/sa/zatca-e-invoicing" className="text-[#00713A] underline">
              ZATCA Phase 2 e-invoicing guide
            </Link>{" "}
            for the technical details.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">2. Accounting depth</h2>
          <p>
            Sapaad gives you sales reports and exports them to Xero or QuickBooks. That is fine
            if you already pay an external accountant who reconciles the books monthly. Matbex
            ships with a full double-entry ledger: a customisable Chart of Accounts aligned
            with Saudi standards, journal entries on every sale and purchase, automatic COGS
            posting when inventory is consumed, accrual-based payroll, supplier payables,
            customer receivables, an immutable audit log, monthly closing locks, and printable
            Profit &amp; Loss, Balance Sheet and Trial Balance reports. Your accountant logs in
            to the same system your cashier uses — no exports, no spreadsheets, no late
            reconciliations.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">3. Real-time cost of goods sold</h2>
          <p>
            Sapaad reports COGS after you complete a monthly stocktake. Matbex calculates
            theoretical COGS on every single sale by walking the recipe tree: if a Chicken
            Shawarma uses 180 g of chicken at 24 SAR/kg, the sale instantly debits the
            inventory by 180 g and posts 4.32 SAR to account 5100 — COGS. You see your
            real-time food cost ratio on the dashboard alongside revenue, not three weeks after
            month-end. For a deeper dive, see the{" "}
            <Link to="/blog/restaurant-cogs-guide-ksa" className="text-[#00713A] underline">
              restaurant COGS guide for KSA
            </Link>.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">4. Arabic and RTL experience</h2>
          <p>
            Sapaad has translated its English UI to Arabic. Matbex was designed Arabic-first:
            the layout, typography, number formatting, currency symbol, date formatting and
            even the printer codepages were chosen for an Arabic operator. Switching languages
            mid-shift is a single tap and every printed receipt, kitchen ticket, customer
            display and exported PDF respects the active locale.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">5. Pricing — the real number</h2>
          <p>
            Sapaad’s public list price starts around USD 79 per branch per month for the POS,
            then adds USD 19–39 for inventory, USD 29 for the loyalty module, USD 15–25 for the
            ZATCA integration and the cost of Xero or QuickBooks on top. A single Saudi branch
            running the full stack ends up around 700–900 SAR/month. Matbex’s Growth Bundle
            includes POS, inventory, accounting, payroll, ZATCA Phase 2 and the website builder
            for <strong>349 SAR per branch per month</strong>, with a 14-day free trial for new
            restaurants. Compare plans on the{" "}
            <Link to="/pricing" className="text-[#00713A] underline">pricing page</Link>.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">6. Migration playbook</h2>
          <p>
            Most Sapaad customers we onboard are surprised by how clean the migration is. From
            Sapaad you can export your menu (CSV), modifiers, recipes, suppliers and sales
            history. Matbex imports the menu and recipes directly, maps modifiers, and replays
            up to 24 months of sales so your reports remain continuous. A typical single-branch
            cut-over runs Saturday night to Sunday morning; multi-branch chains usually run a
            pilot branch for 1–2 weeks before rolling out.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">When Sapaad is the right pick</h2>
          <p>
            You operate restaurants across <strong>multiple countries</strong> (UAE, India,
            Singapore, KSA) and want one unified platform across markets. You are comfortable
            with English-first tools and already use Xero or QuickBooks for accounting. You
            have a dedicated IT team that can manage a third-party ZATCA vendor.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900">When Matbex is the smarter pick</h2>
          <ul className="list-disc ps-6 space-y-2">
            <li>You operate <strong>only inside Saudi Arabia</strong> and want a platform that understands ZATCA, GOSI and Saudi labour specifics.</li>
            <li>You want <strong>ZATCA Phase 2</strong> clearance native — no third-party vendor, no additional invoice.</li>
            <li>You want <strong>full double-entry accounting</strong> inside one platform — not exports to Xero.</li>
            <li>You want the <strong>daily profit number</strong> on the same dashboard as the day’s sales.</li>
            <li>You want a <strong>free trial</strong> to start — no card, no commitment.</li>
            <li>You want a single Arabic-speaking support team — not a global ticket queue.</li>
          </ul>

          <h2 className="text-2xl font-semibold text-gray-900">Frequently asked questions</h2>
          <div className="space-y-6 not-prose">
            {faqs.map((f, i) => (
              <div key={i} className="border border-gray-200 rounded-xl p-6">
                <h3 className="text-base font-semibold text-gray-900 mb-2">{f.q}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{f.a}</p>
              </div>
            ))}
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-8 my-12 not-prose">
            <h3 className="text-xl font-semibold text-gray-900 mb-3">Try Matbex free</h3>
            <p className="text-gray-600 mb-6">Start with the free trial — no card, no commitment.</p>
            <div className="flex flex-wrap gap-3">
              <Button asChild className="bg-[#007a3d] hover:bg-[#006b33] text-white"><Link to="/register">Start free trial</Link></Button>
              <Button asChild variant="outline"><Link to="/sa/restaurant-pos">Restaurant POS overview</Link></Button>
              <Button asChild variant="ghost"><Link to="/pricing">See pricing</Link></Button>
            </div>
          </div>

          <h2 className="text-2xl font-semibold text-gray-900">Related comparisons &amp; guides</h2>
          <ul className="list-disc ps-6 space-y-2">
            <li><Link to="/sa/foodics-alternative" className="text-[#00713A] underline">Matbex vs Foodics</Link></li>
            <li><Link to="/sa/zatca-e-invoicing" className="text-[#00713A] underline">ZATCA Phase 2 e-invoicing guide</Link></li>
            <li><Link to="/sa/restaurant-pos" className="text-[#00713A] underline">Restaurant POS for Saudi Arabia</Link></li>
            <li><Link to="/sa/kitchen-display-system" className="text-[#00713A] underline">Kitchen Display System (KDS)</Link></li>
            <li><Link to="/blog/restaurant-cogs-guide-ksa" className="text-[#00713A] underline">Restaurant COGS guide for KSA</Link></li>
            <li><Link to="/ar/vs/sapaad" className="text-[#00713A] underline">هذه الصفحة بالعربية</Link></li>
          </ul>
        </article>
      </main>

      <LandingFooter />
    </PageTransition>
  );
}
