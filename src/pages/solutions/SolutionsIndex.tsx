import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { MarketingPageHero, MarketingReveal } from "@/components/marketing/MarketingPageHero";
import { MarketingCtaBand } from "@/components/marketing/MarketingCtaBand";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { PageTransition } from "@/components/PageTransition";
import { RouteSeo } from "@/components/seo/RouteSeo";
import { SOLUTIONS } from "@/data/solutions";

export default function SolutionsIndex() {
  return (
    <PageTransition>
      <RouteSeo
        title="Restaurant Solutions by Venue Type in Saudi Arabia | Matbex"
        description="Matbex for cafés, quick-service counters, dining rooms, cloud kitchens, bakeries, food trucks and multi-branch groups — one operating system, tuned to how you trade."
        path="/solutions"
      />
      <MarketingShell>
        <LandingHeader />
        <main className="flex-1">
          <MarketingPageHero
            eyebrow="Solutions"
            title="One operating system, tuned to how you actually trade"
            summary="A café counts cups, a cloud kitchen counts commissions, a group counts branches. Same platform, different measures — pick the one that matches your floor."
            crumbs={[{ label: "Home", to: "/" }, { label: "Solutions" }]}
          />

          <section className="relative max-w-5xl mx-auto px-6 py-14 sm:py-16">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {SOLUTIONS.map((s, i) => {
                const Icon = s.icon;
                return (
                <MarketingReveal key={s.slug} delay={(i % 3) * 0.06}>
                  <Link
                    to={`/solutions/${s.slug}`}
                    className="group flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-6 transition-colors hover:border-[#00A859]/35 hover:bg-white/[0.04]"
                  >
                    <Icon className="w-5 h-5 text-[#4FD08A] mb-4" aria-hidden />
                    <h2 className="text-base font-medium text-white">{s.name}</h2>
                    <p className="mt-2 text-sm font-light leading-relaxed text-white/55">
                      {s.teaser}
                    </p>
                    <span className="mt-5 inline-flex items-center gap-1.5 text-sm text-[#4FD08A]">
                      Read more
                      <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                </MarketingReveal>
                );
              })}
            </div>
          </section>

          <MarketingCtaBand />
        </main>
        <LandingFooter />
      </MarketingShell>
    </PageTransition>
  );
}
