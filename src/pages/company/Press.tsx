import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { Download, Mail, ExternalLink, FileText, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RouteSeo } from "@/components/seo/RouteSeo";
import { PageTransition } from "@/components/PageTransition";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { MarketingPageHero } from "@/components/marketing/MarketingPageHero";
import { MarketingCtaBand } from "@/components/marketing/MarketingCtaBand";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";

const PRESS_EMAIL = "press@matbex.com";
const BOILERPLATE = `Matbex is the unified restaurant operating system for Saudi Arabia. It combines POS, ZATCA Phase 2 e-invoicing, inventory and COGS, payroll, and daily profit reporting in a single platform — replacing the four or five disconnected tools most KSA restaurants stitch together. Founded in 2025, Matbex serves independent operators and multi-branch groups across the Kingdom in Arabic and English.`;

const DATA_POINTS = [
  { label: "Founded", value: "2025" },
  { label: "Headquarters", value: "Riyadh, Saudi Arabia" },
  { label: "Markets served", value: "Saudi Arabia (KSA)" },
  { label: "Languages", value: "Arabic, English (full RTL)" },
  { label: "ZATCA Phase 2", value: "Certified e-invoicing" },
  { label: "Compliance", value: "VAT 15%, Saudization-ready payroll" },
];

const ASSETS = [
  { title: "Logo pack (SVG)", href: "/press-assets/logo-pack.svg", icon: ImageIcon, note: "Vector logo on transparent background" },
  { title: "Brand guidelines (PDF)", href: "/press-assets/brand-guidelines.pdf", icon: FileText, note: "Colors, typography, clear-space rules" },
  { title: "Product screenshots", href: "/press-assets/product-screenshots.txt", icon: ImageIcon, note: "Dashboard, POS, ZATCA, reports" },
  { title: "Executive headshots", href: "/press-assets/executive-headshots.txt", icon: ImageIcon, note: "Founder and leadership team" },
];

const Press = () => {
  const title = "Press & Media Kit | Matbex";
  const description = "Press resources, brand assets, founder bio, and boilerplate for journalists covering Matbex and Saudi Arabia's restaurant technology sector.";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Matbex",
    url: "https://matbex.com",
    logo: "https://matbex.com/press-assets/logo-pack.svg",
    foundingDate: "2025",
    foundingLocation: { "@type": "Place", name: "Riyadh, Saudi Arabia" },
    description: BOILERPLATE,
    contactPoint: [{ "@type": "ContactPoint", contactType: "press", email: PRESS_EMAIL, areaServed: "SA", availableLanguage: ["English", "Arabic"] }],
    sameAs: ["https://www.linkedin.com/company/matbex"],
  };

  return (
    <PageTransition>
      <RouteSeo title={title} description={description} path="/press" />
      <Helmet>
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>
      <MarketingShell>
        <LandingHeader />
        <MarketingPageHero
          eyebrow="Press"
          title="Press & media kit"
          summary="Everything journalists, analysts, and partners need to cover Matbex — brand assets, company facts, founder bio, and direct contact."
          crumbs={[{ label: "Home", to: "/" }, { label: "Press" }]}
          actions={
            <>
              <Button asChild>
                <a href={`mailto:${PRESS_EMAIL}`}><Mail className="w-4 h-4 mr-2" />Contact press team</a>
              </Button>
              <Button variant="outline" asChild>
                <a href="/press-assets/logo-pack.svg" download><Download className="w-4 h-4 mr-2" />Download logo</a>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/stats"><ExternalLink className="w-4 h-4 mr-2" />Live platform stats</Link>
              </Button>
            </>
          }
        />
        <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-14 sm:py-16">

          <section className="mb-12">
            <h2 className="text-2xl font-light mb-4">Company boilerplate</h2>
            <Card className="p-6 bg-muted/30">
              <p className="text-sm leading-relaxed text-foreground/90">{BOILERPLATE}</p>
              <p className="text-xs text-muted-foreground mt-3">Copy verbatim or paraphrase. Approved for use in articles, press releases, and panel bios.</p>
            </Card>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-light mb-4">Quick facts</h2>
            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
              {DATA_POINTS.map((d) => (
                <Card key={d.label} className="p-4">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">{d.label}</div>
                  <div className="text-base font-medium mt-1">{d.value}</div>
                </Card>
              ))}
            </div>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-light mb-4">Brand assets</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {ASSETS.map((a) => (
                <Card key={a.title} className="p-4 flex items-start gap-3">
                  <a.icon className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <a href={a.href} className="font-medium hover:text-primary" target="_blank" rel="noreferrer">{a.title}</a>
                    <div className="text-xs text-muted-foreground mt-0.5">{a.note}</div>
                  </div>
                  <Download className="w-4 h-4 text-muted-foreground" />
                </Card>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3">Usage: please credit "Courtesy of Matbex". Do not alter the logo lockup or apply filters to headshots. For high-resolution custom photography, email <a className="underline" href={`mailto:${PRESS_EMAIL}`}>{PRESS_EMAIL}</a>.</p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-light mb-4">Founder bio</h2>
            <Card className="p-6">
              <h3 className="text-lg font-medium">Matbex Founding Team</h3>
              <p className="text-sm text-muted-foreground mb-3">Founder & CEO</p>
              <p className="text-sm leading-relaxed text-foreground/90">
                The Matbex founding team brings together restaurant operators and software engineers who lived the pain of running KSA F&B businesses on disconnected tools. After years of stitching together POS, accounting spreadsheets, and WhatsApp groups for inventory, they built Matbex to give every Saudi restaurant — from a single shawarma counter to a 20-branch group — the same operational visibility that global chains take for granted. The platform is built in Saudi Arabia, for Saudi Arabia, with Arabic as a first-class language and full ZATCA Phase 2 compliance from day one.
              </p>
              <div className="mt-4 text-xs text-muted-foreground">
                Available for interviews on: restaurant technology, ZATCA e-invoicing, Vision 2030 SME enablement, food cost management, and the KSA hospitality sector.
              </div>
            </Card>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-light mb-4">Story angles & data</h2>
            <ul className="space-y-2 text-sm">
              <li className="flex gap-2"><span className="text-primary">→</span><span><strong>Vision 2030 & SME tech adoption</strong> — how independent Saudi restaurants are leapfrogging legacy POS systems.</span></li>
              <li className="flex gap-2"><span className="text-primary">→</span><span><strong>ZATCA Phase 2 compliance</strong> — the operational reality for restaurants vs the policy timeline. <Link to="/blog/zatca-phase-2-guide" className="text-primary hover:underline">Read our guide</Link>.</span></li>
              <li className="flex gap-2"><span className="text-primary">→</span><span><strong>The 32% food-cost benchmark</strong> — why most KSA restaurants miss it, and what the data shows. <Link to="/tools/food-cost-calculator" className="text-primary hover:underline">Free calculator</Link>.</span></li>
              <li className="flex gap-2"><span className="text-primary">→</span><span><strong>Saudization-ready payroll</strong> — how restaurant tech is supporting nationalization targets.</span></li>
              <li className="flex gap-2"><span className="text-primary">→</span><span><strong>Live platform metrics</strong> updated in real time — <Link to="/stats" className="text-primary hover:underline">/stats</Link>.</span></li>
            </ul>
          </section>

          <section className="mb-4">
            <h2 className="text-2xl font-light mb-4">Press contact</h2>
            <Card className="p-6">
              <p className="text-sm">For interviews, embargoed previews, founder quotes, or custom data pulls:</p>
              <a href={`mailto:${PRESS_EMAIL}`} className="text-lg text-primary hover:underline mt-2 inline-block">{PRESS_EMAIL}</a>
              <p className="text-xs text-muted-foreground mt-2">We typically respond within one business day (Sun–Thu, AST).</p>
            </Card>
          </section>
        </main>
        <MarketingCtaBand />
        <LandingFooter />
      </MarketingShell>
    </PageTransition>
  );
};

export default Press;
