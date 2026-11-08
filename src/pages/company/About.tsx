import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { ArrowRight, Building2, Globe, ShieldCheck, Sparkles } from "lucide-react";
import { RouteSeo } from "@/components/seo/RouteSeo";
import { PageTransition } from "@/components/PageTransition";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { MarketingPageHero, MarketingReveal } from "@/components/marketing/MarketingPageHero";
import { MarketingCtaBand } from "@/components/marketing/MarketingCtaBand";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { SOLUTIONS } from "@/data/solutions";

const PRINCIPLES = [
  {
    icon: ShieldCheck,
    title: "One ledger, no guesswork",
    body: "Every sale, purchase, salary and settlement lands in the same double-entry ledger. Nothing is deleted — corrections are recorded, so the numbers stand up to an auditor.",
  },
  {
    icon: Building2,
    title: "Built branch by branch",
    body: "A second location is a second P&L, not a spreadsheet tab. Costs, staff, menus and cash are scoped to the branch that earned them, then rolled up for the group.",
  },
  {
    icon: Globe,
    title: "Arabic first, not translated",
    body: "Full right-to-left interface, Riyal formatting, Hijri-aware reporting and ZATCA Phase 2 e-invoicing built into the product rather than bolted on.",
  },
  {
    icon: Sparkles,
    title: "Works when the internet doesn't",
    body: "The till keeps selling offline and syncs the moment the line returns. A dropped connection should never stop a queue at the counter.",
  },
];

const TIMELINE = [
  { year: "2025", title: "Matbex is founded in Riyadh", body: "Started after watching operators reconcile POS exports, supplier invoices and payroll by hand every single month." },
  { year: "2025", title: "Accounting engine goes live", body: "Automated double-entry posting for sales, purchases, expenses, payroll and VAT — the core the rest of the product is built on." },
  { year: "2026", title: "Offline-first POS and ZATCA Phase 2", body: "Locked kiosk terminals, cash drawer control and certified e-invoicing shipped for single sites and multi-branch groups." },
  { year: "Today", title: "One operating system per venue", body: "POS, inventory and COGS, payroll, customer debt and daily profit in one place — in Arabic and English." },
];

const FACTS = [
  { label: "Founded", value: "2025" },
  { label: "Headquarters", value: "Riyadh, Saudi Arabia" },
  { label: "Email", value: "hello@matbex.com" },
  { label: "Market", value: "Kingdom of Saudi Arabia" },
  { label: "Languages", value: "Arabic and English" },
];

const About = () => {
  const title = "About Matbex | The Restaurant Operating System for Saudi Arabia";
  const description =
    "Why Matbex exists, what we believe about restaurant numbers, and how the platform grew into one operating system for POS, accounting, inventory and payroll across the Kingdom.";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    name: title,
    description,
    url: "https://www.matbex.com/about",
    publisher: { "@type": "Organization", name: "Matbex", url: "https://www.matbex.com" },
  };

  return (
    <PageTransition>
      <RouteSeo title={title} description={description} path="/about" />
      <Helmet>
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>
      <MarketingShell>
        <LandingHeader />
        <MarketingPageHero
          eyebrow="About"
          title="We build the numbers restaurants can actually trust"
          summary="Matbex is a Riyadh-built operating system for restaurants: one place where the till, the stockroom, the payroll run and the ledger finally agree with each other."
          crumbs={[{ label: "Home", to: "/" }, { label: "About" }]}
          actions={
            <>
              <Link
                to="/#contact"
                className="inline-flex items-center justify-center gap-2 min-h-11 h-11 px-6 rounded-lg bg-[#00A859] text-white text-sm font-medium hover:bg-[#00A859]/90 transition-colors"
              >
                Talk to the team
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                to="/solutions"
                className="inline-flex items-center justify-center min-h-11 h-11 px-6 rounded-lg border border-white/15 text-white/80 text-sm font-medium hover:bg-white/[0.06] hover:text-white transition-colors"
              >
                Explore use cases
              </Link>
            </>
          }
        />

        <main className="flex-1 w-full">
          <section className="max-w-5xl mx-auto w-full px-6 py-14 sm:py-16">
            <MarketingReveal>
              <h2 className="text-2xl sm:text-3xl font-light tracking-tight text-white">Why we started</h2>
              <div className="mt-5 space-y-4 max-w-2xl text-base font-light leading-relaxed text-white/60">
                <p>
                  Most restaurants in the Kingdom close the month the same way: a POS export, a folder of supplier
                  invoices, a payroll sheet, and someone's evening spent making them match. By the time the profit
                  figure appears, the month it describes is already gone.
                </p>
                <p>
                  Matbex was built to remove that gap. Sales post themselves. Purchases move stock and payables at the
                  same time. Consumption records cost of goods on the day it happens. The result is a profit number an
                  owner can look at over morning coffee instead of three weeks later.
                </p>
              </div>
            </MarketingReveal>
          </section>

          <section className="border-t border-white/10">
            <div className="max-w-5xl mx-auto w-full px-6 py-14 sm:py-16">
              <MarketingReveal>
                <h2 className="text-2xl sm:text-3xl font-light tracking-tight text-white">What we believe</h2>
              </MarketingReveal>
              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                {PRINCIPLES.map((p) => {
                  const Icon = p.icon;
                  return (
                    <MarketingReveal key={p.title}>
                      <div className="h-full rounded-xl border border-white/10 bg-white/[0.03] p-6">
                        <Icon className="h-5 w-5 text-[#4FD08A]" aria-hidden />
                        <h3 className="mt-4 text-lg font-light text-white">{p.title}</h3>
                        <p className="mt-2 text-sm font-light leading-relaxed text-white/60">{p.body}</p>
                      </div>
                    </MarketingReveal>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="border-t border-white/10">
            <div className="max-w-5xl mx-auto w-full px-6 py-14 sm:py-16">
              <MarketingReveal>
                <h2 className="text-2xl sm:text-3xl font-light tracking-tight text-white">How we got here</h2>
              </MarketingReveal>
              <ol className="mt-8 space-y-6 border-l border-white/10 pl-6">
                {TIMELINE.map((t) => (
                  <li key={t.title} className="relative">
                    <span aria-hidden className="absolute -left-[27px] top-2 h-2 w-2 rounded-full bg-[#00A859]" />
                    <p className="text-xs uppercase tracking-[0.18em] text-white/40">{t.year}</p>
                    <h3 className="mt-1 text-lg font-light text-white">{t.title}</h3>
                    <p className="mt-1 max-w-2xl text-sm font-light leading-relaxed text-white/60">{t.body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section className="border-t border-white/10">
            <div className="max-w-5xl mx-auto w-full px-6 py-14 sm:py-16">
              <MarketingReveal>
                <h2 className="text-2xl sm:text-3xl font-light tracking-tight text-white">Company facts</h2>
              </MarketingReveal>
              <dl className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {FACTS.map((f) => (
                  <div key={f.label} className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
                    <dt className="text-xs uppercase tracking-[0.18em] text-white/40">{f.label}</dt>
                    <dd className="mt-2 text-base font-light text-white">{f.value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-6 text-sm font-light text-white/50">
                Writing about us?{" "}
                <Link to="/press" className="text-[#4FD08A] hover:underline">
                  Press &amp; media kit
                </Link>{" "}
                ·{" "}
                <Link to="/careers" className="text-[#4FD08A] hover:underline">
                  Open roles
                </Link>
              </p>
            </div>
          </section>

          <section className="border-t border-white/10">
            <div className="max-w-5xl mx-auto w-full px-6 py-14 sm:py-16">
              <MarketingReveal>
                <h2 className="text-2xl sm:text-3xl font-light tracking-tight text-white">Who we build for</h2>
                <p className="mt-3 max-w-2xl text-base font-light leading-relaxed text-white/60">
                  Every venue type runs differently. Each of these pages shows the exact setup we deploy.
                </p>
              </MarketingReveal>
              <div className="mt-8 flex flex-wrap gap-3">
                {SOLUTIONS.map((s) => (
                  <Link
                    key={s.slug}
                    to={`/solutions/${s.slug}`}
                    className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/12 bg-white/[0.03] px-4 text-sm font-light text-white/80 transition-colors hover:bg-white/[0.07] hover:text-white"
                  >
                    {s.name}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                ))}
              </div>
            </div>
          </section>
        </main>

        <MarketingCtaBand />
        <LandingFooter />
      </MarketingShell>
    </PageTransition>
  );
};

export default About;
