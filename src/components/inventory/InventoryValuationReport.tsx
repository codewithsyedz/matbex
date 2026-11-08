import { useState, useEffect } from "react";
import { TrendingUp, TrendingDown, DollarSign, Package, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { format, subDays } from "date-fns";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from "recharts";

interface Valuation {
  id: string;
  valuation_date: string;
  total_items: number;
  total_quantity: number;
  total_value: number;
}

interface SnapshotItem {
  id: string;
  branch_id?: string | null;
  current_stock?: number | null;
  unit_cost?: number | null;
}

export function InventoryValuationReport() {
  const { restaurant } = useAuth();
  const { activeBranchId, pinnedBranchId } = useBranch();
  const branchId = pinnedBranchId ?? activeBranchId ?? null;
  const { toast } = useToast();
  const [valuations, setValuations] = useState<Valuation[]>([]);
  const [loading, setLoading] = useState(true);
  const [snapshotting, setSnapshotting] = useState(false);

  useEffect(() => {
    if (restaurant?.id) {
      fetchValuations();
    }
  }, [restaurant?.id, branchId]);

  const fetchValuations = async () => {
    if (!restaurant?.id) return;
    
    try {
      const thirtyDaysAgo = subDays(new Date(), 30).toISOString().split("T")[0];
      
      const { data, error } = await supabase
        .from("inventory_valuations")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .gte("valuation_date", thirtyDaysAgo)
        .order("valuation_date", { ascending: true });

      if (error) throw error;
      // Snapshots are stored restaurant-wide; when a branch is active we
      // recompute each point from the branch's items inside items_snapshot.
      const rows = (data || []).map((v: any) => {
        if (!branchId) return v as Valuation;
        const items = (Array.isArray(v.items_snapshot) ? v.items_snapshot : []) as SnapshotItem[];
        const scoped = items.filter((i) => i?.branch_id === branchId);
        return {
          ...v,
          total_items: scoped.length,
          total_quantity: scoped.reduce((s, i) => s + Number(i.current_stock ?? 0), 0),
          total_value: scoped.reduce(
            (s, i) => s + Number(i.current_stock ?? 0) * Number(i.unit_cost ?? 0),
            0,
          ),
        } as Valuation;
      });
      setValuations(rows);
    } catch (error) {
      console.error("Error fetching valuations:", error);
    } finally {
      setLoading(false);
    }
  };

  const takeSnapshot = async () => {
    if (!restaurant?.id) return;

    setSnapshotting(true);
    try {
      // Fetch current inventory
      const { data: items, error: itemsError } = await supabase
        .from("inventory_items")
        .select("id, name, current_stock, unit_cost, unit, branch_id")
        .eq("restaurant_id", restaurant.id);

      if (itemsError) throw itemsError;

      const totalItems = items?.length || 0;
      const totalQuantity = items?.reduce((sum, item) => sum + item.current_stock, 0) || 0;
      const totalValue = items?.reduce((sum, item) => sum + (item.current_stock * item.unit_cost), 0) || 0;

      const today = new Date().toISOString().split("T")[0];

      // Upsert valuation (update if exists for today)
      const { error } = await supabase
        .from("inventory_valuations")
        .upsert({
          restaurant_id: restaurant.id,
          valuation_date: today,
          total_items: totalItems,
          total_quantity: totalQuantity,
          total_value: totalValue,
          items_snapshot: items || [],
        }, {
          onConflict: "restaurant_id,valuation_date",
        });

      if (error) throw error;

      toast({ title: "Snapshot saved", description: `Inventory value: ${totalValue.toFixed(2)} ${restaurant.currency}` });
      fetchValuations();
    } catch (error: any) {
      console.error("Error taking snapshot:", error);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setSnapshotting(false);
    }
  };

  const chartData = valuations.map(v => ({
    date: format(new Date(v.valuation_date), "MMM d"),
    value: Number(v.total_value),
    items: v.total_items,
    quantity: Number(v.total_quantity),
  }));

  const latestValuation = valuations[valuations.length - 1];
  const previousValuation = valuations[valuations.length - 2];
  
  const valueChange = latestValuation && previousValuation
    ? ((latestValuation.total_value - previousValuation.total_value) / previousValuation.total_value) * 100
    : 0;

  const currentValue = latestValuation?.total_value || 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base font-medium">Inventory Valuation</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Track stock value over time
          </p>
        </div>
        <Button 
          size="sm" 
          variant="outline" 
          className="gap-2"
          onClick={takeSnapshot}
          disabled={snapshotting}
        >
          <RefreshCw className={`h-4 w-4 ${snapshotting ? "animate-spin" : ""}`} />
          Take Snapshot
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-4">
          <div className="p-4 rounded-lg bg-muted/50">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <DollarSign className="h-4 w-4" />
              <span className="text-xs">Current Value</span>
            </div>
            <p className="text-xl font-semibold">
              {currentValue.toFixed(2)} {restaurant?.currency || "SAR"}
            </p>
          </div>
          <div className="p-4 rounded-lg bg-muted/50">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Package className="h-4 w-4" />
              <span className="text-xs">Total Items</span>
            </div>
            <p className="text-xl font-semibold">{latestValuation?.total_items || 0}</p>
          </div>
          <div className="p-4 rounded-lg bg-muted/50">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              {valueChange >= 0 ? (
                <TrendingUp className="h-4 w-4 text-emerald-500" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-500" />
              )}
              <span className="text-xs">Change</span>
            </div>
            <p className={`text-xl font-semibold ${valueChange >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              {valueChange >= 0 ? "+" : ""}{valueChange.toFixed(1)}%
            </p>
          </div>
        </div>

        {/* Value Chart */}
        {loading ? (
          <div className="h-64 flex items-center justify-center text-muted-foreground">
            Loading...
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-muted-foreground">
            <Package className="h-12 w-12 mb-2 opacity-50" />
            <p>No valuation data yet</p>
            <p className="text-xs mt-1">Take a snapshot to start tracking</p>
          </div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="valueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis 
                  dataKey="date" 
                  tick={{ fontSize: 12 }}
                  className="text-muted-foreground"
                />
                <YAxis 
                  tick={{ fontSize: 12 }}
                  className="text-muted-foreground"
                  tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
                />
                <Tooltip 
                  formatter={(value: number) => [`${value.toFixed(2)} ${restaurant?.currency || "SAR"}`, "Value"]}
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="hsl(var(--primary))"
                  fillOpacity={1}
                  fill="url(#valueGradient)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Recent Snapshots */}
        {valuations.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2">Recent Snapshots</h4>
            <div className="space-y-2">
              {valuations.slice(-5).reverse().map((v) => (
                <div key={v.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/30 text-sm">
                  <span className="text-muted-foreground">
                    {format(new Date(v.valuation_date), "MMM d, yyyy")}
                  </span>
                  <div className="flex items-center gap-4">
                    <span>{v.total_items} items</span>
                    <span className="font-medium">
                      {Number(v.total_value).toFixed(2)} {restaurant?.currency || "SAR"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
