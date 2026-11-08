import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Loader2, Crown, Zap, Building2, Save, DollarSign, Check, X } from "lucide-react";

interface Plan {
  id: string;
  name: string;
  price: number;
  billing_interval: string;
  is_active: boolean;
  default_feature_flags: Record<string, boolean>;
  quota_limits: Record<string, number>;
  stripe_price_id?: string | null;
}

const FEATURE_FLAGS = [
  { key: "daily_profit", label: "Daily Profit", description: "Daily profit calculations and reports" },
  { key: "accounting", label: "Accounting Module", description: "Chart of accounts, journal entries, and period close" },
  { key: "inventory", label: "Inventory Module", description: "Stock tracking and purchase management" },
  { key: "payroll", label: "Payroll Module", description: "Labor cost tracking and payroll management" },
  { key: "chat", label: "Team Chat", description: "Real-time team messaging and channels" },
  { key: "cogs", label: "COGS Tracking", description: "Cost of goods sold analysis and reporting" },
  { key: "menu", label: "Menu Management", description: "Menu items, recipes, and pricing" },
  { key: "advance_pay", label: "Advance Pay", description: "Employee advance payment feature" },
  { key: "api_access", label: "API Access", description: "REST API access for integrations" },
  { key: "multi_location", label: "Multi-Location", description: "Multiple restaurant locations" },
  { key: "email_reports", label: "Email Reports", description: "Automated email report delivery" },
  { key: "advanced_reports", label: "Advanced Reports", description: "Advanced analytics and reporting" },
];

const QUOTA_FIELDS = [
  { key: "users", label: "Total Users" },
  { key: "owner", label: "Owners" },
  { key: "manager", label: "Managers" },
  { key: "cashier", label: "Cashiers" },
  { key: "menu_items", label: "Menu Items" },
  { key: "image_uploads", label: "Image Uploads" },
  { key: "email_reminders", label: "Email Reminders" },
];

const PLAN_ICONS: Record<string, React.ReactNode> = {
  free: <Building2 className="h-4 w-4" />,
  pro: <Zap className="h-4 w-4" />,
  enterprise: <Crown className="h-4 w-4" />,
};

const emptyPlan: Omit<Plan, 'id'> = {
  name: "",
  price: 0,
  billing_interval: "month",
  is_active: true,
  default_feature_flags: {},
  quota_limits: {},
  stripe_price_id: null,
};

export default function AdminPlans() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [formData, setFormData] = useState<Omit<Plan, 'id'>>(emptyPlan);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  useEffect(() => {
    fetchPlans();
  }, []);

  const fetchPlans = async () => {
    try {
      const { data, error } = await supabase
        .from("plans")
        .select("*")
        .order("price", { ascending: true });

      if (error) throw error;

      const parsedPlans: Plan[] = (data || []).map(p => ({
        id: p.id,
        name: p.name,
        price: p.price,
        billing_interval: p.billing_interval,
        is_active: p.is_active,
        default_feature_flags: (p.default_feature_flags && typeof p.default_feature_flags === 'object' && !Array.isArray(p.default_feature_flags))
          ? p.default_feature_flags as Record<string, boolean>
          : {},
        quota_limits: (p.quota_limits && typeof p.quota_limits === 'object' && !Array.isArray(p.quota_limits))
          ? p.quota_limits as Record<string, number>
          : {},
        stripe_price_id: (p as { stripe_price_id?: string | null }).stripe_price_id ?? null,
      }));

      setPlans(parsedPlans);
    } catch (error) {
      console.error("Error fetching plans:", error);
      toast.error("Failed to load plans");
    } finally {
      setLoading(false);
    }
  };

  const openCreateDialog = () => {
    setEditingPlan(null);
    setFormData(emptyPlan);
    setDialogOpen(true);
  };

  const openEditDialog = (plan: Plan) => {
    setEditingPlan(plan);
    setFormData({
      name: plan.name,
      price: plan.price,
      billing_interval: plan.billing_interval,
      is_active: plan.is_active,
      default_feature_flags: { ...plan.default_feature_flags },
      quota_limits: { ...plan.quota_limits },
      stripe_price_id: plan.stripe_price_id,
    });
    setDialogOpen(true);
  };

  const handleToggleFeature = (featureKey: string, enabled: boolean) => {
    setFormData(prev => ({
      ...prev,
      default_feature_flags: {
        ...prev.default_feature_flags,
        [featureKey]: enabled,
      },
    }));
  };

  const handleQuotaChange = (key: string, value: string) => {
    const numValue = parseInt(value) || 0;
    setFormData(prev => ({
      ...prev,
      quota_limits: {
        ...prev.quota_limits,
        [key]: numValue > 0 ? numValue : undefined,
      },
    }));
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error("Plan name is required");
      return;
    }

    setSaving(true);
    try {
      // Clean quota_limits - remove undefined values
      const cleanedQuotas: Record<string, number> = {};
      Object.entries(formData.quota_limits).forEach(([key, value]) => {
        if (value && value > 0) {
          cleanedQuotas[key] = value;
        }
      });

      const payload = {
        name: formData.name.trim().toLowerCase(),
        price: formData.price,
        billing_interval: formData.billing_interval,
        is_active: formData.is_active,
        default_feature_flags: formData.default_feature_flags,
        quota_limits: cleanedQuotas,
        stripe_price_id: formData.stripe_price_id?.trim() || null,
      };

      if (editingPlan) {
        const { error } = await supabase
          .from("plans")
          .update(payload)
          .eq("id", editingPlan.id);

        if (error) throw error;
        toast.success("Plan updated successfully");
      } else {
        const { error } = await supabase
          .from("plans")
          .insert(payload);

        if (error) throw error;
        toast.success("Plan created successfully");
      }

      setDialogOpen(false);
      fetchPlans();
    } catch (error) {
      console.error("Error saving plan:", error);
      toast.error("Failed to save plan");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (planId: string) => {
    try {
      const { error } = await supabase
        .from("plans")
        .delete()
        .eq("id", planId);

      if (error) throw error;
      toast.success("Plan deleted");
      setDeleteConfirmId(null);
      fetchPlans();
    } catch (error) {
      console.error("Error deleting plan:", error);
      toast.error("Failed to delete plan. It may have associated tenants.");
    }
  };

  const togglePlanActive = async (plan: Plan) => {
    try {
      const { error } = await supabase
        .from("plans")
        .update({ is_active: !plan.is_active })
        .eq("id", plan.id);

      if (error) throw error;
      toast.success(`Plan ${!plan.is_active ? 'activated' : 'deactivated'}`);
      fetchPlans();
    } catch (error) {
      console.error("Error toggling plan:", error);
      toast.error("Failed to update plan status");
    }
  };

  const getPlanIcon = (name: string) => {
    return PLAN_ICONS[name.toLowerCase()] || <DollarSign className="h-4 w-4" />;
  };

  return (
    <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Manage Plans
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Create and configure subscription plans with features and quotas.
            </p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreateDialog}>
                <Plus className="h-4 w-4 mr-2" />
                Create Plan
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh]">
              <DialogHeader>
                <DialogTitle>
                  {editingPlan ? `Edit ${editingPlan.name} Plan` : "Create New Plan"}
                </DialogTitle>
                <DialogDescription>
                  Configure plan details, features, and usage quotas.
                </DialogDescription>
              </DialogHeader>
              <ScrollArea className="max-h-[60vh] pr-4">
                <div className="space-y-6">
                  {/* Basic Info */}
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="name">Plan Name</Label>
                      <Input
                        id="name"
                        value={formData.name}
                        onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="e.g., pro"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="price">Price ($/month)</Label>
                      <Input
                        id="price"
                        type="number"
                        min={0}
                        value={formData.price}
                        onChange={(e) => setFormData(prev => ({ ...prev, price: parseFloat(e.target.value) || 0 }))}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="stripe_price_id">Stripe Price ID</Label>
                    <Input
                      id="stripe_price_id"
                      value={formData.stripe_price_id || ""}
                      onChange={(e) => setFormData(prev => ({ ...prev, stripe_price_id: e.target.value }))}
                      placeholder="price_..."
                    />
                    <p className="text-xs text-muted-foreground">
                      Optional: Link to a Stripe price for automated billing
                    </p>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id="is_active"
                      checked={formData.is_active}
                      onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_active: checked }))}
                    />
                    <Label htmlFor="is_active">Active (visible to tenants)</Label>
                  </div>

                  <Separator />

                  {/* Features */}
                  <div>
                    <h3 className="text-sm font-medium mb-3">Features</h3>
                    <div className="grid gap-3">
                      {FEATURE_FLAGS.map(feature => (
                        <div key={feature.key} className="flex items-center justify-between p-2 rounded-lg border border-border/50">
                          <div>
                            <p className="text-sm font-medium">{feature.label}</p>
                            <p className="text-xs text-muted-foreground">{feature.description}</p>
                          </div>
                          <Switch
                            checked={formData.default_feature_flags[feature.key] ?? false}
                            onCheckedChange={(checked) => handleToggleFeature(feature.key, checked)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <Separator />

                  {/* Quotas */}
                  <div>
                    <h3 className="text-sm font-medium mb-3">Usage Quotas</h3>
                    <div className="grid gap-3 md:grid-cols-2">
                      {QUOTA_FIELDS.map(field => (
                        <div key={field.key} className="space-y-1">
                          <Label htmlFor={`quota-${field.key}`} className="text-xs">{field.label}</Label>
                          <Input
                            id={`quota-${field.key}`}
                            type="number"
                            min={0}
                            placeholder="Unlimited"
                            value={formData.quota_limits[field.key] || ""}
                            onChange={(e) => handleQuotaChange(field.key, e.target.value)}
                          />
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      Leave empty for unlimited usage
                    </p>
                  </div>
                </div>
              </ScrollArea>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      {editingPlan ? "Update Plan" : "Create Plan"}
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Plans Table */}
        <Card className="border-border/40">
          <CardHeader>
            <CardTitle className="text-lg">All Plans</CardTitle>
            <CardDescription>
              Overview of all subscription plans and their configurations
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : plans.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No plans found. Create your first plan to get started.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plan</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Features</TableHead>
                    <TableHead>Stripe ID</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plans.map(plan => {
                    const enabledFeatures = Object.entries(plan.default_feature_flags)
                      .filter(([, enabled]) => enabled).length;
                    
                    return (
                      <TableRow key={plan.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center text-primary">
                              {getPlanIcon(plan.name)}
                            </div>
                            <span className="font-medium capitalize">{plan.name}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          ${plan.price}/{plan.billing_interval}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {enabledFeatures} / {FEATURE_FLAGS.length}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {plan.stripe_price_id ? (
                            <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                              {plan.stripe_price_id.slice(0, 20)}...
                            </code>
                          ) : (
                            <span className="text-muted-foreground text-sm">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={plan.is_active ? "default" : "secondary"}>
                            {plan.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditDialog(plan)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => togglePlanActive(plan)}
                            >
                              {plan.is_active ? (
                                <X className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <Check className="h-4 w-4 text-green-500" />
                              )}
                            </Button>
                            {deleteConfirmId === plan.id ? (
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => handleDelete(plan.id)}
                                >
                                  Confirm
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setDeleteConfirmId(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setDeleteConfirmId(plan.id)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
    </div>
  );
}
