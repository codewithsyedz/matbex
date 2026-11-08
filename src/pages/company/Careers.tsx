import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { ArrowRight, Mail, MapPin, Clock } from "lucide-react";
import { RouteSeo } from "@/components/seo/RouteSeo";
import { PageTransition } from "@/components/PageTransition";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { MarketingPageHero, MarketingReveal } from "@/components/marketing/MarketingPageHero";
import { MarketingCtaBand } from "@/components/marketing/MarketingCtaBand";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";

const CAREERS_EMAIL = "careers@matbex.com";

const ROLES = [
  {
    title: "Senior Product Engineer (Full-stack)",
    team: "Engineering",
    location: "Riyadh or remote (GMT+3 overlap)",
    type: "Full-time",
    body: "Own features end to end across the POS, accounting engine and reporting surfaces. Strong TypeScript and relational data modelling required; accounting experience is a plus, not a prerequisite.",
  },
  {
    title: "Product Designer",
    team: "Design",
    location: "Riyadh or remote (GMT+3 overlap)",
    type: "Full-time",
    body: "Design dense operational screens that a cashier can use at 2am and an owner can read in ten seconds. Arabic and right-to-left design experience is highly valued.",
  },
  {
    title: "Implementation & Success Manager",
    team: "Customer",
    location: "Riyadh, Saudi Arabia",
    type: "Full-time",
    body: "Take new restaurants from signature to first clean month-end: menu load, opening balances, staff training and the first profit report they trust.",
  },
  {
    title: "Accountant / Financial Systems Analyst",
    team: "Finance",
    location: "Riyadh, Saudi Arabia",
    type: "Full-time",
    body: "Translate Saudi accounting practice, VAT and ZATCA requirements into product rules, and review the ledger behaviour that thousands of venues rely on.",
  },
];

const HOW_WE_WORK = [
  { title: "Small teams, whole problems", body: "You own an area of the product, not a queue of tickets — from talking to operators through to what ships." },
  { title: "Close to the counter", body: "Everyone spends time in real kitchens and behind real tills. Product decisions come from service, not from a whiteboard." },
  { title: "Arabic and English, equally", body: "Both languages are first-class here — in the product and in the way the team works." },
  { title: "Written and deliberate", body: "Decisions are written down before they are built, so quality survives growth." },
];

const BENEFITS = [
  "Competitive salary and meaningful equity",
  "Private medical cover for you and your family",
  "Annual learning and conference budget",
  "Hardware of your choice",
  "Flexible hours around a GMT+3 core",
  "Paid time to work on internal tooling",
];

const Careers = () => {
  const title = "Careers at Matbex | Build the Restaurant Operating System";
  const description =
    "Open roles in engineering, design, customer success and finance at Matbex — the Riyadh-built restaurant operating system for POS, accounting, inventory and payroll.";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Open roles at Matbex",
    itemListElement: ROLES.map((r, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: r.title,
      description: r.body,
    })),
  };

  return (
    <PageTransition>
      <RouteSeo title={title} description={description} path="/careers" />
      <Helmet>
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>
      <MarketingShell>
        <LandingHeader />
        <MarketingPageHero
          eyebrow="Careers"
          title="Help thousands of restaurants run profitably"
          summary="We are a small Riyadh-based team building the operating system Saudi restaurants run their day on — the till, the stockroom, the payroll run and the ledger, in one place."
          crumbs={[{ label: "Home", to: "/" }, { label: "Careers" }]}
          actions={
            <>
              <a
                href={`mailto:${CAREERS_EMAIL}`}
                className="inline-flex items-center justify-center gap-2 min-h-11 h-11 px-6 rounded-lg bg-[#00A859] text-white text-sm font-medium hover:bg-[#00A859]/90 transition-colors"
              >
                <Mail className="w-4 h-4" />
                Send us your CV
              </a>
              <Link
                to="/about"
                className="inline-flex items-center justify-center min-h-11 h-11 px-6 rounded-lg border border-white/15 text-white/80 text-sm font-medium hover:bg-white/[0.06] hover:text-white transition-colors"
              >
                About Matbex
              </Link>
            </>
          }
          note={`Applications go straight to ${CAREERS_EMAIL} — we reply to every one.`}
        />

        <main className="flex-1 w-full">
          <section className="max-w-5xl mx-auto w-full px-6 py-14 sm:py-16">
            <MarketingReveal>
              <h2 className="text-2xl sm:text-3xl font-light tracking-tight text-white">Open roles</h2>
              <p className="mt-3 max-w-2xl text-base font-light leading-relaxed text-white/60">
                Nothing here that fits? Write to us anyway and tell us what you would build.
              </p>
            </MarketingReveal>
            <div className="mt-8 space-y-4">
              {ROLES.map((role) => (
                <MarketingReveal key={role.title}>
                  <article className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="max-w-2xl">
                        <p className="text-xs uppercase tracking-[0.18em] text-[#4FD08A]">{role.team}</p>
                        <h3 className="mt-2 text-lg font-light text-white">{role.title}</h3>
                        <p className="mt-2 text-sm font-light leading-relaxed text-white/60">{role.body}</p>
                        <p className="mt-4 flex flex-wrap items-center gap-4 text-xs text-white/45">
                          <span className="inline-flex items-center gap-1.5">
                            <MapPin className="h-3.5 w-3.5" aria-hidden />
                            {role.location}
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5" aria-hidden />
                            {role.type}
                          </span>
                        </p>
                      </div>
                      <a
                        href={`mailto:${CAREERS_EMAIL}?subject=${encodeURIComponent(`Application: ${role.title}`)}`}
                        className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-white/15 px-5 text-sm font-medium text-white/85 transition-colors hover:bg-white/[0.07] hover:text-white"
                      >
                        Apply
                        <ArrowRight className="h-4 w-4" />
                      </a>
                    </div>
                  </article>
                </MarketingReveal>
              ))}
            </div>
          </section>

          <section className="border-t border-white/10">
            <div className="max-w-5xl mx-auto w-full px-6 py-14 sm:py-16">
              <MarketingReveal>
                <h2 className="text-2xl sm:text-3xl font-light tracking-tight text-white">How we work</h2>
              </MarketingReveal>
              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                {HOW_WE_WORK.map((item) => (
                  <MarketingReveal key={item.title}>
                    <div className="h-full rounded-xl border border-white/10 bg-white/[0.03] p-6">
                      <h3 className="text-lg font-light text-white">{item.title}</h3>
                      <p className="mt-2 text-sm font-light leading-relaxed text-white/60">{item.body}</p>
                    </div>
                  </MarketingReveal>
                ))}
              </div>
            </div>
          </section>

          <section className="border-t border-white/10">
            <div className="max-w-5xl mx-auto w-full px-6 py-14 sm:py-16">
              <MarketingReveal>
                <h2 className="text-2xl sm:text-3xl font-light tracking-tight text-white">What we offer</h2>
              </MarketingReveal>
              <ul className="mt-8 grid gap-3 sm:grid-cols-2">
                {BENEFITS.map((b) => (
                  <li
                    key={b}
                    className="rounded-lg border border-white/10 bg-white/[0.03] px-5 py-4 text-sm font-light text-white/70"
                  >
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </main>

        <MarketingCtaBand
          title="Not ready to apply yet?"
          body="Tell us what you are working on and we will keep you in mind as the team grows."
          primaryLabel="Email the team"
          primaryTo="/#contact"
          secondaryLabel="Read about Matbex"
          secondaryTo="/about"
        />
        <LandingFooter />
      </MarketingShell>
    </PageTransition>
  );
};

export default Careers;
