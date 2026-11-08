import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { startOfWeek, endOfWeek, format, subWeeks } from "date-fns";

export interface WeeklyItem {
  item_id: string;
  item_name: string;
  unit: string;
  unit_cost: number;
  opening_qty: number;
  opening_value: number;
  purchases_qty: number;
  purchases_value: number;
  current_stock: number;
}

export interface WeeklyStocktake {
  id: string;
  tenant_id: string;
  restaurant_id: string;
  stocktake_date: string;
  week_start_date: string;
  week_end_date: string;
  status: 'draft' | 'submitted' | 'posted';
  total_opening_value: number;
  total_purchases_value: number;
  total_closing_value: number;
  total_cogs: number;
  notes: string | null;
  created_at: string;
  posted_at: string | null;
}

export interface StocktakeLineItem {
  id: string;
  inventory_item_id: string;
  item_name: string;
  unit: string;
  opening_qty: number;
  opening_value: number;
  purchases_qty: number;
  purchases_value: number;
  closing_qty: number;
  closing_value: number;
  consumption_qty: number;
  consumption_value: number;
}

export function useWeeklyCOGS() {
  const { profile, restaurant, user } = useAuth();
  const queryClient = useQueryClient();
  
  // Default to current week
  const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 0 });
  const currentWeekEnd = endOfWeek(new Date(), { weekStartsOn: 0 });

  // Fetch weekly items with calculated opening/purchases
  const fetchWeeklyItems = async (weekStart: Date, weekEnd: Date) => {
    if (!restaurant?.id) return [];
    
    const { data, error } = await supabase.rpc('get_weekly_cogs_items', {
      p_restaurant_id: restaurant.id,
      p_week_start: format(weekStart, 'yyyy-MM-dd'),
      p_week_end: format(weekEnd, 'yyyy-MM-dd'),
    });
    
    if (error) throw error;
    return data as WeeklyItem[];
  };

  // Fetch existing stocktakes
  const { data: stocktakes = [], isLoading: stocktakesLoading } = useQuery({
    queryKey: ['weekly-stocktakes', restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      
      const { data, error } = await supabase
        .from('weekly_stocktakes')
        .select('*')
        .eq('restaurant_id', restaurant.id)
        .order('week_end_date', { ascending: false })
        .limit(10);
        
      if (error) throw error;
      return data as WeeklyStocktake[];
    },
    enabled: !!restaurant?.id,
  });

  // Fetch stocktake items for a specific stocktake
  const fetchStocktakeItems = async (stocktakeId: string) => {
    const { data, error } = await supabase
      .from('weekly_stocktake_items')
      .select('*')
      .eq('stocktake_id', stocktakeId)
      .order('item_name');
      
    if (error) throw error;
    return data as StocktakeLineItem[];
  };

  // Create new weekly stocktake
  const createStocktake = useMutation({
    mutationFn: async ({ 
      weekStart, 
      weekEnd,
      items,
      notes 
    }: { 
      weekStart: Date; 
      weekEnd: Date; 
      items: Array<{ itemId: string; closingQty: number }>;
      notes?: string;
    }) => {
      if (!restaurant?.id || !profile?.tenant_id || !user?.id) {
        throw new Error('Missing authentication context');
      }

      // Fetch current weekly items to get opening/purchases data
      const weeklyItems = await fetchWeeklyItems(weekStart, weekEnd);
      
      // Create stocktake record
      const { data: stocktake, error: stocktakeError } = await supabase
        .from('weekly_stocktakes')
        .insert({
          tenant_id: profile.tenant_id,
          restaurant_id: restaurant.id,
          stocktake_date: format(new Date(), 'yyyy-MM-dd'),
          week_start_date: format(weekStart, 'yyyy-MM-dd'),
          week_end_date: format(weekEnd, 'yyyy-MM-dd'),
          status: 'submitted',
          notes,
          created_by: user.id,
        })
        .select()
        .single();
        
      if (stocktakeError) throw stocktakeError;

      // Create line items
      let totalOpening = 0;
      let totalPurchases = 0;
      let totalClosing = 0;

      const lineItems = items.map(item => {
        const weeklyItem = weeklyItems.find(w => w.item_id === item.itemId);
        if (!weeklyItem) throw new Error(`Item ${item.itemId} not found`);
        
        const closingValue = item.closingQty * weeklyItem.unit_cost;
        totalOpening += weeklyItem.opening_value;
        totalPurchases += weeklyItem.purchases_value;
        totalClosing += closingValue;

        return {
          stocktake_id: stocktake.id,
          inventory_item_id: item.itemId,
          item_name: weeklyItem.item_name,
          unit: weeklyItem.unit,
          opening_qty: weeklyItem.opening_qty,
          opening_value: weeklyItem.opening_value,
          purchases_qty: weeklyItem.purchases_qty,
          purchases_value: weeklyItem.purchases_value,
          closing_qty: item.closingQty,
          closing_value: closingValue,
        };
      });

      const { error: itemsError } = await supabase
        .from('weekly_stocktake_items')
        .insert(lineItems);
        
      if (itemsError) throw itemsError;

      // Update totals
      const { error: updateError } = await supabase
        .from('weekly_stocktakes')
        .update({
          total_opening_value: totalOpening,
          total_purchases_value: totalPurchases,
          total_closing_value: totalClosing,
          total_cogs: totalOpening + totalPurchases - totalClosing,
        })
        .eq('id', stocktake.id);
        
      if (updateError) throw updateError;

      return stocktake;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['weekly-stocktakes'] });
      toast.success('Weekly stocktake saved');
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Post stocktake to ledger
  const postToLedger = useMutation({
    mutationFn: async (stocktakeId: string) => {
      if (!user?.id) throw new Error('User not authenticated');
      
      const { data, error } = await supabase.rpc('post_weekly_cogs_to_ledger', {
        p_stocktake_id: stocktakeId,
        p_posted_by: user.id,
      });
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['weekly-stocktakes'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['account-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['cogs-inventory'] });
      toast.success('Weekly COGS posted to ledger');
    },
    onError: (error: Error) => {
      const message = error.message.includes('VALIDATION_ERROR:') 
        ? error.message.replace('VALIDATION_ERROR:', '').trim()
        : error.message;
      toast.error(message);
    },
  });

  // Check if week already has stocktake
  const hasStocktakeForWeek = (weekEnd: Date) => {
    const weekEndStr = format(weekEnd, 'yyyy-MM-dd');
    return stocktakes.some(s => s.week_end_date === weekEndStr);
  };

  return {
    stocktakes,
    stocktakesLoading,
    fetchWeeklyItems,
    fetchStocktakeItems,
    createStocktake,
    postToLedger,
    hasStocktakeForWeek,
    currentWeekStart,
    currentWeekEnd,
  };
}
