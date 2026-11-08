import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Settings, TrendingUp, Download, ChevronDown } from "lucide-react";
import { useToolsStackContent } from "@/hooks/useToolsStackContent";
import { Skeleton } from "@/components/ui/skeleton";
import { useRevealInView } from "@/hooks/useRevealInView";

// Preview Components for each tool type
const RevenuePreview = () => (
  <div className="relative mt-6">
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="absolute -bottom-4 -left-4 bg-white rounded-2xl p-4 shadow-lg border border-gray-100"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
          <TrendingUp className="w-5 h-5 text-gray-700" strokeWidth={1.5} />
        </div>
        <div>
          <p className="text-xs text-gray-500">30%</p>
          <p className="text-[10px] text-gray-600">vs Yesterday</p>
        </div>
      </div>
    </motion.div>
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5 }}
      className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 ml-8"
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
          <Settings className="w-4 h-4 text-gray-600" />
        </div>
      </div>
      <p className="text-xs text-gray-500 mb-1">Daily Revenue</p>
      <p className="text-2xl font-light text-gray-900">﷼2,545.00</p>
    </motion.div>
  </div>
);

const InventoryPreview = () => (
  <div className="relative mt-6 space-y-3">
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.3 }}
      className="bg-white rounded-xl p-4 shadow-lg border border-gray-100"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-900">Open Purchase</span>
        <span className="px-2 py-0.5 bg-gray-900 text-white text-xs rounded-full">2</span>
      </div>
      <div className="flex items-center justify-between text-gray-600">
        <span className="text-sm">Sent Purchase</span>
        <span className="px-2 py-0.5 bg-gray-200 text-gray-500 text-xs rounded-full">2</span>
      </div>
      <div className="flex items-center justify-between text-gray-600 mt-1">
        <span className="text-sm">Receive</span>
      </div>
    </motion.div>
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5 }}
      className="bg-white rounded-xl p-4 shadow-lg border border-gray-100 flex items-center gap-3"
    >
      <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center text-2xl">
        🍅
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium text-gray-900">Tomato</p>
        <p className="text-xs text-gray-500 line-clamp-2">Perfectly ripe for rich sauces, vibrant salsas.</p>
      </div>
      <p className="text-sm font-medium text-gray-900">﷼5.00</p>
    </motion.div>
  </div>
);

const DashboardPreview = () => (
  <div className="relative mt-6 space-y-3">
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="flex gap-2"
    >
      <div className="flex-1 bg-white rounded-lg p-3 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">All Locations</span>
          <ChevronDown className="w-3 h-3 text-gray-400" />
        </div>
      </div>
      <div className="flex-1 bg-white rounded-lg p-3 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">All Order Types</span>
          <ChevronDown className="w-3 h-3 text-gray-400" />
        </div>
      </div>
    </motion.div>
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5 }}
      className="bg-white rounded-xl p-4 shadow-lg border border-gray-100"
    >
      <p className="text-sm font-medium text-gray-900 mb-2">Total Sales</p>
      <p className="text-xs text-gray-500 mb-4">Track your daily, weekly, and monthly sales performance at a glance.</p>
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.7 }}
        className="flex items-center gap-2 bg-gray-900 text-white px-4 py-2 rounded-lg w-fit ml-auto"
      >
        <Download className="w-4 h-4" />
        <span className="text-sm">Export to CSV</span>
      </motion.div>
    </motion.div>
  </div>
);

const POSPreview = () => (
  <div className="relative mt-6">
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.3 }}
      className="bg-white rounded-2xl p-5 shadow-lg border border-gray-100"
    >
      <div className="grid grid-cols-3 gap-2 mb-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="aspect-square bg-gray-50 rounded-lg" />
        ))}
      </div>
      <div className="flex items-center justify-between pt-3 border-t border-gray-100">
        <span className="text-sm text-gray-500">Total</span>
        <span className="text-lg font-medium text-gray-900">﷼127.50</span>
      </div>
    </motion.div>
  </div>
);

const getPreviewComponent = (type: string) => {
  switch (type) {
    case "revenue":
    case "pos":
      return <RevenuePreview />;
    case "inventory":
      return <InventoryPreview />;
    case "dashboard":
    case "reports":
      return <DashboardPreview />;
    default:
      return <POSPreview />;
  }
};

export const ToolsStackSection = () => {
  const { ref, isRevealed } = useRevealInView<HTMLElement>({ margin: "-100px" });
  const { settings, categories, items, isLoading } = useToolsStackContent();
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  // Set default active category when data loads
  const activeCategories = categories.filter(c => c.is_active);
  const selectedCategory = activeCategory || activeCategories[0]?.id;
  const categoryItems = items.filter(i => i.category_id === selectedCategory && i.is_active);

  // Don't render if loading
  if (isLoading) {
    return (
      <section className="py-12 sm:py-16 lg:py-28 bg-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <Skeleton className="h-8 w-40 mx-auto mb-6" />
            <Skeleton className="h-12 w-96 mx-auto" />
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-96 rounded-3xl" />
            ))}
          </div>
        </div>
      </section>
    );
  }

  // Don't render if settings is missing or inactive, or no categories
  if (!settings?.is_active || activeCategories.length === 0) return null;

  return (
    <section ref={ref} className="py-12 sm:py-16 lg:py-24 bg-white overflow-hidden">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isRevealed ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-6 sm:mb-10 lg:mb-12"
        >
          {/* Eyebrow Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-gray-200 bg-white mb-6">
            <Settings className="w-3.5 h-3.5 text-gray-600" strokeWidth={1.5} />
            <span className="text-xs font-medium text-gray-600 uppercase tracking-wider">
              {settings.eyebrow}
            </span>
          </div>

          {/* Headline with inline icon */}
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-light tracking-[-0.02em] text-gray-900 leading-[1.1] max-w-4xl mx-auto">
            {settings.headline.split("kitchen").map((part, i) => (
              <span key={i}>
                {part}
                {i === 0 && (
                  <>
                    <span className="inline-flex items-center justify-center w-10 h-10 md:w-12 md:h-12 bg-gray-100 rounded-lg mx-2 align-middle">
                      <span className="text-xl md:text-2xl">🍳</span>
                    </span>
                    kitchen
                  </>
                )}
              </span>
            ))}
          </h2>
        </motion.div>

        {/* Category Tabs */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isRevealed ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="flex flex-wrap justify-center gap-2 mb-6 sm:mb-10 lg:mb-12"
        >
          {activeCategories.map((category) => (
            <button
              key={category.id}
              onClick={() => setActiveCategory(category.id)}
              className={`px-5 py-2.5 rounded-full text-sm font-medium transition-all duration-200 ${
                selectedCategory === category.id
                  ? "bg-gray-900 text-white shadow-lg"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {category.name}
            </button>
          ))}
        </motion.div>

        {/* Feature Cards */}
        <AnimatePresence mode="wait">
          <motion.div
            key={selectedCategory}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4 }}
            className="grid md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {categoryItems.map((item, index) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 30 }}
                animate={isRevealed ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                className={`bg-gray-50 rounded-2xl p-6 lg:p-8 border border-gray-200 hover:border-gray-300 transition-colors duration-200 ${index >= 3 ? "hidden md:block" : ""}`}
              >
                {/* Number + Title */}
                <div className="flex items-start gap-4 mb-4">
                  <span className="text-2xl font-light text-gray-300">{item.number}</span>
                  <h3 className="text-xl lg:text-2xl font-medium text-gray-900 leading-tight">
                    {item.title}
                  </h3>
                </div>

                {/* Description */}
                <p className="text-gray-600 font-light leading-relaxed mb-4 pl-10">
                  {item.description}
                </p>

                {/* Preview Mockup */}
                <div className="pl-10">
                  {getPreviewComponent(item.preview_type)}
                </div>
              </motion.div>
            ))}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
};
