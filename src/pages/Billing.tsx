import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Check, Crown, Zap, Building2, Loader2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Navigate, useSearchParams } from "react-router-dom";
import { TrialCountdownCard } from "@/components/billing/TrialCountdownCard";
import { AddonCatalog } from "@/components/billing/AddonCatalog";
import { Sparkles } from "lucide-react";
import { PLAN_PRICES_SAR, planKeyFromName } from "@/data/pricing";

interface Plan {
  id: string;
  name: string;
  description: string | null;
  price: number;
  billing_interval: string;
  default_feature_flags: Record<string, boolean>;
}

const PLAN_FEATURES: Record<string, string[]> = {
  free: [
    "1 restaurant location",
    "Basic shift management",
    "Daily profit tracking",
    "Up to 3 team members",
  ],
  pro: [
    "Up to 5 restaurant locations",
    "Full shift & cash management",
    "Daily profit with email reports",
    "Inventory management",
    "Unlimited team members",
    "Priority support",
  ],
  enterprise: [
    "Unlimited locations",
    "Everything in Pro",
    "API access",
    "Advanced analytics",
    "Dedicated account manager",
    "Custom integrations",
  ],
};

const PLAN_ICONS: Record<string, React.ReactNode> = {
  free: <Building2 className="h-5 w-5" />,
  pro: <Zap className="h-5 w-5" />,
  enterprise: <Crown className="h-5 w-5" />,
};

export default function Billing() {
  const { t } = useTranslation();
  const { tenant, plan: currentPlan, refreshProfile, isOwner, loading: authLoading } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [searchParams] = useSearchParams();

  useEffect(() => {
    if (searchParams.get("canceled") === "true") toast.info("Checkout was canceled");
  }, [searchParams]);

  useEffect(() => {
    const fetchPlans = async () => {
      const { data } = await supabase
        .from("plans")
        .select("*")
        .eq("is_active", true)
        .order("price", { ascending: true });

      setPlans(
        (data || []).filter(p => ["starter", "pro", "enterprise"].includes(p.name.toLowerCase())).map((p) => ({
          ...p,
          default_feature_flags:
            p.default_feature_flags &&
            typeof p.default_feature_flags === "object" &&
            !Array.isArray(p.default_feature_flags)
              ? (p.default_feature_flags as Record<string, boolean>)
              : {},
        }))
      );
      setLoading(false);
    };

    fetchPlans();
  }, []);

  const handleUpgrade = async (plan: Plan) => {
    if (!tenant || !isOwner) {
      toast.error("Only tenant owners can change the subscription plan");
      return;
    }

    setUpgrading(plan.id);
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: { planName: plan.name },
      });

      if (error) throw error;
      if (data?.url) {
        window.location.assign(data.url);
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (error) {
      console.error("Error creating checkout:", error);
      toast.error("Failed to start checkout");
    } finally {
      setUpgrading(null);
    }
  };

  const handleManageSubscription = async () => {
    setOpeningPortal(true);
    try {
      const { data, error } = await supabase.functions.invoke("customer-portal");

      if (error) throw error;
      if (data?.url) {
        window.open(data.url, "_blank");
      } else {
        throw new Error("No portal URL returned");
      }
    } catch (error) {
      console.error("Error opening customer portal:", error);
      toast.error("Failed to open subscription management");
    } finally {
      setOpeningPortal(false);
    }
  };

  const isCurrentPlan = (planId: string) => currentPlan?.id === planId;
  const isPaidPlan = tenant?.status === "active";
  const isTrial = tenant?.status === "trial";
  if (!authLoading && !isOwner) return <Navigate to="/dashboard" replace />;

  return (
    <>
      <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
        {/* Header */}
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">
            {t("billing.heading")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("billing.subtitle")}
          </p>
        </div>

        <TrialCountdownCard />

        {/* Current Plan */}
        <Card className="border-border/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">{t("billing.currentPlan")}</CardTitle>
            <CardDescription>
              {t("billing.currentPlanDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center text-primary">
                  {PLAN_ICONS[currentPlan?.name.toLowerCase() || "free"] || PLAN_ICONS.free}
                </div>
                <div>
                  <p className="font-medium text-foreground capitalize">
                    {currentPlan?.name || t("billing.freePlan")} {t("billing.planSuffix")}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {currentPlan ? `SAR ${plans.find(p => p.id === currentPlan.id)?.price || 0}${t("billing.perMonth")}` : t("billing.noActivePlan")}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {tenant?.status === "trial" && (
                  <Badge variant="secondary">{t("billing.trial")}</Badge>
                )}
                {isPaidPlan && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleManageSubscription}
                    disabled={openingPortal}
                  >
                    {openingPortal ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <ExternalLink className="h-4 w-4 mr-2" />
                    )}
                    {t("billing.manageSubscription")}
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Separator />

        {/* Available Plans */}
        <div className="space-y-4">
          <h2 className="text-lg font-medium text-foreground">Available Plans</h2>
          <div className="grid gap-6 md:grid-cols-3">
            {loading
              ? Array.from({ length: 3 }).map((_, i) => (
                  <Card key={i} className="border-border/40 animate-pulse">
                    <CardHeader className="pb-3">
                      <div className="h-6 bg-muted rounded w-1/2" />
                      <div className="h-4 bg-muted rounded w-3/4 mt-2" />
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {Array.from({ length: 4 }).map((_, j) => (
                          <div key={j} className="h-4 bg-muted rounded w-full" />
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))
              : plans.map((plan) => {
                  const isCurrent = isCurrentPlan(plan.id);
                  const features =
                    PLAN_FEATURES[plan.name.toLowerCase()] || [];
                  const currentPlanData = plans.find(p => p.id === currentPlan?.id);
                  const currentPrice = currentPlanData?.price || 0;
                  const isUpgrade = plan.price > currentPrice;

                  return (
                    <Card
                      key={plan.id}
                      className={cn(
                        "border-border/40 relative transition-shadow",
                        isCurrent && "ring-2 ring-primary border-primary"
                      )}
                    >
                      {isCurrent && (
                        <Badge className="absolute -top-2 left-4" variant="default">
                          Current Plan
                        </Badge>
                      )}
                      <CardHeader className="pt-6 pb-3">
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center text-primary">
                            {PLAN_ICONS[plan.name.toLowerCase()] || PLAN_ICONS.free}
                          </div>
                          <CardTitle className="text-base font-medium capitalize">
                            {plan.name}
                          </CardTitle>
                        </div>
                        <CardDescription>
                          {plan.description || `${plan.name} features for your business`}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-6">
                        <div>
                          <span className="text-3xl font-bold text-foreground">
                            SAR {planKeyFromName(plan.name) ? PLAN_PRICES_SAR[planKeyFromName(plan.name) ?? "starter"].monthly : plan.price}
                          </span>
                          <span className="text-muted-foreground">
                            /{plan.billing_interval}
                          </span>
                        </div>

                        <ul className="space-y-2">
                          {features.map((feature, i) => (
                            <li
                              key={i}
                              className="flex items-center gap-2 text-sm text-muted-foreground"
                            >
                              <Check className="h-4 w-4 text-primary flex-shrink-0" />
                              {feature}
                            </li>
                          ))}
                        </ul>

                        <Button
                          className="w-full"
                          variant={isCurrent ? "outline" : "default"}
                          disabled={(isCurrent && !isTrial) || upgrading !== null || !isOwner}
                          onClick={() => handleUpgrade(plan)}
                        >
                          {upgrading === plan.id ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Processing...
                            </>
                          ) : isCurrent && isTrial ? (
                            "Activate Starter"
                          ) : isCurrent ? (
                            "Current Plan"
                          ) : isUpgrade ? (
                            "Upgrade"
                          ) : (
                            "Downgrade"
                          )}
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
          </div>
        </div>

        {!isOwner && (
          <p className="text-sm text-muted-foreground text-center">
            Only tenant owners can change the subscription plan.
          </p>
        )}

        <Separator />

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-medium text-foreground">Module Addons</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Unlock individual modules and quota boosts on top of your plan.
          </p>
          <AddonCatalog />
        </div>
      </div>
    </>
  );
}
