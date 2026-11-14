import { useEffect, useMemo, useState } from "react";
import { toCdnUrl } from "@/lib/imageCdn";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/integrations/db/client";
import { useQuery } from "@tanstack/react-query";
import { useCurrency } from "@/hooks/useCurrency";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Minus, ShoppingCart, Check, X, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

type CartLine = { id: string; name: string; price: number; qty: number };

/**
 * Self-Ordering Kiosk
 * - Large-touch, full-screen friendly
 * - Reads active menu items
 * - Places order via existing GuestOrder/online_orders flow
 * Designed for Android tablets in kiosk mode (PWA fullscreen).
 */
export default function Kiosk() {
  const { restaurant } = useAuth();
  const { format } = useCurrency();
  const nav = useNavigate();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [placing, setPlacing] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  // Try to hide cursor for kiosk mode
  useEffect(() => {
    document.documentElement.classList.add("kiosk-mode");
    return () => document.documentElement.classList.remove("kiosk-mode");
  }, []);

  const menu = useQuery({
    queryKey: ["kiosk-menu", restaurant?.id],
    enabled: !!restaurant?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await db
        .from("menu_items")
        .select("id,name,selling_price,full_price,half_price,quarter_price,category,image_url,is_active,available_online")
        .eq("restaurant_id", restaurant!.id)
        .eq("is_active", true)
        .eq("available_online", true)
        .order("category", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const categories = useMemo(() => {
    const cats = new Set<string>();
    (menu.data ?? []).forEach((m: any) => m.category && cats.add(m.category));
    return ["all", ...Array.from(cats)];
  }, [menu.data]);

  const visibleItems = useMemo(() => {
    const items = menu.data ?? [];
    if (activeCategory === "all") return items;
    return items.filter((m: any) => m.category === activeCategory);
  }, [menu.data, activeCategory]);

  const addToCart = (item: any) => {
    const price = Number(item.selling_price ?? item.full_price ?? 0);
    if (price <= 0) return;
    setCart((prev) => {
      const found = prev.find((l) => l.id === item.id);
      if (found) return prev.map((l) => (l.id === item.id ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { id: item.id, name: item.name, price, qty: 1 }];
    });
  };

  const changeQty = (id: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((l) => (l.id === id ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0)
    );
  };

  const total = cart.reduce((s, l) => s + l.price * l.qty, 0);

  const placeOrder = async () => {
    if (!restaurant?.id || cart.length === 0) return;
    setPlacing(true);
    try {
      // Create kiosk session
      const sessionRes: any = await db
        .from("kiosk_sessions" as any)
        .insert({
          restaurant_id: restaurant.id,
          status: "paying",
          cart: cart as any,
          total,
        })
        .select("id")
        .single();
      const sessionId = sessionRes?.data?.id;

      // Insert into online_orders queue for KDS via secured RPC
      const itemsPayload = cart.map((l) => ({
        menu_item_id: l.id,
        name_snapshot: l.name,
        qty: l.qty,
        unit_price: l.price,
        line_total: l.price * l.qty,
      }));
      const rpcRes: any = await db.rpc("public_create_online_order" as any, {
        p_payload: {
          restaurant_id: restaurant.id,
          channel: "qr",
          order_type: "pickup",
          customer_phone: "kiosk",
          customer_name: "Kiosk Order",
          subtotal: total,
          tax: 0,
          total: total,
          payment_method: "cash",
          external_payload: { source: "kiosk", items: cart },
        },
        p_items: itemsPayload,
      });
      if (rpcRes?.error) throw rpcRes.error;
      const orderId = rpcRes?.data;

      await db
        .from("kiosk_sessions" as any)
        .update({ status: "completed", order_id: orderId, ended_at: new Date().toISOString() })
        .eq("id", sessionId);

      setSuccess(orderId ?? "ok");
      setCart([]);
      setTimeout(() => setSuccess(null), 6000);
    } catch (e: any) {
      toast.error(e.message ?? "Order failed");
    } finally {
      setPlacing(false);
    }
  };

  if (success) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center gap-6 text-center p-8">
        <div className="w-32 h-32 rounded-full bg-primary/10 flex items-center justify-center">
          <Check className="w-16 h-16 text-primary" />
        </div>
        <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">Order placed!</h1>
        <p className="text-sm text-muted-foreground mt-1">Please pay at the counter.</p>
        <p className="text-lg text-muted-foreground font-mono">#{success.slice(0, 8)}</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 bg-background flex flex-col">
      <header className="flex items-center justify-between p-6 border-b">
        <Button variant="ghost" size="lg" onClick={() => nav(-1)}>
          <ArrowLeft className="w-6 h-6 mr-2" /> Exit kiosk
        </Button>
        <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">{restaurant?.name ?? "Order Here"}</h1>
        <div className="w-32" />
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Categories */}
        <aside className="w-48 border-r p-3 space-y-2 overflow-y-auto">
          {categories.map((c) => (
            <Button
              key={c}
              variant={activeCategory === c ? "default" : "ghost"}
              size="lg"
              className="w-full justify-start text-lg h-14"
              onClick={() => setActiveCategory(c)}
            >
              {c}
            </Button>
          ))}
        </aside>

        {/* Menu grid */}
        <ScrollArea className="flex-1 p-6">
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {visibleItems.map((item: any) => {
              const price = Number(item.selling_price ?? item.full_price ?? 0);
              return (
                <button
                  key={item.id}
                  onClick={() => addToCart(item)}
                  className="text-left active:scale-95 transition-transform"
                >
                  <Card className="overflow-hidden hover:border-primary/50 transition-colors h-full">
                    {item.image_url ? (
                      <div className="aspect-square bg-muted overflow-hidden">
                        <img
                          src={toCdnUrl(item.image_url) || ""}
                          alt={item.name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </div>
                    ) : (
                      <div className="aspect-square bg-gradient-to-br from-muted to-muted/40" />
                    )}
                    <div className="p-4">
                      <div className="text-xl font-medium leading-tight mb-1">{item.name}</div>
                      <div className="text-2xl font-light tabular-nums text-primary">
                        {format(price)}
                      </div>
                    </div>
                  </Card>
                </button>
              );
            })}
            {visibleItems.length === 0 && (
              <div className="col-span-full text-center text-muted-foreground py-16 text-xl">
                No items in this category.
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Cart */}
        <aside className="w-96 border-l flex flex-col">
          <div className="p-4 border-b flex items-center gap-2">
            <ShoppingCart className="w-5 h-5" />
            <h2 className="text-xl font-medium">Your order</h2>
            <Badge className="ml-auto">{cart.reduce((s, l) => s + l.qty, 0)} items</Badge>
          </div>
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-3">
              {cart.length === 0 && (
                <p className="text-muted-foreground text-center py-8">Tap items to add</p>
              )}
              {cart.map((l) => (
                <div key={l.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/40">
                  <div className="flex-1">
                    <div className="font-medium">{l.name}</div>
                    <div className="text-sm text-muted-foreground tabular-nums">
                      {format(l.price)} × {l.qty}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="icon" variant="outline" onClick={() => changeQty(l.id, -1)}>
                      <Minus className="w-4 h-4" />
                    </Button>
                    <span className="w-8 text-center font-medium">{l.qty}</span>
                    <Button size="icon" variant="outline" onClick={() => changeQty(l.id, 1)}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
          <div className="p-4 border-t space-y-3">
            <div className="flex justify-between text-2xl">
              <span>Total</span>
              <span className="font-semibold tabular-nums">{format(total)}</span>
            </div>
            <Button
              size="lg"
              className="w-full h-16 text-xl"
              disabled={cart.length === 0 || placing}
              onClick={placeOrder}
            >
              {placing ? "Placing..." : "Place order"}
            </Button>
            {cart.length > 0 && (
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => setCart([])}
              >
                <X className="w-4 h-4 mr-1" /> Clear
              </Button>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}