import { Navigate, useParams, Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { ArrowRight, Check, Minus, Quote } from "lucide-react";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { MarketingPageHero, MarketingReveal } from "@/components/marketing/MarketingPageHero";
import { MarketingCtaBand } from "@/components/marketing/MarketingCtaBand";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { PageTransition } from "@/components/PageTransition";
import { RouteSeo } from "@/components/seo/RouteSeo";
import { getSolution, SOLUTIONS, type Solution } from "@/data/solutions";

export default function SolutionPage() {
  const { slug } = useParams<{ slug: string }>();
  const solution = getSolution(slug);

  if (!solution) return <Navigate to="/solutions" replace />;

  const related = solution.related
    .map((s) => SOLUTIONS.find((x) => x.slug === s))
    .filter((s): s is Solution => Boolean(s));

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: `Matbex for ${solution.name}`,
    description: solution.seoDescription,
    provider: { "@type": "Organization", name: "Matbex", url: "https://matbex.com" },
    areaServed: "SA",
    url: `https://matbex.com/solutions/${solution.slug}`,
  };

  return (
    <PageTransition>
      <RouteSeo
        title={solution.seoTitle}
        description={solution.seoDescription}
        path={`/solutions/${solution.slug}`}
      />
      <Helmet>
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>

      <MarketingShell>
        <LandingHeader />
        <main className="flex-1">
          <MarketingPageHero
            eyebrow="Solutions"
            title={solution.headline}
            summary={solution.summary}
            crumbs={[
              { label: "Home", to: "/" },
              { label: "Solutions", to: "/solutions" },
              { label: solution.name },
            ]}
            actions={
              <>
                <Link
                  to="/auth?mode=signup"
                  className="inline-flex items-center justify-center gap-2 min-h-11 h-11 px-6 rounded-lg bg-[#00A859] text-white text-sm font-medium hover:bg-[#00A859]/90 transition-colors"
                >
                  Start your residency
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  to="/#pricing"
                  className="inline-flex items-center justify-center min-h-11 h-11 px-6 rounded-lg border border-white/15 text-white/80 text-sm font-medium hover:bg-white/[0.06] hover:text-white transition-colors"
                >
                  See pricing
                </Link>
              </>
            }
          />

          {/* Before / after */}
          <section className="relative max-w-5xl mx-auto px-6 py-14 sm:py-16">
            <MarketingReveal>
              <h2 className="text-2xl md:text-3xl font-light tracking-tight text-white mb-8">
                What changes on day one
              </h2>
            </MarketingReveal>
            <div className="grid gap-4 md:grid-cols-2">
              <MarketingReveal>
                <div className="h-full rounded-2xl border border-white/10 bg-white/[0.02] p-6">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-white/40 mb-4">
                    Today
                  </p>
                  <ul className="space-y-3">
                    {solution.before.map((line) => (
                      <li key={line} className="flex gap-3 text-sm text-white/55 leading-relaxed">
                        <Minus className="w-4 h-4 mt-0.5 shrink-0 text-white/25" />
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              </MarketingReveal>
              <MarketingReveal delay={0.08}>
                <div className="h-full rounded-2xl border border-[#00A859]/25 bg-[#00A859]/[0.06] p-6">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-[#4FD08A] mb-4">
                    On Matbex
                  </p>
                  <ul className="space-y-3">
                    {solution.after.map((line) => (
                      <li key={line} className="flex gap-3 text-sm text-white/75 leading-relaxed">
                        <Check className="w-4 h-4 mt-0.5 shrink-0 text-[#4FD08A]" />
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              </MarketingReveal>
            </div>
          </section>

          {/* Mechanisms */}
          <section className="relative max-w-5xl mx-auto px-6 py-14 sm:py-16 border-t border-white/10">
            <MarketingReveal>
              <h2 className="text-2xl md:text-3xl font-light tracking-tight text-white mb-8">
                How it works
              </h2>
            </MarketingReveal>
            <div className="grid gap-4 md:grid-cols-3">
              {solution.mechanisms.map((m, i) => (
                <MarketingReveal key={m.title} delay={i * 0.07}>
                  <div className="h-full rounded-2xl border border-white/10 bg-white/[0.02] p-6">
                    <span className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-white/12 text-xs text-[#4FD08A] mb-4">
                      {i + 1}
                    </span>
                    <h3 className="text-base font-medium text-white mb-2">{m.title}</h3>
                    <p className="text-sm font-light leading-relaxed text-white/55">{m.body}</p>
                  </div>
                </MarketingReveal>
              ))}
            </div>
          </section>

          {/* Operator quote */}
          <section className="relative max-w-3xl mx-auto px-6 py-14 sm:py-16">
            <MarketingReveal>
              <figure className="relative rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
                <Quote className="w-6 h-6 text-[#00A859] mx-auto mb-4" aria-hidden />
                <blockquote className="text-lg md:text-xl font-light leading-relaxed text-white/85">
                  “{solution.quote.text}”
                </blockquote>
                <figcaption className="mt-5 text-sm text-white/45">
                  {solution.quote.author} · {solution.quote.role}
                </figcaption>
              </figure>
            </MarketingReveal>
          </section>

          {/* Related solutions */}
          {related.length > 0 && (
            <section className="relative max-w-5xl mx-auto px-6 py-14 sm:py-16 border-t border-white/10">
              <MarketingReveal>
                <h2 className="text-xl md:font-display text-2xl md:text-3xl font-semibold tracking-tight text-white mb-6">
                  Also built for
                </h2>
              </MarketingReveal>
              <div className="grid gap-4 sm:grid-cols-2">
                {related.map((r, i) => {
                  const RelatedIcon = r.icon;
                  return (
                    <MarketingReveal key={r.slug} delay={i * 0.07}>
                      <Link
                        to={`/solutions/${r.slug}`}
                        className="group flex h-full items-start gap-4 rounded-2xl border border-white/10 bg-white/[0.02] p-6 transition-colors hover:border-[#00A859]/35 hover:bg-white/[0.04]"
                      >
                        <RelatedIcon className="w-5 h-5 shrink-0 text-[#4FD08A]" aria-hidden />
                        <span>
                          <span className="block text-base font-medium text-white">{r.name}</span>
                          <span className="mt-1 block text-sm font-light leading-relaxed text-white/55">
                            {r.teaser}
                          </span>
                        </span>
                        <ArrowRight className="ml-auto w-4 h-4 shrink-0 text-white/30 transition-transform group-hover:translate-x-0.5 group-hover:text-white/60" />
                      </Link>
                    </MarketingReveal>
                  );
                })}
              </div>
            </section>
          )}

          <MarketingCtaBand />
        </main>
        <LandingFooter />
      </MarketingShell>
    </PageTransition>
  );
}
