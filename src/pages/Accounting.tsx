import { ChartOfAccountsManager } from "@/components/accounting/ChartOfAccountsManager";
import { MonthlyCloseManager } from "@/components/accounting/MonthlyCloseManager";
import { TypedJournalEntryForm } from "@/components/accounting/TypedJournalEntryForm";
import { InventoryPurchaseForm } from "@/components/accounting/InventoryPurchaseForm";
import { COGSConsumptionForm } from "@/components/accounting/COGSConsumptionForm";
import { TransactionLedger } from "@/components/accounting/TransactionLedger";
import { CoAMappingAuditScreen } from "@/components/accounting/CoAMappingAuditScreen";
import { AccountDrillDown } from "@/components/accounting/AccountDrillDown";
import { TrialBalance } from "@/components/accounting/TrialBalance";
import { PendingJournalEntriesCard } from "@/components/accounting/PendingJournalEntriesCard";
import { JournalEntryAuditTrail } from "@/components/accounting/JournalEntryAuditTrail";
import { PostingCenter } from "@/components/accounting/posting/PostingCenter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CircleDollarSign, BookOpen, Lock, ScrollText, ShoppingCart, TrendingDown, ClipboardCheck, PieChart, Scale, Zap } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { LockedFeatureScreen } from "@/components/LockedFeatureScreen";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

export default function Accounting() {
  const { hasFeature, loading, canPostJournals, isManager, isAccountant } = useAuth();
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "chart-of-accounts";
  const ledgerBatchId = searchParams.get("batch_id");

  // Show locked screen if accounting feature is not enabled
  if (!loading && !hasFeature("accounting")) {
    return (
      <>
        <LockedFeatureScreen 
          featureName={t("app.accounting.locked.title")}
          description={t("app.accounting.locked.description")}
          featureKey="accounting"
        />
      </>
    );
  }

  return (
    <>
      <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
              <CircleDollarSign className="h-7 w-7" />
              {t("app.accounting.title")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t("app.accounting.subtitle")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canPostJournals && (
              <>
                <InventoryPurchaseForm />
                <COGSConsumptionForm />
                <TypedJournalEntryForm />
              </>
            )}
          </div>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(v) => {
            const next = new URLSearchParams(searchParams);
            next.set("tab", v);
            // Drop batch_id when leaving ledger so stale filters don't persist.
            if (v !== "ledger") next.delete("batch_id");
            setSearchParams(next, { replace: true });
          }}
          className="space-y-4"
        >
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="chart-of-accounts" className="gap-2">
              <BookOpen className="h-4 w-4" />
              {t("app.accounting.tabs.chartOfAccounts")}
            </TabsTrigger>
            <TabsTrigger value="ledger" className="gap-2">
              <ScrollText className="h-4 w-4" />
              {t("app.accounting.tabs.ledger")}
            </TabsTrigger>
            <TabsTrigger value="period-close" className="gap-2">
              <Lock className="h-4 w-4" />
              {t("app.accounting.tabs.periodClose")}
            </TabsTrigger>
            <TabsTrigger value="mapping-audit" className="gap-2">
              <ClipboardCheck className="h-4 w-4" />
              {t("app.accounting.tabs.mappingAudit")}
            </TabsTrigger>
            <TabsTrigger value="drilldown" className="gap-2">
              <PieChart className="h-4 w-4" />
              {t("app.accounting.tabs.drilldown")}
            </TabsTrigger>
            <TabsTrigger value="trial-balance" className="gap-2">
              <Scale className="h-4 w-4" />
              Trial Balance
            </TabsTrigger>
            <TabsTrigger value="posting-center" className="gap-2">
              <Zap className="h-4 w-4" />
              Posting Center
            </TabsTrigger>
          </TabsList>

          <TabsContent value="chart-of-accounts">
            <ChartOfAccountsManager />
          </TabsContent>
          
          <TabsContent value="ledger">
            <TransactionLedger initialBatchId={ledgerBatchId} />
          </TabsContent>
          
          <TabsContent value="period-close">
            <MonthlyCloseManager />
          </TabsContent>

          <TabsContent value="mapping-audit">
            <CoAMappingAuditScreen />
          </TabsContent>

          <TabsContent value="drilldown">
            <AccountDrillDown />
          </TabsContent>

          <TabsContent value="trial-balance">
            <TrialBalance />
          </TabsContent>

          <TabsContent value="posting-center">
            <PostingCenter />
          </TabsContent>

          {(isManager || isAccountant) && <PendingJournalEntriesCard />}
          {(isManager || isAccountant) && <JournalEntryAuditTrail />}
        </Tabs>
      </div>
    </>
  );
}
