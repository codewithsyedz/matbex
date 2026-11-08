import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { StaffManager } from "@/components/staff/StaffManager";
import { PayrollManager } from "@/components/staff/PayrollManager";
import { StaffSettings } from "@/components/staff/StaffSettings";
import { StaffSummaryCards } from "@/components/staff/StaffSummaryCards";
import { StaffAdvances } from "@/components/staff/StaffAdvances";
import { EmployeeFinesManager } from "@/components/staff/fines/EmployeeFinesManager";
import { Users, Wallet, Settings, Banknote, Gavel } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { LockedFeatureScreen } from "@/components/LockedFeatureScreen";

export default function Staff() {
  const { hasFeature, loading } = useAuth();
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") ?? "staff";
  const handleTabChange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", value);
    if (value !== "payroll") next.delete("payroll");
    setSearchParams(next, { replace: true });
  };

  // Show locked screen if payroll feature is not enabled
  if (!loading && !hasFeature("payroll")) {
    return (
      <>
        <LockedFeatureScreen 
          featureName={t("app.staff.title")}
          description={t("app.staff.lockedDescription")}
          featureKey="payroll"
        />
      </>
    );
  }

  // Check if advance_pay feature is enabled
  const hasAdvancePay = hasFeature("advance_pay");

  return (
    <>
      <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
        <header className="fade-slide-in mb-6">
          <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">
            {t("app.staff.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("app.staff.subtitle")}
          </p>
        </header>

        <div className="mt-6">
          <StaffSummaryCards />
        </div>

        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
          className="mt-2 fade-slide-in"
          style={{ animationDelay: "100ms" }}
        >
          <TabsList className="w-full overflow-x-auto scrollbar-none flex-nowrap justify-start h-auto gap-2 p-2">
            <TabsTrigger value="staff" className="gap-2 whitespace-nowrap min-h-[44px] px-3 py-2 text-sm">
              <Users className="h-4 w-4" />
              {t("app.staff.tabs.staff")}
            </TabsTrigger>
            <TabsTrigger value="payroll" className="gap-2 whitespace-nowrap min-h-[44px] px-3 py-2 text-sm">
              <Wallet className="h-4 w-4" />
              {t("app.staff.tabs.payroll")}
            </TabsTrigger>
            {hasAdvancePay && (
              <TabsTrigger value="advances" className="gap-2 whitespace-nowrap min-h-[44px] px-3 py-2 text-sm">
                <Banknote className="h-4 w-4" />
                {t("app.staff.tabs.advances")}
              </TabsTrigger>
            )}
            <TabsTrigger value="fines" className="gap-2 whitespace-nowrap min-h-[44px] px-3 py-2 text-sm">
              <Gavel className="h-4 w-4" />
              {t("app.staff.tabs.fines")}
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-2 whitespace-nowrap min-h-[44px] px-3 py-2 text-sm">
              <Settings className="h-4 w-4" />
              {t("app.staff.tabs.settings")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="staff" className="mt-6">
            <StaffManager />
          </TabsContent>

          <TabsContent value="payroll" className="mt-6">
            <PayrollManager />
          </TabsContent>

          {hasAdvancePay && (
            <TabsContent value="advances" className="mt-6">
              <StaffAdvances />
            </TabsContent>
          )}

          <TabsContent value="fines" className="mt-6">
            <EmployeeFinesManager />
          </TabsContent>

          <TabsContent value="settings" className="mt-6">
            <StaffSettings />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
