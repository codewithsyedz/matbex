import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/integrations/db/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { 
  Loader2, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle,
  Banknote,
  Calculator,
  FileText,
  PartyPopper,
  CreditCard,
  Wallet,
  AlertCircle,
  Package,
  Lock
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useVarianceThresholds, getVarianceStatus, isExplanationRequired } from "@/hooks/useShiftVariance";
import { ShiftSummary } from "@/components/shifts/ShiftSummary";
import { DayEndAdjustmentDialog } from "@/components/dayend/DayEndAdjustmentDialog";
import { Scale } from "lucide-react";

interface Shift {
  id: string;
  drawer_id: string;
  opening_float: number;
  opened_at: string;
  drawers?: {
    name: string;
  };
}

interface CashEvent {
  id: string;
  event_type: string;
  amount: number;
  payment_method: string | null;
  description?: string | null;
  reference_type?: string | null;
}

interface CloseShiftModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shift: Shift | null;
  onShiftClosed: () => void | Promise<void>;
}

const steps = [
  { id: 1, title: "Count", icon: Banknote },
  { id: 2, title: "Review", icon: Calculator },
  { id: 3, title: "Confirm", icon: FileText },
];

export function CloseShiftModal({ open, onOpenChange, shift, onShiftClosed }: CloseShiftModalProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [showSuccess, setShowSuccess] = useState(false);

  const [cashEvents, setCashEvents] = useState<CashEvent[]>([]);
  const [inventoryMovements, setInventoryMovements] = useState<Array<{
    id: string;
    movement_type: string;
    quantity_change: number;
    item_name: string;
    stock_unit: string;
    amount: number | null;
    reason: string | null;
    inventory_item_id?: string;
  }>>([]);
  const [countedCash, setCountedCash] = useState<number>(0);
  const [countedCard, setCountedCard] = useState<number>(0);
  const [notes, setNotes] = useState("");
  const [varianceExplanation, setVarianceExplanation] = useState("");
  const [stockVarianceExplanation, setStockVarianceExplanation] = useState("");
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);

  const { restaurant } = useAuth();
  const { thresholds } = useVarianceThresholds();

  // Calculate expected cash from cash_events (operational source of truth).
  // Adjustments/deposits are stored signed - BNPL installment payouts settled
  // from Cash on Hand arrive here as negative adjustments.
  const expectedCash = shift
    ? shift.opening_float +
      cashEvents
        .filter((e) => e.payment_method === "cash")
        .reduce((sum, e) => {
          if (e.event_type === "sale") return sum + e.amount;
          if (e.event_type === "refund") return sum - e.amount;
          if (e.event_type === "drop") return sum - e.amount;
          if (e.event_type === "adjustment") return sum + e.amount;
          if (e.event_type === "deposit") return sum - Math.abs(e.amount);
          return sum;
        }, 0)
    : 0;

  /** Cash paid out of the drawer to settle BNPL installments during this shift. */
  const installmentPayouts = cashEvents
    .filter(
      (e) =>
        e.event_type === "adjustment" &&
        (e.reference_type === "installment_payment" ||
          e.reference_type === "installment_payment_void"),
    )
    .reduce((sum, e) => sum + e.amount, 0);

  const variance = countedCash - expectedCash;
  const varianceStatus = getVarianceStatus(variance, thresholds);
  const explanationRequired = isExplanationRequired(variance, thresholds);

  // Stock variance: spend mismatch between purchases and usage/waste during the shift.
  // Pct = |purchase - usage| / max(purchase, usage). Mandatory reason at >= 15%.
  const STOCK_VARIANCE_THRESHOLD_PCT = 15;
  const stockTotals = (() => {
    let purchase = 0;
    let usage = 0;
    inventoryMovements.forEach(m => {
      const amt = Number(m.amount) || 0;
      if (m.movement_type === 'purchase') purchase += amt;
      else if (m.movement_type === 'usage' || m.movement_type === 'waste') usage += amt;
    });
    return { purchase, usage };
  })();
  const stockVarianceAbs = Math.abs(stockTotals.purchase - stockTotals.usage);
  const stockVarianceBase = Math.max(stockTotals.purchase, stockTotals.usage);
  const stockVariancePct = stockVarianceBase > 0
    ? (stockVarianceAbs / stockVarianceBase) * 100
    : 0;
  const stockExplanationRequired =
    stockVarianceBase > 0 && stockVariancePct >= STOCK_VARIANCE_THRESHOLD_PCT;

  useEffect(() => {
    if (open && shift) {
      loadCashEvents();
    }
  }, [open, shift]);

  const loadCashEvents = async () => {
    if (!shift) return;
    
    setLoadingData(true);
    try {
      const { data: eventsData } = await db
        .from("cash_events")
        .select("*")
        .eq("shift_id", shift.id);

      setCashEvents((eventsData as CashEvent[]) || []);

      // Load inventory-linked expenses created during this shift window
      // (uses created_at between shift open and now)
      try {
        const sb = db as any;
        const shiftEndIso = new Date().toISOString();
        const { data: movs } = await sb
          .from('stock_movements')
          .select('id, movement_type, quantity_change, reason, reference_type, reference_id, created_at, inventory_items(name, unit, stock_unit)')
          .eq('restaurant_id', shift && (shift as any).restaurant_id ? (shift as any).restaurant_id : restaurant?.id)
          .gte('created_at', shift.opened_at)
          .lte('created_at', shiftEndIso)
          .order('created_at', { ascending: false });

        // Pull amounts for any expense-sourced movements
        const expenseIds = (movs || [])
          .filter((m: any) => m.reference_type === 'expense' && m.reference_id)
          .map((m: any) => m.reference_id);
        const expenseAmounts: Record<string, number> = {};
        if (expenseIds.length > 0) {
          const { data: exps } = await db
            .from('expenses')
            .select('id, amount')
            .in('id', expenseIds);
          (exps || []).forEach((e: any) => { expenseAmounts[e.id] = Number(e.amount) || 0; });
        }

        setInventoryMovements((movs || []).map((m: any) => ({
          id: m.id,
          movement_type: m.movement_type,
          quantity_change: Number(m.quantity_change) || 0,
          item_name: m.inventory_items?.name || '-',
          stock_unit: m.inventory_items?.stock_unit || m.inventory_items?.unit || '',
          amount: m.reference_type === 'expense' ? (expenseAmounts[m.reference_id] ?? null) : null,
          reason: m.reason,
          inventory_item_id: m.inventory_item_id,
        })));
      } catch (invErr) {
        console.warn('Could not load shift inventory movements', invErr);
        setInventoryMovements([]);
      }

      setCountedCash(0);
      setCountedCard(0);
    } catch (error) {
      console.error("Error loading shift data:", error);
    } finally {
      setLoadingData(false);
    }
  };

  const handleCloseShift = async () => {
    if (!shift || !restaurant) return;

    // Server-side persistence is gated by the same rule as the UI:
    // require an explanation when stock variance >= 15%.
    if (stockExplanationRequired && !stockVarianceExplanation.trim()) {
      toast.error('A stock variance reason is required (≥ 15% variance).');
      setCurrentStep(3);
      return;
    }

    setLoading(true);
    try {
      // Close the shift with variance explanation
      const { error } = await db
        .from("shifts")
        .update({
          status: "closed",
          counted_cash: countedCash,
          counted_card: countedCard,
          expected_cash: expectedCash,
          variance: variance,
          variance_status: varianceStatus,
          variance_explanation: explanationRequired ? varianceExplanation : null,
          stock_variance_pct: stockVarianceBase > 0 ? Number(stockVariancePct.toFixed(2)) : null,
          stock_variance_explanation: stockExplanationRequired
            ? stockVarianceExplanation.trim()
            : null,
          deposit_amount: countedCash,
          closed_at: new Date().toISOString(),
          notes: notes || null,
        })
        .eq("id", shift.id);

      if (error) throw error;

      toast.success("Shift closed successfully!");
      
      // Immediately call refetch before showing success
      try {
        await onShiftClosed();
      } catch (e) {
        console.error("Error refreshing shifts:", e);
      }
      
      setShowSuccess(true);
      setTimeout(() => {
        onOpenChange(false);
        resetForm();
        // Refetch again when modal closes to ensure UI is updated
        onShiftClosed();
      }, 2000);
    } catch (error: any) {
      console.error("Error closing shift:", error);
      toast.error(error.message || "Failed to close shift");
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setCurrentStep(1);
    setCountedCash(0);
    setCountedCard(0);
    setNotes("");
    setVarianceExplanation("");
    setStockVarianceExplanation("");
    setShowSuccess(false);
  };

  const progressPercent = ((currentStep - 1) / (steps.length - 1)) * 100;

  if (showSuccess) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          description={
            shift
              ? `Shift on ${shift.drawers?.name ?? "drawer"} (opened ${new Date(shift.opened_at).toLocaleString()}) closed.`
              : "Shift closed."
          }
          className="sm:max-w-md"
        >
          <div className="flex flex-col items-center justify-center py-12 space-y-4 fade-slide-in">
            <div className="relative">
              <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center animate-scale-in">
                <PartyPopper className="h-8 w-8 text-success" />
              </div>
              <div className="absolute inset-0 rounded-full border-2 border-success/20 animate-ping" />
            </div>
            <div className="text-center space-y-1">
              <h3 className="text-lg font-semibold">Shift Closed!</h3>
              <p className="text-sm text-muted-foreground">
                {varianceStatus === "perfect" 
                  ? "Perfect close with zero variance"
                  : varianceStatus === "minor"
                  ? "Great job! Minor variance recorded"
                  : "Variance recorded for review"}
              </p>
            </div>
            {varianceStatus === "perfect" && (
              <div className="px-3 py-1 bg-success/10 text-success text-xs font-medium rounded-full">
                🏆 Perfect Close
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        description={
          shift
            ? `Reconcile shift on ${shift.drawers?.name ?? "drawer"} opened ${new Date(shift.opened_at).toLocaleString()} - count cash, review variance, post day-end.`
            : "Reconcile the closing shift - count cash, review variance, post day-end."
        }
        className="sm:max-w-lg max-h-[90vh] flex flex-col p-0"
      >
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-primary" />
            Close Shift
          </DialogTitle>
        </DialogHeader>

        {loadingData ? (
          <div className="flex items-center justify-center py-12 px-6">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <ScrollArea className="flex-1 overflow-y-auto">
              <div className="space-y-6 px-6 pb-4">
            {/* Progress ring */}
            <div className="flex items-center justify-center">
              <div className="relative w-24 h-24">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                  <circle
                    cx="50"
                    cy="50"
                    r="42"
                    fill="none"
                    stroke="hsl(var(--accent))"
                    strokeWidth="8"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="42"
                    fill="none"
                    stroke="hsl(var(--primary))"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={`${progressPercent * 2.64} 264`}
                    className={cn(
                      "transition-all duration-500",
                      progressPercent === 100 && "animate-progress-pulse"
                    )}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-2xl font-semibold">{currentStep}/3</span>
                </div>
              </div>
            </div>

            {/* Step indicators */}
            <div className="flex justify-center gap-6">
              {steps.map((step) => (
                <div
                  key={step.id}
                  className={cn(
                    "flex items-center gap-1.5 text-xs font-medium transition-colors",
                    currentStep >= step.id ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  <step.icon className="h-3.5 w-3.5" />
                  <span>{step.title}</span>
                </div>
              ))}
            </div>

            {/* Step content */}
            <div className="min-h-[200px]">
              {currentStep === 1 && (
                <div className="space-y-4 fade-slide-in">
                  <div className="text-center space-y-1">
                    <h3 className="font-medium">Count your payments</h3>
                    <p className="text-sm text-muted-foreground">
                      Enter the cash in drawer and card payment totals
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {/* Cash Input */}
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1.5">
                        <Banknote className="h-3.5 w-3.5" />
                        Cash in drawer
                      </Label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">
                          SAR
                        </span>
                        <Input
                          type="number"
                          value={countedCash || ""}
                          onChange={(e) => setCountedCash(Number(e.target.value))}
                          className="pl-10 text-lg font-semibold h-12"
                          placeholder="0"
                          min={0}
                          autoFocus
                        />
                      </div>
                    </div>

                    {/* Card Input */}
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1.5">
                        <CreditCard className="h-3.5 w-3.5" />
                        Card payments
                      </Label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">
                          SAR
                        </span>
                        <Input
                          type="number"
                          value={countedCard || ""}
                          onChange={(e) => setCountedCard(Number(e.target.value))}
                          className="pl-10 text-lg font-semibold h-12"
                          placeholder="0"
                          min={0}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="p-3 bg-accent/50 rounded-lg text-sm">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Opening float</span>
                      <span>SAR {shift?.opening_float.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              )}

              {currentStep === 2 && (
                <div className="space-y-4 fade-slide-in">
                  <div className="text-center space-y-1">
                    <h3 className="font-medium">Review sales & variance</h3>
                    <p className="text-sm text-muted-foreground">
                      Review payment breakdown and cash variance
                    </p>
                  </div>

                  {/* COGS vs Expense rollup with theoretical baseline */}
                  <ShiftSummary
                    shift={shift ? { id: shift.id, opened_at: shift.opened_at, closed_at: null, template_id: (shift as any).template_id ?? null } : null}
                  />

                  {/* Payment Breakdown - using cash_events as operational source */}
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wide">Sales by Payment Method</Label>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="p-3 bg-accent/50 rounded-lg text-center">
                        <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground mb-1">
                          <Banknote className="h-3 w-3" />
                          Cash
                        </div>
                        <span className="font-semibold text-sm">
                          SAR {cashEvents
                            .filter((e) => e.event_type === "sale" && e.payment_method === "cash")
                            .reduce((sum, e) => sum + e.amount, 0)
                            .toLocaleString()}
                        </span>
                      </div>
                      <div className="p-3 bg-accent/50 rounded-lg text-center">
                        <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground mb-1">
                          <CreditCard className="h-3 w-3" />
                          Card
                        </div>
                        <span className="font-semibold text-sm">
                          SAR {cashEvents
                            .filter((e) => e.event_type === "sale" && e.payment_method === "card")
                            .reduce((sum, e) => sum + e.amount, 0)
                            .toLocaleString()}
                        </span>
                      </div>
                      <div className="p-3 bg-accent/50 rounded-lg text-center">
                        <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground mb-1">
                          <Wallet className="h-3 w-3" />
                          Other
                        </div>
                        <span className="font-semibold text-sm">
                          SAR {cashEvents
                            .filter((e) => e.event_type === "sale" && e.payment_method === "other")
                            .reduce((sum, e) => sum + e.amount, 0)
                            .toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <div className="flex justify-between p-3 bg-primary/5 border border-primary/20 rounded-lg">
                      <span className="font-medium">Total Sales</span>
                      <span className="font-semibold">
                        SAR {cashEvents
                          .filter((e) => e.event_type === "sale")
                          .reduce((sum, e) => sum + e.amount, 0)
                          .toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {/* Reconciliation Section */}
                  <div className="space-y-3 pt-2 border-t">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wide">Payment Reconciliation</Label>
                    
                    {/* Cash Reconciliation */}
                    {(() => {
                      const cashSales = cashEvents
                        .filter((e) => e.event_type === "sale" && e.payment_method === "cash")
                        .reduce((sum, e) => sum + e.amount, 0);
                      const cashRefunds = cashEvents
                        .filter((e) => e.event_type === "refund" && e.payment_method === "cash")
                        .reduce((sum, e) => sum + e.amount, 0);
                      const cashDrops = cashEvents
                        .filter((e) => e.event_type === "drop")
                        .reduce((sum, e) => sum + e.amount, 0);
                      const otherAdjustments = cashEvents
                        .filter(
                          (e) =>
                            e.event_type === "adjustment" &&
                            e.payment_method === "cash" &&
                            e.reference_type !== "installment_payment" &&
                            e.reference_type !== "installment_payment_void",
                        )
                        .reduce((sum, e) => sum + e.amount, 0);
                      const openingFloat = shift?.opening_float || 0;
                      
                      return (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                            <Banknote className="h-3 w-3" />
                            Cash
                          </div>
                          {/* Calculation breakdown */}
                          <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2 space-y-0.5">
                            <div className="flex justify-between">
                              <span>Opening float</span>
                              <span>SAR {openingFloat.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>+ Cash sales</span>
                              <span>SAR {cashSales.toLocaleString()}</span>
                            </div>
                            {cashRefunds > 0 && (
                              <div className="flex justify-between text-destructive">
                                <span>− Refunds</span>
                                <span>SAR {cashRefunds.toLocaleString()}</span>
                              </div>
                            )}
                            {cashDrops > 0 && (
                              <div className="flex justify-between text-warning">
                                <span>− Drops</span>
                                <span>SAR {cashDrops.toLocaleString()}</span>
                              </div>
                            )}
                            {installmentPayouts !== 0 && (
                              <div className="flex justify-between text-warning">
                                <span>− BNPL installment payouts</span>
                                <span>SAR {Math.abs(installmentPayouts).toLocaleString()}</span>
                              </div>
                            )}
                            {otherAdjustments !== 0 && (
                              <div className="flex justify-between">
                                <span>{otherAdjustments >= 0 ? "+" : "−"} Cash adjustments</span>
                                <span>SAR {Math.abs(otherAdjustments).toLocaleString()}</span>
                              </div>
                            )}
                            <div className="flex justify-between font-medium border-t border-border/50 pt-1 mt-1">
                              <span>= Expected</span>
                              <span>SAR {expectedCash.toLocaleString()}</span>
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-sm">
                            <div className="p-2 bg-accent/50 rounded text-center">
                              <div className="text-xs text-muted-foreground">Expected</div>
                              <div className="font-medium">SAR {expectedCash.toLocaleString()}</div>
                            </div>
                            <div className="p-2 bg-accent/50 rounded text-center">
                              <div className="text-xs text-muted-foreground">Counted</div>
                              <div className="font-medium">SAR {countedCash.toLocaleString()}</div>
                            </div>
                            <div
                              className={cn(
                                "p-2 rounded text-center border",
                                varianceStatus === "perfect" && "border-success/30 bg-success/5",
                                varianceStatus === "minor" && "border-warning/30 bg-warning/5",
                                varianceStatus === "investigate" && "border-destructive/30 bg-destructive/5"
                              )}
                            >
                              <div className="text-xs text-muted-foreground">Variance</div>
                              <div
                                className={cn(
                                  "font-medium",
                                  varianceStatus === "perfect" && "text-success",
                                  varianceStatus === "minor" && "text-warning",
                                  varianceStatus === "investigate" && "text-destructive"
                                )}
                              >
                                {variance >= 0 ? "+" : ""}SAR {variance.toLocaleString()}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Card Reconciliation */}
                    {(() => {
                      const expectedCard = cashEvents
                        .filter((e) => e.event_type === "sale" && e.payment_method === "card")
                        .reduce((sum, e) => sum + e.amount, 0);
                      const cardRefunds = cashEvents
                        .filter((e) => e.event_type === "refund" && e.payment_method === "card")
                        .reduce((sum, e) => sum + e.amount, 0);
                      const netExpectedCard = expectedCard - cardRefunds;
                      const cardVariance = countedCard - netExpectedCard;
                      const cardStatus = cardVariance === 0 ? "perfect" : Math.abs(cardVariance) <= (thresholds?.minor_threshold || 10) ? "minor" : "investigate";
                      
                      return (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                            <CreditCard className="h-3 w-3" />
                            Card
                          </div>
                          {/* Calculation breakdown */}
                          <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2 space-y-0.5">
                            <div className="flex justify-between">
                              <span>Card sales</span>
                              <span>SAR {expectedCard.toLocaleString()}</span>
                            </div>
                            {cardRefunds > 0 && (
                              <div className="flex justify-between text-destructive">
                                <span>− Refunds</span>
                                <span>SAR {cardRefunds.toLocaleString()}</span>
                              </div>
                            )}
                            <div className="flex justify-between font-medium border-t border-border/50 pt-1 mt-1">
                              <span>= Expected</span>
                              <span>SAR {netExpectedCard.toLocaleString()}</span>
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-sm">
                            <div className="p-2 bg-accent/50 rounded text-center">
                              <div className="text-xs text-muted-foreground">Expected</div>
                              <div className="font-medium">SAR {netExpectedCard.toLocaleString()}</div>
                            </div>
                            <div className="p-2 bg-accent/50 rounded text-center">
                              <div className="text-xs text-muted-foreground">Counted</div>
                              <div className="font-medium">SAR {countedCard.toLocaleString()}</div>
                            </div>
                            <div
                              className={cn(
                                "p-2 rounded text-center border",
                                cardStatus === "perfect" && "border-success/30 bg-success/5",
                                cardStatus === "minor" && "border-warning/30 bg-warning/5",
                                cardStatus === "investigate" && "border-destructive/30 bg-destructive/5"
                              )}
                            >
                              <div className="text-xs text-muted-foreground">Variance</div>
                              <div
                                className={cn(
                                  "font-medium",
                                  cardStatus === "perfect" && "text-success",
                                  cardStatus === "minor" && "text-warning",
                                  cardStatus === "investigate" && "text-destructive"
                                )}
                              >
                                {cardVariance >= 0 ? "+" : ""}SAR {cardVariance.toLocaleString()}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Inventory-linked stock movements during this shift */}
                  {inventoryMovements.length > 0 && (() => {
                    const purchases = inventoryMovements.filter(m => m.movement_type === 'purchase');
                    const usages = inventoryMovements.filter(m => m.movement_type === 'usage' || m.movement_type === 'waste');
                    const totalPurchaseSpend = purchases.reduce((s, m) => s + (m.amount || 0), 0);
                    const totalUsageSpend = usages.reduce((s, m) => s + (m.amount || 0), 0);

                    // Per-item rollup
                    type Roll = {
                      key: string;
                      name: string;
                      unit: string;
                      purchaseQty: number;
                      purchaseSpend: number;
                      usageQty: number;
                      usageSpend: number;
                      adjustQty: number;
                    };
                    const rolls = new Map<string, Roll>();
                    inventoryMovements.forEach((m) => {
                      const key = m.inventory_item_id || m.item_name;
                      const r = rolls.get(key) || {
                        key,
                        name: m.item_name,
                        unit: m.stock_unit,
                        purchaseQty: 0,
                        purchaseSpend: 0,
                        usageQty: 0,
                        usageSpend: 0,
                        adjustQty: 0,
                      };
                      const qty = Number(m.quantity_change) || 0;
                      const amt = Number(m.amount) || 0;
                      if (m.movement_type === 'purchase') {
                        r.purchaseQty += qty;
                        r.purchaseSpend += amt;
                      } else if (m.movement_type === 'usage' || m.movement_type === 'waste') {
                        r.usageQty += Math.abs(qty);
                        r.usageSpend += amt;
                      } else if (m.movement_type === 'adjustment') {
                        r.adjustQty += qty;
                      }
                      rolls.set(key, r);
                    });
                    const perItem = Array.from(rolls.values()).sort((a, b) =>
                      (b.purchaseSpend + b.usageSpend) - (a.purchaseSpend + a.usageSpend)
                    );
                    return (
                      <div className="space-y-2 pt-2 border-t">
                        <Label className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                          <Package className="h-3 w-3" />
                          Stock movements during shift
                          {stockExplanationRequired && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive text-[10px] font-semibold border border-destructive/30 normal-case tracking-normal">
                              <AlertCircle className="h-2.5 w-2.5" />
                              {stockVariancePct.toFixed(0)}% variance - reason required
                            </span>
                          )}
                        </Label>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div className="p-2 bg-emerald-500/10 border border-emerald-500/30 rounded text-center">
                            <div className="text-xs text-muted-foreground">Purchases</div>
                            <div className="font-medium text-emerald-700 dark:text-emerald-400">
                              {purchases.length} item{purchases.length === 1 ? '' : 's'}
                            </div>
                            {totalPurchaseSpend > 0 && (
                              <div className="text-xs font-mono mt-0.5">
                                SAR {totalPurchaseSpend.toLocaleString()}
                              </div>
                            )}
                          </div>
                          <div className="p-2 bg-amber-500/10 border border-amber-500/30 rounded text-center">
                            <div className="text-xs text-muted-foreground">Usage / waste</div>
                            <div className="font-medium text-amber-700 dark:text-amber-400">
                              {usages.length} entr{usages.length === 1 ? 'y' : 'ies'}
                            </div>
                            {totalUsageSpend > 0 && (
                              <div className="text-xs font-mono mt-0.5">
                                SAR {totalUsageSpend.toLocaleString()}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Per-item breakdown table */}
                        <div className="rounded border bg-card overflow-hidden">
                          <div className="grid grid-cols-12 gap-1 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground bg-muted/40">
                            <div className="col-span-4">Item</div>
                            <div className="col-span-2 text-right">Net qty</div>
                            <div className="col-span-3 text-right">Purchase spend</div>
                            <div className="col-span-3 text-right">Usage / Variance</div>
                          </div>
                          <div className="max-h-48 overflow-y-auto divide-y divide-border/50">
                            {perItem.slice(0, 20).map(r => {
                              const netQty = r.purchaseQty - r.usageQty + r.adjustQty;
                              const variance = r.purchaseSpend - r.usageSpend;
                              return (
                                <div key={r.key} className="grid grid-cols-12 gap-1 px-2 py-1.5 text-xs items-center">
                                  <div className="col-span-4 font-medium truncate" title={r.name}>{r.name}</div>
                                  <div className={cn(
                                    'col-span-2 text-right font-mono',
                                    netQty > 0 ? 'text-emerald-700 dark:text-emerald-400' : netQty < 0 ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'
                                  )}>
                                    {netQty > 0 ? '+' : ''}{netQty.toFixed(2)} <span className="text-muted-foreground">{r.unit}</span>
                                  </div>
                                  <div className="col-span-3 text-right font-mono text-muted-foreground">
                                    {r.purchaseSpend > 0 ? `SAR ${r.purchaseSpend.toLocaleString()}` : '-'}
                                  </div>
                                  <div className={cn(
                                    'col-span-3 text-right font-mono',
                                    variance >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'
                                  )}>
                                    {r.usageSpend > 0 ? `SAR ${r.usageSpend.toLocaleString()}` : '-'}
                                    {(r.purchaseSpend > 0 || r.usageSpend > 0) && (
                                      <span className="block text-[10px] text-muted-foreground">
                                        Δ {variance >= 0 ? '+' : ''}{variance.toFixed(0)}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                            {perItem.length > 20 && (
                              <div className="px-2 py-1 text-[11px] text-muted-foreground text-center">
                                +{perItem.length - 20} more items - see Inventory → Movements
                              </div>
                            )}
                          </div>
                        </div>

                        {totalPurchaseSpend > 0 && (
                          <p className="text-[11px] text-muted-foreground">
                            Note: cash purchases recorded as paid expenses are already reflected in cash drops/expected cash if they used the drawer.
                          </p>
                        )}
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground bg-muted/40 border border-border rounded p-2">
                          <Lock className="h-3 w-3" />
                          <span>
                            Closing this shift will <strong className="text-foreground">lock</strong> these stock movements and inventory expenses - they can't be edited or deleted afterwards.
                          </span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {currentStep === 3 && (
                <div className="space-y-4 fade-slide-in">
                  <div className="text-center space-y-1">
                    <h3 className="font-medium">
                      {explanationRequired ? "Variance Explanation Required" : "Add notes (optional)"}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {explanationRequired 
                        ? `Variance of SAR ${Math.abs(variance).toLocaleString()} exceeds threshold. Explanation is mandatory.`
                        : "Record any relevant details about this shift"
                      }
                    </p>
                  </div>

                  {/* Variance Explanation (Required for threshold breaches) */}
                  {explanationRequired && (
                    <div className="space-y-2">
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                          A variance of SAR {Math.abs(variance).toLocaleString()} requires a mandatory explanation 
                          before the shift can be closed. This will be logged for accountability.
                        </AlertDescription>
                      </Alert>
                      <Label htmlFor="variance-explanation">
                        Variance Explanation <span className="text-destructive">*</span>
                      </Label>
                      <Textarea
                        id="variance-explanation"
                        value={varianceExplanation}
                        onChange={(e) => setVarianceExplanation(e.target.value)}
                        placeholder="Explain the cause of this variance (e.g., wrong change given, refund not recorded, etc.)"
                        rows={3}
                        className="border-destructive/50"
                      />
                    </div>
                  )}

                  {/* Stock Variance Explanation (Required when stock spend variance >= 15%) */}
                  {stockExplanationRequired && (
                    <div className="space-y-2">
                      <Alert variant="destructive">
                        <Package className="h-4 w-4" />
                        <AlertDescription>
                          Stock spend variance is{' '}
                          <strong>{stockVariancePct.toFixed(1)}%</strong>{' '}
                          (purchases SAR {stockTotals.purchase.toLocaleString()} vs usage SAR {stockTotals.usage.toLocaleString()}).
                          A reason is required at ≥ {STOCK_VARIANCE_THRESHOLD_PCT}%.
                        </AlertDescription>
                      </Alert>
                      <Label htmlFor="stock-variance-explanation">
                        Stock Variance Reason <span className="text-destructive">*</span>
                      </Label>
                      <Textarea
                        id="stock-variance-explanation"
                        value={stockVarianceExplanation}
                        onChange={(e) => setStockVarianceExplanation(e.target.value.slice(0, 500))}
                        placeholder="e.g., bulk supplier delivery received but not yet consumed; spoilage of fresh produce; transfer to other branch."
                        rows={3}
                        className="border-destructive/50"
                        maxLength={500}
                      />
                      <p className="text-[11px] text-muted-foreground text-right">
                        {stockVarianceExplanation.length}/500
                      </p>
                    </div>
                  )}

                  {/* Regular notes */}
                  <div className="space-y-2">
                    <Label htmlFor="shift-notes">Shift Notes</Label>
                    <Textarea
                      id="shift-notes"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Any notes about the shift..."
                      rows={2}
                    />
                  </div>

                  {/* Final summary */}
                  <div className="p-4 border rounded-lg space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Drawer</span>
                      <span className="font-medium">{shift?.drawers?.name || "-"}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Deposit amount</span>
                      <span className="font-medium">SAR {countedCash.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Variance</span>
                      <span
                        className={cn(
                          "font-medium",
                          varianceStatus === "perfect" && "text-success",
                          varianceStatus === "minor" && "text-warning",
                          (varianceStatus === "investigate" || varianceStatus === "escalated") && "text-destructive"
                        )}
                      >
                        {variance >= 0 ? "+" : ""}SAR {variance.toLocaleString()}
                      </span>
                    </div>
                    {explanationRequired && varianceExplanation && (
                      <div className="text-sm pt-2 border-t">
                        <span className="text-muted-foreground">Explanation:</span>
                        <p className="text-xs mt-1">{varianceExplanation}</p>
                      </div>
                    )}
                    {stockExplanationRequired && (
                      <div className="text-sm pt-2 border-t">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Stock variance</span>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-[11px] font-medium border border-destructive/30">
                            <Package className="h-3 w-3" />
                            {stockVariancePct.toFixed(1)}% - Reason logged
                          </span>
                        </div>
                        {stockVarianceExplanation && (
                          <p className="text-xs mt-1">{stockVarianceExplanation}</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          </ScrollArea>

            {/* Actions - outside ScrollArea so always visible */}
            <div className="flex gap-3 p-6 pt-4 border-t bg-background">
              {currentStep > 1 && (
                <Button
                  variant="outline"
                  onClick={() => setCurrentStep((s) => s - 1)}
                  disabled={loading}
                >
                  Back
                </Button>
              )}
              {currentStep === 3 && explanationRequired && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAdjustmentOpen(true)}
                  disabled={loading}
                  className="gap-2"
                >
                  <Scale className="h-4 w-4" />
                  Adjustment
                </Button>
              )}
              <Button
                className="flex-1"
                onClick={() => {
                  if (currentStep < 3) {
                    setCurrentStep((s) => s + 1);
                  } else {
                    // Validate explanation requirement
                    if (explanationRequired && !varianceExplanation.trim()) {
                      toast.error("Variance explanation is required before closing the shift");
                      return;
                    }
                    if (stockExplanationRequired && !stockVarianceExplanation.trim()) {
                      toast.error("A stock variance reason is required (≥ 15% variance)");
                      return;
                    }
                    handleCloseShift();
                  }
                }}
                disabled={
                  loading || 
                  (currentStep === 1 && countedCash <= 0 && countedCard <= 0) ||
                  (currentStep === 3 && explanationRequired && !varianceExplanation.trim()) ||
                  (currentStep === 3 && stockExplanationRequired && !stockVarianceExplanation.trim())
                }
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : currentStep < 3 ? (
                  "Continue"
                ) : explanationRequired && !varianceExplanation.trim() ? (
                  "Explanation Required"
                ) : (
                  "Close Shift"
                )}
              </Button>
            </div>
          </>
        )}
        <DayEndAdjustmentDialog
          open={adjustmentOpen}
          onOpenChange={setAdjustmentOpen}
          scope="shift"
          scopeRefId={shift?.id ?? null}
          businessDate={(shift?.opened_at ?? new Date().toISOString()).slice(0, 10)}
          defaultAmount={variance || undefined}
          title="Shift - Day-End Adjustment"
        />
      </DialogContent>
    </Dialog>
  );
}
