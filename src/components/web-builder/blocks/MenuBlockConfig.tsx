import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BlockContent } from "@/hooks/usePageBlocks";
import { useMenuItems } from "@/hooks/useMenuItems";
import { RefreshCw, Sun, Moon, Sparkles, Zap } from "lucide-react";

interface MenuBlockConfigProps {
  content: BlockContent;
  onUpdate: (key: keyof BlockContent, value: unknown) => void;
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

export function MenuBlockConfig({ content, onUpdate }: MenuBlockConfigProps) {
  const { categories, menuItems, isLoading } = useMenuItems();
  const selectedCategories = content.categories || [];
  const enableLiveSync = content.enable_live_sync !== false;
  const menuType = content.menu_type || 'all';

  const toggleCategory = (category: string) => {
    const updated = selectedCategories.includes(category)
      ? selectedCategories.filter(c => c !== category)
      : [...selectedCategories, category];
    onUpdate('categories', updated);
  };

  return (
    <div className="space-y-6">
      {/* Live sync toggle with animation */}
      <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 border border-emerald-200/50 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {enableLiveSync ? (
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-primary/30 animate-ping" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
              </span>
            ) : (
              <Zap className="h-4 w-4 text-muted-foreground" />
            )}
            <div>
              <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                Live Inventory Sync
              </p>
              <p className="text-xs text-emerald-600 dark:text-emerald-400">
                {isLoading ? 'Loading...' : `${menuItems.length} items from your menu`}
              </p>
            </div>
          </div>
          <Switch
            checked={enableLiveSync}
            onCheckedChange={(checked) => onUpdate('enable_live_sync', checked)}
          />
        </div>
        
        {enableLiveSync && (
          <div className="text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-100/50 dark:bg-emerald-900/30 p-2 rounded-lg">
            <strong>Real-time updates:</strong> Menu items automatically show as "Sold Out" when ingredients run low in your inventory.
          </div>
        )}
      </div>

      {/* Menu Type Toggle (Lunch/Dinner) */}
      <div className="space-y-3">
        <Label>Menu Display Mode</Label>
        <div className="flex gap-2">
          <Button
            variant={menuType === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => onUpdate('menu_type', 'all')}
            className="flex-1"
          >
            All Day
          </Button>
          <Button
            variant={menuType === 'lunch' ? 'default' : 'outline'}
            size="sm"
            onClick={() => onUpdate('menu_type', 'lunch')}
            className="flex-1 gap-1"
          >
            <Sun className="h-3 w-3" />
            Lunch
          </Button>
          <Button
            variant={menuType === 'dinner' ? 'default' : 'outline'}
            size="sm"
            onClick={() => onUpdate('menu_type', 'dinner')}
            className="flex-1 gap-1"
          >
            <Moon className="h-3 w-3" />
            Dinner
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Visitors can toggle between lunch and dinner menus with a smooth cross-fade transition.
        </p>
      </div>

      {/* Category selection */}
      <div className="space-y-3">
        <Label>Categories to Display</Label>
        <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
          {categories.length > 0 ? (
            categories.map((category) => (
              <div
                key={category}
                className="flex items-center justify-between p-2.5 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Checkbox
                    checked={selectedCategories.includes(category)}
                    onCheckedChange={() => toggleCategory(category)}
                  />
                  <span className="text-sm font-medium capitalize">
                    {CATEGORY_LABELS[category] || category}
                  </span>
                </div>
                <Badge variant="secondary" className="text-xs">
                  {menuItems.filter(item => item.category === category).length} items
                </Badge>
              </div>
            ))
          ) : (
            <div className="text-center py-6 text-muted-foreground">
              <RefreshCw className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No menu items found.</p>
              <p className="text-xs">Add items in the Menu section first.</p>
            </div>
          )}
        </div>
        {selectedCategories.length === 0 && categories.length > 0 && (
          <p className="text-xs text-muted-foreground">
            No categories selected. All items will be shown
          </p>
        )}
      </div>

      {/* Display options */}
      <div className="space-y-4 pt-4 border-t">
        <Label>Display Options</Label>
        
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
          <div>
            <p className="text-sm font-medium">Show Prices</p>
            <p className="text-xs text-muted-foreground">Display item prices on the menu</p>
          </div>
          <Switch
            checked={content.show_prices !== false}
            onCheckedChange={(checked) => onUpdate('show_prices', checked)}
          />
        </div>

        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
          <div>
            <p className="text-sm font-medium">Show Images</p>
            <p className="text-xs text-muted-foreground">Display food photos with blur-up loading</p>
          </div>
          <Switch
            checked={content.show_images !== false}
            onCheckedChange={(checked) => onUpdate('show_images', checked)}
          />
        </div>

        <div className="flex items-center justify-between p-3 rounded-lg bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-950/20 dark:to-yellow-950/20 border border-amber-200/50">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500" />
            <div>
              <p className="text-sm font-medium">Highlight Chef's Specials</p>
              <p className="text-xs text-muted-foreground">Add shimmer effect to special items</p>
            </div>
          </div>
          <Switch
            checked={content.show_chefs_specials !== false}
            onCheckedChange={(checked) => onUpdate('show_chefs_specials', checked)}
          />
        </div>
      </div>

      {/* Card style preview */}
      <div className="p-4 rounded-xl border-2 border-dashed border-muted-foreground/20 space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Card Style Preview</p>
        <div className="flex gap-2">
          <div className="flex-1 aspect-[3/4] rounded-2xl bg-white/70 backdrop-blur border border-white/80 shadow-lg" />
          <div className="flex-1 space-y-1 text-xs text-muted-foreground">
            <p>• Glassmorphism design</p>
            <p>• 16px corner radius</p>
            <p>• 1px white border</p>
            <p>• Blur-up image loading</p>
            <p>• Smooth hover animations</p>
          </div>
        </div>
      </div>

      {/* Feature notes */}
      <div className="space-y-2">
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <p className="text-xs text-amber-700 dark:text-amber-300">
            <strong>Sold Out Detection:</strong> Items automatically display a "Sold Out" badge with animation when ingredients are unavailable.
          </p>
        </div>
        
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <p className="text-xs text-emerald-700 dark:text-emerald-300">
            <strong>Market Price:</strong> Items marked as "Market Price" will pulse softly in emerald green to indicate current rates.
          </p>
        </div>

        <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
          <p className="text-xs text-blue-700 dark:text-blue-300">
            <strong>SEO Schema:</strong> Menu items automatically generate Schema.org JSON-LD for better Google Search and Maps visibility.
          </p>
        </div>
      </div>
    </div>
  );
}
