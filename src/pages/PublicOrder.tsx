import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ShoppingBag, Plus, Minus, Trash2, MapPin, Clock, Search, Flame, Star, ChefHat, Utensils, User, LayoutGrid, List } from "lucide-react";
import { toast } from "sonner";
import { computeDeliveryFee } from "@/lib/deliveryFee";
import { toCdnUrl } from "@/lib/imageCdn";
import { useCustomerAuth } from "@/hooks/useCustomerAuth";

interface CartItem {
  menu_item_id: string;
  name: string;
  variant: string | null;
  unit_price: number;
  qty: number;
  notes?: string;
}

const VARIANTS: { key: "quarter_price" | "half_price" | "full_price" | "selling_price"; label: string }[] = [
  { key: "selling_price", label: "Regular" },
  { key: "quarter_price", label: "Quarter" },
  { key: "half_price", label: "Half" },
  { key: "full_price", label: "Full" },
];

function fmt(n: number) {
  return `﷼ ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type FilterKey = "all" | "top" | "chef" | string;

export default function PublicOrder() {
  const { restaurantId } = useParams<{ restaurantId: string }>();
  const navigate = useNavigate();
  const customerAuth = useCustomerAuth();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkout, setCheckout] = useState(false);

  // Form
  const [orderType, setOrderType] = useState<"delivery" | "pickup">("pickup");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [notes, setNotes] = useState("");
  const [payment, setPayment] = useState<"cash" | "card">("cash");
  const [submitting, setSubmitting] = useState(false);

  // Prefill from signed-in customer
  useEffect(() => {
    if (customerAuth.customer) {
      setPhone((p) => p || customerAuth.customer!.phone);
      setName((n) => n || customerAuth.customer!.name || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerAuth.customer?.id]);

  const restaurant = useQuery({
    queryKey: ["public-restaurant", restaurantId],
    enabled: !!restaurantId,
    queryFn: async () => {
      const { data, error } = await (db as any)
        .from("restaurants_public")
        .select("id,name,currency")
        .eq("id", restaurantId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const settings = useQuery({
    queryKey: ["public-online-settings", restaurantId],
    enabled: !!restaurantId,
    queryFn: async () => {
      const { data, error } = await (db as any)
        // Public view without internal fields (rider commission); see migration 20261111113452.
        .from("storefront_settings")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const menu = useQuery({
    queryKey: ["public-menu", restaurantId],
    enabled: !!restaurantId,
    queryFn: async () => {
      const { data, error } = await db
        .from("menu_items")
        .select("*")
        .eq("restaurant_id", restaurantId!)
        .eq("is_active", true)
        .eq("available_online", true)
        .order("category");
      if (error) throw error;
      return data ?? [];
    },
  });

  const topSelling = useQuery({
    queryKey: ["public-top-selling", restaurantId],
    enabled: !!restaurantId,
    queryFn: async () => {
      const { data, error } = await (db as any).rpc("public_top_selling_items", {
        p_restaurant_id: restaurantId,
        p_limit: 12,
      });
      if (error) throw error;
      return (data ?? []) as { menu_item_id: string; sold_count: number }[];
    },
  });

  const topIds = useMemo(() => new Set((topSelling.data ?? []).filter(t => Number(t.sold_count) > 0).map(t => t.menu_item_id)), [topSelling.data]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("top");
  type ViewMode = "list" | "grid-2" | "grid-4";
  const [viewMode, setViewMode] = useState<ViewMode>("grid-2");
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 640);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    const s = settings.data;
    if (s) {
      if (s.accept_pickup) setOrderType("pickup");
      else if (s.accept_delivery) setOrderType("delivery");
    }
  }, [settings.data]);

  const categoryList = useMemo(() => {
    const set = new Set<string>();
    (menu.data ?? []).forEach((i: any) => set.add(i.category || "Other"));
    const arr = Array.from(set);
    // Keep "Main" first among categories
    arr.sort((a, b) => {
      if (a === "Main" && b !== "Main") return -1;
      if (b === "Main" && a !== "Main") return 1;
      return a.localeCompare(b);
    });
    return arr;
  }, [menu.data]);

  const categories = useMemo(() => {
    const items = menu.data ?? [];
    const q = search.trim().toLowerCase();
    const groups: Record<string, any[]> = {};
    for (const i of items) {
      if (q && !(i.name?.toLowerCase().includes(q) || i.description?.toLowerCase().includes(q))) continue;
      if (filter === "top" && !topIds.has(i.id)) continue;
      if (filter === "chef" && !i.is_chefs_special) continue;
      if (filter !== "all" && filter !== "top" && filter !== "chef") {
        if ((i.category || "Other") !== filter) continue;
      }
      const c = i.category || "Other";
      (groups[c] ||= []).push(i);
    }
    return groups;
  }, [menu.data, search, filter, topIds]);

  const subtotal = cart.reduce((s, c) => s + c.unit_price * c.qty, 0);
  const deliveryFee =
    orderType === "delivery"
      ? computeDeliveryFee(
          subtotal,
          (settings.data as any)?.delivery_fee_tiers,
          Number(settings.data?.delivery_fee_flat ?? 0),
        )
      : 0;
  const total = subtotal + deliveryFee;

  const addToCart = (item: any, variantKey: string, variantLabel: string, price: number) => {
    setCart((prev) => {
      const key = `${item.id}-${variantKey}`;
      const existing = prev.find((c) => `${c.menu_item_id}-${c.variant}` === key);
      if (existing) {
        return prev.map((c) => (c === existing ? { ...c, qty: c.qty + 1 } : c));
      }
      return [...prev, { menu_item_id: item.id, name: item.name, variant: variantLabel, unit_price: price, qty: 1 }];
    });
    toast.success(`${item.name} added`);
  };

  const updateQty = (idx: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((c, i) => (i === idx ? { ...c, qty: c.qty + delta } : c))
        .filter((c) => c.qty > 0)
    );
  };

  const submit = async () => {
    if (!restaurantId) return;
    if (!name.trim() || !phone.trim()) {
      toast.error("Name and phone are required");
      return;
    }
    if (orderType === "delivery" && !address.trim()) {
      toast.error("Delivery address is required");
      return;
    }
    if (cart.length === 0) {
      toast.error("Cart is empty");
      return;
    }
    const min = Number(settings.data?.min_order_amount ?? 0);
    if (subtotal < min) {
      toast.error(`Minimum order is ${fmt(min)}`);
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        restaurant_id: restaurantId,
        order_type: orderType,
        customer_name: name.trim(),
        customer_phone: phone.trim(),
        customer_email: email.trim() || null,
        delivery_address: orderType === "delivery" ? { line1: address, city } : null,
        delivery_notes: notes.trim() || null,
        subtotal,
        delivery_fee: deliveryFee,
        tax: 0,
        total,
        payment_method: payment,
      };
      const items = cart.map((c) => ({
        menu_item_id: c.menu_item_id,
        name_snapshot: c.name,
        variant: c.variant,
        qty: c.qty,
        unit_price: c.unit_price,
        line_total: c.unit_price * c.qty,
      }));
      const { data: orderId, error } = await (db as any).rpc("public_create_online_order", {
        p_payload: payload,
        p_items: items,
      });
      if (error) throw error;

      // Auto-link to signed-in customer account (best effort)
      if (customerAuth.isAuthenticated && orderId) {
        customerAuth
          .apiFetch("?action=link-order", { method: "POST", body: JSON.stringify({ order_id: orderId }) })
          .catch(() => {});
      }
      navigate(`/order/track/${orderId}`);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to place order");
    } finally {
      setSubmitting(false);
    }
  };

  if (restaurant.isLoading || settings.isLoading) {
    return <div className="p-8 text-center text-muted-foreground">Loading…</div>;
  }
  if (!restaurant.data) {
    return <div className="p-8 text-center">Restaurant not found</div>;
  }

  const closed = !settings.data?.accepting_orders;

  return (
    <div className="min-h-screen bg-muted/30 pb-28">
      {/* Hero */}
      <div className="relative bg-gradient-to-br from-primary/90 via-primary to-primary/70 text-primary-foreground">
        <div className="max-w-3xl mx-auto px-4 pt-8 pb-6">
          <div className="flex justify-end mb-2">
            {customerAuth.isAuthenticated ? (
              <Link
                to="/account"
                className="inline-flex items-center gap-1.5 rounded-full bg-background/15 hover:bg-background/25 px-3 py-1 text-xs backdrop-blur transition-colors"
              >
                <User className="h-3 w-3" />
                {customerAuth.customer?.name || "My account"}
              </Link>
            ) : (
              <Link
                to="/account/login?redirect=/account"
                className="inline-flex items-center gap-1.5 rounded-full bg-background/15 hover:bg-background/25 px-3 py-1 text-xs backdrop-blur transition-colors"
              >
                <User className="h-3 w-3" /> Sign in
              </Link>
            )}
          </div>
          <div className="flex items-center gap-3 mb-4">
            <div className="h-14 w-14 rounded-2xl bg-background/20 backdrop-blur flex items-center justify-center">
              <Utensils className="h-7 w-7" />
            </div>
            <div>
              <h1 className="text-2xl font-bold leading-tight">{restaurant.data.name}</h1>
              <p className="text-sm opacity-90">Order online · fresh & fast</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {settings.data?.accept_pickup && (
              <span className="inline-flex items-center gap-1 rounded-full bg-background/15 px-3 py-1 text-xs backdrop-blur">
                <Clock className="h-3 w-3" /> Pickup ~{settings.data?.prep_time_minutes ?? 30} min
              </span>
            )}
            {settings.data?.accept_delivery && (
              <span className="inline-flex items-center gap-1 rounded-full bg-background/15 px-3 py-1 text-xs backdrop-blur">
                <MapPin className="h-3 w-3" /> Delivery {fmt(Number(settings.data?.delivery_fee_flat ?? 0))}
              </span>
            )}
            {Number(settings.data?.min_order_amount ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-background/15 px-3 py-1 text-xs backdrop-blur">
                Min {fmt(Number(settings.data.min_order_amount))}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Sticky search + filters */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border shadow-sm">
        <div className="max-w-3xl mx-auto px-4 py-3 space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search dishes…"
                className="pl-9 h-11 rounded-full bg-muted/50 border-0"
              />
            </div>
            <div className="hidden sm:flex items-center bg-muted/50 rounded-full p-1 gap-0.5">
              {/* List */}
              <button
                onClick={() => setViewMode("list")}
                title="List"
                className={`inline-flex items-center justify-center h-9 px-3 rounded-full text-xs font-medium transition-all ${
                  viewMode === "list" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <List className="h-4 w-4" />
              </button>
              {/* Grid toggle */}
              <button
                onClick={() => {
                  if (viewMode === "list") setViewMode("grid-2");
                  else setViewMode(viewMode === "grid-2" ? "grid-4" : "grid-2");
                }}
                title={viewMode === "grid-4" ? "Grid 4 col" : "Grid 2 col"}
                className={`inline-flex items-center justify-center h-9 px-3 rounded-full text-xs font-medium transition-all ${
                  viewMode !== "list" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1 scrollbar-none">
            {[
              { key: "all", label: "All", icon: Utensils },
              { key: "top", label: "Top Selling", icon: Flame },
              { key: "chef", label: "Chef's Picks", icon: ChefHat },
              ...categoryList.map((c) => ({ key: c, label: c, icon: Star })),
            ].map((f) => {
              const Icon = f.icon;
              const active = filter === f.key;
              return (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`flex-shrink-0 inline-flex items-center gap-1.5 px-4 h-9 rounded-full text-sm font-medium transition-all capitalize ${
                    active
                      ? "bg-primary text-primary-foreground shadow-md scale-105"
                      : "bg-muted text-foreground hover:bg-muted/70"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-4 py-5">
        {closed && (
          <Card className="p-4 mb-4 border-destructive bg-destructive/10">
            <p className="font-medium">We're not accepting orders right now.</p>
            {settings.data?.storefront_message && (
              <p className="text-sm text-muted-foreground mt-1">{settings.data.storefront_message}</p>
            )}
          </Card>
        )}

        {Object.entries(categories).length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <Search className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>No dishes found.</p>
          </div>
        )}

        {Object.entries(categories).map(([cat, items]) => (
          <section key={cat} className="mb-8" ref={(el) => (sectionRefs.current[cat] = el)}>
            <h2 className="text-xl font-bold mb-4 capitalize flex items-center gap-2">
              {cat}
              <span className="text-xs font-normal text-muted-foreground">({items.length})</span>
            </h2>
            <div className={`grid gap-3 ${
              isMobile || viewMode === "list"
                ? "grid-cols-1"
                : viewMode === "grid-4"
                ? "grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
                : "grid-cols-2"
            }`}>
              {items.map((item: any) => {
                const variants = VARIANTS.filter((v) => Number(item[v.key]) > 0);
                const minPrice = Math.min(...variants.map((v) => Number(item[v.key])));
                const isTop = topIds.has(item.id);
                const isList = isMobile || viewMode === "list";
                return (
                  <Card key={item.id} className={`overflow-hidden border-border/60 hover:shadow-lg transition-shadow flex ${
                    isList ? "flex-row" : "flex-col"
                  }`}>
                    <div className={`relative bg-muted overflow-hidden ${
                      isList ? "w-28 sm:w-36 shrink-0 aspect-square" : "aspect-[4/3]"
                    }`}>
                      {item.image_url ? (
                        <img src={toCdnUrl(item.image_url) || ""} alt={item.name} loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center text-muted-foreground">
                          <Utensils className="h-10 w-10 opacity-30" />
                        </div>
                      )}
                      <div className="absolute top-2 left-2 flex gap-1">
                        {isTop && (
                          <Badge className="bg-orange-500 hover:bg-orange-500 text-white border-0 gap-1">
                            <Flame className="h-3 w-3" /> Top Seller
                          </Badge>
                        )}
                        {item.is_chefs_special && (
                          <Badge className="bg-amber-500 hover:bg-amber-500 text-white border-0 gap-1">
                            <ChefHat className="h-3 w-3" /> Chef's Pick
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="p-3 flex-1 flex flex-col">
                      <h3 className="font-semibold text-base leading-tight">{item.name}</h3>
                      {item.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{item.description}</p>
                      )}
                      <div className="mt-auto pt-3">
                        <div className="text-sm font-bold text-primary mb-2">
                          {variants.length > 1 ? `From ${fmt(minPrice)}` : fmt(minPrice)}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {variants.map((v) => (
                            <Button
                              key={v.key}
                              size="sm"
                              variant={variants.length === 1 ? "default" : "outline"}
                              disabled={closed}
                              onClick={() => addToCart(item, v.key, v.label, Number(item[v.key]))}
                              className="text-xs h-8 rounded-full gap-1 flex-1 min-w-0"
                            >
                              <Plus className="h-3 w-3" />
                              {variants.length === 1 ? "Add" : v.label}
                            </Button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>
        ))}
      </main>

      {/* Floating cart bar */}
      {cart.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-40 p-3 bg-gradient-to-t from-background via-background to-transparent pointer-events-none">
          <div className="max-w-3xl mx-auto pointer-events-auto">
            <button
              onClick={() => setCartOpen(true)}
              className="w-full flex items-center justify-between bg-primary text-primary-foreground rounded-2xl px-5 py-4 shadow-2xl shadow-primary/30 hover:scale-[1.01] active:scale-[0.99] transition-transform"
            >
              <div className="flex items-center gap-3">
                <div className="relative">
                  <ShoppingBag className="h-5 w-5" />
                  <span className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-background text-primary text-[10px] font-bold flex items-center justify-center">
                    {cart.reduce((s, c) => s + c.qty, 0)}
                  </span>
                </div>
                <span className="font-semibold">View cart</span>
              </div>
              <span className="font-bold">{fmt(subtotal)}</span>
            </button>
          </div>
        </div>
      )}

      <Sheet open={cartOpen} onOpenChange={setCartOpen}>
        <SheetContent className="w-full sm:max-w-md flex flex-col">
              <SheetHeader>
                <SheetTitle>{checkout ? "Checkout" : "Your cart"}</SheetTitle>
              </SheetHeader>
              <ScrollArea className="flex-1 -mx-6 px-6">
                {!checkout ? (
                  <div className="space-y-3 py-4">
                    {cart.length === 0 && (
                      <p className="text-sm text-muted-foreground">Cart is empty</p>
                    )}
                    {cart.map((c, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 border-b pb-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{c.name}</p>
                          <p className="text-xs text-muted-foreground">{c.variant} · {fmt(c.unit_price)}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => updateQty(i, -1)}>
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="w-6 text-center text-sm">{c.qty}</span>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => updateQty(i, 1)}>
                            <Plus className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCart((p) => p.filter((_, j) => j !== i))}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-4 py-4">
                    {settings.data?.accept_pickup && settings.data?.accept_delivery && (
                      <div>
                        <Label>Order type</Label>
                        <RadioGroup value={orderType} onValueChange={(v) => setOrderType(v as any)} className="flex gap-4 mt-2">
                          <div className="flex items-center gap-2">
                            <RadioGroupItem value="pickup" id="pickup" />
                            <Label htmlFor="pickup">Pickup</Label>
                          </div>
                          <div className="flex items-center gap-2">
                            <RadioGroupItem value="delivery" id="delivery" />
                            <Label htmlFor="delivery">Delivery</Label>
                          </div>
                        </RadioGroup>
                      </div>
                    )}
                    <div>
                      <Label>Full name *</Label>
                      <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
                    </div>
                    <div>
                      <Label>Phone *</Label>
                      <Input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} inputMode="tel" />
                    </div>
                    <div>
                      <Label>Email</Label>
                      <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={255} />
                    </div>
                    {orderType === "delivery" && (
                      <>
                        <div>
                          <Label>Address *</Label>
                          <Input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={255} />
                        </div>
                        <div>
                          <Label>City</Label>
                          <Input value={city} onChange={(e) => setCity(e.target.value)} maxLength={100} />
                        </div>
                      </>
                    )}
                    <div>
                      <Label>Notes</Label>
                      <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
                    </div>
                    <div>
                      <Label>Payment</Label>
                      <RadioGroup value={payment} onValueChange={(v) => setPayment(v as any)} className="flex gap-4 mt-2">
                        <div className="flex items-center gap-2">
                          <RadioGroupItem value="cash" id="cash" />
                          <Label htmlFor="cash">Cash on {orderType === "delivery" ? "delivery" : "pickup"}</Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <RadioGroupItem value="card" id="card" />
                          <Label htmlFor="card">Card on arrival</Label>
                        </div>
                      </RadioGroup>
                    </div>
                  </div>
                )}
              </ScrollArea>
              <div className="border-t pt-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Subtotal</span><span>{fmt(subtotal)}</span>
                </div>
                {orderType === "delivery" && (
                  <div className="flex justify-between text-sm">
                    <span>Delivery</span><span>{fmt(deliveryFee)}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold">
                  <span>Total</span><span>{fmt(total)}</span>
                </div>
                {!checkout ? (
                  <Button className="w-full" disabled={cart.length === 0 || closed} onClick={() => setCheckout(true)}>
                    Checkout
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setCheckout(false)}>Back</Button>
                    <Button className="flex-1" disabled={submitting} onClick={submit}>
                      {submitting ? "Placing…" : "Place order"}
                    </Button>
                  </div>
                )}
              </div>
            </SheetContent>
          </Sheet>
    </div>
  );
}