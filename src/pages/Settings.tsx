import { Coins, RefreshCw, User, Shield, Database, Target, UtensilsCrossed, Monitor, Printer, Bell, Palette, Languages, ClipboardCheck, ScanLine, Building2, CreditCard, Rocket, Calculator } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCurrency, SUPPORTED_CURRENCIES } from "@/hooks/useCurrency";
import { OverheadAllocationSettings } from "@/components/settings/OverheadAllocationSettings";
import { OverheadPaymentManager } from "@/components/settings/OverheadPaymentManager";
import { StaffRatesSettings } from "@/components/settings/StaffRatesSettings";
import { MenuItemsManager } from "@/components/pos/MenuItemsManager";
import { ProfitTargetsSettings } from "@/components/settings/ProfitTargetsSettings";
import { FiscalMonthSettings } from "@/components/settings/FiscalMonthSettings";
import { DemoActivateCard } from "@/components/demo/DemoActivateCard";
import { DaypartSettings } from "@/components/settings/DaypartSettings";
import { DataExportManager } from "@/components/settings/DataExportManager";
import { SessionManager } from "@/components/settings/SessionManager";
import { MFASettings } from "@/components/settings/MFASettings";
import { ImpersonationHistoryCard } from "@/components/auth/ImpersonationHistoryCard";
import { ImpersonationAnalyticsCard } from "@/components/auth/ImpersonationAnalyticsCard";
import { AdminPinCard } from "@/components/settings/AdminPinCard";
import { WorkspaceCodeCard } from "@/components/settings/WorkspaceCodeCard";
import { ProfileSettings } from "@/components/settings/ProfileSettings";
import { MobileCockpitCard } from "@/components/settings/MobileCockpitCard";
import { DrawerManager } from "@/components/settings/DrawerManager";
import { VarianceSettings } from "@/components/settings/VarianceSettings";
import { POSHardwareSettings } from "@/components/settings/POSHardwareSettings";
import { CFDDisplaySettings } from "@/components/settings/CFDDisplaySettings";
import { CFDIdleScreenManager } from "@/components/settings/CFDIdleScreenManager";
import { HardwareSettings } from "@/components/settings/HardwareSettings";
import { ToastPositionSettings } from "@/components/settings/ToastPositionSettings";
import { NotificationPreferences } from "@/components/settings/NotificationPreferences";
import { WhatsAppSummarySettings } from "@/components/settings/WhatsAppSummarySettings";
import { TwilioSettings } from "@/components/settings/TwilioSettings";
import { TwilioCredentialsForm } from "@/components/settings/TwilioCredentialsForm";
import { WhatsAppSummaryPreview } from "@/components/settings/WhatsAppSummaryPreview";
import { RiyadhCutoffTester } from "@/components/settings/RiyadhCutoffTester";
import { WhatsAppDeliveryAudit } from "@/components/settings/WhatsAppDeliveryAudit";
import { WhatsAppResendCard } from "@/components/settings/WhatsAppResendCard";
import { NotificationTemplatesCard } from "@/components/settings/NotificationTemplatesCard";
import { RestaurantNotificationChannelsCard } from "@/components/settings/RestaurantNotificationChannelsCard";
import { AuthRedirectAllowlistCheck } from "@/components/settings/AuthRedirectAllowlistCheck";
import { BrandingSettings } from "@/components/settings/BrandingSettings";
import { LocaleSettings } from "@/components/settings/LocaleSettings";
import { BranchManager } from "@/components/settings/BranchManager";
import { CoAMappingAuditScreen } from "@/components/accounting/CoAMappingAuditScreen";
import { ZatcaSettings } from "@/components/settings/ZatcaSettings";
import { ZatcaDevices } from "@/components/settings/ZatcaDevices";
import { ZatcaClearanceStatus } from "@/components/settings/ZatcaClearanceStatus";
import { ZatcaCreditNotes } from "@/components/settings/ZatcaCreditNotes";
import { PaymentGatewaySettings } from "@/components/settings/PaymentGatewaySettings";
import { MigrationWizard } from "@/components/migration/MigrationWizard";
import { AccountingIntegrationSettings } from "@/components/settings/AccountingIntegrationSettings";
import { QuickBooksIntegrationSettings } from "@/components/settings/QuickBooksIntegrationSettings";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

export default function Settings() {
  const { t } = useTranslation();
  const { hasRole } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") ?? "profile";
  const handleTabChange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === "profile") next.delete("tab"); else next.set("tab", value);
    setSearchParams(next, { replace: true });
  };
  const { 
    baseCurrency, 
    displayCurrency,
    setDisplayCurrency,
    updateCurrency, 
    isUpdating,
    exchangeRates,
    ratesLoading,
  } = useCurrency();

  const handleCurrencyChange = (newCurrency: string) => {
    updateCurrency(newCurrency, {
      onSuccess: () => {
        toast.success(`Currency updated to ${newCurrency}`);
      },
      onError: () => {
        toast.error(t("settings.updateCurrencyFailed"));
      },
    });
  };

  return (
    <>
      <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
        <header className="fade-slide-in mb-6">
          <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">
            {t("settings.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("settings.subtitle")}
          </p>
        </header>
        <DemoActivateCard />

        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          <TabsList className="w-full justify-start mb-6 flex-wrap h-auto gap-1 bg-transparent p-0">
            <TabsTrigger value="profile" className="gap-2 data-[state=active]:bg-accent">
              <User className="h-4 w-4" />
              <span className="hidden sm:inline">{t("settings.profile")}</span>
            </TabsTrigger>
            <TabsTrigger value="locale" className="gap-2 data-[state=active]:bg-accent">
              <Languages className="h-4 w-4" />
              <span className="hidden sm:inline">{t("settings.language")}</span>
            </TabsTrigger>
            <TabsTrigger value="currency" className="gap-2 data-[state=active]:bg-accent">
              <Coins className="h-4 w-4" />
              <span className="hidden sm:inline">{t("settings.currency")}</span>
            </TabsTrigger>
            <TabsTrigger value="business" className="gap-2 data-[state=active]:bg-accent">
              <Target className="h-4 w-4" />
              <span className="hidden sm:inline">{t("settings.business")}</span>
            </TabsTrigger>
            {(hasRole("owner") || hasRole("manager")) && (
              <TabsTrigger value="branches" className="gap-2 data-[state=active]:bg-accent">
                <Building2 className="h-4 w-4" />
                <span className="hidden sm:inline">{t("settings.branches")}</span>
              </TabsTrigger>
            )}
            <TabsTrigger value="shifts" className="gap-2 data-[state=active]:bg-accent">
              <Monitor className="h-4 w-4" />
              <span className="hidden sm:inline">{t("settings.shiftsTab")}</span>
            </TabsTrigger>
            <TabsTrigger value="pos-hardware" className="gap-2 data-[state=active]:bg-accent">
              <Printer className="h-4 w-4" />
              <span className="hidden sm:inline">{t("settings.pos")}</span>
            </TabsTrigger>
            <TabsTrigger value="menu" className="gap-2 data-[state=active]:bg-accent">
              <UtensilsCrossed className="h-4 w-4" />
              <span className="hidden sm:inline">{t("settings.menuTab")}</span>
            </TabsTrigger>
            <TabsTrigger value="security" className="gap-2 data-[state=active]:bg-accent">
              <Shield className="h-4 w-4" />
              <span className="hidden sm:inline">{t("settings.security")}</span>
            </TabsTrigger>
            {hasRole("owner") && (
              <TabsTrigger value="notifications" className="gap-2 data-[state=active]:bg-accent">
                <Bell className="h-4 w-4" />
                <span className="hidden sm:inline">{t("settings.notifications")}</span>
              </TabsTrigger>
            )}
            {hasRole("owner") && (
              <TabsTrigger value="branding" className="gap-2 data-[state=active]:bg-accent">
                <Palette className="h-4 w-4" />
                <span className="hidden sm:inline">{t("settings.branding")}</span>
              </TabsTrigger>
            )}
            <TabsTrigger value="data" className="gap-2 data-[state=active]:bg-accent">
              <Database className="h-4 w-4" />
              <span className="hidden sm:inline">{t("settings.dataExport")}</span>
            </TabsTrigger>
            {(hasRole("owner") || hasRole("manager")) && (
              <TabsTrigger value="coa-mapping" className="gap-2 data-[state=active]:bg-accent">
                <ClipboardCheck className="h-4 w-4" />
                <span className="hidden sm:inline">CoA Mapping</span>
              </TabsTrigger>
            )}
            {(hasRole("owner") || hasRole("manager")) && (
              <TabsTrigger value="zatca" className="gap-2 data-[state=active]:bg-accent">
                <ScanLine className="h-4 w-4" />
                <span className="hidden sm:inline">ZATCA</span>
              </TabsTrigger>
            )}
            {(hasRole("owner") || hasRole("manager")) && (
              <TabsTrigger value="payments" className="gap-2 data-[state=active]:bg-accent">
                <CreditCard className="h-4 w-4" />
                <span className="hidden sm:inline">Payments</span>
              </TabsTrigger>
            )}
            {(hasRole("owner") || hasRole("manager")) && (
              <TabsTrigger value="migration" className="gap-2 data-[state=active]:bg-accent">
                <Rocket className="h-4 w-4" />
                <span className="hidden sm:inline">Migration</span>
              </TabsTrigger>
            )}
            {hasRole("owner") && (
              <TabsTrigger value="accounting" className="gap-2 data-[state=active]:bg-accent">
                <Calculator className="h-4 w-4" />
                <span className="hidden sm:inline">Accounting</span>
              </TabsTrigger>
            )}
          </TabsList>

          {/* Profile Tab */}
          <TabsContent value="profile" className="space-y-6 fade-slide-in">
            <ProfileSettings />
            <MobileCockpitCard />
            <ToastPositionSettings />
          </TabsContent>

          {/* Locale Tab */}
          <TabsContent value="locale" className="fade-slide-in">
            <LocaleSettings />
          </TabsContent>

          {/* Currency Tab */}
          <TabsContent value="currency" className="space-y-4 fade-slide-in">
            {/* Base Currency */}
            <div className="p-5 rounded-lg border bg-card">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-4">
                  <div className="p-2 rounded-md bg-accent text-accent-foreground">
                    <Coins className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground">Base Currency</h3>
                    <p className="text-sm text-muted-foreground">
                      Set your default currency for all transactions
                    </p>
                  </div>
                </div>
                <Select 
                  value={baseCurrency} 
                  onValueChange={handleCurrencyChange}
                  disabled={isUpdating}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_CURRENCIES.map((curr) => (
                      <SelectItem key={curr.code} value={curr.code}>
                        <span className="flex items-center gap-2">
                          <span className="text-muted-foreground">{curr.symbol}</span>
                          <span>{curr.code}</span>
                          <span className="text-muted-foreground text-xs">
                            {curr.name}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Display Currency */}
            <div className="p-5 rounded-lg border bg-card">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-4">
                  <div className="p-2 rounded-md bg-accent text-accent-foreground">
                    <RefreshCw className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground">Display Currency</h3>
                    <p className="text-sm text-muted-foreground">
                      View amounts in a different currency (with live conversion)
                    </p>
                    {exchangeRates && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Rates: {exchangeRates.source === "live" ? "Live" : "Estimated"} •{" "}
                        Updated {new Date(exchangeRates.timestamp).toLocaleTimeString()}
                      </p>
                    )}
                  </div>
                </div>
                <Select 
                  value={displayCurrency} 
                  onValueChange={setDisplayCurrency}
                  disabled={ratesLoading}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_CURRENCIES.map((curr) => (
                      <SelectItem key={curr.code} value={curr.code}>
                        <span className="flex items-center gap-2">
                          <span className="text-muted-foreground">{curr.symbol}</span>
                          <span>{curr.code}</span>
                          {curr.code !== baseCurrency && exchangeRates?.rates[curr.code] && (
                            <span className="text-muted-foreground text-xs">
                              ×{exchangeRates.rates[curr.code].toFixed(4)}
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </TabsContent>

          {/* Business Tab */}
          <TabsContent value="business" className="space-y-6 fade-slide-in">
            <FiscalMonthSettings />
            <DaypartSettings />
            <OverheadAllocationSettings />
            <OverheadPaymentManager />
            <StaffRatesSettings />
            <ProfitTargetsSettings />
          </TabsContent>

          {/* Branches Tab - Owners & Managers */}
          {(hasRole("owner") || hasRole("manager")) && (
            <TabsContent value="branches" className="fade-slide-in">
              <BranchManager />
            </TabsContent>
          )}

          {/* Menu Tab */}
          <TabsContent value="menu" className="fade-slide-in">
            <MenuItemsManager />
          </TabsContent>

          {/* Shifts Tab */}
          <TabsContent value="shifts" className="space-y-6 fade-slide-in">
            <DrawerManager />
            <VarianceSettings />
          </TabsContent>

          {/* POS Hardware Tab */}
          <TabsContent value="pos-hardware" className="fade-slide-in">
            <div className="space-y-8">
              <HardwareSettings />
              <POSHardwareSettings />
              <CFDDisplaySettings />
              <CFDIdleScreenManager />
            </div>
          </TabsContent>

          {/* Security Tab */}
          <TabsContent value="security" className="space-y-6 fade-slide-in">
            <SessionManager />
            <MFASettings />
            <AdminPinCard />
            <WorkspaceCodeCard />
            <ImpersonationAnalyticsCard />
            <ImpersonationHistoryCard />
          </TabsContent>

          {/* Notifications Tab - Owners only */}
          {hasRole("owner") && (
            <TabsContent value="notifications" className="fade-slide-in">
              <NotificationPreferences />
              <div className="mt-6">
                <RestaurantNotificationChannelsCard />
              </div>
              <div className="mt-6">
                <TwilioSettings />
              </div>
              <div className="mt-6">
                <TwilioCredentialsForm />
              </div>
              <div className="mt-6">
                <WhatsAppSummarySettings />
              </div>
              <div className="mt-6">
                <WhatsAppSummaryPreview />
              </div>
              <div className="mt-6">
                <RiyadhCutoffTester />
              </div>
              <div className="mt-6">
                <AuthRedirectAllowlistCheck />
              </div>
              <div className="mt-6">
                <WhatsAppResendCard />
              </div>
              <div className="mt-6">
                <NotificationTemplatesCard />
              </div>
              <div className="mt-6">
                <WhatsAppDeliveryAudit />
              </div>
            </TabsContent>
          )}

          {/* Branding Tab - Owners only */}
          {hasRole("owner") && (
            <TabsContent value="branding" className="fade-slide-in">
              <BrandingSettings />
            </TabsContent>
          )}

          {/* Data Tab */}
          <TabsContent value="data" className="fade-slide-in">
            <DataExportManager />
          </TabsContent>

          {/* CoA Mapping Tab - Owners & Managers */}
          {(hasRole("owner") || hasRole("manager")) && (
            <TabsContent value="coa-mapping" className="space-y-4 fade-slide-in">
              <div className="rounded-lg border bg-card p-5">
                <h3 className="font-medium text-foreground">Expense → CoA mapping rules</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Choose for each expense category whether new expenses post to an{" "}
                  <strong>Inventory asset</strong> (1200/1210/1220 - raw stock that hits COGS later),{" "}
                  a <strong>COGS account</strong> (immediate cost of sales), or an{" "}
                  <strong>Operating expense</strong> account.
                </p>
              </div>
              <CoAMappingAuditScreen />
            </TabsContent>
          )}

          {/* ZATCA Tab - Owners & Managers */}
          {(hasRole("owner") || hasRole("manager")) && (
            <TabsContent value="zatca" className="fade-slide-in">
              <div className="space-y-6">
                <ZatcaSettings />
                <ZatcaDevices />
                <ZatcaClearanceStatus />
                <ZatcaCreditNotes />
              </div>
            </TabsContent>
          )}

          {/* Payments Tab - Owners & Managers */}
          {(hasRole("owner") || hasRole("manager")) && (
            <TabsContent value="payments" className="fade-slide-in">
              <PaymentGatewaySettings />
            </TabsContent>
          )}

          {/* Migration Tab - Owners & Managers */}
          {(hasRole("owner") || hasRole("manager")) && (
            <TabsContent value="migration" className="fade-slide-in">
              <MigrationWizard />
            </TabsContent>
          )}

          {/* Accounting Integrations Tab - Owners only */}
          {hasRole("owner") && (
            <TabsContent value="accounting" className="fade-slide-in">
              <div className="space-y-8">
                <AccountingIntegrationSettings />
                <QuickBooksIntegrationSettings />
              </div>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </>
  );
}