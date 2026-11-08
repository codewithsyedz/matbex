import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";
import { ChefHat, Clock, Truck, ShoppingBag, X, ArrowRight, Phone, MapPin, Settings as SettingsIcon } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useOnlineOrders, useOnlineOrderDetail, OnlineOrder, OnlineOrderStatus } from "@/hooks/useOnlineOrders";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCurrency } from "@/hooks/useCurrency";
import { cn } from "@/lib/utils";

const FLOW: OnlineOrderStatus[] = ["pending", "confirmed", "preparing", "ready", "out_for_delivery", "completed"];

const NEXT: Record<OnlineOrderStatus, { label: string; next: OnlineOrderStatus } | null> = {
  pending: { label: "Confirm", next: "confirmed" },
  confirmed: { label: "Start preparing", next: "preparing" },
  preparing: { label: "Mark ready", next: "ready" },
  ready: { label: "Out for delivery", next: "out_for_delivery" },
  out_for_delivery: { label: "Complete", next: "completed" },
  completed: null,
  cancelled: null,
};

const COLUMNS: { key: OnlineOrderStatus; label: string }[] = [
  { key: "pending", label: "New" },
  { key: "confirmed", label: "Confirmed" },
  { key: "preparing", label: "Preparing" },
  { key: "ready", label: "Ready" },
];

function elapsed(from: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(from).getTime()) / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function channelLabel(o: OnlineOrder): string {
  const ch = (o as any).channel as string | undefined;
  if (ch === "qr" || o.customer_name === "Kiosk Order") return "Kiosk";
  if (o.order_type === "delivery") return "Delivery";
  return "Pickup";
}

function OrderCard({
  o,
  onAdvance,
  onCancel,
  onOpen,
  format,
}: {
  o: OnlineOrder;
  onAdvance: (o: OnlineOrder) => void;
  onCancel: (o: OnlineOrder) => void;
  onOpen: (id: string) => void;
  format: (n: number) => string;
}) {
  const [, force] = useState(0);
  useEffect(() => {
    const i = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(i);
  }, []);

  const ageSec = Math.floor((Date.now() - new Date(o.created_at).getTime()) / 1000);
  const tone =
    o.status === "ready"
      ? "border-primary bg-primary/5"
      : ageSec > 900
      ? "border-destructive/60 bg-destructive/5"
      : ageSec > 420
      ? "border-amber-400 bg-amber-50/40 dark:bg-amber-950/20"
      : "border-border bg-card";

  const next = NEXT[o.status];
  const advanceLabel =
    o.order_type === "pickup" && next?.next === "out_for_delivery" ? "Complete" : next?.label;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.2 }}
    >
      <Card className={cn("flex flex-col border-2 transition-colors", tone)}>
        <button
          type="button"
          onClick={() => onOpen(o.id)}
          className="text-left flex items-center justify-between p-3 border-b hover:bg-muted/40 rounded-t"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold">#{o.order_number}</span>
            <Badge variant="outline" className="text-[10px] capitalize gap-1">
              {o.order_type === "delivery" ? (
                <Truck className="h-3 w-3" />
              ) : (
                <ShoppingBag className="h-3 w-3" />
              )}
              {channelLabel(o)}
            </Badge>
          </div>
          <div className="flex items-center gap-1 text-sm tabular-nums font-medium">
            <Clock className="h-3.5 w-3.5" /> {elapsed(o.created_at)}
          </div>
        </button>

        <div className="p-3 space-y-1 text-sm">
          <div className="flex justify-between gap-2">
            <span className="truncate">{o.customer_name}</span>
            <span className="font-semibold tabular-nums">{format(Number(o.total))}</span>
          </div>
          {o.customer_phone && o.customer_phone !== "kiosk" && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Phone className="h-3 w-3" /> {o.customer_phone}
            </p>
          )}
          {o.delivery_address && (
            <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
              <MapPin className="h-3 w-3 shrink-0" /> {(o.delivery_address as any).line1}
            </p>
          )}
        </div>

        <div className="p-2 border-t flex gap-2">
          <Button variant="ghost" size="icon" onClick={() => onCancel(o)} title="Cancel">
            <X className="h-4 w-4" />
          </Button>
          {next && (
            <Button className="flex-1" onClick={() => onAdvance(o)}>
              {advanceLabel} <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>
      </Card>
    </motion.div>
  );
}

export default function OrderManager() {
  const { restaurant } = useAuth();
  const { format } = useCurrency();
  const { orders, updateStatus } = useOnlineOrders(restaurant?.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: detail } = useOnlineOrderDetail(selectedId ?? undefined);

  const columns = useMemo(() => {
    const all = orders.data ?? [];
    const cols: Record<OnlineOrderStatus, OnlineOrder[]> = {
      pending: [], confirmed: [], preparing: [], ready: [],
      out_for_delivery: [], completed: [], cancelled: [],
    };
    for (const o of all) {
      if (cols[o.status]) cols[o.status].push(o);
    }
    return cols;
  }, [orders.data]);

  const advance = (o: OnlineOrder) => {
    const n = NEXT[o.status];
    if (!n) return;
    const target = o.order_type === "pickup" && n.next === "out_for_delivery" ? "completed" : n.next;
    updateStatus.mutate({ id: o.id, status: target });
  };

  const cancel = (o: OnlineOrder) => {
    if (!confirm("Cancel this order?")) return;
    updateStatus.mutate({ id: o.id, status: "cancelled" });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 md:px-6 py-3 border-b bg-background sticky top-0 z-10 min-h-[56px]">
        <div className="flex items-center gap-3 min-w-[240px] flex-1">
          <ChefHat className="h-5 w-5 text-primary" />
          <div>
            <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">Order Manager</h1>
            <p className="text-sm text-muted-foreground mt-1">Kiosk, online & delivery orders</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/online-orders">List view</Link>
          </Button>
          <Button variant="outline" size="icon" asChild>
            <Link to="/online-order-settings" title="Settings"><SettingsIcon className="h-4 w-4" /></Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 p-4 md:p-6 flex-1 overflow-hidden">
        {COLUMNS.map((col) => (
          <div key={col.key} className="flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {col.label}
              </h2>
              <Badge variant="outline">{columns[col.key].length}</Badge>
            </div>
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              <AnimatePresence mode="popLayout">
                {columns[col.key].map((o) => (
                  <OrderCard
                    key={o.id}
                    o={o}
                    onAdvance={advance}
                    onCancel={cancel}
                    onOpen={setSelectedId}
                    format={format}
                  />
                ))}
              </AnimatePresence>
              {columns[col.key].length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-8 border border-dashed rounded-md">
                  No orders
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <Dialog open={!!selectedId} onOpenChange={(o) => !o && setSelectedId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Order #{detail?.order?.order_number}</DialogTitle>
          </DialogHeader>
          {detail?.order && (
            <ScrollArea className="max-h-[70vh]">
              <div className="space-y-3 pr-4">
                <div className="text-sm">
                  <p>
                    <span className="text-muted-foreground">Customer:</span>{" "}
                    {detail.order.customer_name} · {detail.order.customer_phone}
                  </p>
                  <p className="capitalize">
                    <span className="text-muted-foreground">Type:</span> {detail.order.order_type}
                  </p>
                  {detail.order.delivery_address && (
                    <p>
                      <span className="text-muted-foreground">Address:</span>{" "}
                      {(detail.order.delivery_address as any).line1},{" "}
                      {(detail.order.delivery_address as any).city}
                    </p>
                  )}
                  {detail.order.delivery_notes && (
                    <p>
                      <span className="text-muted-foreground">Notes:</span> {detail.order.delivery_notes}
                    </p>
                  )}
                </div>
                <div className="border-t pt-3 space-y-1">
                  {detail.items.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No line items recorded.</p>
                  ) : (
                    detail.items.map((it) => (
                      <div key={it.id} className="flex justify-between text-sm">
                        <span>
                          {it.qty} × {it.name_snapshot}
                          {it.variant ? ` (${it.variant})` : ""}
                        </span>
                        <span>{format(Number(it.line_total))}</span>
                      </div>
                    ))
                  )}
                </div>
                <div className="border-t pt-3 text-sm space-y-1">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span>{format(Number(detail.order.subtotal))}</span>
                  </div>
                  {Number(detail.order.delivery_fee) > 0 && (
                    <div className="flex justify-between">
                      <span>Delivery</span>
                      <span>{format(Number(detail.order.delivery_fee))}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-semibold">
                    <span>Total</span>
                    <span>{format(Number(detail.order.total))}</span>
                  </div>
                </div>
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}