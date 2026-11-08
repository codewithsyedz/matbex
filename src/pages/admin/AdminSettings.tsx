import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Shield, Database, Bell, CreditCard, Gauge } from "lucide-react";
import { GlobalChatSettings } from "@/components/admin/GlobalChatSettings";
import { PlanFeaturesManager } from "@/components/admin/PlanFeaturesManager";
import { PlanQuotaEditor } from "@/components/admin/PlanQuotaEditor";
import { TestConfirmationEmailCard } from "@/components/admin/TestConfirmationEmailCard";
import { CustomerLoginSettingsCard } from "@/components/admin/CustomerLoginSettingsCard";
import { CheckoutComPlatformSettingsCard } from "@/components/admin/CheckoutComPlatformSettingsCard";
import { CloudflareSettingsCard } from "@/components/admin/CloudflareSettingsCard";
import { HyperPaySettingsCard } from "@/components/admin/HyperPaySettingsCard";
import { PromotionCampaignCard } from "@/components/admin/PromotionCampaignCard";
import { supabase } from "@/integrations/supabase/client";

interface Plan {
  id: string;
  name: string;
  price: number;
  quota_limits: Record<string, number>;
}

export default function AdminSettings() {
  const [plans, setPlans] = useState<Plan[]>([]);

  const fetchPlans = async () => {
    const { data } = await supabase
      .from("plans")
      .select("id, name, price, quota_limits")
      .eq("is_active", true)
      .order("price", { ascending: true });
    
    setPlans((data || []).map(p => ({
      ...p,
      quota_limits: (p.quota_limits && typeof p.quota_limits === 'object' && !Array.isArray(p.quota_limits))
        ? p.quota_limits as Record<string, number>
        : {}
    })));
  };

  useEffect(() => {
    fetchPlans();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Platform Settings
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure global platform settings, subscription plans, and preferences.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-border/40">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg font-medium">Security</CardTitle>
            </div>
            <CardDescription>
              Manage platform security settings
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">RLS Policies</span>
                <Badge variant="default">Enabled</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Tenant Isolation</span>
                <Badge variant="default">Active</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/40">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-blue-500" />
              <CardTitle className="text-lg font-medium">Database</CardTitle>
            </div>
            <CardDescription>
              Database configuration status
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Multi-tenant</span>
                <Badge variant="default">Configured</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Backups</span>
                <Badge variant="secondary">Managed</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/40 md:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-amber-500" />
              <CardTitle className="text-lg font-medium">Notifications</CardTitle>
            </div>
            <CardDescription>
              Platform-wide notification settings
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Notification settings for tenant alerts, system maintenance, and usage warnings 
              will be configurable here in future updates.
            </p>
          </CardContent>
        </Card>

        <TestConfirmationEmailCard />

        <div className="md:col-span-2">
          <CustomerLoginSettingsCard />
        </div>

        <CheckoutComPlatformSettingsCard />

        <CloudflareSettingsCard />

        <HyperPaySettingsCard />
      </div>

      <Separator />

      {/* Launch Promotions */}
      <PromotionCampaignCard />

      <Separator />

      {/* Subscription Plan Features */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-medium text-foreground">Subscription Plans</h2>
        </div>
        <PlanFeaturesManager />
      </div>

      <Separator />

      {/* Plan Quotas */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Gauge className="h-5 w-5 text-purple-500" />
          <h2 className="text-lg font-medium text-foreground">Plan Usage Quotas</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Configure usage limits for each subscription tier (users, menu items, images, emails).
        </p>
        <div className="grid gap-4 lg:grid-cols-3">
          {plans.map((plan) => (
            <PlanQuotaEditor key={plan.id} plan={plan} onSaved={fetchPlans} />
          ))}
        </div>
      </div>

      <Separator />

      {/* Global Chat Settings */}
      <GlobalChatSettings />
    </div>
  );
}