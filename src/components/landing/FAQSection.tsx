import { motion } from "framer-motion";
import { useState } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLandingContent } from "@/hooks/useLandingContent";
import { Skeleton } from "@/components/ui/skeleton";
import { useRevealInView } from "@/hooks/useRevealInView";
import { useLocaleText } from "@/hooks/useLocaleText";

export const FAQSection = () => {
  const { t } = useTranslation();
  const tt = useLocaleText();
  const { ref, isRevealed } = useRevealInView<HTMLElement>({ margin: "-100px" });
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const { faq, isLoading } = useLandingContent();

  // Filter only active FAQs
  const activeFAQs = faq.filter(f => f.is_active);

  return (
    <section id="faq" ref={ref} className="py-12 sm:py-16 lg:py-24 bg-white">
      <div className="max-w-3xl mx-auto px-6 lg:px-8">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isRevealed ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.8 }}
          className="text-center mb-12"
        >
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-4">
            {t("landing.faq.title")}
          </p>
          <h2 className="text-3xl md:text-4xl font-light tracking-[-0.02em] text-gray-900 mb-4">
            {t("landing.faqSection.title")}{" "}
            <span className="font-medium">{t("landing.faqSection.titleBold")}</span>
          </h2>
          <p className="text-base text-gray-600 font-light">
            {t("landing.faqSection.subtitle")}
          </p>
        </motion.div>

        {/* FAQ Accordion */}
        <div className="space-y-3">
          {isLoading ? (
            [1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-200 p-6">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="w-8 h-8 rounded-full" />
                </div>
              </div>
            ))
          ) : (
            activeFAQs.map((faqItem, index) => (
              <motion.div
                key={faqItem.id}
                initial={{ opacity: 0, y: 20 }}
                animate={isRevealed ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
                transition={{ duration: 0.6, delay: index * 0.1 }}
                className="bg-white rounded-xl border border-gray-200 overflow-hidden"
              >
                <button
                  onClick={() => setOpenIndex(openIndex === index ? null : index)}
                  className="w-full flex items-center justify-between px-6 py-5 text-left rtl:text-right"
                >
                  <span className="text-base font-medium text-gray-900 ltr:pr-8 rtl:pl-8">
                    {tt(`landing.faq.items.${faqItem.sort_order}.question`, faqItem.question)}
                  </span>
                  <motion.div
                    animate={{ rotate: openIndex === index ? 45 : 0 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="flex-shrink-0 w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center"
                  >
                    <Plus className="w-3.5 h-3.5 text-gray-600" strokeWidth={1.5} />
                  </motion.div>
                </button>
                
                <motion.div
                  initial={false}
                  animate={{
                    height: openIndex === index ? "auto" : 0,
                    opacity: openIndex === index ? 1 : 0,
                  }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                  className="overflow-hidden"
                >
                  <p className="px-6 pb-5 text-sm text-gray-600 font-light leading-relaxed">
                    {tt(`landing.faq.items.${faqItem.sort_order}.answer`, faqItem.answer)}
                  </p>
                </motion.div>
              </motion.div>
            ))
          )}
        </div>
      </div>
    </section>
  );
};
