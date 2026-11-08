import { useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { LiveMenuGrid } from "./LiveMenuGrid";
import { MenuSchemaMarkup } from "./MenuSchemaMarkup";
import { useLiveMenuItems } from "@/hooks/useLiveMenuItems";
import { useAuth } from "@/contexts/AuthContext";
import { BlockContent } from "@/hooks/usePageBlocks";
import { Button } from "@/components/ui/button";
import { Sun, Moon } from "lucide-react";

interface LiveMenuBlockPreviewProps {
  content: BlockContent;
  restaurantName?: string;
}

export function LiveMenuBlockPreview({
  content,
  restaurantName = "Our Restaurant",
}: LiveMenuBlockPreviewProps) {
  const { restaurant } = useAuth();
  const { activeItems } = useLiveMenuItems(restaurant?.id);
  const [menuType, setMenuType] = useState<'lunch' | 'dinner'>(
    content.menu_type === 'all' ? 'lunch' : (content.menu_type || 'lunch')
  );

  // Toggle animation state
  const [isTransitioning, setIsTransitioning] = useState(false);

  const handleMenuTypeChange = useCallback((type: 'lunch' | 'dinner') => {
    if (type === menuType) return;
    
    setIsTransitioning(true);
    setTimeout(() => {
      setMenuType(type);
      setIsTransitioning(false);
    }, 250); // Half of the cross-fade duration
  }, [menuType]);

  // Filter items based on block config
  const filteredItems = useMemo(() => {
    if (!content.categories || content.categories.length === 0) {
      return activeItems;
    }
    return activeItems.filter(item => content.categories!.includes(item.category));
  }, [activeItems, content.categories]);

  return (
    <div className="relative">
      {/* Schema markup for SEO */}
      <MenuSchemaMarkup
        restaurantName={restaurantName}
        menuItems={filteredItems}
        currency={restaurant?.currency || "USD"}
      />

      {/* Menu type toggle (if enabled) */}
      {content.menu_type === 'all' && (
        <div className="flex justify-center mb-6">
          <div className="flex items-center gap-1 p-1 rounded-full bg-muted/50 backdrop-blur shadow-inner">
            <Button
              variant={menuType === 'lunch' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => handleMenuTypeChange('lunch')}
              className="gap-2 rounded-full transition-all duration-300"
            >
              <Sun className="h-4 w-4" />
              Lunch Menu
            </Button>
            <Button
              variant={menuType === 'dinner' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => handleMenuTypeChange('dinner')}
              className="gap-2 rounded-full transition-all duration-300"
            >
              <Moon className="h-4 w-4" />
              Dinner Menu
            </Button>
          </div>
        </div>
      )}

      {/* Cross-fade transition wrapper */}
      <AnimatePresence mode="wait">
        <motion.div
          key={menuType}
          initial={{ opacity: 0 }}
          animate={{ opacity: isTransitioning ? 0.5 : 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: "easeInOut" }}
        >
          <LiveMenuGrid
            restaurantId={restaurant?.id}
            selectedCategories={content.categories}
            showPrices={content.show_prices !== false}
            showImages={content.show_images !== false}
            menuType={content.menu_type}
          />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
