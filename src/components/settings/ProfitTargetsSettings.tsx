import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Target, TrendingUp, Percent, Bell, Mail } from "lucide-react";

interface ProfitTarget {
  id?: string;
  target_type: string;
  target_amount: number;
  prime_cost_target: number;
  margin_target: number;
  alert_enabled: boolean;
  alert_threshold: number;
  cash_variance_threshold?: number;
  expense_spike_threshold?: number;
}

const defaultTargets: Record<string, ProfitTarget> = {
  daily: {
    target_type: "daily",
    target_amount: 0,
    prime_cost_target: 65,
    margin_target: 10,
    alert_enabled: true,
    alert_threshold: 10,
    cash_variance_threshold: 50,
    expense_spike_threshold: 30,
  },
  weekly: {
    target_type: "weekly",
    target_amount: 0,
    prime_cost_target: 65,
    margin_target: 10,
    alert_enabled: true,
    alert_threshold: 10,
    cash_variance_threshold: 50,
    expense_spike_threshold: 30,
  },
  monthly: {
    target_type: "monthly",
    target_amount: 0,
    prime_cost_target: 65,
    margin_target: 10,
    alert_enabled: true,
    alert_threshold: 10,
    cash_variance_threshold: 50,
    expense_spike_threshold: 30,
  },
};

export function ProfitTargetsSettings() {
  const { restaurant, user } = useAuth();
  const { format: formatCurrency, displayCurrency } = useCurrency();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("daily");
  const [notificationEmail, setNotificationEmail] = useState("");

  // Fetch existing targets
  const { data: targets = [], isLoading } = useQuery({
    queryKey: ["profit-targets", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await supabase
        .from("profit_targets")
        .select("*")
        .eq("restaurant_id", restaurant.id);
      if (error) throw error;
      return data;
    },
    enabled: !!restaurant?.id,
  });

  // Get target for current tab
  const currentTarget = targets.find((t) => t.target_type === activeTab) || defaultTargets[activeTab];
  const [editedTarget, setEditedTarget] = useState<ProfitTarget | null>(null);

  const displayTarget = editedTarget?.target_type === activeTab ? editedTarget : currentTarget;

  // Upsert target mutation
  const upsertTargetMutation = useMutation({
    mutationFn: async (target: ProfitTarget) => {
      if (!restaurant?.id) throw new Error("No restaurant");
      
      const { error } = await supabase
        .from("profit_targets")
        .upsert({
          id: target.id,
          restaurant_id: restaurant.id,
          target_type: target.target_type,
          target_amount: target.target_amount,
          prime_cost_target: target.prime_cost_target,
          margin_target: target.margin_target,
          alert_enabled: target.alert_enabled,
          alert_threshold: target.alert_threshold,
          cash_variance_threshold: target.cash_variance_threshold || 50,
          expense_spike_threshold: target.expense_spike_threshold || 30,
        }, {
          onConflict: "restaurant_id,target_type",
        });
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profit-targets"] });
      setEditedTarget(null);
      toast.success("Target saved successfully");
    },
    onError: () => toast.error("Failed to save target"),
  });

  const handleFieldChange = (field: keyof ProfitTarget, value: number | boolean) => {
    setEditedTarget((prev) => ({
      ...(prev || currentTarget),
      [field]: value,
    }));
  };

  const handleSave = () => {
    if (editedTarget) {
      upsertTargetMutation.mutate(editedTarget);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Target className="h-4 w-4" />
          Profit Targets & Alerts
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={(val) => {
          setActiveTab(val);
          setEditedTarget(null);
        }}>
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="daily">Daily</TabsTrigger>
            <TabsTrigger value="weekly">Weekly</TabsTrigger>
            <TabsTrigger value="monthly">Monthly</TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab} className="space-y-6 mt-6">
            {/* Profit Target */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                <Label className="text-sm font-medium">Profit Target ({displayCurrency})</Label>
              </div>
              <Input
                type="number"
                value={displayTarget.target_amount}
                onChange={(e) => handleFieldChange("target_amount", parseFloat(e.target.value) || 0)}
                placeholder={`Enter ${activeTab} profit target`}
              />
              <p className="text-xs text-muted-foreground">
                Set your {activeTab} profit goal. Alerts trigger when profit falls below target.
              </p>
            </div>

            {/* Prime Cost Target */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Percent className="h-4 w-4 text-muted-foreground" />
                <Label className="text-sm font-medium">Prime Cost Target (%)</Label>
              </div>
              <div className="flex items-center gap-4">
                <Input
                  type="number"
                  value={displayTarget.prime_cost_target}
                  onChange={(e) => handleFieldChange("prime_cost_target", parseFloat(e.target.value) || 0)}
                  className="w-24"
                  min={0}
                  max={100}
                />
                <span className="text-sm text-muted-foreground">%</span>
                <Badge variant={displayTarget.prime_cost_target <= 60 ? "default" : displayTarget.prime_cost_target <= 70 ? "secondary" : "destructive"}>
                  {displayTarget.prime_cost_target <= 60 ? "Excellent" : displayTarget.prime_cost_target <= 70 ? "Good" : "High"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Industry standard is 55-65%. Prime cost = food + beverage + labor.
              </p>
            </div>

            {/* Margin Target */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Percent className="h-4 w-4 text-muted-foreground" />
                <Label className="text-sm font-medium">Operating Margin Target (%)</Label>
              </div>
              <div className="flex items-center gap-4">
                <Input
                  type="number"
                  value={displayTarget.margin_target}
                  onChange={(e) => handleFieldChange("margin_target", parseFloat(e.target.value) || 0)}
                  className="w-24"
                  min={0}
                  max={100}
                />
                <span className="text-sm text-muted-foreground">%</span>
                <Badge variant={displayTarget.margin_target >= 15 ? "default" : displayTarget.margin_target >= 10 ? "secondary" : "destructive"}>
                  {displayTarget.margin_target >= 15 ? "Healthy" : displayTarget.margin_target >= 10 ? "Fair" : "Low"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Healthy restaurants target 10-20% operating margin.
              </p>
            </div>

            {/* Alert Settings */}
            <div className="border-t pt-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bell className="h-4 w-4 text-muted-foreground" />
                  <Label className="text-sm font-medium">Enable Alerts</Label>
                </div>
                <Switch
                  checked={displayTarget.alert_enabled}
                  onCheckedChange={(val) => handleFieldChange("alert_enabled", val)}
                />
              </div>

              {displayTarget.alert_enabled && (
                <div className="space-y-4 pl-6">
                  <div className="space-y-2">
                    <Label className="text-sm">Profit Alert Threshold (%)</Label>
                    <div className="flex items-center gap-4">
                      <Input
                        type="number"
                        value={displayTarget.alert_threshold}
                        onChange={(e) => handleFieldChange("alert_threshold", parseFloat(e.target.value) || 0)}
                        className="w-24"
                        min={0}
                        max={100}
                      />
                      <span className="text-sm text-muted-foreground">% below target</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Alert when profit falls {displayTarget.alert_threshold}% below your target.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">Cash Variance Threshold ({displayCurrency})</Label>
                    <div className="flex items-center gap-4">
                      <Input
                        type="number"
                        value={(displayTarget as any).cash_variance_threshold || 50}
                        onChange={(e) => handleFieldChange("cash_variance_threshold" as any, parseFloat(e.target.value) || 0)}
                        className="w-24"
                        min={0}
                      />
                      <span className="text-sm text-muted-foreground">maximum variance</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Alert when daily cash variance exceeds this amount.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">Expense Spike Threshold (%)</Label>
                    <div className="flex items-center gap-4">
                      <Input
                        type="number"
                        value={(displayTarget as any).expense_spike_threshold || 30}
                        onChange={(e) => handleFieldChange("expense_spike_threshold" as any, parseFloat(e.target.value) || 0)}
                        className="w-24"
                        min={0}
                        max={500}
                      />
                      <span className="text-sm text-muted-foreground">% above average</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Alert when today's expenses exceed the 7-day average by this percentage.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Save Button */}
            {editedTarget && (
              <div className="flex justify-end pt-4">
                <Button
                  onClick={handleSave}
                  disabled={upsertTargetMutation.isPending}
                >
                  {upsertTargetMutation.isPending ? "Saving..." : "Save Target"}
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Target Summary */}
        <div className="mt-6 pt-6 border-t">
          <h4 className="text-sm font-medium mb-4">Current Targets Summary</h4>
          <div className="grid grid-cols-3 gap-4">
            {["daily", "weekly", "monthly"].map((type) => {
              const target = targets.find((t) => t.target_type === type);
              return (
                <div key={type} className="p-3 rounded-lg bg-muted/50">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">{type}</p>
                  <p className="font-semibold mt-1">
                    {target ? formatCurrency(Number(target.target_amount)) : "Not set"}
                  </p>
                  {target?.alert_enabled && (
                    <Badge variant="outline" className="mt-2 text-xs">
                      <Bell className="h-3 w-3 mr-1" />
                      Alerts on
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
