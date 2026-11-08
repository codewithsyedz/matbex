import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/integrations/db/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { leadAttributionPayload, trackAdLead } from "@/lib/adConsent";
import {
  Loader2,
  Building2,
  Clock,
  Users,
  CheckCircle2,
  ArrowRight,
  Rocket,
  LayoutDashboard,
  UtensilsCrossed,
  Globe,
  CalendarCheck2,
  Copy,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageTransition } from "@/components/PageTransition";

const currencies = [
  { code: "SAR", name: "Saudi Riyal", symbol: "﷼" },
  { code: "USD", name: "US Dollar", symbol: "$" },
  { code: "EUR", name: "Euro", symbol: "€" },
  { code: "GBP", name: "British Pound", symbol: "£" },
  { code: "AED", name: "UAE Dirham", symbol: "د.إ" },
];

const timezones = [
  { value: "Asia/Riyadh", label: "Riyadh (GMT+3)" },
  { value: "Asia/Dubai", label: "Dubai (GMT+4)" },
  { value: "Europe/London", label: "London (GMT)" },
  { value: "America/New_York", label: "New York (GMT-5)" },
];

const stepDefs = [
  { id: 1, key: "restaurant", icon: Building2 },
  { id: 2, key: "shifts", icon: Clock },
  { id: 3, key: "drawers", icon: Users },
  { id: 4, key: "live", icon: Rocket },
] as const;

// Onboarding wizard component
export default function Onboarding() {
  const { t } = useTranslation();
  const { user, refreshProfile, tenant, restaurants, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  
  // Step 1: Restaurant details
  const [restaurantName, setRestaurantName] = useState("");
  const [currency, setCurrency] = useState("SAR");
  const [timezone, setTimezone] = useState("Asia/Riyadh");
  
  // Step 2: Shift templates
  const [shiftTemplates, setShiftTemplates] = useState([
    { name: "", startTime: "11:00", endTime: "23:00", defaultFloat: 500 },
    { name: "", startTime: "23:00", endTime: "11:00", defaultFloat: 500 },
  ]);
  
  // Step 3: Drawers
  const [drawers, setDrawers] = useState([
    { name: "" },
    { name: "" },
  ]);

  const [createdRestaurantId, setCreatedRestaurantId] = useState<string | null>(null);
  const [createdTenantId, setCreatedTenantId] = useState<string | null>(null);
  // Once setup finishes we show the "You're live" step instead of bouncing
  // straight to the dashboard, so the auto-redirect below must stand down.
  const [setupDone, setSetupDone] = useState(false);

  // Redirect logic - runs before render
  useEffect(() => {
    if (authLoading || setupDone) return;
    
    if (!user) {
      navigate("/auth", { replace: true });
      return;
    }
    
    // If user already has an active restaurant, skip onboarding
    if (tenant && restaurants.length > 0) {
      navigate("/dashboard", { replace: true });
    }
  }, [user, tenant, restaurants, navigate, authLoading, setupDone]);

  // Show loading while auth is being checked
  if (authLoading || (!setupDone && user && tenant && restaurants.length > 0)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const handleStep1 = async () => {
    if (!restaurantName.trim()) {
      toast.error(t("app.onboarding.step1.nameRequired"));
      return;
    }

    setLoading(true);
    try {
      // Every new account starts on a 14-day free trial (no card).
      let plan = "growth";
      try {
        const p = localStorage.getItem("matbex_trial_plan");
        if (p === "starter" || p === "growth" || p === "enterprise") plan = p;
      } catch { /* ignore */ }
      const { data: trial, error: trialError } = await db.functions.invoke("start-free-trial", {
        body: {
          restaurantName: restaurantName.trim(),
          currency,
          timezone,
          plan,
          attribution: await leadAttributionPayload(),
        },
      });
      const serverError = (trial as { error?: string } | null)?.error;
      if (trialError || serverError || !trial?.tenant_id) {
        throw new Error(serverError || trialError?.message || "Could not start your trial");
      }
      const tenantId = trial.tenant_id as string;
      const restaurantId = trial.restaurant_id as string;
      if (!trial.already_exists) void trackAdLead("CompleteRegistration", tenantId);
      try { localStorage.removeItem("matbex_trial_plan"); } catch { /* ignore */ }

      setCreatedTenantId(tenantId);
      setCreatedRestaurantId(restaurantId);
      setCurrentStep(2);
      toast.success(t("app.onboarding.step1.created"));
    } catch (error: any) {
      toast.error(error.message || t("app.onboarding.step1.createFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleStep2 = async () => {
    if (!createdRestaurantId) return;

    setLoading(true);
    try {
      const templatesData = shiftTemplates
        .filter((t) => t.name.trim())
        .map((t) => ({
          restaurant_id: createdRestaurantId,
          name: t.name.trim(),
          start_time: t.startTime,
          end_time: t.endTime,
          default_float: t.defaultFloat,
        }));

      if (templatesData.length > 0) {
        const { error } = await db
          .from("shift_templates")
          .insert(templatesData);

        if (error) throw error;
      }

      setCurrentStep(3);
      toast.success(t("app.onboarding.step2.saved"));
    } catch (error: any) {
      toast.error(error.message || t("app.onboarding.step2.saveFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleStep3 = async () => {
    if (!createdRestaurantId) return;

    setLoading(true);
    try {
      const drawersData = drawers
        .filter((d) => d.name.trim())
        .map((d) => ({
          restaurant_id: createdRestaurantId,
          name: d.name.trim(),
        }));

      if (drawersData.length > 0) {
        const { error } = await db.from("drawers").insert(drawersData);

        if (error) throw error;
      }

      setSetupDone(true);
      await refreshProfile();
      toast.success(t("app.onboarding.step3.complete"));
      setCurrentStep(4);
    } catch (error: any) {
      toast.error(error.message || t("app.onboarding.step3.saveFailed"));
    } finally {
      setLoading(false);
    }
  };

  const updateShiftTemplate = (index: number, field: string, value: string | number) => {
    setShiftTemplates((prev) =>
      prev.map((t, i) => (i === index ? { ...t, [field]: value } : t))
    );
  };

  const updateDrawer = (index: number, name: string) => {
    setDrawers((prev) =>
      prev.map((d, i) => (i === index ? { ...d, name } : d))
    );
  };

  return (
    <PageTransition className="min-h-screen bg-background flex items-center justify-center p-8">
      <div className="w-full max-w-xl space-y-8">
        {/* Progress steps */}
        <div className="flex items-center justify-center gap-4">
          {stepDefs.map((step, index) => (
            <div key={step.id} className="flex items-center">
              <div
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-full transition-all duration-300",
                  currentStep === step.id
                    ? "bg-primary text-primary-foreground"
                    : currentStep > step.id
                    ? "bg-success/10 text-success"
                    : "bg-accent text-muted-foreground"
                )}
              >
                {currentStep > step.id ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <step.icon className="h-4 w-4" />
                )}
                <span className="text-sm font-medium">{t(`app.onboarding.steps.${step.key}`)}</span>
              </div>
              {index < stepDefs.length - 1 && (
                <div
                  className={cn(
                    "w-8 h-px mx-2 transition-colors",
                    currentStep > step.id ? "bg-success" : "bg-border"
                  )}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="bg-card border rounded-lg p-8 fade-slide-in">
          {currentStep === 1 && (
            <div className="space-y-6">
              <div className="space-y-2">
                <h2 className="text-xl font-semibold">{t("app.onboarding.step1.title")}</h2>
                <p className="text-sm text-muted-foreground">
                  {t("app.onboarding.step1.subtitle")}
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="restaurantName">{t("app.onboarding.step1.restaurantName")}</Label>
                  <Input
                    id="restaurantName"
                    placeholder={t("app.onboarding.step1.restaurantPlaceholder")}
                    value={restaurantName}
                    onChange={(e) => setRestaurantName(e.target.value)}
                    disabled={loading}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t("app.onboarding.step1.currency")}</Label>
                    <Select value={currency} onValueChange={setCurrency} disabled={loading}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {currencies.map((c) => (
                          <SelectItem key={c.code} value={c.code}>
                            {c.symbol} {c.code}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>{t("app.onboarding.step1.timezone")}</Label>
                    <Select value={timezone} onValueChange={setTimezone} disabled={loading}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {timezones.map((tz) => (
                          <SelectItem key={tz.value} value={tz.value}>
                            {tz.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <Button onClick={handleStep1} className="w-full group" disabled={loading}>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    {t("app.onboarding.continue")}
                    <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </>
                )}
              </Button>
            </div>
          )}

          {currentStep === 2 && (
            <div className="space-y-6">
              <div className="space-y-2">
                <h2 className="text-xl font-semibold">{t("app.onboarding.step2.title")}</h2>
                <p className="text-sm text-muted-foreground">
                  {t("app.onboarding.step2.subtitle")}
                </p>
              </div>

              <div className="space-y-4">
                {shiftTemplates.map((template, index) => (
                  <div
                    key={index}
                    className="p-4 border rounded-lg space-y-3 fade-slide-in"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <Input
                      placeholder={t("app.onboarding.step2.shiftName")}
                      value={template.name}
                      onChange={(e) => updateShiftTemplate(index, "name", e.target.value)}
                      disabled={loading}
                    />
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">{t("app.onboarding.step2.start")}</Label>
                        <Input
                          type="time"
                          value={template.startTime}
                          onChange={(e) => updateShiftTemplate(index, "startTime", e.target.value)}
                          disabled={loading}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">{t("app.onboarding.step2.end")}</Label>
                        <Input
                          type="time"
                          value={template.endTime}
                          onChange={(e) => updateShiftTemplate(index, "endTime", e.target.value)}
                          disabled={loading}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">{t("app.onboarding.step2.float", { currency })}</Label>
                        <Input
                          type="number"
                          value={template.defaultFloat}
                          onChange={(e) => updateShiftTemplate(index, "defaultFloat", Number(e.target.value))}
                          disabled={loading}
                        />
                      </div>
                    </div>
                  </div>
                ))}

                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    setShiftTemplates((prev) => [
                      ...prev,
                      { name: "", startTime: "08:00", endTime: "16:00", defaultFloat: 500 },
                    ])
                  }
                  disabled={loading}
                >
                  {t("app.onboarding.step2.addTemplate")}
                </Button>
              </div>

              <Button onClick={handleStep2} className="w-full group" disabled={loading}>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    {t("app.onboarding.continue")}
                    <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </>
                )}
              </Button>
            </div>
          )}

          {currentStep === 3 && (
            <div className="space-y-6">
              <div className="space-y-2">
                <h2 className="text-xl font-semibold">{t("app.onboarding.step3.title")}</h2>
                <p className="text-sm text-muted-foreground">
                  {t("app.onboarding.step3.subtitle")}
                </p>
              </div>

              <div className="space-y-3">
                {drawers.map((drawer, index) => (
                  <Input
                    key={index}
                    placeholder={t("app.onboarding.step3.drawerName")}
                    value={drawer.name}
                    onChange={(e) => updateDrawer(index, e.target.value)}
                    disabled={loading}
                    className="fade-slide-in"
                    style={{ animationDelay: `${index * 50}ms` }}
                  />
                ))}

                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setDrawers((prev) => [...prev, { name: "" }])}
                  disabled={loading}
                >
                  {t("app.onboarding.step3.addDrawer")}
                </Button>
              </div>

              <Button onClick={handleStep3} className="w-full group" disabled={loading}>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    {t("app.onboarding.completeSetup")}
                    <CheckCircle2 className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          )}

          {currentStep === 4 && (
            <div className="space-y-6">
              <div className="space-y-2">
                <h2 className="text-xl font-semibold">
                  {t("app.onboarding.step4.title", "Your restaurant is live")}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t(
                    "app.onboarding.step4.subtitle",
                    "Three things are ready for you right now. Start with the menu — your ordering page shows whatever you add there.",
                  )}
                </p>
              </div>

              <div className="space-y-3">
                {[
                  {
                    icon: LayoutDashboard,
                    title: t("app.onboarding.step4.dashboard", "Owner dashboard"),
                    body: t("app.onboarding.step4.dashboardBody", "Sales, costs and daily profit for this restaurant."),
                    to: "/dashboard",
                  },
                  {
                    icon: UtensilsCrossed,
                    title: t("app.onboarding.step4.menu", "Menu builder"),
                    body: t("app.onboarding.step4.menuBody", "Add categories, items, photos and prices."),
                    to: "/menu",
                  },
                  {
                    icon: Globe,
                    title: t("app.onboarding.step4.orders", "Live ordering page"),
                    body: t("app.onboarding.step4.ordersBody", "Your public page where customers browse and order."),
                    to: `/order/${createdRestaurantId}`,
                  },
                  {
                    icon: CalendarCheck2,
                    title: t("app.onboarding.step4.bookings", "Live bookings page"),
                    body: t(
                      "app.onboarding.step4.bookingsBody",
                      "Guests request a table online; requests land in Table Bookings.",
                    ),
                    to: `/book/${createdRestaurantId}`,
                  },
                ].map((card, index) => (
                  <button
                    key={card.to}
                    type="button"
                    onClick={() => navigate(card.to)}
                    className="w-full text-left flex items-start gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent fade-slide-in"
                    style={{ animationDelay: `${index * 60}ms` }}
                  >
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <card.icon className="h-4 w-4" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium">{card.title}</span>
                      <span className="block text-xs text-muted-foreground mt-0.5">{card.body}</span>
                    </span>
                    <ArrowRight className="mt-2 h-4 w-4 text-muted-foreground" />
                  </button>
                ))}
              </div>

              <div className="rounded-lg border border-dashed border-border p-3">
                <p className="text-xs text-muted-foreground mb-2">
                  {t("app.onboarding.step4.shareLink", "Share this link with customers")}
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-muted px-2 py-1.5 text-xs">
                    {`${window.location.origin}/order/${createdRestaurantId}`}
                  </code>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={t("app.onboarding.step4.copy", "Copy link")}
                    onClick={async () => {
                      await navigator.clipboard.writeText(`${window.location.origin}/order/${createdRestaurantId}`);
                      toast.success(t("app.onboarding.step4.copied", "Link copied"));
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="icon" asChild aria-label={t("app.onboarding.step4.open", "Open")}>
                    <a href={`/order/${createdRestaurantId}`} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                </div>
              </div>

              <Button onClick={() => navigate("/menu")} className="w-full group">
                {t("app.onboarding.step4.cta", "Build my menu")}
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
