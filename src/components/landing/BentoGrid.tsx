import { memo, useState } from "react";
import { motion } from "framer-motion";
import { 
  Scale, 
  Calendar, 
  BarChart2, 
  BookOpen, 
  Mail, 
  Shield, 
  Zap, 
  Globe, 
  Clock,
  LucideIcon
} from "lucide-react";
import { useLandingContent, LandingFeature } from "@/hooks/useLandingContent";
import { Skeleton } from "@/components/ui/skeleton";
import { useRevealInView } from "@/hooks/useRevealInView";
import { useTranslation } from "react-i18next";
import { useLocaleText } from "@/hooks/useLocaleText";

const iconMap: Record<string, LucideIcon> = {
  Scale,
  Calendar,
  BarChart2,
  BookOpen,
  Mail,
  Shield,
  Zap,
  Globe,
  Clock,
};

// Calm/Attio system: neutral cards with hairline borders.
// Color is reserved for the primary accent only.
const NEUTRAL_CARD = "bg-white border-gray-200";
const ICON_NEUTRAL = "text-gray-700";

const FeatureCard = memo(function FeatureCard({ 
  feature, 
  index,
  hiddenOnMobile = false,
}: { 
  feature: LandingFeature; 
  index: number;
  hiddenOnMobile?: boolean;
}) {
  const { ref, isRevealed } = useRevealInView<HTMLDivElement>({ margin: "-50px" });
  const { t } = useTranslation();
  const tt = useLocaleText();
  const isAccent = feature.color === "emerald" || feature.size === "large";
  const Icon = iconMap[feature.icon] || Scale;

  const sizeClasses = {
    large: "md:col-span-2 md:row-span-2",
    medium: "md:col-span-2",
    small: "",
  };

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 16 }}
      animate={isRevealed ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
      transition={{ duration: 0.5, delay: Math.min(index, 5) * 0.06, ease: [0.22, 1, 0.36, 1] }}
      className={`${sizeClasses[feature.size as keyof typeof sizeClasses] || ""} ${hiddenOnMobile ? "hidden md:block" : ""} group`}
    >
      <div
        className={`relative h-full overflow-hidden p-5 sm:p-6 lg:p-7 rounded-lg border ${NEUTRAL_CARD} transition-colors duration-200 hover:border-gray-300`}
      >
        {/* Accent tiles carry a single sliver of service light along the top edge */}
        {isAccent && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#00A859]/60 to-transparent"
          />
        )}

        {/* Icon */}
        <div
          className={`w-9 h-9 rounded-md border flex items-center justify-center mb-5 ${
            isAccent ? "border-[#00A859]/30 bg-[#00A859]/[0.08]" : "border-gray-200"
          }`}
        >
          <Icon className={`w-4 h-4 ${isAccent ? "text-[#00713A]" : ICON_NEUTRAL}`} strokeWidth={1.5} />
        </div>

        {/* Content */}
        <h3 className="text-base font-semibold tracking-[-0.01em] text-gray-900 mb-1.5">
          {tt(`landing.bento.features.${feature.sort_order}.title`, feature.title)}
        </h3>
        <p className="text-sm text-gray-600 leading-[1.55] max-w-[46ch]">
          {tt(`landing.bento.features.${feature.sort_order}.description`, feature.description)}
        </p>

        {/* Large card extra content */}
        {feature.size === "large" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={isRevealed ? { opacity: 1 } : { opacity: 0 }}
            transition={{ delay: 0.35 }}
            className="mt-7"
          >
            <div className="flex items-center gap-4">
              <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={isRevealed ? { width: "72%" } : { width: 0 }}
                  transition={{ duration: 1.1, delay: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  className="h-full bg-[#00A859] rounded-full"
                />
              </div>
              <span className="text-xs font-medium text-gray-900 tabular-nums">72%</span>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              {t("landing.bento.largeCardCaption")}
            </p>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
});


const FeatureCardSkeleton = ({ size }: { size: string }) => {
  const sizeClasses = {
    large: "md:col-span-2 md:row-span-2",
    medium: "md:col-span-2",
    small: "",
  };

  return (
    <div className={`${sizeClasses[size as keyof typeof sizeClasses] || ""}`}>
      <div className="h-full p-6 lg:p-8 rounded-2xl bg-gray-100 border border-gray-200">
        <Skeleton className="w-12 h-12 rounded-xl mb-4" />
        <Skeleton className="h-6 w-3/4 mb-2" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3 mt-1" />
      </div>
    </div>
  );
};

const MOBILE_VISIBLE_FEATURES = 3;

export const BentoGrid = () => {
  const { ref, isRevealed } = useRevealInView<HTMLDivElement>({ margin: "-100px" });
  const { features, isLoading } = useLandingContent();
  const { t } = useTranslation();
  const [showAllOnMobile, setShowAllOnMobile] = useState(false);

  // Filter only active features
  const activeFeatures = features.filter(f => f.is_active);
  const hiddenCount = Math.max(activeFeatures.length - MOBILE_VISIBLE_FEATURES, 0);

  return (
    <section id="features" className="py-12 sm:py-16 lg:py-28 bg-[#FAFAFA] border-t border-gray-200">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        {/* Section Header */}
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: 20 }}
          animate={isRevealed ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.8 }}
          className="max-w-2xl mb-8 sm:mb-12 lg:mb-14"
        >
          <p className="text-xs font-medium text-[#00713A] uppercase tracking-[0.08em] mb-4">
            {t("landing.bento.eyebrow")}
          </p>
          <h2 className="text-3xl md:text-4xl lg:text-[40px] font-semibold tracking-[-0.01em] text-gray-900 mb-4 leading-[1.1]">
            {t("landing.bento.headlinePrefix")}{" "}
            <span className="text-gray-500">{t("landing.bento.headlineBold")}</span>
          </h2>
          <p className="text-base text-gray-600 leading-[1.55]">
            {t("landing.bento.subtitle")}
          </p>
        </motion.div>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {isLoading ? (
            <>
              <FeatureCardSkeleton size="large" />
              <FeatureCardSkeleton size="small" />
              <FeatureCardSkeleton size="small" />
              <FeatureCardSkeleton size="medium" />
              <FeatureCardSkeleton size="small" />
              <FeatureCardSkeleton size="small" />
            </>
          ) : (
            activeFeatures.map((feature, index) => (
              <FeatureCard
                key={feature.id}
                feature={feature}
                index={index}
                hiddenOnMobile={!showAllOnMobile && index >= MOBILE_VISIBLE_FEATURES}
              />
            ))
          )}
        </div>

        {/* On phones the grid stays short; the rest is one tap away. */}
        {!isLoading && hiddenCount > 0 && !showAllOnMobile && (
          <div className="mt-6 md:hidden">
            <button
              type="button"
              onClick={() => setShowAllOnMobile(true)}
              className="w-full min-h-11 inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-900 transition-colors hover:border-gray-400"
            >
              {t("landing.bento.showAll", { count: hiddenCount, defaultValue: `Show ${hiddenCount} more capabilities` })}
            </button>
          </div>
        )}
      </div>
    </section>
  );
};

