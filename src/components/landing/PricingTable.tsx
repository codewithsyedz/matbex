import { motion } from "framer-motion";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { useLandingContent } from "@/hooks/useLandingContent";
import { Skeleton } from "@/components/ui/skeleton";
import { useRegion } from "@/hooks/useRegion";
import { PLAN_PRICES_SAR, SAR_PER_USD, annualMonthlySar, planKeyFromName } from "@/data/pricing";
import { useRevealInView } from "@/hooks/useRevealInView";
import { useTranslation } from "react-i18next";
import { useLocaleText } from "@/hooks/useLocaleText";
import { MarketComparison } from "./MarketComparison";
import { FoundingBanner } from "./FoundingBanner";

export const PricingTable = () => {
  const { ref, isRevealed } = useRevealInView<HTMLElement>({ margin: "-100px" });
  const [isAnnual, setIsAnnual] = useState(true);
  const { pricingPlans, isLoading } = useLandingContent();
  const { region, formatPrice } = useRegion();
  const { t } = useTranslation();
  const tt = useLocaleText();

  // Filter only active plans
  const activePlans = pricingPlans.filter(p => p.is_active);

  const renderPrice = (plan: typeof activePlans[0]) => {
    const key = planKeyFromName(plan.name);
    const price = key
      ? (isAnnual ? annualMonthlySar(key) : PLAN_PRICES_SAR[key].monthly) / SAR_PER_USD
      : isAnnual ? plan.annual_price : plan.monthly_price;
    if (price === null || price === undefined) {
      return (
        <span className="text-3xl font-light tracking-[-0.02em] text-gray-900">
          {t("landing.pricingTable.custom")}
        </span>
      );
    }

    const formattedPrice = formatPrice(price, false);
    
    // For RTL currencies (SAR, AED), show symbol after number
    if (region.code === "SA" || region.code === "AE") {
      return (
        <div className="flex items-baseline gap-2">
          <span className="text-5xl font-light tracking-[-0.02em] text-gray-900">
            {formattedPrice}
          </span>
          <span className="text-xl text-gray-500">
            {region.currencySymbol}
          </span>
          <span className="text-lg text-gray-500">
            {t("landing.pricingTable.perMonth")}
          </span>
        </div>
      );
    }

    return (
      <div className="flex items-baseline gap-1">
        <span className="text-5xl font-light tracking-[-0.02em] text-gray-900">
          {region.currencySymbol}{formattedPrice}
        </span>
        <span className="text-lg text-gray-500">
          {t("landing.pricingTable.perMonth")}
        </span>
      </div>
    );
  };

  return (
    <section id="pricing" ref={ref} className="py-12 sm:py-16 lg:py-28 bg-[#FAFAFA] border-t border-gray-200">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isRevealed ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.8 }}
          className="text-center mb-16"
        >
          <p className="text-xs font-medium text-[#00713A] uppercase tracking-[0.08em] mb-4">
            {t("landing.pricingTable.eyebrow")}
          </p>
          <h2 className="text-3xl md:text-4xl lg:text-[40px] font-semibold tracking-[-0.01em] text-gray-900 mb-4 leading-[1.1]">
            {t("landing.pricingTable.headlinePrefix")}{" "}
            <span className="text-gray-500">{t("landing.pricingTable.headlineBold")}</span>
          </h2>
          <p className="text-base text-gray-600 max-w-2xl mx-auto mb-8 leading-[1.55]">
            {t("landing.pricingTable.subtitle")}
          </p>

          {/* Billing Toggle */}
          <div className="inline-flex items-center gap-1 p-1 bg-white border border-gray-200 rounded-md">
            <button
              onClick={() => setIsAnnual(false)}
              className={`px-4 min-h-11 inline-flex items-center justify-center rounded text-sm font-medium transition-colors ${
                !isAnnual
                  ? "bg-gray-100 text-gray-900"
                  : "text-gray-500 hover:text-gray-900"
              }`}
            >
              {t("landing.pricingTable.monthly")}
            </button>
            <button
              onClick={() => setIsAnnual(true)}
              className={`px-4 min-h-11 inline-flex items-center justify-center rounded text-sm font-medium transition-colors flex items-center gap-2 ${
                isAnnual
                  ? "bg-gray-100 text-gray-900"
                  : "text-gray-500 hover:text-gray-900"
              }`}
            >
              {t("landing.pricingTable.annual")}
              <span className="text-xs text-[#00713A] font-medium">{t("landing.pricingTable.saveBadge")}</span>
            </button>
          </div>
        </motion.div>

        <FoundingBanner />

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-3 gap-4 lg:gap-6">
          {isLoading ? (
            [1, 2, 3].map((i) => (
              <div key={i} className="rounded-lg p-8 bg-white border border-gray-200">
                <Skeleton className="h-4 w-20 mb-1" />
                <Skeleton className="h-8 w-32 mb-2" />
                <Skeleton className="h-4 w-48 mb-8" />
                <Skeleton className="h-12 w-28 mb-8" />
                <div className="space-y-4 mb-8">
                  {[1, 2, 3, 4, 5].map((j) => (
                    <div key={j} className="flex items-center gap-3">
                      <Skeleton className="w-5 h-5 rounded-full" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                  ))}
                </div>
                <Skeleton className="h-12 w-full rounded-full" />
              </div>
            ))
          ) : (
            activePlans.map((plan, index) => (
              <motion.div
                key={plan.id}
                initial={{ opacity: 0, y: 20 }}
                animate={isRevealed ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
                transition={{ duration: 0.6, delay: index * 0.1 }}
                className={`relative rounded-lg p-8 bg-white border ${
                  plan.is_highlighted
                    ? "border-[#00A859]"
                    : "border-gray-200"
                }`}
              >
                {/* Badge */}
                {plan.badge_text && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <div className="inline-flex items-center px-2.5 py-1 bg-[#00A859] text-white text-[10px] font-medium uppercase tracking-[0.08em] rounded">
                      {plan.badge_text}
                    </div>
                  </div>
                )}

                {/* Plan Header */}
                <div className="mb-6">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-[0.06em] mb-1">
                    {tt(`landing.pricingTable.plans.${plan.sort_order}.tagline`, plan.tagline)}
                  </p>
                  <h3 className="text-xl font-semibold tracking-[-0.01em] text-gray-900 mb-2">
                    {tt(`landing.pricingTable.plans.${plan.sort_order}.name`, plan.name)}
                  </h3>
                  <p className="text-sm text-gray-600 leading-[1.55]">
                    {tt(`landing.pricingTable.plans.${plan.sort_order}.description`, plan.description)}
                  </p>
                </div>

                {/* Price */}
                <div className="mb-6 pb-6 border-b border-gray-100">
                  {renderPrice(plan)}
                  {isAnnual && plan.annual_price && (
                    <p className="text-xs mt-1 text-gray-500">
                      {t("landing.pricingTable.billedAnnually")}
                    </p>
                  )}
                </div>

                {/* Features */}
                <ul className="space-y-3 mb-8">
                  {plan.features.map((feature, featureIndex) => {
                    const label = tt(
                      `landing.pricingTable.plans.${plan.sort_order}.features.${featureIndex}`,
                      feature
                    );
                    const isHardware = /pos\s*\+\s*cash\s*drawer/i.test(feature) || /pos\s*\+\s*cash\s*drawer/i.test(label);
                    // Hardware bundle (POS + Cash Drawer + Shift Control) is annual-only.
                    if (isHardware && !isAnnual) return null;
                    return (
                      <li key={featureIndex} className="flex items-start gap-2.5">
                        <Check className="w-4 h-4 text-[#00713A] flex-shrink-0 mt-0.5" />
                        <span className="text-sm text-gray-700 leading-[1.5]">
                          {label}
                          {isHardware && isAnnual && (
                            <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide bg-[#00A859]/10 text-[#00713A] align-middle">
                              Annual only
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>

                {/* CTA */}
                <Button
                  className={`w-full h-11 rounded-md text-sm font-medium shadow-none ${
                    plan.is_highlighted
                      ? "bg-[#007a3d] hover:bg-[#006b33] text-white"
                      : "bg-white border border-gray-300 hover:bg-gray-50 text-gray-900"
                  }`}
                  asChild
                >
                  <Link to={planKeyFromName(plan.name) ? `/auth?signup=1&plan=${planKeyFromName(plan.name)}` : "/demo"}>{tt(`landing.pricingTable.plans.${plan.sort_order}.cta`, plan.cta_text)}</Link>
                </Button>
              </motion.div>
            ))
          )}
        </div>

        <MarketComparison />
      </div>
    </section>
  );
};
