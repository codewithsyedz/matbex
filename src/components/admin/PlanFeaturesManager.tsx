import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Crown, Zap, Building2, Save, Loader2 } from "lucide-react";

interface Plan {
  id: string;
  name: string;
  price: number;
  default_feature_flags: Record<string, boolean>;
}

const FEATURE_FLAGS = [
  { key: "daily_profit", label: "Daily Profit", description: "Daily profit calculations and reports" },
  { key: "accounting", label: "Accounting Module", description: "Chart of accounts, journal entries, and period close" },
  { key: "inventory", label: "Inventory Module", description: "Stock tracking and purchase management" },
  { key: "payroll", label: "Payroll Module", description: "Labor cost tracking and payroll management" },
  { key: "chat", label: "Team Chat", description: "Real-time team messaging and channels" },
  { key: "cogs", label: "COGS Tracking", description: "Cost of goods sold analysis and reporting" },
  { key: "menu", label: "Menu Management", description: "Menu items, recipes, and pricing" },
  { key: "shifts", label: "Shifts & Cash Drawer", description: "Cashier shifts, drawer reconciliation, and cash events" },
  { key: "advance_pay", label: "Advance Pay", description: "Employee advance payment feature" },
  { key: "api_access", label: "API Access", description: "REST API access for integrations" },
  { key: "multi_location", label: "Multi-Location", description: "Multiple restaurant locations" },
  { key: "email_reports", label: "Email Reports", description: "Automated email report delivery" },
  { key: "advanced_reports", label: "Advanced Reports", description: "Advanced analytics and reporting" },
];

const PLAN_ICONS: Record<string, React.ReactNode> = {
  free: <Building2 className="h-5 w-5" />,
  pro: <Zap className="h-5 w-5" />,
  enterprise: <Crown className="h-5 w-5" />,
};

export function PlanFeaturesManager() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [editedFlags, setEditedFlags] = useState<Record<string, Record<string, boolean>>>({});

  useEffect(() => {
    fetchPlans();
  }, []);

  const fetchPlans = async () => {
    try {
      const { data, error } = await supabase
        .from("plans")
        .select("*")
        .eq("is_active", true)
        .order("price", { ascending: true });

      if (error) throw error;

      const parsedPlans = (data || []).map(p => ({
        ...p,
        default_feature_flags: (p.default_feature_flags && typeof p.default_feature_flags === 'object' && !Array.isArray(p.default_feature_flags))
          ? p.default_feature_flags as Record<string, boolean>
          : {}
      }));

      setPlans(parsedPlans);
      
      // Initialize edited flags with current values
      const initialFlags: Record<string, Record<string, boolean>> = {};
      parsedPlans.forEach(plan => {
        initialFlags[plan.id] = { ...plan.default_feature_flags };
      });
      setEditedFlags(initialFlags);
    } catch (error) {
      console.error("Error fetching plans:", error);
      toast.error("Failed to load plans");
    } finally {
      setLoading(false);
    }
  };

  const handleToggleFeature = (planId: string, featureKey: string, enabled: boolean) => {
    setEditedFlags(prev => ({
      ...prev,
      [planId]: {
        ...prev[planId],
        [featureKey]: enabled,
      },
    }));
  };

  const handleSavePlan = async (planId: string) => {
    setSaving(planId);
    try {
      const { error } = await supabase
        .from("plans")
        .update({ default_feature_flags: editedFlags[planId] })
        .eq("id", planId);

      if (error) throw error;

      // Update local state
      setPlans(prev => prev.map(p => 
        p.id === planId ? { ...p, default_feature_flags: editedFlags[planId] } : p
      ));

      toast.success("Plan features updated successfully");
    } catch (error) {
      console.error("Error saving plan features:", error);
      toast.error("Failed to save plan features");
    } finally {
      setSaving(null);
    }
  };

  const hasChanges = (planId: string) => {
    const plan = plans.find(p => p.id === planId);
    if (!plan) return false;
    
    const currentFlags = plan.default_feature_flags;
    const edited = editedFlags[planId] || {};
    
    return FEATURE_FLAGS.some(f => 
      (currentFlags[f.key] ?? false) !== (edited[f.key] ?? false)
    );
  };

  if (loading) {
    return (
      <Card className="border-border/40">
        <CardContent className="pt-6">
          <div className="flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium text-foreground">Plan Feature Configuration</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Configure default features for each subscription tier. Changes affect new tenants and those without feature overrides.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {plans.map(plan => (
          <Card key={plan.id} className="border-border/40">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center text-primary">
                    {PLAN_ICONS[plan.name.toLowerCase()]}
                  </div>
                  <div>
                    <CardTitle className="text-base font-medium capitalize">{plan.name}</CardTitle>
                    <CardDescription>${plan.price}/month</CardDescription>
                  </div>
                </div>
                {hasChanges(plan.id) && (
                  <Badge variant="secondary" className="text-xs">Unsaved</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <Separator />
              
              <div className="space-y-3">
                {FEATURE_FLAGS.map(feature => (
                  <div key={feature.key} className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium text-foreground">{feature.label}</p>
                      <p className="text-xs text-muted-foreground">{feature.description}</p>
                    </div>
                    <Switch
                      checked={editedFlags[plan.id]?.[feature.key] ?? false}
                      onCheckedChange={(checked) => handleToggleFeature(plan.id, feature.key, checked)}
                    />
                  </div>
                ))}
              </div>

              <Separator />

              <Button
                className="w-full"
                variant={hasChanges(plan.id) ? "default" : "outline"}
                disabled={!hasChanges(plan.id) || saving === plan.id}
                onClick={() => handleSavePlan(plan.id)}
              >
                {saving === plan.id ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Save Changes
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}