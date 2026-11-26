import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { format, addDays, subDays } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar, ChevronLeft, ChevronRight, Save, Loader2, FileDown } from "lucide-react";
import { toast } from "sonner";
import { exportToCSV } from "@/lib/exportUtils";

interface MenuItem {
  id: string;
  name: string;
  category: string;
  selling_price: number;
  is_active: boolean;
}

interface DailyMenuItem {
  id: string;
  menu_item_id: string;
  notes: string | null;
}

const categoryColors: Record<string, string> = {
  main: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  appetizer: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  dessert: "bg-pink-500/10 text-pink-600 border-pink-500/20",
  beverage: "bg-cyan-500/10 text-cyan-600 border-cyan-500/20",
  side: "bg-green-500/10 text-green-600 border-green-500/20",
};

export function DailyMenuManager() {
  const { restaurant, user } = useAuth();
  const { format: formatCurrency } = useCurrency();
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedItems, setSelectedItems] = useState<Map<string, string>>(new Map());
  const [hasChanges, setHasChanges] = useState(false);

  const dateStr = format(selectedDate, "yyyy-MM-dd");

  // Fetch all active menu items
  const { data: menuItems = [] } = useQuery({
    queryKey: ["menu-items", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await db
        .from("menu_items")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .eq("is_active", true)
        .order("category")
        .order("name");
      if (error) throw error;
      return data as MenuItem[];
    },
    enabled: !!restaurant?.id,
  });

  // Fetch daily menu for selected date
  const { data: dailyMenu = [], isLoading } = useQuery({
    queryKey: ["daily-menu", restaurant?.id, dateStr],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await db
        .from("daily_menu")
        .select("id, menu_item_id, notes")
        .eq("restaurant_id", restaurant.id)
        .eq("menu_date", dateStr);
      if (error) throw error;
      
      // Initialize selected items from database
      const itemsMap = new Map<string, string>();
      data?.forEach((item: DailyMenuItem) => {
        itemsMap.set(item.menu_item_id, item.notes || "");
      });
      setSelectedItems(itemsMap);
      setHasChanges(false);
      
      return data as DailyMenuItem[];
    },
    enabled: !!restaurant?.id,
  });

  // Save daily menu mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!restaurant?.id || !user?.id) throw new Error("No restaurant or user");

      // Delete existing entries for this date
      const { error: deleteError } = await db
        .from("daily_menu")
        .delete()
        .eq("restaurant_id", restaurant.id)
        .eq("menu_date", dateStr);
      
      if (deleteError) throw deleteError;

      // Insert new entries
      if (selectedItems.size > 0) {
        const entries = Array.from(selectedItems.entries()).map(([menuItemId, notes]) => ({
          restaurant_id: restaurant.id,
          menu_date: dateStr,
          menu_item_id: menuItemId,
          notes: notes || null,
          created_by: user.id,
        }));

        const { error: insertError } = await db
          .from("daily_menu")
          .insert(entries);
        
        if (insertError) throw insertError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["daily-menu"] });
      setHasChanges(false);
      toast.success("Daily menu saved");
    },
    onError: () => toast.error("Failed to save daily menu"),
  });

  const toggleItem = (itemId: string) => {
    const newItems = new Map(selectedItems);
    if (newItems.has(itemId)) {
      newItems.delete(itemId);
    } else {
      newItems.set(itemId, "");
    }
    setSelectedItems(newItems);
    setHasChanges(true);
  };

  const updateNote = (itemId: string, note: string) => {
    const newItems = new Map(selectedItems);
    newItems.set(itemId, note);
    setSelectedItems(newItems);
    setHasChanges(true);
  };

  const goToPreviousDay = () => setSelectedDate(subDays(selectedDate, 1));
  const goToNextDay = () => setSelectedDate(addDays(selectedDate, 1));
  const goToToday = () => setSelectedDate(new Date());

  // Group items by category
  const groupedItems = menuItems.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, MenuItem[]>);

  const isToday = format(selectedDate, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");

  return (
    <div className="space-y-6">
      {/* Date Navigation */}
      <Card className="fade-slide-in">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={goToPreviousDay}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-muted">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">
                  {format(selectedDate, "EEEE, MMMM d, yyyy")}
                </span>
                {isToday && (
                  <Badge variant="secondary" className="ml-2">Today</Badge>
                )}
              </div>
              <Button variant="outline" size="icon" onClick={goToNextDay}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              {!isToday && (
                <Button variant="outline" size="sm" onClick={goToToday}>
                  Go to Today
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const selectedMenuItems = menuItems.filter(item => selectedItems.has(item.id));
                  const headers = ["Name", "Category", "Price", "Notes"];
                  const rows = selectedMenuItems.map(item => [
                    item.name,
                    item.category || "",
                    item.selling_price || 0,
                    selectedItems.get(item.id) || ""
                  ]);
                  exportToCSV({ headers, rows, filename: `Daily_Menu_${dateStr}` });
                  toast.success("Daily menu exported to CSV");
                }}
                disabled={selectedItems.size === 0}
              >
                <FileDown className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={!hasChanges || saveMutation.isPending}
              >
                {saveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save Menu
              </Button>
            </div>
          </div>
          <div className="mt-4 text-sm text-muted-foreground">
            {selectedItems.size} items selected for this day
          </div>
        </CardContent>
      </Card>

      {/* Menu Items Selection */}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Loading...</div>
      ) : menuItems.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            No active menu items. Add items to your master menu first.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedItems).map(([category, items]) => (
            <Card key={category} className="fade-slide-in">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-medium flex items-center gap-2">
                  <Badge variant="outline" className={categoryColors[category] || ""}>
                    {category.charAt(0).toUpperCase() + category.slice(1)}
                  </Badge>
                  <span className="text-sm text-muted-foreground font-normal">
                    {items.filter(i => selectedItems.has(i.id)).length} / {items.length} selected
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {items.map((item) => {
                    const isSelected = selectedItems.has(item.id);
                    return (
                      <div
                        key={item.id}
                        className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                          isSelected ? "border-primary bg-primary/5" : "border-border"
                        }`}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleItem(item.id)}
                          className="mt-1"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className={`font-medium ${!isSelected && "text-muted-foreground"}`}>
                              {item.name}
                            </span>
                            <span className="text-sm text-muted-foreground">
                              {formatCurrency(item.selling_price)}
                            </span>
                          </div>
                          {isSelected && (
                            <Input
                              placeholder="Add note (e.g., Dal Makhani, Aloo Gobi)"
                              value={selectedItems.get(item.id) || ""}
                              onChange={(e) => updateNote(item.id, e.target.value)}
                              className="mt-2 text-sm"
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}