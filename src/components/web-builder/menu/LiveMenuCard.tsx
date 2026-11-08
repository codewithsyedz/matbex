import { useState, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { LiveMenuItem } from "@/hooks/useLiveMenuItems";
import { useCurrency } from "@/hooks/useCurrency";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Leaf, AlertTriangle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";

interface LiveMenuCardProps {
  item: LiveMenuItem;
  showPrices?: boolean;
  showImages?: boolean;
}

export const LiveMenuCard = memo(function LiveMenuCard({
  item,
  showPrices = true,
  showImages = true,
}: LiveMenuCardProps) {
  const { format: formatCurrency } = useCurrency();
  const [imageLoaded, setImageLoaded] = useState(false);
  const [showNutrition, setShowNutrition] = useState(false);

  const isSoldOut = !item.is_available;
  const isMarketPrice = item.is_market_price;
  const isChefsSpecial = item.is_chefs_special;

  // Get the primary price
  const primaryPrice = item.selling_price || item.full_price || item.half_price || item.quarter_price;

  // Dietary tags icons
  const dietaryIcons: Record<string, React.ReactNode> = {
    vegetarian: <Leaf className="h-3 w-3 text-green-600" />,
    vegan: <Leaf className="h-3 w-3 text-green-700" />,
    'gluten-free': <span className="text-[10px] font-bold text-amber-600">GF</span>,
    halal: <span className="text-[10px] font-bold text-emerald-600">HL</span>,
    spicy: <span className="text-[10px]">🌶️</span>,
  };

  return (
    <TooltipProvider>
      <motion.div
        layout
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ 
          opacity: isSoldOut ? 0.6 : 1, 
          scale: 1,
        }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
        className={cn(
          "group relative overflow-hidden rounded-2xl",
          // Glassmorphism effect
          "bg-white/70 dark:bg-black/30",
          "backdrop-blur-xl",
          "border border-white/80 dark:border-white/20",
          "shadow-lg shadow-black/5",
          // Hover effect
          "transition-all duration-300",
          "hover:shadow-xl hover:shadow-black/10",
          "hover:-translate-y-1",
          isSoldOut && "grayscale-[30%]"
        )}
        style={{ borderRadius: '16px' }}
      >
        {/* Chef's Special shimmer border effect */}
        {isChefsSpecial && !isSoldOut && (
          <motion.div
            className="absolute inset-0 rounded-2xl pointer-events-none z-10"
            style={{
              background: 'linear-gradient(90deg, transparent, rgba(255, 215, 0, 0.3), transparent)',
              backgroundSize: '200% 100%',
            }}
            animate={{
              backgroundPosition: ['200% 0', '-200% 0'],
            }}
            transition={{
              duration: 3,
              repeat: Infinity,
              ease: 'linear',
            }}
          />
        )}

        {/* Image section */}
        {showImages && (
          <div className="relative aspect-square overflow-hidden bg-muted/30">
            {/* Blur-up placeholder */}
            {item.image_url && !imageLoaded && (
              <div 
                className="absolute inset-0 bg-muted animate-pulse"
                style={{
                  backgroundImage: item.image_url ? `url(${item.image_url}?w=10&blur=10)` : undefined,
                  backgroundSize: 'cover',
                  filter: 'blur(20px)',
                }}
              />
            )}
            
            {item.image_url ? (
              <motion.img
                src={item.image_url}
                alt={item.name}
                className={cn(
                  "w-full h-full object-cover transition-all duration-500",
                  imageLoaded ? "opacity-100" : "opacity-0"
                )}
                onLoad={() => setImageLoaded(true)}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted/50 to-muted">
                <span className="text-4xl opacity-30">🍽️</span>
              </div>
            )}

            {/* Sold out overlay with Lottie animation */}
            <AnimatePresence>
              {isSoldOut && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 flex items-center justify-center bg-black/20"
                >
                  <div className="relative">
                    <motion.div
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
                      className="w-36 h-1 bg-destructive rounded-full origin-left -rotate-12"
                    />
                    <Badge 
                      variant="destructive" 
                      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-xs font-semibold"
                    >
                      Sold Out
                    </Badge>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Chef's Special badge with sparkle */}
            {isChefsSpecial && !isSoldOut && (
              <div className="absolute top-2 left-2">
                <Badge className="gap-1 bg-gradient-to-r from-amber-500 to-yellow-500 text-white border-0 shadow-lg">
                  <Sparkles className="w-3.5 h-3.5 animate-pulse" />
                  Chef's Special
                </Badge>
              </div>
            )}

            {/* Dietary tags */}
            {item.dietary_tags && item.dietary_tags.length > 0 && (
              <div className="absolute top-2 right-2 flex gap-1">
                {item.dietary_tags.slice(0, 3).map((tag) => (
                  <Tooltip key={tag}>
                    <TooltipTrigger asChild>
                      <div className="w-6 h-6 rounded-full bg-white/90 backdrop-blur flex items-center justify-center shadow-sm">
                        {dietaryIcons[tag.toLowerCase()] || (
                          <span className="text-[8px] uppercase">{tag.slice(0, 2)}</span>
                        )}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <span className="capitalize">{tag}</span>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Content section */}
        <div className="p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <h3 className={cn(
              "font-semibold text-foreground line-clamp-2",
              isSoldOut && "line-through opacity-70"
            )}>
              {item.name}
            </h3>
            
            {/* Allergen warning */}
            {item.allergens && item.allergens.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="shrink-0">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">Contains: {item.allergens.join(', ')}</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          {item.description && (
            <p className="text-xs text-muted-foreground line-clamp-2">
              {item.description}
            </p>
          )}

          {/* Pricing */}
          {showPrices && (
            <div className="flex items-center gap-2 pt-1">
              <motion.span
                className={cn(
                  "font-semibold text-lg",
                  isMarketPrice && !isSoldOut 
                    ? "text-emerald-600 dark:text-emerald-400" 
                    : "text-foreground"
                )}
                animate={isMarketPrice && !isSoldOut ? {
                  opacity: [1, 0.7, 1],
                } : {}}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              >
                {formatCurrency(primaryPrice)}
              </motion.span>
              
              {isMarketPrice && !isSoldOut && (
                <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-300">
                  Market Price
                </Badge>
              )}
            </div>
          )}

          {/* Nutritional info tooltip on hover (desktop) */}
          {item.nutritional_info && Object.keys(item.nutritional_info).length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
              <button
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
                  onMouseEnter={() => setShowNutrition(true)}
                  onMouseLeave={() => setShowNutrition(false)}
                >
                  Nutritional details
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {Object.entries(item.nutritional_info).map(([key, value]) => (
                    <div key={key} className="flex justify-between gap-2">
                      <span className="text-muted-foreground capitalize">{key}:</span>
                      <span className="font-medium">{String(value)}</span>
                    </div>
                  ))}
                </div>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </motion.div>
    </TooltipProvider>
  );
});
