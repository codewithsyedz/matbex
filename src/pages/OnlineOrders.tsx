import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useOnlineOrders, useOnlineOrderDetail, OnlineOrder, OnlineOrderStatus } from "@/hooks/useOnlineOrders";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ShoppingBag, Phone, MapPin, Clock, Truck, Settings as SettingsIcon, ExternalLink, Copy } from "lucide-react";
import { toast } from "sonner";

function fmt(n: number) {
  return `﷼ ${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const NEXT_STATUS: Record<OnlineOrderStatus, { label: string; next: OnlineOrderStatus } | null> = {
  pending: { label: "Confirm", next: "confirmed" },
  confirmed: { label: "Start preparing", next: "preparing" },
  preparing: { label: "Mark ready", next: "ready" },
  ready: { label: "Out for delivery", next: "out_for_delivery" },
  out_for_delivery: { label: "Mark completed", next: "completed" },
  completed: null,
  cancelled: null,
};

export default function OnlineOrders() {
  const { restaurant } = useAuth();
  const { orders, updateStatus } = useOnlineOrders(restaurant?.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: detail } = useOnlineOrderDetail(selectedId ?? undefined);

  const groups = useMemo(() => {
    const all = orders.data ?? [];
    return {
      new: all.filter((o) => o.status === "pending"),
      active: all.filter((o) => ["confirmed", "preparing", "ready", "out_for_delivery"].includes(o.status)),
      done: all.filter((o) => ["completed", "cancelled"].includes(o.status)).slice(0, 50),
    };
  }, [orders.data]);

  const publicUrl = restaurant ? `${window.location.origin}/order/${restaurant.id}` : "";

  const copyLink = () => {
    navigator.clipboard.writeText(publicUrl);
    toast.success("Link copied");
  };

  const advance = (o: OnlineOrder) => {
    const next = NEXT_STATUS[o.status];
    if (!next) return;
    // Skip "out for delivery" for pickup orders
    if (o.order_type === "pickup" && next.next === "out_for_delivery") {
      updateStatus.mutate({ id: o.id, status: "completed" });
    } else {
      updateStatus.mutate({ id: o.id, status: next.next });
    }
  };

  const cancel = (o: OnlineOrder) => {
    if (!confirm("Cancel this order?")) return;
    updateStatus.mutate({ id: o.id, status: "cancelled" });
  };

  const renderCard = (o: OnlineOrder) => {
    const next = NEXT_STATUS[o.status];
    return (
      <Card key={o.id} className="p-4 space-y-2">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">#{o.order_number}</span>
              <Badge variant="outline" className="capitalize text-xs">
                {o.order_type === "delivery" ? <Truck className="h-3 w-3 mr-1" /> : <ShoppingBag className="h-3 w-3 mr-1" />}
                {o.order_type}
              </Badge>
              <Badge variant="secondary" className="capitalize text-xs">{o.status.replace(/_/g, " ")}</Badge>
            </div>
            <p className="text-sm mt-1">{o.customer_name}</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Phone className="h-3 w-3" /> {o.customer_phone}
            </p>
            {o.delivery_address && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <MapPin className="h-3 w-3" /> {(o.delivery_address as any).line1}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="font-semibold">{fmt(o.total)}</p>
            <p className="text-xs text-muted-foreground capitalize">{o.payment_method}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={() => setSelectedId(o.id)}>View</Button>
          {next && (
            <Button size="sm" onClick={() => advance(o)}>
              {o.order_type === "pickup" && next.next === "out_for_delivery" ? "Mark completed" : next.label}
            </Button>
          )}
          {!["completed", "cancelled"].includes(o.status) && (
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => cancel(o)}>
              Cancel
            </Button>
          )}
        </div>
      </Card>
    );
  };

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex items-center justify-between mb-6 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">Online Orders</h1>
          <p className="text-sm text-muted-foreground mt-1">Delivery and pickup orders from your storefront</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={copyLink} className="gap-2">
            <Copy className="h-4 w-4" /> Copy storefront link
          </Button>
          <a href={publicUrl} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm" className="gap-2">
              <ExternalLink className="h-4 w-4" /> Open
            </Button>
          </a>
          <Link to="/online-order-settings">
            <Button size="sm" className="gap-2">
              <SettingsIcon className="h-4 w-4" /> Settings
            </Button>
          </Link>
        </div>
      </div>

      <Tabs defaultValue="new">
        <TabsList>
          <TabsTrigger value="new">New ({groups.new.length})</TabsTrigger>
          <TabsTrigger value="active">In progress ({groups.active.length})</TabsTrigger>
          <TabsTrigger value="done">Recent</TabsTrigger>
        </TabsList>
        <TabsContent value="new" className="mt-4 grid gap-3 md:grid-cols-2">
          {groups.new.length === 0 ? (
            <p className="text-muted-foreground text-sm col-span-full">No new orders.</p>
          ) : groups.new.map(renderCard)}
        </TabsContent>
        <TabsContent value="active" className="mt-4 grid gap-3 md:grid-cols-2">
          {groups.active.length === 0 ? (
            <p className="text-muted-foreground text-sm col-span-full">No active orders.</p>
          ) : groups.active.map(renderCard)}
        </TabsContent>
        <TabsContent value="done" className="mt-4 grid gap-3 md:grid-cols-2">
          {groups.done.length === 0 ? (
            <p className="text-muted-foreground text-sm col-span-full">No recent orders.</p>
          ) : groups.done.map(renderCard)}
        </TabsContent>
      </Tabs>

      <Dialog open={!!selectedId} onOpenChange={(o) => !o && setSelectedId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Order #{detail?.order?.order_number}</DialogTitle>
          </DialogHeader>
          {detail?.order && (
            <ScrollArea className="max-h-[70vh]">
              <div className="space-y-3 pr-4">
                <div className="text-sm">
                  <p><span className="text-muted-foreground">Customer:</span> {detail.order.customer_name} · {detail.order.customer_phone}</p>
                  {detail.order.customer_email && <p><span className="text-muted-foreground">Email:</span> {detail.order.customer_email}</p>}
                  <p className="capitalize"><span className="text-muted-foreground">Type:</span> {detail.order.order_type}</p>
                  {detail.order.delivery_address && (
                    <p><span className="text-muted-foreground">Address:</span> {(detail.order.delivery_address as any).line1}, {(detail.order.delivery_address as any).city}</p>
                  )}
                  {detail.order.delivery_notes && (
                    <p><span className="text-muted-foreground">Notes:</span> {detail.order.delivery_notes}</p>
                  )}
                </div>
                <div className="border-t pt-3 space-y-1">
                  {detail.items.map((it) => (
                    <div key={it.id} className="flex justify-between text-sm">
                      <span>{it.qty} × {it.name_snapshot}{it.variant ? ` (${it.variant})` : ""}</span>
                      <span>{fmt(it.line_total)}</span>
                    </div>
                  ))}
                </div>
                <div className="border-t pt-3 text-sm space-y-1">
                  <div className="flex justify-between"><span>Subtotal</span><span>{fmt(detail.order.subtotal)}</span></div>
                  {Number(detail.order.delivery_fee) > 0 && (
                    <div className="flex justify-between"><span>Delivery</span><span>{fmt(detail.order.delivery_fee)}</span></div>
                  )}
                  <div className="flex justify-between font-semibold"><span>Total</span><span>{fmt(detail.order.total)}</span></div>
                </div>
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}