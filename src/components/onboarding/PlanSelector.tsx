import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { db } from "@/integrations/db/client";
import { cn } from "@/lib/utils";
import { Check, Building2, Rocket, Crown, Sparkles, Gift } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useRegion } from "@/hooks/useRegion";
import { PLAN_PRICES_SAR, SAR_PER_USD, annualTotalSar, planKeyFromName } from "@/data/pricing";
import { OptimizedLottie } from "@/components/performance/OptimizedLottie";

interface Plan {
  id: string;
  name: string;
  price: number;
  billing_interval: string;
  description: string | null;
  default_feature_flags: Record<string, boolean>;
}

interface PlanSelectorProps {
  selectedPlan: string | null;
  billingInterval: "monthly" | "annual";
  onPlanSelect: (planId: string) => void;
  onIntervalChange: (interval: "monthly" | "annual") => void;
  onContinue: () => void;
}

const planIcons: Record<string, typeof Building2> = {
  trial: Gift,
  free: Building2,
  essentials: Building2,
  pro: Rocket,
  enterprise: Crown,
};

const planColors: Record<string, string> = {
  trial: "border-[#00A859]/40 bg-[#00A859]/5 hover:border-[#00A859]/60",
  free: "border-gray-200 bg-white hover:border-gray-300",
  essentials: "border-gray-200 bg-white hover:border-gray-300",
  pro: "border-[#00A859]/30 bg-[#00A859]/5 hover:border-[#00A859]/50",
  enterprise: "border-gray-200 bg-white hover:border-gray-300",
};

const planSelectedColors: Record<string, string> = {
  trial: "border-[#00A859] bg-[#00A859]/10 ring-2 ring-[#00A859]/20",
  free: "border-gray-400 bg-gray-50 ring-2 ring-gray-200",
  essentials: "border-[#00A859] bg-[#00A859]/5 ring-2 ring-[#00A859]/20",
  pro: "border-[#00A859] bg-[#00A859]/5 ring-2 ring-[#00A859]/20",
  enterprise: "border-[#00A859] bg-[#00A859]/5 ring-2 ring-[#00A859]/20",
};

const planFeatureKeys: Record<string, string[]> = {
  trial: ["trial1", "trial2", "trial3"],
  free: ["free1", "free2", "free3"],
  starter: ["free1", "free2", "free3"],
  essentials: ["essentials1", "essentials2", "essentials3", "essentials4"],
  pro: ["pro1", "pro2", "pro3", "pro4", "pro5"],
  enterprise: ["enterprise1", "enterprise2", "enterprise3", "enterprise4", "enterprise5"],
};

export function PlanSelector({
  selectedPlan,
  billingInterval,
  onPlanSelect,
  onIntervalChange,
  onContinue,
}: PlanSelectorProps) {
  const { t } = useTranslation();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const { region, formatPrice } = useRegion();

  useEffect(() => {
    const fetchPlans = async () => {
      const { data } = await db
        .from("plans")
        .select("*")
        .eq("is_active", true)
        .order("price", { ascending: true });

      if (data) {
        const mapped = data.map(p => ({
          ...p,
          default_feature_flags: typeof p.default_feature_flags === 'object' && p.default_feature_flags !== null
            ? p.default_feature_flags as Record<string, boolean>
            : {}
        }));
        // Ensure trial appears first
        mapped.sort((a, b) => {
          if (a.name.toLowerCase() === 'trial') return -1;
          if (b.name.toLowerCase() === 'trial') return 1;
          return a.price - b.price;
        });
        setPlans(mapped);
      }
      setLoading(false);
    };

    fetchPlans();
  }, []);

  /**
   * Prices come from src/data/pricing.ts (SAR per branch per month; yearly = 10 months), the
   * same list as the pricing page. formatPrice expects USD, so SAR is divided by SAR_PER_USD.
   */
  const priceOf = (planName: string, dbPrice: number) => {
    const key = planKeyFromName(planName);
    if (!key) return planName.toLowerCase() === "trial" ? 0 : dbPrice / SAR_PER_USD;
    const sar = billingInterval === "annual" ? annualTotalSar(key) : PLAN_PRICES_SAR[key].monthly;
    return sar / SAR_PER_USD;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-2 border-[#00A859] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-widest text-gray-400 font-medium">
          {t("register.plans.pricingLabel")}
        </p>
        <h1 className="text-2xl font-medium tracking-tight text-gray-900">
          {t("register.plans.selectYourPlan")}
        </h1>
        <p className="text-gray-500 font-light">
          {t("register.plans.selectSubtitle")}
        </p>
      </div>

      {/* Billing Toggle */}
      <div className="flex items-center gap-4 p-3 bg-gray-50 rounded-xl">
        <span
          className={cn(
            "text-sm cursor-pointer transition-colors flex-1 text-center py-2 rounded-lg",
            billingInterval === "monthly" 
              ? "bg-white text-gray-900 font-medium shadow-sm" 
              : "text-gray-500 hover:text-gray-700"
          )}
          onClick={() => onIntervalChange("monthly")}
        >
          {t("register.plans.monthly")}
        </span>
        <span
          className={cn(
            "text-sm cursor-pointer transition-colors flex-1 text-center py-2 rounded-lg flex items-center justify-center gap-2",
            billingInterval === "annual" 
              ? "bg-white text-gray-900 font-medium shadow-sm" 
              : "text-gray-500 hover:text-gray-700"
          )}
          onClick={() => onIntervalChange("annual")}
        >
          {t("register.plans.annual")}
          <Badge className="bg-[#00A859]/10 text-[#00A859] text-[10px] px-1.5 border-0">
            -17%
          </Badge>
        </span>
      </div>

      {/* Plan Cards */}
      <div className="space-y-3">
        {plans.slice(0, 4).map((plan, index) => {
          const Icon = planIcons[plan.name.toLowerCase()] || Building2;
          const isSelected = selectedPlan === plan.id;
          const planKey = plan.name.toLowerCase();
          const featureKeys = planFeatureKeys[planKey] || [];
          const features = featureKeys.map((k) => t(`register.plans.features.${k}`));
          const displayPrice = priceOf(plan.name, Number(plan.price) || 0);
          const isPro = planKey === "pro";
          const isTrial = planKey === "trial";

          return (
            <motion.div
              key={plan.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              onClick={() => onPlanSelect(plan.id)}
              className={cn(
                "relative rounded-xl border p-4 cursor-pointer transition-all duration-200",
                isSelected
                  ? planSelectedColors[plan.name.toLowerCase()] || planSelectedColors.free
                  : planColors[plan.name.toLowerCase()] || planColors.free
              )}
            >
              {/* Popular / Trial Badge */}
              {isTrial ? (
                <div className="absolute -top-2.5 right-4">
                  <Badge className="bg-[#00A859] text-white border-0 text-[10px] px-2">
                    <Gift className="w-2.5 h-2.5 mr-1" />
                    {t("register.plans.fourteenDaysFree")}
                  </Badge>
                </div>
              ) : isPro && (
                <div className="absolute -top-2.5 right-4">
                  <Badge className="bg-[#00A859] text-white border-0 text-[10px] px-2">
                    <Sparkles className="w-2.5 h-2.5 mr-1" />
                    {t("register.plans.popular")}
                  </Badge>
                </div>
              )}

              <div className="flex items-start gap-4">
                {/* Icon */}
                <div className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0",
                  isSelected ? "bg-[#00A859]/10" : "bg-gray-100"
                )}>
                  <Icon className={cn(
                    "w-5 h-5",
                    isSelected ? "text-[#00A859]" : "text-gray-500"
                  )} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-sm font-medium text-gray-900 capitalize">
                      {t(`register.plans.names.${planKey}`, { defaultValue: plan.name })}
                    </h3>
                    <div className="flex items-baseline gap-1">
                      {region.code === "SA" || region.code === "AE" ? (
                        <>
                          <span className="text-lg font-medium text-gray-900">
                            {formatPrice(displayPrice, false)}
                          </span>
                          <span className="text-sm font-medium text-gray-900">{region.currencySymbol}</span>
                        </>
                      ) : (
                        <span className="text-lg font-medium text-gray-900">
                          {region.currencySymbol}{formatPrice(displayPrice, false)}
                        </span>
                      )}
                      <span className="text-xs text-gray-500">
                        /{billingInterval === "annual" ? t("register.plans.perYearShort") : t("register.plans.perMonthShort")}
                      </span>
                    </div>
                  </div>
                  
                  {/* Features Preview */}
                  <p className="text-xs text-gray-500 font-light truncate">
                    {features.slice(0, 3).join(" • ")}
                  </p>
                </div>

                {/* Selection Indicator */}
                <div className="flex-shrink-0">
                  <AnimatePresence>
                    {isSelected ? (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        exit={{ scale: 0 }}
                      >
                        <div className="w-6 h-6" style={{ filter: 'hue-rotate(120deg) saturate(1.5)' }}>
                          <OptimizedLottie
                            src="https://assets2.lottiefiles.com/packages/lf20_jbrw3hcz.json"
                            loop={false}
                            autoplay
                            className="w-full h-full"
                          />
                        </div>
                      </motion.div>
                    ) : (
                      <div className="w-5 h-5 rounded-full border-2 border-gray-200" />
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Continue Button */}
      <button
        onClick={onContinue}
        disabled={!selectedPlan}
        className={cn(
          "w-full py-3.5 rounded-xl text-sm font-medium transition-all duration-300 flex items-center justify-center gap-2",
          selectedPlan
            ? "bg-[#00A859] text-white hover:bg-[#008a4a] shadow-lg shadow-[#00A859]/25"
            : "bg-gray-100 text-gray-400 cursor-not-allowed"
        )}
      >
        <Check className="w-4 h-4" />
        {t("register.plans.selectAndContinue")}
      </button>

      {/* Terms Notice */}
      <p className="text-center text-xs text-gray-400 font-light">
        {t("register.plans.termsNotice")}
      </p>
    </div>
  );
}
