import { motion } from "framer-motion";
import {
  Coffee,
  Truck,
  Zap,
  UtensilsCrossed,
  Cookie,
  Cloud,
  Store,
  LucideIcon,
} from "lucide-react";
import { useRevealInView } from "@/hooks/useRevealInView";
import { useLocaleText } from "@/hooks/useLocaleText";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

interface VenueType {
  icon: LucideIcon;
  /** Matching solution page under /solutions. */
  slug: string;
  titleKey: string;
  titleDefault: string;
  bodyKey: string;
  bodyDefault: string;
}

const venueTypes: VenueType[] = [
  {
    icon: Coffee,
    slug: "coffee-shops",
    titleKey: "landing.venueTypes.items.coffee.title",
    titleDefault: "Coffee Shops & Cafés",
    bodyKey: "landing.venueTypes.items.coffee.body",
    bodyDefault: "From espresso bars to full-service cafés. Track every bean, pastry, and pour with speed-checkout and real-time COGS.",
  },
  {
    icon: Truck,
    slug: "food-trucks",
    titleKey: "landing.venueTypes.items.foodTruck.title",
    titleDefault: "Food Trucks & Mobile Kitchens",
    bodyKey: "landing.venueTypes.items.foodTruck.body",
    bodyDefault: "Operate on the move with offline-first POS, simplified inventory, and shift control that works anywhere.",
  },
  {
    icon: Zap,
    slug: "quick-service",
    titleKey: "landing.venueTypes.items.qsr.title",
    titleDefault: "Quick-Service Restaurants",
    bodyKey: "landing.venueTypes.items.qsr.body",
    bodyDefault: "High-volume counters need high-speed accuracy. Handle rush-hour throughput with automated inventory depletion and live profit tracking.",
  },
  {
    icon: UtensilsCrossed,
    slug: "full-service",
    titleKey: "landing.venueTypes.items.fsr.title",
    titleDefault: "Full-Service Restaurants",
    bodyKey: "landing.venueTypes.items.fsr.body",
    bodyDefault: "Table service, kitchen coordination, and full accounting in one system. From reservations to payroll, every detail covered.",
  },
  {
    icon: Cookie,
    slug: "bakeries",
    titleKey: "landing.venueTypes.items.bakery.title",
    titleDefault: "Bakeries & Pastry Shops",
    bodyKey: "landing.venueTypes.items.bakery.body",
    bodyDefault: "Track ingredient batches, production runs, and per-item margins. Know exactly what each croissant costs to make.",
  },
  {
    icon: Cloud,
    slug: "cloud-kitchens",
    titleKey: "landing.venueTypes.items.cloudKitchen.title",
    titleDefault: "Cloud & Ghost Kitchens",
    bodyKey: "landing.venueTypes.items.cloudKitchen.body",
    bodyDefault: "Delivery-only operations need pure efficiency. Multi-brand inventory, aggregator sync, and cost clarity without the front-of-house noise.",
  },
];

export const VenueTypesSection = () => {
  const { ref, isRevealed } = useRevealInView<HTMLElement>({ margin: "-100px" });
  const tt = useLocaleText();

  return (
    <section ref={ref} className="py-12 sm:py-16 lg:py-24 bg-white scroll-mt-24">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={isRevealed ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-8 sm:mb-12 lg:mb-16"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-gray-200 bg-white mb-6">
            <Store className="w-3.5 h-3.5 text-gray-600" strokeWidth={1.5} />
            <span className="text-xs font-medium text-gray-600 uppercase tracking-wider">
              {tt("landing.venueTypes.eyebrow", "Built for Every Concept")}
            </span>
          </div>
          <h2 className="text-3xl md:text-4xl font-light tracking-[-0.02em] text-gray-900 mb-5 leading-[1.1]">
            {tt("landing.venueTypes.title", "One platform.")}{" "}
            <span className="text-gray-500">
              {tt("landing.venueTypes.titleBold", "Any kitchen.")}
            </span>
          </h2>
          <p className="text-lg text-gray-600 font-light leading-relaxed max-w-2xl mx-auto">
            {tt(
              "landing.venueTypes.lead",
              "Whether you run a single espresso cart or a multi-brand cloud kitchen, Matbex adapts to how you work."
            )}
          </p>
        </motion.div>

        {/* Venue Cards */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {venueTypes.map(({ icon: Icon, slug, titleKey, titleDefault, bodyKey, bodyDefault }, i) => (
            <motion.div
              key={titleKey}
              initial={{ opacity: 0, y: 24 }}
              animate={isRevealed ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
              transition={{ duration: 0.5, delay: 0.1 + i * 0.05 }}
              className={`bg-white rounded-2xl p-6 border border-gray-200 hover:border-gray-300 transition-colors ${i >= 2 ? "hidden sm:block" : ""}`}
            >
              <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center mb-5">
                <Icon className="w-4 h-4 text-gray-700" strokeWidth={1.5} />
              </div>
              <h3 className="text-base font-medium text-gray-900 mb-2">
                {tt(titleKey, titleDefault)}
              </h3>
              <p className="text-sm text-gray-600 font-light leading-relaxed">
                {tt(bodyKey, bodyDefault)}
              </p>
              <Link
                to={`/solutions/${slug}`}
                className="mt-4 inline-flex items-center gap-1.5 min-h-11 text-sm font-medium text-[#00A859] hover:text-[#00A859]/80 transition-colors"
              >
                {tt("landing.venueTypes.cardCta", "See how it works")}
                <ArrowRight className="w-4 h-4" />
              </Link>
            </motion.div>
          ))}
        </div>

        <div className="mt-8 text-center">
          <Link
            to="/solutions"
            className="inline-flex items-center gap-2 min-h-11 px-5 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:border-gray-300 hover:text-gray-900 transition-colors"
          >
            {tt("landing.venueTypes.allCta", "Browse all solutions")}
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </section>
  );
};
