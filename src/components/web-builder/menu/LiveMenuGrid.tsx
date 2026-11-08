import { useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { cn } from "@/lib/utils";
import { useLiveMenuItems, LiveMenuItem } from "@/hooks/useLiveMenuItems";
import { LiveMenuCard } from "./LiveMenuCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sun, Moon, RefreshCw, Sparkles } from "lucide-react";

interface LiveMenuGridProps {
  restaurantId?: string;
  selectedCategories?: string[];
  showPrices?: boolean;
  showImages?: boolean;
  menuType?: 'lunch' | 'dinner' | 'all';
}

const CATEGORY_LABELS: Record<string, string> = {
  main: 'Main Courses',
  appetizer: 'Appetizers',
  dessert: 'Desserts',
  beverage: 'Beverages',
  side: 'Sides',
  starter: 'Starters',
  salad: 'Salads',
  soup: 'Soups',
};

export function LiveMenuGrid({
  restaurantId,
  selectedCategories,
  showPrices = true,
  showImages = true,
  menuType = 'all',
}: LiveMenuGridProps) {
  const { activeItems, categories, chefsSpecials, isLoading, refetch } = useLiveMenuItems(restaurantId);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [currentMenuType, setCurrentMenuType] = useState<'lunch' | 'dinner'>(menuType === 'all' ? 'lunch' : menuType);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filter items based on selected categories from config
  const availableCategories = useMemo(() => {
    if (!selectedCategories || selectedCategories.length === 0) {
      return categories;
    }
    return categories.filter(cat => selectedCategories.includes(cat));
  }, [categories, selectedCategories]);

  // Filter items
  const filteredItems = useMemo(() => {
    let items = activeItems;
    
    // Filter by selected categories from config
    if (selectedCategories && selectedCategories.length > 0) {
      items = items.filter(item => selectedCategories.includes(item.category));
    }
    
    // Filter by active category tab
    if (activeCategory !== 'all') {
      items = items.filter(item => item.category === activeCategory);
    }
    
    return items;
  }, [activeItems, selectedCategories, activeCategory]);

  // Handle menu type toggle with cross-fade
  const handleMenuTypeChange = useCallback((type: 'lunch' | 'dinner') => {
    setCurrentMenuType(type);
    // In a real implementation, this would filter menu items by time-based availability
  }, []);

  // Manual refresh
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await refetch();
    setTimeout(() => setIsRefreshing(false), 1000);
  }, [refetch]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        {/* Skeleton header */}
        <div className="flex items-center justify-between">
          <div className="h-10 w-48 bg-muted animate-pulse rounded-lg" />
          <div className="h-8 w-32 bg-muted animate-pulse rounded-full" />
        </div>
        
        {/* Skeleton grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div 
              key={i} 
              className="aspect-[3/4] bg-muted animate-pulse rounded-2xl"
              style={{ animationDelay: `${i * 100}ms` }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with live indicator and menu toggle */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {/* Live sync indicator */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-primary/30 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              Live Menu
            </span>
          </div>

          {/* Refresh button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="gap-2"
          >
            <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
          </Button>
        </div>

        {/* Lunch/Dinner toggle */}
        {menuType === 'all' && (
          <div className="flex items-center gap-1 p-1 rounded-full bg-muted/50 backdrop-blur">
            <Button
              variant={currentMenuType === 'lunch' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => handleMenuTypeChange('lunch')}
              className="gap-2 rounded-full"
            >
              <Sun className="h-4 w-4" />
              Lunch
            </Button>
            <Button
              variant={currentMenuType === 'dinner' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => handleMenuTypeChange('dinner')}
              className="gap-2 rounded-full"
            >
              <Moon className="h-4 w-4" />
              Dinner
            </Button>
          </div>
        )}
      </div>

      {/* Chef's Specials highlight */}
      {chefsSpecials.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 p-4 rounded-xl bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-950/30 dark:to-yellow-950/30 border border-amber-200/50"
        >
          <Sparkles className="h-5 w-5 text-amber-500" />
          <span className="text-sm font-medium text-amber-900 dark:text-amber-100">
            {chefsSpecials.length} Chef's Special{chefsSpecials.length > 1 ? 's' : ''} Today
          </span>
          <div className="flex-1" />
          <div className="flex gap-1">
            {chefsSpecials.slice(0, 3).map((item) => (
              <Badge key={item.id} variant="secondary" className="text-xs bg-amber-100 text-amber-800">
                {item.name}
              </Badge>
            ))}
            {chefsSpecials.length > 3 && (
              <Badge variant="secondary" className="text-xs">
                +{chefsSpecials.length - 3}
              </Badge>
            )}
          </div>
        </motion.div>
      )}

      {/* Category filter tabs */}
      {availableCategories.length > 1 && (
        <Tabs value={activeCategory} onValueChange={setActiveCategory}>
          <TabsList className="w-full justify-start flex-wrap h-auto gap-1 bg-transparent p-0">
            <TabsTrigger 
              value="all" 
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-full"
            >
              All
            </TabsTrigger>
            {availableCategories.map((category) => (
              <TabsTrigger
                key={category}
                value={category}
                className="capitalize data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-full"
              >
                {CATEGORY_LABELS[category] || category}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {/* Menu grid with Framer Motion layout */}
      <LayoutGroup>
        <motion.div
          layout
          className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
        >
          <AnimatePresence mode="popLayout">
            {filteredItems.map((item) => (
              <LiveMenuCard
                key={item.id}
                item={item}
                showPrices={showPrices}
                showImages={showImages}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      </LayoutGroup>

      {/* Empty state */}
      {filteredItems.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-12"
        >
          <span className="text-6xl mb-4 block">🍽️</span>
          <p className="text-muted-foreground">Awaiting menu configuration</p>
        </motion.div>
      )}

      {/* JSON-LD Schema will be generated by parent component */}
    </div>
  );
}
