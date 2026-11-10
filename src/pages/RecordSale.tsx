import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { AppLayout } from "@/components/layout/AppLayout";
import { recordOfflineSale } from "@/lib/offline/posService";
import { recordSale, type PriceChangedDetails, type RecordSaleResult, type SaleLineSize } from "@/lib/api/pos";
import { ApiError } from "@/lib/api/http";
import { toCdnUrl } from "@/lib/imageCdn";
import { isOnline as isPosOnline } from "@/lib/offline/connectivity";
import { ensureOfflineBootstrapped } from "@/lib/offline/lazyBootstrap";
import { logUnpaidPosting } from "@/lib/audit/unpaidPostingAudit";
import { UnpaidOfflineQueueBanner } from "@/components/pos/UnpaidOfflineQueueBanner";
import { DemoExpiredLock } from "@/components/demo/DemoExpiredLock";
import { useFunnelTracker } from "@/hooks/useFunnelTracker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ShoppingCart,
  QrCode,
  Plus,
  Minus,
  Trash2,
  Search,
  Receipt,
  Wallet,
  CreditCard,
  Banknote,
  UtensilsCrossed,
  Circle,
  CircleDot,
  PieChart,
  Package,
  CheckCircle2,
  Clock,
  User,
  UserPlus,
  Calendar,
  X,
  Mic,
  MicOff,
  Info,
  Printer,
  CloudOff,
  Cloud,
  Grid2X2,
  Grid3X3,
  LayoutGrid,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  ShoppingBag,
  Bike,
  PauseCircle,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useImpersonationGuard } from "@/hooks/useImpersonationGuard";
import { db } from "@/integrations/db/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import { useCurrency } from "@/hooks/useCurrency";
import { useBranchPrices, applyBranchPrices } from "@/hooks/useBranchPrices";
import { QRScanner } from "@/components/pos/QRScanner";
import { useIsMobile, useIsTablet } from "@/hooks/use-mobile";
import { ReceiptUploader } from "@/components/expenses/ReceiptUploader";
import { usePOSHardware } from "@/hooks/usePOSHardware";
import { ShowcaseLayout, CompactListLayout, KioskGridLayout, PosComCardLayout, CategoryIconTile, categoryIcon, type PosLayoutTemplate } from "@/components/pos/POSAlternateLayouts";
import { handlePOSPrint, ReceiptData, KitchenOrderData } from "@/lib/printUtils";
import { useReceiptTemplates, pickTemplateForInvoice } from "@/hooks/useReceiptTemplates";
import { useCFDPublisher } from "@/hooks/useCFD";
import { CashDrawerControl } from "@/components/pos/CashDrawerControl";
import { PosDayEndAdjustmentButton } from "@/components/pos/PosDayEndAdjustmentButton";
import { useZatcaSettings } from "@/hooks/useZatcaSettings";
import {
  buildZatcaSnapshot,
  generateZatcaPdf,
  pdfBase64ToBlobUrl,
} from "@/lib/zatca/receipt";
import {
  uploadZatcaPdf,
  writeZatcaSnapshot,
  logInvoiceGeneration,
  pdfBase64ToBytes,
} from "@/lib/zatca/persistence";
import {
  advanceZatcaChain,
  writeZatcaChainToSale,
} from "@/lib/zatca/chain";
import {
  buildSimplifiedTaxInvoiceUbl,
  uploadZatcaXml,
  writeXmlUrlToSale,
} from "@/lib/zatca/ubl";
import { validateZatcaFields } from "@/lib/zatca/validation";
import { netFromGross, vatFromGross, roundMoney, lineGross as lineGrossOf, splitListed, netFromListed, sumMoney } from "@/lib/vatInclusive";
import { useBranchVatRate } from "@/hooks/useBranchVatRate";

interface MenuItem {
  id: string;
  name: string;
  category: string | null;
  selling_price: number;
  quarter_price: number;
  half_price: number;
  full_price: number;
  is_active: boolean;
  image_url?: string | null;
}

interface CartItem {
  menuItemId: string;
  name: string;
  size: "quarter" | "half" | "full" | "regular" | "combo";
  price: number;
  quantity: number;
  isCombo?: boolean;
  imageUrl?: string | null;
}

interface ExpenseCategory {
  id: string;
  name: string;
  color: string | null;
}

interface ComboPackage {
  id: string;
  name: string;
  description: string | null;
  price: number;
  is_active: boolean;
}

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  credit_limit: number;
  current_balance: number;
  credit_status: string;
}

type PaymentMethod = "cash" | "card" | "other";
const ONLINE_WRITE_TIMEOUT_MS = 8000;

export default function RecordSale() {
  const { user, restaurant, hasFeature } = useAuth();
  const guardWrite = useImpersonationGuard();
  const { t } = useTranslation();
  const { activeBranchId, activeBranch } = useBranch();
  const shiftsEnabled = hasFeature("shifts");
  const { format: formatCurrency } = useCurrency();
  const queryClient = useQueryClient();
  const { track: trackFunnel } = useFunnelTracker();

  // Optional table linkage: when launched from Floor Plan via ?table=<id>
  const tableIdFromUrl = useMemo(() => {
    if (typeof window === "undefined") return null;
    const p = new URLSearchParams(window.location.search);
    return p.get("table");
  }, []);
  const [linkedTable, setLinkedTable] = useState<{ id: string; label: string } | null>(null);
  useEffect(() => {
    if (!tableIdFromUrl || !restaurant?.id) return;
    let cancelled = false;
    (async () => {
      const { data } = await db
        .from("pos_tables")
        .select("id,label")
        .eq("id", tableIdFromUrl)
        .eq("restaurant_id", restaurant.id)
        .maybeSingle();
      if (!cancelled && data) setLinkedTable({ id: data.id, label: (data as any).label });
    })();
    return () => { cancelled = true; };
  }, [tableIdFromUrl, restaurant?.id]);

  const expenseDraftKey = useMemo(() => {
    if (!restaurant?.id || !user?.id) return null;
    return `record-sale:expense-draft:${restaurant.id}:${user.id}`;
  }, [restaurant?.id, user?.id]);

  const salesDraftKey = useMemo(() => {
    if (!restaurant?.id || !user?.id) return null;
    return `record-sale:sales-draft:${restaurant.id}:${user.id}`;
  }, [restaurant?.id, user?.id]);

  const [leftPanelTab, setLeftPanelTab] = useState<"menu" | "expenses">("menu");
  // POS sale mode (UI-only tab grouping for IBM Windows POS layout)
  type SaleMode = "dine_in" | "takeaway" | "delivery" | "held";
  const [saleMode, setSaleMode] = useState<SaleMode>(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("pos-sale-mode") : null;
    return (saved as SaleMode) || "dine_in";
  });
  const updateSaleMode = (m: SaleMode) => {
    setSaleMode(m);
    try { localStorage.setItem("pos-sale-mode", m); } catch { /* noop */ }
  };
  // Collapsible POS top bar (mode/view tabs + utilities)
  const [posBarCollapsed, setPosBarCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem("pos-bar-collapsed") === "1"; } catch { return false; }
  });
  const togglePosBar = () => {
    setPosBarCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem("pos-bar-collapsed", next ? "1" : "0"); } catch { /* noop */ }
      return next;
    });
  };
  // Collapsible search + alphabet block
  const [searchBarCollapsed, setSearchBarCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem("pos-search-collapsed") !== "0"; } catch { return true; }
  });
  const toggleSearchBar = () => {
    setSearchBarCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem("pos-search-collapsed", next ? "1" : "0"); } catch { /* noop */ }
      return next;
    });
  };
  const expensesTabRef = useRef<HTMLDivElement | null>(null);

  // Bootstrap the offline engine so the connectivity watcher + service
  // worker are ready; otherwise isPosOnline() returns the stale boot
  // value and the Pay button hangs when Wi-Fi has no real internet.
  useEffect(() => {
    void ensureOfflineBootstrapped(activeBranchId ?? null);
  }, [activeBranchId]);

  // Sales state
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [searchTerm, setSearchTerm] = useState("");
  const [isQRScannerOpen, setIsQRScannerOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>("top-selling");
  const hasInitializedCategoryRef = useRef(false);
  // When true, sort items within the currently selected category by top sales (last 30 days)
  const [sortByTopSales, setSortByTopSales] = useState<boolean>(true);
  const [cartNotification, setCartNotification] = useState<string | null>(null);
  const cartNotificationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Grid columns configuration (persisted to localStorage)
  const [gridColumns, setGridColumns] = useState<2 | 3 | 4 | 5 | 6>(() => {
    const saved = localStorage.getItem('pos-grid-columns');
    return (saved ? parseInt(saved) : 5) as 2 | 3 | 4 | 5 | 6;
  });
  
  const cycleGridColumns = () => {
    const options: (2 | 3 | 4 | 5 | 6)[] = [2, 3, 4, 5, 6];
    const currentIndex = options.indexOf(gridColumns);
    const nextIndex = (currentIndex + 1) % options.length;
    const newValue = options[nextIndex];
    setGridColumns(newValue);
    localStorage.setItem('pos-grid-columns', newValue.toString());
  };
  
  const getGridColsClass = () => {
    const baseClass = "grid gap-2";
    switch (gridColumns) {
      case 2: return `${baseClass} grid-cols-2`;
      case 3: return `${baseClass} grid-cols-2 sm:grid-cols-3`;
      case 4: return `${baseClass} grid-cols-2 sm:grid-cols-3 md:grid-cols-4`;
      case 5: return `${baseClass} grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5`;
      case 6: return `${baseClass} grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6`;
      default: return `${baseClass} grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5`;
    }
  };

  // Show cart notification briefly
  const showCartNotification = (message: string) => {
    if (cartNotificationTimeoutRef.current) {
      clearTimeout(cartNotificationTimeoutRef.current);
    }
    setCartNotification(message);
    cartNotificationTimeoutRef.current = setTimeout(() => {
      setCartNotification(null);
    }, 2000);
  };
  
  // Customer/Settlement state
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [isUnpaidSale, setIsUnpaidSale] = useState(false);
  // Inline error surfaced under the "Add to Customer's Tab" CTA whenever
  // an unpaid sale is rejected - either client-side validation or a
  // backend error. Cleared on success and on every new submit attempt.
  const [unpaidPostError, setUnpaidPostError] = useState<string | null>(null);
  const [lastQueuedUnpaidReceipt, setLastQueuedUnpaidReceipt] = useState<string | null>(null);
  const [customerSearchTerm, setCustomerSearchTerm] = useState("");
  const [showCustomerSelect, setShowCustomerSelect] = useState(false);
  
  // Backdated transaction state
  const [isBackdated, setIsBackdated] = useState(false);
  const [backdatedDate, setBackdatedDate] = useState<Date>(new Date());
  const [backdatedTime, setBackdatedTime] = useState(format(new Date(), "HH:mm"));

  // ZATCA buyer (B2B Standard vs B2C Simplified)
  const [invoiceSubtype, setInvoiceSubtype] = useState<"SIMPLIFIED" | "STANDARD">("SIMPLIFIED");
  const [buyerName, setBuyerName] = useState("");
  const [buyerVat, setBuyerVat] = useState("");
  const [buyerAddress, setBuyerAddress] = useState("");
  // Non-VAT buyer ID (CRN/NAT/PAS/IQA/…) - used when buyer has no VAT.
  const [buyerIdScheme, setBuyerIdScheme] = useState<"CRN" | "NAT" | "PAS" | "IQA" | "MOM" | "MLS" | "SAG" | "GCC" | "OTH">("CRN");
  const [buyerIdValue, setBuyerIdValue] = useState("");
  // Advanced ZATCA UBL options (document-level discount/charge, FX).
  const [showAdvancedZatca, setShowAdvancedZatca] = useState(false);
  const [docDiscount, setDocDiscount] = useState("");
  const [docSurcharge, setDocSurcharge] = useState("");
  const [docCurrency, setDocCurrency] = useState("SAR");
  const [docFxRate, setDocFxRate] = useState("");

  // UBL XML preview dialog state
  const [livePreviewOpen, setLivePreviewOpen] = useState(false);
  // Collapsible payment/invoice configuration section
  const [paymentSectionOpen, setPaymentSectionOpen] = useState(false);
  // Unpaid - Pending Settlement dialog
  const [unpaidDialogOpen, setUnpaidDialogOpen] = useState(false);

  // Live validation touch-state for ZATCA fields
  const [zatcaTouched, setZatcaTouched] = useState({
    buyerName: false,
    buyerVat: false,
    buyerIdValue: false,
    docDiscount: false,
    docSurcharge: false,
    docFxRate: false,
  });

  // Expense state
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseDescription, setExpenseDescription] = useState("");
  const [expenseCategoryId, setExpenseCategoryId] = useState<string>("");
  const [expenseDate, setExpenseDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [expenseReceiptUrl, setExpenseReceiptUrl] = useState<string | null>(null);
  const [expenseStatus, setExpenseStatus] = useState<'paid' | 'unpaid'>('paid');
  const [isReceiptUploading, setIsReceiptUploading] = useState(false);

  // Cart is auto-saved to sessionStorage, so no need for beforeunload warning

  // Restore sales draft from sessionStorage on mount
  useEffect(() => {
    if (!salesDraftKey) return;
    
    // Only restore if cart is empty
    if (cart.length > 0) return;

    try {
      const raw = sessionStorage.getItem(salesDraftKey);
      if (!raw) return;
      const draft = JSON.parse(raw) as {
        cart?: CartItem[];
        paymentMethod?: PaymentMethod;
        selectedCustomer?: Customer | null;
        isUnpaidSale?: boolean;
        isBackdated?: boolean;
        backdatedDate?: string;
        backdatedTime?: string;
      };

      if (draft.cart && draft.cart.length > 0) setCart(draft.cart);
      if (draft.paymentMethod) setPaymentMethod(draft.paymentMethod);
      if (draft.selectedCustomer) setSelectedCustomer(draft.selectedCustomer);
      if (draft.isUnpaidSale) setIsUnpaidSale(draft.isUnpaidSale);
      if (draft.isBackdated) setIsBackdated(draft.isBackdated);
      if (draft.backdatedDate) {
        const parsedDate = new Date(draft.backdatedDate);
        if (!isNaN(parsedDate.getTime())) setBackdatedDate(parsedDate);
      }
      if (draft.backdatedTime) setBackdatedTime(draft.backdatedTime);
    } catch {
      // ignore corrupted drafts
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salesDraftKey]);

  // Persist sales draft to sessionStorage
  useEffect(() => {
    if (!salesDraftKey) return;
    
    const isEmpty = cart.length === 0;

    if (isEmpty) {
      sessionStorage.removeItem(salesDraftKey);
      return;
    }

    const draft = {
      cart,
      paymentMethod,
      selectedCustomer,
      isUnpaidSale,
      isBackdated,
      backdatedDate: backdatedDate.toISOString(),
      backdatedTime,
    };
    sessionStorage.setItem(salesDraftKey, JSON.stringify(draft));
  }, [
    salesDraftKey,
    cart,
    paymentMethod,
    selectedCustomer,
    isUnpaidSale,
    isBackdated,
    backdatedDate,
    backdatedTime,
  ]);

  // Persist expense draft so mobile camera flows that refresh/reload don't lose the entry
  useEffect(() => {
    if (!expenseDraftKey) return;

    // Only restore if the user hasn't started editing already
    const hasAnyDraftInput =
      !!expenseAmount ||
      !!expenseDescription ||
      !!expenseCategoryId ||
      !!expenseReceiptUrl ||
      expenseStatus !== "paid";
    if (hasAnyDraftInput) return;

    try {
      const raw = sessionStorage.getItem(expenseDraftKey);
      if (!raw) return;
      const draft = JSON.parse(raw) as {
        amount?: string;
        description?: string;
        categoryId?: string;
        date?: string;
        receiptUrl?: string | null;
        status?: 'paid' | 'unpaid';
      };

      if (draft.amount) setExpenseAmount(draft.amount);
      if (draft.description) setExpenseDescription(draft.description);
      if (draft.categoryId) setExpenseCategoryId(draft.categoryId);
      if (draft.date) setExpenseDate(draft.date);
      if (typeof draft.receiptUrl !== "undefined") setExpenseReceiptUrl(draft.receiptUrl);
      if (draft.status) setExpenseStatus(draft.status);
    } catch {
      // ignore corrupted drafts
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenseDraftKey]);

  useEffect(() => {
    if (!expenseDraftKey) return;
    const isEmpty =
      !expenseAmount &&
      !expenseDescription &&
      !expenseCategoryId &&
      !expenseReceiptUrl &&
      expenseStatus === "paid";

    if (isEmpty) {
      sessionStorage.removeItem(expenseDraftKey);
      return;
    }

    const draft = {
      amount: expenseAmount,
      description: expenseDescription,
      categoryId: expenseCategoryId,
      date: expenseDate,
      receiptUrl: expenseReceiptUrl,
      status: expenseStatus,
    };
    sessionStorage.setItem(expenseDraftKey, JSON.stringify(draft));
  }, [
    expenseDraftKey,
    expenseAmount,
    expenseDescription,
    expenseCategoryId,
    expenseDate,
    expenseReceiptUrl,
    expenseStatus,
  ]);

  // Ensure switching to the Expenses tab always lands at the top (prevents preserved scroll).
  useEffect(() => {
    if (leftPanelTab !== "expenses") return;
    // Wait for content to mount and then reset scroll.
    requestAnimationFrame(() => {
      expensesTabRef.current?.scrollTo({ top: 0, behavior: "auto" });
      expensesTabRef.current?.scrollIntoView({ block: "start" });
    });
  }, [leftPanelTab]);

  // POS Hardware settings
  const { settings: posHardware } = usePOSHardware();
  const { templates: receiptTemplates } = useReceiptTemplates();
  const { settings: zatcaSettings } = useZatcaSettings();

  // Fetch menu items (raw) then overlay per-branch price overrides.
  const { priceMap: branchPriceMap } = useBranchPrices(activeBranchId);
  // VAT rate is configured per branch (Settings → Branches).
  const { vatRate, vatPercent, pricesInclusive } = useBranchVatRate(activeBranchId);
  const { data: rawMenuItems = [] } = useQuery({
    queryKey: ["menu-items", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await db
        .from("menu_items")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .eq("is_active", true)
        .order("category")
        .order("name");
      if (error) throw error;
      return data as MenuItem[];
    },
    enabled: !!restaurant?.id,
  });
  const menuItems = useMemo(
    () => applyBranchPrices(rawMenuItems as any, branchPriceMap) as MenuItem[],
    [rawMenuItems, branchPriceMap]
  );

  // Fetch active shifts
  const { data: activeShifts = [] } = useQuery({
    queryKey: ["active-shifts", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await db
        .from("shifts")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .eq("status", "open");
      if (error) throw error;
      return data;
    },
    enabled: !!restaurant?.id,
  });

  // Fetch expense categories
  const { data: expenseCategories = [] } = useQuery({
    queryKey: ["expense-categories", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await db
        .from("expense_categories")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .order("name");
      if (error) throw error;
      return data as ExpenseCategory[];
    },
    enabled: !!restaurant?.id,
  });

  // Fetch combo packages
  const { data: comboPackages = [] } = useQuery({
    queryKey: ["combo-packages", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await db
        .from("combo_packages")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as ComboPackage[];
    },
    enabled: !!restaurant?.id,
  });

  // Fetch customers with active credit lines
  const { data: customers = [] } = useQuery({
    queryKey: ["customers", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await db
        .from("customers")
        .select("id, name, phone, credit_limit, current_balance, credit_status")
        .eq("restaurant_id", restaurant.id)
        .eq("credit_status", "active")
        .order("name");
      if (error) throw error;
      return data as Customer[];
    },
    enabled: !!restaurant?.id,
  });

  // Fetch top selling items (last 30 days)
  const { data: topSellingData = [] } = useQuery<{ menuItemId: string; totalSold: number }[]>({
    queryKey: ["top-selling-items", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const { data, error } = await db
        .from("sales_items")
        .select("menu_item_id, quantity")
        .eq("restaurant_id", restaurant.id)
        .gte("created_at", thirtyDaysAgo.toISOString());
      
      if (error) throw error;
      
      // Aggregate quantities by menu_item_id
      const aggregated = (data || []).reduce((acc, item) => {
        acc[item.menu_item_id] = (acc[item.menu_item_id] || 0) + item.quantity;
        return acc;
      }, {} as Record<string, number>) as Record<string, number>;
      
      // Sort by quantity and get top 10
      const ranked = Object.entries(aggregated)
        .sort(([, a], [, b]) => b - a)
        .map(([id, qty]) => ({ menuItemId: id, totalSold: qty }));
      return ranked;
    },
    enabled: !!restaurant?.id,
  });

  // Filtered customers for search
  const filteredCustomers = useMemo(() => {
    if (!customerSearchTerm) return customers;
    const term = customerSearchTerm.toLowerCase();
    return customers.filter(
      (c) => c.name.toLowerCase().includes(term) || c.phone?.includes(term)
    );
  }, [customers, customerSearchTerm]);

  // Get top selling menu items
  const topSellingItems = useMemo(() => {
    if (!topSellingData.length || !menuItems.length) return [];
    const top = topSellingData.slice(0, 10);
    const topIds = new Set(top.map(t => t.menuItemId));
    return menuItems.filter(item => topIds.has(item.id));
  }, [topSellingData, menuItems]);

  // Full sales rank map: menu_item_id -> total qty sold (last 30 days)
  const salesRankMap = useMemo(() => {
    const m = new Map<string, number>();
    topSellingData.forEach((t) => m.set(t.menuItemId, t.totalSold));
    return m;
  }, [topSellingData]);

  const categories = useMemo(() => {
    const cats = new Set(menuItems.map((item) => item.category || "Uncategorized"));
    if (comboPackages.length > 0) {
      cats.add("Combos");
    }
    return Array.from(cats).sort();
  }, [menuItems, comboPackages]);

  // Default to "Main" category once menu items load
  useEffect(() => {
    if (hasInitializedCategoryRef.current) return;
    if (categories.length === 0) return;
    const mainCat = categories.find((c) => c.toLowerCase() === "main");
    if (mainCat) {
      setSelectedCategory(mainCat);
    }
    hasInitializedCategoryRef.current = true;
  }, [categories]);

  // Filter and group menu items
  const filteredItems = useMemo(() => {
    // For Top Selling category, return top selling items
    if (selectedCategory === "top-selling") {
      return topSellingItems.filter(item => 
        item.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    const items = menuItems.filter((item) => {
      const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = selectedCategory === "all" || item.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });

    if (sortByTopSales) {
      return [...items].sort((a, b) => {
        const qa = salesRankMap.get(a.id) ?? 0;
        const qb = salesRankMap.get(b.id) ?? 0;
        if (qb !== qa) return qb - qa;
        return a.name.localeCompare(b.name);
      });
    }
    return items;
  }, [menuItems, searchTerm, selectedCategory, topSellingItems, sortByTopSales, salesRankMap]);

  // Filter combo packages
  const filteredCombos = useMemo(() => {
    return comboPackages.filter((combo) => {
      const matchesSearch = combo.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = selectedCategory === "all" || selectedCategory === "Combos";
      return matchesSearch && matchesCategory;
    });
  }, [comboPackages, searchTerm, selectedCategory]);

  const groupedItems = useMemo(() => {
    // For Top Selling, show as single group
    if (selectedCategory === "top-selling") {
      return filteredItems.length > 0 ? { "Top Selling": filteredItems } : {};
    }
    
    return filteredItems.reduce((acc, item) => {
      const category = item.category || "Uncategorized";
      if (!acc[category]) acc[category] = [];
      acc[category].push(item);
      return acc;
    }, {} as Record<string, MenuItem[]>);
  }, [filteredItems, selectedCategory]);

  // Ref for cart scroll area
  const cartScrollRef = useRef<HTMLDivElement>(null);

  // Scroll cart to bottom (show last item)
  const scrollCartToBottom = () => {
    requestAnimationFrame(() => {
      if (cartScrollRef.current) {
        cartScrollRef.current.scrollTop = cartScrollRef.current.scrollHeight;
      }
    });
  };

  // Cart calculations
  const cartTotal = useMemo(() => {
    // Round per line first, then the sum — keeps displayed lines reconciling
    // with the payable total to the cent.
    return sumMoney(cart.map((item) => lineGrossOf(item.price, item.quantity)));
  }, [cart]);

  // Broadcast cart state to the Customer-Facing Display (same-device
  // BroadcastChannel + paired tablet if one is active). No-op when no
  // CFD is open / paired, so this is essentially free.
  const { publish: publishCFD } = useCFDPublisher();
  useEffect(() => {
    void publishCFD({
      state: cart.length === 0 ? "idle" : "cart",
      cart: cart.map((c) => ({
        name: c.name,
        size: c.size,
        quantity: c.quantity,
        unitPrice: c.price,
        total: c.price * c.quantity,
      })),
      subtotal: cartTotal,
      tax: 0,
      total: cartTotal,
    });
  }, [cart, cartTotal, publishCFD]);

  const selectedCustomerCurrentBalance = Number(selectedCustomer?.current_balance ?? 0);
  const selectedCustomerCreditLimit = Number(selectedCustomer?.credit_limit ?? 0);

  // Live ZATCA field validation - surfaces inline errors before submit.
  const zatcaValidation = useMemo(
    () =>
      validateZatcaFields({
        invoiceSubtype,
        buyerName,
        buyerVat,
        buyerIdScheme,
        buyerIdValue,
        docDiscount,
        docSurcharge,
        docCurrency,
        docFxRate,
        cartTotal,
      }),
    [
      invoiceSubtype,
      buyerName,
      buyerVat,
      buyerIdScheme,
      buyerIdValue,
      docDiscount,
      docSurcharge,
      docCurrency,
      docFxRate,
      cartTotal,
    ],
  );

  const hasZatcaErrors = Object.keys(zatcaValidation).length > 0;

  // One idempotency key per checkout, shared by the online attempt and the offline queue: if
  // the online request committed but its response was lost, the offline replay returns that
  // sale instead of recording a second one.
  const queueSaleOffline = async (idempotencyKey?: string) => {
    if (!restaurant?.id || !user?.id || cart.length === 0) {
      throw new Error("Invalid sale data");
    }
    if (!activeBranchId) {
      throw new Error("Select a branch before recording the sale.");
    }

    const blockedReason =
      invoiceSubtype === "STANDARD"
        ? "Standard (B2B) invoices require connectivity for ZATCA clearance."
        : docCurrency && docCurrency !== "SAR"
          ? "Foreign-currency sales require connectivity for FX validation."
          : isUnpaidSale && !selectedCustomer
            ? "Unpaid (credit) sales require a customer - pick one first to queue offline."
            : null;

    if (blockedReason) {
      throw new Error(`Offline · ${blockedReason}`);
    }

    const activeShift = shiftsEnabled ? activeShifts[0] : undefined;
    const result = await recordOfflineSale({
      // The offline queue is scoped by restaurant (the sync engine drains by restaurant id);
      // the real branch travels in the payload.
      branchId: restaurant.id,
      saleBranchId: activeBranchId,
      idempotencyKey,
      cashierId: user.id,
      shiftId: activeShift?.id ?? null,
      paymentMethod,
      customerId: isUnpaidSale ? selectedCustomer?.id ?? null : null,
      isUnpaid: isUnpaidSale,
      vatRate,
      pricesVatInclusive: pricesInclusive,
      items: cart.map((c) => ({
        menu_item_id: c.menuItemId,
        name: c.name,
        size: c.size === "combo" ? undefined : c.size,
        quantity: c.quantity,
        unit_price: c.price,
      })),
    });

    return { offlineReceiptNumber: result.receiptNumber } as never;
  };

  const isRecoverableNetworkError = (error: unknown) => {
    const candidates = new Set<string>();
    const visit = (value: unknown) => {
      if (value == null) return;
      if (typeof value === "string") {
        candidates.add(value.toLowerCase());
        return;
      }
      if (value instanceof Error) {
        candidates.add(value.message.toLowerCase());
        return;
      }
      if (typeof value === "object") {
        const record = value as Record<string, unknown>;
        [record.message, record.details, record.hint, record.error, record.error_description].forEach(visit);
        try {
          candidates.add(JSON.stringify(value).toLowerCase());
        } catch {
          candidates.add(String(value).toLowerCase());
        }
        return;
      }
      candidates.add(String(value).toLowerCase());
    };

    visit(error);
    const message = Array.from(candidates).join(" ");
    return ["failed to fetch", "networkerror", "network request failed", "load failed", "fetch failed", "aborterror", "network", "timed out", "timeout", "failed to send a request"]
      .some((fragment) => message.includes(fragment));
  };

  const withOnlineWriteTimeout = async <T,>(promise: PromiseLike<T>, action: string): Promise<T> => {
    return await new Promise<T>((resolve, reject) => {
      const timeoutId = globalThis.setTimeout(() => {
        reject(new Error(`${action} timed out`));
      }, ONLINE_WRITE_TIMEOUT_MS);

      Promise.resolve(promise).then(
        (value) => {
          globalThis.clearTimeout(timeoutId);
          resolve(value);
        },
        (error) => {
          globalThis.clearTimeout(timeoutId);
          reject(error);
        },
      );
    });
  };

  // ----- Smart input normalizers (applied on blur to preserve typing) -----
  // These coerce user input into a canonical, validator-friendly form
  // without rewriting it mid-typing - so cursor jumps and partial values
  // (e.g. "12." while typing "12.50") aren't disturbed.
  const normalizeText = (v: string, max = 200) =>
    v.replace(/\s+/g, " ").trim().slice(0, max);

  const normalizeMoney = (v: string, opts?: { max?: number; decimals?: number }) => {
    const decimals = opts?.decimals ?? 2;
    let s = v.trim().replace(/[\s,_]/g, "").replace(/^\++/, "");
    // Convert Arabic-Indic digits → Latin
    s = s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
    // Strip everything except digits and a single decimal separator
    s = s.replace(/[^\d.]/g, "");
    const firstDot = s.indexOf(".");
    if (firstDot !== -1) {
      s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, "");
    }
    if (s === "" || s === ".") return "";
    let n = Number(s);
    if (!Number.isFinite(n) || n < 0) n = 0;
    if (opts?.max !== undefined && n > opts.max) n = opts.max;
    // Truncate (don't round up) to the allowed decimals - never silently
    // inflate the buyer's intended amount.
    const factor = Math.pow(10, decimals);
    n = Math.floor(n * factor) / factor;
    // Render without trailing zeros, preserving an integer if that's what
    // came out (e.g. "12" not "12.00").
    return n.toString();
  };

  const normalizeBuyerId = (v: string, scheme: typeof buyerIdScheme) => {
    const cleaned = v.trim().replace(/\s+/g, "");
    switch (scheme) {
      case "CRN":
      case "NAT":
      case "IQA":
      case "GCC":
        return cleaned.replace(/\D/g, "").slice(0, 15);
      case "PAS":
        return cleaned.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
      case "MOM":
      case "MLS":
      case "SAG":
        return cleaned.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 20);
      case "OTH":
      default:
        return cleaned.replace(/[^A-Za-z0-9-]/g, "").slice(0, 50);
    }
  };

  // Live "Payable in SAR" preview - recalculates as discount / surcharge / FX change.
  const zatcaTotals = useMemo(() => {
    const discount = parseFloat(docDiscount) || 0;
    const surcharge = parseFloat(docSurcharge) || 0;
    const fx = docCurrency !== "SAR" ? (parseFloat(docFxRate) || 0) : 1;
    const isForeign = docCurrency !== "SAR" && fx > 0;

    // Convert cart total to SAR if foreign currency is selected
    const subtotalSar = roundMoney(isForeign ? cartTotal * fx : cartTotal);
    const discountSar = roundMoney(isForeign ? discount * fx : discount);
    const surchargeSar = roundMoney(isForeign ? surcharge * fx : surcharge);
    // Listed prices follow the branch pricing mode: inclusive → VAT is backed
    // out of the listed total; exclusive → VAT is added on top of it.
    const listedPayable = Math.max(0, roundMoney(subtotalSar - discountSar + surchargeSar));
    const { net: netTaxable, vat, gross: grossPayable } = splitListed(listedPayable, vatRate, pricesInclusive);
    const payable = grossPayable;

    return {
      subtotalSar,
      discountSar,
      surchargeSar,
      netTaxable,
      vat,
      payable,
      isForeign,
      fx,
    };
  }, [cartTotal, docDiscount, docSurcharge, docCurrency, docFxRate, vatRate, pricesInclusive]);

  // Build a UBL XML preview from current cart + ZATCA inputs. Uses
  // placeholder UUID/ICV/PIH so the operator can review structure
  // (allowance charges, buyer identification, totals) before submission.
  const buildPreviewUbl = (): string => {
    const previewSnapshot = buildZatcaSnapshot(
      zatcaSettings,
      { subtotal: cartTotal, tax: 0, total: cartTotal },
      "digital",
    );
    const lines = cart.map((i) => {
      const mi = menuItems.find((m) => m.id === i.menuItemId) as
        | (typeof menuItems)[number]
        | undefined;
      const rawCat = (mi as { vat_category?: string } | undefined)?.vat_category;
      const vatCategory = (
        rawCat === "S" || rawCat === "Z" || rawCat === "E" || rawCat === "O"
          ? rawCat
          : "S"
      ) as "S" | "Z" | "E" | "O";
      const reason =
        (mi as { vat_exemption_reason_code?: string | null } | undefined)
          ?.vat_exemption_reason_code ?? null;
      const listed = lineGrossOf(i.price, i.quantity);
      const gross = vatCategory === "S" && !pricesInclusive ? roundMoney(listed * (1 + vatRate)) : listed;
      const lineExt = vatCategory === "S" ? netFromListed(listed, vatRate, pricesInclusive) : listed;
      const taxAmount = roundMoney(gross - lineExt);
      return {
        name: i.name,
        quantity: i.quantity,
        unitPrice: vatCategory === "S" ? netFromListed(i.price, vatRate, pricesInclusive) : roundMoney(i.price),
        lineExtension: lineExt,
        taxAmount,
        vatCategory,
        vatExemptionReasonCode: reason,
      };
    });
    const lineTaxTotal = sumMoney(lines.map((l) => l.taxAmount));
    const lineTaxableTotal = sumMoney(lines.map((l) => l.lineExtension));
    const discount = parseFloat(docDiscount) || 0;
    const surcharge = parseFloat(docSurcharge) || 0;
    return buildSimplifiedTaxInvoiceUbl({
      uuid: "00000000-0000-0000-0000-000000000000",
      receiptNumber: `PREVIEW-${format(new Date(), "yyyyMMdd-HHmmss")}`,
      issueDateTime: new Date().toISOString(),
      icv: 0,
      pih: "0",
      qrBase64: previewSnapshot?.qrBase64 ?? null,
      seller: {
        nameEn: previewSnapshot?.sellerName ?? restaurant?.name ?? "Seller",
        nameAr: previewSnapshot?.sellerNameAr ?? null,
        vatNumber: previewSnapshot?.vatNumber ?? "000000000000000",
      },
      invoiceSubtype,
      buyer: invoiceSubtype === "STANDARD" ? {
        name: buyerName.trim(),
        vatNumber: /^\d{15}$/.test(buyerVat.trim()) ? buyerVat.trim() : null,
        address: buyerAddress.trim() || null,
        countryCode: "SA",
        identification: buyerIdValue.trim()
          ? { scheme: buyerIdScheme, value: buyerIdValue.trim() }
          : null,
      } : null,
      currency: docCurrency || "SAR",
      taxCurrency: "SAR",
      taxExchangeRate: docCurrency && docCurrency !== "SAR"
        ? parseFloat(docFxRate) || undefined
        : undefined,
      lines,
      taxExclusiveAmount: lineTaxableTotal,
      taxAmount: roundMoney(lineTaxTotal + vatFromGross(surcharge - discount, vatRate)),
      taxInclusiveAmount: roundMoney(lineTaxableTotal + lineTaxTotal + (surcharge - discount)),
      allowanceCharges: [
        ...(discount > 0
          ? [{ isCharge: false, amount: discount, reason: "Document-level discount", reasonCode: "95", vatCategory: "S" as const }]
          : []),
        ...(surcharge > 0
          ? [{ isCharge: true, amount: surcharge, reason: "Document-level charge", reasonCode: "ZZZ", vatCategory: "S" as const }]
          : []),
      ],
      paymentMeansCode: paymentMethod === "cash" ? "10" : "30",
    });
  };

  // ----- Live UBL XML preview (reactive) -----
  // Recomputed on every relevant field change so the inline panel stays
  // in sync as the operator edits buyer details, discounts, surcharges,
  // currency, FX rate, and the cart itself.
  const liveUblPreview = useMemo<{ xml: string; error: string | null }>(() => {
    if (!livePreviewOpen) return { xml: "", error: null };
    if (cart.length === 0) {
      return { xml: "", error: "Add at least one item to see the XML preview." };
    }
    try {
      return { xml: buildPreviewUbl(), error: null };
    } catch (e) {
      return {
        xml: "",
        error: e instanceof Error ? e.message : "Failed to build XML preview",
      };
    }
    // buildPreviewUbl is a closure over all relevant state - listing the
    // primitives here keeps the memo correct without re-creating XML on
    // unrelated re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    livePreviewOpen,
    cart,
    invoiceSubtype,
    buyerName,
    buyerVat,
    buyerIdScheme,
    buyerIdValue,
    buyerAddress,
    docCurrency,
    docFxRate,
    docDiscount,
    docSurcharge,
    paymentMethod,
    zatcaSettings,
    restaurant?.name,
  ]);

  const addToCart = (item: MenuItem, size: "quarter" | "half" | "full" | "regular") => {
    let price = item.selling_price;
    if (size === "quarter" && item.quarter_price > 0) price = item.quarter_price;
    else if (size === "half" && item.half_price > 0) price = item.half_price;
    else if (size === "full" && item.full_price > 0) price = item.full_price;

    const existingIndex = cart.findIndex(
      (c) => c.menuItemId === item.id && c.size === size
    );

    if (existingIndex >= 0) {
      const newCart = [...cart];
      newCart[existingIndex].quantity += 1;
      setCart(newCart);
    } else {
      setCart([
        ...cart,
        {
          menuItemId: item.id,
          name: item.name,
          size,
          price,
          quantity: 1,
          imageUrl: item.image_url,
        },
      ]);
    }
    showCartNotification(`+ ${item.name} (${size.toUpperCase()})`);
    scrollCartToBottom();
  };

  // Add combo to cart
  const addComboToCart = (combo: ComboPackage) => {
    const existingIndex = cart.findIndex(
      (c) => c.menuItemId === combo.id && c.isCombo
    );

    if (existingIndex >= 0) {
      const newCart = [...cart];
      newCart[existingIndex].quantity += 1;
      setCart(newCart);
    } else {
      setCart([
        ...cart,
        {
          menuItemId: combo.id,
          name: combo.name,
          size: "combo",
          price: combo.price,
          quantity: 1,
          isCombo: true,
        },
      ]);
    }
    showCartNotification(`+ ${combo.name} (Combo)`);
    scrollCartToBottom();
  };

  // Handle QR scan
  const handleQRScan = (data: { menuItemId: string; name: string; size: string; price: number }) => {
    const size = data.size as "quarter" | "half" | "full" | "regular";
    const existingIndex = cart.findIndex(
      (c) => c.menuItemId === data.menuItemId && c.size === size
    );

    // Find the menu item to get the image
    const menuItem = menuItems.find(m => m.id === data.menuItemId);

    if (existingIndex >= 0) {
      const newCart = [...cart];
      newCart[existingIndex].quantity += 1;
      setCart(newCart);
    } else {
      setCart([
        ...cart,
        {
          menuItemId: data.menuItemId,
          name: data.name,
          size,
          price: data.price,
          quantity: 1,
          imageUrl: menuItem?.image_url || null,
        },
      ]);
    }
    showCartNotification(`+ ${data.name} (${size.toUpperCase()})`);
    scrollCartToBottom();
  };

  // Update quantity
  const updateQuantity = (index: number, delta: number) => {
    const newCart = [...cart];
    newCart[index].quantity += delta;
    if (newCart[index].quantity <= 0) {
      newCart.splice(index, 1);
    }
    setCart(newCart);
  };

  // Remove from cart
  const removeFromCart = (index: number) => {
    const newCart = [...cart];
    newCart.splice(index, 1);
    setCart(newCart);
  };

  // Record sale mutation
  const recordSaleMutation = useMutation({
    mutationFn: async () => {
      if (!guardWrite("record a sale")) {
        throw new Error("Test mode is read-only");
      }
      if (!restaurant?.id || !user?.id || cart.length === 0) {
        throw new Error("Invalid sale data");
      }

      // License gate: block new sales in limited/locked mode
      if (typeof window !== "undefined") {
        try {
          const raw = localStorage.getItem("license_state_v1");
          if (raw) {
            const s = JSON.parse(raw);
            if (s && (s.mode === "limited" || s.mode === "locked" || s.mode === "offline_stale" || s.mode === "no_seat")) {
              throw new Error("New sales are disabled: subscription required. You can still close shifts and settle open tabs.");
            }
          }
        } catch (e) {
          if (e instanceof Error && e.message.startsWith("New sales are disabled")) throw e;
        }
      }

      // Validate unpaid sales require a customer
      if (isUnpaidSale && !selectedCustomer) {
        throw new Error("Customer is required for unpaid sales");
      }

      // ── Offline guardrail ────────────────────────────────────────────
      // The desktop ZATCA path issues many sequential the API calls
      // (insert, ZATCA hash, PDF, ledger) that have no fetch timeout.
      // When offline, queue a simple cash/card sale to IndexedDB and
      // return immediately so the Pay button never hangs. ZATCA-only
      // flows (Standard B2B, foreign currency, unpaid credit) cannot be
      // safely queued without a customer record, so we fail fast with a
      // clear message instead.
      const browserOffline =
        typeof navigator !== "undefined" && navigator.onLine === false;
      // Do not block submit on an active probe here. Right after Wi‑Fi drops,
      // browsers can leave that fetch hanging long enough to make the Pay
      // button look stuck. We rely on the browser offline event + the warmed
      // connectivity watcher and immediately queue the sale when either says
      // offline.
      const saleKey = crypto.randomUUID();
      if (browserOffline || !isPosOnline()) {
        return queueSaleOffline(saleKey);
      }

      // Validate STANDARD invoice buyer details (B2B requires 15-digit VAT)
      if (invoiceSubtype === "STANDARD") {
        if (!buyerName.trim()) {
          throw new Error("Buyer name is required for Standard (B2B) invoices");
        }
        const hasVat = /^\d{15}$/.test(buyerVat.trim());
        const hasOtherId = buyerIdValue.trim().length > 0;
        if (!hasVat && !hasOtherId) {
          throw new Error("Standard (B2B) invoices require a 15-digit VAT number OR a non-VAT buyer ID (CRN/NAT/PAS/…)");
        }
        if (buyerVat.trim().length > 0 && !hasVat) {
          throw new Error("Buyer VAT number must be exactly 15 digits");
        }
      }

      // Validate FX inputs when foreign currency is selected.
      if (docCurrency && docCurrency !== "SAR") {
        const r = parseFloat(docFxRate);
        if (!Number.isFinite(r) || r <= 0) {
          throw new Error("Exchange rate to SAR is required when using a non-SAR currency");
        }
      }

      // Check customer credit limit for unpaid sales
      if (isUnpaidSale && selectedCustomer) {
        const newBalance = selectedCustomerCurrentBalance + cartTotal;
        if (selectedCustomerCreditLimit > 0 && newBalance > selectedCustomerCreditLimit) {
          throw new Error(`Sale would exceed customer credit limit of ${formatCurrency(selectedCustomerCreditLimit)}`);
        }
      }

      const activeShift = shiftsEnabled ? activeShifts[0] : undefined;
      const { net: subtotal, vat: transactionVat, gross: transactionTotal } = splitListed(cartTotal, vatRate, pricesInclusive);

      // Calculate transaction timestamp (backdated or current)
      let transactionTimestamp: string;
      if (isUnpaidSale && isBackdated) {
        const [hours, minutes] = backdatedTime.split(':').map(Number);
        const combinedDate = new Date(backdatedDate);
        combinedDate.setHours(hours, minutes, 0, 0);
        transactionTimestamp = combinedDate.toISOString();
      } else {
        transactionTimestamp = new Date().toISOString();
      }

      // One server call records the sale and everything that belongs to it in a single
      // transaction (POST /api/v1/pos/sales): sale + lines, shift cash event, recipe stock
      // deduction (database trigger, once), reorder requests, kitchen ticket and a live event.
      // The server assigns a sequential receipt number and recomputes totals with the branch's
      // VAT settings. Network failures still fall back to the offline queue.
      let saved: RecordSaleResult;
      try {
        saved = await withOnlineWriteTimeout(
          recordSale(
            {
              restaurantId: restaurant.id,
              branchId: activeBranchId ?? null,
              shiftId: activeShift?.id ?? null,
              customerId: selectedCustomer?.id ?? null,
              tableId: linkedTable?.id ?? null,
              paymentMethod,
              settlement: isUnpaidSale ? "unpaid" : "paid",
              createdAt: isUnpaidSale && isBackdated ? transactionTimestamp : null,
              lines: cart.map((item) => ({
                menuItemId: item.menuItemId,
                size: item.size === "combo" ? undefined : (item.size as SaleLineSize),
                quantity: item.quantity,
                unitPrice: item.price,
              })),
              invoice: {
                subtype: invoiceSubtype,
                buyerName: invoiceSubtype === "STANDARD" ? buyerName.trim() : null,
                buyerVat: invoiceSubtype === "STANDARD" ? buyerVat.trim() || null : null,
                buyerOtherId: invoiceSubtype === "STANDARD" ? buyerIdValue.trim() || null : null,
                buyerAddress: invoiceSubtype === "STANDARD" ? buyerAddress.trim() || null : null,
              },
            },
            { idempotencyKey: saleKey },
          ),
          "Recording sale",
        );
      } catch (error) {
        if (!(error instanceof ApiError) && isRecoverableNetworkError(error)) {
          return queueSaleOffline(saleKey);
        }
        if (error instanceof ApiError && error.code === "price_changed") {
          // The server prices every line. Show the cashier the current prices before charging.
          const changed = (error.details as PriceChangedDetails | undefined)?.lines ?? [];
          setCart((prev) =>
            prev.map((c) => {
              const hit = changed.find((l) => l.menuItemId === c.menuItemId && l.size === (c.size === "combo" ? "regular" : c.size));
              return hit ? { ...c, price: hit.current } : c;
            }),
          );
          void queryClient.invalidateQueries({ queryKey: ["menu-items", restaurant.id] });
          void queryClient.invalidateQueries({ queryKey: ["branch-menu-prices"] });
          throw new Error("Prices changed since the menu was loaded. The cart now shows the current prices; check the total and charge again.");
        }
        throw error;
      }

      return { transaction: saved.transaction, receiptNumber: saved.receiptNumber, salesItems: saved.salesItems };
    },
    onSuccess: (data) => {
      if ("offlineReceiptNumber" in data) {
        // ── Auto-print queued receipt ──────────────────────────────
        // Cashier still gets a paper receipt for the customer even
        // though the sale lives in the offline queue. ZATCA snapshot
        // is null offline (no QR / chain), which the printer accepts.
        const queuedReceiptNumber = (data as { offlineReceiptNumber: string }).offlineReceiptNumber;
        if (posHardware.receipt_printer_enabled && posHardware.print_receipt_on_sale) {
          const queuedReceipt: ReceiptData = {
            vatRatePercent: vatPercent,
            pricesVatInclusive: pricesInclusive,
            restaurantName: restaurant?.name || "Restaurant",
            receiptNumber: queuedReceiptNumber,
            date: new Date(),
            items: cart.map((item) => ({
              name: item.name,
              size: item.size,
              quantity: item.quantity,
              price: item.price,
              total: item.price * item.quantity,
            })),
            subtotal: cartTotal,
            tax: 0,
            total: cartTotal,
            paymentMethod,
            customerName: selectedCustomer?.name,
            header: posHardware.receipt_header || undefined,
            footer: (posHardware.receipt_footer || "") + "\n[OFFLINE · pending sync]",
            zatca: null,
          };
          const queuedKitchen: KitchenOrderData | null =
            posHardware.kitchen_printer_enabled && posHardware.print_kitchen_on_sale
              ? {
                  orderNumber: queuedReceiptNumber.split("-").pop() || "001",
                  date: new Date(),
                  items: cart.map((item) => ({
                    name: item.name,
                    size: item.size,
                    quantity: item.quantity,
                  })),
                }
              : null;
          handlePOSPrint(queuedReceipt, queuedKitchen, {
            receiptEnabled: posHardware.receipt_printer_enabled,
            receiptPrinterType: posHardware.receipt_printer_type,
            receiptPrinterIp: posHardware.receipt_printer_ip || undefined,
            receiptPrinterPort: posHardware.receipt_printer_port,
            kitchenEnabled: posHardware.kitchen_printer_enabled,
            kitchenPrinterType: posHardware.kitchen_printer_type,
            kitchenPrinterIp: posHardware.kitchen_printer_ip || undefined,
            kitchenPrinterPort: posHardware.kitchen_printer_port,
            drawerEnabled: posHardware.cash_drawer_enabled,
            drawerAutoOpen: posHardware.cash_drawer_auto_open_cash,
            drawerKickCode: posHardware.cash_drawer_kick_code,
            template: (pickTemplateForInvoice(receiptTemplates, invoiceSubtype)?.preset ?? posHardware.receipt_template) as
              | "simple" | "tax_invoice" | "detailed" | "saudi_bilingual" | "zatca_standard",
            templateConfig: (() => {
              const t = pickTemplateForInvoice(receiptTemplates, invoiceSubtype);
              return t
                ? {
                    language: t.language,
                    paperWidth: t.paper_width,
                    options: t.options as Record<string, boolean | string | number | null>,
                    headerNoteEn: t.header_note_en,
                    headerNoteAr: t.header_note_ar,
                    footerNoteEn: t.footer_note_en,
                    footerNoteAr: t.footer_note_ar,
                  }
                : undefined;
            })(),
            paymentMethod,
          });
        }

        if (salesDraftKey) {
          sessionStorage.removeItem(salesDraftKey);
        }

        setCart([]);
        setSelectedCustomer(null);
        setIsUnpaidSale(false);
        setCustomerSearchTerm("");
        setShowCustomerSelect(false);
        setIsBackdated(false);
        setBackdatedDate(new Date());
        setBackdatedTime(format(new Date(), "HH:mm"));
        setInvoiceSubtype("SIMPLIFIED");
        setBuyerName("");
        setBuyerVat("");
        setBuyerAddress("");
        setBuyerIdValue("");
        setDocDiscount("");
        setDocSurcharge("");
        setDocCurrency("SAR");
        setDocFxRate("");
        setZatcaTouched({
          buyerName: false,
          buyerVat: false,
          buyerIdValue: false,
          docDiscount: false,
          docSurcharge: false,
          docFxRate: false,
        });

        toast.success(`Queued offline · ${data.offlineReceiptNumber}`, {
          description: "Will sync automatically when back online.",
        });
        if (isUnpaidSale) {
          void logUnpaidPosting({
            event: "queued_offline",
            restaurantId: restaurant?.id,
            branchId: activeBranchId,
            userId: user?.id,
            customerId: selectedCustomer?.id ?? null,
            receiptNumber: queuedReceiptNumber,
            cartTotal: cartTotal,
          });
          setLastQueuedUnpaidReceipt(queuedReceiptNumber);
        }
        return;
      }

      // Build a single ZATCA snapshot at sale-completion time. The same
      // snapshot drives the printed receipt, the queued reprint, and
      // the PDF - guaranteeing the QR / VAT / totals never disagree.
      const saleTimestamp = new Date().toISOString();
      const snapshotPrinted = buildZatcaSnapshot(
        zatcaSettings,
        { subtotal: cartTotal, tax: 0, total: cartTotal, timestamp: saleTimestamp },
        "printed",
      );
      const snapshotDigital = buildZatcaSnapshot(
        zatcaSettings,
        { subtotal: cartTotal, tax: 0, total: cartTotal, timestamp: saleTimestamp },
        "digital",
      );

      // Trigger printing if enabled
      if (posHardware.receipt_printer_enabled && posHardware.print_receipt_on_sale) {
        const receiptData: ReceiptData = {
          vatRatePercent: vatPercent,
          pricesVatInclusive: pricesInclusive,
          restaurantName: restaurant?.name || "Restaurant",
          receiptNumber: data.receiptNumber,
          date: new Date(),
          items: cart.map(item => ({
            name: item.name,
            size: item.size,
            quantity: item.quantity,
            price: item.price,
            total: item.price * item.quantity,
          })),
          subtotal: cartTotal,
          tax: 0,
          total: cartTotal,
          paymentMethod: paymentMethod,
          customerName: selectedCustomer?.name,
          header: posHardware.receipt_header || undefined,
          footer: posHardware.receipt_footer || undefined,
          zatca: snapshotPrinted,
        };

        // Per-item printer routing (Kitchen vs Bar vs None).
        // Looks up each cart line in menuItems for its print_route flag —
        // defaults to 'kitchen' for items added before the column existed.
        const routeFor = (menuItemId: string): "kitchen" | "bar" | "none" => {
          const mi = menuItems.find((m) => m.id === menuItemId) as
            | (MenuItem & { print_route?: string })
            | undefined;
          const r = mi?.print_route;
          return r === "bar" || r === "none" ? r : "kitchen";
        };
        const orderNumber = data.receiptNumber.split("-").pop() || "001";
        const ticketItems = cart.map((item) => ({
          name: item.name,
          size: item.size,
          quantity: item.quantity,
          route: routeFor(item.menuItemId),
        }));
        const kitchenItems = ticketItems.filter((i) => i.route === "kitchen");
        const barItems = ticketItems.filter((i) => i.route === "bar");

        const kitchenData: KitchenOrderData | null =
          posHardware.kitchen_printer_enabled &&
          posHardware.print_kitchen_on_sale &&
          kitchenItems.length > 0
            ? {
                orderNumber,
                date: new Date(),
                stationLabel: "KITCHEN",
                items: kitchenItems.map(({ route: _r, ...rest }) => rest),
              }
            : null;

        const barData: KitchenOrderData | null =
          posHardware.bar_printer_enabled &&
          posHardware.print_bar_on_sale &&
          barItems.length > 0
            ? {
                orderNumber,
                date: new Date(),
                stationLabel: "BAR",
                items: barItems.map(({ route: _r, ...rest }) => rest),
              }
            : null;

        handlePOSPrint(receiptData, kitchenData, {
          receiptEnabled: posHardware.receipt_printer_enabled,
          receiptPrinterType: posHardware.receipt_printer_type,
          receiptPrinterIp: posHardware.receipt_printer_ip || undefined,
          receiptPrinterPort: posHardware.receipt_printer_port,
          kitchenEnabled: posHardware.kitchen_printer_enabled,
          kitchenPrinterType: posHardware.kitchen_printer_type,
          kitchenPrinterIp: posHardware.kitchen_printer_ip || undefined,
          kitchenPrinterPort: posHardware.kitchen_printer_port,
          barData,
          barEnabled: posHardware.bar_printer_enabled,
          barPrinterType: posHardware.bar_printer_type,
          barPrinterIp: posHardware.bar_printer_ip || undefined,
          barPrinterPort: posHardware.bar_printer_port,
          drawerEnabled: posHardware.cash_drawer_enabled,
          drawerAutoOpen: posHardware.cash_drawer_auto_open_cash,
          drawerKickCode: posHardware.cash_drawer_kick_code,
          template: (pickTemplateForInvoice(receiptTemplates, invoiceSubtype)?.preset ?? posHardware.receipt_template) as
            | "simple" | "tax_invoice" | "detailed" | "saudi_bilingual" | "zatca_standard",
          templateConfig: (() => {
            const t = pickTemplateForInvoice(receiptTemplates, invoiceSubtype);
            if (!t) return undefined;
            return {
              language: t.language,
              paperWidth: t.paper_width,
              options: t.options as Record<string, boolean | string | number | null>,
              headerNoteEn: t.header_note_en,
              headerNoteAr: t.header_note_ar,
              footerNoteEn: t.footer_note_en,
              footerNoteAr: t.footer_note_ar,
              buyer:
                invoiceSubtype === "STANDARD"
                  ? { name: buyerName || null, vatNumber: buyerVat || null, address: buyerAddress || null, idValue: buyerIdValue || null }
                  : null,
            };
          })(),
          paymentMethod: paymentMethod,
        });

      }

      // ZATCA PDF generation. Runs whether or not a printer is wired up,
      // because the PDF is the legal artifact required by the spec.
      const snapshotForPdf = snapshotDigital ?? snapshotPrinted;
      const txnId = (data.transaction as { id?: string } | null)?.id ?? null;
      const restaurantIdForLog = restaurant?.id ?? null;

      // Phase 2: advance the per-device hash chain (ICV/PIH) and persist
      // UUID + invoice hash on the transaction. Runs in the background
      // and is a no-op when no active device is configured (Phase 1 mode).
      const activeDeviceId = (zatcaSettings as { active_device_id?: string | null } | null)?.active_device_id ?? null;
      if (txnId && activeDeviceId && snapshotForPdf) {
        void (async () => {
          try {
            const chain = await advanceZatcaChain(activeDeviceId, {
              receiptNumber: data.receiptNumber,
              snapshot: snapshotForPdf,
              items: cart.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: i.price, total: i.price * i.quantity })),
              subtotal: cartTotal,
              tax: 0,
              total: cartTotal,
              paymentMethod,
            });
            if (chain) {
              await writeZatcaChainToSale({
                salesTransactionId: txnId,
                deviceId: activeDeviceId,
                chain,
              });
              // UBL 2.1 XML - built from the same snapshot + chain values
              // and uploaded to the private `zatca-xml` bucket. Audit-only
              // for now (no clearance call); URL is stamped on the sale row.
              try {
                const restaurantIdForXml = restaurant?.id ?? null;
                if (restaurantIdForXml) {
                  const lines = cart.map((i) => {
                    const mi = menuItems.find((m) => m.id === i.menuItemId) as
                      | (typeof menuItems)[number]
                      | undefined;
                    const rawCat = (mi as { vat_category?: string } | undefined)?.vat_category;
                    const vatCategory = (
                      rawCat === "S" || rawCat === "Z" || rawCat === "E" || rawCat === "O"
                        ? rawCat
                        : "S"
                    ) as "S" | "Z" | "E" | "O";
                    const reason =
                      (mi as { vat_exemption_reason_code?: string | null } | undefined)
                        ?.vat_exemption_reason_code ?? null;
                    const listed = lineGrossOf(i.price, i.quantity);
                    const gross = vatCategory === "S" && !pricesInclusive ? roundMoney(listed * (1 + vatRate)) : listed;
                    const lineExt = vatCategory === "S" ? netFromListed(listed, vatRate, pricesInclusive) : listed;
                    const taxAmount = roundMoney(gross - lineExt);
                    return {
                      name: i.name,
                      quantity: i.quantity,
                      unitPrice: vatCategory === "S" ? netFromListed(i.price, vatRate, pricesInclusive) : roundMoney(i.price),
                      lineExtension: lineExt,
                      taxAmount,
                      vatCategory,
                      vatExemptionReasonCode: reason,
                    };
                  });
                  const lineTaxTotal = sumMoney(lines.map((l) => l.taxAmount));
                  const lineTaxableTotal = sumMoney(lines.map((l) => l.lineExtension));
                  const xml = buildSimplifiedTaxInvoiceUbl({
                    uuid: chain.uuid,
                    receiptNumber: data.receiptNumber,
                    issueDateTime: snapshotForPdf.timestamp,
                    icv: chain.icv,
                    pih: chain.pih,
                    qrBase64: snapshotForPdf.qrBase64 ?? null,
                    seller: {
                      nameEn: snapshotForPdf.sellerName,
                      nameAr: snapshotForPdf.sellerNameAr ?? null,
                      vatNumber: snapshotForPdf.vatNumber,
                    },
                    invoiceSubtype,
                    buyer: invoiceSubtype === "STANDARD" ? {
                      name: buyerName.trim(),
                      vatNumber: /^\d{15}$/.test(buyerVat.trim()) ? buyerVat.trim() : null,
                      address: buyerAddress.trim() || null,
                      countryCode: "SA",
                      identification: buyerIdValue.trim()
                        ? { scheme: buyerIdScheme, value: buyerIdValue.trim() }
                        : null,
                    } : null,
                    currency: docCurrency || restaurant?.currency || "SAR",
                    taxCurrency: "SAR",
                    taxExchangeRate: docCurrency && docCurrency !== "SAR"
                      ? parseFloat(docFxRate) || undefined
                      : undefined,
                    lines,
                    // Adjust totals for document-level allowance/charge so
                    // <PayableAmount> stays consistent with the cart total.
                    taxExclusiveAmount: lineTaxableTotal,
                    taxAmount: roundMoney(lineTaxTotal
                      + vatFromGross((parseFloat(docSurcharge) || 0) - (parseFloat(docDiscount) || 0), vatRate)),
                    taxInclusiveAmount: roundMoney(lineTaxableTotal + lineTaxTotal
                      + ((parseFloat(docSurcharge) || 0) - (parseFloat(docDiscount) || 0))),
                    allowanceCharges: [
                      ...((parseFloat(docDiscount) || 0) > 0
                        ? [{ isCharge: false, amount: parseFloat(docDiscount), reason: "Document-level discount", reasonCode: "95", vatCategory: "S" as const }]
                        : []),
                      ...((parseFloat(docSurcharge) || 0) > 0
                        ? [{ isCharge: true, amount: parseFloat(docSurcharge), reason: "Document-level charge", reasonCode: "ZZZ", vatCategory: "S" as const }]
                        : []),
                    ],
                    paymentMeansCode: paymentMethod === "cash" ? "10" : "30",
                    vatRatePercent: vatPercent,
                  });
                  const xmlUrl = await uploadZatcaXml({
                    restaurantId: restaurantIdForXml,
                    receiptNumber: data.receiptNumber,
                    xml,
                  });
                  if (xmlUrl) {
                    await writeXmlUrlToSale({ salesTransactionId: txnId, xmlUrl });
                  }
                  // XAdES sign the unsigned UBL using the device key
                  // (server-side - private key never leaves the backend).
                  try {
                    await db.functions.invoke("zatca-sign-invoice", {
                      body: {
                        device_id: activeDeviceId,
                        sales_transaction_id: txnId,
                        receipt_number: data.receiptNumber,
                        xml,
                        invoice_hash: chain.invoiceHash,
                      },
                    });
                    // Submit the signed UBL to Fatoora for clearance/
                    // reporting. Runs in simulation mode unless the
                    // ZATCA_BASE_URL secret is configured.
                    try {
                      await db.functions.invoke("zatca-submit-clearance", {
                        body: { sales_transaction_id: txnId },
                      });
                    } catch (subErr) {
                      console.warn("[zatca] clearance submission failed", subErr);
                    }
                  } catch (signErr) {
                    console.warn("[zatca] XAdES signing failed", signErr);
                  }
                }
              } catch (xmlErr) {
                console.warn("[zatca] UBL XML generation failed", xmlErr);
              }
            }
          } catch (e) {
            console.warn("[zatca] chain advance failed", e);
          }
        })();
      }

      if (
        zatcaSettings?.qr_enabled &&
        zatcaSettings?.auto_generate_pdf_receipt &&
        snapshotForPdf
      ) {
        const mode = zatcaSettings.pdf_generation_mode ?? "SOFT";
        const startedAt = performance.now();
        const pdfPromise = generateZatcaPdf({
          receiptNumber: data.receiptNumber,
          date: saleTimestamp,
          customerName: selectedCustomer?.name ?? null,
          paymentMethod,
          header: posHardware.receipt_header || null,
          footer: posHardware.receipt_footer || null,
          currencySymbol: restaurant?.currency || "SAR",
          items: cart.map((item) => ({
            name: item.name,
            size: item.size,
            quantity: item.quantity,
            unitPrice: item.price,
            total: item.price * item.quantity,
          })),
          subtotal: cartTotal,
          tax: 0,
          total: cartTotal,
          zatca: { ...snapshotForPdf, showQr: true },
          mode,
        });

        // Audit + snapshot persistence runs in the background so the UI
        // (toast.promise) stays responsive. Errors here are logged but
        // never bubble - the legal artifact already exists in the toast.
        const persist = pdfPromise.then(
          async (res) => {
            const bytes = pdfBase64ToBytes(res.pdf);
            let pdfUrl: string | null = null;
            if (restaurantIdForLog) {
              pdfUrl = await uploadZatcaPdf({
                restaurantId: restaurantIdForLog,
                receiptNumber: data.receiptNumber,
                pdfBytes: bytes,
              });
            }
            if (txnId) {
              await writeZatcaSnapshot({
                salesTransactionId: txnId,
                snapshot: snapshotForPdf,
                pdfUrl,
              });
            }
            if (restaurantIdForLog) {
              await logInvoiceGeneration({
                restaurantId: restaurantIdForLog,
                salesTransactionId: txnId,
                receiptNumber: data.receiptNumber,
                status: "success",
                mode,
                snapshot: snapshotForPdf,
                pdfUrl,
                pdfBytes: res.bytes ?? bytes.length,
                durationMs: Math.round(performance.now() - startedAt),
                triggeredBy: user?.id ?? null,
              });
            }
          },
          async (err: Error) => {
            if (restaurantIdForLog) {
              await logInvoiceGeneration({
                restaurantId: restaurantIdForLog,
                salesTransactionId: txnId,
                receiptNumber: data.receiptNumber,
                status: "failed",
                mode,
                snapshot: snapshotForPdf,
                durationMs: Math.round(performance.now() - startedAt),
                errorMessage: err?.message ?? "Unknown error",
                triggeredBy: user?.id ?? null,
              });
            }
          },
        );
        void persist;

        toast.promise(pdfPromise, {
          loading: "Generating ZATCA PDF receipt…",
          success: (res) => {
            try {
              const url = pdfBase64ToBlobUrl(res.pdf);
              window.open(url, "_blank", "noopener");
              // Best-effort cleanup so we don't leak the object URL.
              setTimeout(() => URL.revokeObjectURL(url), 60_000);
            } catch (e) {
              console.warn("Could not open PDF preview", e);
            }
            return "ZATCA PDF receipt ready";
          },
          error: (err: Error) => {
            const msg = err?.message ?? "Unknown error";
            // STRICT: block silently failing - surface a hard error.
            // SOFT: warn but don't disrupt the sale flow.
            return mode === "STRICT"
              ? `ZATCA PDF failed (STRICT): ${msg}`
              : `ZATCA PDF skipped: ${msg}`;
          },
        });
      } else if (snapshotForPdf && txnId) {
        // PDF auto-generation is off but we still have a valid QR snapshot
        // (e.g. printed on the receipt only). Freeze the QR/VAT snapshot
        // onto the transaction so reprints remain reproducible, and log
        // a "skipped" generation row for completeness.
        void writeZatcaSnapshot({
          salesTransactionId: txnId,
          snapshot: snapshotForPdf,
          pdfUrl: null,
        });
        if (restaurantIdForLog) {
          void logInvoiceGeneration({
            restaurantId: restaurantIdForLog,
            salesTransactionId: txnId,
            receiptNumber: data.receiptNumber,
            status: "skipped",
            mode: zatcaSettings?.pdf_generation_mode ?? "SOFT",
            snapshot: snapshotForPdf,
            errorMessage: "auto_generate_pdf_receipt is OFF",
            triggeredBy: user?.id ?? null,
          });
        }
      } else if (zatcaSettings?.qr_enabled && !snapshotForPdf) {
        // QR is enabled but settings are incomplete (e.g. missing 15-digit
        // VAT number). Surface this once per sale so the operator notices.
        toast.warning(
          "ZATCA QR skipped - complete seller name & 15-digit VAT in Settings → ZATCA",
        );
        if (restaurantIdForLog) {
          void logInvoiceGeneration({
            restaurantId: restaurantIdForLog,
            salesTransactionId: txnId,
            receiptNumber: data.receiptNumber,
            status: "skipped",
            mode: zatcaSettings.pdf_generation_mode ?? "SOFT",
            snapshot: null,
            errorMessage: "Incomplete ZATCA settings (seller/VAT)",
            triggeredBy: user?.id ?? null,
          });
        }
      }

      queryClient.invalidateQueries({ queryKey: ["sales-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["sales-items"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      
      // Clear sales draft from sessionStorage
      if (salesDraftKey) {
        sessionStorage.removeItem(salesDraftKey);
      }
      
      setCart([]);
      setSelectedCustomer(null);
      setIsUnpaidSale(false);
      setCustomerSearchTerm("");
      setShowCustomerSelect(false);
      setIsBackdated(false);
      setBackdatedDate(new Date());
      setBackdatedTime(format(new Date(), "HH:mm"));
      setInvoiceSubtype("SIMPLIFIED");
      setBuyerName("");
      setBuyerVat("");
      setBuyerAddress("");
      setBuyerIdValue("");
      setDocDiscount("");
      setDocSurcharge("");
      setDocCurrency("SAR");
      setDocFxRate("");
      setZatcaTouched({
        buyerName: false,
        buyerVat: false,
        buyerIdValue: false,
        docDiscount: false,
        docSurcharge: false,
        docFxRate: false,
      });
      const message = isUnpaidSale 
        ? `Sale recorded as unpaid for ${selectedCustomer?.name}${isBackdated ? ' (backdated)' : ''}`
        : "Sale recorded successfully!";
      toast.success(message);
      setUnpaidPostError(null);
      trackFunnel("first_order", { unpaid: isUnpaidSale });
      // Flip linked table to "ordered" once a sale is successfully recorded
      if (linkedTable?.id) {
        void db
          .from("pos_tables")
          .update({ status: "ordered" } as never)
          .eq("id", linkedTable.id);
        setLinkedTable(null);
        // Strip ?table from URL so refresh doesn't re-link
        if (typeof window !== "undefined") {
          const url = new URL(window.location.href);
          url.searchParams.delete("table");
          window.history.replaceState({}, "", url.toString());
        }
      }
      if (isUnpaidSale && "receiptNumber" in data) {
        void logUnpaidPosting({
          event: "succeeded",
          restaurantId: restaurant?.id,
          branchId: activeBranchId,
          userId: user?.id,
          customerId: selectedCustomer?.id ?? null,
          receiptNumber: (data as { receiptNumber?: string }).receiptNumber ?? null,
          cartTotal: cartTotal,
        });
      }
    },
    onError: (error: Error) => {
      const rawMsg = error?.message || "Failed to record sale";
      if (isUnpaidSale) {
        // Make the rejection unmissable: persistent inline alert + a longer
        // toast with the customer + reason. Users were posting unpaid sales
        // and assuming silence == success.
        setUnpaidPostError(rawMsg);
        toast.error("Couldn't add to customer's tab", {
          description: rawMsg,
          duration: 8000,
        });
        void logUnpaidPosting({
          event: "failed",
          restaurantId: restaurant?.id,
          branchId: activeBranchId,
          userId: user?.id,
          customerId: selectedCustomer?.id ?? null,
          cartTotal: cartTotal,
          errorMessage: rawMsg,
          errorDetails: error,
        });
      } else {
        toast.error(rawMsg);
      }
      console.error(error);
    },
  });

  // Helper to get default category (first available category)
  const getDefaultExpenseCategoryId = (): string | null => {
    if (expenseCategories && expenseCategories.length > 0) {
      return expenseCategories[0].id;
    }
    return null;
  };

  // Record expense mutation
  const addExpenseMutation = useMutation({
    mutationFn: async () => {
      if (!guardWrite("record an expense")) {
        throw new Error("Test mode is read-only");
      }
      if (!restaurant?.id || !user?.id) throw new Error("Missing context");
      // Auto-assign default category if none selected
      const finalCategoryId = expenseCategoryId || getDefaultExpenseCategoryId();
      const { error } = await db.from("expenses").insert({
        restaurant_id: restaurant.id,
        created_by: user.id,
        amount: parseFloat(expenseAmount),
        description: expenseDescription || null,
        category_id: finalCategoryId,
        expense_date: expenseDate,
        receipt_url: expenseReceiptUrl,
        status: expenseStatus,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      if (expenseDraftKey) sessionStorage.removeItem(expenseDraftKey);
      setExpenseAmount("");
      setExpenseDescription("");
      setExpenseCategoryId("");
      setExpenseDate(format(new Date(), "yyyy-MM-dd"));
      setExpenseReceiptUrl(null);
      setExpenseStatus('paid');
      toast.success("Expense recorded");
    },
    onError: () => toast.error("Failed to record expense"),
  });

  const hasVariantPrices = (item: MenuItem) => {
    return item.quarter_price > 0 || item.half_price > 0 || item.full_price > 0;
  };
  
  const countVariantPrices = (item: MenuItem) => {
    let count = 0;
    if (item.quarter_price > 0) count++;
    if (item.half_price > 0) count++;
    if (item.full_price > 0) count++;
    return count;
  };

  const getSingleVariant = (item: MenuItem): { size: "quarter" | "half" | "full"; price: number } | null => {
    if (countVariantPrices(item) !== 1) return null;
    if (item.quarter_price > 0) return { size: "quarter", price: item.quarter_price };
    if (item.half_price > 0) return { size: "half", price: item.half_price };
    if (item.full_price > 0) return { size: "full", price: item.full_price };
    return null;
  };
  
  const getVariantGridClass = (item: MenuItem) => {
    const count = countVariantPrices(item);
    if (count === 1) return "grid grid-cols-1 gap-1";
    if (count === 2) return "grid grid-cols-2 gap-1";
    return "grid grid-cols-3 gap-1";
  };

  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);
  
  // On tablets, use drawer for cart like mobile
  const useDrawerCart = isMobile || isTablet;

  // Cart component for reuse
  const CartContent = () => (
    <>
      {/* Cart Items */}
      <ScrollArea className="flex-1 min-h-[150px]" viewportRef={cartScrollRef}>
        <div className="p-4 space-y-2">
          {cart.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <ShoppingCart className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>{t("app.pos.order.empty")}</p>
              <p className="text-sm">{t("app.pos.order.emptyHelp")}</p>
            </div>
          ) : (
            cart.map((item, index) => (
              <div 
                key={`${item.menuItemId}-${item.size}-${index}`} 
                className="bg-card border border-border rounded-lg p-3 hover:border-primary/30 transition-colors overflow-hidden"
              >
                <div className="flex items-center gap-2">
                  {/* Product Image */}
                  <div className="w-11 h-11 rounded-lg bg-muted flex-shrink-0 overflow-hidden border border-border">
                    {item.imageUrl ? (
                      <img
                        src={toCdnUrl(item.imageUrl) || ""}
                        alt={item.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <UtensilsCrossed className="h-4 w-4 text-muted-foreground/50" />
                      </div>
                    )}
                  </div>
                  
                  {/* Item Details */}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm leading-tight truncate">{item.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Badge 
                        variant="secondary" 
                        className="text-[10px] px-1 py-0 h-4 font-medium uppercase"
                      >
                        {t(`app.pos.order.${item.size}`, { defaultValue: item.size })}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatCurrency(item.price)}
                      </span>
                    </div>
                  </div>

                  {/* Quantity Controls */}
                  <div className="flex items-center gap-0.5 bg-muted/50 rounded-md p-0.5 flex-shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 hover:bg-background"
                      onClick={() => updateQuantity(index, -1)}
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="w-5 text-center font-semibold text-sm">
                      {item.quantity}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 hover:bg-background"
                      onClick={() => updateQuantity(index, 1)}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>

                  {/* Delete Button */}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 flex-shrink-0 text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                    onClick={() => removeFromCart(index)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                
                {/* Line Total + VAT-inclusive breakdown */}
                {(() => {
                  const { gross: itemGross, net: lineNet, vat: lineVat } =
                    splitListed(lineGrossOf(item.price, item.quantity), vatRate, pricesInclusive);
                  return (
                    <div className="mt-2 pt-2 border-t border-border/50 space-y-0.5">
                      <div className="flex justify-between text-[11px] text-muted-foreground">
                        <span>{t("app.pos.order.net")}</span>
                        <span className="tabular-nums">{formatCurrency(lineNet)}</span>
                      </div>
                      <div className="flex justify-between text-[11px] text-muted-foreground">
                        <span>{t("app.pos.mobile.vat")} ({vatPercent}%)</span>
                        <span className="tabular-nums">{formatCurrency(lineVat)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-xs text-muted-foreground">{t("app.pos.order.gross")}</span>
                        <span className="text-sm font-semibold text-foreground tabular-nums">
                          {formatCurrency(itemGross)}
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Cart Footer */}
      <div className="flex flex-col flex-shrink-0 max-h-[55%] overflow-hidden border-t border-border bg-background">
        <ScrollArea className="flex-1 min-h-1">
        <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold">{t("app.pos.order.total")}</span>
            {cart.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                onClick={() => {
                  setCart([]);
                  toast.success(t("app.pos.order.cleared"));
                }}
              >
                <Trash2 className="h-3 w-3 me-1" />
                {t("app.pos.order.clear")}
              </Button>
            )}
          </div>
          <span className="text-lg font-bold">{formatCurrency(cartTotal)}</span>
        </div>

        <Separator />

        {/* ZATCA validation summary - surfaces every failing field at the
            top of the form so the operator can fix everything in one pass. */}
        {hasZatcaErrors && (() => {
          const FIELD_META: Record<
            string,
            { label: string; id: string; advanced: boolean }
          > = {
            buyerName: { label: "Buyer name", id: "zatca-buyer-name", advanced: false },
            buyerVat: { label: "Buyer VAT number", id: "zatca-buyer-vat", advanced: false },
            buyerIdValue: { label: "Buyer ID", id: "zatca-buyer-id", advanced: false },
            docDiscount: { label: "Document discount", id: "zatca-doc-discount", advanced: true },
            docSurcharge: { label: "Document surcharge", id: "zatca-doc-surcharge", advanced: true },
            docFxRate: { label: "Exchange rate", id: "zatca-doc-fx-rate", advanced: true },
          };
          const issues = Object.entries(zatcaValidation).filter(([, msg]) => !!msg);
          return (
            <div
              role="alert"
              aria-live="polite"
              className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-2"
            >
              <div className="flex items-center gap-2 text-xs font-medium text-destructive">
                <AlertCircle className="h-3.5 w-3.5" />
                {issues.length} field{issues.length === 1 ? "" : "s"} need attention before you can submit
              </div>
              <ul className="space-y-1 text-[11px]">
                {issues.map(([field, msg]) => {
                  const meta = FIELD_META[field] ?? {
                    label: field,
                    id: "",
                    advanced: false,
                  };
                  return (
                    <li key={field} className="flex gap-1.5">
                      <span className="text-destructive/60">•</span>
                      <button
                        type="button"
                className="text-start flex-1 hover:underline focus:outline-none focus:underline"
                        onClick={() => {
                          // Touch the field so the inline error renders.
                          setZatcaTouched((t) => ({ ...t, [field]: true }));
                          // Open advanced panel if the field lives inside it.
                          if (meta.advanced) setShowAdvancedZatca(true);
                          // Focus on the next tick (after potential layout).
                          setTimeout(() => {
                            const el = document.getElementById(meta.id) as
                              | HTMLInputElement
                              | null;
                            if (el) {
                              el.scrollIntoView({ behavior: "smooth", block: "center" });
                              el.focus();
                            }
                          }, 50);
                        }}
                      >
                        <span className="font-medium text-destructive">
                          {meta.label}:
                        </span>{" "}
                        <span className="text-destructive/90">{msg}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })()}

        {/* Combined Invoice, Payment & Settlement section (configurable, collapsed by default) */}
        {((posHardware as { pos_layout_config?: import("@/components/pos/POSAlternateLayouts").PosLayoutConfig })?.pos_layout_config?.showInvoicePaymentSection ?? true) && (
        <>
        <button
          type="button"
          onClick={() => setPaymentSectionOpen((v) => !v)}
          className="flex w-full items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm font-medium hover:bg-muted/50 transition-colors"
          aria-expanded={paymentSectionOpen}
        >
          <span className="flex items-center gap-2">
            {t("app.pos.order.invoicePayment")}
            {isUnpaidSale && (
              <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-warning-foreground">
                {t("app.pos.order.pendingSettlement")}
              </span>
            )}
          </span>
          {paymentSectionOpen ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>

        {paymentSectionOpen && (
        <>
        {/* Unpaid – Pending Settlement toggle (moved into combined section) */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={isUnpaidSale ? "secondary" : "outline"}
            size="sm"
            className="flex-1 justify-between gap-2 h-9"
            onClick={() => setUnpaidDialogOpen(true)}
          >
            <span className="flex items-center gap-2 truncate">
              <User className="h-4 w-4" />
              <span className="truncate text-xs sm:text-sm">
                {isUnpaidSale
                  ? selectedCustomer
                    ? `Unpaid · ${selectedCustomer.name}`
                    : t("app.pos.order.selectCustomer")
                  : t("app.pos.order.pendingSettlement")}
              </span>
            </span>
            <ChevronDown className="h-3.5 w-3.5 opacity-60" />
          </Button>
          {isUnpaidSale && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 px-2 text-xs text-muted-foreground"
              onClick={() => {
                setIsUnpaidSale(false);
                setSelectedCustomer(null);
                setShowCustomerSelect(false);
                setIsBackdated(false);
              }}
            >
              {t("app.pos.order.clear")}
            </Button>
          )}
        </div>
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Invoice Type (ZATCA)</Label>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              size="sm"
              variant={invoiceSubtype === "SIMPLIFIED" ? "default" : "outline"}
              onClick={() => {
                setInvoiceSubtype("SIMPLIFIED");
                setZatcaTouched({
                  buyerName: false,
                  buyerVat: false,
                  buyerIdValue: false,
                  docDiscount: false,
                  docSurcharge: false,
                  docFxRate: false,
                });
              }}
            >
              Simplified (B2C)
            </Button>
            <Button
              type="button"
              size="sm"
              variant={invoiceSubtype === "STANDARD" ? "default" : "outline"}
              onClick={() => {
                setInvoiceSubtype("STANDARD");
                setZatcaTouched({
                  buyerName: false,
                  buyerVat: false,
                  buyerIdValue: false,
                  docDiscount: false,
                  docSurcharge: false,
                  docFxRate: false,
                });
              }}
            >
              Standard (B2B)
            </Button>
          </div>
          {invoiceSubtype === "STANDARD" && (
            <div className="space-y-2 pt-2">
              <Input
                id="zatca-buyer-name"
                placeholder="Buyer / company name"
                value={buyerName}
                onChange={(e) => setBuyerName(e.target.value)}
                onBlur={() => {
                  setBuyerName((v) => normalizeText(v, 1000));
                  setZatcaTouched((t) => ({ ...t, buyerName: true }));
                }}
                aria-invalid={zatcaTouched.buyerName && !!zatcaValidation.buyerName}
                className="h-9"
              />
              {zatcaTouched.buyerName && zatcaValidation.buyerName && (
                <p className="text-xs text-destructive">{zatcaValidation.buyerName}</p>
              )}
              <Input
                id="zatca-buyer-vat"
                placeholder="Buyer VAT number (15 digits)"
                value={buyerVat}
                onChange={(e) => setBuyerVat(e.target.value.replace(/\D/g, "").slice(0, 15))}
                onBlur={() => {
                  setBuyerVat((v) => v.trim().replace(/\D/g, "").slice(0, 15));
                  setZatcaTouched((t) => ({ ...t, buyerVat: true }));
                }}
                inputMode="numeric"
                maxLength={15}
                aria-invalid={zatcaTouched.buyerVat && !!zatcaValidation.buyerVat}
                className="h-9"
              />
              {zatcaTouched.buyerVat && zatcaValidation.buyerVat && (
                <p className="text-xs text-destructive">{zatcaValidation.buyerVat}</p>
              )}
              {buyerVat.length > 0 && buyerVat.length !== 15 && (
                <p className="text-xs text-destructive">VAT must be exactly 15 digits ({buyerVat.length}/15).</p>
              )}
              <Input
                placeholder="Buyer address (optional)"
                value={buyerAddress}
                onChange={(e) => setBuyerAddress(e.target.value)}
                onBlur={() => setBuyerAddress((v) => normalizeText(v, 500))}
                className="h-9"
              />
              {/* Non-VAT buyer ID - for B2B buyers without a VAT number. */}
              <div className="grid grid-cols-3 gap-2">
                <Select value={buyerIdScheme} onValueChange={(v) => setBuyerIdScheme(v as typeof buyerIdScheme)}>
                  <SelectTrigger className="h-9 col-span-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CRN">CRN (Commercial Reg.)</SelectItem>
                    <SelectItem value="NAT">National ID</SelectItem>
                    <SelectItem value="IQA">Iqama</SelectItem>
                    <SelectItem value="PAS">Passport</SelectItem>
                    <SelectItem value="GCC">GCC ID</SelectItem>
                    <SelectItem value="MOM">Momra</SelectItem>
                    <SelectItem value="MLS">MLSD</SelectItem>
                    <SelectItem value="SAG">Sagia</SelectItem>
                    <SelectItem value="OTH">Other</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  id="zatca-buyer-id"
                  className="h-9 col-span-2"
                  placeholder="Other ID (used if no VAT)"
                  value={buyerIdValue}
                  onChange={(e) => setBuyerIdValue(e.target.value)}
                  onBlur={() => {
                    setBuyerIdValue((v) => normalizeBuyerId(v, buyerIdScheme));
                    setZatcaTouched((t) => ({ ...t, buyerIdValue: true }));
                  }}
                  aria-invalid={zatcaTouched.buyerIdValue && !!zatcaValidation.buyerIdValue}
                />
              </div>
              {zatcaTouched.buyerIdValue && zatcaValidation.buyerIdValue && (
                <p className="text-xs text-destructive">{zatcaValidation.buyerIdValue}</p>
              )}
              <p className="text-[11px] text-muted-foreground">
                Provide a 15-digit VAT number OR a non-VAT buyer ID.
              </p>
            </div>
          )}
          {/* Advanced ZATCA UBL options - discounts, surcharges, foreign currency */}
          <div className="pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setShowAdvancedZatca((s) => !s)}
            >
              {showAdvancedZatca ? "Hide" : "Show"} advanced ZATCA options
            </Button>
            {showAdvancedZatca && (
              <div className="space-y-2 pt-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Document discount (pre-VAT)</Label>
                    <Input
                      id="zatca-doc-discount"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      className="h-9"
                      placeholder="0.00"
                      value={docDiscount}
                      onChange={(e) => setDocDiscount(e.target.value)}
                      onBlur={() => {
                        setDocDiscount((v) =>
                          normalizeMoney(v, { decimals: 2, max: cartTotal }),
                        );
                        setZatcaTouched((t) => ({ ...t, docDiscount: true }));
                      }}
                      aria-invalid={zatcaTouched.docDiscount && !!zatcaValidation.docDiscount}
                    />
                    {zatcaTouched.docDiscount && zatcaValidation.docDiscount && (
                      <p className="text-xs text-destructive mt-0.5">{zatcaValidation.docDiscount}</p>
                    )}
                  </div>
                  <div>
                    <Label className="text-xs">Document surcharge (pre-VAT)</Label>
                    <Input
                      id="zatca-doc-surcharge"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      className="h-9"
                      placeholder="0.00"
                      value={docSurcharge}
                      onChange={(e) => setDocSurcharge(e.target.value)}
                      onBlur={() => {
                        setDocSurcharge((v) => normalizeMoney(v, { decimals: 2 }));
                        setZatcaTouched((t) => ({ ...t, docSurcharge: true }));
                      }}
                      aria-invalid={zatcaTouched.docSurcharge && !!zatcaValidation.docSurcharge}
                    />
                    {zatcaTouched.docSurcharge && zatcaValidation.docSurcharge && (
                      <p className="text-xs text-destructive mt-0.5">{zatcaValidation.docSurcharge}</p>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Document currency</Label>
                    <Select value={docCurrency} onValueChange={(v) => { setDocCurrency(v); setZatcaTouched((t) => ({ ...t, docFxRate: true })); }}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="SAR">SAR (Saudi Riyal)</SelectItem>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="EUR">EUR</SelectItem>
                        <SelectItem value="GBP">GBP</SelectItem>
                        <SelectItem value="AED">AED</SelectItem>
                        <SelectItem value="KWD">KWD</SelectItem>
                        <SelectItem value="BHD">BHD</SelectItem>
                        <SelectItem value="QAR">QAR</SelectItem>
                        <SelectItem value="OMR">OMR</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Rate to SAR</Label>
                    <Input
                      id="zatca-doc-fx-rate"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.00001"
                      className="h-9"
                      placeholder={docCurrency === "SAR" ? "1.00000" : "e.g. 3.75"}
                      value={docFxRate}
                      onChange={(e) => setDocFxRate(e.target.value)}
                      onBlur={() => {
                        setDocFxRate((v) =>
                          normalizeMoney(v, { decimals: 5, max: 1000 }),
                        );
                        setZatcaTouched((t) => ({ ...t, docFxRate: true }));
                      }}
                      disabled={docCurrency === "SAR"}
                      aria-invalid={zatcaTouched.docFxRate && !!zatcaValidation.docFxRate}
                    />
                    {zatcaTouched.docFxRate && zatcaValidation.docFxRate && (
                      <p className="text-xs text-destructive mt-0.5">{zatcaValidation.docFxRate}</p>
                    )}
                  </div>
                </div>
                {/* Live Payable in SAR preview */}
                <div className="rounded-md border bg-muted/30 p-3 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Subtotal ({docCurrency})</span>
                    <span className="font-medium tabular-nums">{formatCurrency(cartTotal)}</span>
                  </div>
                  {zatcaTotals.isForeign && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Rate to SAR</span>
                      <span className="font-medium tabular-nums">{zatcaTotals.fx.toFixed(5)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Subtotal (SAR)</span>
                    <span className="font-medium tabular-nums">{formatCurrency(zatcaTotals.subtotalSar)}</span>
                  </div>
                  {(parseFloat(docDiscount) || 0) > 0 && (
                    <div className="flex items-center justify-between text-destructive/80">
                      <span>Discount</span>
                      <span className="font-medium tabular-nums">−{formatCurrency(zatcaTotals.discountSar)}</span>
                    </div>
                  )}
                  {(parseFloat(docSurcharge) || 0) > 0 && (
                    <div className="flex items-center justify-between text-emerald-600">
                      <span>Surcharge</span>
                      <span className="font-medium tabular-nums">+{formatCurrency(zatcaTotals.surchargeSar)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Net taxable</span>
                    <span className="font-medium tabular-nums">{formatCurrency(zatcaTotals.netTaxable)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">VAT ({vatPercent}%)</span>
                    <span className="font-medium tabular-nums">{formatCurrency(zatcaTotals.vat)}</span>
                  </div>
                  <div className="h-px bg-border my-1" />
                  <div className="flex items-center justify-between font-semibold text-sm">
                    <span>Payable in SAR</span>
                    <span className="tabular-nums text-primary">{formatCurrency(zatcaTotals.payable)}</span>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Tax amounts are always reported in SAR per ZATCA. Discounts and surcharges adjust the VAT base.
                </p>
              </div>
            )}
          </div>
        </div>

        <Separator />

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full gap-2"
          disabled={cart.length === 0}
          onClick={() => {
            setZatcaTouched({
              buyerName: true, buyerVat: true, buyerIdValue: true,
              docDiscount: true, docSurcharge: true, docFxRate: true,
            });
            setLivePreviewOpen((v) => !v);
          }}
        >
          <Receipt className="h-4 w-4" />
          {livePreviewOpen ? "Hide" : "Preview"} UBL XML
          {livePreviewOpen ? (
            <ChevronUp className="h-4 w-4 ms-auto" />
          ) : (
            <ChevronDown className="h-4 w-4 ms-auto" />
          )}
        </Button>

        {livePreviewOpen && (
          <div className="rounded-md border bg-muted/20 p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-medium">
                <Receipt className="h-3.5 w-3.5 text-primary" />
                Live UBL 2.1 XML
                <span className="text-[10px] text-muted-foreground font-normal">
                  · updates as you type
                </span>
              </div>
              {liveUblPreview.xml && (
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {liveUblPreview.xml.length.toLocaleString()} chars ·{" "}
                  {(new Blob([liveUblPreview.xml]).size / 1024).toFixed(2)} KB
                </span>
              )}
            </div>

            {/* Validation issues - surface ZATCA errors before submission */}
            {hasZatcaErrors && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2.5 space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {Object.keys(zatcaValidation).length} validation issue
                  {Object.keys(zatcaValidation).length === 1 ? "" : "s"} to resolve
                </div>
                <ul className="text-[11px] text-destructive/90 space-y-0.5 ps-5 list-disc">
                  {Object.entries(zatcaValidation).map(([field, msg]) => (
                    <li key={field}>
                      <span className="font-medium">{field}:</span> {msg}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {liveUblPreview.error && !hasZatcaErrors && (
              <div className="rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/20 p-2.5 text-[11px] text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5" />
                {liveUblPreview.error}
              </div>
            )}

            {liveUblPreview.xml && (
              <>
                <div className="flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => {
                      navigator.clipboard.writeText(liveUblPreview.xml).then(
                        () => toast.success("XML copied to clipboard"),
                        () => toast.error("Could not copy to clipboard"),
                      );
                    }}
                  >
                    Copy
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => {
                      const blob = new Blob([liveUblPreview.xml], { type: "application/xml" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `ubl-preview-${format(new Date(), "yyyyMMdd-HHmmss")}.xml`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      setTimeout(() => URL.revokeObjectURL(url), 60_000);
                    }}
                  >
                    Download
                  </Button>
                </div>
                <ScrollArea
                  className={`h-[40vh] rounded-md border bg-background ${
                    hasZatcaErrors ? "border-destructive/40" : ""
                  }`}
                >
                  <pre className="p-3 text-[10.5px] leading-relaxed font-mono whitespace-pre-wrap break-all">
                    {liveUblPreview.xml}
                  </pre>
                </ScrollArea>
                <p className="text-[10px] text-muted-foreground">
                  UUID, ICV, and PIH shown here are placeholders; real values are assigned at submission time.
                </p>
              </>
            )}
          </div>
        )}
        </>
        )}
        </>
        )}
        </div>
        </ScrollArea>

        {/* Fixed action bar */}
        <div className="shrink-0 p-4 border-t border-border space-y-3 bg-background">
          {/* Debug: show the active branch context that will be used for unpaid posting */}
          {isUnpaidSale && (
            <div className="rounded-md border border-border bg-muted/30 p-2.5 space-y-1.5">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <Info className="h-3.5 w-3.5" />
                Posting context
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Branch</span>
                <span className="font-medium tabular-nums">
                  {activeBranch?.name ?? (
                    <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      No branch selected
                    </span>
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">branch_id</span>
                <code className="bg-muted rounded px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                  {activeBranchId ?? "null"}
                </code>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">restaurant_id</span>
                <code className="bg-muted rounded px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                  {restaurant?.id ?? "null"}
                </code>
              </div>
              {!activeBranchId && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400">
                  Offline unpaid sales will be blocked until a branch is selected.
                </p>
              )}
              <UnpaidOfflineQueueBanner lastQueuedReceipt={lastQueuedUnpaidReceipt} />
            </div>
          )}

          {linkedTable && (
            <div className="flex items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
              <span className="flex items-center gap-2">
                <UtensilsCrossed className="h-3.5 w-3.5 text-primary" />
                Ordering for <strong className="font-medium">Table {linkedTable.label}</strong>
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px]"
                onClick={() => {
                  setLinkedTable(null);
                  if (typeof window !== "undefined") {
                    const url = new URL(window.location.href);
                    url.searchParams.delete("table");
                    window.history.replaceState({}, "", url.toString());
                  }
                }}
              >
                Unlink
              </Button>
            </div>
          )}

          {!isUnpaidSale && (
            <div className="space-y-2">
              <Label>{t("app.pos.order.paymentMethod")}</Label>
              <div className="grid grid-cols-3 gap-2">
                <Button
                  variant={paymentMethod === "cash" ? "default" : "outline"}
                  className="gap-1 text-xs sm:text-sm sm:gap-2"
                  onClick={() => setPaymentMethod("cash")}
                >
                  <Banknote className="h-4 w-4" />
                  <span className="hidden sm:inline">{t("app.pos.order.cash")}</span>
                </Button>
                <Button
                  variant={paymentMethod === "card" ? "default" : "outline"}
                  className="gap-1 text-xs sm:text-sm sm:gap-2"
                  onClick={() => setPaymentMethod("card")}
                >
                  <CreditCard className="h-4 w-4" />
                  <span className="hidden sm:inline">{t("app.pos.order.card")}</span>
                </Button>
                <Button
                  variant={paymentMethod === "other" ? "default" : "outline"}
                  className="gap-1 text-xs sm:text-sm sm:gap-2"
                  onClick={() => setPaymentMethod("other")}
                >
                  <Wallet className="h-4 w-4" />
                  <span className="hidden sm:inline">{t("app.pos.order.other")}</span>
                </Button>
              </div>
            </div>
          )}

          {isUnpaidSale && unpaidPostError && (
            <Alert variant="destructive" role="alert" aria-live="assertive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{t("app.pos.order.unpaidPostFailed")}</AlertTitle>
              <AlertDescription className="text-xs">
                {unpaidPostError}
              </AlertDescription>
            </Alert>
          )}
          <Button
          size="lg"
          className="w-full"
          variant="default"
          disabled={cart.length === 0 || recordSaleMutation.isPending}
          onClick={async () => {
            // Reset any prior inline rejection so the alert only reflects
            // the outcome of *this* submit attempt.
            setUnpaidPostError(null);
            // Surface any latent blockers as a toast instead of failing
            // silently with a disabled button. Users were reporting "the
            // Add to Tab button does nothing" because the disable reason
            // was invisible.
            if (isUnpaidSale && !selectedCustomer) {
              const msg = "Pick a customer first - unpaid sales need a tab to attach to.";
              setUnpaidPostError(msg);
              toast.error(msg);
              return;
            }
            if (
              isUnpaidSale &&
              selectedCustomer &&
              selectedCustomerCreditLimit > 0 &&
              (selectedCustomerCurrentBalance + cartTotal) >
                selectedCustomerCreditLimit
            ) {
              const msg = `Sale would exceed ${selectedCustomer.name}'s credit limit of ${formatCurrency(selectedCustomerCreditLimit)}.`;
              setUnpaidPostError(msg);
              toast.error(msg, { duration: 8000 });
              return;
            }
            // Touch all ZATCA fields so any latent errors surface now.
            setZatcaTouched({
              buyerName: true,
              buyerVat: true,
              buyerIdValue: true,
              docDiscount: true,
              docSurcharge: true,
              docFxRate: true,
            });
            if (hasZatcaErrors) {
              toast.error("Please fix the ZATCA validation errors before recording the sale.");
              return;
            }
            // STRICT mode pre-check: refuse to record the sale if we can't
            // produce a compliant ZATCA artifact. Phase 1 = QR + PDF.
            if (
              zatcaSettings?.qr_enabled &&
              zatcaSettings?.pdf_generation_mode === "STRICT"
            ) {
              const probe = buildZatcaSnapshot(
                zatcaSettings,
                { subtotal: cartTotal, tax: 0, total: cartTotal },
                "digital",
              );
              if (!probe || !probe.qrBase64) {
                toast.error(
                  "Sale blocked (STRICT): complete seller name and 15-digit VAT in Settings → ZATCA, or switch ZATCA to SOFT mode.",
                );
                return;
              }
              if (!zatcaSettings.auto_generate_pdf_receipt) {
                toast.error(
                  "Sale blocked (STRICT): enable auto-PDF receipt in Settings → ZATCA.",
                );
                return;
              }
            }
            void ensureOfflineBootstrapped(activeBranchId ?? null);
            if (isUnpaidSale) {
              void logUnpaidPosting({
                event: "attempted",
                restaurantId: restaurant?.id,
                branchId: activeBranchId,
                userId: user?.id,
                customerId: selectedCustomer?.id ?? null,
                cartTotal: cartTotal,
              });
            }
            recordSaleMutation.mutate();
            if (useDrawerCart) setCartDrawerOpen(false);
          }}
        >
          {recordSaleMutation.isPending 
            ? t("app.pos.order.processing") 
            : isUnpaidSale 
              ? t("app.pos.order.addToTab", { customer: selectedCustomer?.name || t("app.pos.order.customerFallback"), total: formatCurrency(cartTotal) })
              : t("app.pos.order.record", { total: formatCurrency(cartTotal) })}
        </Button>
        </div>

        {/* Unpaid - Pending Settlement dialog */}
        <Dialog open={unpaidDialogOpen} onOpenChange={setUnpaidDialogOpen}>
          <DialogContent className="max-w-md max-h-[90vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle>{t("app.pos.order.pendingSettlement")}</DialogTitle>
            </DialogHeader>
            <ScrollArea className="flex-1 -mx-6 px-6">
              <div className="space-y-4 py-2">
                <div className="flex items-center justify-between rounded-md border border-border p-3">
                  <Label className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={isUnpaidSale}
                      onChange={(e) => {
                        setIsUnpaidSale(e.target.checked);
                        if (!e.target.checked) {
                          setSelectedCustomer(null);
                          setShowCustomerSelect(false);
                          setIsBackdated(false);
                        }
                      }}
                      className="h-4 w-4 rounded border-border"
                    />
                    <span>{t("app.pos.order.markUnpaid")}</span>
                  </Label>
                </div>

                {isUnpaidSale && (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">{t("app.pos.order.selectCustomer")}</Label>
                      {selectedCustomer ? (
                        <div className="flex items-center justify-between p-2 bg-muted rounded-md">
                          <div className="flex items-center gap-2">
                            <User className="h-4 w-4 text-primary" />
                            <div>
                              <p className="text-sm font-medium">{selectedCustomer.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {t("app.pos.order.balance")}: {formatCurrency(selectedCustomer.current_balance)} / {formatCurrency(selectedCustomer.credit_limit)}
                              </p>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setSelectedCustomer(null);
                              setShowCustomerSelect(true);
                            }}
                          >
                            {t("app.pos.order.change")}
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="relative">
                            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                              placeholder={t("app.pos.order.searchCustomer")}
                              value={customerSearchTerm}
                              onChange={(e) => setCustomerSearchTerm(e.target.value)}
                              onFocus={() => setShowCustomerSelect(true)}
                              className="ps-10 h-9"
                            />
                          </div>
                          {showCustomerSelect && (
                            <div className="max-h-48 overflow-y-auto border rounded-md bg-background">
                              {filteredCustomers.length === 0 ? (
                                <p className="text-xs text-muted-foreground p-2 text-center">{t("app.pos.order.noCustomers")}</p>
                              ) : (
                                filteredCustomers.map((customer) => (
                                  <button
                                    key={customer.id}
                                    className="w-full text-start p-2 hover:bg-accent flex items-center justify-between border-b last:border-b-0"
                                    onClick={() => {
                                      setSelectedCustomer(customer);
                                      setShowCustomerSelect(false);
                                      setCustomerSearchTerm("");
                                    }}
                                  >
                                    <div>
                                      <p className="text-sm font-medium">{customer.name}</p>
                                      <p className="text-xs text-muted-foreground">{customer.phone || t("app.pos.order.noPhone")}</p>
                                    </div>
                                    <span className="text-xs text-muted-foreground">
                                      {formatCurrency(customer.current_balance)} / {formatCurrency(customer.credit_limit)}
                                    </span>
                                  </button>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      {selectedCustomer && selectedCustomerCreditLimit > 0 &&
                       (selectedCustomerCurrentBalance + cartTotal) > selectedCustomerCreditLimit && (
                        <p className="text-xs text-destructive flex items-center gap-1">
                          <span>⚠️</span>
                          {t("app.pos.order.creditLimitWarning")}
                        </p>
                      )}
                    </div>

                    <div className="pt-2 border-t border-border/50">
                      <Label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isBackdated}
                          onChange={(e) => setIsBackdated(e.target.checked)}
                          className="h-4 w-4 rounded border-border"
                        />
                        <span className="text-sm">{t("app.pos.order.backdate")}</span>
                      </Label>

                      {isBackdated && (
                        <div className="mt-3 space-y-3">
                          <div className="flex gap-2">
                            <div className="flex-1">
                              <Label className="text-xs text-muted-foreground mb-1 block">{t("app.pos.order.date")}</Label>
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="w-full justify-start text-start font-normal h-9"
                                  >
                                    <Calendar className="me-2 h-4 w-4" />
                                    {format(backdatedDate, "MMM dd, yyyy")}
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                  <CalendarComponent
                                    mode="single"
                                    selected={backdatedDate}
                                    onSelect={(date) => date && setBackdatedDate(date)}
                                    disabled={(date) => date > new Date()}
                                    initialFocus
                                  />
                                </PopoverContent>
                              </Popover>
                            </div>
                            <div className="w-24">
                              <Label className="text-xs text-muted-foreground mb-1 block">{t("app.pos.order.time")}</Label>
                              <Input
                                type="time"
                                value={backdatedTime}
                                onChange={(e) => setBackdatedTime(e.target.value)}
                                className="h-9"
                              />
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Transaction will be recorded as {format(backdatedDate, "MMM dd, yyyy")} at {backdatedTime}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
            <div className="pt-2 border-t border-border flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setUnpaidDialogOpen(false)}>
                {t("app.pos.order.done")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );

  return (
    <AppLayout>
      <DemoExpiredLock>
      <div className="h-[calc(100vh-4rem)] flex flex-col">
        {/* Minimal POS Header — IBM Windows POS style */}
        <div
          className={`flex items-center gap-3 px-3 md:px-4 border-b border-border bg-background overflow-hidden transition-all duration-200 ${
            posBarCollapsed ? "h-8" : "h-12"
          }`}
        >
          {posBarCollapsed ? (
            <>
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                 {t(`app.pos.saleModes.${saleMode}`, { defaultValue: saleMode })}
                <span className="mx-2 opacity-40">·</span>
                {leftPanelTab === "menu" ? t("app.pos.tabs.menu") : t("app.pos.tabs.expense")}
              </span>
              {/* Compact live info beside MENU */}
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  {activeShifts.length > 0 ? (
                    <>
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      <span className="hidden sm:inline">{t("app.pos.shiftLabel", { id: activeShifts[0].id.slice(0, 8) })}</span>
                      <span className="sm:hidden font-semibold">Shift</span>
                    </>
                  ) : (
                    <>
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                      <span className="hidden sm:inline">{t("app.pos.noActiveShift")}</span>
                      <span className="sm:hidden">No shift</span>
                    </>
                  )}
                </span>
                <span className="opacity-40">·</span>
                <span className="flex items-center gap-1 font-semibold text-foreground">
                  <ShoppingBag className="h-3 w-3" />
                  {cart.length}
                </span>
                <span className="opacity-40">·</span>
                <span className="font-semibold text-foreground tabular-nums">
                  {formatCurrency(cartTotal)}
                </span>
                {selectedCustomer?.name && (
                  <>
                    <span className="opacity-40 hidden md:inline">·</span>
                    <span className="hidden md:inline truncate max-w-[160px]">{selectedCustomer.name}</span>
                  </>
                )}
              </div>
              <button
                onClick={togglePosBar}
                 className="ms-auto h-6 w-6 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground"
                aria-label="Expand POS toolbar"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <>
          {/* Order type dropdown */}
          <Select value={saleMode} onValueChange={(v) => updateSaleMode(v as SaleMode)}>
            <SelectTrigger className="hidden md:flex h-9 w-[160px] text-xs font-semibold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {([
                 { id: "dine_in", label: t("app.pos.saleModes.dine_in"), Icon: UtensilsCrossed },
                 { id: "takeaway", label: t("app.pos.saleModes.takeaway"), Icon: ShoppingBag },
                 { id: "delivery", label: t("app.pos.saleModes.delivery"), Icon: Bike },
                 { id: "held", label: t("app.pos.saleModes.held"), Icon: PauseCircle },
              ] as { id: SaleMode; label: string; Icon: typeof UtensilsCrossed }[]).map(({ id, label, Icon }) => (
                <SelectItem key={id} value={id}>
                  <span className="flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Menu / Expense pill toggle */}
          <div className="flex items-center bg-muted/50 rounded-lg p-0.5 h-9">
            <button
              onClick={() => setLeftPanelTab("menu")}
              className={`h-8 px-3 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all ${
                leftPanelTab === "menu"
                  ? "bg-background text-primary shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Receipt className="h-3.5 w-3.5" />
              {t("app.pos.tabs.menu")}
            </button>
            <button
              onClick={() => setLeftPanelTab("expenses")}
              className={`h-8 px-3 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all ${
                leftPanelTab === "expenses"
                  ? "bg-background text-primary shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Wallet className="h-3.5 w-3.5" />
              {t("app.pos.tabs.expense")}
            </button>
          </div>

          {/* Shift status — compact */}
           <div className="hidden lg:flex items-center text-[11px] text-muted-foreground ms-1">
            {activeShifts.length > 0 ? (
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {t("app.pos.shiftLabel", { id: activeShifts[0].id.slice(0, 8) })}
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                {t("app.pos.noActiveShift")}
              </span>
            )}
          </div>

           <div className="ms-auto flex items-center gap-2">
            {/* Grid columns toggle - desktop only */}
            {!useDrawerCart && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={cycleGridColumns}
                    className="gap-1.5 h-9"
                  >
                    {gridColumns <= 3 ? <Grid2X2 className="h-4 w-4" /> :
                     gridColumns <= 4 ? <Grid3X3 className="h-4 w-4" /> :
                     <LayoutGrid className="h-4 w-4" />}
                    <span className="text-xs font-medium">{gridColumns}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t("app.pos.gridColumns", { count: gridColumns })}</p>
                </TooltipContent>
              </Tooltip>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsQRScannerOpen(true)}
              className="gap-1.5 h-9"
            >
              <QrCode className="h-4 w-4" />
              <span className="hidden xl:inline">{t("app.pos.scanQr")}</span>
            </Button>
            <CashDrawerControl size="sm" />
            <PosDayEndAdjustmentButton />
            {/* Mobile/Tablet Cart Button */}
            {useDrawerCart && (
              <Drawer open={cartDrawerOpen} onOpenChange={setCartDrawerOpen}>
                <DrawerTrigger asChild>
                  <Button size="sm" className="gap-2 relative">
                    <ShoppingCart className="h-4 w-4" />
                    {cart.length > 0 && (
                      <Badge className="absolute -top-2 -right-2 h-5 w-5 p-0 flex items-center justify-center text-xs">
                        {cart.reduce((sum, item) => sum + item.quantity, 0)}
                      </Badge>
                    )}
                  </Button>
                </DrawerTrigger>
                <DrawerContent className="max-h-[85vh]">
                  <DrawerHeader className="border-b">
                    <DrawerTitle className="flex items-center gap-2">
                      <ShoppingCart className="h-5 w-5 text-primary" />
                      {t("app.pos.cart.title")}
                      {cartNotification ? (
                       <span className="flex items-center gap-1 text-xs font-normal text-primary ms-2 animate-pulse">
                          <CheckCircle2 className="h-3 w-3" />
                          {cartNotification}
                        </span>
                      ) : cart.length > 0 ? (
                       <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground ms-2">
                          <Cloud className="h-3 w-3 text-green-500" />
                          {t("app.pos.cart.saved")}
                        </span>
                      ) : null}
                       <Badge variant="secondary" className="ms-auto">
                        {t("app.pos.cart.items", { count: cart.reduce((sum, item) => sum + item.quantity, 0) })}
                      </Badge>
                    </DrawerTitle>
                  </DrawerHeader>
                  <div className="flex flex-col max-h-[calc(85vh-4rem)]">
                    <CartContent />
                  </div>
                </DrawerContent>
              </Drawer>
            )}
            {/* Collapse toggle for the POS top bar */}
            <button
              onClick={togglePosBar}
              className="h-8 w-8 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground"
              aria-label="Collapse POS toolbar"
              title="Collapse toolbar"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
          </div>
            </>
          )}
        </div>

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Panel - Menu & Expenses */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <Tabs
              value={leftPanelTab}
              onValueChange={(v) => setLeftPanelTab(v as "menu" | "expenses")}
              className="flex-1 flex flex-col min-h-0"
            >
              {/* Tab switcher promoted to top bar; keeping Tabs root for content panels */}

              {/* Menu Tab */}
              <TabsContent value="menu" className="flex-1 flex flex-col min-h-0 overflow-hidden mt-0 px-3 pt-2 pb-3 md:p-4 data-[state=inactive]:hidden">
                {/* Touch-Friendly Search (collapsible) */}
                {searchBarCollapsed ? (
                  <button
                    onClick={toggleSearchBar}
                    className="flex-shrink-0 mb-2 w-full h-9 flex items-center gap-2 px-3 rounded-lg border border-border bg-muted/40 hover:bg-muted text-start transition-colors"
                    aria-label="Expand search"
                  >
                    <Search className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground flex-1 truncate">
                      {searchTerm ? searchTerm : t("app.pos.search.items")}
                    </span>
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-primary truncate max-w-[140px]">
                      {selectedCategory === "all"
                        ? t("app.pos.order.all")
                        : selectedCategory === "top-selling"
                          ? "🔥 Top"
                          : selectedCategory}
                    </span>
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  </button>
                ) : (
                <div className="flex-shrink-0 mb-2 space-y-2">
                  {/* Main Search Input + Categories inline */}
                  <div className="relative flex gap-2 items-center">
                    <div className="relative w-56 md:w-64 flex-shrink-0">
                      <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                      <Input
                        placeholder={t("app.pos.search.items")}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="ps-11 pe-10 h-12 text-base rounded-xl border-2 focus:border-primary"
                      />
                      {searchTerm && (
                        <button
                          onClick={() => setSearchTerm("")}
                          className="absolute end-3 top-1/2 -translate-y-1/2 h-7 w-7 flex items-center justify-center rounded-full bg-muted hover:bg-destructive/10 hover:text-destructive transition-colors"
                          aria-label="Clear search"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    {(() => {
                      const tileVariant = ((posHardware as { pos_layout_template?: PosLayoutTemplate })?.pos_layout_template ?? "classic_dense");
                      return (
                        <div className="flex-1 min-w-0 overflow-x-auto">
                          <div className="flex gap-2 pb-1 items-center">
                            <CategoryIconTile
                              variant={tileVariant}
                               label={t("app.pos.order.all")}
                              Icon={UtensilsCrossed}
                              active={selectedCategory === "all"}
                              onClick={() => setSelectedCategory("all")}
                            />
                            {topSellingItems.length > 0 && (
                              <CategoryIconTile
                                variant={tileVariant}
                                 label={t("app.pos.order.topSelling")}
                                Icon={categoryIcon("top-selling")}
                                active={selectedCategory === "top-selling"}
                                onClick={() => setSelectedCategory("top-selling")}
                              />
                            )}
                            {categories.map((cat) => (
                              <CategoryIconTile
                                key={cat}
                                variant={tileVariant}
                                label={cat}
                                Icon={categoryIcon(cat)}
                                active={selectedCategory === cat}
                                onClick={() => setSelectedCategory(cat)}
                              />
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                    <button
                      onClick={toggleSearchBar}
                      className="h-12 w-12 flex-shrink-0 rounded-xl border-2 border-border hover:bg-muted flex items-center justify-center text-muted-foreground"
                      aria-label="Collapse search"
                      title="Collapse search"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                  </div>
                  
                  {/* Quick Letter Filter - Touch Friendly */}
                  <div className="flex gap-1 overflow-x-auto pb-1 -mx-3 px-3">
                    {['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'].map((letter) => (
                      <button
                        key={letter}
                        onClick={() => setSearchTerm(prev => prev + letter.toLowerCase())}
                        className="flex-shrink-0 h-9 w-9 rounded-lg text-sm font-semibold transition-all active:scale-95 bg-muted/50 text-muted-foreground hover:bg-muted active:bg-primary/20"
                      >
                        {letter}
                      </button>
                    ))}
                  </div>
                </div>
                )}

                {((posHardware as { pos_layout_template?: PosLayoutTemplate })?.pos_layout_template ?? "classic_dense") === "classic_dense" ? (
                <>
                {/* Menu Items Grid */}
                <ScrollArea className="flex-1 min-h-0">
                  <div className="space-y-4 md:space-y-8 pb-4">
                    {Object.entries(groupedItems).map(([category, items]) => (
                      <div key={category}>
                        <h3 className="text-[10px] md:text-xs font-semibold text-primary uppercase tracking-widest mb-2 md:mb-4 flex items-center gap-2">
                          <span className="h-px flex-1 bg-border" />
                          {category}
                          <span className="h-px flex-1 bg-border" />
                        </h3>
                        <div className={getGridColsClass()}>
                          {items.map((item) => (
                            <div
                              key={item.id}
                              className="group bg-card rounded-xl overflow-hidden border border-border hover:border-primary/50 hover:shadow-lg transition-all duration-200"
                            >
                              {/* Large Image */}
                              <div className="relative w-full pt-[70%] bg-muted overflow-hidden">
                                {item.image_url ? (
                                  <img
                                    src={toCdnUrl(item.image_url) || ""}
                                    alt={item.name}
                                    className="absolute inset-0 w-full h-full object-contain"
                                  />
                                ) : (
                                  <div className="absolute inset-0 w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-muted/50">
                                    <UtensilsCrossed className="h-10 w-10 text-muted-foreground/40" />
                                  </div>
                                )}
                              </div>
                              
                              {/* Content */}
                              <div className="p-2">
                                {/* Item Name */}
                                <p className="font-medium text-xs line-clamp-2 mb-1.5 min-h-[1.75rem]" title={item.name}>
                                  {item.name}
                                </p>
                                
                                {/* Price variant buttons or Add button */}
                                {hasVariantPrices(item) ? (
                                  <div className={getVariantGridClass(item)}>
                                    {item.quarter_price > 0 && (
                                      useDrawerCart ? (
                                        <button
                                          onClick={() => addToCart(item, "quarter")}
                                           title={`${t("app.pos.order.quarter")}: ${formatCurrency(item.quarter_price)}`}
                                          className="py-1.5 px-1 rounded-md border border-border bg-background hover:border-primary hover:bg-primary/5 active:bg-primary/10 active:scale-95 transition-all text-center min-w-0 overflow-hidden touch-manipulation"
                                        >
                                           {countVariantPrices(item) > 1 && <p className="text-[7px] text-muted-foreground font-medium uppercase truncate">{t("app.pos.recorder.quarter")}</p>}
                                          <p className="text-[8px] font-semibold truncate">{formatCurrency(item.quarter_price)}</p>
                                        </button>
                                      ) : (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <button
                                              onClick={() => addToCart(item, "quarter")}
                                              className="py-1 px-0.5 rounded-md border border-border bg-background hover:border-primary hover:bg-primary/5 active:bg-primary/10 transition-colors text-center min-w-0 overflow-hidden"
                                            >
                                               {countVariantPrices(item) > 1 && <p className="text-[7px] text-muted-foreground font-medium uppercase truncate">{t("app.pos.recorder.quarter")}</p>}
                                              <p className="text-[8px] font-semibold truncate">{formatCurrency(item.quarter_price)}</p>
                                            </button>
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            <p>Quarter: {formatCurrency(item.quarter_price)}</p>
                                          </TooltipContent>
                                        </Tooltip>
                                      )
                                    )}
                                    {item.half_price > 0 && (
                                      useDrawerCart ? (
                                        <button
                                          onClick={() => addToCart(item, "half")}
                                           title={`${t("app.pos.order.half")}: ${formatCurrency(item.half_price)}`}
                                          className="py-1.5 px-1 rounded-md border border-border bg-background hover:border-primary hover:bg-primary/5 active:bg-primary/10 active:scale-95 transition-all text-center min-w-0 overflow-hidden touch-manipulation"
                                        >
                                           {countVariantPrices(item) > 1 && <p className="text-[7px] text-muted-foreground font-medium uppercase truncate">{t("app.pos.recorder.half")}</p>}
                                          <p className="text-[8px] font-semibold truncate">{formatCurrency(item.half_price)}</p>
                                        </button>
                                      ) : (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <button
                                              onClick={() => addToCart(item, "half")}
                                              className="py-1 px-0.5 rounded-md border border-border bg-background hover:border-primary hover:bg-primary/5 active:bg-primary/10 transition-colors text-center min-w-0 overflow-hidden"
                                            >
                                               {countVariantPrices(item) > 1 && <p className="text-[7px] text-muted-foreground font-medium uppercase truncate">{t("app.pos.recorder.half")}</p>}
                                              <p className="text-[8px] font-semibold truncate">{formatCurrency(item.half_price)}</p>
                                            </button>
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            <p>Half: {formatCurrency(item.half_price)}</p>
                                          </TooltipContent>
                                        </Tooltip>
                                      )
                                    )}
                                    {item.full_price > 0 && (
                                      useDrawerCart ? (
                                        <button
                                          onClick={() => addToCart(item, "full")}
                                           title={`${t("app.pos.order.full")}: ${formatCurrency(item.full_price)}`}
                                          className="py-1.5 px-1 rounded-md border border-primary/30 bg-primary/5 hover:border-primary hover:bg-primary/10 active:bg-primary/20 active:scale-95 transition-all text-center min-w-0 overflow-hidden touch-manipulation"
                                        >
                                           {countVariantPrices(item) > 1 && <p className="text-[7px] text-primary font-medium uppercase truncate">{t("app.pos.recorder.full")}</p>}
                                          <p className="text-[8px] font-semibold text-primary truncate">{formatCurrency(item.full_price)}</p>
                                        </button>
                                      ) : (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <button
                                              onClick={() => addToCart(item, "full")}
                                              className="py-1 px-0.5 rounded-md border border-primary/30 bg-primary/5 hover:border-primary hover:bg-primary/10 active:bg-primary/20 transition-colors text-center min-w-0 overflow-hidden"
                                            >
                                               {countVariantPrices(item) > 1 && <p className="text-[7px] text-primary font-medium uppercase truncate">{t("app.pos.recorder.full")}</p>}
                                              <p className="text-[8px] font-semibold text-primary truncate">{formatCurrency(item.full_price)}</p>
                                            </button>
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            <p>Full: {formatCurrency(item.full_price)}</p>
                                          </TooltipContent>
                                        </Tooltip>
                                      )
                                    )}
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => addToCart(item, "regular")}
                                    className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors"
                                  >
                                    <Plus className="h-3.5 w-3.5" />
                                    <span className="text-xs font-medium">{formatCurrency(item.selling_price)}</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}

                    {/* Combo Packages Section */}
                    {filteredCombos.length > 0 && (
                      <div>
                        <h3 className="text-[10px] md:text-xs font-semibold text-primary uppercase tracking-widest mb-2 md:mb-4 flex items-center gap-2">
                          <span className="h-px flex-1 bg-border" />
                           {t("app.pos.order.combos")}
                          <span className="h-px flex-1 bg-border" />
                        </h3>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 md:gap-4">
                          {filteredCombos.map((combo) => (
                            <div
                              key={combo.id}
                              className="group bg-card rounded-lg md:rounded-xl border border-border p-2 md:p-4 hover:border-primary/50 hover:shadow-md transition-all duration-200"
                            >
                              {/* Combo Header */}
                              <div className="flex items-center gap-2 md:gap-3 mb-2 md:mb-3">
                                <div className="h-8 w-8 md:h-10 md:w-10 rounded-lg bg-accent/50 flex items-center justify-center flex-shrink-0">
                                  <Package className="h-4 w-4 md:h-5 md:w-5 text-primary" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <h4 className="font-medium md:font-semibold text-xs md:text-sm text-foreground truncate leading-tight">
                                    {combo.name}
                                  </h4>
                                  <p className="text-[10px] md:text-xs text-muted-foreground line-clamp-1 leading-tight">
                                    {combo.description || "Combo"}
                                  </p>
                                </div>
                              </div>
                              
                              {/* Add Combo Button */}
                              <button
                                onClick={() => addComboToCart(combo)}
                                className="w-full flex items-center justify-center gap-1 md:gap-2 py-2 md:py-2.5 px-2 md:px-3 rounded-md md:rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors"
                              >
                                <Plus className="h-3.5 w-3.5 md:h-4 md:w-4" />
                                <span className="text-xs md:text-sm font-medium">{formatCurrency(combo.price)}</span>
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {Object.keys(groupedItems).length === 0 && filteredCombos.length === 0 && (
                      <div className="text-center py-16 text-muted-foreground">
                        <UtensilsCrossed className="h-12 w-12 mx-auto mb-3 opacity-30" />
                         <p className="font-medium">{t("app.pos.order.noMenuItems")}</p>
                         <p className="text-sm">{t("app.pos.order.adjustSearch")}</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
                </>
                ) : (
                  (() => {
                    const tpl = (posHardware as { pos_layout_template?: PosLayoutTemplate }).pos_layout_template as PosLayoutTemplate;
                    const Layout =
                      tpl === "showcase" ? ShowcaseLayout :
                      tpl === "kiosk_grid" ? KioskGridLayout :
                      tpl === "poscom_card" ? PosComCardLayout :
                      CompactListLayout;
                    const combosFooter = (
                      <>
                        {filteredCombos.length > 0 && (
                          <div>
                            <h3 className="text-xs font-semibold text-primary uppercase tracking-widest mb-3 flex items-center gap-2">
                              <span className="h-px flex-1 bg-border" />
                               {t("app.pos.order.combos")}
                              <span className="h-px flex-1 bg-border" />
                            </h3>
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                              {filteredCombos.map((combo) => (
                                <div key={combo.id} className="bg-card rounded-xl border border-border p-3 hover:border-primary/50 transition-all">
                                  <div className="flex items-center gap-2 mb-2">
                                    <div className="h-9 w-9 rounded-lg bg-accent/50 flex items-center justify-center flex-shrink-0">
                                      <Package className="h-4 w-4 text-primary" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <h4 className="font-semibold text-sm truncate">{combo.name}</h4>
                                      <p className="text-[11px] text-muted-foreground line-clamp-1">{combo.description || "Combo"}</p>
                                    </div>
                                  </div>
                                  <button
                                    onClick={() => addComboToCart(combo)}
                                    className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all"
                                  >
                                    <Plus className="h-4 w-4" />
                                    <span className="text-sm font-medium">{formatCurrency(combo.price)}</span>
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {Object.keys(groupedItems).length === 0 && filteredCombos.length === 0 && (
                          <div className="text-center py-16 text-muted-foreground">
                            <UtensilsCrossed className="h-12 w-12 mx-auto mb-3 opacity-30" />
                             <p className="font-medium">{t("app.pos.order.noMenuItems")}</p>
                             <p className="text-sm">{t("app.pos.order.adjustSearch")}</p>
                          </div>
                        )}
                      </>
                    );
                    return (
                      <Layout
                        categories={categories}
                        selectedCategory={selectedCategory}
                        setSelectedCategory={setSelectedCategory}
                        groupedItems={groupedItems as never}
                        addToCart={addToCart as never}
                        hasVariantPrices={hasVariantPrices as never}
                        formatCurrency={formatCurrency}
                        footer={combosFooter}
                        config={{ ...((posHardware as { pos_layout_config?: import("@/components/pos/POSAlternateLayouts").PosLayoutConfig })?.pos_layout_config ?? {}), showCategoryStrip: false }}
                        gridColumns={gridColumns}
                      />
                    );
                  })()
                )}
              </TabsContent>

              {/* Expenses Tab */}
              <TabsContent
                ref={expensesTabRef}
                value="expenses"
                className="flex-1 mt-0 overflow-y-auto data-[state=inactive]:hidden"
              >
                <div className="px-3 pt-0 pb-3 md:p-4 md:pt-0">
                  <Card>
                    <CardHeader className="p-3 md:p-4 pb-2">
                      <CardTitle className="text-sm md:text-base">Record Expense</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 p-3 md:p-4 pt-0">
                      <div className="grid grid-cols-2 gap-2 md:gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Amount</Label>
                          <Input
                            type="number"
                            placeholder="0.00"
                            value={expenseAmount}
                            onChange={(e) => setExpenseAmount(e.target.value)}
                            className="h-9"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Date</Label>
                          <Input
                            type="date"
                            value={expenseDate}
                            onChange={(e) => setExpenseDate(e.target.value)}
                            className="h-9"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 md:gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Category</Label>
                          <Select value={expenseCategoryId} onValueChange={setExpenseCategoryId}>
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder="Select category" />
                            </SelectTrigger>
                            <SelectContent>
                              {expenseCategories.map((cat) => (
                                <SelectItem key={cat.id} value={cat.id}>
                                  {cat.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Payment Status</Label>
                          <Select value={expenseStatus} onValueChange={(v) => setExpenseStatus(v as 'paid' | 'unpaid')}>
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="paid">
                                <span className="flex items-center gap-2">
                                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                                  Paid
                                </span>
                              </SelectItem>
                              <SelectItem value="unpaid">
                                <span className="flex items-center gap-2">
                                  <Clock className="h-3.5 w-3.5 text-amber-500" />
                                  Unpaid
                                </span>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Description (optional)</Label>
                        <Input
                          placeholder="Description..."
                          value={expenseDescription}
                          onChange={(e) => setExpenseDescription(e.target.value)}
                          className="h-9"
                        />
                      </div>
                      {restaurant?.id && (
                        <ReceiptUploader
                          receiptUrl={expenseReceiptUrl}
                          onReceiptChange={setExpenseReceiptUrl}
                          restaurantId={restaurant.id}
                          disabled={addExpenseMutation.isPending}
                          onUploadingChange={setIsReceiptUploading}
                        />
                      )}
                      <Button
                        className="w-full h-10"
                        disabled={!expenseAmount || addExpenseMutation.isPending || isReceiptUploading}
                        onClick={() => addExpenseMutation.mutate()}
                      >
                        {isReceiptUploading ? "Uploading receipt..." : addExpenseMutation.isPending ? "Recording..." : "Record Expense"}
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Right Panel - Cart (Desktop only, not on tablet) */}
          {!useDrawerCart && (
            <div className="w-80 xl:w-96 flex flex-col bg-muted/30 border-s border-border">
              <div className="p-4 border-b border-border">
                <div className="flex items-center gap-2">
                  <ShoppingCart className="h-5 w-5 text-primary" />
                  <h2 className="font-semibold">{t("app.pos.cart.title")}</h2>
                  {cartNotification ? (
                    <span className="flex items-center gap-1 text-xs text-primary animate-pulse">
                      <CheckCircle2 className="h-3 w-3" />
                      {cartNotification}
                    </span>
                  ) : cart.length > 0 ? (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Cloud className="h-3 w-3 text-green-500" />
                      {t("app.pos.cart.saved")}
                    </span>
                  ) : null}
                  <Badge variant="secondary" className="ms-auto">
                    {t("app.pos.cart.items", { count: cart.reduce((sum, item) => sum + item.quantity, 0) })}
                  </Badge>
                </div>
              </div>
              <CartContent />
            </div>
          )}

        </div>
      </div>

      {/* QR Scanner Dialog */}
      <QRScanner
        isOpen={isQRScannerOpen}
        onClose={() => setIsQRScannerOpen(false)}
        onScan={handleQRScan}
        restaurantId={restaurant?.id || ""}
      />
      </DemoExpiredLock>
    </AppLayout>
  );
}
