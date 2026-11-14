import { Routes, Route, useLocation } from "react-router-dom";
import { usePageViewTracker } from "@/hooks/usePageViewTracker";
import { AnimatePresence } from "framer-motion";
import { Navigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { Suspense, lazy, ComponentType, useEffect, useState } from "react";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ProtectedAdminRoute } from "@/components/admin/ProtectedAdminRoute";
import { RouteLoadingFallback } from "@/components/performance/RouteLoadingFallback";
import { LazyLoadErrorBoundary } from "@/components/performance/LazyLoadErrorBoundary";
import { AppLayout } from "@/components/layout/AppLayout";
import { useFeatureFlag } from "@/hooks/useFeatureFlags";
import { extractTenantSubdomain, extractCustomDomain } from "@/hooks/useSubdomainTenant";
import { logRouteGuard } from "@/lib/routeGuardLog";
const RoutingDebug = lazy(() => import("@/pages/RoutingDebug"));
// Index (Dashboard) is heavy (pulls recharts ~155 KiB). Lazy-load it
// so the Landing entry bundle doesn't have to download charts-vendor.
const Index = lazy(() => import("@/pages/Index"));
const StarterDashboard = lazy(() => import("@/pages/starter/StarterDashboard"));
const AccountantDashboard = lazy(() => import("@/pages/AccountantDashboard"));
const StarterDailyReport = lazy(() => import("@/pages/starter/StarterDailyReport"));

// Lazy load all pages for code splitting
// Critical routes (Landing, Auth) loaded with higher priority
const Landing = lazy(() => import("@/pages/Landing"));
const ContactThankYou = lazy(() => import("@/pages/ContactThankYou"));
const TenantLanding = lazy(() => import("@/pages/TenantLanding"));
const Auth = lazy(() => import("@/pages/Auth"));
const Register = lazy(() => import("@/pages/Register"));
const ApplicationVerification = lazy(() => import("@/pages/ApplicationVerification"));
const AuthCallback = lazy(() => import("@/pages/AuthCallback"));
const ResetPassword = lazy(() => import("@/pages/ResetPassword"));
const ZohoCallback = lazy(() => import("@/pages/ZohoCallback"));
const QuickBooksCallback = lazy(() => import("@/pages/QuickBooksCallback"));

// Legal pages
const PrivacyPolicy = lazy(() => import("@/pages/legal/PrivacyPolicy"));
const TermsOfService = lazy(() => import("@/pages/legal/TermsOfService"));
const Security = lazy(() => import("@/pages/legal/Security"));
const Cookies = lazy(() => import("@/pages/legal/Cookies"));

// Resource pages
const HelpCenter = lazy(() => import("@/pages/resources/HelpCenter"));
const Community = lazy(() => import("@/pages/resources/Community"));
const Status = lazy(() => import("@/pages/resources/Status"));
const Documentation = lazy(() => import("@/pages/resources/Documentation"));
const Integrations = lazy(() => import("@/pages/resources/Integrations"));
const API = lazy(() => import("@/pages/resources/API"));
const InvestmentTiers = lazy(() => import("@/pages/resources/InvestmentTiers"));

// Company pages
const About = lazy(() => import("@/pages/company/About"));
const Blog = lazy(() => import("@/pages/company/Blog"));
const Careers = lazy(() => import("@/pages/company/Careers"));
const Press = lazy(() => import("@/pages/company/Press"));
const Stats = lazy(() => import("@/pages/company/Stats"));
const Pricing = lazy(() => import("@/pages/Pricing"));
const BookDemo = lazy(() => import("@/pages/BookDemo"));
const SolutionsIndex = lazy(() => import("@/pages/solutions/SolutionsIndex"));
const SolutionPage = lazy(() => import("@/pages/solutions/SolutionPage"));
const FoodCostEmbed = lazy(() => import("@/pages/embed/FoodCostEmbed"));
const VerifyZatcaReport = lazy(() => import("@/pages/VerifyZatcaReport"));

// KSA SEO landing pages (single template, 6 slugs)
const SeoLanding = lazy(() => import("@/pages/seo/SeoLanding"));
const ArabicHomepage = lazy(() => import("@/pages/ArabicHomepage"));
const ZatcaPhase2Guide = lazy(() => import("@/pages/blog/ZatcaPhase2Guide"));
const RestaurantCogsGuide = lazy(() => import("@/pages/blog/RestaurantCogsGuide"));
const MenuEngineeringMatrixGuide = lazy(() => import("@/pages/blog/MenuEngineeringMatrixGuide"));
const ArVsFoodics = lazy(() => import("@/pages/ar/ArVsFoodics"));
const ArVsQoyod = lazy(() => import("@/pages/ar/ArVsQoyod"));
const ArVsJazr = lazy(() => import("@/pages/ar/ArVsJazr"));
const ArVsSapaad = lazy(() => import("@/pages/ar/ArVsSapaad"));
const VsSapaad = lazy(() => import("@/pages/en/VsSapaad"));
const ArBlogPrimeCost = lazy(() => import("@/pages/ar/blog/PrimeCost"));
const ArBlogWasteControl = lazy(() => import("@/pages/ar/blog/WasteControl"));
const ArBlogInventoryManagement = lazy(() => import("@/pages/ar/blog/InventoryManagement"));
const ArBlogRestaurantKPIs = lazy(() => import("@/pages/ar/blog/RestaurantKPIs"));
const ArBlogZatcaPhase2 = lazy(() => import("@/pages/ar/blog/ZatcaPhase2"));
const ArBlogZatcaQrCode = lazy(() => import("@/pages/ar/blog/ZatcaQrCode"));
const ArBlogZatcaFines = lazy(() => import("@/pages/ar/blog/ZatcaFines"));
const ArBlogZatcaOnboarding = lazy(() => import("@/pages/ar/blog/ZatcaOnboarding"));
const HelpArticlePage = lazy(() => import("@/pages/seo/HelpArticlePage"));
const ToolsHub = lazy(() => import("@/pages/tools/ToolsHub"));
const FoodCostCalculator = lazy(() => import("@/pages/tools/FoodCostCalculator"));
const CogsCalculator = lazy(() => import("@/pages/tools/CogsCalculator"));
const MenuPriceCalculator = lazy(() => import("@/pages/tools/MenuPriceCalculator"));
const SeoRestaurantPos = () => <SeoLanding slug="restaurant-pos" />;
const SeoZatcaEn = () => <SeoLanding slug="zatca-e-invoicing" />;
const SeoKds = () => <SeoLanding slug="kitchen-display-system" />;
const SeoCashierAr = () => <SeoLanding slug="كاشير-مطاعم" />;
const SeoPosAr = () => <SeoLanding slug="نقاط-البيع" />;
const SeoZatcaAr = () => <SeoLanding slug="zatca" />;
const SeoFoodicsAlternative = () => <SeoLanding slug="foodics-alternative" />;
const SeoFoodicsAlternativeAr = () => <SeoLanding slug="بديل-فودكس" />;
const SeoZatcaGuideAr = () => <SeoLanding slug="zatca-phase-2-guide" />;
const SeoRewaaAlternativeAr = () => <SeoLanding slug="بديل-ريوا" />;
const SeoMarnAlternativeAr = () => <SeoLanding slug="بديل-مرن" />;
// Sapaad-gap feature landing pages
const SeoQrOrdering = () => <SeoLanding slug="qr-ordering" />;
const SeoInventoryManagement = () => <SeoLanding slug="restaurant-inventory-management-software" />;
const SeoSelfOrderingKiosk = () => <SeoLanding slug="self-ordering-kiosk" />;
const SeoLoyaltyProgram = () => <SeoLanding slug="loyalty-program" />;
const SeoDeliveryAggregators = () => <SeoLanding slug="delivery-aggregators" />;
const SeoQrOrderingAr = () => <SeoLanding slug="ar-qr-ordering" />;
const SeoSelfOrderingKioskAr = () => <SeoLanding slug="ar-self-ordering-kiosk" />;
const SeoLoyaltyProgramAr = () => <SeoLanding slug="ar-loyalty-program" />;
const SeoDeliveryAggregatorsAr = () => <SeoLanding slug="ar-delivery-aggregators" />;
const HelpLoginAr = () => <HelpArticlePage slug="تسجيل-الدخول-الى-لوحة-ماتبكس" />;
const HelpLoginTroubleshootingAr = () => <HelpArticlePage slug="حل-مشكلة-تعذر-تسجيل-الدخول" />;
const HelpRolesAr = () => <HelpArticlePage slug="فهم-صلاحيات-المالك-والمدير-والكاشير" />;

// Protected tenant routes - loaded on demand
const Shifts = lazy(() => import("@/pages/Shifts"));
const Sales = lazy(() => import("@/pages/Sales"));
const SalesAnalytics = lazy(() => import("@/pages/SalesAnalytics"));
const Expenses = lazy(() => import("@/pages/Expenses"));
const InventoryLinkAudit = lazy(() => import("@/pages/InventoryLinkAudit"));
const InventoryLinkRules = lazy(() => import("@/pages/InventoryLinkRules"));
const InventoryPurchaseVerification = lazy(() => import("@/pages/InventoryPurchaseVerification"));
const Inventory = lazy(() => import("@/pages/Inventory"));
const Reports = lazy(() => import("@/pages/Reports"));
const Settings = lazy(() => import("@/pages/Settings"));
const Team = lazy(() => import("@/pages/Team"));
const Staff = lazy(() => import("@/pages/Staff"));
const FinesHistory = lazy(() => import("@/pages/FinesHistory"));
const SalaryCalendar = lazy(() => import("@/pages/SalaryCalendar"));
const PayrollJournal = lazy(() => import("@/pages/PayrollJournal"));
const Onboarding = lazy(() => import("@/pages/Onboarding"));
const PaymentSuccess = lazy(() => import("@/pages/PaymentSuccess"));
const DailyProfit = lazy(() => import("@/pages/DailyProfit"));
const Cockpit = lazy(() => import("@/pages/Cockpit"));
const ManagerApp = lazy(() => import("@/pages/ManagerApp"));
const CockpitStocktake = lazy(() => import("@/pages/CockpitStocktake"));
const CockpitSummary = lazy(() => import("@/pages/CockpitSummary"));
const Billing = lazy(() => import("@/pages/Billing"));
const MigrationPage = lazy(() => import("@/pages/Migration"));
const Menu = lazy(() => import("@/pages/Menu"));
const BranchPriceList = lazy(() => import("@/pages/BranchPriceList"));
const BranchSettings = lazy(() => import("@/pages/BranchSettings"));
const Recipes = lazy(() => import("@/pages/Recipes"));
const PosTables = lazy(() => import("@/pages/PosTables"));
const Reservations = lazy(() => import("@/pages/Reservations"));
const PublicBookTable = lazy(() => import("@/pages/PublicBookTable"));
const GuestOrder = lazy(() => import("@/pages/GuestOrder"));
const KitchenDisplay = lazy(() => import("@/pages/KitchenDisplay"));
const KdsStations = lazy(() => import("@/pages/KdsStations"));
const KitchenReport = lazy(() => import("@/pages/KitchenReport"));
const FloorPlan = lazy(() => import("@/pages/FloorPlan"));
const TableTimeline = lazy(() => import("@/pages/TableTimeline"));
const FloorAuditLog = lazy(() => import("@/pages/FloorAuditLog"));
const OnlineOrders = lazy(() => import("@/pages/OnlineOrders"));
const OrderManager = lazy(() => import("@/pages/OrderManager"));
const OnlineOrderSettings = lazy(() => import("@/pages/OnlineOrderSettings"));
const PublicOrder = lazy(() => import("@/pages/PublicOrder"));
const PublicOrderTrack = lazy(() => import("@/pages/PublicOrderTrack"));
const CustomerLogin = lazy(() => import("@/pages/CustomerLogin"));
const CustomerAccount = lazy(() => import("@/pages/CustomerAccount"));
const Aggregators = lazy(() => import("@/pages/Aggregators"));
const Waiter = lazy(() => import("@/pages/Waiter"));
const ChannelPnL = lazy(() => import("@/pages/ChannelPnL"));
const Loyalty = lazy(() => import("@/pages/Loyalty"));
const Kiosk = lazy(() => import("@/pages/Kiosk"));
const Riders = lazy(() => import("@/pages/Riders"));
const Driver = lazy(() => import("@/pages/Driver"));
const CFD = lazy(() => import("@/pages/CFD"));
const InventoryAudit = lazy(() => import("@/pages/InventoryAudit"));
const IngredientCategoryMappings = lazy(() => import("@/pages/IngredientCategoryMappings"));
const CogsTrueup = lazy(() => import("@/pages/CogsTrueup"));
const OfflineSyncCenter = lazy(() => import("@/pages/OfflineSyncCenter"));
const PosTerminals = lazy(() => import("@/pages/PosTerminals"));
const TerminalBranchSettings = lazy(() => import("@/pages/TerminalBranchSettings"));
const TerminalPricingReport = lazy(() => import("@/pages/TerminalPricingReport"));
const TerminalSyncHealth = lazy(() => import("@/pages/TerminalSyncHealth"));
const SalePostingMonitor = lazy(() => import("@/pages/SalePostingMonitor"));
const SeoDiagnostics = lazy(() => import("@/pages/SeoDiagnostics"));
const PosAckDiagnostics = lazy(() => import("@/pages/PosAckDiagnostics"));
const DailyReconciliationReport = lazy(() => import("@/pages/DailyReconciliationReport"));
const OverheadAudit = lazy(() => import("@/pages/OverheadAudit"));
const DeviceManagement = lazy(() => import("@/pages/DeviceManagement"));
const OfflineAuditReport = lazy(() => import("@/pages/OfflineAuditReport"));
const RecordSale = lazy(() => import("@/pages/RecordSale"));
const RecordSaleMobile = lazy(() => import("@/pages/RecordSaleMobile"));
import { LicenseGate } from "@/components/license/LicenseGate";
import { TillGuard } from "@/components/pos/TillGuard";
import { isStarterPlan, isStarterAllowedPath } from "@/lib/starterPlan";
import { LockedFeatureScreen } from "@/components/LockedFeatureScreen";
import { useAuth } from "@/contexts/AuthContext";
import { isAccountantDashboardRole } from "@/lib/accountantDashboard";
const EndOfDaySummary = lazy(() => import("@/pages/EndOfDaySummary"));
const PosBackfill = lazy(() => import("@/pages/PosBackfill"));
const COGS = lazy(() => import("@/pages/COGS"));
const Customers = lazy(() => import("@/pages/Customers"));
const CustomerDetail = lazy(() => import("@/pages/CustomerDetail"));
const Settlements = lazy(() => import("@/pages/Settlements"));
const Chat = lazy(() => import("@/pages/Chat"));
const AuditLogs = lazy(() => import("@/pages/AuditLogs"));
const Accounting = lazy(() => import("@/pages/Accounting"));
const FinanceDashboard = lazy(() => import("@/pages/FinanceDashboard"));
const TrialBalance = lazy(() => import("@/pages/TrialBalance"));
const ProfitLoss = lazy(() => import("@/pages/ProfitLoss"));
const SalesItemBreakdown = lazy(() => import("@/pages/SalesItemBreakdown"));
const SalesJournal = lazy(() => import("@/pages/SalesJournal"));
const CashCardAnalysis = lazy(() => import("@/pages/CashCardAnalysis"));
const ZatcaInvoices = lazy(() => import("@/pages/ZatcaInvoices"));
const ZatcaProviderApplication = lazy(() => import("@/pages/ZatcaProviderApplication"));
const CashFlow = lazy(() => import("@/pages/CashFlow"));
const BalanceSheet = lazy(() => import("@/pages/BalanceSheet"));
const FinancialStatements = lazy(() => import("@/pages/FinancialStatements"));
const ApAging = lazy(() => import("@/pages/ApAging"));
const DepreciationReport = lazy(() => import("@/pages/DepreciationReport"));
const ApAuditTrail = lazy(() => import("@/pages/ApAuditTrail"));
const SupplierLedger = lazy(() => import("@/pages/SupplierLedger"));
const SupplierApReconciliation = lazy(() => import("@/pages/SupplierApReconciliation"));
const ExpenseLedgerReconciliation = lazy(() => import("@/pages/ExpenseLedgerReconciliation"));
const InvoiceLedgerReconciliation = lazy(() => import("@/pages/InvoiceLedgerReconciliation"));
const SupplierApHeadAudit = lazy(() => import("@/pages/SupplierApHeadAudit"));
const ReversalAudit = lazy(() => import("@/pages/ReversalAudit"));
const DayEndStatusMatrix = lazy(() => import("@/pages/DayEndStatusMatrix"));
const LedgerMapping = lazy(() => import("@/pages/LedgerMapping"));
const CardSalesByBranch = lazy(() => import("@/pages/CardSalesByBranch"));
const BranchLedger = lazy(() => import("@/pages/BranchLedger"));
const OwnerCapital = lazy(() => import("@/pages/OwnerCapital"));
const Installments = lazy(() => import("@/pages/Installments"));
const FixedAssets = lazy(() => import("@/pages/FixedAssets"));
const Projects = lazy(() => import("@/pages/Projects"));
const Compliance = lazy(() => import("@/pages/Compliance"));
const InstallmentReconciliation = lazy(() => import("@/pages/InstallmentReconciliation"));
const BnplReport = lazy(() => import("@/pages/BnplReport"));
const CardSettlementClearing = lazy(() => import("@/pages/CardSettlementClearing"));
const CoaMigrationPreview = lazy(() => import("@/pages/CoaMigrationPreview"));
const PostingRuleAudit = lazy(() => import("@/pages/PostingRuleAudit"));
const DailyOverheadClosing = lazy(() => import("@/pages/DailyOverheadClosing"));
const OverheadReconciliation = lazy(() => import("@/pages/OverheadReconciliation"));
const CapitalStatementMatch = lazy(() => import("@/pages/CapitalStatementMatch"));
const WebBuilder = lazy(() => import("@/pages/WebBuilder"));
const VatReturn = lazy(() => import("@/pages/VatReturn"));
const VatAudit = lazy(() => import("@/pages/VatAudit"));
const PendingVatSplit = lazy(() => import("@/pages/PendingVatSplit"));
const PriceReconciliation = lazy(() => import("@/pages/PriceReconciliation"));
const ZatcaCompliance = lazy(() => import("@/pages/ZatcaCompliance"));
const NotFound = lazy(() => import("@/pages/NotFound"));

// Admin routes - only loaded for super admins
const AdminOverview = lazy(() => import("@/pages/admin/AdminOverview"));
const AdminTenants = lazy(() => import("@/pages/admin/AdminTenants"));
const AdminTenantDetails = lazy(() => import("@/pages/admin/AdminTenantDetails"));
const AdminPlans = lazy(() => import("@/pages/admin/AdminPlans"));
const AdminWebhooks = lazy(() => import("@/pages/admin/AdminWebhooks"));
const AdminAuditLogs = lazy(() => import("@/pages/admin/AdminAuditLogs"));
const AdminResidencyAudit = lazy(() => import("@/pages/admin/AdminResidencyAudit"));
const AdminKsaSetup = lazy(() => import("@/pages/admin/AdminKsaSetupGuide"));
const AdminSettings = lazy(() => import("@/pages/admin/AdminSettings"));
const AdminSecurityDashboard = lazy(() => import("@/pages/admin/AdminSecurityDashboard"));
const AdminSuperAuditLogs = lazy(() => import("@/pages/admin/AdminSuperAuditLogs"));
const AdminChatModeration = lazy(() => import("@/pages/admin/AdminChatModeration"));
const AdminChatAnalytics = lazy(() => import("@/pages/admin/AdminChatAnalytics"));
const AdminLandingCMS = lazy(() => import("@/pages/admin/AdminLandingCMS"));
const AdminApplicationQueue = lazy(() => import("@/pages/admin/AdminApplicationQueue"));
const AdminA11yDialogs = lazy(() => import("@/pages/admin/AdminA11yDialogs"));
const AdminFeatureFlags = lazy(() => import("@/pages/admin/AdminFeatureFlags"));
const AdminAddons = lazy(() => import("@/pages/admin/AdminAddons"));
const AdminCurrencies = lazy(() => import("@/pages/admin/AdminCurrencies"));
const AdminPasswordReset = lazy(() => import("@/pages/admin/AdminPasswordReset"));
const AdminDevices = lazy(() => import("@/pages/admin/AdminDevices"));
const WhatsAppTest = lazy(() => import("@/pages/WhatsAppTest"));
const AdminSEO = lazy(() => import("@/pages/admin/AdminSEO"));
const AdminSubdomains = lazy(() => import("@/pages/admin/AdminSubdomains"));
const AdminCustomDomains = lazy(() => import("@/pages/admin/AdminCustomDomains"));
const AdminTenantCosts = lazy(() => import("@/pages/admin/AdminTenantCosts"));
const AdminEdgeFunctionHealth = lazy(() => import("@/pages/admin/AdminEdgeFunctionHealth"));
const SyncHealth = lazy(() => import("@/pages/admin/SyncHealth"));
const AdminDLQ = lazy(() => import("@/pages/admin/AdminDLQ"));
const AdminReleaseNotes = lazy(() => import("@/pages/admin/AdminReleaseNotes"));
const AdminContactMessages = lazy(() => import("@/pages/admin/AdminContactMessages"));
const AdminTraffic = lazy(() => import("@/pages/admin/AdminTraffic"));
const AdminEmailInbox = lazy(() => import("@/pages/admin/AdminEmailInbox"));
const AdminEnquiries = lazy(() => import("@/pages/admin/AdminEnquiries"));
const AdminLeadSources = lazy(() => import("@/pages/admin/AdminLeadSources"));

// Wrapper for lazy-loaded components with Suspense and error boundary
const LazyRoute = ({ 
  Component, 
  wrapper: Wrapper 
}: { 
  Component: ComponentType; 
  wrapper?: ComponentType<{ children: React.ReactNode }>;
}) => {
  const element = (
    <LazyLoadErrorBoundary>
      <Suspense fallback={<RouteLoadingFallback />}>
        <Component />
      </Suspense>
    </LazyLoadErrorBoundary>
  );

  return Wrapper ? <Wrapper>{element}</Wrapper> : element;
};

/**
 * Protected tenant route wrapper.
 * Renders ProtectedRoute → AppLayout → Suspense → Component so the
 * sidebar/header stay mounted across navigations and the Suspense
 * fallback only swaps the inner content area (no fullscreen flash).
 */
/** Tenant-only: Starter accounts get their own dashboard and Growth feature locks. */
const StarterAware = ({ Component }: { Component: ComponentType }) => {
  const { plan, hasRole, roles } = useAuth();
  const isSuperAdmin = roles.some(role => String(role.role) === "superadmin");
  const { pathname } = useLocation();
  if (pathname === "/dashboard" && isAccountantDashboardRole(hasRole)) return <AccountantDashboard />;
  if (!isSuperAdmin && isStarterPlan(plan)) {
    if (pathname === "/dashboard") return <StarterDashboard />;
    if (!isStarterAllowedPath(pathname)) {
      return <LockedFeatureScreen featureName="This screen" description="Available on the Growth and Enterprise plans." />;
    }
  }
  return <Component />;
};

const TenantRoute = ({
  Component,
  requireOnboarding = true,
  bareLayout = false,
}: {
  Component: ComponentType;
  requireOnboarding?: boolean;
  bareLayout?: boolean;
}) => {
  const inner = (
    <LazyLoadErrorBoundary>
      <Suspense fallback={<RouteLoadingFallback />}>
        <StarterAware Component={Component} />
      </Suspense>
    </LazyLoadErrorBoundary>
  );
  return (
    <ProtectedRoute requireOnboarding={requireOnboarding}>
      {bareLayout ? inner : <AppLayout>{inner}</AppLayout>}
    </ProtectedRoute>
  );
};

export function AnimatedRoutes() {
  const location = useLocation();
  usePageViewTracker();


  // Defensive cleanup: Radix UI dialogs/sheets/popovers can leave
  // `pointer-events: none` on <body> or a stale `data-scroll-locked` attribute
  // if they unmount unexpectedly (e.g. lazy chunk swap, error during close).
  // That makes the whole UI feel "frozen" - clicks have no effect.
  // Reset on every route change as a safety net.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.body.style.pointerEvents === "none") {
      document.body.style.pointerEvents = "";
    }
    if (document.body.hasAttribute("data-scroll-locked")) {
      document.body.removeAttribute("data-scroll-locked");
      document.body.style.overflow = "";
      document.body.style.marginRight = "";
    }
  }, [location.pathname]);

  // Temporary navigation instrumentation: records every location change so the
  // /debug/routing screen can correlate guard redirects with actual navigations.
  useEffect(() => {
    logRouteGuard({
      pathname: location.pathname,
      search: location.search,
      decision: "nav",
      reason: "location-change",
      context: { key: location.key, state: location.state ? "present" : "none" },
    });
  }, [location.key, location.pathname, location.search, location.state]);

  // Pick the simplified, finger-friendly POS UI on tablet & mobile (incl. native).
  function RecordSaleResponsive() {
    // Re-evaluate on resize / orientation change so Android tablets
    // switch between the compact POS and the full POS when rotated.
    const computeSimple = () =>
      Capacitor.isNativePlatform() ||
      (typeof window !== "undefined" && window.innerWidth < 1024);
    const [useSimple, setUseSimple] = useState<boolean>(computeSimple);
    useEffect(() => {
      if (typeof window === "undefined") return;
      const onResize = () => setUseSimple(computeSimple());
      window.addEventListener("resize", onResize);
      window.addEventListener("orientationchange", onResize);
      return () => {
        window.removeEventListener("resize", onResize);
        window.removeEventListener("orientationchange", onResize);
      };
    }, []);
    return useSimple ? <RecordSaleMobile /> : <RecordSale />;
  }

  function GatedRecordSale() {
    return (
      <LicenseGate>
        <TillGuard>
          <RecordSaleResponsive />
        </TillGuard>
      </LicenseGate>
    );
  }

  const kdsEnabled = useFeatureFlag("kds", false);

  return (
    <AnimatePresence>
      <Routes location={location}>
        {/* Public Routes */}
        <Route
          path="/"
          element={
            Capacitor.isNativePlatform() ? (
              <Navigate to="/auth" replace />
            ) : typeof window !== "undefined" && extractTenantSubdomain(window.location.hostname) ? (
              <LazyRoute Component={TenantLanding} />
            ) : typeof window !== "undefined" && extractCustomDomain(window.location.hostname) ? (
              <LazyRoute Component={TenantLanding} />
            ) : (
              <LazyRoute Component={Landing} />
            )
          }
        />
        <Route path="/auth" element={<LazyRoute Component={Auth} />} />
        <Route path="/auth/callback" element={<LazyRoute Component={AuthCallback} />} />
        <Route path="/reset-password" element={<LazyRoute Component={ResetPassword} />} />
        <Route path="/zoho/callback" element={<LazyRoute Component={ZohoCallback} />} />
        <Route path="/quickbooks/callback" element={<LazyRoute Component={QuickBooksCallback} />} />
        <Route path="/register" element={<LazyRoute Component={Register} />} />
        <Route path="/contact/thank-you" element={<LazyRoute Component={ContactThankYou} />} />
        <Route path="/application/:id" element={<LazyRoute Component={ApplicationVerification} />} />
        <Route path="/payment-success" element={<LazyRoute Component={PaymentSuccess} />} />
        <Route path="/verify/zatca/:token" element={<LazyRoute Component={VerifyZatcaReport} />} />
        <Route path="/t/:code" element={<LazyRoute Component={GuestOrder} />} />
        <Route path="/order/:restaurantId" element={<LazyRoute Component={PublicOrder} />} />
        <Route path="/book/:restaurantId" element={<LazyRoute Component={PublicBookTable} />} />
        <Route path="/order/track/:orderId" element={<LazyRoute Component={PublicOrderTrack} />} />
        <Route path="/account/login" element={<LazyRoute Component={CustomerLogin} />} />
        <Route path="/account" element={<LazyRoute Component={CustomerAccount} />} />
        <Route path="/driver/:token" element={<LazyRoute Component={Driver} />} />
        <Route path="/cfd" element={<LazyRoute Component={CFD} />} />
        
        {/* KSA SEO Landing Pages — public, indexable */}
        <Route path="/sa/restaurant-pos" element={<LazyRoute Component={SeoRestaurantPos} />} />
        <Route path="/sa/zatca-e-invoicing" element={<LazyRoute Component={SeoZatcaEn} />} />
        <Route path="/sa/kitchen-display-system" element={<LazyRoute Component={SeoKds} />} />
        <Route path="/sa/foodics-alternative" element={<LazyRoute Component={SeoFoodicsAlternative} />} />
        <Route path="/ar/%D9%83%D8%A7%D8%B4%D9%8A%D8%B1-%D9%85%D8%B7%D8%A7%D8%B9%D9%85" element={<LazyRoute Component={SeoCashierAr} />} />
        <Route path="/ar/كاشير-مطاعم" element={<LazyRoute Component={SeoCashierAr} />} />
        <Route path="/ar/%D9%86%D9%82%D8%A7%D8%B7-%D8%A7%D9%84%D8%A8%D9%8A%D8%B9" element={<LazyRoute Component={SeoPosAr} />} />
        <Route path="/ar/نقاط-البيع" element={<LazyRoute Component={SeoPosAr} />} />
        <Route path="/ar/zatca" element={<LazyRoute Component={SeoZatcaAr} />} />
        <Route path="/ar/بديل-فودكس" element={<LazyRoute Component={SeoFoodicsAlternativeAr} />} />
        <Route path="/ar/بديل-ريوا" element={<LazyRoute Component={SeoRewaaAlternativeAr} />} />
        <Route path="/ar/بديل-مرن" element={<LazyRoute Component={SeoMarnAlternativeAr} />} />
        <Route path="/sa/zatca-phase-2-guide" element={<LazyRoute Component={SeoZatcaGuideAr} />} />
        {/* Sapaad-gap feature landing pages */}
        <Route path="/sa/qr-ordering" element={<LazyRoute Component={SeoQrOrdering} />} />
        <Route path="/sa/restaurant-inventory-management-software" element={<LazyRoute Component={SeoInventoryManagement} />} />
        <Route path="/sa/self-ordering-kiosk" element={<LazyRoute Component={SeoSelfOrderingKiosk} />} />
        <Route path="/sa/loyalty-program" element={<LazyRoute Component={SeoLoyaltyProgram} />} />
        <Route path="/sa/delivery-aggregators" element={<LazyRoute Component={SeoDeliveryAggregators} />} />
        <Route path="/ar/qr-ordering" element={<LazyRoute Component={SeoQrOrderingAr} />} />
        <Route path="/ar/self-ordering-kiosk" element={<LazyRoute Component={SeoSelfOrderingKioskAr} />} />
        <Route path="/ar/loyalty-program" element={<LazyRoute Component={SeoLoyaltyProgramAr} />} />
        <Route path="/ar/delivery-aggregators" element={<LazyRoute Component={SeoDeliveryAggregatorsAr} />} />
        <Route path="/ar" element={<LazyRoute Component={ArabicHomepage} />} />
        <Route path="/blog/zatca-phase-2-restaurant-guide" element={<LazyRoute Component={ZatcaPhase2Guide} />} />
        <Route path="/blog/restaurant-cogs-guide-ksa" element={<LazyRoute Component={RestaurantCogsGuide} />} />
        <Route path="/blog/menu-engineering-matrix-guide" element={<LazyRoute Component={MenuEngineeringMatrixGuide} />} />
        <Route path="/ar/vs/foodics" element={<LazyRoute Component={ArVsFoodics} />} />
        <Route path="/ar/vs/qoyod" element={<LazyRoute Component={ArVsQoyod} />} />
        <Route path="/ar/vs/jazr" element={<LazyRoute Component={ArVsJazr} />} />
        <Route path="/ar/vs/sapaad" element={<LazyRoute Component={ArVsSapaad} />} />
        <Route path="/sa/vs/sapaad" element={<LazyRoute Component={VsSapaad} />} />
        <Route path="/tools" element={<LazyRoute Component={ToolsHub} />} />
        <Route path="/tools/food-cost-calculator" element={<LazyRoute Component={FoodCostCalculator} />} />
        <Route path="/tools/cogs-calculator" element={<LazyRoute Component={CogsCalculator} />} />
        <Route path="/tools/menu-price-calculator" element={<LazyRoute Component={MenuPriceCalculator} />} />
        <Route path="/ar/blog/prime-cost" element={<LazyRoute Component={ArBlogPrimeCost} />} />
        <Route path="/ar/blog/waste-control" element={<LazyRoute Component={ArBlogWasteControl} />} />
        <Route path="/ar/blog/inventory-management" element={<LazyRoute Component={ArBlogInventoryManagement} />} />
        <Route path="/ar/blog/restaurant-kpis" element={<LazyRoute Component={ArBlogRestaurantKPIs} />} />
        <Route path="/ar/blog/zatca-phase-2" element={<LazyRoute Component={ArBlogZatcaPhase2} />} />
        <Route path="/ar/blog/zatca-qr-code" element={<LazyRoute Component={ArBlogZatcaQrCode} />} />
        <Route path="/ar/blog/zatca-fines" element={<LazyRoute Component={ArBlogZatcaFines} />} />
        <Route path="/ar/blog/zatca-onboarding" element={<LazyRoute Component={ArBlogZatcaOnboarding} />} />
        <Route path="/ar/help/تسجيل-الدخول-الى-لوحة-ماتبكس" element={<LazyRoute Component={HelpLoginAr} />} />
        <Route path="/ar/help/حل-مشكلة-تعذر-تسجيل-الدخول" element={<LazyRoute Component={HelpLoginTroubleshootingAr} />} />
        <Route path="/ar/help/فهم-صلاحيات-المالك-والمدير-والكاشير" element={<LazyRoute Component={HelpRolesAr} />} />
        
        {/* Legal Pages */}
        <Route path="/privacy" element={<LazyRoute Component={PrivacyPolicy} />} />
        <Route path="/terms" element={<LazyRoute Component={TermsOfService} />} />
        <Route path="/security" element={<LazyRoute Component={Security} />} />
        <Route path="/cookies" element={<LazyRoute Component={Cookies} />} />
        
        {/* Resource Pages */}
        <Route path="/help" element={<LazyRoute Component={HelpCenter} />} />
        <Route path="/community" element={<LazyRoute Component={Community} />} />
        <Route path="/status" element={<LazyRoute Component={Status} />} />
        <Route path="/docs" element={<LazyRoute Component={Documentation} />} />
        <Route path="/integrations" element={<LazyRoute Component={Integrations} />} />
        <Route path="/api" element={<LazyRoute Component={API} />} />
        <Route path="/investment-tiers" element={<LazyRoute Component={InvestmentTiers} />} />
        
        <Route path="/pricing" element={<LazyRoute Component={Pricing} />} />
        <Route path="/demo" element={<LazyRoute Component={BookDemo} />} />

        {/* Solution Pages */}
        <Route path="/solutions" element={<LazyRoute Component={SolutionsIndex} />} />
        <Route path="/solutions/:slug" element={<LazyRoute Component={SolutionPage} />} />

        {/* Company Pages */}
        <Route path="/about" element={<LazyRoute Component={About} />} />
        <Route path="/blog" element={<LazyRoute Component={Blog} />} />
        <Route path="/careers" element={<LazyRoute Component={Careers} />} />
        <Route path="/press" element={<LazyRoute Component={Press} />} />
        <Route path="/stats" element={<LazyRoute Component={Stats} />} />
        <Route path="/embed/food-cost-calculator" element={<LazyRoute Component={FoodCostEmbed} />} />
        <Route path="/onboarding" element={
          <TenantRoute Component={Onboarding} requireOnboarding={false} bareLayout />
        } />
        
        {/* SuperAdmin Routes */}
        <Route path="/admin" element={
          <ProtectedAdminRoute>
            <LazyLoadErrorBoundary><Suspense fallback={<RouteLoadingFallback />}><AdminOverview /></Suspense></LazyLoadErrorBoundary>
          </ProtectedAdminRoute>
        } />
        <Route path="/admin/applications" element={
          <ProtectedAdminRoute>
            <LazyLoadErrorBoundary><Suspense fallback={<RouteLoadingFallback />}><AdminApplicationQueue /></Suspense></LazyLoadErrorBoundary>
          </ProtectedAdminRoute>
        } />
        <Route path="/admin/tenants" element={
          <ProtectedAdminRoute>
            <LazyLoadErrorBoundary><Suspense fallback={<RouteLoadingFallback />}><AdminTenants /></Suspense></LazyLoadErrorBoundary>
          </ProtectedAdminRoute>
        } />
        <Route path="/admin/tenants/:id" element={
          <ProtectedAdminRoute>
            <LazyLoadErrorBoundary><Suspense fallback={<RouteLoadingFallback />}><AdminTenantDetails /></Suspense></LazyLoadErrorBoundary>
          </ProtectedAdminRoute>
        } />
        <Route path="/admin/tenant-costs" element={
          <ProtectedAdminRoute>
            <LazyLoadErrorBoundary><Suspense fallback={<RouteLoadingFallback />}><AdminTenantCosts /></Suspense></LazyLoadErrorBoundary>
          </ProtectedAdminRoute>
        } />
        <Route path="/admin/subdomains" element={
          <ProtectedAdminRoute>
            <LazyLoadErrorBoundary><Suspense fallback={<RouteLoadingFallback />}><AdminSubdomains /></Suspense></LazyLoadErrorBoundary>
          </ProtectedAdminRoute>
        } />
        <Route path="/admin/custom-domains" element={
          <ProtectedAdminRoute>
            <LazyLoadErrorBoundary><Suspense fallback={<RouteLoadingFallback />}><AdminCustomDomains /></Suspense></LazyLoadErrorBoundary>
          </ProtectedAdminRoute>
        } />
        <Route path="/admin/plans" element={
          <ProtectedAdminRoute>
            <LazyLoadErrorBoundary><Suspense fallback={<RouteLoadingFallback />}><AdminPlans /></Suspense></LazyLoadErrorBoundary>
          </ProtectedAdminRoute>
        } />
        <Route path="/admin/devices" element={
          <ProtectedAdminRoute>
            <LazyLoadErrorBoundary><Suspense fallback={<RouteLoadingFallback />}><AdminDevices /></Suspense></LazyLoadErrorBoundary>
          </ProtectedAdminRoute>
        } />
        <Route path="/admin/feature-flags" element={
          <ProtectedAdminRoute>
            <LazyLoadErrorBoundary><Suspense fallback={<RouteLoadingFallback />}><AdminFeatureFlags /></Suspense></LazyLoadErrorBoundary>
          </ProtectedAdminRoute>
        } />
        <Route path="/admin/addons" element={
          <ProtectedAdminRoute>
            <LazyLoadErrorBoundary><Suspense fallback={<RouteLoadingFallback />}><AdminAddons /></Suspense></LazyLoadErrorBoundary>
          </ProtectedAdminRoute>
        } />
        <Route path="/admin/currencies" element={
          <ProtectedAdminRoute>
            <LazyLoadErrorBoundary><Suspense fallback={<RouteLoadingFallback />}><AdminCurrencies /></Suspense></LazyLoadErrorBoundary>
          </ProtectedAdminRoute>
        } />
        <Route path="/admin/chat-moderation" element={
          <ProtectedAdminRoute>
            <LazyLoadErrorBoundary><Suspense fallback={<RouteLoadingFallback />}><AdminChatModeration /></Suspense></LazyLoadErrorBoundary>
          </ProtectedAdminRoute>
        } />
        <Route path="/admin/chat-analytics" element={
          <ProtectedAdminRoute>
            <LazyLoadErrorBoundary><Suspense fallback={<RouteLoadingFallback />}><AdminChatAnalytics /></Suspense></LazyLoadErrorBoundary>
          </ProtectedAdminRoute>
        } />
        <Route path="/admin/landing-cms" element={
          <ProtectedAdminRoute>
            <LazyLoadErrorBoundary><Suspense fallback={<RouteLoadingFallback />}><AdminLandingCMS /></Suspense></LazyLoadErrorBoundary>
          </ProtectedAdminRoute>
        } />
        <Route path="/admin/seo" element={
          <ProtectedAdminRoute>
            <LazyLoadErrorBoundary><Suspense fallback={<RouteLoadingFallback />}><AdminSEO /></Suspense></LazyLoadErrorBoundary>
          </ProtectedAdminRoute>
        } />
        <Route path="/admin/webhooks" element={
          <ProtectedAdminRoute>
            <LazyLoadErrorBoundary><Suspense fallback={<RouteLoadingFallback />}><AdminWebhooks /></Suspense></LazyLoadErrorBoundary>
          </ProtectedAdminRoute>
        } />
        <Route path="/admin/audit" element={
          <ProtectedAdminRoute>
            <LazyLoadErrorBoundary><Suspense fallback={<RouteLoadingFallback />}><AdminAuditLogs /></Suspense></LazyLoadErrorBoundary>
          </ProtectedAdminRoute>
        } />
        <Route path="/admin/residency-audit" element={
          <ProtectedAdminRoute>
            <LazyLoadErrorBoundary><Suspense fallback={<RouteLoadingFallback />}><AdminResidencyAudit /></Suspense></LazyLoadErrorBoundary>
          </ProtectedAdminRoute>
        } />
        <Route path="/admin/ksa-setup" element={
          <ProtectedAdminRoute>
            <LazyLoadErrorBoundary><Suspense fallback={<RouteLoadingFallback />}><AdminKsaSetup /></Suspense></LazyLoadErrorBoundary>
          </ProtectedAdminRoute>
        } />
        <Route path="/admin/superadmin-audit" element={
          <ProtectedAdminRoute>
            <LazyLoadErrorBoundary><Suspense fallback={<RouteLoadingFallback />}><AdminSuperAuditLogs /></Suspense></LazyLoadErrorBoundary>
          </ProtectedAdminRoute>
        } />
        <Route path="/admin/security" element={
          <ProtectedAdminRoute>
            <LazyLoadErrorBoundary><Suspense fallback={<RouteLoadingFallback />}><AdminSecurityDashboard /></Suspense></LazyLoadErrorBoundary>
          </ProtectedAdminRoute>
        } />
        <Route path="/admin/edge-health" element={
          <ProtectedAdminRoute>
            <LazyLoadErrorBoundary><Suspense fallback={<RouteLoadingFallback />}><AdminEdgeFunctionHealth /></Suspense></LazyLoadErrorBoundary>
          </ProtectedAdminRoute>
        } />
        <Route path="/admin/sync-health" element={
          <ProtectedAdminRoute>
            <LazyLoadErrorBoundary><Suspense fallback={<RouteLoadingFallback />}><SyncHealth /></Suspense></LazyLoadErrorBoundary>
          </ProtectedAdminRoute>
        } />
        <Route path="/admin/dlq" element={
          <ProtectedAdminRoute>
            <LazyLoadErrorBoundary><Suspense fallback={<RouteLoadingFallback />}><AdminDLQ /></Suspense></LazyLoadErrorBoundary>
          </ProtectedAdminRoute>
        } />
        <Route path="/admin/release-notes" element={
          <ProtectedAdminRoute>
            <LazyLoadErrorBoundary><Suspense fallback={<RouteLoadingFallback />}><AdminReleaseNotes /></Suspense></LazyLoadErrorBoundary>
          </ProtectedAdminRoute>
        } />
        <Route path="/admin/settings" element={
          <ProtectedAdminRoute>
            <LazyLoadErrorBoundary><Suspense fallback={<RouteLoadingFallback />}><AdminSettings /></Suspense></LazyLoadErrorBoundary>
          </ProtectedAdminRoute>
        } />
        <Route path="/admin/password-reset" element={
          <ProtectedAdminRoute>
            <LazyLoadErrorBoundary><Suspense fallback={<RouteLoadingFallback />}><AdminPasswordReset /></Suspense></LazyLoadErrorBoundary>
          </ProtectedAdminRoute>
        } />
        <Route path="/admin/a11y-dialogs" element={
          <ProtectedAdminRoute>
            <LazyLoadErrorBoundary><Suspense fallback={<RouteLoadingFallback />}><AdminA11yDialogs /></Suspense></LazyLoadErrorBoundary>
          </ProtectedAdminRoute>
        } />
        <Route path="/admin/whatsapp-test" element={
          <ProtectedAdminRoute>
            <LazyLoadErrorBoundary><Suspense fallback={<RouteLoadingFallback />}><WhatsAppTest /></Suspense></LazyLoadErrorBoundary>
          </ProtectedAdminRoute>
        } />
        <Route path="/admin/contact-messages" element={
          <ProtectedAdminRoute>
            <LazyLoadErrorBoundary><Suspense fallback={<RouteLoadingFallback />}><AdminContactMessages /></Suspense></LazyLoadErrorBoundary>
          </ProtectedAdminRoute>
        } />
        <Route path="/admin/enquiries" element={
          <ProtectedAdminRoute>
            <LazyLoadErrorBoundary><Suspense fallback={<RouteLoadingFallback />}><AdminEnquiries /></Suspense></LazyLoadErrorBoundary>
          </ProtectedAdminRoute>
        } />
        <Route path="/admin/lead-sources" element={
          <ProtectedAdminRoute>
            <LazyLoadErrorBoundary><Suspense fallback={<RouteLoadingFallback />}><AdminLeadSources /></Suspense></LazyLoadErrorBoundary>
          </ProtectedAdminRoute>
        } />
        <Route path="/admin/traffic" element={
          <ProtectedAdminRoute>
            <LazyLoadErrorBoundary><Suspense fallback={<RouteLoadingFallback />}><AdminTraffic /></Suspense></LazyLoadErrorBoundary>
          </ProtectedAdminRoute>
        } />
        <Route path="/admin/email-inbox" element={
          <ProtectedAdminRoute>
            <LazyLoadErrorBoundary><Suspense fallback={<RouteLoadingFallback />}><AdminEmailInbox /></Suspense></LazyLoadErrorBoundary>
          </ProtectedAdminRoute>
        } />
        
        {/* Tenant Routes */}
        <Route path="/daily-report" element={
          <TenantRoute Component={StarterDailyReport} />
        } />
        <Route path="/dashboard" element={
          <TenantRoute Component={Index} />
        } />
        <Route path="/shifts" element={
          <TenantRoute Component={Shifts} />
        } />
        <Route path="/sales" element={
          <TenantRoute Component={Sales} />
        } />
        <Route path="/devices" element={
          <TenantRoute Component={DeviceManagement} />
        } />
        <Route path="/sales/analytics" element={
          <TenantRoute Component={SalesAnalytics} />
        } />
        <Route path="/expenses" element={
          <TenantRoute Component={Expenses} />
        } />
        <Route path="/inventory-link-audit" element={
          <TenantRoute Component={InventoryLinkAudit} />
        } />
        <Route path="/inventory-link-rules" element={
          <TenantRoute Component={InventoryLinkRules} />
        } />
        <Route path="/inventory-purchase-verification" element={
          <TenantRoute Component={InventoryPurchaseVerification} />
        } />
        <Route path="/inventory" element={
          <TenantRoute Component={Inventory} />
        } />
        <Route path="/menu" element={
          <TenantRoute Component={Menu} />
        } />
        <Route path="/branch-prices" element={
          <TenantRoute Component={BranchPriceList} />
        } />
        <Route path="/branch-settings" element={
          <TenantRoute Component={BranchSettings} />
        } />
        <Route path="/pos-tables" element={
          <TenantRoute Component={PosTables} />
        } />
        <Route path="/reservations" element={
          <TenantRoute Component={Reservations} />
        } />
        {kdsEnabled && (
          <>
            <Route path="/kds" element={
              <TenantRoute Component={KitchenDisplay} />
            } />
            <Route path="/kds-stations" element={
              <TenantRoute Component={KdsStations} />
            } />
            <Route path="/kds-report" element={
              <TenantRoute Component={KitchenReport} />
            } />
          </>
        )}
        <Route path="/floor-plan" element={
          <TenantRoute Component={FloorPlan} />
        } />
        <Route path="/table-timeline" element={
          <TenantRoute Component={TableTimeline} />
        } />
        <Route path="/floor-audit-log" element={
          <TenantRoute Component={FloorAuditLog} />
        } />
        <Route path="/online-orders" element={
          <TenantRoute Component={OnlineOrders} />
        } />
        <Route path="/order-manager" element={
          <TenantRoute Component={OrderManager} />
        } />
        <Route path="/online-order-settings" element={
          <TenantRoute Component={OnlineOrderSettings} />
        } />
        <Route path="/aggregators" element={
          <TenantRoute Component={Aggregators} />
        } />
        <Route path="/channel-pnl" element={
          <TenantRoute Component={ChannelPnL} />
        } />
        <Route path="/waiter" element={
          <TenantRoute Component={Waiter} />
        } />
        <Route path="/loyalty" element={
          <TenantRoute Component={Loyalty} />
        } />
        <Route path="/kiosk" element={
          <TenantRoute Component={Kiosk} />
        } />
        <Route path="/riders" element={
          <TenantRoute Component={Riders} />
        } />
        <Route path="/recipes" element={
          <TenantRoute Component={Recipes} />
        } />
        <Route path="/inventory-audit" element={
          <TenantRoute Component={InventoryAudit} />
        } />
        <Route path="/ingredient-mappings" element={
          <TenantRoute Component={IngredientCategoryMappings} />
        } />
        <Route path="/cogs-trueup" element={
          <TenantRoute Component={CogsTrueup} />
        } />
        <Route path="/offline-sync" element={
          <TenantRoute Component={OfflineSyncCenter} />
        } />
        <Route path="/pos-terminals" element={
          <TenantRoute Component={PosTerminals} />
        } />
        <Route path="/terminal-branch-settings" element={
          <TenantRoute Component={TerminalBranchSettings} />
        } />
        <Route path="/terminal-pricing-report" element={
          <TenantRoute Component={TerminalPricingReport} />
        } />
        <Route path="/terminal-sync-health" element={
          <TenantRoute Component={TerminalSyncHealth} />
        } />
        <Route path="/reports/pos-ack-diagnostics" element={
          <TenantRoute Component={PosAckDiagnostics} />
        } />
        <Route path="/reports/sale-posting-monitor" element={
          <TenantRoute Component={SalePostingMonitor} />
        } />
        <Route path="/reports/seo-diagnostics" element={
          <TenantRoute Component={SeoDiagnostics} />
        } />
        <Route path="/reports/daily-reconciliation" element={
          <TenantRoute Component={DailyReconciliationReport} />
        } />
        <Route path="/offline-audit" element={
          <TenantRoute Component={OfflineAuditReport} />
        } />
        {/* Temporary routing diagnostics — intentionally outside the guards so
            it stays reachable even while a redirect loop is happening. */}
        <Route path="/debug/routing" element={
          <Suspense fallback={<RouteLoadingFallback />}>
            <LazyLoadErrorBoundary>
              <RoutingDebug />
            </LazyLoadErrorBoundary>
          </Suspense>
        } />
        <Route path="/record-sale" element={
          <TenantRoute Component={GatedRecordSale} bareLayout />
        } />
        <Route path="/end-of-day-summary" element={
          <TenantRoute Component={EndOfDaySummary} />
        } />
        <Route path="/pos-backfill" element={
          <TenantRoute Component={PosBackfill} />
        } />
        <Route path="/reports" element={
          <TenantRoute Component={Reports} />
        } />
        <Route path="/reports/vat-return" element={
          <TenantRoute Component={VatReturn} />
        } />
        <Route path="/reports/vat-audit" element={
          <TenantRoute Component={VatAudit} />
        } />
        <Route path="/expenses/pending-vat-split" element={
          <TenantRoute Component={PendingVatSplit} />
        } />
        <Route path="/reports/price-reconciliation" element={
          <TenantRoute Component={PriceReconciliation} />
        } />
        <Route path="/reports/trial-balance" element={
          <TenantRoute Component={TrialBalance} />
        } />
        <Route path="/reports/profit-loss" element={
          <TenantRoute Component={ProfitLoss} />
        } />
        <Route path="/reports/sales-item-breakdown" element={
          <TenantRoute Component={SalesItemBreakdown} />
        } />
        <Route path="/reports/sales-journal" element={
          <TenantRoute Component={SalesJournal} />
        } />
        <Route path="/reports/cash-card" element={
          <TenantRoute Component={CashCardAnalysis} />
        } />
        <Route path="/accounting/zatca-invoices" element={
          <TenantRoute Component={ZatcaInvoices} />
        } />
        <Route path="/accounting/zatca-provider" element={
          <TenantRoute Component={ZatcaProviderApplication} />
        } />
        <Route path="/reports/cash-flow" element={
          <TenantRoute Component={CashFlow} />
        } />
        <Route path="/reports/balance-sheet" element={
          <TenantRoute Component={BalanceSheet} />
        } />
        <Route path="/reports/financial-statements" element={
          <TenantRoute Component={FinancialStatements} />
        } />
        <Route path="/reports/depreciation" element={
          <TenantRoute Component={DepreciationReport} />
        } />
        <Route path="/reports/ap-aging" element={
          <TenantRoute Component={ApAging} />
        } />
        <Route path="/reports/ap-audit-trail" element={
          <TenantRoute Component={ApAuditTrail} />
        } />
        <Route path="/reports/supplier-ledger" element={
          <TenantRoute Component={SupplierLedger} />
        } />
        <Route path="/reports/supplier-ap-reconciliation" element={
          <TenantRoute Component={SupplierApReconciliation} />
        } />
        <Route path="/reports/expense-ledger-reconciliation" element={
          <TenantRoute Component={ExpenseLedgerReconciliation} />
        } />
        <Route path="/reports/invoice-ledger-reconciliation" element={
          <TenantRoute Component={InvoiceLedgerReconciliation} />
        } />
        <Route path="/reports/supplier-ap-head-audit" element={
          <TenantRoute Component={SupplierApHeadAudit} />
        } />
        <Route path="/reports/reversal-audit" element={
          <TenantRoute Component={ReversalAudit} />
        } />
        <Route path="/reports/day-end-status" element={
          <TenantRoute Component={DayEndStatusMatrix} />
        } />
        <Route path="/reports/ledger-mapping" element={
          <TenantRoute Component={LedgerMapping} />
        } />
        <Route path="/reports/card-sales-by-branch" element={
          <TenantRoute Component={CardSalesByBranch} />
        } />
        <Route path="/reports/branch-ledger" element={
          <TenantRoute Component={BranchLedger} />
        } />
        <Route path="/accounting/owner-capital" element={
          <TenantRoute Component={OwnerCapital} />
        } />
        <Route path="/accounting/installments" element={
          <TenantRoute Component={Installments} />
        } />
        <Route path="/accounting/fixed-assets" element={
          <TenantRoute Component={FixedAssets} />
        } />
        <Route path="/accounting/projects" element={
          <TenantRoute Component={Projects} />
        } />
        <Route path="/compliance" element={
          <TenantRoute Component={Compliance} />
        } />
        <Route path="/accounting/installment-reconciliation" element={
          <TenantRoute Component={InstallmentReconciliation} />
        } />
        <Route path="/accounting/bnpl-report" element={
          <TenantRoute Component={BnplReport} />
        } />
        <Route path="/accounting/card-settlement-clearing" element={
          <TenantRoute Component={CardSettlementClearing} />
        } />
        <Route path="/accounting/coa-migration" element={
          <TenantRoute Component={CoaMigrationPreview} />
        } />
        <Route path="/accounting/posting-rule-audit" element={
          <TenantRoute Component={PostingRuleAudit} />
        } />
        <Route path="/accounting/daily-overhead" element={
          <TenantRoute Component={DailyOverheadClosing} />
        } />
        <Route path="/reports/overhead-reconciliation" element={
          <TenantRoute Component={OverheadReconciliation} />
        } />
        <Route path="/accounting/capital-statement-match" element={
          <TenantRoute Component={CapitalStatementMatch} />
        } />
        <Route path="/reports/overhead-audit" element={
          <TenantRoute Component={OverheadAudit} />
        } />
        <Route path="/zatca-compliance" element={
          <TenantRoute Component={ZatcaCompliance} />
        } />
        <Route path="/daily-profit" element={
          <TenantRoute Component={DailyProfit} />
        } />
        <Route path="/cockpit" element={
          <TenantRoute Component={Cockpit} />
        } />
        <Route path="/manager" element={
          <TenantRoute Component={ManagerApp} bareLayout />
        } />
        <Route path="/cockpit/stocktake" element={
          <TenantRoute Component={CockpitStocktake} />
        } />
        <Route path="/cockpit/summary/:ymd" element={
          <TenantRoute Component={CockpitSummary} />
        } />
        <Route path="/cogs" element={
          <TenantRoute Component={COGS} />
        } />
        <Route path="/customers" element={
          <TenantRoute Component={Customers} />
        } />
        <Route path="/customers/:id" element={
          <TenantRoute Component={CustomerDetail} />
        } />
        <Route path="/settlements" element={
          <TenantRoute Component={Settlements} />
        } />
        <Route path="/chat" element={
          <TenantRoute Component={Chat} />
        } />
        <Route path="/audit-logs" element={
          <TenantRoute Component={AuditLogs} />
        } />
        <Route path="/accounting" element={
          <TenantRoute Component={Accounting} />
        } />
        <Route path="/finance-dashboard" element={
          <TenantRoute Component={FinanceDashboard} />
        } />
        <Route path="/web-builder" element={
          <TenantRoute Component={WebBuilder} />
        } />
        <Route path="/settings" element={
          <TenantRoute Component={Settings} />
        } />
        <Route path="/team" element={
          <TenantRoute Component={Team} />
        } />
        <Route path="/staff" element={
          <TenantRoute Component={Staff} />
        } />
        <Route path="/staff/fines-history" element={
          <TenantRoute Component={FinesHistory} />
        } />
        <Route path="/staff/salary-calendar" element={
          <TenantRoute Component={SalaryCalendar} />
        } />
        <Route path="/staff/payroll-journal" element={
          <TenantRoute Component={PayrollJournal} />
        } />
        <Route path="/billing" element={
          <TenantRoute Component={Billing} />
        } />
        <Route path="/migration" element={
          <TenantRoute Component={MigrationPage} />
        } />
        <Route path="*" element={<LazyRoute Component={NotFound} />} />
      </Routes>
    </AnimatePresence>
  );
}
