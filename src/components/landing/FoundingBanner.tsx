import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Check, Sparkles, Flame } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useActivePromotion } from "@/hooks/useActivePromotion";
import { useRevealInView } from "@/hooks/useRevealInView";
import { useTranslation } from "react-i18next";

export const FoundingBanner = () => {
  const { data: promo, isLoading } = useActivePromotion();
  const { ref, isRevealed } = useRevealInView<HTMLDivElement>({ margin: "-100px" });
  const { i18n } = useTranslation();
  const isAr = i18n.language?.startsWith("ar");

  if (isLoading || !promo) return null;

  const remaining = Math.max(0, promo.max_slots - promo.claimed_slots);
  const progressPct = (promo.claimed_slots / promo.max_slots) * 100;
  const isExhausted = remaining === 0;

  const badgeLabel = (isAr && promo.badge_label_ar) || promo.badge_label;
  const headline = (isAr && promo.headline_ar) || promo.headline;
  const subheadline = (isAr && promo.subheadline_ar) || promo.subheadline;
  const perks = isAr && promo.perks_ar.length > 0 ? promo.perks_ar : promo.perks;

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 20 }}
      animate={isRevealed ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
      transition={{ duration: 0.6 }}
      className="lux-founding-banner mb-12 rounded-2xl overflow-hidden border border-[#00A859]/30 bg-gradient-to-br from-[#00A859]/[0.10] via-[#0E1B15] to-[#0E1B15] shadow-[0_8px_40px_-12px_rgba(0,168,89,0.25)]"
    >
      <div className="p-6 md:p-8 lg:p-10">
        <div className="grid lg:grid-cols-[1.4fr_1fr] gap-8 items-center">
          {/* Left: pitch */}
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#00A859] text-white text-[11px] font-semibold uppercase tracking-[0.1em] mb-4">
              <Flame className="w-3 h-3" />
              {badgeLabel}
            </div>
            <h3 className="text-[26px] md:text-[34px] lg:text-[40px] font-semibold tracking-[-0.02em] text-gray-900 mb-4 leading-[1.15]">
              {headline}
            </h3>
            {subheadline && (
              <p className="text-[15px] md:text-[17px] text-gray-600 leading-[1.65] mb-6 max-w-xl">
                {subheadline}
              </p>
            )}

            {perks.length > 0 && (
              <ul className="space-y-2.5 mb-7">
                {perks.map((perk, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-[15px] text-gray-700 leading-[1.6]">
                    <Check className="w-4 h-4 text-[#00713A] flex-shrink-0 mt-1" />
                    <span>{perk}</span>
                  </li>
                ))}
              </ul>
            )}

            <Button
              asChild
              disabled={isExhausted}
              className="h-11 px-6 rounded-md bg-[#007a3d] hover:bg-[#006b33] text-white text-sm font-medium shadow-none disabled:opacity-50"
            >
              <Link to={isExhausted ? "#" : "/register?promo=founding"}>
                <Sparkles className="w-4 h-4 mr-2" />
                {isExhausted ? "All slots claimed - join waitlist" : "Claim your founding spot"}
              </Link>
            </Button>
          </div>

          {/* Right: counter */}
          <div className="lux-founding-counter bg-white rounded-xl border border-gray-200 p-6 md:p-7">
            <p className="text-[11px] font-medium text-gray-500 uppercase tracking-[0.1em] mb-3">
              Limited spots
            </p>
            <div className="flex items-baseline gap-2 mb-4">
              <span className="text-5xl md:text-6xl font-light tracking-[-0.035em] text-gray-900 tabular-nums leading-none">
                {remaining}
              </span>
              <span className="text-base text-gray-500 leading-tight">
                / {promo.max_slots} left
              </span>
            </div>
            <Progress value={progressPct} className="h-1.5 mb-3 bg-gray-100" />
            <p className="text-[13px] text-gray-500 leading-[1.65]">
              <span className="text-[#00713A] font-semibold">{promo.claimed_slots}</span> restaurants
              already joined. {promo.discount_percent}% off year one
              {promo.locked_price_forever ? ", locked forever." : ", then 25% off for life."}
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
};