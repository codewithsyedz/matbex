import { useParams } from "react-router-dom";
import { useOnlineOrderDetail } from "@/hooks/useOnlineOrders";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Clock, ChefHat, PackageCheck, Bike, XCircle } from "lucide-react";

const STEPS: { key: string; label: string; icon: any }[] = [
  { key: "pending", label: "Received", icon: Clock },
  { key: "confirmed", label: "Confirmed", icon: CheckCircle2 },
  { key: "preparing", label: "Preparing", icon: ChefHat },
  { key: "ready", label: "Ready", icon: PackageCheck },
  { key: "completed", label: "Completed", icon: CheckCircle2 },
];

function fmt(n: number) {
  return `﷼ ${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function PublicOrderTrack() {
  const { orderId } = useParams<{ orderId: string }>();
  const { data, isLoading } = useOnlineOrderDetail(orderId);

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading…</div>;
  if (!data?.order) return <div className="p-8 text-center">Order not found</div>;

  const { order, items } = data;
  const stepKeys = ["pending", "confirmed", "preparing", "ready", "completed"];
  const currentIdx = stepKeys.indexOf(order.status);
  const cancelled = order.status === "cancelled";

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-xl mx-auto space-y-4">
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs text-muted-foreground">Order</p>
              <h1 className="text-2xl font-semibold">#{order.order_number}</h1>
            </div>
            <Badge variant={cancelled ? "destructive" : "secondary"} className="capitalize">
              {order.status.replace(/_/g, " ")}
            </Badge>
          </div>
          {cancelled ? (
            <div className="flex items-center gap-2 text-destructive">
              <XCircle className="h-5 w-5" />
              <span>Order was cancelled. {order.cancel_reason}</span>
            </div>
          ) : (
            <div className="space-y-3">
              {STEPS.map((s, i) => {
                const active = i <= currentIdx;
                const Icon = s.icon;
                return (
                  <div key={s.key} className="flex items-center gap-3">
                    <div className={`h-8 w-8 rounded-full flex items-center justify-center ${active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className={active ? "font-medium" : "text-muted-foreground"}>{s.label}</span>
                  </div>
                );
              })}
              {order.order_type === "delivery" && currentIdx >= 3 && (
                <div className="flex items-center gap-3">
                  <div className={`h-8 w-8 rounded-full flex items-center justify-center ${order.status === "out_for_delivery" || order.status === "completed" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                    <Bike className="h-4 w-4" />
                  </div>
                  <span>Out for delivery</span>
                </div>
              )}
            </div>
          )}
        </Card>

        <Card className="p-6">
          <h2 className="font-semibold mb-3">Items</h2>
          <div className="space-y-2">
            {items.map((it) => (
              <div key={it.id} className="flex justify-between text-sm">
                <span>{it.qty} × {it.name_snapshot}{it.variant ? ` (${it.variant})` : ""}</span>
                <span>{fmt(it.line_total)}</span>
              </div>
            ))}
          </div>
          <div className="border-t mt-3 pt-3 space-y-1 text-sm">
            <div className="flex justify-between"><span>Subtotal</span><span>{fmt(order.subtotal)}</span></div>
            {Number(order.delivery_fee) > 0 && (
              <div className="flex justify-between"><span>Delivery</span><span>{fmt(order.delivery_fee)}</span></div>
            )}
            <div className="flex justify-between font-semibold pt-1"><span>Total</span><span>{fmt(order.total)}</span></div>
          </div>
        </Card>

        <Card className="p-6 text-sm space-y-1">
          <p><span className="text-muted-foreground">Type:</span> <span className="capitalize">{order.order_type}</span></p>
          <p><span className="text-muted-foreground">Name:</span> {order.customer_name}</p>
          <p><span className="text-muted-foreground">Phone:</span> {order.customer_phone}</p>
          {order.delivery_address && (
            <p><span className="text-muted-foreground">Address:</span> {(order.delivery_address as any).line1}, {(order.delivery_address as any).city}</p>
          )}
          <p><span className="text-muted-foreground">Payment:</span> <span className="capitalize">{order.payment_method}</span> ({order.payment_status})</p>
        </Card>
      </div>
    </div>
  );
}