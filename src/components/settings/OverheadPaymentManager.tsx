import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { BranchBadge } from "@/components/branch/BranchBadge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { CheckCircle2, Circle, Calendar, CreditCard, Banknote, Building2, Lightbulb, Wifi, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/hooks/useCurrency";
import { useFiscalSettings, getFiscalMonthRange, getPreviousFiscalMonthRange } from "@/hooks/useFiscalSettings";
import { format } from "date-fns";

interface OverheadItem {
  id: string;
  name: string;
  monthly_amount: number;
  is_active: boolean;
  branch_id: string | null;
}

interface OverheadPayment {
  id: string;
  overhead_allocation_id: string;
  payment_month: string;
  amount_paid: number;
  payment_date: string;
  payment_method: string;
  ledger_posted: boolean;
}

export function OverheadPaymentManager() {
  const { restaurant, tenant, user } = useAuth();
  const { branches, activeBranchId, isAllBranches } = useBranch();
  const { format: formatCurrency } = useCurrency();
  const queryClient = useQueryClient();
  const { monthStartDay } = useFiscalSettings();
  
  // Generate fiscal month options (current + 3 past + 1 future)
  const now = new Date();
  const currentFiscal = getFiscalMonthRange(now, monthStartDay);
  
  const fiscalMonthOptions = Array.from({ length: 5 }, (_, i) => {
    // Start from 1 month ahead, go back
    const offset = 1 - i;
    let fiscalRange;
    if (offset > 0) {
      // Future: add months to current fiscal start
      const futureDate = new Date(currentFiscal.start);
      futureDate.setMonth(futureDate.getMonth() + offset);
      fiscalRange = getFiscalMonthRange(futureDate, monthStartDay);
    } else if (offset < 0) {
      // Past: get previous fiscal months
      let range = currentFiscal;
      for (let j = 0; j < Math.abs(offset); j++) {
        range = getPreviousFiscalMonthRange(range.start, monthStartDay);
      }
      fiscalRange = range;
    } else {
      fiscalRange = currentFiscal;
    }
    
    return {
      value: format(fiscalRange.start, "yyyy-MM-dd"),
      label: `${format(fiscalRange.start, "MMM d")} - ${format(fiscalRange.end, "MMM d, yyyy")}`,
      start: fiscalRange.start,
      end: fiscalRange.end,
    };
  }).reverse();
  
  // Default to current fiscal month
  const [selectedMonth, setSelectedMonth] = useState(() => {
    return format(currentFiscal.start, "yyyy-MM-dd");
  });
  
  const [paymentMethod, setPaymentMethod] = useState<string>("cash");

  // Branch filter: "__all__" = every item, "__shared__" = shared only,
  // or a branch id (that branch's items + shared ones)
  const [branchFilter, setBranchFilter] = useState<string>(
    isAllBranches || !activeBranchId ? "__all__" : activeBranchId
  );

  // Fetch overhead items
  const { data: overheads, isLoading: overheadsLoading } = useQuery({
    queryKey: ["overhead-allocations-payments", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await supabase
        .from("overhead_allocation")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .eq("is_active", true)
        .order("monthly_amount", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as OverheadItem[];
    },
    enabled: !!restaurant?.id,
  });

  const visibleOverheads = (overheads || []).filter((o) => {
    if (branchFilter === "__all__") return true;
    if (branchFilter === "__shared__") return !o.branch_id;
    return !o.branch_id || o.branch_id === branchFilter;
  });

  const branchNameOf = (branchId?: string | null) =>
    branchId ? branches.find((b) => b.id === branchId)?.name ?? "Branch" : null;

  // Fetch payments for selected month
  const { data: payments, isLoading: paymentsLoading } = useQuery({
    queryKey: ["overhead-payments", restaurant?.id, selectedMonth],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await supabase
        .from("overhead_payments")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .eq("payment_month", selectedMonth);
      if (error) throw error;
      return data as OverheadPayment[];
    },
    enabled: !!restaurant?.id,
  });

  // Mark as paid mutation
  const markPaidMutation = useMutation({
    mutationFn: async (overheadId: string) => {
      if (!restaurant?.id || !tenant?.id || !user?.id) throw new Error("Missing context");
      
      const overhead = overheads?.find(o => o.id === overheadId);
      if (!overhead) throw new Error("Overhead not found");

      const required = Number(overhead.monthly_amount) || 0;
      const amountToPay = required;
      if (amountToPay < required - 0.005) {
        throw new Error(
          `Payment cannot be less than the current overhead amount (${formatCurrency(required)}).`,
        );
      }

      // Insert payment record
      const { data: payment, error: paymentError } = await supabase
        .from("overhead_payments")
        .insert({
          overhead_allocation_id: overheadId,
          restaurant_id: restaurant.id,
          tenant_id: tenant.id,
          payment_month: selectedMonth,
          amount_paid: overhead.monthly_amount,
          payment_date: new Date().toISOString().split("T")[0],
          payment_method: paymentMethod,
          created_by: user.id,
          branch_id: overhead.branch_id ?? null,
        })
        .select()
        .single();

      if (paymentError) throw paymentError;

      // Post to ledger
      const { error: ledgerError } = await supabase.rpc("post_overhead_payment_to_ledger", {
        p_payment_id: payment.id,
        p_payment_method: paymentMethod,
      });

      if (ledgerError) {
        console.error("Ledger posting failed:", ledgerError);
        // Payment was created but ledger failed - still show success with warning
        return { payment, ledgerError: true };
      }

      return { payment, ledgerError: false };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["overhead-payments"] });
      queryClient.invalidateQueries({ queryKey: ["account-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["chart-of-accounts"] });
      if (result.ledgerError) {
        toast.warning("Payment recorded but ledger posting failed");
      } else {
        toast.success("Marked as paid & posted to ledger");
      }
    },
    onError: (error: Error) => {
      if (error.message?.includes("duplicate")) {
        toast.error("Already marked as paid for this month");
      } else if (error.message?.toLowerCase().includes("less than the current monthly amount") ||
                 error.message?.includes("cannot be less than the current overhead amount")) {
        toast.error("Underpayment blocked", { description: error.message });
      } else {
        toast.error("Failed to mark as paid");
      }
    },
  });

  // Mark all as paid mutation
  const markAllPaidMutation = useMutation({
    mutationFn: async () => {
      if (!restaurant?.id || !tenant?.id || !user?.id) throw new Error("Missing context");
      
      const unpaidItems = visibleOverheads.filter(o => !payments?.some(p => p.overhead_allocation_id === o.id));
      
      if (unpaidItems.length === 0) throw new Error("All items already paid");

      const results = [];
      const blocked: string[] = [];
      for (const overhead of unpaidItems) {
        const { data: payment, error: paymentError } = await supabase
          .from("overhead_payments")
          .insert({
            overhead_allocation_id: overhead.id,
            restaurant_id: restaurant.id,
            tenant_id: tenant.id,
            payment_month: selectedMonth,
            amount_paid: overhead.monthly_amount,
            payment_date: new Date().toISOString().split("T")[0],
            payment_method: paymentMethod,
            created_by: user.id,
            branch_id: overhead.branch_id ?? null,
          })
          .select()
          .single();

        if (paymentError) {
          console.error("Payment insert failed for", overhead.name, paymentError);
          if (paymentError.message?.toLowerCase().includes("less than the current monthly amount")) {
            blocked.push(overhead.name);
          }
          continue;
        }

        // Post to ledger
        await supabase.rpc("post_overhead_payment_to_ledger", {
          p_payment_id: payment.id,
          p_payment_method: paymentMethod,
        });

        results.push(payment);
      }

      return { results, blocked };
    },
    onSuccess: ({ results, blocked }) => {
      queryClient.invalidateQueries({ queryKey: ["overhead-payments"] });
      queryClient.invalidateQueries({ queryKey: ["account-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["chart-of-accounts"] });
      toast.success(`Marked ${results.length} items as paid`);
      if (blocked.length > 0) {
        toast.error("Underpayment blocked", {
          description: `Skipped ${blocked.length} item(s) whose payment was below the current overhead amount: ${blocked.join(", ")}`,
        });
      }
    },
    onError: () => toast.error("Failed to mark all as paid"),
  });

  const isLoading = overheadsLoading || paymentsLoading;

  const getPaymentForOverhead = (overheadId: string) => {
    return payments?.find(p => p.overhead_allocation_id === overheadId);
  };

  const getIconForName = (name: string) => {
    const lower = name.toLowerCase();
    if (lower.includes("rent")) return Building2;
    if (lower.includes("utilit") || lower.includes("electric") || lower.includes("water") || lower.includes("gas")) return Lightbulb;
    if (lower.includes("internet") || lower.includes("phone") || lower.includes("wifi")) return Wifi;
    return DollarSign;
  };

  const visibleIds = new Set(visibleOverheads.map((o) => o.id));
  const visiblePayments = (payments || []).filter((p) => visibleIds.has(p.overhead_allocation_id));
  const totalMonthly = visibleOverheads.reduce((sum, o) => sum + Number(o.monthly_amount), 0);
  const totalPaid = visiblePayments.reduce((sum, p) => sum + Number(p.amount_paid), 0);
  const unpaidCount = visibleOverheads.length - visiblePayments.length;

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-64 mt-1" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">Overhead Payments</CardTitle>
        <CardDescription>
          Track and record monthly overhead payments with automatic ledger posting
          {branchFilter === "__all__"
            ? " — all branches"
            : branchFilter === "__shared__"
              ? " — shared costs only"
              : ` — ${branchNameOf(branchFilter)} + shared costs`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Month & Payment Method Selection */}
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[140px]">
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger>
                <Calendar className="h-4 w-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {fiscalMonthOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[140px]">
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger>
                {paymentMethod === "cash" ? (
                  <Banknote className="h-4 w-4 mr-2" />
                ) : (
                  <CreditCard className="h-4 w-4 mr-2" />
                )}
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="bank">Bank Transfer</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="credit">On Credit</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[160px]">
            <Select value={branchFilter} onValueChange={setBranchFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Filter by branch" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All branches</SelectItem>
                <SelectItem value="__shared__">Shared only</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name} + shared
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Summary */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
          <div>
            <p className="text-sm text-muted-foreground">Paid / Total</p>
            <p className="text-lg font-semibold">
              {formatCurrency(totalPaid)} / {formatCurrency(totalMonthly)}
            </p>
          </div>
          <div className="text-right">
            {unpaidCount > 0 ? (
              <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                {unpaidCount} unpaid
              </Badge>
            ) : (
              <Badge variant="secondary" className="bg-green-100 text-green-800">
                All paid
              </Badge>
            )}
          </div>
        </div>

        {/* Overhead Items */}
        <div className="space-y-2">
          {visibleOverheads.map((item) => {
            const payment = getPaymentForOverhead(item.id);
            const isPaid = !!payment;
            const Icon = getIconForName(item.name);

            return (
              <div
                key={item.id}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg border transition-colors",
                  isPaid ? "bg-green-50/50 border-green-200" : "bg-card"
                )}
              >
                <div className="p-2 rounded-md bg-accent/50">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
                
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm">{item.name}</p>
                    <BranchBadge
                      size="sm"
                      name={branchNameOf(item.branch_id)}
                      branchId={item.branch_id}
                      untaggedLabel="Shared"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatCurrency(item.monthly_amount)}/month
                  </p>
                </div>

                {isPaid ? (
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="bg-green-100 text-green-800 text-xs">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Paid {payment.payment_date && format(new Date(payment.payment_date), "MMM d")}
                    </Badge>
                    {payment.ledger_posted && (
                      <Badge variant="outline" className="text-xs">Posted</Badge>
                    )}
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => markPaidMutation.mutate(item.id)}
                    disabled={markPaidMutation.isPending}
                  >
                    <Circle className="h-3.5 w-3.5 mr-1.5" />
                    Mark Paid
                  </Button>
                )}
              </div>
            );
          })}

          {visibleOverheads.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No active overhead items. Add items in Overhead Allocation settings.
            </p>
          )}
        </div>

        {/* Mark All Paid Button */}
        {unpaidCount > 0 && (
          <Button
            variant="default"
            className="w-full"
            onClick={() => markAllPaidMutation.mutate()}
            disabled={markAllPaidMutation.isPending}
          >
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Mark All as Paid ({unpaidCount} items)
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
