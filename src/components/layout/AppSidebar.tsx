import { useState, useRef, useLayoutEffect, useEffect, memo } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  Clock,
  Receipt,
  Package,
  BarChart3,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Command,
  Users,
  UserCog,
  Wallet,
  Link2,
  MessageCircle,
  CreditCard,
  LogOut,
  UtensilsCrossed,
  ShoppingCart,
  UsersRound,
  FileText,
  Menu,
  PieChart,
  ClipboardList,
  CircleDollarSign,
  Lock,
  Globe,
  ChefHat,
  Activity,
  Tags,
  Scale,
  Percent,
  CloudOff,
  Monitor,
  ShieldCheck,
  Smartphone,
  Rocket,
  QrCode,
  ShoppingBag,
  ArrowRightLeft,
  BookOpen,
  ShieldAlert,
  BookOpenCheck,
  CalendarClock,
} from "lucide-react";
import { Soup, Webhook, CalendarCheck } from "lucide-react";
import { Building2 } from "lucide-react";
import { LayoutGrid } from "lucide-react";
import { History as HistoryIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { MatbexLogo } from "@/components/brand/MatbexLogo";
import { usePrefetchRoute } from "@/hooks/usePrefetchRoute";
import { FeatureReadinessIndicator } from "@/components/FeatureReadinessIndicator";
import { FeatureLegend } from "@/components/FeatureLegend";
import { useFeatureFlag } from "@/hooks/useFeatureFlags";
import { TestAsRoleDialog } from "@/components/auth/TestAsRoleDialog";
import { isStarterPlan } from "@/lib/starterPlan";

const getStarterNavGroups = (t: (key: string, options?: { defaultValue?: string }) => string) => [
  {
    label: "Operations",
    items: [
      { title: t("nav.dashboard"), url: "/dashboard", icon: LayoutDashboard, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: undefined as string | undefined },
      { title: t("dashboard.recordSale"), url: "/record-sale", icon: ShoppingCart, cashierAllowed: true, accountantAllowed: false, ownerOnly: false, featureKey: undefined as string | undefined },
      { title: "Daily report", url: "/daily-report", icon: Receipt, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: undefined as string | undefined },
      { title: t("nav.shifts"), url: "/shifts", icon: Clock, cashierAllowed: true, accountantAllowed: false, ownerOnly: false, featureKey: undefined as string | undefined },
      { title: t("nav.sales"), url: "/sales", icon: Receipt, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: undefined as string | undefined },
      { title: t("nav.menu"), url: "/menu", icon: UtensilsCrossed, cashierAllowed: false, accountantAllowed: false, ownerOnly: false, featureKey: undefined as string | undefined },
      { title: t("nav.settings"), url: "/settings", icon: Settings, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: undefined as string | undefined },
    ],
  },
];

// Navigation structure with translation keys
const getNavGroups = (t: (key: string, options?: { defaultValue?: string }) => string) => {
  const groups = [
  {
    label: "Operations",
    items: [
      { title: t("nav.dashboard"), url: "/dashboard", icon: LayoutDashboard, cashierAllowed: false, accountantAllowed: true, ownerOnly: false },
      { title: t("dashboard.recordSale"), url: "/record-sale", icon: ShoppingCart, cashierAllowed: true, accountantAllowed: false, ownerOnly: false },
      { title: t("nav.shifts"), url: "/shifts", icon: Clock, cashierAllowed: true, accountantAllowed: false, ownerOnly: false, featureKey: "shifts" },
      { title: "QR Tables", url: "/pos-tables", icon: QrCode, cashierAllowed: false, accountantAllowed: false, ownerOnly: false },
      { title: "Table Bookings", url: "/reservations", icon: CalendarCheck, cashierAllowed: true, accountantAllowed: false, ownerOnly: false },
      { title: "Floor Plan", url: "/floor-plan", icon: LayoutGrid, cashierAllowed: true, accountantAllowed: false, ownerOnly: false },
      { title: "Table Timeline", url: "/table-timeline", icon: Activity, cashierAllowed: false, accountantAllowed: true, ownerOnly: false },
      { title: "Floor Audit Log", url: "/floor-audit-log", icon: HistoryIcon, cashierAllowed: false, accountantAllowed: true, ownerOnly: false },
      { title: "Online Orders", url: "/online-orders", icon: ShoppingBag, cashierAllowed: true, accountantAllowed: true, ownerOnly: false },
      { title: "Order Manager", url: "/order-manager", icon: ChefHat, cashierAllowed: true, accountantAllowed: false, ownerOnly: false },
      { title: "Waiter", url: "/waiter", icon: Soup, cashierAllowed: true, accountantAllowed: false, ownerOnly: false, flagKey: "waiter_app_enabled" },
      { title: "Kitchen Display", url: "/kds", icon: ChefHat, cashierAllowed: true, accountantAllowed: false, ownerOnly: false },
      { title: "Kitchen Report", url: "/kds-report", icon: BarChart3, cashierAllowed: false, accountantAllowed: true, ownerOnly: false },
    ],
  },
  {
    label: t("nav.sales"),
    items: [
      { title: t("nav.sales"), url: "/sales", icon: Receipt, cashierAllowed: false, accountantAllowed: true, ownerOnly: false },
      { title: "Sales Analytics", url: "/sales/analytics", icon: BarChart3, cashierAllowed: false, accountantAllowed: true, ownerOnly: false },
      { title: t("nav.customers"), url: "/customers", icon: UsersRound, cashierAllowed: false, accountantAllowed: true, ownerOnly: false },
      { title: "Settlements", url: "/settlements", icon: FileText, cashierAllowed: false, accountantAllowed: true, ownerOnly: false },
      { title: "Offline Sync", url: "/offline-sync", icon: CloudOff, cashierAllowed: true, accountantAllowed: false, ownerOnly: false },
      { title: "POS Terminals", url: "/pos-terminals", icon: Monitor, cashierAllowed: false, accountantAllowed: false, ownerOnly: false },
      { title: "Terminal Branches", url: "/terminal-branch-settings", icon: Monitor, cashierAllowed: false, accountantAllowed: false, ownerOnly: false },
      { title: "Terminal Pricing Report", url: "/terminal-pricing-report", icon: Monitor, cashierAllowed: false, accountantAllowed: false, ownerOnly: false },
      { title: "Terminal Sync Health", url: "/terminal-sync-health", icon: Activity, cashierAllowed: false, accountantAllowed: true, ownerOnly: false },
      { title: "POS Ack Diagnostics", url: "/reports/pos-ack-diagnostics", icon: Activity, cashierAllowed: false, accountantAllowed: true, ownerOnly: false },
      { title: "Sale Posting Monitor", url: "/reports/sale-posting-monitor", icon: Activity, cashierAllowed: false, accountantAllowed: true, ownerOnly: false },
      { title: "Daily Reconciliation", url: "/reports/daily-reconciliation", icon: Activity, cashierAllowed: false, accountantAllowed: true, ownerOnly: false },
      { title: "Licensed Devices", url: "/devices", icon: Monitor, cashierAllowed: false, accountantAllowed: false, ownerOnly: false },
    ],
  },
  {
    label: "Cost Control",
    items: [
      { title: t("nav.expenses"), url: "/expenses", icon: Wallet, cashierAllowed: false, accountantAllowed: true, ownerOnly: false },
      { title: "Pending VAT Split", url: "/expenses/pending-vat-split", icon: Percent, cashierAllowed: false, accountantAllowed: true, ownerOnly: false },
      { title: t("nav.menu"), url: "/menu", icon: UtensilsCrossed, cashierAllowed: false, accountantAllowed: false, ownerOnly: false, featureKey: "menu" },
      { title: "Recipes", url: "/recipes", icon: ChefHat, cashierAllowed: false, accountantAllowed: false, ownerOnly: false, featureKey: "menu" },
      { title: t("nav.inventory"), url: "/inventory", icon: Package, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: "inventory" },
      { title: t("nav.cogs"), url: "/cogs", icon: PieChart, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: "cogs" },
      { title: "Inventory Audit", url: "/inventory-audit", icon: Activity, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: "inventory" },
      { title: "Account Mappings", url: "/ingredient-mappings", icon: Tags, cashierAllowed: false, accountantAllowed: true, ownerOnly: true, featureKey: "accounting" },
      { title: "COGS True-up", url: "/cogs-trueup", icon: Scale, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: "cogs" },
    ],
  },
  {
    label: "Finance",
    items: [
      { title: "Finance Dashboard", url: "/finance-dashboard", icon: CircleDollarSign, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: "accounting" },
      { title: t("nav.accounting"), url: "/accounting", icon: CircleDollarSign, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: "accounting" },
      { title: t("nav.reports"), url: "/reports", icon: BarChart3, cashierAllowed: false, accountantAllowed: true, ownerOnly: false },
      { title: t("app.salesItemBreakdown.title"), url: "/reports/sales-item-breakdown", icon: BarChart3, cashierAllowed: false, accountantAllowed: true, ownerOnly: false },
      { title: t("app.salesJournal.title"), url: "/reports/sales-journal", icon: BarChart3, cashierAllowed: false, accountantAllowed: true, ownerOnly: false },
      { title: t("app.cashCard.title"), url: "/reports/cash-card", icon: BarChart3, cashierAllowed: false, accountantAllowed: true, ownerOnly: false },
      { title: t("app.zatcaInvoices.title", { defaultValue: "ZATCA Invoices" }), url: "/accounting/zatca-invoices", icon: BarChart3, cashierAllowed: false, accountantAllowed: true, ownerOnly: false },
      { title: t("app.zatcaProvider.title", { defaultValue: "ZATCA Provider Application" }), url: "/accounting/zatca-provider", icon: BarChart3, cashierAllowed: false, accountantAllowed: false, ownerOnly: true },
      { title: "VAT Return", url: "/reports/vat-return", icon: Percent, cashierAllowed: false, accountantAllowed: true, ownerOnly: false },
      { title: "VAT Audit", url: "/reports/vat-audit", icon: Percent, cashierAllowed: false, accountantAllowed: true, ownerOnly: false },
      { title: "Price Reconciliation", url: "/reports/price-reconciliation", icon: Scale, cashierAllowed: false, accountantAllowed: true, ownerOnly: false },
      { title: "Trial Balance", url: "/reports/trial-balance", icon: Scale, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: "accounting" },
      { title: t("app.financialStatements.title"), url: "/reports/financial-statements", icon: LayoutGrid, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: "accounting" },
      { title: t("app.profitLoss.title"), url: "/reports/profit-loss", icon: PieChart, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: "accounting" },
      { title: "Balance Sheet", url: "/reports/balance-sheet", icon: BookOpenCheck, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: "accounting" },
      { title: "Cash Flow", url: "/reports/cash-flow", icon: Scale, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: "accounting" },
      { title: "Ledger Mapping", url: "/reports/ledger-mapping", icon: ArrowRightLeft, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: "accounting" },
      { title: "Supplier Ledger", url: "/reports/supplier-ledger", icon: BookOpen, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: "accounting" },
      { title: "Supplier AP Reconciliation", url: "/reports/supplier-ap-reconciliation", icon: Scale, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: "accounting" },
      { title: "Expense Ledger Reconciliation", url: "/reports/expense-ledger-reconciliation", icon: Scale, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: "accounting" },
      { title: "Invoice Ledger Reconciliation", url: "/reports/invoice-ledger-reconciliation", icon: Scale, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: "accounting" },
      { title: "Supplier AP Head Audit", url: "/reports/supplier-ap-head-audit", icon: HistoryIcon, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: "accounting" },
      { title: "Asset Depreciation", url: "/reports/depreciation", icon: Building2, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: "accounting" },
      { title: "Card Sales by Branch", url: "/reports/card-sales-by-branch", icon: CreditCard, cashierAllowed: false, accountantAllowed: true, ownerOnly: false },
      { title: "Branch Ledger", url: "/reports/branch-ledger", icon: Scale, cashierAllowed: false, accountantAllowed: true, ownerOnly: false },
      { title: "Owner Capital", url: "/accounting/owner-capital", icon: Wallet, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: "accounting" },
      { title: "Installments (BNPL)", url: "/accounting/installments", icon: CalendarClock, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: "accounting" },
      { title: "Fixed Assets", url: "/accounting/fixed-assets", icon: Building2, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: "accounting" },
      { title: "Projects", url: "/accounting/projects", icon: Building2, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: "accounting" },
      { title: "Installment Reconciliation", url: "/accounting/installment-reconciliation", icon: Scale, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: "accounting" },
      { title: "BNPL Reporting", url: "/accounting/bnpl-report", icon: CalendarClock, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: "accounting" },
      { title: "Card Settlement Clearing", url: "/accounting/card-settlement-clearing", icon: CreditCard, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: "accounting" },
      { title: "CoA Migration", url: "/accounting/coa-migration", icon: ArrowRightLeft, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: "accounting" },
      { title: "Posting Rule Audit", url: "/accounting/posting-rule-audit", icon: ShieldAlert, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: "accounting" },
      { title: "Daily Overhead Closing", url: "/accounting/daily-overhead", icon: Lock, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: "accounting" },
      { title: "Bank Statement Match", url: "/accounting/capital-statement-match", icon: Link2, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: "accounting" },
      { title: "Overhead Audit", url: "/reports/overhead-audit", icon: Scale, cashierAllowed: false, accountantAllowed: true, ownerOnly: false },
      { title: "Overhead Reconciliation", url: "/reports/overhead-reconciliation", icon: Scale, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: "accounting" },
      { title: "ZATCA Compliance", url: "/zatca-compliance", icon: ShieldCheck, cashierAllowed: false, accountantAllowed: true, ownerOnly: false },
      { title: "Channel P&L", url: "/channel-pnl", icon: PieChart, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, flagKey: "channel_pnl_enabled" },
    ],
  },
  {
    label: "Team",
    items: [
      { title: t("nav.staff"), url: "/staff", icon: UserCog, cashierAllowed: false, accountantAllowed: false, ownerOnly: false, featureKey: "payroll" },
      { title: "Salary Calendar", url: "/staff/salary-calendar", icon: CalendarClock, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: "payroll" },
      { title: "Payroll Journal", url: "/staff/payroll-journal", icon: BookOpenCheck, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: "payroll" },
      { title: "Fines & Deductions History", url: "/staff/fines-history", icon: Scale, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: "payroll" },
      { title: t("nav.chat"), url: "/chat", icon: MessageCircle, cashierAllowed: true, accountantAllowed: true, ownerOnly: false, featureKey: "chat" },
      { title: "Team", url: "/team", icon: Users, cashierAllowed: false, accountantAllowed: false, ownerOnly: false },
      { title: "Riders", url: "/riders", icon: Users, cashierAllowed: false, accountantAllowed: false, ownerOnly: false },
    ],
  },
  {
    label: "Compliance",
    items: [
      { title: "Balady & Compliance", url: "/compliance", icon: ShieldCheck, cashierAllowed: false, accountantAllowed: true, ownerOnly: false, featureKey: undefined as string | undefined },
    ],
  },
  {
    label: "Marketing",
    items: [
      { title: t("nav.webBuilder"), url: "/web-builder", icon: Globe, cashierAllowed: false, accountantAllowed: false, ownerOnly: false, featureKey: "web_builder" },
      { title: "Loyalty", url: "/loyalty", icon: PieChart, cashierAllowed: false, accountantAllowed: false, ownerOnly: false },
      { title: "SEO Diagnostics", url: "/reports/seo-diagnostics", icon: Globe, cashierAllowed: false, accountantAllowed: false, ownerOnly: true },
      { title: "Kiosk", url: "/kiosk", icon: Webhook, cashierAllowed: true, accountantAllowed: false, ownerOnly: false },
    ],
  },
  {
    label: "Administration",
    items: [
      { title: t("nav.auditLogs"), url: "/audit-logs", icon: ClipboardList, cashierAllowed: false, accountantAllowed: true, ownerOnly: true },
      { title: t("nav.billing"), url: "/billing", icon: CreditCard, cashierAllowed: false, accountantAllowed: true, ownerOnly: false },
      { title: "Aggregators", url: "/aggregators", icon: Webhook, cashierAllowed: false, accountantAllowed: false, ownerOnly: true, flagKey: "aggregators_enabled" },
      { title: "Migration", url: "/migration", icon: Rocket, cashierAllowed: false, accountantAllowed: false, ownerOnly: false },
      { title: t("nav.settings"), url: "/settings", icon: Settings, cashierAllowed: false, accountantAllowed: true, ownerOnly: false },
    ],
  },
  ];

  return groups.map((group) => ({
    ...group,
    label: t(`productNav.${group.label}`, { defaultValue: group.label }),
    items: group.items.map((item) => ({
      ...item,
      title: t(`productNav.${item.title}`, { defaultValue: item.title }),
    })),
  }));
};

interface AppSidebarProps {
  onOpenCommandPalette: () => void;
}

// Remount safeguard: the sidebar must mount exactly once per session. If this
// counter ever exceeds 1 while the app stays mounted, something above it is
// recreating the component type (inline component, changing `key`, remounted
// layout) and scroll/UI state would be lost.
let sidebarMountCount = 0;

function AppSidebarBase({ onOpenCommandPalette }: AppSidebarProps) {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.dir() === "rtl";
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut, profile, hasRole, hasFeature, isManager, isOwner, canImpersonateRoles, isRoleImpersonating, plan, isSuperAdmin } = useAuth() as any;
  const { impersonatedRole } = useAuth();
  const [testAsOpen, setTestAsOpen] = useState(false);
  const isMobile = useIsMobile();
  const prefetchRoute = usePrefetchRoute();
  const kdsEnabled = useFeatureFlag("kds", false);
  const waiterEnabled = useFeatureFlag("waiter_app_enabled", false);
  const aggregatorsEnabled = useFeatureFlag("aggregators_enabled", false);
  const channelPnlEnabled = useFeatureFlag("channel_pnl_enabled", true);
  const remoteFlags: Record<string, boolean> = {
    waiter_app_enabled: waiterEnabled,
    aggregators_enabled: aggregatorsEnabled,
    channel_pnl_enabled: channelPnlEnabled,
  };
  
  const navGroups = (!isSuperAdmin && isStarterPlan(plan) ? getStarterNavGroups(t) : getNavGroups(t)) as ReturnType<typeof getNavGroups>;
  
  // Collapse sidebar by default on Record Sale page
  const [collapsed, setCollapsed] = useState(location.pathname === '/record-sale');
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    sidebarMountCount += 1;
    if (import.meta.env.DEV && sidebarMountCount > 1) {
      console.warn(
        `[AppSidebar] remounted (${sidebarMountCount}x). The sidebar must stay mounted across navigation — ` +
          `check for an inline component wrapper, a changing \`key\`, or AppLayout being re-created per route.`,
      );
    }
    return () => {
      sidebarMountCount -= 1;
    };
  }, []);

  // Keep the sidebar's scroll offset stable across route changes so clicking
  // a nav item never yanks the menu back to the top.
  const navScrollRef = useRef<HTMLElement | null>(null);
  const navScrollTop = useRef(
    (() => {
      try {
        return Number(sessionStorage.getItem('matbex.sidebarScrollTop')) || 0;
      } catch {
        return 0;
      }
    })()
  );
  // True once the persisted offset has been applied (or is unreachable).
  // Until then we ignore scroll events, so the browser clamping scrollTop to 0
  // on first paint never overwrites the stored value.
  const scrollRestored = useRef(navScrollTop.current === 0);
  useLayoutEffect(() => {
    const el = navScrollRef.current;
    if (!el) return;
    const target = navScrollTop.current;
    if (target && el.scrollTop !== target) {
      el.scrollTop = target;
      if (el.scrollTop === target) scrollRestored.current = true;
    }
  });

  // On a fresh load the nav content mounts progressively (feature flags,
  // collapsible groups), so the container may be too short to reach the saved
  // offset on first paint. Re-apply as it grows, then stop.
  useEffect(() => {
    const el = navScrollRef.current;
    if (!el || scrollRestored.current) return;
    const apply = () => {
      const target = navScrollTop.current;
      el.scrollTop = target;
      if (el.scrollTop === target) scrollRestored.current = true;
    };
    apply();
    const observer = new ResizeObserver(apply);
    Array.from(el.children).forEach((child) => observer.observe(child));
    observer.observe(el);
    const stop = window.setTimeout(() => {
      scrollRestored.current = true;
      observer.disconnect();
    }, 4000);
    return () => {
      window.clearTimeout(stop);
      observer.disconnect();
    };
  }, []);

  const persistNavScroll = (top: number) => {
    if (!scrollRestored.current) return;
    navScrollTop.current = top;
    try {
      sessionStorage.setItem('matbex.sidebarScrollTop', String(top));
    } catch {
      /* storage unavailable */
    }
  };
  
  // Find which group contains the active route
  const getActiveGroup = () => {
    for (const group of navGroups) {
      if (group.items.some(item => item.url === location.pathname)) {
        return group.label;
      }
    }
    return navGroups[0]?.label || '';
  };
  
  // Track which groups are expanded - only active group open by default
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => {
    // Restore the previous expand/collapse layout first — otherwise the nav is
    // shorter after a reload and the saved scroll offset can't be reached.
    try {
      const saved = sessionStorage.getItem('matbex.sidebarExpandedGroups');
      if (saved) {
        const parsed = JSON.parse(saved) as Record<string, boolean>;
        if (parsed && typeof parsed === 'object') {
          return navGroups.reduce(
            (acc, group) => ({ ...acc, [group.label]: !!parsed[group.label] }),
            {},
          );
        }
      }
    } catch {
      /* storage unavailable or corrupt */
    }
    const activeGroup = getActiveGroup();
    return navGroups.reduce((acc, group) => ({ 
      ...acc, 
      [group.label]: group.label === activeGroup 
    }), {});
  });

  const toggleGroup = (label: string) => {
    setExpandedGroups(prev => {
      const next = { ...prev, [label]: !prev[label] };
      try {
        sessionStorage.setItem('matbex.sidebarExpandedGroups', JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  };

  // Filter nav groups based on role (but keep feature-gated items for locked display)
  const isCashierOnly = hasRole("cashier") && !isManager && !isOwner;
  const isAccountantOnly = hasRole("accountant") && !isManager && !isOwner && !hasRole("cashier");
  
  const filteredGroups = navGroups
    .map(group => ({
      ...group,
      items: group.items
        .filter(item => !isCashierOnly || item.cashierAllowed)
        .filter(item => !isAccountantOnly || item.accountantAllowed)
        .filter(item => !item.ownerOnly || isOwner)
        .filter(item => kdsEnabled || (item.url !== "/kds" && item.url !== "/kds-report" && item.url !== "/kds-stations")),
    }))
    .map(group => ({
      ...group,
      items: group.items.filter((item: any) => !item.flagKey || remoteFlags[item.flagKey]),
    }))
    .filter(group => group.items.length > 0);

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  const handleNavClick = () => {
    if (isMobile) {
      setMobileOpen(false);
    }
  };

  const handleLockedClick = (title: string) => {
    toast.info(`${title} is a Pro feature`, {
      description: "Upgrade your plan to unlock this feature.",
    });
  };

  const renderNavItem = (item: typeof navGroups[0]['items'][0]) => {
    const isActive = location.pathname === item.url;
    const isLocked = item.featureKey && !hasFeature(item.featureKey);

    // Locked item - show with lock icon and readiness indicator
    if (isLocked) {
      const lockedContent = (
        <button
          key={item.title}
          onClick={() => handleLockedClick(item.title)}
          className={cn(
            "flex min-h-10 items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200 w-full text-start",
            "text-muted-foreground/60 hover:bg-accent/50 cursor-pointer"
          )}
        >
          <item.icon className="h-4 w-4 flex-shrink-0 opacity-50" />
          {(!collapsed || isMobile) && (
            <>
              <span className="flex-1 opacity-60">{item.title}</span>
              <div className="flex items-center gap-1.5">
                <Lock className="h-3 w-3 opacity-50" />
                {item.featureKey && (
                  <FeatureReadinessIndicator featureKey={item.featureKey} showLabel={false} />
                )}
              </div>
            </>
          )}
        </button>
      );

      if (collapsed && !isMobile) {
        return (
          <Tooltip key={item.title} delayDuration={0}>
            <TooltipTrigger asChild>{lockedContent}</TooltipTrigger>
            <TooltipContent side="right" className="font-normal flex items-center gap-2 rtl:data-[side=right]:translate-x-0">
              <Lock className="h-3 w-3" />
              {item.title}
              {item.featureKey && (
                <FeatureReadinessIndicator featureKey={item.featureKey} />
              )}
            </TooltipContent>
          </Tooltip>
        );
      }

      return lockedContent;
    }

    // Normal unlocked item
    const linkContent = (
      <NavLink
        key={item.title}
        to={item.url}
        onClick={handleNavClick}
        onMouseEnter={() => prefetchRoute(item.url)}
        onFocus={() => prefetchRoute(item.url)}
        onTouchStart={() => prefetchRoute(item.url)}
        className={cn(
          "flex min-h-10 items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200",
          "hover:bg-accent hover:text-accent-foreground",
          isActive
            ? "active-nav-marker bg-accent text-primary font-semibold"
            : "text-sidebar-foreground"
        )}
      >
        <item.icon className={cn("h-4 w-4 flex-shrink-0", isActive && "text-primary")} />
        {(!collapsed || isMobile) && (
          <>
            <span className="flex-1">{item.title}</span>
            {item.featureKey && (
              <FeatureReadinessIndicator featureKey={item.featureKey} showLabel={false} />
            )}
          </>
        )}
      </NavLink>
    );

    if (collapsed && !isMobile) {
      return (
        <Tooltip key={item.title} delayDuration={0}>
          <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
          <TooltipContent side="right" className="font-normal flex items-center gap-2">
            {item.title}
            {item.featureKey && (
              <FeatureReadinessIndicator featureKey={item.featureKey} />
            )}
          </TooltipContent>
        </Tooltip>
      );
    }

    return linkContent;
  };

  // NOTE: this must stay a plain JSX value, not an inline component.
  // Roving arrow-key navigation inside the sidebar nav. Focus moves without
  // yanking the scroll container: we focus with preventScroll and only nudge
  // the target into view with block:"nearest" when it is actually off-screen.
  const handleNavKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(e.key)) return;

    const container = navScrollRef.current;
    if (!container) return;

    const items = Array.from(
      container.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
    ).filter((el) => el.offsetParent !== null);
    if (items.length === 0) return;

    const current = document.activeElement as HTMLElement | null;
    const index = current ? items.indexOf(current) : -1;

    let next: HTMLElement;
    if (e.key === 'Home') next = items[0];
    else if (e.key === 'End') next = items[items.length - 1];
    else if (e.key === 'ArrowDown') next = items[index < 0 ? 0 : (index + 1) % items.length];
    else next = items[index <= 0 ? items.length - 1 : index - 1];

    e.preventDefault();
    next.focus({ preventScroll: true });

    const cRect = container.getBoundingClientRect();
    const nRect = next.getBoundingClientRect();
    if (nRect.top < cRect.top || nRect.bottom > cRect.bottom) {
      next.scrollIntoView({ block: 'nearest' });
    }
    navScrollTop.current = container.scrollTop;
    scrollRestored.current = true;
    persistNavScroll(container.scrollTop);
  };

  // Defining it as `() => (...)` created a brand-new component type on
  // every render, so React remounted the whole nav on each navigation and
  // the sidebar scroll position snapped back to the top.
  const sidebarContent = (
    <>
      {/* Header */}
      <div className="flex items-center justify-between h-16 px-4 border-b border-border/80">
        {!collapsed && (
          <div className="fade-slide-in">
            <MatbexLogo size="md" animate={false} />
          </div>
        )}
        {!isMobile && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <ChevronRight className="h-4 w-4 rtl-flip" /> : <ChevronLeft className="h-4 w-4 rtl-flip" />}
          </Button>
        )}
      </div>

      {/* Gap #7 — make impersonation visually obvious in the sidebar itself
          so users grasp instantly that the menu has narrowed to a sub-role.
          Always rendered (even when collapsed) so the icon strip still
          carries the signal. */}
      {isRoleImpersonating && impersonatedRole && (
        <div
          className={cn(
            "flex items-center gap-2 mx-2 mt-2 px-3 py-1.5 rounded-md border border-primary/30 bg-primary/10 text-primary",
            collapsed && !isMobile && "justify-center px-0",
          )}
        >
          <UserCog className="h-3.5 w-3.5 shrink-0" />
          {(!collapsed || isMobile) && (
            <span className="text-xs font-medium capitalize truncate">
              Viewing as {impersonatedRole}
            </span>
          )}
        </div>
      )}

      {/* Navigation */}
      <nav
        ref={navScrollRef}
        aria-label="Main navigation"
        onKeyDown={handleNavKeyDown}
        onScroll={(e) => {
          persistNavScroll((e.target as HTMLElement).scrollTop);
        }}
        className="flex-1 py-3 px-2 overflow-y-auto"
      >
        {filteredGroups.map((group, groupIndex) => (
          <Collapsible
            key={group.label}
            open={collapsed && !isMobile ? true : expandedGroups[group.label]}
            onOpenChange={() => toggleGroup(group.label)}
              className={cn(groupIndex > 0 && "mt-3")}
          >
            {/* Group Label - only show when expanded */}
            {(!collapsed || isMobile) ? (
              <CollapsibleTrigger className="flex min-h-9 items-center justify-between w-full px-3 py-1.5 mb-0.5 group hover:bg-accent/50 rounded-md transition-colors">
                <span className="text-[11px] font-bold uppercase text-muted-foreground/75 group-hover:text-muted-foreground leading-[1.4]">
                  {group.label}
                </span>
                <ChevronDown 
                  className={cn(
                    "h-3 w-3 text-muted-foreground/50 transition-transform duration-200",
                    expandedGroups[group.label] && "rotate-180"
                  )} 
                />
              </CollapsibleTrigger>
            ) : (
              /* Separator for collapsed state */
              groupIndex > 0 && <div className="mx-3 my-2 border-t border-border" />
            )}
            <CollapsibleContent className="space-y-0.5">
              {group.items.map(renderNavItem)}
            </CollapsibleContent>
          </Collapsible>
        ))}
      </nav>

      {/* Command Palette Trigger */}
      <div className="p-2 border-t border-border">
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              className={cn(
                "w-full justify-start gap-3 px-3 py-2 h-auto text-muted-foreground hover:text-foreground",
                collapsed && !isMobile && "justify-center px-0"
              )}
              onClick={onOpenCommandPalette}
            >
              <Command className="h-4 w-4" />
              {(!collapsed || isMobile) && (
              <span className="flex-1 text-start text-[15px] leading-[1.5]">
                  Command
                  <kbd className="ms-2 pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground" dir="ltr">
                    ⌘K
                  </kbd>
                </span>
              )}
            </Button>
          </TooltipTrigger>
          {collapsed && !isMobile && (
            <TooltipContent side="right" className="font-normal">
              Command Palette (⌘K)
            </TooltipContent>
          )}
        </Tooltip>
      </div>

      {/* Feature Legend for internal testers */}
      {(!collapsed || isMobile) && (
        <div className="px-2 pb-1">
          <FeatureLegend />
        </div>
      )}

      {/* User & Sign Out */}
      <div className="p-2 border-t border-border">
        {(!collapsed || isMobile) && profile && (
          <div className="flex items-center gap-2 px-3 py-2 mb-2">
            <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center">
              <span className="text-xs font-medium text-muted-foreground">
                {profile.full_name?.charAt(0)?.toUpperCase() || "U"}
              </span>
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-[15px] font-medium text-foreground truncate leading-[1.35]">
                {profile.full_name || "User"}
              </span>
            </div>
          </div>
        )}
        {canImpersonateRoles && !isRoleImpersonating && (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                className={cn(
                  "w-full justify-start gap-3 px-3 py-2 h-auto text-muted-foreground hover:text-foreground",
                  collapsed && !isMobile && "justify-center px-0"
                )}
                onClick={() => setTestAsOpen(true)}
              >
                <UserCog className="h-4 w-4" />
                {(!collapsed || isMobile) && (
                  <span className="text-[15px] leading-[1.5]">{t("impersonation.testAs", "Test as\u2026")}</span>
                )}
              </Button>
            </TooltipTrigger>
            {collapsed && !isMobile && (
              <TooltipContent side="right" className="font-normal">
                {t("impersonation.testAs", "Test as\u2026")}
              </TooltipContent>
            )}
          </Tooltip>
        )}
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              className={cn(
                "w-full justify-start gap-3 px-3 py-2 h-auto text-muted-foreground hover:text-foreground",
                collapsed && !isMobile && "justify-center px-0"
              )}
              onClick={handleSignOut}
            >
              <LogOut className="h-4 w-4" />
              {(!collapsed || isMobile) && <span className="text-[15px] leading-[1.5]">{t("auth.signOut")}</span>}
            </Button>
          </TooltipTrigger>
          {collapsed && !isMobile && (
            <TooltipContent side="right" className="font-normal">
              {t("auth.signOut")}
            </TooltipContent>
          )}
        </Tooltip>
      </div>
      <TestAsRoleDialog open={testAsOpen} onOpenChange={setTestAsOpen} />
    </>
  );


  // Mobile: Sheet drawer
  if (isMobile) {
    return (
      <>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="fixed top-3 start-3 z-50 h-10 w-10 bg-background border border-border shadow-sm"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side={isRTL ? "right" : "left"} className="w-72 p-0">
            <div className="flex flex-col h-full bg-sidebar">
              {sidebarContent}
            </div>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  // Desktop: Fixed sidebar
  return (
    <aside
      className={cn(
        "hidden md:flex flex-col h-dvh border-e border-sidebar-border/80 bg-sidebar shadow-soft transition-all duration-200 ease-out",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {sidebarContent}
    </aside>
  );
}

// Memoized so parent re-renders (route changes, banners, timers) never
// re-create or remount the sidebar; scroll and open-group state persist.
export const AppSidebar = memo(AppSidebarBase);
