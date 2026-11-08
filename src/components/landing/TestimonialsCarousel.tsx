import { motion } from "framer-motion";
import { useState } from "react";
import { Quote } from "lucide-react";
import { useLandingContent } from "@/hooks/useLandingContent";
import { Skeleton } from "@/components/ui/skeleton";
import { useRevealInView } from "@/hooks/useRevealInView";
import { useTranslation } from "react-i18next";
import { useLocaleText } from "@/hooks/useLocaleText";

export const TestimonialsCarousel = () => {
  const { ref, isRevealed } = useRevealInView<HTMLElement>({ margin: "-100px" });
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const { testimonials, isLoading } = useLandingContent();
  const { t } = useTranslation();
  const tt = useLocaleText();

  // Filter only active testimonials
  const activeTestimonials = testimonials.filter(t => t.is_active);

  // Duplicate testimonials for infinite scroll effect
  const duplicatedTestimonials = [...activeTestimonials, ...activeTestimonials];

  return (
    <section ref={ref} className="py-12 sm:py-16 lg:py-28 bg-white border-t border-gray-200 overflow-hidden">
      <div className="max-w-7xl mx-auto px-6 lg:px-8 mb-14">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isRevealed ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.8 }}
          className="text-center"
        >
          <p className="text-xs font-medium text-[#00713A] uppercase tracking-[0.08em] mb-4">
            {t("landing.testimonials.eyebrow")}
          </p>
          <h2 className="text-3xl md:text-4xl lg:text-[40px] font-semibold tracking-[-0.01em] text-gray-900 mb-4 leading-[1.1]">
            {t("landing.testimonials.headlinePrefix")}{" "}
            <span className="text-gray-500">{t("landing.testimonials.headlineBold")}</span>
          </h2>
          <p className="text-base text-gray-600 max-w-2xl mx-auto leading-[1.55]">
            {t("landing.testimonials.subtitle")}
          </p>
        </motion.div>
      </div>

      {/* Infinite Scroll Carousel */}
      <div className="relative">
        {isLoading ? (
          <div className="flex gap-6 px-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex-shrink-0 w-[400px]">
                <div className="h-full p-8 rounded-2xl bg-white/60 backdrop-blur-xl border border-white/50 shadow-lg">
                  <Skeleton className="w-8 h-8 mb-4" />
                  <Skeleton className="h-24 w-full mb-6" />
                  <div className="flex items-center gap-4">
                    <Skeleton className="w-12 h-12 rounded-full" />
                    <div>
                      <Skeleton className="h-4 w-24 mb-1" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : activeTestimonials.length > 0 ? (
          <motion.div
            animate={{
              x: [0, -50 * activeTestimonials.length * 24],
            }}
            transition={{
              x: {
                repeat: Infinity,
                repeatType: "loop",
                duration: 40,
                ease: "linear",
              },
            }}
            className="flex gap-6"
          >
            {duplicatedTestimonials.map((testimonial, index) => (
              <motion.div
                key={`${testimonial.id}-${index}`}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
                animate={{
                  scale: hoveredIndex === index ? 1.05 : 1,
                }}
                transition={{ duration: 0.3 }}
                className="flex-shrink-0 w-[400px]"
              >
                <div className="h-full p-7 rounded-lg bg-white border border-gray-200">
                  <Quote className="w-5 h-5 text-gray-300 mb-4" />
                  
                  <p className="text-gray-700 leading-[1.55] mb-6 text-base">
                    "{tt(`landing.testimonials.items.${testimonial.id}.quote`, testimonial.quote)}"
                  </p>

                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center text-sm font-semibold tracking-[-0.01em] text-gray-700">
                      {testimonial.author_name?.[0] || "·"}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 tracking-[-0.005em]">
                        {tt(`landing.testimonials.items.${testimonial.id}.author_name`, testimonial.author_name)}
                      </p>
                      <p className="text-xs text-gray-500">
                        {tt(`landing.testimonials.items.${testimonial.id}.author_role`, testimonial.author_role)} · {tt(`landing.testimonials.items.${testimonial.id}.restaurant_name`, testimonial.restaurant_name)}
                      </p>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        ) : (
          <div className="text-center py-12 text-gray-500">
            {t("landing.testimonials.empty")}
          </div>
        )}

        {/* Edge fades */}
        <div className="absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-[#07100C] to-transparent pointer-events-none" />
        <div className="absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-[#07100C] to-transparent pointer-events-none" />
      </div>
    </section>
  );
};
