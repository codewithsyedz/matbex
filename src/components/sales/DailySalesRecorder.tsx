import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { format, isToday, isFuture } from "date-fns";
import { useCurrency } from "@/hooks/useCurrency";
import { parseLedgerValidationError } from "@/lib/ledgerValidationError";
import { logSalePostingFailure } from "@/lib/salePostingMonitor";
import { 
  useDailySales, 
  useDeliveryBreakdown,
  DELIVERY_PLATFORMS,
  DeliveryPlatform,
  VarianceStatus 
} from "@/hooks/useDailySales";
import { 
  CalendarIcon, 
  Banknote, 
  CreditCard, 
  Truck, 
  Wallet,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Calculator,
  Lock,
  Loader2,
  Plus,
  Trash2,
  TrendingUp,
  TrendingDown,
  BookOpen,
  Info,
  Lightbulb,
  ArrowRight,
  RotateCcw
} from "lucide-react";
import { db } from "@/integrations/db/client";
import { toast } from "sonner";
import { DayEndAdjustmentDialog } from "@/components/dayend/DayEndAdjustmentDialog";
import { DayEndAdjustedBadge } from "@/components/dayend/DayEndAdjustedBadge";
import { reconciledTotal } from "@/lib/dayEndReconciliation";
import { Scale } from "lucide-react";
import { POSDetailsDialog } from "@/components/sales/POSDetailsDialog";
import { PaymentMappingDialog } from "@/components/sales/PaymentMappingDialog";
import { DayEndAuditLogDialog } from "@/components/sales/DayEndAuditLogDialog";
import { ResolveVarianceWizard } from "@/components/sales/ResolveVarianceWizard";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { useVarianceThresholds } from "@/hooks/useShiftVariance";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useTranslation } from "react-i18next";
import { postSalesWithAi, postSalesToConfirmedAccount, AiIncomeNeedsReviewError } from "@/lib/aiIncomeJournal";

interface DeliveryEntry {
  platform: DeliveryPlatform;
  gross_sales: number;
  platform_commission: number;
  order_count: number;
  notes: string;
}

export function DailySalesRecorder() {
  const { restaurant, user } = useAuth();
  const { format: formatCurrency } = useCurrency();
  const { t } = useTranslation();
  
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const dateStr = format(selectedDate, 'yyyy-MM-dd');
  
  const { dailySales, systemTotal, systemBreakdown, isBreakdownLoading, isLoading, requiresBranchSelection, createDailySales, updateDailySales, closeDay } = useDailySales(dateStr);
  const { data: deliveryBreakdown = [] } = useDeliveryBreakdown(dailySales?.id);
  
  // Form state
  const [cashSales, setCashSales] = useState<string>('');
  const [cardSales, setCardSales] = useState<string>('');
  const [deliverySales, setDeliverySales] = useState<string>('');
  const [otherSales, setOtherSales] = useState<string>('');
  const [posTotal, setPosTotal] = useState<string>('');
  const [varianceNotes, setVarianceNotes] = useState<string>('');
  const [deliveryEntries, setDeliveryEntries] = useState<DeliveryEntry[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isPostingToLedger, setIsPostingToLedger] = useState(false);
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [posDetailsOpen, setPosDetailsOpen] = useState(false);
  const [reverseTarget, setReverseTarget] = useState<{ id: string; amount: number; reason: string } | null>(null);
  const [reversalReason, setReversalReason] = useState("");
  const [mappingOpen, setMappingOpen] = useState(false);
  const [auditLogOpen, setAuditLogOpen] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [varianceResolved, setVarianceResolved] = useState(false);
  const [guidanceReason, setGuidanceReason] = useState<string>('');
  const queryClient = useQueryClient();
  const { activeBranchId, isAllBranches } = useBranch();
  const { thresholds } = useVarianceThresholds();
  const minorThreshold = thresholds?.minor_threshold ?? 10;
  const requireAdjustmentForClose = !!thresholds?.require_adjustment_for_close;

  // Day-end adjustments posted for this day (for adjusted-total display + breakdowns)
  const {
    data: dayEndAdjustmentsData,
    isLoading: isLoadingAdjustments,
    isError: isAdjustmentsError,
    refetch: refetchAdjustments,
  } = useQuery({
    queryKey: ["day-end-adjustments-net", dailySales?.id, dateStr, isAllBranches ? "all" : activeBranchId],
    enabled: !!dailySales?.id,
    staleTime: 30_000,
    queryFn: async () => {
      let q = db
        .from("day_end_adjustments")
        .select("id, amount, reason, notes, created_at, reversed_at, reversal_of_id, ledger_posted, branch_id")
        .eq("scope", "daily_sales")
        .eq("scope_ref_id", dailySales!.id)
        .order("created_at", { ascending: true });
      if (!isAllBranches && activeBranchId) q = q.eq("branch_id", activeBranchId);
      const { data, error } = await q;
      if (error) throw error;
      const rows = data ?? [];
      const active = rows.filter((a) => !a.reversed_at && !a.reversal_of_id);
      const reversed = rows.filter((a) => a.reversed_at || a.reversal_of_id);
      const net = active.reduce((sum, a) => sum + Number(a.amount || 0), 0);
      return { rows, active, reversed, net };
    },
  });
  const netDayEndAdjustment = dayEndAdjustmentsData?.net ?? 0;
  const activeAdjustments = dayEndAdjustmentsData?.active ?? [];
  const reversedAdjustmentCount = dayEndAdjustmentsData?.reversed.length ?? 0;

  // Which date the current form state was hydrated for. Prevents carrying one
  // day's cash/card figures into another day while the queries re-fetch.
  const hydratedForDate = useRef<string | null>(null);

  // Clear the form the moment the date changes, so stale figures can never be
  // saved against the newly selected day.
  useEffect(() => {
    if (hydratedForDate.current === dateStr) return;
    hydratedForDate.current = null;
    setCashSales('');
    setCardSales('');
    setDeliverySales('');
    setOtherSales('');
    setPosTotal('');
    setVarianceNotes('');
    setDeliveryEntries([]);
  }, [dateStr]);

  // Load existing data when date changes
  useEffect(() => {
    // Wait until both queries resolved for THIS date before hydrating.
    if (isLoading || isBreakdownLoading) return;
    if (hydratedForDate.current === dateStr) return;

    if (dailySales && 'id' in dailySales) {
      setCashSales(dailySales.cash_sales?.toString() || '');
      setCardSales(dailySales.card_sales?.toString() || '');
      setDeliverySales(dailySales.delivery_sales?.toString() || '');
      setOtherSales(dailySales.other_sales?.toString() || '');
      setPosTotal(dailySales.pos_reported_total?.toString() || '');
      setVarianceNotes(dailySales.variance_notes || '');
    } else {
      // Pre-fill from POS transactions for new date (still editable)
      setCashSales(systemBreakdown?.cash ? String(systemBreakdown.cash) : '');
      setCardSales(systemBreakdown?.card ? String(systemBreakdown.card) : '');
      setDeliverySales(systemBreakdown?.delivery ? String(systemBreakdown.delivery) : '');
      setOtherSales(systemBreakdown?.other ? String(systemBreakdown.other) : '');
      setPosTotal('');
      setVarianceNotes('');
      setDeliveryEntries([]);
    }
    hydratedForDate.current = dateStr;
  }, [dailySales, dateStr, systemBreakdown, isLoading, isBreakdownLoading]);

  const resetToPOS = () => {
    setCashSales(systemBreakdown?.cash ? String(systemBreakdown.cash) : '');
    setCardSales(systemBreakdown?.card ? String(systemBreakdown.card) : '');
    setDeliverySales(systemBreakdown?.delivery ? String(systemBreakdown.delivery) : '');
    setOtherSales(systemBreakdown?.other ? String(systemBreakdown.other) : '');
    // Align reconciliation: clear manual POS override so variance falls to 0
    setPosTotal('');
      toast.success(t('app.dailySalesRecorder.resetSuccess'));
  };

  // Load delivery breakdown
  useEffect(() => {
    if (deliveryBreakdown.length > 0) {
      setDeliveryEntries(deliveryBreakdown.map(b => ({
        platform: b.platform,
        gross_sales: b.gross_sales,
        platform_commission: b.platform_commission,
        order_count: b.order_count,
        notes: b.notes || '',
      })));
    }
  }, [deliveryBreakdown]);

  // Calculated values
  // Sales put on customers' tabs: worked out from the POS (not typed), left out of cash/card
  // and posted to the Customer Accounts receivable when the day is posted.
  const accountSales = Number(dailySales?.account_sales ?? systemBreakdown?.account ?? 0) || 0;
  const totalSales = 
    (parseFloat(cashSales) || 0) + 
    (parseFloat(cardSales) || 0) + 
    (parseFloat(deliverySales) || 0) + 
    (parseFloat(otherSales) || 0) +
    accountSales;
  
  const isLocked = dailySales?.status === 'closed';
  const isPrefilling = isBreakdownLoading && !dailySales;
  const inputsDisabled = isLocked || isPrefilling || requiresBranchSelection;

  // POS Reported defaults to the entered totalSales unless the user overrides it.
  const posReportedTotal = parseFloat(posTotal) || totalSales;
  const variance = posReportedTotal - (systemTotal || 0);

  const getVarianceStatus = (): VarianceStatus => {
    // Pending only when both sides are empty
    if (!posReportedTotal && !systemTotal) return 'pending';
    if (Math.abs(variance) < 0.01) return 'matched';
    if (Math.abs(variance) <= minorThreshold) return 'minor';
    return 'investigate';
  };

  // Live status (recomputed on every keystroke); persisted status used only when locked
  const liveVarianceStatus = getVarianceStatus();
  const varianceStatus = isLocked ? (dailySales?.variance_status || liveVarianceStatus) : liveVarianceStatus;

  // Auto-clear variance note when variance returns to matched
  useEffect(() => {
    if (!isLocked && liveVarianceStatus === 'matched' && varianceNotes) {
      setVarianceNotes('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveVarianceStatus, isLocked]);
  
  const deliveryTotal = deliveryEntries.reduce((sum, e) => sum + (e.gross_sales || 0), 0);
  const deliveryCommission = deliveryEntries.reduce((sum, e) => sum + (e.platform_commission || 0), 0);

  const hasVariance = Math.abs(variance) >= 0.01;
  // Close Day enabled when no variance, or variance has been resolved via wizard,
  // or status is matched/minor/resolved (already acceptable).
  const canClose =
    !isLocked &&
    (
      !hasVariance ||
      varianceResolved ||
      varianceStatus === 'matched' ||
      varianceStatus === 'minor' ||
      varianceStatus === 'resolved'
    );

  // Reset resolved flag when variance changes meaningfully
  useEffect(() => {
    if (!hasVariance) setVarianceResolved(false);
  }, [hasVariance, variance]);

  const handleSave = async () => {
    if (!restaurant?.id) return;

    setIsSaving(true);
    // Detect auto-fill of POS Reported Total: user left it blank but payment-types > 0
    const isPosAutoFilled = posTotal === '' && totalSales > 0;
    const resolvedPosTotal = parseFloat(posTotal) || (isPosAutoFilled ? totalSales : undefined);
    const autoFillNote = isPosAutoFilled
      ? `[Auto-fill ${new Date().toISOString()}] POS Reported Total auto-filled from payment-type total: ` +
        `Cash ${formatCurrency(parseFloat(cashSales) || 0)} + Card ${formatCurrency(parseFloat(cardSales) || 0)} + ` +
        `Delivery ${formatCurrency(parseFloat(deliverySales) || 0)} + Other ${formatCurrency(parseFloat(otherSales) || 0)} ` +
        `= ${formatCurrency(totalSales)}.`
      : '';
    const mergedNotes = [varianceNotes?.trim(), autoFillNote].filter(Boolean).join('\n').trim() || undefined;

    try {
      if (dailySales?.id) {
        await updateDailySales.mutateAsync({
          id: dailySales.id,
          cash_sales: parseFloat(cashSales) || 0,
          card_sales: parseFloat(cardSales) || 0,
          delivery_sales: parseFloat(deliverySales) || 0,
          other_sales: parseFloat(otherSales) || 0,
          pos_reported_total: resolvedPosTotal,
          variance_notes: mergedNotes,
        });
        if (isPosAutoFilled) setVarianceNotes((prev) => (prev?.trim() ? `${prev}\n${autoFillNote}` : autoFillNote));
      } else {
        await createDailySales.mutateAsync({
          sales_date: dateStr,
          cash_sales: parseFloat(cashSales) || 0,
          card_sales: parseFloat(cardSales) || 0,
          delivery_sales: parseFloat(deliverySales) || 0,
          other_sales: parseFloat(otherSales) || 0,
          pos_reported_total: resolvedPosTotal,
          variance_notes: mergedNotes,
          delivery_breakdown: deliveryEntries.length > 0 ? deliveryEntries : undefined,
        });
        if (isPosAutoFilled) setVarianceNotes((prev) => (prev?.trim() ? `${prev}\n${autoFillNote}` : autoFillNote));
      }
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * True when the Cash/Card/Delivery/Other/POS boxes differ from what is saved.
   * Closing or adjusting the day must never run against stale saved figures.
   */
  const hasUnsavedFigures = (): boolean => {
    if (!dailySales?.id) return false;
    const n = (v: string) => Math.round((parseFloat(v) || 0) * 100);
    const s = (v: unknown) => Math.round((Number(v) || 0) * 100);
    return (
      n(cashSales) !== s(dailySales.cash_sales) ||
      n(cardSales) !== s(dailySales.card_sales) ||
      n(deliverySales) !== s(dailySales.delivery_sales) ||
      n(otherSales) !== s(dailySales.other_sales) ||
      (posTotal !== '' && n(posTotal) !== s(dailySales.pos_reported_total))
    );
  };

  /** Persist edited figures before any close / adjustment step. */
  const saveFiguresIfChanged = async () => {
    if (!dailySales?.id || isLocked || !hasUnsavedFigures()) return;
    await updateDailySales.mutateAsync({
      id: dailySales.id,
      cash_sales: parseFloat(cashSales) || 0,
      card_sales: parseFloat(cardSales) || 0,
      delivery_sales: parseFloat(deliverySales) || 0,
      other_sales: parseFloat(otherSales) || 0,
      pos_reported_total: parseFloat(posTotal) || totalSales,
      variance_notes: varianceNotes?.trim() || undefined,
    });
  };

  const openAdjustment = async () => {
    try {
      await saveFiguresIfChanged();
      setAdjustmentOpen(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the figures");
    }
  };

  const handleCloseDay = async () => {
    if (!dailySales?.id) return;

    try {
      await saveFiguresIfChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the figures");
      return;
    }

    // Variance present and not yet resolved → open wizard
    if (hasVariance && !varianceResolved) {
      setChecklistOpen(true);
      return;
    }

    setIsSaving(true);
    try {
      await closeDay.mutateAsync({
        id: dailySales.id,
        varianceNotes: hasVariance && varianceNotes ? varianceNotes : undefined,
      });
      await handlePostToLedger();
    } finally {
      setIsSaving(false);
    }
  };

  const handleChecklistConfirm = async (composedNotes: string) => {
    if (!dailySales?.id) return;
    setIsSaving(true);
    try {
      await saveFiguresIfChanged();
      setVarianceNotes(composedNotes);
      setVarianceResolved(true);
      await closeDay.mutateAsync({
        id: dailySales.id,
        varianceNotes: composedNotes,
      });
      await handlePostToLedger();
      setChecklistOpen(false);
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * Called by DayEndAdjustmentDialog after a successful "Post & Close Day".
   * Closes the day, then surfaces a 30-second Undo toast that reverses the
   * adjustment AND reopens the day. Posting to the ledger is a separate
   * explicit action, so during the grace window nothing has been posted yet.
   */
  const handlePostedAndCloseDay = async (adjustmentId: string) => {
    if (!dailySales?.id) return;
    setIsSaving(true);
    // The day-end adjustment offsets the variance in the ledger, so we treat
    // it as resolved here. We also synthesize a clear, audit-friendly note
    // (preserving any user-entered notes) so the close-day variance check
    // accepts it instead of blocking with "unresolved variance".
    const autoResolutionNote =
      `[Auto-resolved ${new Date().toISOString()}] Variance of ${formatCurrency(variance)} ` +
      `reconciled by day-end adjustment ${adjustmentId.slice(0, 8)} (POS Reported ${formatCurrency(posReportedTotal)} ` +
      `vs System ${formatCurrency(systemTotal || 0)}).`;
    const composedNotes = [varianceNotes?.trim(), autoResolutionNote].filter(Boolean).join('\n').trim();
    setVarianceNotes(composedNotes);
    setVarianceResolved(true);
    try {
      await saveFiguresIfChanged();
      await closeDay.mutateAsync({
        id: dailySales.id,
        varianceNotes: composedNotes,
      });
    } finally {
      setIsSaving(false);
    }

    const dailySalesId = dailySales.id;
    const UNDO_WINDOW_MS = 30_000;

    toast.success("Adjustment posted & day closed", {
      duration: UNDO_WINDOW_MS,
      description: "Undo available for 30 seconds - reverses the adjustment and reopens the day.",
      action: {
        label: "Undo",
        onClick: async () => {
          try {
            // 1) Reverse the day-end adjustment (immutable ledger - voids via reversal)
            const { error: revErr } = await db.rpc(
              "reverse_day_end_adjustment" as never,
              {
                p_adjustment_id: adjustmentId,
                p_reason: "Undo within 30s grace window after Post & Close Day",
              } as never
            );
            if (revErr) throw revErr;

            // 2) Reopen the day so the user can re-edit
            const { error: reopenErr } = await db
              .from("daily_sales_summary")
              .update({
                status: "draft",
                variance_resolved_at: null,
                variance_resolved_by: null,
                variance_status: "pending",
                updated_at: new Date().toISOString(),
              })
              .eq("id", dailySalesId);
            if (reopenErr) throw reopenErr;

            queryClient.invalidateQueries({ queryKey: ["daily-sales"] });
            queryClient.invalidateQueries({ queryKey: ["day-end-adjustments"] });
            toast.success("Reverted - adjustment voided and day reopened");
          } catch (e) {
            const msg = e instanceof Error ? e.message : "Undo failed";
            toast.error(msg);
          }
        },
      },
    });
  };

  const handlePostToLedger = async () => {
    if (!dailySales?.id) return;
    
    setIsPostingToLedger(true);
    try {
      const result = await postSalesWithAi(dailySales.id);
      
      toast.success(t('app.dailySalesRecorder.aiSalesPosted', {
        account: `${result.account.code} · ${result.account.name}`,
        confidence: Math.round(result.confidence * 100),
      }));
      // Refresh data in-place instead of full reload
      queryClient.invalidateQueries({ queryKey: ["daily-sales"] });
      queryClient.invalidateQueries({ queryKey: ["day-end-adjustments"] });
      queryClient.invalidateQueries({ queryKey: ["day-end-adjustments-net"] });
      queryClient.invalidateQueries({ queryKey: ["journal-entries"] });
    } catch (error: any) {
      if (error instanceof AiIncomeNeedsReviewError) {
        const s = error.result;
        const salesId = dailySales.id;
        toast.warning(`Please confirm: post to ${s.account.code} · ${s.account.name}?`, {
          description: `AI was only ${Math.round(s.confidence * 100)}% sure. ${s.rationale}`,
          duration: 30000,
          action: {
            label: "Confirm & post",
            onClick: async () => {
              try {
                await postSalesToConfirmedAccount(salesId, s.account.id);
                toast.success(`Posted to ${s.account.code} · ${s.account.name}`);
                queryClient.invalidateQueries({ queryKey: ["daily-sales"] });
                queryClient.invalidateQueries({ queryKey: ["journal-entries"] });
              } catch (e: any) {
                toast.error(e?.message ?? "Posting failed");
              }
            },
          },
        });
        return;
      }
      console.error('Ledger posting error:', error);
      const parsed = parseLedgerValidationError(error);
      if (restaurant?.id) {
        void logSalePostingFailure({
          restaurantId: restaurant.id,
          businessDate: dateStr,
          branchId: isAllBranches ? null : activeBranchId,
          source: "daily_sales",
          errorCode: error?.code ?? null,
          errorMessage: error?.message ?? "Ledger posting failed",
          context: {
            daily_sales_id: dailySales?.id ?? null,
            ledger_validation: parsed.isLedgerValidation,
            detail: parsed.isLedgerValidation ? parsed.detail : null,
          },
        });
      }
      if (parsed.isLedgerValidation) {
        toast.error(parsed.title, {
          description: `${parsed.detail} — ${parsed.fix}`,
          duration: 12000,
        });
      } else {
        toast.error(error.message || t('app.dailySalesRecorder.ledgerFailed'));
      }
    } finally {
      setIsPostingToLedger(false);
    }
  };

  const reverseMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { data, error } = await db.rpc(
        "reverse_day_end_adjustment" as never,
        { p_adjustment_id: id, p_reason: reason } as never,
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Adjustment reversed and audit logged");
      queryClient.invalidateQueries({ queryKey: ["day-end-adjustments-net"] });
      queryClient.invalidateQueries({ queryKey: ["day-end-adjustments"] });
      setReverseTarget(null);
      setReversalReason("");
    },
    onError: (e: Error) => toast.error(e.message ?? "Reversal failed"),
  });

  const addDeliveryEntry = () => {
    const usedPlatforms = deliveryEntries.map(e => e.platform);
    const available = DELIVERY_PLATFORMS.find(p => !usedPlatforms.includes(p.value));
    if (available) {
      setDeliveryEntries([...deliveryEntries, {
        platform: available.value,
        gross_sales: 0,
        platform_commission: 0,
        order_count: 0,
        notes: '',
      }]);
    }
  };

  const removeDeliveryEntry = (index: number) => {
    setDeliveryEntries(deliveryEntries.filter((_, i) => i !== index));
  };

  const updateDeliveryEntry = (index: number, field: keyof DeliveryEntry, value: string | number) => {
    const updated = [...deliveryEntries];
    updated[index] = { ...updated[index], [field]: value };
    setDeliveryEntries(updated);
    
    // Auto-update total delivery sales
    const newTotal = updated.reduce((sum, e) => sum + (e.gross_sales || 0), 0);
    setDeliverySales(newTotal.toString());
  };

  const VarianceIndicator = ({ status }: { status: VarianceStatus }) => {
    const config = {
      pending: { icon: Calculator, color: 'text-muted-foreground', bg: 'bg-muted', label: t('app.dailySalesRecorder.varianceStatus.pending') },
      matched: { icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50', label: t('app.dailySalesRecorder.varianceStatus.matched') },
      minor: { icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50', label: t('app.dailySalesRecorder.varianceStatus.minor') },
      investigate: { icon: XCircle, color: 'text-red-600', bg: 'bg-red-50', label: t('app.dailySalesRecorder.varianceStatus.investigate') },
      resolved: { icon: CheckCircle2, color: 'text-blue-600', bg: 'bg-blue-50', label: t('app.dailySalesRecorder.varianceStatus.resolved') },
    };
    const c = config[status];
    return (
      <Badge variant="outline" className={cn("gap-1", c.bg, c.color)}>
        <c.icon className="h-3 w-3" />
        {c.label}
      </Badge>
    );
  };

  if (!restaurant) {
    return <Skeleton className="h-96" />;
  }

  return (
    <div className="space-y-6">
      {/* Date Selection */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-medium">{t('app.dailySalesRecorder.title')}</CardTitle>
              <CardDescription>{t('app.dailySalesRecorder.subtitle')}</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {isLocked && (
                <Badge variant="secondary" className="gap-1">
                  <Lock className="h-3 w-3" />
                  {t('app.dailySalesRecorder.closed')}
                </Badge>
              )}
              <DayEndAdjustedBadge
                scope="daily_sales"
                businessDate={format(selectedDate, "yyyy-MM-dd")}
                scopeRefId={dailySales?.id ?? null}
              />
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="gap-2">
                    <CalendarIcon className="h-4 w-4" />
                    {format(selectedDate, 'PPP')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={(date) => date && setSelectedDate(date)}
                    disabled={(date) => isFuture(date)}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </CardHeader>
      </Card>

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          {/* Payment Type Breakdown */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-medium flex items-center gap-2">
                  <Wallet className="h-4 w-4" />
                  {t('app.dailySalesRecorder.byPaymentType')}
                  {isPrefilling && (
                    <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {t('app.dailySalesRecorder.loadingPos')}
                    </span>
                  )}
                </CardTitle>
                {!isLocked && (systemTotal || 0) > 0 && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      onClick={() => setPosDetailsOpen(true)}
                    >
                      {t('app.dailySalesRecorder.viewPosDetails')}
                    </Button>
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      onClick={() => setAuditLogOpen(true)}
                    >
                      {t('app.dailySalesRecorder.viewAuditLog')}
                    </Button>
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      onClick={() => setMappingOpen(true)}
                    >
                      {t('app.dailySalesRecorder.configureMapping')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={resetToPOS} disabled={isPrefilling}>
                      {t('app.dailySalesRecorder.resetToPos')}
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {requiresBranchSelection && (
                <Alert variant="default" className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <AlertTitle className="text-amber-900 dark:text-amber-200">
                    Select a branch to record day-end
                  </AlertTitle>
                  <AlertDescription className="text-amber-900/90 dark:text-amber-200/90 text-sm">
                    Day-end is closed per branch. Pick a specific branch in the branch
                    selector - "All branches" is a read-only rollup.
                  </AlertDescription>
                </Alert>
              )}
              {(() => {
                const txTotal = systemTotal || 0;
                if (requiresBranchSelection) return null;
                const diff = totalSales - txTotal;
                if (isPrefilling) return null;
                if (Math.abs(diff) < 0.01) return null;
                if (totalSales === 0 && txTotal === 0) return null;
                const tzLabel = systemBreakdown?.timezone || restaurant?.timezone || 'Asia/Riyadh';
                const direction = diff > 0 ? 'higher than' : 'lower than';
                return (
                  <Alert variant="default" className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <AlertTitle className="text-amber-900 dark:text-amber-200">
                      Day-End total differs from Transactions tab
                    </AlertTitle>
                    <AlertDescription className="text-amber-900/90 dark:text-amber-200/90 space-y-2">
                      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                        <span>Day-End entered: <strong>{formatCurrency(totalSales)}</strong></span>
                        <span>Transactions ({tzLabel}): <strong>{formatCurrency(txTotal)}</strong></span>
                        <span>Difference: <strong>{formatCurrency(Math.abs(diff))}</strong> {direction}</span>
                      </div>
                      <p className="text-xs leading-relaxed">
                        Both totals already use the restaurant's local day boundaries
                        ({tzLabel}). Common reasons for a remaining gap:
                      </p>
                      <ul className="text-xs list-disc pl-4 space-y-0.5">
                        <li>You manually edited cash/card/delivery/other after the prefill.</li>
                        <li>A transaction was recorded, voided, or refunded after the prefill loaded - open the audit log to refresh.</li>
                        <li>A payment method is mapped to a different bucket than expected (use Configure mapping).</li>
                        <li>Manual day-end adjustments were applied for cash drops, tips, or corrections.</li>
                      </ul>
                      <div className="flex gap-3 text-xs pt-1">
                        <button
                          type="button"
                          onClick={() => setAuditLogOpen(true)}
                          className="underline underline-offset-2 hover:text-amber-700"
                        >
                          View audit log
                        </button>
                        {!isLocked && (systemTotal || 0) > 0 && (
                          <button
                            type="button"
                            onClick={resetToPOS}
                            className="underline underline-offset-2 hover:text-amber-700"
                          >
                            Reset to POS values
                          </button>
                        )}
                      </div>
                    </AlertDescription>
                  </Alert>
                );
              })()}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {/* Cash */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-1 text-xs">
                    <Banknote className="h-3 w-3 text-emerald-600" />
                    {t('app.dailySalesRecorder.cash')} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={cashSales}
                    onChange={(e) => setCashSales(e.target.value)}
                    disabled={inputsDisabled}
                    min={0}
                    step="0.01"
                  />
                </div>
                
                {/* Card */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-1 text-xs">
                    <CreditCard className="h-3 w-3 text-blue-600" />
                    {t('app.dailySalesRecorder.card')} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={cardSales}
                    onChange={(e) => setCardSales(e.target.value)}
                    disabled={inputsDisabled}
                    min={0}
                    step="0.01"
                  />
                </div>
                
                {/* Delivery */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-1 text-xs">
                    <Truck className="h-3 w-3 text-orange-600" />
                    {t('app.dailySalesRecorder.delivery')} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={deliverySales}
                    onChange={(e) => setDeliverySales(e.target.value)}
                    disabled={inputsDisabled}
                    min={0}
                    step="0.01"
                  />
                </div>
                
                {/* Other */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-1 text-xs">
                    <Wallet className="h-3 w-3 text-gray-600" />
                    {t('app.dailySalesRecorder.other')}
                  </Label>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={otherSales}
                    onChange={(e) => setOtherSales(e.target.value)}
                    disabled={inputsDisabled}
                    min={0}
                    step="0.01"
                  />
                </div>
              </div>
              {accountSales > 0 && (
                <p className="text-xs text-muted-foreground" data-testid="account-sales-note">
                  {t('app.dailySalesRecorder.accountSales', { amount: formatCurrency(accountSales) })}
                </p>
              )}

              {/* Total Display */}
              <div className="flex items-center justify-between pt-4 border-t">
                <span className="text-sm text-muted-foreground">{t('app.dailySalesRecorder.autoTotal')}</span>
                <span className="text-2xl font-bold">{formatCurrency(totalSales)}</span>
              </div>
              {dailySales?.id && isLoadingAdjustments && (
                <div className="flex items-center justify-between pt-2">
                  <div className="flex flex-col gap-1.5">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-64" />
                  </div>
                  <Skeleton className="h-7 w-24" />
                </div>
              )}
              {dailySales?.id && isAdjustmentsError && !isLoadingAdjustments && (
                <div className="flex items-center justify-between pt-2 gap-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                    Couldn’t load day-end adjustments.
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => refetchAdjustments()}
                  >
                    Retry
                  </Button>
                </div>
              )}
              {!isLoadingAdjustments && !isAdjustmentsError && netDayEndAdjustment !== 0 && (
                (() => {
                  // Single source of truth - see src/lib/dayEndReconciliation
                  // and its regression suite. Day-end adjustments are
                  // cash-reconciliation entries (DR Cash / CR Cash Over-Short),
                  // so the Adjusted Total displayed is the POS Reported Total
                  // - never recorded + adjustment (would double-count).
                  const reconciled = reconciledTotal({
                    recordedTotal: totalSales,
                    posReportedTotal,
                    netAdjustment: netDayEndAdjustment,
                  });
                  return (
                <div className="flex items-center justify-between pt-2">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-amber-700 dark:text-amber-300 flex items-center gap-1">
                      Adjusted Total (incl. day-end)
                      <TooltipProvider delayDuration={150}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="inline-flex items-center justify-center text-amber-700/70 dark:text-amber-300/70 hover:text-amber-700 dark:hover:text-amber-300"
                              aria-label="How is the adjusted total calculated?"
                            >
                              <Info className="h-3.5 w-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
                            <p className="font-semibold mb-1">How this is calculated</p>
                            <p className="mb-2">
                              Reflects the POS Reported Total once a day-end
                              adjustment has reconciled the variance against
                              system POS transactions. The adjustment posts to
                              Cash / Cash Over-Short - it does not add revenue,
                              so it is not summed onto the Recorded Total.
                            </p>
                            <p className="text-muted-foreground">
                              Appears only when at least one day-end adjustment exists. The
                              original Recorded Total is preserved for audit; adjustments post as
                              separate immutable ledger entries.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </span>
                    <span className="text-xs text-muted-foreground" dir="ltr">
                      Recorded{" "}
                      <bdi dir="ltr">{formatCurrency(totalSales)}</bdi>
                      {" · "}
                      Adjustment{" "}
                      {netDayEndAdjustment >= 0 ? "+" : "−"}
                      <bdi dir="ltr">{formatCurrency(Math.abs(netDayEndAdjustment))}</bdi>
                      {" "}(Cash Over/Short)
                    </span>
                  </div>
                  <span className="text-2xl font-bold text-amber-700 dark:text-amber-300">
                    {formatCurrency(reconciled)}
                  </span>
                </div>
                  );
                })()
              )}
              {!isLoadingAdjustments && !isAdjustmentsError &&
                (activeAdjustments.length > 0 || reversedAdjustmentCount > 0) && (
                  <div className="pt-2 border-t border-dashed border-amber-200 dark:border-amber-900/40">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                        <Scale className="h-3.5 w-3.5" />
                        Day-end adjustments ({activeAdjustments.length} active
                        {reversedAdjustmentCount > 0 ? `, ${reversedAdjustmentCount} reversed` : ""})
                      </span>
                      <button
                        type="button"
                        onClick={() => setAuditLogOpen(true)}
                        className="text-[11px] text-primary hover:underline"
                      >
                        View audit log
                      </button>
                    </div>
                    {activeAdjustments.length > 0 ? (
                      <ul className="space-y-1">
                        {activeAdjustments.map((a) => {
                          const amt = Number(a.amount || 0);
                          const sign = amt >= 0 ? "+" : "−";
                          const reason = (a.reason || "").replace(/_/g, " ");
                          return (
                            <li
                              key={a.id}
                              className="flex items-start justify-between gap-3 text-[11px] text-muted-foreground"
                            >
                              <span className="flex-1 min-w-0">
                                <span className="capitalize text-foreground/80">{reason || "adjustment"}</span>
                                {a.notes ? (
                                  <span className="opacity-80"> - <span className="line-clamp-1 inline">{a.notes}</span></span>
                                ) : null}
                              </span>
                              <span className="flex items-center gap-2 shrink-0">
                                {a.ledger_posted && (
                                  <button
                                    type="button"
                                    onClick={() => setReverseTarget({ id: a.id, amount: amt, reason: a.reason || "" })}
                                    className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                                  >
                                    <RotateCcw className="h-3 w-3" />
                                    Reverse
                                  </button>
                                )}
                                <span
                                  className={cn(
                                    "font-medium tabular-nums",
                                    amt > 0 ? "text-emerald-700 dark:text-emerald-400" :
                                    amt < 0 ? "text-red-700 dark:text-red-400" :
                                    "text-muted-foreground",
                                  )}
                                  dir="ltr"
                                >
                                  {sign}<bdi dir="ltr">{formatCurrency(Math.abs(amt))}</bdi>
                                </span>
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="text-[11px] text-muted-foreground">
                        All entries reversed - net effect on books is zero. Click "View audit log" for the full trail.
                      </p>
                    )}
                  </div>
                )}
            </CardContent>
          </Card>

          {/* Delivery Platform Breakdown */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-medium flex items-center gap-2">
                  <Truck className="h-4 w-4" />
                  {t('app.dailySalesRecorder.deliveryBreakdown')}
                </CardTitle>
                {!isLocked && deliveryEntries.length < DELIVERY_PLATFORMS.length && (
                  <Button variant="outline" size="sm" onClick={addDeliveryEntry}>
                    <Plus className="h-4 w-4 mr-1" />
                    {t('app.dailySalesRecorder.addPlatform')}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {deliveryEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {t('app.dailySalesRecorder.noDelivery')}
                </p>
              ) : (
                <div className="space-y-3">
                  {deliveryEntries.map((entry, index) => (
                    <div key={index} className="flex items-center gap-3 p-3 border rounded-lg bg-muted/30">
                      <select
                        className="px-2 py-1 border rounded text-sm bg-background"
                        value={entry.platform}
                        onChange={(e) => updateDeliveryEntry(index, 'platform', e.target.value as DeliveryPlatform)}
                        disabled={inputsDisabled}
                      >
                        {DELIVERY_PLATFORMS.map(p => (
                          <option key={p.value} value={p.value} disabled={
                            entry.platform !== p.value && deliveryEntries.some(e => e.platform === p.value)
                          }>
                            {p.label}
                          </option>
                        ))}
                      </select>
                      
                      <div className="flex-1 grid grid-cols-3 gap-2">
                        <Input
                          type="number"
                          placeholder={t('app.dailySalesRecorder.grossSales')}
                          value={entry.gross_sales || ''}
                          onChange={(e) => updateDeliveryEntry(index, 'gross_sales', parseFloat(e.target.value) || 0)}
                          disabled={inputsDisabled}
                          min={0}
                          step="0.01"
                          className="text-sm"
                        />
                        <Input
                          type="number"
                          placeholder={t('app.dailySalesRecorder.commission')}
                          value={entry.platform_commission || ''}
                          onChange={(e) => updateDeliveryEntry(index, 'platform_commission', parseFloat(e.target.value) || 0)}
                          disabled={inputsDisabled}
                          min={0}
                          step="0.01"
                          className="text-sm"
                        />
                        <Input
                          type="number"
                          placeholder={t('app.dailySalesRecorder.orders')}
                          value={entry.order_count || ''}
                          onChange={(e) => updateDeliveryEntry(index, 'order_count', parseInt(e.target.value) || 0)}
                          disabled={inputsDisabled}
                          min={0}
                          className="text-sm"
                        />
                      </div>
                      
                      {!isLocked && (
                        <Button variant="ghost" size="icon" onClick={() => removeDeliveryEntry(index)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  ))}
                  
                  {/* Delivery Summary */}
                  <div className="flex items-center justify-between pt-3 border-t text-sm">
                    <span className="text-muted-foreground">{t('app.dailySalesRecorder.deliverySummary')}</span>
                    <div className="text-right">
                      <div>{t('app.dailySalesRecorder.gross', { value: formatCurrency(deliveryTotal) })}</div>
                      <div className="text-xs text-muted-foreground">
                        {t('app.dailySalesRecorder.commissionNet', { commission: formatCurrency(deliveryCommission), net: formatCurrency(deliveryTotal - deliveryCommission) })}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* POS Reconciliation */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <Calculator className="h-4 w-4" />
                {t('app.dailySalesRecorder.posReconciliation')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs">{t('app.dailySalesRecorder.posReportedTotal')}</Label>
                  <Input
                    type="number"
                    placeholder={t('app.dailySalesRecorder.posReportedPlaceholder')}
                    value={posTotal !== '' ? posTotal : (totalSales > 0 ? totalSales.toFixed(2) : '')}
                    onChange={(e) => {
                      setPosTotal(e.target.value);
                    }}
                    disabled={inputsDisabled}
                    min={0}
                    step="0.01"
                  />
                  {totalSales > 0 && !inputsDisabled && (
                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <p className="text-[11px] text-muted-foreground flex-1">
                        {posTotal === ''
                          ? `Auto-filled from payment-type total (${formatCurrency(totalSales)}).`
                          : 'Manual override active.'}
                      </p>
                      {posTotal === '' ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => setPosTotal(totalSales.toFixed(2))}
                        >
                          Keep my POS total
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => setPosTotal('')}
                        >
                          Use auto total
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                
                <div className="space-y-2">
                  <Label className="text-xs">{t('app.dailySalesRecorder.systemTotal')}</Label>
                  <div className="h-10 px-3 flex items-center border rounded-md bg-muted">
                    {formatCurrency(systemTotal || 0)}
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label className="text-xs flex items-center gap-2">
                    {t('app.dailySalesRecorder.variance')}
                    <VarianceIndicator status={varianceStatus} />
                  </Label>
                  <div className={cn(
                    "h-10 px-3 flex items-center border rounded-md font-medium",
                    variance > 0 ? "text-emerald-600 bg-emerald-50" :
                    variance < 0 ? "text-red-600 bg-red-50" :
                    "bg-muted"
                  )}>
                    {variance > 0 && <TrendingUp className="h-4 w-4 mr-1" />}
                    {variance < 0 && <TrendingDown className="h-4 w-4 mr-1" />}
                    {variance > 0 ? '+' : ''}{formatCurrency(variance)}
                  </div>
                  {netDayEndAdjustment !== 0 && (
                    <div className="text-[11px] text-muted-foreground leading-tight">
                      Day-end adj:{" "}
                      <span className={netDayEndAdjustment > 0 ? "text-emerald-700" : "text-red-700"}>
                        {netDayEndAdjustment > 0 ? "+" : "−"}
                        {formatCurrency(Math.abs(netDayEndAdjustment))}
                      </span>{" "}
                      (Cash Over/Short){" · "}
                      <button
                        type="button"
                        onClick={() => setAuditLogOpen(true)}
                        className="underline underline-offset-2"
                      >
                        details
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Auto Reconciliation: POS Reported − Payment-type Total */}
              {(() => {
                const autoReconciliation = posReportedTotal - totalSales;
                const abs = Math.abs(autoReconciliation);
                const sign = autoReconciliation > 0 ? '+' : autoReconciliation < 0 ? '−' : '';
                const reconStatus: VarianceStatus =
                  abs < 0.01 ? 'matched'
                  : abs <= minorThreshold ? 'minor'
                  : 'investigate';
                const tone =
                  reconStatus === 'matched' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : reconStatus === 'minor' ? 'bg-amber-50 text-amber-700 border-amber-200'
                  : 'bg-red-50 text-red-700 border-red-200';
                return (
                  <div className={cn(
                    "flex items-center justify-between rounded-md border px-3 py-2 text-sm",
                    tone
                  )}>
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">Auto Reconciliation</span>
                        <VarianceIndicator status={reconStatus} />
                      </div>
                       <span className="text-[11px] opacity-80">
                         POS Reported ({formatCurrency(posReportedTotal)}) − Payment-type Total ({formatCurrency(totalSales)})
                         {" · "}
                         Threshold: ±{formatCurrency(minorThreshold)}
                       </span>
                       {(activeAdjustments.length > 0 || reversedAdjustmentCount > 0) && (
                         <span className="text-[11px] opacity-80 mt-0.5">
                           Day-end adjustments:{" "}
                           {activeAdjustments.length} active
                           {reversedAdjustmentCount > 0 ? `, ${reversedAdjustmentCount} reversed` : ""}
                           {" · "}
                           Net{" "}
                           {netDayEndAdjustment >= 0 ? "+" : "−"}
                           {formatCurrency(Math.abs(netDayEndAdjustment))}
                           {" "}(Cash Over/Short){" · "}
                           <button
                             type="button"
                             onClick={() => setAuditLogOpen(true)}
                             className="underline underline-offset-2 hover:opacity-100"
                           >
                             details
                           </button>
                         </span>
                       )}
                    </div>
                    <div className="flex items-center gap-1 font-semibold">
                      {autoReconciliation > 0 && <TrendingUp className="h-4 w-4" />}
                      {autoReconciliation < 0 && <TrendingDown className="h-4 w-4" />}
                      <span>{sign}{formatCurrency(abs)}</span>
                    </div>
                  </div>
                );
              })()}

              {/* Step-by-step guidance: Adjustment vs Resolve Variance */}
              {hasVariance && !isLocked && (() => {
                const isOverage = variance > 0;
                const reasons: { value: string; label: string; action: 'adjustment' | 'resolve'; hint: string }[] = isOverage
                  ? [
                      { value: 'unrecorded_sales', label: 'Cashier missed POS entry (unrecorded sale)', action: 'adjustment', hint: 'Real cash collected but not rung. Post DR Cash / CR Sales (or Cash Over/Short).' },
                      { value: 'tip_in_drawer', label: 'Tips kept in drawer', action: 'adjustment', hint: 'Move from cash to tips liability via an adjustment entry.' },
                      { value: 'overring_correction', label: 'POS overring already corrected / timing only', action: 'resolve', hint: 'Books are already right - document the explanation and resolve to close.' },
                      { value: 'counting_error', label: 'Found extra cash / counting error', action: 'adjustment', hint: 'Post a Cash Over (DR Cash / CR Cash Over/Short) so books match the drawer.' },
                    ]
                  : [
                      { value: 'refund_not_entered', label: 'Refund / void not entered in POS', action: 'adjustment', hint: 'Post the refund as an adjustment so cash and revenue agree.' },
                      { value: 'cash_short', label: 'Cash short / till discrepancy', action: 'adjustment', hint: 'Post DR Cash Over/Short / CR Cash to recognize the loss.' },
                      { value: 'petty_cash_paid', label: 'Petty cash paid out (not logged)', action: 'adjustment', hint: 'Record the expense via adjustment so the drawer reconciles.' },
                      { value: 'double_ring', label: 'POS double-rang - will be voided', action: 'resolve', hint: 'No money movement needed - explain and resolve to close.' },
                    ];
                const selected = reasons.find(r => r.value === guidanceReason);
                const recommended: 'adjustment' | 'resolve' | null = selected?.action ?? null;
                return (
                  <div className="rounded-md border border-primary/20 bg-primary/5 p-3 space-y-3">
                    <div className="flex items-start gap-2">
                      <Lightbulb className="h-4 w-4 text-primary mt-0.5" />
                      <div className="flex-1 space-y-0.5">
                        <div className="text-sm font-medium">
                          Guidance: {isOverage ? 'Overage' : 'Shortage'} of {formatCurrency(Math.abs(variance))}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {isOverage
                            ? 'POS Reported is higher than what was rung up. Pick the most likely cause to see whether to post an Adjustment or just Resolve the variance.'
                            : 'POS Reported is lower than what was rung up. Pick the most likely cause to see whether to post an Adjustment or just Resolve the variance.'}
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-1.5">
                      {reasons.map(r => (
                        <label
                          key={r.value}
                          className={cn(
                            "flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs cursor-pointer transition-colors",
                            guidanceReason === r.value
                              ? "border-primary bg-background"
                              : "border-transparent bg-background/60 hover:bg-background"
                          )}
                        >
                          <input
                            type="radio"
                            name="variance-guidance-reason"
                            className="mt-0.5"
                            checked={guidanceReason === r.value}
                            onChange={() => setGuidanceReason(r.value)}
                          />
                          <div className="flex-1">
                            <div className="font-medium">{r.label}</div>
                            {guidanceReason === r.value && (
                              <div className="text-muted-foreground mt-0.5">{r.hint}</div>
                            )}
                          </div>
                          <Badge
                            variant="outline"
                            className={cn(
                              "shrink-0 text-[10px]",
                              r.action === 'adjustment'
                                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                                : "border-blue-300 bg-blue-50 text-blue-700"
                            )}
                          >
                            {r.action === 'adjustment' ? 'Adjustment' : 'Resolve Variance'}
                          </Badge>
                        </label>
                      ))}
                    </div>

                    {recommended && (
                      <div className="flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-2">
                        <div className="text-xs">
                          <span className="font-medium">Recommended next step: </span>
                          {recommended === 'adjustment'
                            ? `Post an Adjustment of ${variance > 0 ? '+' : ''}${formatCurrency(variance)} so the ledger reflects the real cash, then Close Day.`
                            : 'Use Resolve Variance to document the explanation, then Close Day. No ledger entry will be posted.'}
                        </div>
                        <Button
                          size="sm"
                          variant={recommended === 'adjustment' ? 'default' : 'outline'}
                          className="gap-1 shrink-0"
                          onClick={() => {
                            if (recommended === 'adjustment') {
                              void openAdjustment();
                            } else {
                              handleCloseDay();
                            }
                          }}
                        >
                          {recommended === 'adjustment' ? <Scale className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                          {recommended === 'adjustment' ? 'Open Adjustment' : 'Resolve Variance'}
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Variance Alert */}
              {varianceStatus === 'investigate' && !isLocked && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>{t('app.dailySalesRecorder.investigateAlertTitle')}</AlertTitle>
                  <AlertDescription>
                    {t('app.dailySalesRecorder.investigateAlertDesc', { value: formatCurrency(Math.abs(variance)) })}
                  </AlertDescription>
                </Alert>
              )}

              {(varianceStatus === 'investigate' || varianceNotes || activeAdjustments.length > 0) && (
                <div className="space-y-2">
                  <Label className="text-xs">
                    {t('app.dailySalesRecorder.varianceNotes')} {varianceStatus === 'investigate' && <span className="text-destructive">*</span>}
                  </Label>
                  {activeAdjustments.length > 0 && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 space-y-1">
                      <div className="font-medium">
                        Day-end Cash Over/Short - Net{" "}
                        {netDayEndAdjustment >= 0 ? "+" : "−"}
                        {formatCurrency(Math.abs(netDayEndAdjustment))}
                      </div>
                      <ul className="list-disc pl-4 space-y-0.5">
                        {activeAdjustments.map((a: any) => (
                          <li key={a.id}>
                            <span className={a.amount >= 0 ? "text-emerald-700" : "text-red-700"}>
                              {a.amount >= 0 ? "+" : "−"}
                              {formatCurrency(Math.abs(Number(a.amount) || 0))}
                            </span>
                            {a.reason ? <> · {String(a.reason).replace(/_/g, " ")}</> : null}
                            {a.notes ? <> - {a.notes}</> : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <Textarea
                    placeholder={t('app.dailySalesRecorder.varianceNotesPlaceholder')}
                    value={varianceNotes}
                    onChange={(e) => setVarianceNotes(e.target.value)}
                    disabled={inputsDisabled}
                    rows={3}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex justify-end gap-3">
            {!isLocked && (
              <>
                <Button
                  variant="outline"
                  onClick={handleSave}
                  disabled={isSaving || requiresBranchSelection}
                >
                  {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {t('app.dailySalesRecorder.saveDraft')}
                </Button>
                
                {dailySales?.id && (
                  <Button
                    onClick={handleCloseDay}
                    disabled={isSaving || isLocked || requiresBranchSelection}
                    className="gap-2"
                    variant={hasVariance && !varianceResolved ? "outline" : "default"}
                  >
                    {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                    {hasVariance && !varianceResolved ? (
                      <>
                        <AlertTriangle className="h-4 w-4" />
                        {t('app.dailySalesRecorder.resolveToClose')}
                      </>
                    ) : (
                      <>
                        <Lock className="h-4 w-4" />
                        {t('app.dailySalesRecorder.closeDay')}
                      </>
                    )}
                  </Button>
                )}
              </>
            )}
            
            {/* Post to Ledger button - shown when day is closed but not yet posted */}
            {isLocked && dailySales?.id && !dailySales.ledger_posted && (
              <Button
                onClick={handlePostToLedger}
                disabled={isPostingToLedger}
                className="gap-2"
                variant="default"
              >
                {isPostingToLedger && <Loader2 className="h-4 w-4 animate-spin" />}
                <BookOpen className="h-4 w-4" />
                {t('app.dailySalesRecorder.postToLedger')}
              </Button>
            )}

            {/* Day-End Adjustment trigger */}
            {dailySales?.id && (
              <Button
                variant="outline"
                onClick={() => void openAdjustment()}
                className="gap-2"
              >
                <Scale className="h-4 w-4" />
                {t('app.dailySalesRecorder.adjustment')}
              </Button>
            )}
            
            {/* Ledger posted badge */}
            {isLocked && dailySales?.ledger_posted && (
              <Badge variant="outline" className="gap-1 bg-emerald-50 text-emerald-700 border-emerald-200">
                <CheckCircle2 className="h-3 w-3" />
                {t('app.dailySalesRecorder.postedToLedger')}
              </Badge>
            )}
          </div>

          <DayEndAdjustmentDialog
            open={adjustmentOpen}
            onOpenChange={setAdjustmentOpen}
            scope="daily_sales"
            scopeRefId={dailySales?.id ?? null}
            businessDate={dateStr}
            defaultAmount={variance || undefined}
            title="Daily Sales - Day-End Adjustment"
            onPostedAndCloseDay={dailySales?.id ? handlePostedAndCloseDay : undefined}
            recordedTotal={totalSales}
            posReportedTotal={posReportedTotal}
            netDayEndAdjustment={netDayEndAdjustment}
          />
          {restaurant?.id && (
            <POSDetailsDialog
              open={posDetailsOpen}
              onOpenChange={setPosDetailsOpen}
              restaurantId={restaurant.id}
              date={dateStr}
            />
          )}
          <DayEndAuditLogDialog
            open={auditLogOpen}
            onOpenChange={setAuditLogOpen}
            date={dateStr}
            timezone={systemBreakdown?.timezone || restaurant?.timezone || 'Asia/Riyadh'}
            startISO={systemBreakdown?.startISO || ''}
            endExclusiveISO={systemBreakdown?.endExclusiveISO || ''}
            transactions={systemBreakdown?.transactions || []}
            totals={{
              cash: systemBreakdown?.cash || 0,
              card: systemBreakdown?.card || 0,
              delivery: systemBreakdown?.delivery || 0,
              other: systemBreakdown?.other || 0,
            }}
            reportedTotals={{
              cash: parseFloat(cashSales) || 0,
              card: parseFloat(cardSales) || 0,
              delivery: parseFloat(deliverySales) || 0,
              other: parseFloat(otherSales) || 0,
            }}
          />
          <ResolveVarianceWizard
            open={checklistOpen}
            onOpenChange={setChecklistOpen}
            variance={variance}
            formatCurrency={formatCurrency}
            businessDate={dateStr}
            dailySalesId={dailySales?.id ?? null}
            initialNotes={varianceNotes}
            isSubmitting={isSaving}
            onConfirm={handleChecklistConfirm}
            requireAdjustment={requireAdjustmentForClose}
          />
          {restaurant?.id && (
            <PaymentMappingDialog
              open={mappingOpen}
              onOpenChange={setMappingOpen}
              restaurantId={restaurant.id}
              date={dateStr}
              onSaved={() => {
                queryClient.invalidateQueries({ queryKey: ['system-sales-breakdown', restaurant.id] });
                queryClient.invalidateQueries({ queryKey: ['pos-details', restaurant.id] });
              }}
            />
          )}

          {/* Reverse Adjustment Dialog */}
          <Dialog
            open={!!reverseTarget}
            onOpenChange={(o) => {
              if (!o) {
                setReverseTarget(null);
                setReversalReason("");
              }
            }}
          >
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <RotateCcw className="h-4 w-4 text-primary" />
                  Reverse Day-End Adjustment
                </DialogTitle>
                <DialogDescription>
                  This creates a balanced opposite journal entry. The original adjustment is
                  preserved with a permanent audit record of who reversed it and when.
                </DialogDescription>
              </DialogHeader>
              {reverseTarget && (
                <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1">
                  <div>
                    <span className="text-muted-foreground">Amount:</span>{" "}
                    <span className="font-medium">
                      {reverseTarget.amount > 0 ? "+" : ""}
                      {formatCurrency(reverseTarget.amount)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Date:</span>{" "}
                    {format(selectedDate, "PP")}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Reason:</span>{" "}
                    {(reverseTarget.reason || "").replace(/_/g, " ")}
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <label className="text-xs font-medium">
                  Reversal reason <span className="text-destructive">*</span>{" "}
                  <span className="text-muted-foreground font-normal">(min 10 chars)</span>
                </label>
                <Textarea
                  rows={3}
                  maxLength={500}
                  placeholder="Why is this entry being reversed? (e.g. duplicate of JE-2025-019, wrong amount)"
                  value={reversalReason}
                  onChange={(e) => setReversalReason(e.target.value.slice(0, 500))}
                />
                <p className="text-[11px] text-muted-foreground text-right">
                  {reversalReason.trim().length}/500
                </p>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setReverseTarget(null)}
                  disabled={reverseMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={
                    reversalReason.trim().length < 10 || reverseMutation.isPending
                  }
                  onClick={() =>
                    reverseTarget &&
                    reverseMutation.mutate({
                      id: reverseTarget.id,
                      reason: reversalReason.trim(),
                    })
                  }
                >
                  {reverseMutation.isPending && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  Confirm Reversal
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
