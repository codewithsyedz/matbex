import { motion } from "framer-motion";
import {
  Smartphone,
  Monitor,
  ShoppingBag,
  Truck,
  Bike,
  ListChecks,
} from "lucide-react";
import { useRevealInView } from "@/hooks/useRevealInView";
import { useTranslation } from "react-i18next";

export const OnlineOrderingSection = () => {
  const { ref, isRevealed } = useRevealInView<HTMLElement>({ margin: "-100px" });
  const { t } = useTranslation();

  const features = [
    { icon: Smartphone, key: "kiosk" },
    { icon: ShoppingBag, key: "storefront" },
    { icon: Monitor, key: "orderManager" },
    { icon: Truck, key: "tieredFees" },
    { icon: Bike, key: "riderCommission" },
    { icon: ListChecks, key: "settings" },
  ] as const;

  return (
    <section id="online-ordering" ref={ref} className="bg-gray-50 py-12 sm:py-16 lg:py-24 scroll-mt-24">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={isRevealed ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
          transition={{ duration: 0.6 }}
          className="max-w-2xl mb-8 sm:mb-12 lg:mb-16"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-gray-200 bg-white mb-6">
            <span className="text-xs font-medium text-gray-600 uppercase tracking-wider">
              {t("landing.onlineOrdering.eyebrow")}
            </span>
          </div>
          <h2 className="text-3xl md:text-4xl font-light tracking-[-0.02em] text-gray-900 mb-5 leading-[1.1]">
            {t("landing.onlineOrdering.title")}
          </h2>
          <p className="text-lg text-gray-600 font-light leading-relaxed">
            {t("landing.onlineOrdering.lead")}
          </p>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map(({ icon: Icon, key }, i) => (
            <motion.div
              key={key}
              initial={{ opacity: 0, y: 24 }}
              animate={isRevealed ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
              transition={{ duration: 0.5, delay: 0.1 + i * 0.05 }}
              className={`bg-white rounded-2xl p-6 border border-gray-200 hover:border-gray-300 transition-colors ${i >= 2 ? "hidden sm:block" : ""}`}
            >
              <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center mb-5">
                <Icon className="w-4 h-4 text-gray-700" strokeWidth={1.5} />
              </div>
              <h3 className="text-base font-medium text-gray-900 mb-2">
                {t(`landing.onlineOrdering.items.${key}.title`)}
              </h3>
              <p className="text-sm text-gray-600 font-light leading-relaxed">
                {t(`landing.onlineOrdering.items.${key}.body`)}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};