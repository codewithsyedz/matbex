import { useEffect, useMemo, useState } from "react";
import { toCdnUrl } from "@/lib/imageCdn";
import { useParams } from "react-router-dom";
import { db } from "@/integrations/db/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Minus, Plus, ShoppingBag, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

type SizeKey = "quarter" | "half" | "full";

interface MenuItem {
  id: string;
  name: string;
  description: string | null;
  category: string;
  selling_price: number;
  quarter_price: number;
  half_price: number;
  full_price: number;
  image_url: string | null;
  is_chefs_special: boolean;
  allergens: string[] | null;
  dietary_tags: string[] | null;
}

interface CartLine {
  key: string;
  menu_item_id: string;
  name: string;
  size: SizeKey;
  price: number;
  qty: number;
}

interface LookupResult {
  found: boolean;
  table?: { id: string; label: string; code: string; capacity: number; restaurant_id: string };
  restaurant?: { id: string; name: string; currency: string };
  menu?: MenuItem[];
}

function formatPrice(amount: number, currency: string) {
  const symbol = currency === "SAR" ? "﷼" : currency;
  return `${symbol} ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getItemSizes(item: MenuItem): { size: SizeKey; price: number }[] {
  const sizes: { size: SizeKey; price: number }[] = [];
  if (item.quarter_price > 0) sizes.push({ size: "quarter", price: item.quarter_price });
  if (item.half_price > 0) sizes.push({ size: "half", price: item.half_price });
  if (item.full_price > 0 || item.selling_price > 0) {
    sizes.push({ size: "full", price: item.full_price || item.selling_price });
  }
  if (sizes.length === 0) sizes.push({ size: "full", price: item.selling_price });
  return sizes;
}

const sizeLabel: Record<SizeKey, string> = { quarter: "Quarter", half: "Half", full: "Full" };

export default function GuestOrder() {
  const { code } = useParams<{ code: string }>();
  const [data, setData] = useState<LookupResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [guestName, setGuestName] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{ id: string; access_token: string } | null>(null);

  useEffect(() => {
    document.title = "Order at your table";
    if (!code) return;
    (async () => {
      setLoading(true);
      const { data: res, error } = await db.rpc("guest_lookup_table", { p_code: code });
      if (error) {
        toast.error("Could not load table");
      }
      setData((res as unknown as LookupResult) ?? { found: false });
      setLoading(false);
    })();
  }, [code]);

  const grouped = useMemo(() => {
    const map = new Map<string, MenuItem[]>();
    (data?.menu || []).forEach((m) => {
      const arr = map.get(m.category) || [];
      arr.push(m);
      map.set(m.category, arr);
    });
    return Array.from(map.entries());
  }, [data]);

  const subtotal = cart.reduce((s, l) => s + l.price * l.qty, 0);
  const total = subtotal;
  const currency = data?.restaurant?.currency || "SAR";

  function addToCart(item: MenuItem, size: SizeKey, price: number) {
    setCart((prev) => {
      const key = `${item.id}::${size}`;
      const existing = prev.find((l) => l.key === key);
      if (existing) {
        return prev.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l));
      }
      return [...prev, { key, menu_item_id: item.id, name: item.name, size, price, qty: 1 }];
    });
  }

  function changeQty(key: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.key === key ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0)
    );
  }

  async function submitOrder() {
    if (!code || cart.length === 0) return;
    setSubmitting(true);
    try {
      const { data: res, error } = await db.rpc("guest_create_order", {
        p_table_code: code,
        p_guest_name: guestName || "",
        p_items: cart.map(({ key, ...rest }) => rest),
        p_subtotal: subtotal,
        p_tax: 0,
        p_total: total,
        p_notes: notes || null,
      });
      if (error) throw error;
      const out = res as { id: string; access_token: string };
      setSubmitted(out);
      setCart([]);
      toast.success("Order placed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not place order");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data?.found) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6 text-center">
        <h1 className="text-2xl font-light mb-2">Table not found</h1>
        <p className="text-sm text-muted-foreground">This QR code is no longer active.</p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6 text-center">
        <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <Check className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-2xl font-light mb-2">Order received</h1>
        <p className="text-sm text-muted-foreground mb-1">
          {data.restaurant?.name} — {data.table?.label}
        </p>
        <p className="text-sm text-muted-foreground mb-6">
          Your order is with the kitchen. Please pay at the counter or wait for your server.
        </p>
        <Button variant="outline" onClick={() => setSubmitted(null)}>
          Place another order
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto max-w-2xl px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-medium leading-tight">{data.restaurant?.name}</h1>
            <p className="text-xs text-muted-foreground">{data.table?.label}</p>
          </div>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="default" size="sm" className="relative" disabled={cart.length === 0}>
                <ShoppingBag className="h-4 w-4 mr-2" />
                Cart
                {cart.length > 0 && (
                  <Badge variant="secondary" className="ml-2 px-1.5">
                    {cart.reduce((s, l) => s + l.qty, 0)}
                  </Badge>
                )}
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="max-h-[90vh] flex flex-col">
              <SheetHeader>
                <SheetTitle>Your order</SheetTitle>
              </SheetHeader>
              <ScrollArea className="flex-1 -mx-6 px-6 my-4">
                <div className="space-y-3">
                  {cart.map((l) => (
                    <div key={l.key} className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{l.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {sizeLabel[l.size]} · {formatPrice(l.price, currency)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => changeQty(l.key, -1)}>
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-6 text-center text-sm">{l.qty}</span>
                        <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => changeQty(l.key, 1)}>
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  <Separator />
                  <div>
                    <label className="text-xs text-muted-foreground">Name (optional)</label>
                    <Input value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Your name" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Notes (allergies, preferences)</label>
                    <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
                  </div>
                </div>
              </ScrollArea>
              <div className="border-t pt-4 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-medium">{formatPrice(subtotal, currency)}</span>
                </div>
                <Button className="w-full" disabled={submitting || cart.length === 0} onClick={submitOrder}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Place order · {formatPrice(total, currency)}
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6 space-y-8 pb-32">
        {grouped.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-12">Menu is empty.</p>
        )}
        {grouped.map(([category, items]) => (
          <section key={category}>
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground mb-3">
              {category}
            </h2>
            <div className="space-y-3">
              {items.map((item) => (
                <Card key={item.id} className="overflow-hidden">
                  <CardContent className="p-4 flex gap-4">
                    {item.image_url && (
                      <img
                        src={toCdnUrl(item.image_url) || ""}
                        alt={item.name}
                        loading="lazy"
                        className="h-20 w-20 rounded-md object-cover bg-muted flex-shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-medium leading-tight">{item.name}</h3>
                        {item.is_chefs_special && (
                          <Badge variant="secondary" className="text-[10px] py-0">Chef's pick</Badge>
                        )}
                      </div>
                      {item.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.description}</p>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {getItemSizes(item).map(({ size, price }) => (
                          <Button
                            key={size}
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs"
                            onClick={() => addToCart(item, size, price)}
                          >
                            {sizeLabel[size]} · {formatPrice(price, currency)}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}