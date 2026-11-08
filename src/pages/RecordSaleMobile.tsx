import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Capacitor } from "@capacitor/core";
import {
  ShoppingBag,
  Plus,
  Minus,
  Search,
  X,
  Banknote,
  CreditCard,
  MoreHorizontal,
  Check,
  Loader2,
  ArrowLeft,
  Flame,
  Star,
  Grid3x3,
  QrCode,
  Printer,
  Settings,
  User,
  LogOut,
  Wifi,
  WifiOff,
  ShieldCheck,
  ShieldAlert,
  Database,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  Receipt,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { toCdnUrl } from "@/lib/imageCdn";

import { MatbexLogo } from "@/components/brand/MatbexLogo";
import { useAuth } from "@/contexts/AuthContext";
import { useBranchPrices } from "@/hooks/useBranchPrices";
import { useMenuPriceSync } from "@/hooks/useMenuPriceSync";
import { AdminPinDialog } from "@/components/pos/AdminPinDialog";
import { EmergencyKioskUnlockDialog } from "@/components/pos/EmergencyKioskUnlockDialog";
import { KioskWifiDialog } from "@/components/pos/KioskWifiDialog";
import { recordOfflineSale } from "@/lib/offline/posService";
import { isOnline } from "@/lib/offline/connectivity";
import { useCurrency } from "@/hooks/useCurrency";
import { supabase } from "@/integrations/supabase/client";
import { prefetchImages, getCachedImageSrc, rememberImage } from "@/lib/offline/imageCache";
import { PendingSyncBadge } from "@/components/pos/PendingSyncBadge";
import { RecordExpenseDialog } from "@/components/expenses/RecordExpenseDialog";
import { lineGross, roundMoney, splitListed, sumMoney } from "@/lib/vatInclusive";
import { useBranchVatRate } from "@/hooks/useBranchVatRate";
import { useBranch } from "@/contexts/BranchContext";
import { usePosGridColumns } from "@/hooks/usePosGridColumns";
import { PullToRefresh } from "@/components/pos/PullToRefresh";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Image with graceful fallback when src fails to load (e.g. offline mode,
 * expired signed URLs, deleted storage objects). Avoids the browser's
 * default broken-image icon.
 */
function MenuImage({
  src,
  alt,
  fallback,
}: {
  src?: string | null;
  alt: string;
  fallback: React.ReactNode;
}) {
  const [errored, setErrored] = useState(false);
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);

  useEffect(() => {
    setErrored(false);
    setResolvedSrc(null);
    if (!src) return;
    let revokeFn: (() => void) | undefined;
    let cancelled = false;
    getCachedImageSrc(src).then(({ src: s, revoke }) => {
      if (cancelled) {
        revoke?.();
        return;
      }
      revokeFn = revoke;
      setResolvedSrc(s);
    });
    return () => {
      cancelled = true;
      revokeFn?.();
    };
  }, [src]);

  if (!src || errored) return <>{fallback}</>;
  if (!resolvedSrc) {
    return <div className="h-full w-full bg-muted/40" aria-hidden />;
  }
  return (
    <img
      src={resolvedSrc}
      alt={alt}
      className="h-full w-full object-cover"
      loading="lazy"
      onLoad={() => {
        // Opportunistically cache the original URL so it works offline next time.
        if (src && resolvedSrc === src) void rememberImage(src);
      }}
      onError={() => setErrored(true)}
    />
  );
}

interface MenuItem {
  id: string;
  name: string;
  category: string | null;
  selling_price: number;
  quarter_price?: number | null;
  half_price?: number | null;
  full_price?: number | null;
  image_url?: string | null;
  is_chefs_special?: boolean | null;
}

type Variant = "quarter" | "half" | "full" | "default";

interface CartLine {
  key: string;
  id: string;
  name: string;
  variant: Variant;
  price: number;
  qty: number;
  image_url?: string | null;
}

type PaymentMethod = "cash" | "card" | "other";

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  credit_limit: number;
  current_balance: number;
}

const ALL = "__all__";
const ONLINE_WRITE_TIMEOUT_MS = 8000;

export default function RecordSaleMobile() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { restaurant, user, signOut, hasRole } = useAuth();
  const [logoutPinOpen, setLogoutPinOpen] = useState(false);
  const isCashierOnly =
    hasRole("cashier") && !hasRole("owner") && !hasRole("manager");
  const showCashierLogout = isCashierOnly && Capacitor.isNativePlatform();
  const { format: formatCurrency } = useCurrency();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("Main");
  const [categoryInitialized, setCategoryInitialized] = useState(false);
  // When true, sort items within the currently selected category by top sales (last 30 days)
  const [sortByTopSales, setSortByTopSales] = useState<boolean>(true);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [payment, setPayment] = useState<PaymentMethod>("cash");
  const [unpaid, setUnpaid] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [menuCols, setMenuCols] = usePosGridColumns();
  const [qrOpen, setQrOpen] = useState(false);
  const [kioskUnlockOpen, setKioskUnlockOpen] = useState(false);
  const [wifiOpen, setWifiOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [drawerHost, setDrawerHost] = useState<string>(() =>
    typeof window !== "undefined" ? localStorage.getItem("drawer.host") || "" : ""
  );
  const [drawerPort, setDrawerPort] = useState<string>(() =>
    typeof window !== "undefined" ? localStorage.getItem("drawer.port") || "9100" : "9100"
  );
  const [offlineCheckOpen, setOfflineCheckOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem("pos.lastSyncedAt");
    return raw ? Number(raw) || null : null;
  });
  const [offlineCheckRunning, setOfflineCheckRunning] = useState(false);
  const [offlineCheckResult, setOfflineCheckResult] = useState<{
    network: boolean | null;
    idb: boolean | null;
    dataCached: boolean | null;
    engineBooted: boolean | null;
    timestamp: number | null;
  }>({
    network: null,
    idb: null,
    dataCached: null,
    engineBooted: null,
    timestamp: null,
  });

  // Prices must follow the branch this terminal is scoped to, not the
  // tenant-wide base price on menu_items.
  const { activeBranchId: pricingBranchId } = useBranch();
  const { priceMap } = useBranchPrices(pricingBranchId);
  // Auto-sync: realtime push + 60s poll + midnight rollover keep this
  // terminal on the newest effective-dated prices without a manual refresh.
  const priceSync = useMenuPriceSync(pricingBranchId);

  const { data: rawMenuItems = [], isLoading } = useQuery({
    queryKey: ["pos-tablet-menu", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [] as MenuItem[];
      const { data, error } = await supabase
        .from("menu_items")
        .select(
          "id, name, category, selling_price, quarter_price, half_price, full_price, image_url, is_chefs_special",
        )
        .eq("restaurant_id", restaurant.id)
        .eq("is_active", true)
        .order("category")
        .order("name");
      if (error) throw error;
      return (data || []) as MenuItem[];
    },
    enabled: !!restaurant?.id,
  });

  const menuItems = useMemo<MenuItem[]>(() => {
    if (!rawMenuItems.length || !Object.keys(priceMap).length) return rawMenuItems;
    return rawMenuItems.map((it) => {
      const o = priceMap[it.id];
      if (!o) return it;
      return {
        ...it,
        quarter_price: o.quarter_price != null ? Number(o.quarter_price) : it.quarter_price,
        half_price: o.half_price != null ? Number(o.half_price) : it.half_price,
        full_price: o.full_price != null ? Number(o.full_price) : it.full_price,
        selling_price: o.full_price != null ? Number(o.full_price) : it.selling_price,
      };
    });
  }, [rawMenuItems, priceMap]);

  const { data: activeShifts = [] } = useQuery({
    queryKey: ["pos-tablet-shifts", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await supabase
        .from("shifts")
        .select("id")
        .eq("restaurant_id", restaurant.id)
        .eq("status", "open")
        .limit(1);
      if (error) throw error;
      return data || [];
    },
    enabled: !!restaurant?.id,
  });

  const { data: topSellingData = [] } = useQuery({
    queryKey: ["top-selling-items", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data, error } = await supabase
        .from("sales_items")
        .select("menu_item_id, quantity")
        .eq("restaurant_id", restaurant.id)
        .gte("created_at", thirtyDaysAgo.toISOString());

      if (error) throw error;

      const aggregated = (data || []).reduce((acc, item) => {
        acc[item.menu_item_id] = (acc[item.menu_item_id] || 0) + item.quantity;
        return acc;
      }, {} as Record<string, number>);

      const ranked = Object.entries(aggregated)
        .sort(([, a], [, b]) => b - a)
        .map(([id, qty]) => ({ menuItemId: id, totalSold: qty }));
      return ranked;
    },
    enabled: !!restaurant?.id,
  });

  // Customers are branch-scoped: a terminal only lists customers belonging to
  // its own branch (plus legacy rows that were never tagged with a branch).
  const { activeBranchId: customerBranchId } = useBranch();

  const { data: customers = [] } = useQuery({
    queryKey: ["pos-tablet-customers", restaurant?.id, customerBranchId ?? "all"],
    queryFn: async () => {
      if (!restaurant?.id) return [] as Customer[];
      let qb = supabase
        .from("customers")
        .select("id, name, phone, credit_limit, current_balance, credit_status")
        .eq("restaurant_id", restaurant.id)
        .eq("credit_status", "active");
      if (customerBranchId) {
        qb = qb.or(`branch_id.eq.${customerBranchId},branch_id.is.null`);
      }
      const { data, error } = await qb.order("name");
      if (error) throw error;
      return (data || []) as Customer[];
    },
    enabled: !!restaurant?.id,
  });

  const filteredCustomers = useMemo(() => {
    if (!customerSearch) return customers;
    const term = customerSearch.toLowerCase();
    return customers.filter(
      (c) => c.name.toLowerCase().includes(term) || c.phone?.includes(term),
    );
  }, [customers, customerSearch]);

  // Prefetch menu images into the offline cache whenever the menu loads
  // and we're online. Best-effort: failures are swallowed inside the helper.
  useEffect(() => {
    if (menuItems.length === 0) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    void prefetchImages(menuItems.map((m) => toCdnUrl(m.image_url)));
  }, [menuItems]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    menuItems.forEach((m) => m.category && set.add(m.category));
    const all = Array.from(set);
    // Surface "Main" (case-insensitive) first
    all.sort((a, b) => {
      const am = a.toLowerCase() === "main" ? 0 : 1;
      const bm = b.toLowerCase() === "main" ? 0 : 1;
      if (am !== bm) return am - bm;
      return a.localeCompare(b);
    });
    return all;
  }, [menuItems]);

  useEffect(() => {
    if (categoryInitialized || categories.length === 0) return;
    const main = categories.find((c) => c.toLowerCase() === "main");
    setCategory(main ?? ALL);
    setCategoryInitialized(true);
  }, [categories, categoryInitialized]);

  // Full sales rank map: menu_item_id -> total qty sold (last 30 days)
  const salesRankMap = useMemo(() => {
    const m = new Map<string, number>();
    topSellingData.forEach((t) => m.set(t.menuItemId, t.totalSold));
    return m;
  }, [topSellingData]);

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    let items = menuItems.filter((m) => {
      if (category !== ALL && m.category !== category) return false;
      if (q && !m.name.toLowerCase().includes(q)) return false;
      return true;
    });
    if (sortByTopSales) {
      items = [...items].sort((a, b) => {
        const qa = salesRankMap.get(a.id) ?? 0;
        const qb = salesRankMap.get(b.id) ?? 0;
        if (qb !== qa) return qb - qa;
        return a.name.localeCompare(b.name);
      });
    }
    return items;
  }, [menuItems, search, category, sortByTopSales, salesRankMap]);

  const { activeBranchId, activeBranch } = useBranch();
  // VAT rate is configured per branch (Settings → Branches).
  const { vatRate, vatPercent, pricesInclusive } = useBranchVatRate(activeBranchId);

  const cartCount = cart.reduce((s, l) => s + l.qty, 0);

  /** Pull the latest menu, branch prices, customers and shift state from the server. */
  const handleRefreshData = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        toast.error(t("app.pos.mobile.refreshOffline"), {
          description: t("app.pos.mobile.refreshOfflineHelp"),
        });
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["pos-tablet-menu"] }),
        queryClient.invalidateQueries({ queryKey: ["pos-tablet-customers"] }),
        queryClient.invalidateQueries({ queryKey: ["pos-tablet-shifts"] }),
        queryClient.invalidateQueries({ queryKey: ["top-selling-items"] }),
        queryClient.invalidateQueries({ queryKey: ["branch-menu-prices"] }),
        queryClient.invalidateQueries({ queryKey: ["branch-vat-rate"] }),
        queryClient.invalidateQueries({ queryKey: ["menu-categories"] }),
      ]);
      await priceSync.resync();
      const now = Date.now();
      setLastSyncedAt(now);
      try {
        localStorage.setItem("pos.lastSyncedAt", String(now));
      } catch { /* storage unavailable - non-fatal */ }
      toast.success(t("app.pos.mobile.refreshSuccess"), {
        description: t("app.pos.mobile.refreshSuccessHelp", { time: format(new Date(now), "h:mm:ss a") }),
      });
    } catch (e) {
      toast.error(t("app.pos.mobile.refreshFailed"), {
        description:
          e instanceof Error && e.message
            ? `${e.message} — ${t("app.pos.mobile.refreshRetryHelp")}`
            : t("app.pos.mobile.refreshRetryHelp"),
      });
    } finally {
      setRefreshing(false);
    }
  };
  // Listed menu prices are interpreted per the branch pricing mode:
  // inclusive → VAT is backed out of the listed price; exclusive → VAT is
  // added on top. Round each line first, then the total, so lines add up.
  const listedTotal = sumMoney(cart.map((l) => lineGross(l.price, l.qty)));
  const { net: subtotal, vat, gross: grossTotal } = splitListed(
    listedTotal,
    vatRate,
    pricesInclusive,
  );
  const total = grossTotal;

  const queueSaleOffline = async () => {
    if (!restaurant?.id || !user?.id || cart.length === 0) throw new Error("Cart is empty");

    const activeShift = activeShifts[0];
    const result = await recordOfflineSale({
      branchId: activeBranchId ?? restaurant.id,
      cashierId: user.id,
      shiftId: activeShift?.id || null,
      paymentMethod: payment,
      customerId: unpaid ? selectedCustomer?.id ?? null : null,
      isUnpaid: unpaid,
      vatRate,
      pricesVatInclusive: pricesInclusive,
      items: cart.map((l) => ({
        menu_item_id: l.id,
        name: l.name,
        quantity: l.qty,
        unit_price: l.price,
      })),
    });

    return { receiptNumber: result.receiptNumber, queuedOffline: true };
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

  useEffect(() => {
    void import("@/lib/offline/lazyBootstrap")
      .then(({ ensureOfflineBootstrapped }) => ensureOfflineBootstrapped(restaurant?.id ?? null))
      .catch(() => undefined);
  }, [restaurant?.id]);

  const submitSale = () => {
    // License gate: block new sales in limited/locked mode
    try {
      const raw = localStorage.getItem("license_state_v1");
      if (raw) {
        const s = JSON.parse(raw);
        if (s && (s.mode === "limited" || s.mode === "locked" || s.mode === "offline_stale" || s.mode === "no_seat")) {
          toast.error(t("app.pos.mobile.salesDisabled"), {
            description: t("app.pos.mobile.salesDisabledHelp"),
          });
          return;
        }
      }
    } catch {
      /* ignore */
    }
    void import("@/lib/offline/lazyBootstrap")
      .then(({ ensureOfflineBootstrapped }) => ensureOfflineBootstrapped(restaurant?.id ?? null))
      .catch(() => undefined);
    submit.mutate();
  };

  const variantLabel = (v: Variant) =>
    v === "quarter" ? t("app.pos.order.quarter") : v === "half" ? t("app.pos.order.half") : v === "full" ? t("app.pos.order.full") : "";

  const addItem = (m: MenuItem, variant: Variant, price: number) => {
    const key = `${m.id}:${variant}`;
    setCart((prev) => {
      const i = prev.findIndex((l) => l.key === key);
      if (i >= 0) {
        const copy = [...prev];
        copy[i] = { ...copy[i], qty: copy[i].qty + 1 };
        return copy;
      }
      return [
        ...prev,
        { key, id: m.id, name: m.name, variant, price, qty: 1, image_url: toCdnUrl(m.image_url) },
      ];
    });
    setJustAdded(key);
    window.setTimeout(() => setJustAdded((v) => (v === key ? null : v)), 400);
  };

  const changeQty = (key: string, delta: number) =>
    setCart((prev) =>
      prev
        .map((l) => (l.key === key ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0),
    );

  const removeLine = (key: string) =>
    setCart((prev) => prev.filter((l) => l.key !== key));

  const clearCart = () => setCart([]);

  const toggleUnpaid = (v: boolean) => {
    setUnpaid(v);
    if (v) {
      setCustomerOpen(true);
    } else {
      setSelectedCustomer(null);
    }
  };

  const runOfflineCheck = async () => {
    setOfflineCheckRunning(true);
    setOfflineCheckResult({
      network: null,
      idb: null,
      dataCached: null,
      engineBooted: null,
      timestamp: null,
    });

    const result = {
      network: false,
      idb: false,
      dataCached: false,
      engineBooted: false,
      timestamp: Date.now(),
    };

    // 1. Network probe
    try {
      const { probeNetwork } = await import("@/lib/offline/connectivity");
      result.network = await probeNetwork(3000);
    } catch {
      result.network = false;
    }

    // 2. IndexedDB availability
    try {
      if (typeof indexedDB !== "undefined") {
        const { openDB } = await import("@/lib/offline/db");
        await openDB();
        result.idb = true;
      }
    } catch {
      result.idb = false;
    }

    // 3. Data cached (menu items loaded via React Query are in memory)
    result.dataCached = menuItems.length > 0 && customers.length > 0;

    // 4. Offline engine bootstrapped
    try {
      const { ensureOfflineBootstrapped } = await import("@/lib/offline/lazyBootstrap");
      await ensureOfflineBootstrapped(restaurant?.id ?? null);
      result.engineBooted = true;
    } catch {
      result.engineBooted = false;
    }

    setOfflineCheckResult(result);
    setOfflineCheckRunning(false);
  };


  const submit = useMutation({
    mutationFn: async () => {
      if (!restaurant?.id || !user?.id || cart.length === 0) throw new Error("Cart is empty");
      if (unpaid && !selectedCustomer) throw new Error("Select a customer for unpaid sale");
      const activeShift = activeShifts[0];

      // Offline path: queue the sale to IndexedDB; the sync engine
      // will drain it when connectivity returns.
      // Trust `navigator.onLine === false` as the primary signal - the
      // connectivity watcher's cached state can lag behind reality,
      // which would otherwise leave the Pay button hanging on a stuck
      // Supabase fetch with no timeout.
      const browserOffline =
        typeof navigator !== "undefined" && navigator.onLine === false;
      if (browserOffline || !isOnline()) {
        return queueSaleOffline();
      }

      const receiptNumber = `RCP-${format(new Date(), "yyyyMMdd")}-${Math.floor(
        Math.random() * 10000,
      )
        .toString()
        .padStart(4, "0")}`;

      let tx;
      let txErr;
      try {
        const response = await withOnlineWriteTimeout(
          supabase
          .from("sales_transactions")
          .insert({
            restaurant_id: restaurant.id,
            shift_id: activeShift?.id || null,
            payment_method: payment,
            subtotal,
            tax: vat,
            total,
            receipt_number: receiptNumber,
            settlement_status: unpaid ? "unpaid" : "paid",
            paid_amount: unpaid ? 0 : total,
            customer_id: unpaid ? selectedCustomer?.id ?? null : null,
            created_at: new Date().toISOString(),
          } as never)
          .select()
          .single(),
          "Recording sale",
        );

        tx = response.data;
        txErr = response.error;
      } catch (error) {
        if (isRecoverableNetworkError(error)) {
          return queueSaleOffline();
        }
        throw error;
      }
      if (txErr) {
        if (isRecoverableNetworkError(txErr)) {
          return queueSaleOffline();
        }
        throw txErr;
      }

      const items = cart.map((l) => ({
        restaurant_id: restaurant.id,
        transaction_id: (tx as { id: string }).id,
        menu_item_id: l.id,
        quantity: l.qty,
        unit_price: l.price,
        total_price: l.price * l.qty,
      }));
      const { error: itemsErr } = await withOnlineWriteTimeout(
        supabase.from("sales_items").insert(items),
        "Saving sale items",
      );
      if (itemsErr) throw itemsErr;

      if (activeShift?.id && !unpaid) {
        await withOnlineWriteTimeout(
          supabase.from("cash_events").insert([
            {
              shift_id: activeShift.id,
              restaurant_id: restaurant.id,
              event_type: "sale",
              amount: total,
              payment_method: payment === "other" ? "other" : payment,
              created_by: user.id,
              description: `POS Sale ${receiptNumber}`,
            },
          ]),
          "Saving cash event",
        );
      }
      return { receiptNumber, queuedOffline: false };
    },
    onSuccess: ({ receiptNumber, queuedOffline }) => {
      toast.success(
        queuedOffline ? `Queued offline · ${receiptNumber}` : `Sale recorded · ${receiptNumber}`,
      );
      setCart([]);
      setPayment("cash");
      setUnpaid(false);
      setSelectedCustomer(null);
      setCartOpen(false);
      queryClient.invalidateQueries({ queryKey: ["sales-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["pos-tablet-customers"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Failed to record sale"),
  });

  const initials = (s: string) =>
    s
      .split(" ")
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase();

  /* ---------------- RENDER ---------------- */

  return (
    <div className="fixed inset-0 flex bg-muted/30 text-foreground overflow-hidden">
      {/* ============== LEFT: MENU ============== */}
      <div className="flex-1 min-w-0 flex flex-col bg-background">
        {/* Top bar */}
        <header className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 md:px-6 h-14 sm:h-16 border-b bg-background">
          {!Capacitor.isNativePlatform() && !isCashierOnly && (
            <Button
              size="icon"
              variant="ghost"
              className="h-9 w-9 sm:h-10 sm:w-10 -ms-1 shrink-0"
              onClick={() => navigate(-1)}
              aria-label={t("app.pos.mobile.back")}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
          <div className="shrink-0">
            <MatbexLogo size="sm" showWordmark={false} animate={false} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] sm:text-[15px] font-semibold leading-tight truncate">
              {restaurant?.name || t("app.pos.mobile.restaurant")}
            </p>
            <p className="text-[10px] sm:text-[11px] text-muted-foreground leading-tight truncate">
              {activeBranch?.name
                ? `${activeBranch.name}${activeBranch.code ? ` (${activeBranch.code})` : ""} · ${t("app.pos.title")}`
                : t("app.pos.title")}
              {lastSyncedAt
                ? ` · ${t("app.pos.mobile.lastSynced", { time: format(new Date(lastSyncedAt), "h:mm a") })}`
                : ` · ${t("app.pos.mobile.notSynced")}`}
            </p>
          </div>
          <div className="ms-auto flex items-center gap-1 sm:gap-2 shrink-0">
            <PendingSyncBadge compact />
            <button
              onClick={() => {
                setOfflineCheckOpen(true);
                void runOfflineCheck();
              }}
              className="hidden md:inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              aria-label={t("app.pos.mobile.checkOffline")}
            >
              <span className={cn(
                "h-1.5 w-1.5 rounded-full",
                typeof navigator !== "undefined" && navigator.onLine ? "bg-emerald-500" : "bg-amber-500"
              )} />
              {typeof navigator !== "undefined" && navigator.onLine ? t("app.pos.mobile.online") : t("app.pos.mobile.offlineStatus")}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 px-2.5 gap-1.5 rounded-lg"
                  aria-label={t("app.pos.mobile.quickActions")}
                  title={t("app.pos.mobile.quickActions")}
                >
                  {refreshing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <MoreHorizontal className="h-4 w-4" />
                  )}
                  <span className="text-xs hidden sm:inline">{t("app.pos.mobile.actions")}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60 z-50 bg-popover">
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                   {t("app.pos.mobile.quickActions")}
                </DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => void handleRefreshData()} disabled={refreshing}>
                  <RefreshCw className={cn("h-4 w-4 me-2", refreshing && "animate-spin")} />
                   {refreshing ? t("app.pos.mobile.refreshing") : t("app.pos.mobile.refreshData")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setQrOpen(true)}>
                  <QrCode className="h-4 w-4 me-2" />
                   {t("app.pos.mobile.scanQr")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => toast.success(t("app.pos.mobile.drawerOpened"))}>
                  <Printer className="h-4 w-4 me-2" />
                   {t("app.pos.mobile.openDrawer")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setExpenseOpen(true)}>
                  <Receipt className="h-4 w-4 me-2" />
                   {t("app.pos.mobile.addExpense")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => setKioskUnlockOpen(true)}
                  className="text-destructive focus:text-destructive"
                >
                  <ShieldAlert className="h-4 w-4 me-2" />
                   {t("app.pos.mobile.emergencyExit")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setWifiOpen(true)}>
                  <Wifi className="h-4 w-4 me-2" />
                   {t("app.pos.mobile.changeWifi")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-muted-foreground flex items-center gap-2">
                  <Grid3x3 className="h-3.5 w-3.5" />
                   {t("app.pos.mobile.menuColumns")}
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={String(menuCols)}
                  onValueChange={(v) => setMenuCols(Number(v) as 2 | 3 | 4 | 6)}
                >
                  {[2, 3, 4, 6].map((c) => (
                    <DropdownMenuRadioItem key={c} value={String(c)}>
                       {t("app.pos.mobile.perRow", { count: c })}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-lg"
              onClick={() => setSettingsOpen(true)}
               aria-label={t("app.pos.mobile.settings")}
            >
              <Settings className="h-4 w-4" />
            </Button>
            {showCashierLogout && (
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-lg text-destructive hover:text-destructive"
                onClick={() => setLogoutPinOpen(true)}
                aria-label={t("app.pos.mobile.switchUser")}
                title={t("app.pos.mobile.switchUserHelp")}
              >
                <LogOut className="h-4 w-4" />
              </Button>
            )}
          </div>
        </header>

        {/* Search */}
        <div className="px-4 md:px-6 pt-4">
          <div className="relative">
            <Search className="absolute start-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("app.pos.search.items")}
              className="h-12 ps-11 pe-11 text-sm rounded-2xl bg-muted/40 border-transparent focus-visible:bg-background"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute end-3 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted"
                aria-label={t("app.pos.mobile.clear")}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Category chips */}
        <div className="px-4 md:px-6 pt-3 pb-2 flex items-center gap-2">
          <ScrollArea className="flex-1">
            <div className="flex gap-2 pb-2">
              <CategoryChip active={category === ALL} onClick={() => setCategory(ALL)}>
                 {t("app.pos.mobile.allItems")}
              </CategoryChip>
              {categories.map((c) => (
                <CategoryChip
                  key={c}
                  active={category === c}
                  onClick={() => setCategory(c)}
                >
                  {c}
                </CategoryChip>
              ))}
            </div>
          </ScrollArea>
          <button
            onClick={() => setSortByTopSales((v) => !v)}
             title={t("app.pos.mobile.topSalesHelp")}
            className={cn(
              "shrink-0 h-10 px-3 rounded-full text-xs font-semibold transition-all inline-flex items-center gap-1.5 border",
              sortByTopSales
                ? "bg-amber-500 text-white border-amber-500 shadow-sm"
                : "bg-background text-foreground border-border hover:bg-muted"
            )}
          >
            <Flame className="h-3.5 w-3.5" />
             {t("app.pos.mobile.topSales")}
          </button>
        </div>

        {/* Menu grid */}
        <PullToRefresh onRefresh={handleRefreshData} refreshing={refreshing}>
          <ScrollArea className="flex-1">
            <div className="px-4 md:px-6 pt-2 pb-32 lg:pb-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-20 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : visibleItems.length === 0 ? (
              <div className="text-center text-muted-foreground py-20 text-sm">
                 {t("app.pos.mobile.noItems")}
              </div>
            ) : (
              <div
                className={cn(
                  "grid gap-3 md:gap-4",
                  menuCols === 2 && "grid-cols-2",
                  menuCols === 3 && "grid-cols-3",
                  menuCols === 4 && "grid-cols-4",
                  menuCols === 6 && "grid-cols-3 md:grid-cols-6"
                )}
              >
                {visibleItems.map((m) => {
                  const half = Number(m.half_price) || 0;
                  const full = Number(m.full_price) || 0;
                  const quarter = Number(m.quarter_price) || 0;
                  const sell = Number(m.selling_price) || 0;
                  const hasVariants = half > 0 || full > 0 || quarter > 0;
                  const inCart = cart
                    .filter((l) => l.id === m.id)
                    .reduce((s, l) => s + l.qty, 0);
                  return (
                    <motion.div
                      key={m.id}
                      whileTap={{ scale: 0.98 }}
                      className="relative rounded-2xl overflow-hidden bg-card border shadow-sm flex flex-col"
                    >
                      <button
                        onClick={() =>
                          !hasVariants && addItem(m, "default", sell)
                        }
                        className="relative aspect-square bg-muted/40 overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        aria-label={m.name}
                      >
                         <MenuImage
                           src={toCdnUrl(m.image_url)}
                           alt={m.name}
                           fallback={
                             <div className="h-full w-full flex items-center justify-center text-3xl font-light text-muted-foreground">
                               {initials(m.name)}
                             </div>
                           }
                         />
                        {m.is_chefs_special && (
                          <span className="absolute top-2 start-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/90 text-primary-foreground text-[10px] font-semibold uppercase tracking-wide">
                            <Star className="h-3 w-3" /> Best
                          </span>
                        )}
                        {inCart > 0 && (
                          <div className="absolute top-2 end-2 h-7 min-w-7 px-2 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center shadow">
                            {inCart}
                          </div>
                        )}
                        <AnimatePresence>
                          {justAdded?.startsWith(m.id + ":") && (
                            <motion.div
                              initial={{ opacity: 0, scale: 0.6 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.6 }}
                              transition={{ duration: 0.2 }}
                              className="absolute inset-0 flex items-center justify-center bg-primary/10 backdrop-blur-[1px] pointer-events-none"
                            >
                              <div className="h-12 w-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg">
                                <Check className="h-6 w-6" />
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </button>

                      <div className="p-2.5 md:p-3 flex flex-col gap-2">
                        <p className="text-[13px] md:text-sm font-semibold leading-snug line-clamp-2 min-h-[2.4rem] text-center">
                          {m.name}
                        </p>
                        {hasVariants ? (
                          <div
                            className={cn(
                              "grid gap-1.5",
                              [quarter, half, full].filter((p) => p > 0).length === 1
                                ? "grid-cols-1"
                                : [quarter, half, full].filter((p) => p > 0).length === 2
                                  ? "grid-cols-2"
                                  : "grid-cols-3",
                            )}
                          >
                            {quarter > 0 && (
                              <VariantBtn
                                label="Q"
                                price={quarter}
                                onClick={() => addItem(m, "quarter", quarter)}
                                tone="amber"
                                formatCurrency={formatCurrency}
                              />
                            )}
                            {half > 0 && (
                              <VariantBtn
                                label="H"
                                price={half}
                                onClick={() => addItem(m, "half", half)}
                                tone="blue"
                                formatCurrency={formatCurrency}
                              />
                            )}
                            {full > 0 && (
                              <VariantBtn
                                label="F"
                                price={full}
                                onClick={() => addItem(m, "full", full)}
                                tone="primary"
                                formatCurrency={formatCurrency}
                              />
                            )}
                          </div>
                        ) : (
                          <Button
                            onClick={() => addItem(m, "default", sell)}
                            className="h-10 rounded-xl text-sm font-semibold"
                          >
                            {formatCurrency(sell)}
                          </Button>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
            </div>
          </ScrollArea>
        </PullToRefresh>
      </div>

      {/* ============== RIGHT: ORDER SUMMARY (tablet+) ============== */}
      <aside className="hidden lg:flex w-[380px] xl:w-[420px] shrink-0 flex-col border-l bg-background">
        <OrderSummary
          cart={cart}
          subtotal={subtotal}
          vat={vat}
          vatPercent={vatPercent}
          pricesInclusive={pricesInclusive}
          total={total}
          payment={payment}
          unpaid={unpaid}
          setPayment={setPayment}
          setUnpaid={toggleUnpaid}
          changeQty={changeQty}
          removeLine={removeLine}
          clearCart={clearCart}
          submit={() => void submitSale()}
          submitting={submit.isPending}
          formatCurrency={formatCurrency}
          variantLabel={variantLabel}
          justAdded={justAdded}
          selectedCustomer={selectedCustomer}
          openCustomer={() => setCustomerOpen(true)}
        />
      </aside>

      {/* ============== FLOATING CART BUTTON (phone) ============== */}
      <AnimatePresence>
        {cartCount > 0 && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="lg:hidden absolute inset-x-0 bottom-0 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-background via-background to-transparent"
          >
            <Button
              onClick={() => setCartOpen(true)}
              className="w-full h-14 rounded-2xl text-base font-semibold shadow-lg flex items-center justify-between px-5"
            >
              <span className="flex items-center gap-3">
                <span className="relative">
                  <ShoppingBag className="h-5 w-5" />
                  <span className="absolute -top-2 -end-2 h-5 min-w-5 px-1 rounded-full bg-background text-primary text-[11px] font-bold flex items-center justify-center border-2 border-primary">
                    {cartCount}
                  </span>
                </span>
                <span>{t("app.pos.mobile.reviewOrder")}</span>
              </span>
              <span>{formatCurrency(total)}</span>
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ============== CART SHEET (phone) ============== */}
      <Sheet open={cartOpen} onOpenChange={setCartOpen}>
        <SheetContent side="bottom" className="lg:hidden rounded-t-3xl p-0 max-h-[92vh] flex flex-col">
          <SheetHeader className="px-5 pt-5 pb-2 border-b">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-start text-lg font-semibold">{t("app.pos.mobile.orderSummary")}</SheetTitle>
              {cart.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 text-xs -me-2"
                  onClick={clearCart}
                >
                  {t("app.pos.mobile.clearAll")}
                </Button>
              )}
            </div>
          </SheetHeader>
          <OrderSummary
            cart={cart}
            subtotal={subtotal}
            vat={vat}
            vatPercent={vatPercent}
            pricesInclusive={pricesInclusive}
            total={total}
            payment={payment}
            unpaid={unpaid}
            setPayment={setPayment}
            setUnpaid={toggleUnpaid}
            changeQty={changeQty}
            removeLine={removeLine}
            clearCart={clearCart}
            submit={() => void submitSale()}
            submitting={submit.isPending}
            formatCurrency={formatCurrency}
            variantLabel={variantLabel}
            justAdded={justAdded}
            selectedCustomer={selectedCustomer}
            openCustomer={() => setCustomerOpen(true)}
            compact
          />
        </SheetContent>
      </Sheet>

      {/* QR scanner */}
      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("app.pos.mobile.scanQr")}</DialogTitle>
          </DialogHeader>
          <div className="aspect-square w-full rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <QrCode className="h-12 w-12" />
            <p className="text-xs">{t("app.pos.mobile.cameraUnavailable")}</p>
            <p className="text-[10px]">{t("app.pos.mobile.cameraHelp")}</p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Customer picker for unpaid sales */}
      <Dialog
        open={customerOpen}
        onOpenChange={(o) => {
          setCustomerOpen(o);
          if (!o && unpaid && !selectedCustomer) {
            setUnpaid(false);
          }
        }}
      >
        <DialogContent className="max-w-md p-0 overflow-hidden">
          <DialogHeader className="px-5 pt-5 pb-3 border-b">
            <DialogTitle>{t("app.pos.mobile.selectCustomer")}</DialogTitle>
          </DialogHeader>
          <div className="px-5 pt-3">
            <div className="relative">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                placeholder={t("app.pos.mobile.searchCustomer")}
                className="h-11 ps-9 rounded-xl"
                autoFocus
              />
            </div>
          </div>
          <ScrollArea className="max-h-[55vh] px-3 py-3">
            {filteredCustomers.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-10">
                {t("app.pos.mobile.noCustomers")}
              </div>
            ) : (
              <div className="space-y-1.5">
                {filteredCustomers.map((c) => {
                  const active = selectedCustomer?.id === c.id;
                  const remaining = Number(c.credit_limit) - Number(c.current_balance);
                  const overLimit = remaining < total;
                  return (
                    <button
                      key={c.id}
                      onClick={() => {
                        setSelectedCustomer(c);
                        setCustomerOpen(false);
                      }}
                      className={cn(
                        "w-full text-start px-3 py-2.5 rounded-xl border flex items-center gap-3 transition-colors",
                        active
                          ? "border-primary bg-primary/10"
                          : "border-border hover:bg-muted/60",
                      )}
                    >
                      <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0">
                        {c.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{c.name}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                           {c.phone || t("app.pos.mobile.noPhone")}
                        </p>
                      </div>
                       <div className="text-end shrink-0">
                         <p className="text-[10px] text-muted-foreground">{t("app.pos.mobile.balance")}</p>
                        <p
                          className={cn(
                            "text-xs font-semibold tabular-nums",
                            overLimit ? "text-destructive" : "text-foreground",
                          )}
                        >
                          {formatCurrency(c.current_balance)} / {formatCurrency(c.credit_limit)}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
          <DialogFooter className="px-5 py-3 border-t">
            <Button
              variant="outline"
              onClick={() => {
                setCustomerOpen(false);
                if (!selectedCustomer) setUnpaid(false);
              }}
            >
              {t("common.cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cash drawer settings */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("app.pos.mobile.drawer.title")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="drawer-host" className="text-xs">{t("app.pos.mobile.drawer.host")}</Label>
              <Input
                id="drawer-host"
                value={drawerHost}
                onChange={(e) => setDrawerHost(e.target.value)}
                placeholder="192.168.1.100"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="drawer-port" className="text-xs">{t("app.pos.mobile.drawer.port")}</Label>
              <Input
                id="drawer-port"
                value={drawerPort}
                onChange={(e) => setDrawerPort(e.target.value)}
                placeholder="9100"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {t("app.pos.mobile.drawer.help")}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)}>{t("common.cancel")}</Button>
            <Button
              onClick={() => {
                localStorage.setItem("drawer.host", drawerHost);
                localStorage.setItem("drawer.port", drawerPort);
                toast.success(t("app.pos.mobile.drawer.saved"));
                setSettingsOpen(false);
              }}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Offline readiness check */}
      <Dialog open={offlineCheckOpen} onOpenChange={setOfflineCheckOpen}>
        <DialogContent className="max-w-sm p-0 overflow-hidden">
          <DialogHeader className="px-5 pt-5 pb-3 border-b">
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              {t("app.pos.mobile.offline.title")}
            </DialogTitle>
          </DialogHeader>
          <div className="px-5 py-4 space-y-3">
            {offlineCheckRunning ? (
              <div className="flex flex-col items-center gap-3 py-6">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">{t("app.pos.mobile.offline.checking")}</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                <CheckRow
                  label={t("app.pos.mobile.offline.network")}
                  description={t("app.pos.mobile.offline.networkHelp")}
                  status={offlineCheckResult.network}
                  okIcon={<Wifi className="h-4 w-4" />}
                  failIcon={<WifiOff className="h-4 w-4" />}
                />
                <CheckRow
                  label={t("app.pos.mobile.offline.storage")}
                  description={t("app.pos.mobile.offline.storageHelp")}
                  status={offlineCheckResult.idb}
                  okIcon={<Database className="h-4 w-4" />}
                  failIcon={<XCircle className="h-4 w-4" />}
                />
                <CheckRow
                  label={t("app.pos.mobile.offline.cached")}
                  description={t("app.pos.mobile.offline.cachedHelp")}
                  status={offlineCheckResult.dataCached}
                  okIcon={<CheckCircle2 className="h-4 w-4" />}
                  failIcon={<AlertCircle className="h-4 w-4" />}
                />
                <CheckRow
                  label={t("app.pos.mobile.offline.syncEngine")}
                  description={t("app.pos.mobile.offline.syncEngineHelp")}
                  status={offlineCheckResult.engineBooted}
                  okIcon={<ShieldCheck className="h-4 w-4" />}
                  failIcon={<ShieldAlert className="h-4 w-4" />}
                />
                {offlineCheckResult.timestamp && (
                  <p className="text-[10px] text-muted-foreground text-center pt-1">
                    {t("app.pos.mobile.offline.checked", { time: new Date(offlineCheckResult.timestamp).toLocaleTimeString() })}
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="px-5 py-3 border-t">
            <Button
              variant="outline"
              onClick={() => setOfflineCheckOpen(false)}
              disabled={offlineCheckRunning}
            >
              {t("common.close")}
            </Button>
            <Button
              onClick={() => void runOfflineCheck()}
              disabled={offlineCheckRunning}
              className="gap-1.5"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", offlineCheckRunning && "animate-spin")} />
              {t("app.pos.mobile.offline.recheck")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AdminPinDialog
        open={logoutPinOpen}
        onOpenChange={setLogoutPinOpen}
        title={t("app.pos.mobile.switchUser")}
        description={t("app.pos.mobile.switchUserHelp")}
        confirmLabel={t("app.pos.mobile.signOut")}
        onVerified={async () => {
          await signOut();
          navigate("/auth", { replace: true });
        }}
      />

      <EmergencyKioskUnlockDialog open={kioskUnlockOpen} onOpenChange={setKioskUnlockOpen} />
      <KioskWifiDialog open={wifiOpen} onOpenChange={setWifiOpen} />

      <RecordExpenseDialog
        open={expenseOpen}
        onOpenChange={setExpenseOpen}
      />
    </div>
  );
}

/* ============================================================
   Sub-components
============================================================ */

function CategoryChip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "shrink-0 h-10 px-4 rounded-full text-sm font-medium transition-colors whitespace-nowrap inline-flex items-center gap-1.5",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "bg-muted/60 text-foreground hover:bg-muted",
      )}
    >
      {children === "Top Selling" && <Flame className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

function VariantBtn({
  label,
  price,
  onClick,
  tone,
  formatCurrency,
}: {
  label: string;
  price: number;
  onClick: () => void;
  tone: "amber" | "blue" | "primary";
  formatCurrency: (n: number) => string;
}) {
  const toneClasses =
    tone === "primary"
      ? "border-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
      : tone === "blue"
        ? "border-sky-500/30 bg-sky-500/5 text-sky-700 dark:text-sky-300 hover:bg-sky-500/10"
        : "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10";
  return (
    <button
      onClick={onClick}
      className={cn(
        "h-12 px-0.5 rounded-xl border flex flex-col items-center justify-center leading-tight transition-colors active:scale-[0.97] overflow-hidden",
        toneClasses,
      )}
    >
      <span className="text-[9px] font-bold tracking-wider leading-none">{label}</span>
      <span className="text-[10px] sm:text-[11px] font-semibold tabular-nums whitespace-nowrap truncate max-w-full leading-tight">
        {formatCurrency(price)}
      </span>
    </button>
  );
}

function PayButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
        className={cn(
          "h-12 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold border-2 transition-all",
          active
            ? "border-primary bg-primary text-primary-foreground shadow-sm"
            : "border-border bg-card text-foreground hover:border-primary/40",
        )}
    >
      {icon}
      {label}
    </button>
  );
}

function OrderSummary({
  cart,
  subtotal,
  vat,
  vatPercent,
  pricesInclusive,
  total,
  payment,
  unpaid,
  setPayment,
  setUnpaid,
  changeQty,
  removeLine,
  clearCart,
  submit,
  submitting,
  formatCurrency,
  variantLabel,
  justAdded,
  selectedCustomer,
  openCustomer,
  compact,
}: {
  cart: CartLine[];
  subtotal: number;
  vat: number;
  vatPercent: number;
  pricesInclusive: boolean;
  total: number;
  payment: PaymentMethod;
  unpaid: boolean;
  setPayment: (p: PaymentMethod) => void;
  setUnpaid: (v: boolean) => void;
  changeQty: (key: string, delta: number) => void;
  removeLine: (key: string) => void;
  clearCart: () => void;
  submit: () => void;
  submitting: boolean;
  formatCurrency: (n: number) => string;
  variantLabel: (v: Variant) => string;
  justAdded?: string | null;
  selectedCustomer?: Customer | null;
  openCustomer?: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const empty = cart.length === 0;

  useEffect(() => {
    if (justAdded) {
      const el = document.querySelector(`[data-cart-key="${justAdded}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }, [justAdded]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {!compact && (
        <div className="px-5 pt-5 pb-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <ShoppingBag className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold leading-tight">{t("app.pos.mobile.orderSummary")}</h2>
              <p className="text-[11px] text-muted-foreground">
                {t("app.pos.mobile.itemCount", { count: cart.length })}
              </p>
            </div>
          </div>
          {!empty && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 text-xs"
              onClick={clearCart}
            >
              {t("app.pos.mobile.clearAll")}
            </Button>
          )}
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="px-5 py-3 space-y-2.5">
          {empty ? (
            <div className="text-center py-16 text-sm text-muted-foreground">
              <ShoppingBag className="h-10 w-10 mx-auto mb-3 opacity-30" />
              {t("app.pos.mobile.emptyCart")}
            </div>
          ) : (
            cart.map((l) => (
              <div
                key={l.key}
                data-cart-key={l.key}
                className="flex items-center gap-3 p-2 rounded-2xl bg-muted/30"
              >
                  <div className="h-12 w-12 shrink-0 rounded-xl bg-muted overflow-hidden">
                    <MenuImage src={toCdnUrl(l.image_url)} alt="" fallback={null} />
                 </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate leading-tight">{l.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {variantLabel(l.variant) || formatCurrency(l.price)}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-7 w-7 rounded-full"
                    onClick={() => changeQty(l.key, -1)}
                    aria-label={t("app.pos.mobile.decrease")}
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                  <span className="w-5 text-center text-sm font-semibold tabular-nums">
                    {l.qty}
                  </span>
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-7 w-7 rounded-full"
                    onClick={() => changeQty(l.key, 1)}
                    aria-label={t("app.pos.mobile.increase")}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
                {(() => {
                  const line = splitListed(
                    lineGross(l.price, l.qty),
                    vatPercent / 100,
                    pricesInclusive,
                  );
                  return (
                    <div className="w-24 text-end tabular-nums">
                      <div className="text-sm font-bold text-primary">
                        {formatCurrency(line.gross)}
                      </div>
                      <div className="text-[10px] leading-tight text-muted-foreground">
                         {formatCurrency(line.net)} {t("app.pos.mobile.net")}
                      </div>
                      <div className="text-[10px] leading-tight text-muted-foreground">
                         +{formatCurrency(line.vat)} {t("app.pos.mobile.vat")}
                      </div>
                    </div>
                  );
                })()}
                <button
                  onClick={() => removeLine(l.key)}
                  className="text-muted-foreground hover:text-destructive p-1"
                  aria-label={t("app.pos.mobile.remove")}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      <div className="border-t bg-background px-5 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] space-y-2">
        <div className="rounded-2xl bg-muted/30 p-4 space-y-2">
          <Row label={t("app.pos.mobile.subtotal")} value={formatCurrency(subtotal)} />
          <Row label={`${t("app.pos.mobile.vat")} (${vatPercent}%)`} value={formatCurrency(vat)} />
          <div className="h-px bg-border my-1" />
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-semibold">{t("app.pos.mobile.total")}</span>
            <span className="text-2xl font-bold text-primary tabular-nums">
              {formatCurrency(total)}
            </span>
          </div>
        </div>

        <div>
          <p className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase mb-1">
             {t("app.pos.mobile.paymentMethod")}
          </p>
          <div className="grid grid-cols-3 gap-2">
            <PayButton
              active={payment === "cash"}
              onClick={() => setPayment("cash")}
              icon={<Banknote className="h-4 w-4" />}
              label={t("app.sales.paymentMethods.cash")}
            />
            <PayButton
              active={payment === "card"}
              onClick={() => setPayment("card")}
              icon={<CreditCard className="h-4 w-4" />}
              label={t("app.sales.paymentMethods.card")}
            />
            <PayButton
              active={payment === "other"}
              onClick={() => setPayment("other")}
              icon={<MoreHorizontal className="h-4 w-4" />}
              label={t("app.sales.paymentMethods.other")}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="flex items-center gap-2.5 text-sm cursor-pointer select-none">
            <Checkbox
              checked={unpaid}
              onCheckedChange={(v) => setUnpaid(v === true)}
            />
            <span className="text-foreground">{t("app.pos.mobile.unpaid")}</span>
          </label>
          {unpaid && (
            <button
              type="button"
              onClick={openCustomer}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 rounded-xl border text-start transition-colors",
                selectedCustomer
                  ? "border-primary/30 bg-primary/5"
                  : "border-dashed border-destructive/50 bg-destructive/5",
              )}
            >
              <User className="h-4 w-4 text-primary shrink-0" />
              {selectedCustomer ? (
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate">{selectedCustomer.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">
                     {selectedCustomer.phone || t("app.pos.mobile.noPhone")}
                  </p>
                </div>
              ) : (
                <span className="text-xs font-medium text-destructive">{t("app.pos.mobile.selectCustomer")}</span>
              )}
              <span className="text-[10px] text-muted-foreground ms-auto">{t("app.pos.mobile.change")}</span>
            </button>
          )}
        </div>

        <Button
          onClick={submit}
          disabled={submitting || empty}
          className="w-full h-14 rounded-2xl text-base font-semibold"
        >
          {submitting ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <>{t("app.pos.mobile.recordSale")} - {formatCurrency(total)}</>
          )}
        </Button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

function CheckRow({
  label,
  description,
  status,
  okIcon,
  failIcon,
}: {
  label: string;
  description: string;
  status: boolean | null;
  okIcon: React.ReactNode;
  failIcon: React.ReactNode;
}) {
  if (status === null) {
    return (
      <div className="flex items-center gap-3 p-2.5 rounded-xl bg-muted/30 opacity-60">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <div className="flex-1">
          <p className="text-sm font-medium">{label}</p>
          <p className="text-[11px] text-muted-foreground">{description}</p>
        </div>
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex items-center gap-3 p-2.5 rounded-xl border",
        status
          ? "bg-emerald-500/5 border-emerald-500/20"
          : "bg-destructive/5 border-destructive/20",
      )}
    >
      <span className={cn("shrink-0", status ? "text-emerald-600" : "text-destructive")}>
        {status ? okIcon : failIcon}
      </span>
      <div className="flex-1">
        <p className={cn("text-sm font-medium", status ? "text-emerald-700" : "text-destructive")}>
          {label}
        </p>
        <p className="text-[11px] text-muted-foreground">{description}</p>
      </div>
      {status ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
      ) : (
        <XCircle className="h-4 w-4 text-destructive shrink-0" />
      )}
    </div>
  );
}