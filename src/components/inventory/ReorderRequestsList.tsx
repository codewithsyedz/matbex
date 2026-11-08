import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Package, Check, X, AlertTriangle, ShoppingCart, Mail, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export function ReorderRequestsList() {
  const { restaurant, user } = useAuth();
  const { format: formatCurrency } = useCurrency();
  const queryClient = useQueryClient();
  const [sendingEmail, setSendingEmail] = useState<string | null>(null);

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["reorder-requests", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await supabase
        .from("reorder_requests")
        .select(`
          *,
          inventory_items(name, unit, unit_cost, supplier_id, suppliers(id, name, email))
        `)
        .eq("restaurant_id", restaurant.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!restaurant?.id,
  });

  const resolveMutation = useMutation({
    mutationFn: async ({ id, status, newStock }: { id: string; status: string; newStock?: number }) => {
      const updates: any = {
        status,
        resolved_at: new Date().toISOString(),
        resolved_by: user?.id,
      };

      const { error } = await supabase
        .from("reorder_requests")
        .update(updates)
        .eq("id", id);

      if (error) throw error;

      // If fulfilled, update inventory stock
      if (status === "fulfilled" && newStock !== undefined) {
        const request = requests.find(r => r.id === id);
        if (request) {
          await supabase
            .from("inventory_items")
            .update({ 
              current_stock: Number(request.current_stock) + Number(request.requested_quantity)
            })
            .eq("id", request.inventory_item_id);
        }
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["reorder-requests"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
      toast.success(
        variables.status === "fulfilled" 
          ? "Order fulfilled & stock updated" 
          : "Request cancelled"
      );
    },
    onError: () => {
      toast.error("Failed to update request");
    },
  });

  const sendReorderEmail = async (request: any) => {
    const supplier = request.inventory_items?.suppliers;
    if (!supplier?.email) {
      toast.error("No supplier email configured for this item");
      return;
    }

    setSendingEmail(request.id);
    try {
      const response = await supabase.functions.invoke("send-reorder-email", {
        body: {
          supplier_id: supplier.id,
          supplier_name: supplier.name,
          supplier_email: supplier.email,
          items: [{
            name: request.inventory_items?.name,
            current_stock: Number(request.current_stock),
            reorder_level: Number(request.reorder_level),
            unit: request.inventory_items?.unit,
            requested_quantity: Number(request.requested_quantity),
          }],
          restaurant_name: restaurant?.name || "Restaurant",
        },
      });

      if (response.error) throw response.error;
      toast.success(`Reorder email sent to ${supplier.name}`);
    } catch (error: any) {
      console.error("Error sending email:", error);
      toast.error("Failed to send email");
    } finally {
      setSendingEmail(null);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  if (requests.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-center">
          <ShoppingCart className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-muted-foreground">No pending reorder requests</p>
          <p className="text-xs text-muted-foreground mt-1">
            Requests are auto-created when inventory falls below reorder level
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-warning" />
          Pending Reorder Requests
          <Badge variant="secondary">{requests.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {requests.map((request: any) => {
          const supplier = request.inventory_items?.suppliers;
          const hasSupplierEmail = supplier?.email;
          
          return (
            <div
              key={request.id}
              className="flex items-center justify-between p-3 rounded-lg border bg-card"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-warning/10 flex items-center justify-center">
                  <Package className="h-5 w-5 text-warning" />
                </div>
                <div>
                  <p className="font-medium text-sm">
                    {request.inventory_items?.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Current: {Number(request.current_stock).toFixed(1)} {request.inventory_items?.unit} • 
                    Need: {Number(request.requested_quantity).toFixed(1)} {request.inventory_items?.unit}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {supplier?.name && <span className="text-primary">{supplier.name} • </span>}
                    {formatDistanceToNow(new Date(request.created_at), { addSuffix: true })}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-muted-foreground mr-2">
                  ~{formatCurrency(Number(request.requested_quantity) * Number(request.inventory_items?.unit_cost || 0))}
                </p>
                {hasSupplierEmail && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => sendReorderEmail(request)}
                    disabled={sendingEmail === request.id}
                    title={`Email ${supplier.name}`}
                  >
                    {sendingEmail === request.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Mail className="h-4 w-4" />
                    )}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => resolveMutation.mutate({ 
                    id: request.id, 
                    status: "cancelled" 
                  })}
                  disabled={resolveMutation.isPending}
                >
                  <X className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  onClick={() => resolveMutation.mutate({ 
                    id: request.id, 
                    status: "fulfilled",
                    newStock: Number(request.current_stock) + Number(request.requested_quantity)
                  })}
                  disabled={resolveMutation.isPending}
                >
                  <Check className="h-4 w-4 mr-1" />
                  Fulfill
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
