import { useState, useMemo, useCallback, useRef } from "react";
import { useMoyasarCheckout } from "@/components/pos/MoyasarCheckout";
import { qk } from "@/lib/query/queryKeys";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { useBranch } from "@/contexts/BranchContext";
import { useBranchPrices, applyBranchPrices } from "@/hooks/useBranchPrices";
import { useBranchItemCategories } from "@/hooks/useBranchItemCategories";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Plus, Minus, ShoppingCart, Receipt, Trash2, CreditCard, Banknote, Wallet, QrCode, ImageIcon, Search, Info, UtensilsCrossed, SplitSquareHorizontal } from "lucide-react";
import { QRScanner } from "./QRScanner";
import { usePOSHardware } from "@/hooks/usePOSHardware";
import { recordOfflineSale } from "@/lib/offline/posService";
import { quoteSale, recordSale, type CardTerminalApproval, type PriceChangedDetails, type RecordSaleInput, type SaleLineSize, type SaleTender } from "@/lib/api/pos";
import { ApiError } from "@/lib/api/http";
import { isOnline as isPosOnline } from "@/lib/offline/connectivity";
import { useBranchVatRate } from "@/hooks/useBranchVatRate";
import { PricingBranchBanner } from "@/components/pos/PricingBranchBanner";
import { lineGross, roundMoney, splitListed, sumMoney } from "@/lib/vatInclusive";
import { useTranslation } from "react-i18next";

interface CartItem {
  menuItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  size?: "quarter" | "half" | "full";
  imageUrl?: string | null;
}

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

type TenderMethod = "cash" | "card" | "other";

/** One tender of a split payment, as the cashier enters it. */
interface DraftTender {
  id: string;
  method: TenderMethod;
  /** Amount of the sale this tender pays (text input). */
  amount: string;
  /** Cash only: what the customer handed over (change = tendered - amount). */
  tendered: string;
  /** Set once the terminal approved this tender; it is not charged again on retry. */
  approval?: CardTerminalApproval | null;
}

const money = (v: string) => roundMoney(parseFloat(v) || 0);

interface QRData {
  restaurantId: string;
  menuItemId: string;
  name: string;
  size: "quarter" | "half" | "full";
  price: number;
}

export function SalesRecorder() {
  const { t } = useTranslation();
  const { restaurant, user } = useAuth();
  const { format: formatCurrency } = useCurrency();
  const { settings: posSettings } = usePOSHardware();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<TenderMethod | "split">("cash");
  const [tenders, setTenders] = useState<DraftTender[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  // Fetch menu items
  const { activeBranchId, isAllBranches, activeBranch } = useBranch();
  const moyasar = useMoyasarCheckout(activeBranchId ?? null);
  const moyasarPaidRef = useRef<{ intentId: string; amount: number } | null>(null);
  // Deferred until the dialog opens: passing null keeps these branch lookups
  // (prices, VAT, per-branch categories) idle while the dashboard loads.
  const priceBranchId = isOpen && !isAllBranches ? activeBranchId : null;
  const { priceMap } = useBranchPrices(priceBranchId);
  const { vatRate, pricesInclusive } = useBranchVatRate(priceBranchId);

  const { data: rawMenuItems = [], isLoading } = useQuery({
    queryKey: ["menu-items-for-sale", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await db
        .from("menu_items")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .eq("is_active", true)
        .order("category", { ascending: true });
      if (error) throw error;
      return data as MenuItem[];
    },
    // Only fetch once the POS dialog is actually opened — this component renders
    // a single button on the dashboard, so eager fetching stalled first paint.
    enabled: !!restaurant?.id && isOpen,
    staleTime: 60 * 1000,
  });

  const menuItems = useMemo(
    () => applyBranchPrices(rawMenuItems as any, priceMap) as MenuItem[],
    [rawMenuItems, priceMap]
  );

  // Apply per-branch category placement so an item moved at this branch shows
  // under its branch category, while other branches keep the master one.
  const { categoryMap: branchCategoryMap } = useBranchItemCategories(priceBranchId);
  const categoryOf = (item: MenuItem) =>
    branchCategoryMap[item.id] || item.category || "other";

  // Fetch active shifts for association
  const { data: activeShifts = [] } = useQuery({
    queryKey: ["active-shifts-for-sale", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await db
        .from("shifts")
        .select("id, opened_at, drawer_id")
        .eq("restaurant_id", restaurant.id)
        .eq("status", "open")
        .order("opened_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!restaurant?.id && isOpen,
    staleTime: 30 * 1000,
  });

  // Record sale mutation with inventory auto-deduction
  const recordSaleMutation = useMutation({
    mutationFn: async () => {
      if (!restaurant?.id || !user?.id || cart.length === 0) {
        throw new Error("Missing required data");
      }

      const listedTotal = sumMoney(cart.map((item) => lineGross(item.unitPrice, item.quantity)));
      const { net: subtotal, vat: tax, gross: total } = splitListed(
        listedTotal,
        vatRate,
        pricesInclusive,
      );
      const shiftId = activeShifts[0]?.id || null;
      // One key per checkout, shared by the online attempt and the offline queue.
      const saleKey = crypto.randomUUID();
      const split = paymentMethod === "split";
      const order = {
        restaurantId: restaurant.id,
        branchId: priceBranchId ?? null,
        shiftId,
        ...(split ? {} : { paymentMethod }),
        lines: cart.map((c) => ({ menuItemId: c.menuItemId, size: (c.size ?? "regular") as SaleLineSize, quantity: c.quantity, unitPrice: c.unitPrice })),
      };

      // Split tender: the entered tenders must cover the total exactly before anything is charged.
      const parts = split
        ? tenders.map((d) => ({ ...d, amt: money(d.amount) })).filter((d) => d.amt > 0)
        : [];
      if (split && (parts.length < 2 || Math.abs(sumMoney(parts.map((p) => p.amt)) - total) >= 0.005)) {
        throw new Error(t("app.pos.recorder.splitIncomplete"));
      }
      const toPayments = (): SaleTender[] =>
        parts.map((p) => ({
          method: p.method,
          amount: p.amt,
          tendered: p.method === "cash" && p.tendered.trim() ? money(p.tendered) : null,
          cardTerminal: p.method === "card" ? p.approval ?? null : null,
        }));

      const queueOffline = async () => {
        const result = await recordOfflineSale({
          branchId: restaurant.id,
          saleBranchId: priceBranchId ?? null,
          idempotencyKey: saleKey,
          cashierId: user.id,
          shiftId,
          paymentMethod: split ? "split" : paymentMethod,
          payments: split
            ? toPayments().map((p) => ({
                method: p.method,
                amount: p.amount,
                tendered: p.tendered ?? null,
                cardTerminal: p.cardTerminal?.provider === "hala" ? { ...p.cardTerminal, provider: "hala" as const } : null,
              }))
            : null,
          vatRate,
          pricesVatInclusive: pricesInclusive,
          branchName: activeBranch?.name ?? null,
          items: cart.map((c) => ({
            menu_item_id: c.menuItemId,
            name: c.name,
            size: c.size ?? "regular",
            quantity: c.quantity,
            unit_price: c.unitPrice,
          })),
        });
        return { receiptNumber: result.receiptNumber, total, offline: true as const };
      };

      // ── Offline guardrail ────────────────────────────────────────────
      // If the device is offline, queue the sale to IndexedDB instead of
      // letting the Pay button spin; the sync engine drains it later.
      const browserOffline =
        typeof navigator !== "undefined" && navigator.onLine === false;
      if (browserOffline || !isPosOnline()) return queueOffline();

      const applyCurrentPrices = (current: { menuItemId: string; size: string; current: number }[]) => {
        setCart((prev) =>
          prev.map((c) => {
            const hit = current.find((l) => l.menuItemId === c.menuItemId && l.size === (c.size ?? "regular"));
            return hit ? { ...c, unitPrice: hit.current } : c;
          }),
        );
        void queryClient.invalidateQueries({ queryKey: ["branch-menu-prices"] });
        return new Error("Prices changed since the menu was loaded. The cart now shows the current prices; check the total and charge again.");
      };

      // If paying by card and the Hala terminal is enabled, charge the server's quoted total
      // first and only record the sale on an approved response, so the card and the receipt
      // always show the same amount.
      let cardTerminal: RecordSaleInput["cardTerminal"] = null;
      if (split) {
        // Each card tender is charged on the terminal for its own amount. A declined card
        // stops here: tenders already approved keep their approval, the cashier changes the
        // declined one and pays the rest.
        const integrated = posSettings?.hala_enabled ? "hala" : moyasar.enabled ? "moyasar" : null;
        const toCharge = integrated ? parts.filter((p) => p.method === "card" && !p.approval) : [];
        if (toCharge.length) {
          const quote = await quoteSale(order);
          const stale = quote.lines
            .map((q, i) => ({ menuItemId: q.menuItemId, size: q.size, shown: order.lines[i].unitPrice, current: q.unitPrice }))
            .filter((l) => Math.abs(l.shown - l.current) >= 0.005);
          if (stale.length) throw applyCurrentPrices(stale);
          if (Math.abs(quote.total - total) >= 0.005) throw new Error(t("app.pos.recorder.splitIncomplete"));
        }
        for (const p of toCharge) {
          let approval: CardTerminalApproval;
          if (integrated === "hala") {
            toast.info("Sending amount to Hala terminal...", { id: "hala-charge" });
            const { data, error } = await db.functions.invoke("charge-hala-card", {
              body: {
                amount: p.amt,
                currency: "SAR",
                terminalId: posSettings!.hala_terminal_id,
                receiptNumber: `POS-${saleKey.slice(0, 8)}-${p.id.slice(0, 4)}`,
                mock: posSettings!.hala_mock_mode ?? true,
                approveProbability: posSettings!.hala_approve_probability ?? 0.9,
              },
            });
            toast.dismiss("hala-charge");
            if (error) throw new Error(`Hala terminal error: ${error.message}`);
            if (data?.status !== "approved") {
              throw new Error(
                data?.status === "declined"
                  ? `Card declined for ${formatCurrency(p.amt)}${data?.message ? ` - ${data.message}` : ""}. Change that payment and pay the rest.`
                  : `Hala terminal did not approve ${formatCurrency(p.amt)}`,
              );
            }
            approval = { provider: "hala", status: data.status, reference: data.reference ?? null, response: data };
          } else {
            const intentId = await moyasar.charge({ amount: p.amt, branchId: activeBranchId ?? null, description: `${restaurant?.name ?? "Matbex"} POS` });
            approval = { provider: "moyasar", status: "approved", reference: intentId };
          }
          p.approval = approval;
          setTenders((prev) => prev.map((d) => (d.id === p.id ? { ...d, approval } : d)));
        }
      } else if (paymentMethod === "card" && posSettings?.hala_enabled) {
        const quote = await quoteSale(order);
        const stale = quote.lines
          .map((q, i) => ({ menuItemId: q.menuItemId, size: q.size, shown: order.lines[i].unitPrice, current: q.unitPrice }))
          .filter((l) => Math.abs(l.shown - l.current) >= 0.005);
        if (stale.length) throw applyCurrentPrices(stale);

        toast.info("Sending amount to Hala terminal...", { id: "hala-charge" });
        const { data, error } = await db.functions.invoke("charge-hala-card", {
          body: {
            amount: quote.total,
            currency: "SAR",
            terminalId: posSettings.hala_terminal_id,
            receiptNumber: `POS-${saleKey.slice(0, 8)}`,
            mock: posSettings.hala_mock_mode ?? true,
            approveProbability: posSettings.hala_approve_probability ?? 0.9,
          },
        });
        toast.dismiss("hala-charge");

        if (error) {
          throw new Error(`Hala terminal error: ${error.message}`);
        }
        if (data?.status !== "approved") {
          throw new Error(
            data?.status === "declined"
              ? `Card declined by Hala terminal${data?.message ? ` - ${data.message}` : ""}`
              : `Hala terminal did not approve the charge`
          );
        }
        cardTerminal = { provider: "hala", status: data.status, reference: data.reference ?? null, response: data };
      } else if (paymentMethod === "card" && moyasar.enabled) {
        // Moyasar: the customer pays the server's quoted total by QR; the sales API checks it again.
        const quote = await quoteSale(order);
        const stale = quote.lines
          .map((q, i) => ({ menuItemId: q.menuItemId, size: q.size, shown: order.lines[i].unitPrice, current: q.unitPrice }))
          .filter((l) => Math.abs(l.shown - l.current) >= 0.005);
        if (stale.length) throw applyCurrentPrices(stale);
        const kept = moyasarPaidRef.current;
        const intentId = kept && Math.abs(kept.amount - quote.total) < 0.005
          ? kept.intentId
          : await moyasar.charge({ amount: quote.total, branchId: activeBranchId ?? null, description: `${restaurant?.name ?? "Matbex"} POS` });
        moyasarPaidRef.current = { intentId, amount: quote.total };
        cardTerminal = { provider: "moyasar", status: "approved", reference: intentId };
      }

      // One server transaction (POST /api/v1/pos/sales): sale, lines, cash event, stock
      // (database trigger, once), food-cost usage, reorder requests, kitchen ticket.
      let saved;
      try {
        saved = await recordSale(
          split ? { ...order, payments: toPayments() } : { ...order, cardTerminal },
          { idempotencyKey: saleKey },
        );
      } catch (error) {
        // Online-only card approvals (Moyasar) cannot be queued; terminal (Hala) ones can.
        const onlineOnly = split ? parts.some((p) => p.approval?.provider === "moyasar") : !!cardTerminal;
        if (!(error instanceof ApiError) && !onlineOnly) return queueOffline();
        if (error instanceof ApiError && error.code === "price_changed") {
          throw applyCurrentPrices((error.details as PriceChangedDetails | undefined)?.lines ?? []);
        }
        throw error;
      }
      moyasarPaidRef.current = null;
      return {
        transaction: saved.transaction,
        lowStockItems: saved.lowStock.map((l) => ({ name: l.name, newStock: l.currentStock, reorderLevel: l.reorderLevel })),
      };
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: qk.dailyProfit.entityAll("sales") });
      queryClient.invalidateQueries({ queryKey: qk.dailyProfit.entityAll("sales-items") });
      queryClient.invalidateQueries({ queryKey: ["reports-sales"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-usage"] });
      queryClient.invalidateQueries({ queryKey: ["reorder-requests"] });
      setCart([]);
      setTenders([]);
      setIsOpen(false);
      if (result?.offline) {
        toast.success(`Queued offline · ${result.receiptNumber}`, {
          description: "Will sync automatically when back online.",
        });
        return;
      }
      toast.success("Sale recorded & inventory updated");
      
      if (result?.lowStockItems && result.lowStockItems.length > 0) {
        for (const item of result.lowStockItems) {
          toast.warning(`Low stock: ${item.name}`, {
            description: `Stock: ${item.newStock.toFixed(1)} (reorder at ${item.reorderLevel})`,
            duration: 8000,
          });
        }
        toast.info("Reorder requests created", {
          description: `${result.lowStockItems.length} item(s) need restocking`,
        });
      }
    },
    onError: (error) => {
      console.error("Sale error:", error);
      toast.error(error instanceof Error && error.message ? error.message : "Failed to record sale");
    },
  });

  // Get unique categories
  const categories = useMemo(() => {
    const cats = [...new Set(menuItems.map((item) => categoryOf(item)))];
    return cats.sort();
  }, [menuItems, branchCategoryMap]);

  // Filter menu items by search and category
  const filteredItems = useMemo(() => {
    let items = menuItems;
    if (selectedCategory !== "all") {
      items = items.filter((item) => categoryOf(item) === selectedCategory);
    }
    if (searchTerm) {
      items = items.filter((item) =>
        item.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    return items;
  }, [menuItems, searchTerm, selectedCategory, branchCategoryMap]);

  // Group by category
  const groupedItems = useMemo(() => {
    return filteredItems.reduce((acc, item) => {
      const cat = categoryOf(item);
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(item);
      return acc;
    }, {} as Record<string, MenuItem[]>);
  }, [filteredItems, branchCategoryMap]);

  // Cart operations
  const addToCart = (item: MenuItem, size?: "quarter" | "half" | "full", priceOverride?: number) => {
    let price = priceOverride ?? Number(item.full_price || item.selling_price);
    if (size === "quarter" && item.quarter_price > 0) price = item.quarter_price;
    if (size === "half" && item.half_price > 0) price = item.half_price;
    if (size === "full" && item.full_price > 0) price = item.full_price;
    
    setCart((prev) => {
      const existing = prev.find((c) => 
        size ? (c.menuItemId === item.id && c.size === size) : (c.menuItemId === item.id && !c.size)
      );
      if (existing) {
        return prev.map((c) =>
          (size ? (c.menuItemId === item.id && c.size === size) : (c.menuItemId === item.id && !c.size))
            ? { ...c, quantity: c.quantity + 1 }
            : c
        );
      }
      return [...prev, {
        menuItemId: item.id,
        name: item.name,
        quantity: 1,
        unitPrice: price,
        size,
        imageUrl: item.image_url,
      }];
    });
  };

  // Handle QR scan
  const handleQRScan = useCallback((data: QRData) => {
    const item = menuItems.find((m) => m.id === data.menuItemId);
    if (item) {
      addToCart(item, data.size, data.price);
    } else {
      setCart((prev) => {
        const existing = prev.find((c) => c.menuItemId === data.menuItemId && c.size === data.size);
        if (existing) {
          return prev.map((c) =>
            c.menuItemId === data.menuItemId && c.size === data.size
              ? { ...c, quantity: c.quantity + 1 }
              : c
          );
        }
        return [...prev, {
          menuItemId: data.menuItemId,
          name: data.name,
          quantity: 1,
          unitPrice: data.price,
          size: data.size,
        }];
      });
    }
  }, [menuItems]);

  const updateQuantity = (menuItemId: string, delta: number, size?: "quarter" | "half" | "full") => {
    setCart((prev) =>
      prev
        .map((c) =>
          (size ? (c.menuItemId === menuItemId && c.size === size) : (c.menuItemId === menuItemId && !c.size))
            ? { ...c, quantity: Math.max(0, c.quantity + delta) }
            : c
        )
        .filter((c) => c.quantity > 0)
    );
  };

  const removeFromCart = (menuItemId: string, size?: "quarter" | "half" | "full") => {
    setCart((prev) => prev.filter((c) => 
      !(c.menuItemId === menuItemId && c.size === size)
    ));
  };

  const getCartItemKey = (item: CartItem) => `${item.menuItemId}-${item.size || "default"}`;

  const cartTotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  // What the guest pays (VAT-inclusive, same rounding as the server): split tenders add up to it.
  const payTotal = useMemo(
    () => splitListed(sumMoney(cart.map((item) => lineGross(item.unitPrice, item.quantity))), vatRate, pricesInclusive).gross,
    [cart, vatRate, pricesInclusive],
  );
  const tenderSum = sumMoney(tenders.map((d) => money(d.amount)));
  const remaining = roundMoney(payTotal - tenderSum);
  const splitReady =
    tenders.filter((d) => money(d.amount) > 0).length >= 2 && Math.abs(remaining) < 0.005 &&
    tenders.every((d) => d.method !== "cash" || !d.tendered.trim() || money(d.tendered) >= money(d.amount));
  const addTender = (method: TenderMethod, amount: number) =>
    setTenders((prev) => [...prev, { id: crypto.randomUUID(), method, amount: amount > 0 ? amount.toFixed(2) : "", tendered: "" }]);
  const updateTender = (id: string, patch: Partial<DraftTender>) =>
    setTenders((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const cartItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  // Check if item has size variants
  const hasVariants = (item: MenuItem) => item.quarter_price > 0 || item.half_price > 0;

  return (
    <>
    {moyasar.dialog}
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-9 gap-2">
          <ShoppingCart className="h-4 w-4" />
          <span className="hidden md:inline">{t("app.dashboard.actions.recordSale")}</span>
          {cartItemCount > 0 && (
            <Badge variant="secondary" className="ms-1">
              {cartItemCount}
            </Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent
        description={
          cartItemCount > 0
            ? t("app.pos.recorder.descriptionWithCart", { count: cartItemCount, total: formatCurrency(cartTotal) })
            : t("app.pos.recorder.description")
        }
        className="max-w-5xl max-h-[90vh] p-0"
      >
        <div className="flex flex-col lg:flex-row h-[85vh]">
          {/* Menu Items Section */}
          <div className="flex-1 flex flex-col border-e">
            <DialogHeader className="px-4 py-3 border-b">
              <div className="flex items-center justify-between">
                <DialogTitle className="flex items-center gap-2">
                  <Receipt className="h-5 w-5" />
                  {t("app.dashboard.actions.recordSale")}
                </DialogTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsScannerOpen(true)}
                  className="gap-2"
                >
                  <QrCode className="h-4 w-4" />
                  {t("app.pos.scanQr")}
                </Button>
              </div>
            </DialogHeader>

            <PricingBranchBanner />

            {/* Search and Filter */}
            <div className="px-4 py-3 border-b space-y-3">
              <div className="relative">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t("app.pos.search.items")}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="ps-9"
                />
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant={selectedCategory === "all" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedCategory("all")}
                  className="h-7 text-xs"
                >
                  {t("app.pos.recorder.all")}
                </Button>
                {categories.map((cat) => (
                  <Button
                    key={cat}
                    variant={selectedCategory === cat ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedCategory(cat)}
                    className="h-7 text-xs capitalize"
                  >
                    {cat}
                  </Button>
                ))}
              </div>
            </div>

            {/* Menu Items Grid */}
            <ScrollArea className="flex-1 p-4">
              {isLoading ? (
                <p className="text-sm text-muted-foreground text-center py-8">{t("common.loading")}</p>
              ) : menuItems.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-muted-foreground">{t("app.pos.recorder.noItems")}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("app.pos.recorder.addItemsHelp")}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {filteredItems.map((item) => {
                    const inCart = cart.filter((c) => c.menuItemId === item.id);
                    const totalInCart = inCart.reduce((sum, c) => sum + c.quantity, 0);
                    const itemHasVariants = hasVariants(item);
                    
                    return (
                      <div 
                        key={item.id}
                        className={`bg-card text-card-foreground rounded-xl overflow-hidden shadow-sm border border-border/80 transition-all hover:border-primary/25 hover:shadow-lg ${
                          totalInCart > 0 ? "ring-2 ring-primary" : ""
                        }`}
                      >
                        {/* Large product image */}
                        <div className="aspect-square bg-muted relative overflow-hidden">
                          {item.image_url ? (
                            <img
                              src={item.image_url}
                              alt={item.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-muted/50">
                              <UtensilsCrossed className="h-12 w-12 text-muted-foreground/40" />
                            </div>
                          )}
                          
                          {/* Cart badge overlay */}
                          {totalInCart > 0 && (
                            <Badge className="absolute top-2 end-2 h-6 min-w-6 text-sm">
                              {totalInCart}
                            </Badge>
                          )}
                        </div>
                        
                        {/* Item details */}
                        <div className="p-3">
                          <p className="font-medium text-sm line-clamp-2 mb-2 min-h-[2.5rem]" title={item.name}>
                            {item.name}
                          </p>
                          
                          {/* Price and Add button */}
                          {itemHasVariants ? (
                            <div className="space-y-1.5">
                              <div className="flex gap-1.5">
                                {item.quarter_price > 0 && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => addToCart(item, "quarter")}
                                    className="flex-1 h-7 text-xs px-1"
                                  >
                                    {t("app.pos.recorder.quarter")}
                                  </Button>
                                )}
                                {item.half_price > 0 && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => addToCart(item, "half")}
                                    className="flex-1 h-7 text-xs px-1"
                                  >
                                    {t("app.pos.recorder.half")}
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  onClick={() => addToCart(item, "full")}
                                  className="flex-1 h-7 text-xs px-1"
                                >
                                  {t("app.pos.recorder.full")}
                                </Button>
                              </div>
                              <p className="text-sm font-bold text-foreground text-center">
                                {formatCurrency(item.full_price || item.selling_price)}
                              </p>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-sm text-foreground">
                                {formatCurrency(item.full_price || item.selling_price)}
                              </span>
                              <Button
                                size="sm"
                                onClick={() => addToCart(item)}
                                className="h-7 px-3 text-xs"
                              >
                                {t("app.pos.recorder.add")}
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </div>

          {/* Cart Section */}
          <div className="w-full lg:w-80 flex flex-col bg-muted/30">
            <div className="px-4 py-3 border-b bg-card">
              <h3 className="font-semibold flex items-center gap-2">
                <ShoppingCart className="h-4 w-4" />
                {t("app.pos.cart.title")} ({cartItemCount})
              </h3>
            </div>

            <ScrollArea className="flex-1 p-4">
              {cart.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  {t("app.pos.recorder.emptyCart")}
                </p>
              ) : (
                <div className="space-y-3">
                  {cart.map((item) => (
                    <div
                      key={getCartItemKey(item)}
                      className="flex items-center gap-3 p-2 bg-card rounded-lg border border-border/60"
                    >
                      {/* Mini image */}
                      <div className="w-12 h-12 rounded-md overflow-hidden bg-muted flex-shrink-0">
                        {item.imageUrl ? (
                          <img
                            src={item.imageUrl}
                            alt={item.name}
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <ImageIcon className="h-5 w-5 text-muted-foreground/30" />
                          </div>
                        )}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {item.name}
                          {item.size && (
                            <span className="text-xs text-muted-foreground ms-1 capitalize">
                              ({item.size})
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatCurrency(item.unitPrice)}
                        </p>
                      </div>
                      
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => updateQuantity(item.menuItemId, -1, item.size)}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-6 text-center text-sm font-medium">
                          {item.quantity}
                        </span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => updateQuantity(item.menuItemId, 1, item.size)}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-destructive hover:text-destructive"
                          onClick={() => removeFromCart(item.menuItemId, item.size)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>

            {/* Checkout Section */}
            <div className="p-4 border-t bg-background space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t("app.pos.mobile.subtotal")}</span>
                <span className="text-lg font-semibold">{formatCurrency(cartTotal)}</span>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{t("app.pos.mobile.paymentMethod")}</label>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant={paymentMethod === "cash" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPaymentMethod("cash")}
                    className="h-9 gap-1.5"
                  >
                    <Banknote className="h-4 w-4" />
                    {t("app.sales.paymentMethods.cash")}
                  </Button>
                  <Button
                    variant={paymentMethod === "card" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPaymentMethod("card")}
                    className="h-9 gap-1.5"
                  >
                    <CreditCard className="h-4 w-4" />
                    {t("app.sales.paymentMethods.card")}
                  </Button>
                  <Button
                    variant={paymentMethod === "other" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPaymentMethod("other")}
                    className="h-9 gap-1.5"
                  >
                    <Wallet className="h-4 w-4" />
                    {t("app.sales.paymentMethods.other")}
                  </Button>
                  <Button
                    variant={paymentMethod === "split" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPaymentMethod("split")}
                    className="h-9 gap-1.5"
                  >
                    <SplitSquareHorizontal className="h-4 w-4" />
                    {t("app.pos.recorder.split")}
                  </Button>
                </div>
              </div>

              {paymentMethod === "split" && (
                <div className="space-y-2 rounded-lg border border-border/60 bg-card p-2">
                  <p className="text-xs text-muted-foreground">{t("app.pos.recorder.splitHelp")}</p>
                  {tenders.map((d) => {
                    const approved = !!d.approval;
                    const change = d.method === "cash" && d.tendered.trim() ? roundMoney(money(d.tendered) - money(d.amount)) : null;
                    return (
                      <div key={d.id} className="space-y-1 rounded-md border border-border/40 p-2">
                        <div className="flex items-center gap-1.5">
                          <Select value={d.method} disabled={approved} onValueChange={(v) => updateTender(d.id, { method: v as TenderMethod, tendered: "" })}>
                            <SelectTrigger className="h-8 w-24 text-xs" aria-label={t("app.pos.mobile.paymentMethod")}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="cash">{t("app.sales.paymentMethods.cash")}</SelectItem>
                              <SelectItem value="card">{t("app.sales.paymentMethods.card")}</SelectItem>
                              <SelectItem value="other">{t("app.sales.paymentMethods.other")}</SelectItem>
                            </SelectContent>
                          </Select>
                          <Input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            step="0.01"
                            className="h-8 text-xs"
                            aria-label={t("app.pos.recorder.amount")}
                            placeholder={t("app.pos.recorder.amount")}
                            value={d.amount}
                            disabled={approved}
                            onChange={(e) => updateTender(d.id, { amount: e.target.value })}
                          />
                          {approved ? (
                            <Badge variant="secondary" className="text-[10px]">{t("app.pos.recorder.approved")}</Badge>
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                              aria-label="Remove payment"
                              onClick={() => setTenders((prev) => prev.filter((x) => x.id !== d.id))}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                        {d.method === "cash" && (
                          <div className="flex items-center gap-1.5">
                            <Input
                              type="number"
                              inputMode="decimal"
                              min={0}
                              step="0.01"
                              className="h-8 text-xs"
                              aria-label={t("app.pos.recorder.tendered")}
                              placeholder={t("app.pos.recorder.tendered")}
                              value={d.tendered}
                              onChange={(e) => updateTender(d.id, { tendered: e.target.value })}
                            />
                            {change != null && (
                              <span className={`whitespace-nowrap text-xs ${change < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                                {t("app.pos.recorder.change")}: {formatCurrency(Math.max(0, change))}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{t("app.pos.recorder.remaining")}</span>
                    <span className={`font-semibold ${Math.abs(remaining) < 0.005 ? "" : "text-destructive"}`}>{formatCurrency(remaining)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" disabled={remaining <= 0} onClick={() => addTender("cash", remaining)}>
                      <Banknote className="h-3.5 w-3.5" />
                      {t("app.pos.recorder.restCash")}
                    </Button>
                    <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" disabled={remaining <= 0} onClick={() => addTender("card", remaining)}>
                      <CreditCard className="h-3.5 w-3.5" />
                      {t("app.pos.recorder.restCard")}
                    </Button>
                  </div>
                  <Button variant="ghost" size="sm" className="h-8 w-full gap-1 text-xs" onClick={() => addTender("cash", 0)}>
                    <Plus className="h-3.5 w-3.5" />
                    {t("app.pos.recorder.addTender")}
                  </Button>
                </div>
              )}

              <Button
                className="w-full h-11 gap-2"
                disabled={cart.length === 0 || recordSaleMutation.isPending || (paymentMethod === "split" && !splitReady)}
                onClick={() => recordSaleMutation.mutate()}
              >
                <Receipt className="h-4 w-4" />
                {recordSaleMutation.isPending
                  ? t("app.pos.recorder.processing")
                  : t("app.pos.recorder.pay", { total: formatCurrency(cartTotal) })}
              </Button>
            </div>
          </div>
        </div>

        {/* QR Scanner */}
        {restaurant?.id && (
          <QRScanner
            isOpen={isScannerOpen}
            onClose={() => setIsScannerOpen(false)}
            onScan={handleQRScan}
            restaurantId={restaurant.id}
          />
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}
