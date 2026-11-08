import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Check } from "lucide-react";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { MarketingPageHero, MarketingReveal } from "@/components/marketing/MarketingPageHero";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { PageTransition } from "@/components/PageTransition";
import { RouteSeo } from "@/components/seo/RouteSeo";
import { Skeleton } from "@/components/ui/skeleton";
import { useLandingContent, type LandingPricingPlan } from "@/hooks/useLandingContent";
import { useRegion } from "@/hooks/useRegion";
import { PLAN_PRICES_SAR, SAR_PER_USD, annualMonthlySar, annualTotalSar, planKeyFromName } from "@/data/pricing";

import { PricingSignupForm } from "@/components/marketing/PricingSignupForm";

export default function Pricing() {
  const [isAnnual, setIsAnnual] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState("");
  const navigate = useNavigate();
  const { pricingPlans, isLoading } = useLandingContent();
  const { region, formatPrice } = useRegion();

  const plans = pricingPlans.filter((p) => p.is_active);
  const billing = isAnnual ? "annual" : "monthly";

  /** Card CTA picks the plan then drops the visitor onto the signup form. */
  const choosePlan = (planName: string) => {
    setSelectedPlan(planName);
    document.getElementById("signup")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };


  /** Prices come from src/data/pricing.ts (SAR); formatPrice expects USD. */
  const priceOf = (plan: LandingPricingPlan) => {
    const key = planKeyFromName(plan.name);
    if (!key) return isAnnual ? plan.annual_price : plan.monthly_price;
    const sar = isAnnual ? annualMonthlySar(key) : PLAN_PRICES_SAR[key].monthly;
    return sar / SAR_PER_USD;
  };

  return (
    <PageTransition>
      <RouteSeo
        title="Matbex Pricing — Restaurant POS & Accounting Plans in Saudi Arabia"
        description="Transparent monthly and annual pricing for Matbex: Starter Core, Growth Bundle and Enterprise. Per-branch plans covering POS, inventory, accounting and ZATCA compliance."
        path="/pricing"
      />
      <MarketingShell>
        <LandingHeader />
        <main className="flex-1">
          <MarketingPageHero
            eyebrow="Pricing"
            title="Pay for the branch, not the guesswork"
            summary="One price per branch, every core module included. Move up when you add accounting, payroll and cost control — not when you add a busy week."
            crumbs={[{ label: "Home", to: "/" }, { label: "Pricing" }]}
            note="Prices exclude VAT. Annual billing is charged once for twelve months."
          />

          {/* Billing toggle */}
          <section className="relative max-w-6xl mx-auto w-full px-6 pb-4">
            <MarketingReveal>
              <div className="flex justify-center">
                <div
                  role="group"
                  aria-label="Billing period"
                  className="inline-flex items-center gap-1 rounded-xl border border-white/12 bg-white/[0.04] p-1"
                >
                  <button
                    type="button"
                    onClick={() => setIsAnnual(false)}
                    aria-pressed={!isAnnual}
                    className={`min-h-11 px-5 rounded-lg text-sm font-medium transition-colors ${
                      !isAnnual ? "bg-white/10 text-white" : "text-white/55 hover:text-white"
                    }`}
                  >
                    Monthly
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsAnnual(true)}
                    aria-pressed={isAnnual}
                    className={`min-h-11 px-5 rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-2 ${
                      isAnnual ? "bg-white/10 text-white" : "text-white/55 hover:text-white"
                    }`}
                  >
                    Annual
                    <span className="text-xs text-[#4FD08A]">2 months free</span>
                  </button>
                </div>
              </div>
            </MarketingReveal>
          </section>

          {/* Plan cards */}
          <section className="relative max-w-6xl mx-auto w-full px-6 py-10 sm:py-14">
            <div className="grid gap-4 md:grid-cols-3">
              {isLoading
                ? [1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="rounded-2xl border border-white/10 bg-white/[0.02] p-7 space-y-4"
                    >
                      <Skeleton className="h-4 w-24 bg-white/10" />
                      <Skeleton className="h-8 w-36 bg-white/10" />
                      <Skeleton className="h-12 w-28 bg-white/10" />
                      <Skeleton className="h-32 w-full bg-white/10" />
                    </div>
                  ))
                : plans.map((plan, index) => {
                    const price = priceOf(plan);
                    const highlighted = plan.is_highlighted;
                    return (
                      <motion.div
                        key={plan.id}
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, margin: "-80px" }}
                        transition={{ duration: 0.5, delay: index * 0.08 }}
                        className={`relative flex flex-col rounded-2xl p-7 ${
                          highlighted
                            ? "border border-[#00A859]/45 bg-[#00A859]/[0.07]"
                            : "border border-white/10 bg-white/[0.02]"
                        }`}
                      >
                        {plan.badge_text && (
                          <span className="absolute -top-3 left-7 inline-flex items-center rounded-full bg-[#00A859] px-3 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-white">
                            {plan.badge_text}
                          </span>
                        )}

                        <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 mb-2">
                          {plan.tagline}
                        </p>
                        <h2 className="text-xl font-medium text-white mb-2">{plan.name}</h2>
                        <p className="text-sm font-light leading-relaxed text-white/55">
                          {plan.description}
                        </p>

                        <div className="mt-6 pb-6 border-b border-white/10">
                          {price === null || price === undefined ? (
                            <p className="text-3xl font-light tracking-tight text-white">
                              Custom quote
                            </p>
                          ) : (
                            <>
                              <p className="flex items-baseline gap-2 text-white">
                                <span className="text-5xl font-light tracking-tight">
                                  {formatPrice(price, false)}
                                </span>
                                <span className="text-lg text-white/50">
                                  {region.currencySymbol}
                                </span>
                                <span className="text-sm text-white/45">
                                  / branch / month
                                </span>
                              </p>
                              <p className="mt-1 text-xs text-white/40">
                                {isAnnual
                                  ? `${formatPrice(planKeyFromName(plan.name) ? annualTotalSar(planKeyFromName(plan.name)!) / SAR_PER_USD : price * 12, false)} ${region.currencySymbol} billed yearly (2 months free), excluding VAT`
                                  : "Billed monthly, excluding VAT"}
                              </p>
                            </>
                          )}
                        </div>

                        <ul className="mt-6 space-y-3 flex-1">
                          {plan.features.map((feature) => (
                            <li key={feature} className="flex items-start gap-2.5">
                              <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#4FD08A]" />
                              <span className="text-sm font-light leading-relaxed text-white/70">
                                {feature}
                              </span>
                            </li>
                          ))}
                        </ul>

                        <button
                          type="button"
                          onClick={() => {
                            const key = planKeyFromName(plan.name);
                            if (price === null || price === undefined || !key) return choosePlan(plan.name);
                            try { localStorage.setItem("matbex_trial_plan", key); } catch { /* ignore */ }
                            navigate(`/auth?signup=1&plan=${key}`);
                          }}
                          className={`mt-7 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-5 text-sm font-medium transition-colors ${
                            highlighted
                              ? "bg-[#00A859] text-white hover:bg-[#00A859]/90"
                              : "border border-white/15 text-white/85 hover:bg-white/[0.07] hover:text-white"
                          }`}
                        >
                          {price === null || price === undefined
                            ? "Talk to our team"
                            : "Start 14-day free trial"}
                          <ArrowRight className="h-4 w-4" />
                        </button>

                      </motion.div>
                    );
                  })}
            </div>
          </section>

          {/* What every plan includes */}
          <section className="relative max-w-6xl mx-auto w-full px-6 py-14 sm:py-16 border-t border-white/10">
            <MarketingReveal>
              <h2 className="text-2xl md:text-3xl font-light tracking-tight text-white mb-8">
                In every plan, from day one
              </h2>
            </MarketingReveal>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  title: "Offline-first till",
                  body: "Sales keep recording when the internet drops and sync the moment it returns.",
                },
                {
                  title: "Arabic and English",
                  body: "Full right-to-left interface, Riyal formatting and Hijri-aware reporting.",
                },
                {
                  title: "Your data, exportable",
                  body: "Every ledger, invoice and stocktake exports to CSV or PDF whenever you ask.",
                },
                {
                  title: "Onboarding included",
                  body: "Menu, suppliers and opening balances loaded with you before you go live.",
                },
              ].map((item, i) => (
                <MarketingReveal key={item.title} delay={(i % 4) * 0.06}>
                  <div className="h-full rounded-2xl border border-white/10 bg-white/[0.02] p-6">
                    <h3 className="text-base font-medium text-white mb-2">{item.title}</h3>
                    <p className="text-sm font-light leading-relaxed text-white/55">{item.body}</p>
                  </div>
                </MarketingReveal>
              ))}
            </div>
          </section>

          {/* Pricing questions */}
          <section className="relative max-w-3xl mx-auto w-full px-6 py-14 sm:py-16 border-t border-white/10">
            <MarketingReveal>
              <h2 className="text-2xl md:text-3xl font-light tracking-tight text-white mb-8">
                Pricing questions, answered
              </h2>
            </MarketingReveal>
            <div className="space-y-4">
              {[
                {
                  q: "Is the price per branch or per company?",
                  a: "Per branch. A second location is a second subscription, and group reporting across branches is included at no extra charge.",
                },
                {
                  q: "What happens if I outgrow my plan?",
                  a: "You move up whenever you need the extra modules. We bill the difference for the remaining term — nothing is re-entered and no data is lost.",
                },
                {
                  q: "Do you charge per transaction?",
                  a: "No. Your bill does not change because you had a busy month.",
                },
                {
                  q: "Is VAT included?",
                  a: "Prices are shown before VAT. Saudi VAT is added on your invoice and is fully reclaimable.",
                },
              ].map((item, i) => (
                <MarketingReveal key={item.q} delay={i * 0.05}>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
                    <h3 className="text-base font-medium text-white mb-2">{item.q}</h3>
                    <p className="text-sm font-light leading-relaxed text-white/55">{item.a}</p>
                  </div>
                </MarketingReveal>
              ))}
            </div>
          </section>

          {/* Signup form — submissions land in the admin enquiries inbox */}
          <PricingSignupForm
            planNames={plans.map((p) => p.name)}
            selectedPlan={selectedPlan}
            onSelectPlan={setSelectedPlan}
            billing={billing}
            onSelectBilling={(cycle) => setIsAnnual(cycle === "annual")}
          />

          {/* Closing CTA for anyone who would rather see it live first */}
          <section className="relative border-t border-white/10">
            <span
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-0 h-[380px] w-[760px] max-w-[140vw] -translate-x-1/2 -translate-y-1/3 rounded-full bg-[radial-gradient(circle,rgba(0,168,89,0.16),transparent_70%)] blur-2xl"
            />
            <div className="relative max-w-3xl mx-auto px-6 py-16 sm:py-20 text-center">
              <MarketingReveal>
                <h2 className="text-2xl md:text-3xl font-light tracking-tight text-white mb-4">
                  Not sure which plan fits your floor?
                </h2>
                <p className="text-base font-light leading-relaxed text-white/55 mb-8">
                  See it running against your own menu and branch count before you commit to a
                  plan.
                </p>
                <Link
                  to="/demo"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#00A859] px-6 text-sm font-medium text-white transition-colors hover:bg-[#00A859]/90"
                >
                  Book a live demo
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </MarketingReveal>
            </div>
          </section>
        </main>
        <LandingFooter />
      </MarketingShell>
    </PageTransition>
  );
}
