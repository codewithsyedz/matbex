import { Fragment, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OpenShiftModal } from "@/components/shifts/OpenShiftModal";
import { CloseShiftModal } from "@/components/shifts/CloseShiftModal";
import { CashDropSheet } from "@/components/shifts/CashDropSheet";
import { AutoShiftSettings } from "@/components/shifts/AutoShiftSettings";
import { BranchCashClosureSummary } from "@/components/shifts/BranchCashClosureSummary";
import { DailyClosingReportExport } from "@/components/dayend/DailyClosingReportExport";
import { BranchReconciliationView } from "@/components/shifts/BranchReconciliationView";
import { useShiftsData, Shift } from "@/hooks/useShiftsData";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/integrations/db/client";
import { LockedFeatureScreen } from "@/components/LockedFeatureScreen";
import {
  Plus,
  Timer,
  CheckCircle2,
  Clock,
  Banknote,
  MoreHorizontal,
  Loader2,
  Trash2,
  Pencil,
  AlertCircle,
  ArrowUpDown,
  Package,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { ShiftSummary } from "@/components/shifts/ShiftSummary";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  BranchDateRangeFilter,
  resolvePreset,
  type DateRangePreset,
} from "@/components/filters/BranchDateRangeFilter";
import { useBranch } from "@/contexts/BranchContext";
import { usePersistedBranchDateFilter } from "@/hooks/usePersistedBranchDateFilter";
import type { DateRange } from "react-day-picker";

const statusConfig = {
  open: {
    label: "Active",
    className: "bg-success/10 text-success border-success/20",
    icon: Timer,
  },
  closing: {
    label: "Closing",
    className: "bg-warning/10 text-warning border-warning/20",
    icon: Clock,
  },
  closed: {
    label: "Closed",
    className: "bg-muted text-muted-foreground border-muted",
    icon: CheckCircle2,
  },
};

export default function Shifts() {
  const { restaurant, hasRole, hasFeature, tenant } = useAuth();
  const { t } = useTranslation();
  const isOwner = hasRole("owner");
  const { toast } = useToast();
  const { shifts, drawers, templates, staffMembers, isLoading, refetch, getOpenShiftForDrawer } = useShiftsData();
  const { activeBranchId, setActiveBranchId, hasMultipleBranches, canSwitchBranches, pinnedBranchId } = useBranch();

  // Persisted page-local filter state.
  const {
    branchId: filterBranchId,
    setBranchId: setFilterBranchId,
    preset: datePreset,
    setPreset: setDatePreset,
    customRange,
    setCustomRange,
  } = usePersistedBranchDateFilter("shifts", tenant?.id, {
    branchId: pinnedBranchId ?? activeBranchId ?? "all",
    preset: "30d",
  });

  const effectiveRange = datePreset === "custom" ? customRange : resolvePreset(datePreset);

  // When the user changes the page filter we also push to the global context
  // so useShiftsData refetches with the right branch scope.
  const handleBranchChange = (next: string | "all") => {
    setFilterBranchId(next);
    if (!canSwitchBranches) return; // pinned - no-op
    setActiveBranchId(next);
  };

  const [openShiftModalOpen, setOpenShiftModalOpen] = useState(false);
  const [closeShiftModalOpen, setCloseShiftModalOpen] = useState(false);
  const [cashDropOpen, setCashDropOpen] = useState(false);
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("all");
  const [stockReasonSort, setStockReasonSort] = useState<'none' | 'desc' | 'asc'>('none');
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [editOpeningFloat, setEditOpeningFloat] = useState("");
  const [editCashierStaffId, setEditCashierStaffId] = useState<string>("");
  const [editDrawerId, setEditDrawerId] = useState<string>("");
  const [editOpenedAt, setEditOpenedAt] = useState("");
  const [editClosedAt, setEditClosedAt] = useState("");
  const [editCountedCash, setEditCountedCash] = useState("");
  const [editExpectedCash, setEditExpectedCash] = useState("");
  const [editExpectedCard, setEditExpectedCard] = useState("");
  const [editCountedCard, setEditCountedCard] = useState("");
  const [editDepositAmount, setEditDepositAmount] = useState("");
  const [timestampOverrideEnabled, setTimestampOverrideEnabled] = useState(false);
  const [confirmOverrideOpen, setConfirmOverrideOpen] = useState(false);
  const [expandedShiftIds, setExpandedShiftIds] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpandedShiftIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openShifts = shifts.filter((s) => s.status === "open");
  const closedShifts = shifts.filter((s) => s.status === "closed");

  const baseShifts =
    activeTab === "open" ? openShifts : activeTab === "closed" ? closedShifts : shifts;

  // Apply the page-level branch + date-range filter on top of the tab.
  const scopedShifts = useMemo(() => {
    const fromMs = effectiveRange?.from ? effectiveRange.from.getTime() : null;
    const toMs = effectiveRange?.to ? effectiveRange.to.getTime() : null;
    return baseShifts.filter((s) => {
      if (
        filterBranchId &&
        filterBranchId !== "all" &&
        (s as any).branch_id &&
        (s as any).branch_id !== filterBranchId
      ) {
        return false;
      }
      if (fromMs !== null || toMs !== null) {
        const opened = new Date(s.opened_at).getTime();
        if (fromMs !== null && opened < fromMs) return false;
        if (toMs !== null && opened > toMs) return false;
      }
      return true;
    });
  }, [baseShifts, filterBranchId, effectiveRange]);

  // Sortable "Stock Reason" column: shifts with a higher variance % bubble up.
  // Shifts with no recorded stock variance always sink to the bottom.
  const filteredShifts = (() => {
    if (stockReasonSort === 'none') return scopedShifts;
    const dir = stockReasonSort === 'desc' ? -1 : 1;
    return [...scopedShifts].sort((a, b) => {
      const av = (a as any).stock_variance_pct;
      const bv = (b as any).stock_variance_pct;
      const aHas = typeof av === 'number';
      const bHas = typeof bv === 'number';
      if (!aHas && !bHas) return 0;
      if (!aHas) return 1;
      if (!bHas) return -1;
      return (av - bv) * dir;
    });
  })();

  const handleCloseShift = (shiftId: string) => {
    setSelectedShiftId(shiftId);
    setCloseShiftModalOpen(true);
  };

  const handleCashDrop = (shiftId: string) => {
    setSelectedShiftId(shiftId);
    setCashDropOpen(true);
  };

  const handleDeleteShift = async (shiftId: string) => {
    try {
      // Delete related cash events first
      await db.from("cash_events").delete().eq("shift_id", shiftId);
      
      // Delete the shift
      const { error } = await db.from("shifts").delete().eq("id", shiftId);
      if (error) throw error;
      
      toast({ title: "Shift deleted successfully" });
      refetch();
    } catch (error: any) {
      console.error("Error deleting shift:", error);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const openEditShiftDialog = (shift: Shift) => {
    setEditingShift(shift);
    setEditNotes(shift.notes || "");
    setEditOpeningFloat(shift.opening_float.toString());
    setEditCashierStaffId(shift.cashier_staff_id || "");
    setEditDrawerId(shift.drawer_id || "");
    // Format datetime for input fields - use local timezone
    const formatForInput = (dateStr: string | null) => {
      if (!dateStr) return "";
      const date = new Date(dateStr);
      // Format as YYYY-MM-DDTHH:mm in local timezone (not UTC)
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      const hours = String(date.getHours()).padStart(2, "0");
      const minutes = String(date.getMinutes()).padStart(2, "0");
      return `${year}-${month}-${day}T${hours}:${minutes}`;
    };
    setEditOpenedAt(formatForInput(shift.opened_at));
    setEditClosedAt(formatForInput(shift.closed_at));
    setEditCountedCash(shift.counted_cash?.toString() || "");
    setEditExpectedCash(shift.expected_cash?.toString() || "");
    setEditExpectedCard((shift as any).expected_card?.toString() || "");
    setEditCountedCard((shift as any).counted_card?.toString() || "");
    setEditDepositAmount(shift.deposit_amount?.toString() || "");
    setTimestampOverrideEnabled(false); // Reset override mode
    setEditDialogOpen(true);
  };

  // Check if timestamps were modified
  const timestampsModified = () => {
    if (!editingShift || !timestampOverrideEnabled) return false;
    const formatForInput = (dateStr: string | null) => {
      if (!dateStr) return "";
      const date = new Date(dateStr);
      return date.toISOString().slice(0, 16);
    };
    const originalOpenedAt = formatForInput(editingShift.opened_at);
    const originalClosedAt = formatForInput(editingShift.closed_at);
    return editOpenedAt !== originalOpenedAt || editClosedAt !== originalClosedAt;
  };

  // Validate timestamps - opened_at must be before closed_at
  const validateTimestamps = (): string | null => {
    if (!timestampOverrideEnabled) return null;
    if (editOpenedAt && editClosedAt) {
      const openedDate = new Date(editOpenedAt);
      const closedDate = new Date(editClosedAt);
      if (openedDate >= closedDate) {
        return "Opened At must be before Closed At";
      }
    }
    return null;
  };

  const handleUpdateClick = () => {
    const validationError = validateTimestamps();
    if (validationError) {
      toast({ title: "Validation Error", description: validationError, variant: "destructive" });
      return;
    }
    if (timestampsModified()) {
      setConfirmOverrideOpen(true);
    } else {
      handleUpdateShift();
    }
  };

  const handleUpdateShift = async () => {
    if (!editingShift) return;
    
    try {
      const countedCash = editCountedCash ? parseFloat(editCountedCash) : null;
      const expectedCash = editExpectedCash ? parseFloat(editExpectedCash) : null;
      const countedCard = editCountedCard ? parseFloat(editCountedCard) : null;
      const expectedCard = editExpectedCard ? parseFloat(editExpectedCard) : null;
      const cashVariance = countedCash !== null && expectedCash !== null 
        ? countedCash - expectedCash 
        : null;

      const updateData: any = {
        notes: editNotes || null,
        opening_float: parseFloat(editOpeningFloat) || 0,
        cashier_staff_id: editCashierStaffId || null,
        drawer_id: editDrawerId || editingShift.drawer_id,
        counted_cash: countedCash,
        expected_cash: expectedCash,
        counted_card: countedCard,
        expected_card: expectedCard,
        deposit_amount: editDepositAmount ? parseFloat(editDepositAmount) : null,
        variance: cashVariance,
      };

      // Owner timestamp override - only include if override is enabled
      let timestampChanges: { old_opened_at?: string | null; new_opened_at?: string; old_closed_at?: string | null; new_closed_at?: string | null } | null = null;
      
      if (isOwner && timestampOverrideEnabled) {
        timestampChanges = {};
        
        if (editOpenedAt) {
          timestampChanges.old_opened_at = editingShift.opened_at;
          timestampChanges.new_opened_at = new Date(editOpenedAt).toISOString();
          updateData.opened_at = timestampChanges.new_opened_at;
        }
        if (editClosedAt) {
          timestampChanges.old_closed_at = editingShift.closed_at;
          timestampChanges.new_closed_at = new Date(editClosedAt).toISOString();
          updateData.closed_at = timestampChanges.new_closed_at;
          if (editingShift.status === "open") {
            updateData.status = "closed";
          }
        } else if (editingShift.status === "closed" && !editClosedAt) {
          timestampChanges.old_closed_at = editingShift.closed_at;
          timestampChanges.new_closed_at = null;
          updateData.closed_at = null;
          updateData.status = "open";
        }
      }

      const { error } = await db
        .from("shifts")
        .update(updateData)
        .eq("id", editingShift.id);
      
      if (error) throw error;

      // Log timestamp override to audit log
      if (timestampChanges && Object.keys(timestampChanges).length > 0) {
        await db.rpc('log_audit', {
          _action: 'SHIFT_TIMESTAMP_OVERRIDE',
          _entity_type: 'shift',
          _entity_id: editingShift.id,
          _old_data: {
            opened_at: timestampChanges.old_opened_at,
            closed_at: timestampChanges.old_closed_at,
          },
          _new_data: {
            opened_at: timestampChanges.new_opened_at || timestampChanges.old_opened_at,
            closed_at: timestampChanges.new_closed_at,
          },
          _tenant_id: restaurant?.tenant_id || null,
        });
      }
      
      toast({ title: "Shift updated successfully" });
      setEditDialogOpen(false);
      setEditingShift(null);
      refetch();
    } catch (error: any) {
      console.error("Error updating shift:", error);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const formatCurrency = (amount: number | null) => {
    if (amount === null) return "-";
    return `${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${restaurant?.currency || "SAR"}`;
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  const formatDuration = (openedAt: string, closedAt: string | null): string => {
    if (!closedAt) return "-";
    const opened = new Date(openedAt);
    const closed = new Date(closedAt);
    if (isNaN(opened.getTime()) || isNaN(closed.getTime())) return "-";
    
    const diffMs = closed.getTime() - opened.getTime();
    if (diffMs < 0) return "-";
    
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours === 0) return `${minutes}m`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
  };

  if (!hasFeature("shifts")) {
    return (
      <>
        <LockedFeatureScreen
          featureName="Shifts"
          description="The Shifts & Cash Drawer module has been disabled by your administrator."
          featureKey="shifts"
        />
      </>
    );
  }

  return (
    <>
      <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 fade-slide-in mb-6 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">
              {t("app.shifts.title")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t("app.shifts.subtitle")}
            </p>
          </div>
          <Button size="sm" onClick={() => setOpenShiftModalOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">{t("app.shifts.openShift")}</span>
          </Button>
        </header>

        {/* Branch + date range filter */}
        <div className="mb-4 fade-slide-in" style={{ animationDelay: "25ms" }}>
          <BranchDateRangeFilter
            branchId={filterBranchId}
            onBranchChange={handleBranchChange}
            preset={datePreset}
            onPresetChange={setDatePreset}
            dateRange={customRange}
            onDateRangeChange={setCustomRange}
          />
        </div>

        {/* Stats Summary */}
        <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4 fade-slide-in" style={{ animationDelay: "50ms" }}>
          <div className="p-4 rounded-lg border bg-card">
            <p className="text-sm text-muted-foreground">{t("app.shifts.stats.active")}</p>
            <p className="text-2xl font-semibold mt-1">{openShifts.length}</p>
          </div>
          <div className="p-4 rounded-lg border bg-card">
            <p className="text-sm text-muted-foreground">{t("app.shifts.stats.closedToday")}</p>
            <p className="text-2xl font-semibold mt-1">
              {closedShifts.filter((s) => {
                const today = new Date();
                const closedAt = s.closed_at ? new Date(s.closed_at) : null;
                return closedAt && closedAt.toDateString() === today.toDateString();
              }).length}
            </p>
          </div>
          <div className="p-4 rounded-lg border bg-card">
            <p className="text-sm text-muted-foreground">{t("app.shifts.stats.drawers")}</p>
            <p className="text-2xl font-semibold mt-1">{drawers.length}</p>
          </div>
          <div className="p-4 rounded-lg border bg-card">
            <p className="text-sm text-muted-foreground">{t("app.shifts.stats.templates")}</p>
            <p className="text-2xl font-semibold mt-1">{templates.length}</p>
          </div>
        </div>

        {/* Auto-Close Settings - Only for owners */}
        {isOwner && (
          <div className="mt-6 fade-slide-in" style={{ animationDelay: "75ms" }}>
            <AutoShiftSettings />
          </div>
        )}

        {/* Shifts Table */}
        <div className="mt-6 fade-slide-in" style={{ animationDelay: "100ms" }}>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="all">{t("app.shifts.tabs.all")}</TabsTrigger>
              <TabsTrigger value="open">
                {t("app.shifts.tabs.active", { count: openShifts.length })}
              </TabsTrigger>
              <TabsTrigger value="closed">{t("app.shifts.tabs.closed")}</TabsTrigger>
              <TabsTrigger value="branch-closure">Branch closure</TabsTrigger>
            </TabsList>

            {activeTab !== "branch-closure" && (
            <TabsContent value={activeTab} className="mt-4">
              <div className="rounded-lg border bg-card">
                {isLoading ? (
                  <div className="flex items-center justify-center h-48">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredShifts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 text-center">
                    <Timer className="h-10 w-10 text-muted-foreground mb-3" />
                    <p className="text-muted-foreground">No shifts found</p>
                    <Button
                      variant="link"
                      size="sm"
                      onClick={() => setOpenShiftModalOpen(true)}
                    >
                      Open a new shift
                    </Button>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Status</TableHead>
                        <TableHead>Cashier</TableHead>
                        <TableHead>Drawer</TableHead>
                        <TableHead>Opened</TableHead>
                        <TableHead>Closed</TableHead>
                        <TableHead>Duration</TableHead>
                        <TableHead className="text-right">Expected</TableHead>
                        <TableHead className="text-right">Counted</TableHead>
                        <TableHead className="text-right">Variance</TableHead>
                        <TableHead>
                          <button
                            type="button"
                            onClick={() =>
                              setStockReasonSort((s) =>
                                s === 'none' ? 'desc' : s === 'desc' ? 'asc' : 'none'
                              )
                            }
                            className="inline-flex items-center gap-1 text-xs font-medium hover:text-foreground transition-colors"
                            title="Sort by stock variance %"
                          >
                            Stock Reason
                            <ArrowUpDown
                              className={`h-3 w-3 ${
                                stockReasonSort === 'none' ? 'text-muted-foreground/60' : 'text-foreground'
                              }`}
                            />
                          </button>
                        </TableHead>
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredShifts.map((shift) => {
                        const config = statusConfig[shift.status];
                        const StatusIcon = config.icon;
                        const isExpanded = expandedShiftIds.has(shift.id);

                        return (
                          <Fragment key={shift.id}>
                          <TableRow>
                            <TableCell>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => toggleExpanded(shift.id)}
                                  className="text-muted-foreground hover:text-foreground transition-colors"
                                  title={isExpanded ? "Hide shift summary" : "Show shift summary"}
                                  aria-expanded={isExpanded}
                                >
                                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                </button>
                                <Badge variant="outline" className={config.className}>
                                  <StatusIcon className="h-3 w-3 mr-1" />
                                  {config.label}
                                </Badge>
                              </div>
                            </TableCell>
                            <TableCell className="font-medium">
                              {shift.cashier_name}
                            </TableCell>
                            <TableCell>{shift.drawer_name}</TableCell>
                            <TableCell>
                              <div className="text-sm">
                                <p>{formatTime(shift.opened_at)}</p>
                                <p className="text-muted-foreground text-xs">
                                  {formatDate(shift.opened_at)}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell>
                              {shift.closed_at ? (
                                <div className="text-sm">
                                  <p>{formatTime(shift.closed_at)}</p>
                                  <p className="text-muted-foreground text-xs">
                                    {formatDate(shift.closed_at)}
                                  </p>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <span className="text-sm tabular-nums">
                                {formatDuration(shift.opened_at, shift.closed_at)}
                              </span>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency((shift.expected_cash || shift.opening_float) + ((shift as any).expected_card || 0))}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(shift.status === "closed" && shift.deposit_amount ? shift.deposit_amount : shift.counted_cash)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {shift.variance !== null ? (
                                <span
                                  className={
                                    shift.variance === 0
                                      ? "text-success"
                                      : Math.abs(shift.variance) <= 20
                                      ? "text-warning"
                                      : "text-destructive"
                                  }
                                >
                                  {shift.variance >= 0 ? "+" : ""}
                                  {formatCurrency(shift.variance)}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {(() => {
                                const pct = (shift as any).stock_variance_pct as number | null | undefined;
                                const reason = (shift as any).stock_variance_explanation as string | null | undefined;
                                if (typeof pct !== 'number') {
                                  return <span className="text-muted-foreground text-xs">-</span>;
                                }
                                const high = pct >= 15;
                                return (
                                  <TooltipProvider delayDuration={150}>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span
                                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border cursor-help ${
                                            high
                                              ? 'bg-destructive/10 text-destructive border-destructive/30'
                                              : 'bg-muted text-muted-foreground border-border'
                                          }`}
                                        >
                                          <Package className="h-3 w-3" />
                                          {pct.toFixed(1)}%
                                          {high && reason && <AlertCircle className="h-3 w-3" />}
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent side="left" className="max-w-xs">
                                        <div className="text-xs">
                                          <div className="font-medium mb-1">
                                            Stock spend variance: {pct.toFixed(1)}%
                                          </div>
                                          {reason ? (
                                            <p className="text-muted-foreground whitespace-pre-wrap">
                                              {reason}
                                            </p>
                                          ) : (
                                            <p className="text-muted-foreground italic">
                                              {high ? 'No reason recorded' : 'Below 15% threshold - reason optional'}
                                            </p>
                                          )}
                                        </div>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                );
                              })()}
                            </TableCell>
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {shift.status === "open" && (
                                    <>
                                      <DropdownMenuItem onClick={() => handleCashDrop(shift.id)}>
                                        <Banknote className="h-4 w-4 mr-2" />
                                        Record Cash Drop
                                      </DropdownMenuItem>
                                      <DropdownMenuItem onClick={() => handleCloseShift(shift.id)}>
                                        <CheckCircle2 className="h-4 w-4 mr-2" />
                                        Close Shift
                                      </DropdownMenuItem>
                                    </>
                                  )}
                                  {isOwner && (
                                    <>
                                      {shift.status === "open" && <DropdownMenuSeparator />}
                                      <DropdownMenuItem onClick={() => openEditShiftDialog(shift)}>
                                        <Pencil className="h-4 w-4 mr-2" />
                                        Edit Shift
                                      </DropdownMenuItem>
                                      <DropdownMenuItem 
                                        className="text-destructive focus:text-destructive"
                                        onClick={() => handleDeleteShift(shift.id)}
                                      >
                                        <Trash2 className="h-4 w-4 mr-2" />
                                        Delete Shift
                                      </DropdownMenuItem>
                                    </>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                          {isExpanded && (
                            <TableRow className="bg-muted/20 hover:bg-muted/20">
                              <TableCell colSpan={11} className="py-3">
                                <ShiftSummary
                                  shift={{
                                    id: shift.id,
                                    opened_at: shift.opened_at,
                                    closed_at: shift.closed_at,
                                    template_id: shift.template_id,
                                  }}
                                />
                              </TableCell>
                            </TableRow>
                          )}
                          </Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>
            </TabsContent>
            )}
            <TabsContent value="branch-closure" className="mt-4">
              <div className="space-y-6">
                <BranchCashClosureSummary />
                <DailyClosingReportExport />
                <BranchReconciliationView />
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Modals */}
      <OpenShiftModal
        open={openShiftModalOpen}
        onOpenChange={setOpenShiftModalOpen}
        onShiftOpened={refetch}
      />

      {selectedShiftId && (
        <>
          <CloseShiftModal
            open={closeShiftModalOpen}
            onOpenChange={setCloseShiftModalOpen}
            shift={shifts.find(s => s.id === selectedShiftId) ? {
              id: selectedShiftId,
              drawer_id: shifts.find(s => s.id === selectedShiftId)?.drawer_id || "",
              opening_float: shifts.find(s => s.id === selectedShiftId)?.opening_float || 0,
              opened_at: shifts.find(s => s.id === selectedShiftId)?.opened_at || "",
              drawers: { name: shifts.find(s => s.id === selectedShiftId)?.drawer_name || "drawer" },
            } : null}
            onShiftClosed={refetch}
          />
          <CashDropSheet
            open={cashDropOpen}
            onOpenChange={setCashDropOpen}
            shiftId={selectedShiftId}
            onSuccess={refetch}
          />
        </>
      )}

      {/* Edit Shift Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={(open) => {
        setEditDialogOpen(open);
        if (!open) setEditingShift(null);
      }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Shift</DialogTitle>
            <DialogDescription>
              Update shift details including times and cash amounts
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Shift Type / Drawer</Label>
                <Select value={editDrawerId} onValueChange={setEditDrawerId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select drawer" />
                  </SelectTrigger>
                  <SelectContent>
                    {drawers.map((drawer) => (
                      <SelectItem key={drawer.id} value={drawer.id}>
                        {drawer.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Cashier (Staff Member)</Label>
                <Select value={editCashierStaffId} onValueChange={setEditCashierStaffId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a staff member" />
                  </SelectTrigger>
                  <SelectContent>
                    {staffMembers.map((staff) => (
                      <SelectItem key={staff.id} value={staff.id}>
                        {staff.name} ({staff.role})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Timestamp Section */}
            <div className="space-y-3">
              {isOwner && (
                <div className="flex items-center justify-between p-3 rounded-lg border border-warning/30 bg-warning/5">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-warning" />
                    <span className="text-sm font-medium">Override Timestamps</span>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={timestampOverrideEnabled}
                      onChange={(e) => setTimestampOverrideEnabled(e.target.checked)}
                      className="rounded border-input"
                    />
                    <span className="text-xs text-muted-foreground">Enable editing</span>
                  </label>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Opened At</Label>
                  {isOwner && timestampOverrideEnabled ? (
                    <Input
                      type="datetime-local"
                      value={editOpenedAt}
                      onChange={(e) => setEditOpenedAt(e.target.value)}
                    />
                  ) : (
                    <div className="p-2 rounded-md bg-muted text-sm text-muted-foreground">
                      {editingShift?.opened_at 
                        ? new Date(editingShift.opened_at).toLocaleString() 
                        : "-"}
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Closed At</Label>
                  {isOwner && timestampOverrideEnabled ? (
                    <>
                      <Input
                        type="datetime-local"
                        value={editClosedAt}
                        onChange={(e) => setEditClosedAt(e.target.value)}
                      />
                      {!editClosedAt && editingShift?.status === "closed" && (
                        <p className="text-xs text-warning">Clearing this will reopen the shift</p>
                      )}
                    </>
                  ) : (
                    <div className="p-2 rounded-md bg-muted text-sm text-muted-foreground">
                      {editingShift?.closed_at 
                        ? new Date(editingShift.closed_at).toLocaleString() 
                        : "-"}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Opening Float ({restaurant?.currency || "SAR"})</Label>
              <Input
                type="number"
                value={editOpeningFloat}
                onChange={(e) => setEditOpeningFloat(e.target.value)}
                min="0"
                step="0.01"
              />
            </div>

            {/* Cash Section */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-muted-foreground">Cash</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Expected Cash ({restaurant?.currency || "SAR"})</Label>
                  <Input
                    type="number"
                    value={editExpectedCash}
                    onChange={(e) => setEditExpectedCash(e.target.value)}
                    min="0"
                    step="0.01"
                    placeholder="Auto-calculated or manual"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Counted Cash ({restaurant?.currency || "SAR"})</Label>
                  <Input
                    type="number"
                    value={editCountedCash}
                    onChange={(e) => setEditCountedCash(e.target.value)}
                    min="0"
                    step="0.01"
                  />
                </div>
              </div>

              {editCountedCash && editExpectedCash && (
                <div className="p-3 rounded-lg bg-muted/50 border">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Cash Variance</span>
                    <span className={`font-medium ${
                      parseFloat(editCountedCash) - parseFloat(editExpectedCash) === 0
                        ? "text-success"
                        : Math.abs(parseFloat(editCountedCash) - parseFloat(editExpectedCash)) <= 20
                        ? "text-warning"
                        : "text-destructive"
                    }`}>
                      {(parseFloat(editCountedCash) - parseFloat(editExpectedCash)) >= 0 ? "+" : ""}
                      {(parseFloat(editCountedCash) - parseFloat(editExpectedCash)).toFixed(2)} {restaurant?.currency || "SAR"}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Card Section */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-muted-foreground">Card</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Expected Card ({restaurant?.currency || "SAR"})</Label>
                  <Input
                    type="number"
                    value={editExpectedCard}
                    onChange={(e) => setEditExpectedCard(e.target.value)}
                    min="0"
                    step="0.01"
                    placeholder="Auto-calculated or manual"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Counted Card ({restaurant?.currency || "SAR"})</Label>
                  <Input
                    type="number"
                    value={editCountedCard}
                    onChange={(e) => setEditCountedCard(e.target.value)}
                    min="0"
                    step="0.01"
                  />
                </div>
              </div>

              {editCountedCard && editExpectedCard && (
                <div className="p-3 rounded-lg bg-muted/50 border">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Card Variance</span>
                    <span className={`font-medium ${
                      parseFloat(editCountedCard) - parseFloat(editExpectedCard) === 0
                        ? "text-success"
                        : Math.abs(parseFloat(editCountedCard) - parseFloat(editExpectedCard)) <= 20
                        ? "text-warning"
                        : "text-destructive"
                    }`}>
                      {(parseFloat(editCountedCard) - parseFloat(editExpectedCard)) >= 0 ? "+" : ""}
                      {(parseFloat(editCountedCard) - parseFloat(editExpectedCard)).toFixed(2)} {restaurant?.currency || "SAR"}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Deposit Amount ({restaurant?.currency || "SAR"})</Label>
              <Input
                type="number"
                value={editDepositAmount}
                onChange={(e) => setEditDepositAmount(e.target.value)}
                min="0"
                step="0.01"
                placeholder="Amount deposited"
              />
            </div>

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                placeholder="Add notes..."
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                rows={3}
              />
            </div>

            <Button className="w-full" onClick={handleUpdateClick}>
              Update Shift
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Timestamp Override Confirmation Dialog */}
      <AlertDialog open={confirmOverrideOpen} onOpenChange={setConfirmOverrideOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Timestamp Override</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to manually override the shift timestamps. This action will be logged for audit purposes.
              {editOpenedAt && (
                <span className="block mt-2">
                  <strong>New Opened At:</strong> {new Date(editOpenedAt).toLocaleString()}
                </span>
              )}
              {editClosedAt && (
                <span className="block">
                  <strong>New Closed At:</strong> {new Date(editClosedAt).toLocaleString()}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              setConfirmOverrideOpen(false);
              handleUpdateShift();
            }}>
              Confirm Override
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
