import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCustomerAuth } from "@/hooks/useCustomerAuth";
import { Loader2, LogOut, Package, ChevronRight } from "lucide-react";

interface OrderRow {
  id: string;
  order_number: number;
  status: string;
  order_type: string;
  total: number;
  payment_status: string;
  created_at: string;
  restaurant_id: string;
}

function fmt(n: number) {
  return `﷼ ${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const ACTIVE = new Set(["pending", "confirmed", "preparing", "ready", "out_for_delivery"]);

export default function CustomerAccount() {
  const navigate = useNavigate();
  const { customer, isAuthenticated, signOut, apiFetch } = useCustomerAuth();
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/account/login?redirect=/account", { replace: true });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch("");
        if (!cancelled) setOrders(data.orders ?? []);
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated, apiFetch, navigate]);

  if (!isAuthenticated) return null;

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-4">
        <Card className="p-5 flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">Signed in as</p>
            <p className="font-medium">{customer?.name || customer?.phone}</p>
            {customer?.name && <p className="text-xs text-muted-foreground">{customer.phone}</p>}
          </div>
          <Button variant="ghost" size="sm" onClick={() => { signOut(); navigate("/"); }}>
            <LogOut className="h-4 w-4 mr-1.5" /> Sign out
          </Button>
        </Card>

        <div>
          <h2 className="text-sm font-medium mb-2 text-muted-foreground">Your orders</h2>
          {loading ? (
            <Card className="p-8 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
            </Card>
          ) : error ? (
            <Card className="p-6 text-sm text-destructive">{error}</Card>
          ) : !orders || orders.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              <Package className="h-6 w-6 mx-auto mb-2 opacity-50" />
              No orders yet.
            </Card>
          ) : (
            <div className="space-y-2">
              {orders.map((o) => (
                <Link key={o.id} to={`/order/track/${o.id}`}>
                  <Card className="p-4 flex items-center justify-between hover:bg-muted/30 transition-colors">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">#{o.order_number}</span>
                        <Badge
                          variant={ACTIVE.has(o.status) ? "default" : o.status === "cancelled" ? "destructive" : "secondary"}
                          className="text-[10px] capitalize"
                        >
                          {o.status.replace(/_/g, " ")}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground capitalize">
                        {o.order_type} • {new Date(o.created_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium tabular-nums">{fmt(o.total)}</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}