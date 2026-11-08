import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  Check,
  Sparkles,
  Users,
  Calculator,
  TrendingUp,
  ShieldCheck,
  ArrowRight,
  ArrowLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { useAddonCatalog, type Addon } from "@/hooks/useAddons";
import { useRegion } from "@/hooks/useRegion";

type CategoryKey = "scale_team" | "financial" | "growth" | "compliance";

const CATEGORY_META: Record<
  CategoryKey,
  { label: string; sub: string; icon: typeof Users }
> = {
  scale_team: {
    label: "Scale & Team",
    sub: "More branches, users, and devices",
    icon: Users,
  },
  financial: {
    label: "Financial Intelligence",
    sub: "Accounting, COGS, payroll, forecasting",
    icon: Calculator,
  },
  growth: {
    label: "Customer & Growth",
    sub: "Online ordering, web, loyalty, aggregators",
    icon: TrendingUp,
  },
  compliance: {
    label: "Compliance & Advanced",
    sub: "ZATCA, KDS, CFD, multi-currency, API",
    icon: ShieldCheck,
  },
};

const CATEGORY_ORDER: CategoryKey[] = [
  "financial",
  "growth",
  "compliance",
  "scale_team",
];

// Bundle quick-picks (slugs)
const BUNDLES: { id: string; name: string; slugs: string[]; tagline: string }[] = [
  {
    id: "quick-service",
    name: "Quick Service",
    tagline: "Fast counters — POS, KDS, online ordering",
    slugs: ["online-ordering", "kds", "cogs-stocktake"],
  },
  {
    id: "fine-dining",
    name: "Fine Dining",
    tagline: "Floor plans, accounting, loyalty",
    slugs: ["floor-plan", "accounting-suite", "loyalty", "cogs-stocktake"],
  },
  {
    id: "multi-branch",
    name: "Multi-Branch Operator",
    tagline: "Scale across locations with full reporting",
    slugs: [
      "extra-branch",
      "accounting-suite",
      "cogs-stocktake",
      "payroll-advances",
      "profit-forecasting",
    ],
  },
  {
    id: "ksa-compliance",
    name: "KSA Compliance Ready",
    tagline: "ZATCA Phase 2 + accounting + payroll",
    slugs: ["zatca-phase2", "accounting-suite", "payroll-advances"],
  },
];

interface Props {
  selectedAddonIds: string[];
  onChange: (ids: string[]) => void;
  onContinue: () => void;
  onBack: () => void;
  billingInterval: "monthly" | "annual";
  basePlanPrice: number;
}

export function AddonsStep({
  selectedAddonIds,
  onChange,
  onContinue,
  onBack,
  billingInterval,
  basePlanPrice,
}: Props) {
  const { t } = useTranslation();
  const { data: catalog, isLoading } = useAddonCatalog();
  const { region, formatPrice } = useRegion();
  const [activeBundle, setActiveBundle] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const out: Record<CategoryKey, Addon[]> = {
      scale_team: [],
      financial: [],
      growth: [],
      compliance: [],
    };
    (catalog ?? []).forEach((a) => {
      const key = ((a as any).category ?? "general") as CategoryKey;
      if (out[key]) out[key].push(a);
    });
    return out;
  }, [catalog]);

  const selectedSet = new Set(selectedAddonIds);

  const monthlyAddonTotal = (catalog ?? [])
    .filter((a) => selectedSet.has(a.id))
    .reduce((sum, a) => sum + Number(a.price || 0), 0);

  const displayMultiplier = billingInterval === "annual" ? 12 * 0.83 : 1;
  const totalDisplay =
    (basePlanPrice + monthlyAddonTotal) * displayMultiplier;

  const toggle = (id: string) => {
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(Array.from(next));
    setActiveBundle(null);
  };

  const applyBundle = (bundleId: string) => {
    const bundle = BUNDLES.find((b) => b.id === bundleId);
    if (!bundle || !catalog) return;
    const ids = catalog
      .filter((a) => bundle.slugs.includes(a.slug))
      .map((a) => a.id);
    onChange(Array.from(new Set([...selectedAddonIds, ...ids])));
    setActiveBundle(bundleId);
  };

  const clearAll = () => {
    onChange([]);
    setActiveBundle(null);
  };

  const renderPrice = (amount: number) => {
    if (region.code === "SA" || region.code === "AE") {
      return (
        <>
          {formatPrice(amount, false)}{" "}
          <span className="text-xs">{region.currencySymbol}</span>
        </>
      );
    }
    return (
      <>
        {region.currencySymbol}
        {formatPrice(amount, false)}
      </>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-2 border-[#00A859] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-widest text-gray-400 font-medium">
          Step 2 · Build your plan
        </p>
        <h1 className="text-2xl font-medium tracking-tight text-gray-900">
          Add the modules you need
        </h1>
        <p className="text-gray-500 font-light">
          Starter Core is included. Pick only what you need now — you can add or
          remove modules anytime.
        </p>
      </div>

      {/* Bundle quick-picks */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs uppercase tracking-widest text-gray-400 font-medium">
            Quick bundles
          </p>
          {selectedAddonIds.length > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Clear all
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {BUNDLES.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => applyBundle(b.id)}
              className={cn(
                "text-left rounded-xl border p-3 transition-all",
                activeBundle === b.id
                  ? "border-[#00A859] bg-[#00A859]/5"
                  : "border-gray-200 bg-white hover:border-gray-300",
              )}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <Sparkles className="w-3.5 h-3.5 text-[#00A859]" />
                <span className="text-sm font-medium text-gray-900">
                  {b.name}
                </span>
              </div>
              <p className="text-xs text-gray-500 font-light leading-snug">
                {b.tagline}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Categories */}
      <div className="space-y-5">
        {CATEGORY_ORDER.map((cat) => {
          const items = grouped[cat];
          if (!items || items.length === 0) return null;
          const meta = CATEGORY_META[cat];
          const Icon = meta.icon;
          return (
            <div key={cat}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center">
                  <Icon className="w-3.5 h-3.5 text-gray-600" />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-gray-900">
                    {meta.label}
                  </h3>
                  <p className="text-[11px] text-gray-400 font-light">
                    {meta.sub}
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                {items.map((a, idx) => {
                  const isSelected = selectedSet.has(a.id);
                  const recommended = (a as any).recommended === true;
                  return (
                    <motion.div
                      key={a.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.03 }}
                      onClick={() => toggle(a.id)}
                      className={cn(
                        "relative rounded-xl border p-3 cursor-pointer transition-all",
                        isSelected
                          ? "border-[#00A859] bg-[#00A859]/5 ring-1 ring-[#00A859]/30"
                          : "border-gray-200 bg-white hover:border-gray-300",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={cn(
                            "w-5 h-5 rounded-md border flex items-center justify-center mt-0.5 flex-shrink-0 transition-colors",
                            isSelected
                              ? "bg-[#00A859] border-[#00A859]"
                              : "border-gray-300 bg-white",
                          )}
                        >
                          {isSelected && (
                            <Check className="w-3 h-3 text-white" strokeWidth={3} />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-sm font-medium text-gray-900 truncate">
                                {a.name}
                              </span>
                              {recommended && (
                                <Badge className="bg-[#00A859]/10 text-[#00A859] border-0 text-[10px] px-1.5">
                                  Recommended
                                </Badge>
                              )}
                            </div>
                            <span className="text-sm font-medium text-gray-900 whitespace-nowrap">
                              +{a.currency} {Number(a.price).toFixed(0)}
                              <span className="text-[11px] text-gray-400 font-light">
                                {" "}
                                /mo
                              </span>
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 font-light leading-snug mt-0.5">
                            {(a as any).short_pitch || a.description}
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Sticky total */}
      <div className="sticky bottom-0 -mx-6 px-6 py-4 bg-white/90 backdrop-blur border-t border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-gray-400 font-medium">
              {selectedAddonIds.length} module
              {selectedAddonIds.length === 1 ? "" : "s"} selected
            </p>
            <p className="text-xs text-gray-500 font-light">
              Starter Core{" "}
              {basePlanPrice > 0 && (
                <>· base {renderPrice(basePlanPrice * displayMultiplier)}</>
              )}
            </p>
          </div>
          <div className="text-right">
            <div className="text-lg font-medium text-gray-900">
              {renderPrice(totalDisplay)}
              <span className="text-xs text-gray-500 font-light ml-1">
                /{billingInterval === "annual" ? "yr" : "mo"}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <button
            type="button"
            onClick={onContinue}
            className="flex-1 py-3 rounded-xl text-sm font-medium bg-[#00A859] text-white hover:bg-[#008a4a] shadow-lg shadow-[#00A859]/25 transition-all flex items-center justify-center gap-2"
          >
            Continue
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
