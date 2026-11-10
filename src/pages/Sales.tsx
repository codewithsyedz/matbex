import { useState, useMemo, useEffect, useRef } from "react";
import { CardTooltip } from "@/components/ui/CardTooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Info, Image as ImageIcon } from "lucide-react";
import { toast as sonnerToast } from "sonner";

import { Plus, Receipt, CreditCard, Banknote, MoreHorizontal, CalendarPlus, Trash2, Pencil, ShoppingCart, TrendingUp, TrendingDown, Clock, ArrowRightLeft, FileDown, BarChart3, Eye, Store, FileText, Settings2, Scale, ArrowUp, Wallet, ChevronDown } from "lucide-react";
import { BranchBadge } from "@/components/branch/BranchBadge";
import { exportToCSV, prepareSalesExportData } from "@/lib/exportUtils";
import { exportSalesPdf, DEFAULT_PDF_OPTIONS, type SalesPdfOptions, type BreakdownDetail } from "@/lib/salesPdfExport";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SalesRecorder } from "@/components/pos/SalesRecorder";
import { SalesBreakdown } from "@/components/sales/SalesBreakdown";
import { DailySalesRecorder } from "@/components/sales/DailySalesRecorder";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CumulativeExpenseChart } from "@/components/expenses/CumulativeExpenseChart";
import { DailyExpenseBarChart } from "@/components/expenses/DailyExpenseBarChart";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { VirtualizedList } from "@/components/ui/virtualized-list";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { format, parseISO, startOfDay, endOfDay } from "date-fns";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { SalesFilters, SalesFiltersState } from "@/components/sales/SalesFilters";
import { ExpensePagination } from "@/components/expenses/ExpensePagination";
import { useFiscalSettings, getFiscalMonthRange } from "@/hooks/useFiscalSettings";
import { useCurrency } from "@/hooks/useCurrency";
import { getRestaurantDayBoundsUTC } from "@/lib/timezone";
import { fetchReconciledSalesByDay } from "@/lib/reconciledSales";
import { DailySalesDrilldown } from "@/components/sales/DailySalesDrilldown";
import { BranchTotalsExplainerBanner } from "@/components/branches/BranchTotalsExplainer";
import { DayEndAdjustmentBreakdown } from "@/components/sales/DayEndAdjustmentBreakdown";
import { useBranch } from "@/contexts/BranchContext";
import { editSale, recordSummarySales, voidSale } from "@/lib/api/pos";
import { useTranslation } from "react-i18next";
import { splitInclusive } from "@/lib/vatInclusive";

interface SalesItem {
  id: string;
  menu_item_id: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  menu_item?: { id: string; name: string; category: string | null } | null;
}

interface SaleTransaction {
  id: string;
  receipt_number: string | null;
  subtotal: number;
  tax: number;
  total: number;
  payment_method: "cash" | "card" | "other";
  created_at: string;
  shift_id: string | null;
  branch_id?: string | null;
  branch?: { id: string; name: string; code: string | null } | null;
  settlement_status?: "paid" | "unpaid" | "settled" | null;
  paid_amount?: number | null;
  customer_id?: string | null;
  settlement_invoice_id?: string | null;
  customer?: { id: string; name: string; phone?: string | null; current_balance?: number | null } | null;
  shift?: { id: string; drawer_id: string; opened_at?: string; closed_at?: string | null; drawers?: { name: string } } | null;
  sales_items?: SalesItem[];
}

interface AllShift {
  id: string;
  opened_at: string;
  closed_at: string | null;
  drawer_id: string;
  drawers?: { name: string };
  cashier_staff_id: string | null;
  staff?: { name: string } | null;
}

interface OpenShift {
  id: string;
  drawer_id: string;
  drawers?: { name: string };
}

const paymentMethodConfig = {
  cash: { label: "Cash", icon: Banknote, color: "bg-emerald-500/10 text-emerald-600" },
  card: { label: "Card", icon: CreditCard, color: "bg-primary/10 text-primary" },
  other: { label: "Other", icon: MoreHorizontal, color: "bg-muted text-muted-foreground" },
};

// Sales page component
export default function Sales() {
  // Mobile-responsive imports handled in AppLayout
  const { restaurant, hasRole, hasFeature } = useAuth();
  const { t } = useTranslation();
  const { hasMultipleBranches, activeBranchId, branches, canSwitchBranches, pinnedBranchId, setActiveBranchId } = useBranch();
  const [salesBranchFilter, setSalesBranchFilter] = useState<string | "all" | "untagged">(
    activeBranchId === "all" || activeBranchId == null ? "all" : activeBranchId
  );
  const isOwner = hasRole("owner");

  // Apply page-level branch filtering: a specific branch, all branches, or untagged records.
  const applyBranchFilter = (query: any, column = "branch_id") => {
    if (salesBranchFilter === "all") return query;
    if (salesBranchFilter === "untagged") return query.is(column, null);
    return query.eq(column, salesBranchFilter);
  };
  const shiftsEnabled = hasFeature("shifts");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { monthStartDay } = useFiscalSettings();
  const { format: formatCurrency, currencyInfo } = useCurrency();
  const [activeTab, setActiveTab] = useState<string>("transactions");
  const [openShifts, setOpenShifts] = useState<OpenShift[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [backdatedDialogOpen, setBackdatedDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [reassignShiftDialogOpen, setReassignShiftDialogOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<SaleTransaction | null>(null);
  const [reassigningTransaction, setReassigningTransaction] = useState<SaleTransaction | null>(null);
  const [pdfSettingsOpen, setPdfSettingsOpen] = useState(false);
  const [pdfOptions, setPdfOptions] = useState<SalesPdfOptions>(() => {
    try {
      const raw = localStorage.getItem("sales-pdf-options");
      return raw ? { ...DEFAULT_PDF_OPTIONS, ...JSON.parse(raw) } : DEFAULT_PDF_OPTIONS;
    } catch {
      return DEFAULT_PDF_OPTIONS;
    }
  });

  const savePdfOptions = (next: SalesPdfOptions) => {
    setPdfOptions(next);
    try { localStorage.setItem("sales-pdf-options", JSON.stringify(next)); } catch {}
  };
  const [viewingTransaction, setViewingTransaction] = useState<SaleTransaction | null>(null);
  const [viewDetailsDialogOpen, setViewDetailsDialogOpen] = useState(false);
  const detailsScrollRef = useRef<HTMLDivElement>(null);
  const salesDetailRef = useRef<HTMLDivElement>(null);

  const [showScrollTop, setShowScrollTop] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [includeOpenDays, setIncludeOpenDays] = useState(true);

  useEffect(() => {
    if (!viewDetailsDialogOpen) {
      setShowScrollTop(false);
      setScrollProgress(0);
      return;
    }
    const el = detailsScrollRef.current;
    if (!el) return;
    let frame = 0;
    let timeout: number | undefined;
    const updateScrollState = () => {
      setShowScrollTop(el.scrollTop > 240);
      const max = el.scrollHeight - el.clientHeight;
      setScrollProgress(max > 0 ? Math.min(1, Math.max(0, el.scrollTop / max)) : 0);
    };
    const resizeObserver = new ResizeObserver(() => updateScrollState());
    updateScrollState();
    frame = window.requestAnimationFrame(() => updateScrollState());
    timeout = window.setTimeout(() => updateScrollState(), 120);
    el.addEventListener("scroll", updateScrollState, { passive: true });
    resizeObserver.observe(el);
    Array.from(el.children).forEach((child) => resizeObserver.observe(child));
    return () => {
      window.cancelAnimationFrame(frame);
      if (timeout) window.clearTimeout(timeout);
      el.removeEventListener("scroll", updateScrollState);
      resizeObserver.disconnect();
    };
  }, [viewDetailsDialogOpen, viewingTransaction?.id]);

  // Payment history for the currently viewed transaction's settlement invoice
  const { data: paymentHistory = [], isLoading: paymentHistoryLoading } = useQuery({
    queryKey: ["transaction-payment-history", viewingTransaction?.settlement_invoice_id],
    enabled: viewDetailsDialogOpen && !!viewingTransaction?.settlement_invoice_id,
    queryFn: async () => {
      const { data, error } = await db
        .from("settlement_payments")
        .select("id, amount, payment_method, payment_reference, notes, created_at")
        .eq("settlement_invoice_id", viewingTransaction!.settlement_invoice_id!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Customer-wide payment history: every settlement payment + balance adjustment
  // for the viewed transaction's customer. Shown for unpaid transactions.
  const { data: customerPaymentHistory = [], isLoading: customerPaymentHistoryLoading } = useQuery({
    queryKey: ["customer-payment-history", viewingTransaction?.customer_id],
    enabled:
      viewDetailsDialogOpen &&
      !!viewingTransaction?.customer_id &&
      viewingTransaction?.settlement_status === "unpaid",
    queryFn: async () => {
      const customerId = viewingTransaction!.customer_id!;

      // 1. Settlement payments (joined via settlement_invoices to filter by customer)
      const { data: payments, error: payErr } = await db
        .from("settlement_payments")
        .select(
          "id, amount, payment_method, payment_reference, notes, created_at, settlement_invoice:settlement_invoices!inner(invoice_number, customer_id)"
        )
        .eq("settlement_invoice.customer_id", customerId)
        .order("created_at", { ascending: false });
      if (payErr) throw payErr;

      // 2. Manual balance adjustments
      const { data: adjustments, error: adjErr } = await db
        .from("customer_balance_adjustments")
        .select("id, amount, adjustment_type, reason, notes, created_at")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false });
      if (adjErr) throw adjErr;

      const events = [
        ...(payments || []).map((p: any) => ({
          id: `pay-${p.id}`,
          kind: "payment" as const,
          amount: Number(p.amount) || 0,
          method: p.payment_method,
          reference: p.payment_reference,
          label: `Settlement payment · ${p.settlement_invoice?.invoice_number || ""}`.trim(),
          notes: p.notes,
          created_at: p.created_at,
        })),
        ...(adjustments || []).map((a: any) => ({
          id: `adj-${a.id}`,
          kind: "adjustment" as const,
          amount: Number(a.amount) || 0,
          method: a.adjustment_type,
          reference: null,
          label: `Adjustment · ${String(a.adjustment_type).replace(/_/g, " ")}`,
          notes: [a.reason, a.notes].filter(Boolean).join(" - "),
          created_at: a.created_at,
        })),
      ].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      return events;
    },
  });

  // Settlement breakdown: invoices for the customer with the payments applied to each.
  const { data: settlementBreakdown = [], isLoading: settlementBreakdownLoading } = useQuery({
    queryKey: ["settlement-breakdown", viewingTransaction?.customer_id],
    enabled:
      viewDetailsDialogOpen &&
      !!viewingTransaction?.customer_id &&
      viewingTransaction?.settlement_status === "unpaid",
    queryFn: async () => {
      const { data, error } = await db
        .from("settlement_invoices")
        .select(
          "id, invoice_number, billing_period_start, billing_period_end, total_amount, amount_paid, status, created_at, settlement_payments(id, amount, payment_method, payment_reference, notes, created_at)"
        )
        .eq("customer_id", viewingTransaction!.customer_id!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });



  const [submitting, setSubmitting] = useState(false);
  const [allShifts, setAllShifts] = useState<AllShift[]>([]);
  const [selectedReassignShift, setSelectedReassignShift] = useState<string>("");

  // Sync page-level branch filter with the global BranchSwitcher, but preserve
  // Sync page-level branch filter with the global BranchSwitcher, but preserve
  // the "untagged" page-local view when the user explicitly selects it.
  useEffect(() => {
    if (!canSwitchBranches) return;
    if (salesBranchFilter === "untagged") return;
    const next = activeBranchId === null || activeBranchId === "all" ? "all" : activeBranchId;
    if (next === salesBranchFilter) return;
    setSalesBranchFilter(next);
  }, [activeBranchId, canSwitchBranches, salesBranchFilter]);

  // Form state
  const [subtotal, setSubtotal] = useState("");
  const [taxRate, setTaxRate] = useState("15");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "other">("cash");
  const [selectedShift, setSelectedShift] = useState<string>("");
  const [saleDate, setSaleDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [saleTime, setSaleTime] = useState(format(new Date(), "HH:mm"));

  // Filters and pagination state - use fiscal month
  const [filters, setFilters] = useState<SalesFiltersState>({
    search: "",
    paymentMethod: "",
    settlementStatus: "all",
    dateFrom: "",
    dateTo: "",
    timeFrom: "",
    timeTo: "",
    amountMin: "",
    amountMax: "",
    sortBy: "created_at",
    sortOrder: "desc",
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [filtersInitialized, setFiltersInitialized] = useState(false);

  // Initialize filters based on fiscal month settings once loaded
  useEffect(() => {
    if (!filtersInitialized && monthStartDay) {
      const fiscalMonth = getFiscalMonthRange(new Date(), monthStartDay);
      setFilters(prev => ({
        ...prev,
        dateFrom: format(fiscalMonth.start, "yyyy-MM-dd"),
        dateTo: format(fiscalMonth.end, "yyyy-MM-dd"),
      }));
      setFiltersInitialized(true);
    }
  }, [monthStartDay, filtersInitialized]);

  const gross = subtotal ? parseFloat(subtotal) : 0;
  const inclusiveSplit = splitInclusive(gross, (parseFloat(taxRate) || 0) / 100);
  const netSubtotal = inclusiveSplit.net;
  const tax = inclusiveSplit.vat;
  const total = inclusiveSplit.gross;

  // Helpers to combine date + optional time-of-day into ISO bounds
  const fromBoundISO = (dateStr: string, timeStr: string) => {
    const base = parseISO(dateStr);
    if (!timeStr) return startOfDay(base).toISOString();
    const [h, m] = timeStr.split(":").map(Number);
    const d = new Date(base);
    d.setHours(h || 0, m || 0, 0, 0);
    return d.toISOString();
  };
  const toBoundISO = (dateStr: string, timeStr: string) => {
    const base = parseISO(dateStr);
    if (!timeStr) return endOfDay(base).toISOString();
    const [h, m] = timeStr.split(":").map(Number);
    const d = new Date(base);
    d.setHours(h || 23, m || 59, 59, 999);
    return d.toISOString();
  };

  // Fetch total count for pagination
  const { data: totalCount = 0 } = useQuery({
    queryKey: ["sales-count", restaurant?.id, filters, salesBranchFilter],
    queryFn: async () => {
      if (!restaurant?.id) return 0;
      
      let query = db
        .from("sales_transactions")
        .select("*", { count: "exact", head: true })
        .eq("restaurant_id", restaurant.id);

      query = applyBranchFilter(query);

      // Apply filters
      if (filters.paymentMethod && filters.paymentMethod !== "all") {
        query = query.eq("payment_method", filters.paymentMethod as "cash" | "card" | "other");
      }
      if (filters.settlementStatus === "paid") {
        query = query.in("settlement_status", ["paid", "settled"]);
      } else if (filters.settlementStatus === "unpaid") {
        query = query.eq("settlement_status", "unpaid");
      }
      if (filters.dateFrom) {
        query = query.gte("created_at", fromBoundISO(filters.dateFrom, filters.timeFrom));
      }
      if (filters.dateTo) {
        query = query.lte("created_at", toBoundISO(filters.dateTo, filters.timeTo));
      }
      if (filters.amountMin) {
        query = query.gte("total", parseFloat(filters.amountMin));
      }
      if (filters.amountMax) {
        query = query.lte("total", parseFloat(filters.amountMax));
      }
      if (filters.search) {
        query = query.ilike("receipt_number", `%${filters.search}%`);
      }

      const { count, error } = await query;
      if (error) throw error;
      return count || 0;
    },
    enabled: !!restaurant?.id,
  });

  // Fetch transactions with filters and pagination
  const { data: transactions = [], isLoading: loading, refetch: refetchTransactions } = useQuery({
    queryKey: ["sales-transactions", restaurant?.id, filters, currentPage, pageSize, salesBranchFilter],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      
      let query = db
        .from("sales_transactions")
        .select("*, settlement_status, branch:branches!sales_transactions_branch_id_fkey(id, name, code), customer:customers(id, name, phone, current_balance), shift:shifts(id, drawer_id, opened_at, closed_at, drawers(name)), sales_items(id, menu_item_id, quantity, unit_price, total_price, menu_item:menu_items(id, name, category))")
        .eq("restaurant_id", restaurant.id);

      query = applyBranchFilter(query);

      // Apply filters
      if (filters.paymentMethod && filters.paymentMethod !== "all") {
        query = query.eq("payment_method", filters.paymentMethod as "cash" | "card" | "other");
      }
      if (filters.settlementStatus === "paid") {
        query = query.in("settlement_status", ["paid", "settled"]);
      } else if (filters.settlementStatus === "unpaid") {
        query = query.eq("settlement_status", "unpaid");
      }
      if (filters.dateFrom) {
        query = query.gte("created_at", fromBoundISO(filters.dateFrom, filters.timeFrom));
      }
      if (filters.dateTo) {
        query = query.lte("created_at", toBoundISO(filters.dateTo, filters.timeTo));
      }
      if (filters.amountMin) {
        query = query.gte("total", parseFloat(filters.amountMin));
      }
      if (filters.amountMax) {
        query = query.lte("total", parseFloat(filters.amountMax));
      }
      if (filters.search) {
        query = query.ilike("receipt_number", `%${filters.search}%`);
      }

      // Sorting
      query = query.order(filters.sortBy, { ascending: filters.sortOrder === "asc" });

      // Pagination
      const from = (currentPage - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);

      const { data, error } = await query;
      if (error) throw error;
      return data as SaleTransaction[];
    },
    enabled: !!restaurant?.id,
  });
  // NOTE: Removed unbounded sales-all-stats query - stats now come from filtered queries
  // This eliminates the slow query that fetched ALL historical transactions

  // Fetch this month's sales total
  const emptyMonthSales = {
    total: 0,
    count: 0,
    cash: 0,
    card: 0,
    closedTotal: 0,
    closedCount: 0,
    closedCash: 0,
    closedCard: 0,
    days: [] as Array<{
      date: string;
      raw: number;
      adjustments: number;
      summary: number | null;
      final: number;
      closed: boolean;
    }>,
  };
  const { data: thisMonthSales = emptyMonthSales } = useQuery({
    queryKey: ["sales-this-month", restaurant?.id, monthStartDay, salesBranchFilter],
    queryFn: async () => {
      if (!restaurant?.id || !monthStartDay) return emptyMonthSales;

      const fiscalMonth = getFiscalMonthRange(new Date(), monthStartDay);
      const fromDate = format(fiscalMonth.start, "yyyy-MM-dd");
      const toDate = format(fiscalMonth.end, "yyyy-MM-dd");
      const reconciled = await fetchReconciledSalesByDay({
        restaurantId: restaurant.id,
        dateFrom: fromDate,
        dateTo: toDate,
        branchId: salesBranchFilter === "all" ? null : salesBranchFilter,
      });
      let cash = 0;
      let card = 0;
      for (const d of reconciled.summaryDetailByDay.values()) {
        cash += d.cash;
        card += d.card;
      }
      const dayKeys = Array.from(
        new Set([
          ...reconciled.perDay.keys(),
          ...reconciled.rawTxByDay.keys(),
          ...reconciled.summaryByDay.keys(),
          ...reconciled.adjustmentsByDay.keys(),
        ])
      ).sort();
      const days = dayKeys
        .map((date) => ({
          date,
          raw: reconciled.rawTxByDay.get(date) || 0,
          adjustments: reconciled.adjustmentsByDay.get(date) || 0,
          summary: reconciled.summaryByDay.has(date)
            ? Number(reconciled.summaryByDay.get(date))
            : null,
          final: reconciled.perDay.get(date) || 0,
          closed: reconciled.summaryByDay.has(date),
        }))
        .filter((d) => d.final !== 0 || d.raw !== 0 || d.adjustments !== 0);

      return {
        total: reconciled.total,
        count: reconciled.txCount,
        cash,
        card,
        closedTotal: reconciled.closedTotal,
        closedCount: reconciled.closedTxCount,
        closedCash: reconciled.closedCash,
        closedCard: reconciled.closedCard,
        days,
      };
    },
    enabled: !!restaurant?.id && !!monthStartDay,
  });

  const monthSalesView = useMemo(
    () =>
      includeOpenDays
        ? {
            total: thisMonthSales.total,
            count: thisMonthSales.count,
            cash: thisMonthSales.cash,
            card: thisMonthSales.card,
            days: thisMonthSales.days,
          }
        : {
            total: thisMonthSales.closedTotal,
            count: thisMonthSales.closedCount,
            cash: thisMonthSales.closedCash,
            card: thisMonthSales.closedCard,
            days: thisMonthSales.days.filter((d) => d.closed),
          },
    [includeOpenDays, thisMonthSales]
  );


  // Fetch fiscal month paid/unpaid totals
  // unpaidTotal = outstanding balance (total - paid_amount) for unpaid receipts
  const { data: fiscalMonthPaidUnpaid = { paidTotal: 0, unpaidTotal: 0 } } = useQuery({
    queryKey: ["sales-fiscal-month-paid-unpaid", restaurant?.id, monthStartDay, salesBranchFilter],
    queryFn: async () => {
      if (!restaurant?.id || !monthStartDay) return { paidTotal: 0, unpaidTotal: 0 };
      
      const fiscalMonth = getFiscalMonthRange(new Date(), monthStartDay);
      
      let q = db
        .from("sales_transactions")
        .select("total, settlement_status, paid_amount")
        .eq("restaurant_id", restaurant.id)
        .gte("created_at", startOfDay(fiscalMonth.start).toISOString())
        .lte("created_at", endOfDay(fiscalMonth.end).toISOString());
      q = applyBranchFilter(q);
      const { data, error } = await q;
      
      if (error) throw error;
      
      const paidTotal = data?.filter(t => t.settlement_status === "paid" || t.settlement_status === "settled").reduce((sum, t) => sum + (t.total || 0), 0) || 0;
      // Outstanding = total - paid_amount for unpaid receipts (matches customer current_balance)
      const unpaidTotal = data?.filter(t => t.settlement_status === "unpaid").reduce((sum, t) => sum + ((t.total || 0) - (t.paid_amount || 0)), 0) || 0;
      return { paidTotal, unpaidTotal };
    },
    enabled: !!restaurant?.id && !!monthStartDay,
  });

  // Fetch this month's expenses total (fiscal month)
  const { data: thisMonthExpenses = { total: 0, count: 0 } } = useQuery({
    queryKey: ["expenses-this-month", restaurant?.id, monthStartDay, salesBranchFilter],
    queryFn: async () => {
      if (!restaurant?.id || !monthStartDay) return { total: 0, count: 0 };

      const fiscalMonth = getFiscalMonthRange(new Date(), monthStartDay);
      const fromDate = format(fiscalMonth.start, "yyyy-MM-dd");
      const toDate = format(fiscalMonth.end, "yyyy-MM-dd");

      let q = db
        .from("expenses")
        .select("amount")
        .eq("restaurant_id", restaurant.id)
        .is("deleted_at", null)
        .gte("expense_date", fromDate)
        .lte("expense_date", toDate);
      q = applyBranchFilter(q);
      const { data, error } = await q;

      if (error) throw error;
      const total = data?.reduce((sum, e) => sum + (Number(e.amount) || 0), 0) || 0;
      return { total, count: data?.length || 0 };
    },
    enabled: !!restaurant?.id && !!monthStartDay,
  });

  // Fetch today's sales by shift for breakdown
  interface TodayShiftSale {
    shiftId: string;
    shiftName: string;
    drawerName: string;
    openedAt: string;
    total: number;
  }
  
  const { data: todayShiftBreakdown = [] } = useQuery<TodayShiftSale[]>({
    queryKey: ["sales-today-by-shift", restaurant?.id, restaurant?.timezone, salesBranchFilter],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      
      // Use restaurant timezone for accurate "today" bounds
      const tz = restaurant.timezone || "Asia/Riyadh";
      const { start, endExclusive } = getRestaurantDayBoundsUTC(new Date(), tz);
      
      // Get today's sales with shift info
      let salesQ = db
        .from("sales_transactions")
        .select("total, shift_id")
        .eq("restaurant_id", restaurant.id)
        .gte("created_at", start.toISOString())
        .lt("created_at", endExclusive.toISOString());
      salesQ = applyBranchFilter(salesQ);
      const { data: salesData, error } = await salesQ;
      
      if (error) throw error;
      if (!salesData || salesData.length === 0) return [];
      
      // Get unique shift IDs
      const shiftIds = [...new Set(salesData.map(s => s.shift_id).filter(Boolean))];
      if (shiftIds.length === 0) return [];
      
      // Fetch shift details - use template_id FK to shift_templates
      const { data: shiftsData } = await db
        .from("shifts")
        .select("id, opened_at, template:shift_templates(name), drawers(name)")
        .in("id", shiftIds);
      
      const shiftMap = new Map<any, any>(shiftsData?.map(s => [s.id, s]) || []);
      
      // Group sales by shift
      const shiftTotals = new Map<string, number>();
      salesData.forEach(sale => {
        if (sale.shift_id) {
          const current = shiftTotals.get(sale.shift_id) || 0;
          shiftTotals.set(sale.shift_id, current + (Number(sale.total) || 0));
        }
      });
      
      return Array.from(shiftTotals.entries()).map(([shiftId, total]) => {
        const shift = shiftMap.get(shiftId);
        const templateName = (shift?.template as any)?.name;
        const drawerName = (shift?.drawers as any)?.name;
        return {
          shiftId,
          shiftName: templateName || "Shift",
          drawerName: drawerName || "",
          openedAt: shift?.opened_at || "",
          total,
        };
      }).sort((a, b) => new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime());
    },
    enabled: !!restaurant?.id,
  });

  // Fetch today's actual transaction count
  const { data: todayTransactionCount = 0 } = useQuery({
    queryKey: ["sales-today-count", restaurant?.id, restaurant?.timezone, salesBranchFilter],
    queryFn: async () => {
      if (!restaurant?.id) return 0;
      
      const tz = restaurant.timezone || "Asia/Riyadh";
      const { start, endExclusive } = getRestaurantDayBoundsUTC(new Date(), tz);
      
      let q = db
        .from("sales_transactions")
        .select("id", { count: "exact", head: true })
        .eq("restaurant_id", restaurant.id)
        .gte("created_at", start.toISOString())
        .lt("created_at", endExclusive.toISOString());
      q = applyBranchFilter(q);
      const { count, error } = await q;
      
      if (error) throw error;
      return count || 0;
    },
    enabled: !!restaurant?.id,
  });

  // Fetch today's total sales (independent of shift assignment so unassigned
  // transactions are still included in the headline metric)
  const { data: todayTotalSales = 0 } = useQuery({
    queryKey: ["sales-today-total", restaurant?.id, restaurant?.timezone, salesBranchFilter],
    queryFn: async () => {
      if (!restaurant?.id) return 0;

      const tz = restaurant.timezone || "Asia/Riyadh";
      const { start, endExclusive } = getRestaurantDayBoundsUTC(new Date(), tz);

      let q = db
        .from("sales_transactions")
        .select("total")
        .eq("restaurant_id", restaurant.id)
        .gte("created_at", start.toISOString())
        .lt("created_at", endExclusive.toISOString());
      q = applyBranchFilter(q);
      const { data, error } = await q;

      if (error) throw error;
      return (data || []).reduce((sum, r: any) => sum + (Number(r.total) || 0), 0);
    },
    enabled: !!restaurant?.id,
  });

  // Fetch filtered total (sum of all filtered transactions, not just current page)
  const { data: filteredStats } = useQuery({
    queryKey: ["sales-filtered-stats", restaurant?.id, filters, salesBranchFilter],
    queryFn: async () => {
      if (!restaurant?.id) return { total: 0, count: 0, paidTotal: 0, unpaidTotal: 0 };
      
      let query = db
        .from("sales_transactions")
        .select("total, settlement_status")
        .eq("restaurant_id", restaurant.id);

      query = applyBranchFilter(query);

      // Apply filters (same as main query but without pagination)
      if (filters.paymentMethod && filters.paymentMethod !== "all") {
        query = query.eq("payment_method", filters.paymentMethod as "cash" | "card" | "other");
      }
      if (filters.settlementStatus === "paid") {
        query = query.in("settlement_status", ["paid", "settled"]);
      } else if (filters.settlementStatus === "unpaid") {
        query = query.eq("settlement_status", "unpaid");
      }
      if (filters.dateFrom) {
        query = query.gte("created_at", fromBoundISO(filters.dateFrom, filters.timeFrom));
      }
      if (filters.dateTo) {
        query = query.lte("created_at", toBoundISO(filters.dateTo, filters.timeTo));
      }
      if (filters.amountMin) {
        query = query.gte("total", parseFloat(filters.amountMin));
      }
      if (filters.amountMax) {
        query = query.lte("total", parseFloat(filters.amountMax));
      }
      if (filters.search) {
        query = query.ilike("receipt_number", `%${filters.search}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      
      const paidTotal = data?.filter(t => t.settlement_status === "paid" || t.settlement_status === "settled").reduce((sum, t) => sum + (t.total || 0), 0) || 0;
      const unpaidTotal = data?.filter(t => t.settlement_status === "unpaid" || t.settlement_status === null).reduce((sum, t) => sum + (t.total || 0), 0) || 0;
      const total = data?.reduce((sum, t) => sum + (t.total || 0), 0) || 0;
      return { total, count: data?.length || 0, paidTotal, unpaidTotal };
    },
    enabled: !!restaurant?.id,
  });

  // Fetch ALL filtered sales for export (no pagination)
  const { refetch: refetchAllSales } = useQuery({
    queryKey: ["sales-all-filtered", restaurant?.id, filters, salesBranchFilter],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      
      let query = db
        .from("sales_transactions")
        .select("*, shift:shifts(id, drawer_id, drawers(name))")
        .eq("restaurant_id", restaurant.id);

      query = applyBranchFilter(query);

      // Apply filters
      if (filters.paymentMethod && filters.paymentMethod !== "all") {
        query = query.eq("payment_method", filters.paymentMethod as "cash" | "card" | "other");
      }
      if (filters.settlementStatus === "paid") {
        query = query.in("settlement_status", ["paid", "settled"]);
      } else if (filters.settlementStatus === "unpaid") {
        query = query.eq("settlement_status", "unpaid");
      }
      if (filters.dateFrom) {
        query = query.gte("created_at", fromBoundISO(filters.dateFrom, filters.timeFrom));
      }
      if (filters.dateTo) {
        query = query.lte("created_at", toBoundISO(filters.dateTo, filters.timeTo));
      }
      if (filters.amountMin) {
        query = query.gte("total", parseFloat(filters.amountMin));
      }
      if (filters.amountMax) {
        query = query.lte("total", parseFloat(filters.amountMax));
      }
      if (filters.search) {
        query = query.ilike("receipt_number", `%${filters.search}%`);
      }

      query = query.order(filters.sortBy, { ascending: filters.sortOrder === "asc" });

      const { data, error } = await query;
      if (error) throw error;
      return data as SaleTransaction[];
    },
    enabled: false, // Only fetch when export is triggered
  });

  useEffect(() => {
    if (restaurant?.id) {
      fetchOpenShifts();
      fetchAllShifts();
    }
  }, [restaurant?.id]);

  // Realtime: refresh today's metrics + transactions list when sales change
  useEffect(() => {
    if (!restaurant?.id) return;
    const channel = db
      .channel(`sales-realtime-${restaurant.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "sales_transactions",
          filter: `restaurant_id=eq.${restaurant.id}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["sales-today-total"] });
          queryClient.invalidateQueries({ queryKey: ["sales-today-count"] });
          queryClient.invalidateQueries({ queryKey: ["sales-today-by-shift"] });
          queryClient.invalidateQueries({ queryKey: ["sales-transactions"] });
          queryClient.invalidateQueries({ queryKey: ["sales-count"] });
          queryClient.invalidateQueries({ queryKey: ["sales-filtered-stats"] });
          queryClient.invalidateQueries({ queryKey: ["sales-this-month"] });
          queryClient.invalidateQueries({ queryKey: ["sales-fiscal-month-paid-unpaid"] });
        }
      )
      .subscribe();

    return () => {
      db.removeChannel(channel);
    };
  }, [restaurant?.id, queryClient]);

  const fetchOpenShifts = async () => {
    if (!restaurant?.id) return;
    
    try {
      const { data, error } = await db
        .from("shifts")
        .select("id, drawer_id, drawers(name)")
        .eq("restaurant_id", restaurant.id)
        .eq("status", "open");

      if (error) throw error;
      setOpenShifts(data || []);
      if (data && data.length > 0) {
        setSelectedShift(data[0].id);
      }
    } catch (error) {
      console.error("Error fetching open shifts:", error);
    }
  };

  const fetchAllShifts = async () => {
    if (!restaurant?.id) return;
    
    try {
      const { data, error } = await db
        .from("shifts")
        .select("id, opened_at, closed_at, drawer_id, drawers(name), cashier_staff_id, staff(name)")
        .eq("restaurant_id", restaurant.id)
        .order("opened_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      setAllShifts(data as AllShift[] || []);
    } catch (error) {
      console.error("Error fetching all shifts:", error);
    }
  };

  const handleCreateSale = async (isBackdated: boolean = false) => {
    if (!subtotal || !restaurant?.id) {
      toast({ title: t("common.error"), description: t("app.sales.toasts.subtotalRequired"), variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      // Create timestamp for backdated sales
      let createdAt: string | undefined;
      if (isBackdated) {
        createdAt = new Date(`${saleDate}T${saleTime}:00`).toISOString();
      }

      // POST /api/v1/pos/sales/summary: numbered in the restaurant's receipt sequence, VAT split
      // with the entered rate, drawer entry when a shift is picked.
      const { transactions } = await recordSummarySales({
        restaurantId: restaurant.id,
        branchId: activeBranchId && activeBranchId !== "all" ? activeBranchId : null,
        shiftId: selectedShift && selectedShift !== "none" ? selectedShift : null,
        kind: "manual",
        createdAt: isBackdated && createdAt ? createdAt : null,
        vatPercent: parseFloat(taxRate) || 0,
        entries: [{ paymentMethod: paymentMethod as "cash" | "card" | "other", total }],
      });
      const receiptNumber = transactions[0].receipt_number;

      toast({ title: t("app.sales.toasts.saleRecorded"), description: t("app.sales.toasts.receipt", { number: receiptNumber }) });
      queryClient.invalidateQueries({ queryKey: ["sales-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["sales-count"] });
      queryClient.invalidateQueries({ queryKey: ["sales-all-stats"] });
      setDialogOpen(false);
      setBackdatedDialogOpen(false);
      resetForm();
    } catch (error: any) {
      console.error("Error creating sale:", error);
      toast({ title: t("common.error"), description: error.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setSubtotal("");
    setTaxRate("15");
    setPaymentMethod("cash");
    setSaleDate(format(new Date(), "yyyy-MM-dd"));
    setSaleTime(format(new Date(), "HH:mm"));
  };

  // Sales are never deleted: the server voids them (negative mirror sale, stock back, refund
  // from an open shift's drawer). POST /api/v1/pos/sales/:id/void
  const handleDeleteSale = async (transactionId: string) => {
    if (!restaurant?.id) return;
    try {
      await voidSale(transactionId, { restaurantId: restaurant.id, reason: "Voided from the Sales page" });

      toast({ title: t("app.sales.toasts.saleDeleted") });
      queryClient.invalidateQueries({ queryKey: ["sales-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["sales-count"] });
      queryClient.invalidateQueries({ queryKey: ["sales-all-stats"] });
    } catch (error: any) {
      console.error("Error deleting sale:", error);
      toast({ title: t("common.error"), description: error.message, variant: "destructive" });
    }
  };

  const openEditDialog = (transaction: SaleTransaction) => {
    setEditingTransaction(transaction);
    setSubtotal(transaction.total.toString());
    // Calculate tax rate from subtotal and tax
    const calculatedTaxRate = transaction.subtotal > 0 
      ? ((transaction.tax / transaction.subtotal) * 100).toFixed(0)
      : "15";
    setTaxRate(calculatedTaxRate);
    setPaymentMethod(transaction.payment_method);
    setEditDialogOpen(true);
  };

  const openReassignShiftDialog = (transaction: SaleTransaction) => {
    setReassigningTransaction(transaction);
    setSelectedReassignShift(transaction.shift_id || "");
    setReassignShiftDialogOpen(true);
  };

  const openViewDetailsDialog = (transaction: SaleTransaction) => {
    setViewingTransaction(transaction);
    setViewDetailsDialogOpen(true);
  };

  const handleReassignShift = async () => {
    if (!reassigningTransaction || !restaurant?.id) return;

    setSubmitting(true);
    try {
      await editSale(reassigningTransaction.id, {
        restaurantId: restaurant.id,
        shiftId: selectedReassignShift && selectedReassignShift !== "none" ? selectedReassignShift : null,
      });

      toast({ title: t("app.sales.toasts.shiftReassigned") });
      queryClient.invalidateQueries({ queryKey: ["sales-transactions"] });
      setReassignShiftDialogOpen(false);
      setReassigningTransaction(null);
    } catch (error: any) {
      console.error("Error reassigning shift:", error);
      toast({ title: t("common.error"), description: error.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateSale = async () => {
    if (!editingTransaction || !subtotal || !restaurant?.id) {
      toast({ title: t("common.error"), description: t("app.sales.toasts.subtotalRequired"), variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      await editSale(editingTransaction.id, {
        restaurantId: restaurant.id,
        total,
        vatPercent: parseFloat(taxRate) || 0,
        paymentMethod: paymentMethod as "cash" | "card" | "other",
      });

      toast({ title: t("app.sales.toasts.saleUpdated") });
      queryClient.invalidateQueries({ queryKey: ["sales-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["sales-count"] });
      queryClient.invalidateQueries({ queryKey: ["sales-all-stats"] });
      setEditDialogOpen(false);
      setEditingTransaction(null);
      resetForm();
    } catch (error: any) {
      console.error("Error updating sale:", error);
      toast({ title: t("common.error"), description: error.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  // Calculate today's total from the shift breakdown (which already uses correct UTC boundaries)
  const todayTotal = todayTotalSales;
  const todayCount = todayTransactionCount;
  const filteredTotal = filteredStats?.total || 0;

  // Handlers for filters
  const handleFiltersChange = (newFilters: SalesFiltersState) => {
    setFilters(newFilters);
    setCurrentPage(1);
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setCurrentPage(1);
  };

  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <>
      <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
        {/* Header */}
        <header className="flex min-h-[64px] flex-col gap-4 fade-slide-in lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl font-semibold md:text-3xl">{t("app.sales.title")}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t("app.sales.subtitle")}</p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <MoreHorizontal className="h-4 w-4" />
                  <span>More</span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem
                  disabled={totalCount === 0}
                  className="h-10 gap-2"
                  onSelect={async () => {
                    const { data } = await refetchAllSales();
                    if (data && data.length > 0) {
                      const dateRange = `${filters.dateFrom}_to_${filters.dateTo}`;
                      exportToCSV(prepareSalesExportData(data, filteredTotal, dateRange, (id) => branches.find((b) => b.id === id)?.name ?? null));
                      toast({ title: t("app.sales.toasts.csvExported", { count: data.length }) });
                    } else toast({ title: t("app.sales.toasts.nothingToExport"), variant: "destructive" });
                  }}
                >
                  <FileDown className="h-4 w-4" /> {t("app.sales.exportCsv")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={totalCount === 0}
                  className="h-10 gap-2"
                  onSelect={async () => {
                    const { data } = await refetchAllSales();
                    if (data && data.length > 0) {
                      exportSalesPdf(data as any, pdfOptions, { dateRange: `${filters.dateFrom}_to_${filters.dateTo}`, currency: currencyInfo?.symbol || "", restaurantName: restaurant?.name });
                      toast({ title: t("app.sales.toasts.pdfExported", { count: data.length }) });
                    } else toast({ title: t("app.sales.toasts.nothingToExport"), variant: "destructive" });
                  }}
                >
                  <FileText className="h-4 w-4" /> {t("app.sales.exportPdf")}
                </DropdownMenuItem>
                <DropdownMenuItem className="h-10 gap-2" onSelect={() => setPdfSettingsOpen(true)}>
                  <Settings2 className="h-4 w-4" /> {t("app.sales.actions.pdfSettings")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="h-10 gap-2" onSelect={() => setBackdatedDialogOpen(true)}>
                  <CalendarPlus className="h-4 w-4" /> {t("app.sales.backdatedSale")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Dialog open={pdfSettingsOpen} onOpenChange={setPdfSettingsOpen}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>{t("app.sales.dialog.pdfSettings")}</DialogTitle>
                  <DialogDescription>{t("app.sales.dialog.pdfSettingsDesc")}</DialogDescription>
                </DialogHeader>
                <div className="space-y-6 py-2">
                  <div className="space-y-3">
                    <Label className="text-sm font-medium">{t("app.sales.pdf.breakdownDetail")}</Label>
                    <RadioGroup
                      value={pdfOptions.breakdownDetail}
                      onValueChange={(v) => savePdfOptions({ ...pdfOptions, breakdownDetail: v as BreakdownDetail })}
                    >
                      <div className="flex items-start gap-3 rounded-md border p-3">
                        <RadioGroupItem value="none" id="bd-none" className="mt-1" />
                        <div>
                          <Label htmlFor="bd-none" className="cursor-pointer">{t("app.sales.pdf.totalsOnly")}</Label>
                          <p className="text-xs text-muted-foreground">{t("app.sales.pdf.totalsOnlyDesc")}</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 rounded-md border p-3">
                        <RadioGroupItem value="summary" id="bd-summary" className="mt-1" />
                        <div>
                          <Label htmlFor="bd-summary" className="cursor-pointer">{t("app.sales.pdf.perShift")}</Label>
                          <p className="text-xs text-muted-foreground">{t("app.sales.pdf.perShiftDesc")}</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 rounded-md border p-3">
                        <RadioGroupItem value="detailed" id="bd-detailed" className="mt-1" />
                        <div>
                          <Label htmlFor="bd-detailed" className="cursor-pointer">{t("app.sales.pdf.detailedTx")}</Label>
                          <p className="text-xs text-muted-foreground">{t("app.sales.pdf.detailedTxDesc")}</p>
                        </div>
                      </div>
                    </RadioGroup>
                  </div>

                  <div className="flex items-start justify-between gap-3 rounded-md border p-3">
                    <div>
                      <Label htmlFor="include-unassigned" className="cursor-pointer">{t("app.sales.pdf.includeUnassigned")}</Label>
                      <p className="text-xs text-muted-foreground">{t("app.sales.pdf.includeUnassignedDesc")}</p>
                    </div>
                    <Switch
                      id="include-unassigned"
                      checked={pdfOptions.includeUnassigned}
                      onCheckedChange={(checked) => savePdfOptions({ ...pdfOptions, includeUnassigned: checked })}
                    />
                  </div>
                </div>
              </DialogContent>
            </Dialog>
            <SalesRecorder />
            
            {/* Backdated Sale Dialog */}
            <Dialog open={backdatedDialogOpen} onOpenChange={(open) => {
              setBackdatedDialogOpen(open);
              if (!open) resetForm();
            }}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>{t("app.sales.dialog.recordBackdated")}</DialogTitle>
                  <DialogDescription>{t("app.sales.dialog.recordBackdatedDesc")}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>{t("app.sales.dialog.date")}</Label>
                      <Input
                        type="date"
                        value={saleDate}
                        onChange={(e) => setSaleDate(e.target.value)}
                        max={format(new Date(), "yyyy-MM-dd")}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t("app.sales.dialog.time")}</Label>
                      <Input
                        type="time"
                        value={saleTime}
                        onChange={(e) => setSaleTime(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Gross price, VAT inclusive ({currencyInfo?.symbol || "﷼"})</Label>
                    <Input
                      type="number"
                      placeholder="0.00"
                      value={subtotal}
                      onChange={(e) => setSubtotal(e.target.value)}
                      min="0"
                      step="0.01"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>{t("app.sales.dialog.taxRate")}</Label>
                    <Input
                      type="number"
                      placeholder="15"
                      value={taxRate}
                      onChange={(e) => setTaxRate(e.target.value)}
                      min="0"
                      max="100"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>{t("app.sales.dialog.paymentMethod")}</Label>
                    <div className="flex gap-2">
                      {(["cash", "card", "other"] as const).map((method) => {
                        const config = paymentMethodConfig[method];
                        return (
                          <Button
                            key={method}
                            type="button"
                            variant={paymentMethod === method ? "default" : "outline"}
                            className="flex-1 gap-2"
                            onClick={() => setPaymentMethod(method)}
                          >
                            <config.icon className="h-4 w-4" />
                            {config.label}
                          </Button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="p-3 bg-muted rounded-lg">
                    <div className="flex justify-between text-sm">
                      <span>Net</span>
                      <span>{formatCurrency(netSubtotal)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>{t("app.sales.dialog.tax")} ({taxRate}%)</span>
                      <span>{formatCurrency(tax)}</span>
                    </div>
                    <div className="flex justify-between font-semibold mt-2 pt-2 border-t">
                      <span>{t("app.sales.dialog.total")}</span>
                      <span>{formatCurrency(total)}</span>
                    </div>
                  </div>

                  <Button
                    onClick={() => handleCreateSale(true)}
                    disabled={submitting || !subtotal}
                    className="w-full"
                  >
                    {submitting ? t("app.sales.dialog.recording") : t("app.sales.dialog.recordBackdated")}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            {/* Quick Sale Dialog */}
            <Dialog open={dialogOpen} onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) resetForm();
            }}>
              <DialogTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <Plus className="h-4 w-4" />
                  {t("app.sales.quickSale")}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>{t("app.sales.dialog.recordSale")}</DialogTitle>
                  <DialogDescription>{t("app.sales.dialog.recordSaleDesc")}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  {openShifts.length > 0 && (
                    <div className="space-y-2">
                      <Label>{t("app.sales.dialog.shiftOptional")}</Label>
                      <Select value={selectedShift} onValueChange={setSelectedShift}>
                        <SelectTrigger>
                          <SelectValue placeholder={t("app.sales.dialog.selectShift")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t("app.sales.dialog.noShift")}</SelectItem>
                          {openShifts.map((shift) => (
                            <SelectItem key={shift.id} value={shift.id}>
                              {(shift.drawers as any)?.name || "Drawer"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label>Gross price, VAT inclusive ({currencyInfo?.symbol || "﷼"})</Label>
                    <Input
                      type="number"
                      placeholder="0.00"
                      value={subtotal}
                      onChange={(e) => setSubtotal(e.target.value)}
                      min="0"
                      step="0.01"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>{t("app.sales.dialog.taxRate")}</Label>
                    <Input
                      type="number"
                      placeholder="15"
                      value={taxRate}
                      onChange={(e) => setTaxRate(e.target.value)}
                      min="0"
                      max="100"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>{t("app.sales.dialog.paymentMethod")}</Label>
                    <div className="flex gap-2">
                      {(["cash", "card", "other"] as const).map((method) => {
                        const config = paymentMethodConfig[method];
                        return (
                          <Button
                            key={method}
                            type="button"
                            variant={paymentMethod === method ? "default" : "outline"}
                            className="flex-1 gap-2"
                            onClick={() => setPaymentMethod(method)}
                          >
                            <config.icon className="h-4 w-4" />
                            {config.label}
                          </Button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="p-3 bg-muted rounded-lg">
                    <div className="flex justify-between text-sm">
                      <span>Net</span>
                      <span>{formatCurrency(netSubtotal)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>{t("app.sales.dialog.tax")} ({taxRate}%)</span>
                      <span>{formatCurrency(tax)}</span>
                    </div>
                    <div className="flex justify-between font-semibold mt-2 pt-2 border-t">
                      <span>{t("app.sales.dialog.total")}</span>
                      <span>{formatCurrency(total)}</span>
                    </div>
                  </div>

                  <Button
                    onClick={() => handleCreateSale(false)}
                    disabled={submitting || !subtotal}
                    className="w-full"
                  >
                    {submitting ? t("app.sales.dialog.recording") : t("app.sales.dialog.recordSale")}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </header>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid h-11 w-full grid-cols-3 md:w-fit md:min-w-[520px]">
            <TabsTrigger value="transactions" className="gap-2">
              <Receipt className="h-4 w-4" />
              {t("app.sales.tabs.transactions")}
            </TabsTrigger>
            <TabsTrigger value="breakdown" className="gap-2">
              <BarChart3 className="h-4 w-4" />
              {t("app.sales.tabs.breakdown")}
            </TabsTrigger>
            <TabsTrigger value="dayend" className="gap-2">
              <Scale className="h-4 w-4" />
              {t("app.sales.tabs.dayend")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="transactions" className="mt-5 space-y-5">
            <BranchTotalsExplainerBanner />
            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr] gap-5 fade-slide-in [&>*]:shadow-soft">
              <CumulativeExpenseChart
                restaurantId={restaurant?.id}
                dateFrom={filters.dateFrom}
                dateTo={filters.dateTo}
                branchId={salesBranchFilter === "all" ? null : salesBranchFilter}
              />
              <DailyExpenseBarChart
                restaurantId={restaurant?.id}
                dateFrom={filters.dateFrom}
                dateTo={filters.dateTo}
                branchId={salesBranchFilter === "all" ? null : salesBranchFilter}
              />
            </div>

            {/* Stats Summary - Row 1 */}
            <div className="flex items-center justify-end gap-3">
              <span className="text-sm text-muted-foreground">
                {includeOpenDays ? "Including open day" : "Closed days only"}
              </span>
              <Switch
                id="include-open-days"
                checked={includeOpenDays}
                onCheckedChange={setIncludeOpenDays}
                aria-label="Toggle inclusion of open business days in month totals"
              />
            </div>
            <div className="space-y-4 fade-slide-in" style={{ animationDelay: "50ms" }}>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-lg border bg-card flex flex-col">
                  <p className="text-sm text-muted-foreground flex items-center">
                    {t("app.sales.stats.filteredTotal")}
                    <CardTooltip label="Filtered total">
                      Total of transactions matching the current date range and filters.
                      Includes all payment methods and settlement statuses in scope.
                    </CardTooltip>
                  </p>
                  <p className="text-xl md:text-2xl font-semibold mt-1 break-all">{formatCurrency(filteredTotal)}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t("app.sales.stats.transactionsCount", { count: filteredStats?.count || 0 })}</p>
                </div>
                <div className="p-4 rounded-lg border bg-card flex flex-col">
                  <p className="text-sm text-muted-foreground flex items-center">
                    {t("app.sales.stats.thisMonth")}
                    <CardTooltip label="This month">
                      {includeOpenDays
                        ? "Fiscal month-to-date. Includes closed business days (day-end summaries) plus the current open day's live POS transactions."
                        : "Fiscal month-to-date for closed business days only. Excludes today's live POS transactions until the day is closed."}
                    </CardTooltip>
                  </p>
                  <p className="text-xl md:text-2xl font-semibold mt-1 break-all">{formatCurrency(monthSalesView.total)}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t("app.sales.stats.transactionsCount", { count: monthSalesView.count })}</p>
                </div>
                <div className="p-4 rounded-lg border bg-card flex flex-col col-span-2 md:col-span-1">
                  <p className="text-sm text-muted-foreground flex items-center">
                    {t("app.sales.stats.todaySales")}
                    <CardTooltip label="Today's sales">
                      Live POS transactions for the current business day
                      (11:00 AM – 11:00 AM). Includes sales from open shifts.
                    </CardTooltip>
                  </p>
                  <p className="text-xl md:text-2xl font-semibold mt-1 break-all">{formatCurrency(todayTotal)}</p>
                  {todayShiftBreakdown.length > 0 && (
                    <div className="mt-3 pt-2 border-t space-y-1.5">
                      <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                        <Store className="h-3 w-3" />
                        {t("app.sales.stats.byShift")}
                      </p>
                      {todayShiftBreakdown.map((shift) => (
                        <div key={shift.shiftId} className="flex items-center justify-between text-xs gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-foreground truncate">{shift.shiftName}</span>
                            {shift.drawerName && (
                              <span className="px-1 py-0.5 rounded bg-muted text-muted-foreground text-[10px] whitespace-nowrap" title={shift.drawerName}>
                                {shift.drawerName.split(' ').map(w => w[0]).join('').toUpperCase()}
                              </span>
                            )}
                          </div>
                          <span className="font-medium whitespace-nowrap">{formatCurrency(shift.total)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {/* Stats Summary - Row 2 */}
              <DailySalesDrilldown
                restaurantId={restaurant?.id}
                dateFrom={filters.dateFrom}
                dateTo={filters.dateTo}
                branchId={salesBranchFilter === "all" ? null : salesBranchFilter}
                includeOpenDays={includeOpenDays}
              />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 rounded-lg border bg-card flex flex-col">
                  <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <Banknote className="h-3.5 w-3.5 text-emerald-600" />
                    {t("app.sales.stats.cashSales", "Cash Sales")}
                    <CardTooltip label="Cash sales">
                      {includeOpenDays
                        ? "Cash payment sales for the fiscal month-to-date, including closed days and the current open day."
                        : "Cash payment sales for closed business days only."}
                    </CardTooltip>
                  </p>
                  <p className="text-xl md:text-2xl font-semibold mt-1 break-all">{formatCurrency(monthSalesView.cash)}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t("app.sales.stats.thisMonth")}</p>
                </div>
                <div className="p-4 rounded-lg border bg-card flex flex-col">
                  <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <CreditCard className="h-3.5 w-3.5 text-primary" />
                    {t("app.sales.stats.cardSales", "Card Sales")}
                    <CardTooltip label="Card sales">
                      {includeOpenDays
                        ? "Card payment sales for the fiscal month-to-date, including closed days and the current open day."
                        : "Card payment sales for closed business days only."}
                    </CardTooltip>
                  </p>
                  <p className="text-xl md:text-2xl font-semibold mt-1 break-all">{formatCurrency(monthSalesView.card)}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t("app.sales.stats.thisMonth")}</p>
                </div>
                <div className="p-4 rounded-lg border bg-card flex flex-col">
                  <p className="text-sm text-muted-foreground flex items-center">
                    {t("app.sales.stats.transactionsToday")}
                    <CardTooltip label="Transactions today">
                      Count of POS transactions recorded for the current business day
                      (11:00 AM – 11:00 AM).
                    </CardTooltip>
                  </p>
                  <p className="text-xl md:text-2xl font-semibold mt-1">{todayCount}</p>
                </div>
                <div className="p-4 rounded-lg border bg-card flex flex-col">
                  <p className="text-sm text-muted-foreground flex items-center">
                    {t("app.sales.stats.openShifts")}
                    <CardTooltip label="Open shifts">
                      Number of active cash-drawer shifts currently open for the
                      selected branch or across all branches.
                    </CardTooltip>
                  </p>
                  <p className="text-xl md:text-2xl font-semibold mt-1">{openShifts.length}</p>
                </div>
              </div>
              {/* Average Sale, Average Expense & Profit Margin (current fiscal month) */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-lg border bg-card flex flex-col">
                  <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <Scale className="h-3.5 w-3.5 text-primary" />
                    {t("app.sales.stats.avgSale", "Average Sale")}
                    <CardTooltip label="Average sale (this month)">
                      Average transaction value for the current fiscal month-to-date (month sales ÷ number of transactions). This is a month figure, not a daily one.
                    </CardTooltip>
                  </p>
                  <p className="text-xl md:text-2xl font-semibold mt-1 break-all">
                    {formatCurrency(monthSalesView.count > 0 ? monthSalesView.total / monthSalesView.count : 0)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {monthSalesView.count > 0
                      ? `${t("app.sales.stats.thisMonth", "This month")} · ${monthSalesView.count} transactions · ${formatCurrency(monthSalesView.total)} total`
                      : `${t("app.sales.stats.thisMonth", "This month")} · no transactions`}
                  </p>
                </div>
                <div className="p-4 rounded-lg border bg-card flex flex-col">
                  <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <Receipt className="h-3.5 w-3.5 text-muted-foreground" />
                    {t("app.sales.stats.avgExpense", "Average Expense")}
                    <CardTooltip label="Average expense (this month)">
                      Average expense value for the current fiscal month-to-date (month expenses ÷ number of expense entries). This is a month figure, not a daily one.
                    </CardTooltip>
                  </p>
                  <p className="text-xl md:text-2xl font-semibold mt-1 break-all">
                    {formatCurrency(thisMonthExpenses.count > 0 ? thisMonthExpenses.total / thisMonthExpenses.count : 0)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {thisMonthExpenses.count > 0
                      ? `${t("app.sales.stats.thisMonth", "This month")} · ${thisMonthExpenses.count} expenses · ${formatCurrency(thisMonthExpenses.total)} total`
                      : `${t("app.sales.stats.thisMonth", "This month")} · no expenses`}
                  </p>
                </div>
                {(() => {
                  const salesM = monthSalesView.total || 0;
                  const expM = thisMonthExpenses.total || 0;
                  const net = salesM - expM;
                  const profitMargin = salesM > 0 ? (net / salesM) * 100 : 0;
                  const positive = net >= 0;
                  return (
                    <div className="p-4 rounded-lg border bg-card flex flex-col">
                      <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                        <TrendingUp className={`h-3.5 w-3.5 ${positive ? "text-emerald-600" : "text-destructive"}`} />
                        {t("app.sales.stats.profitMargin", "Profit Margin")}
                        <CardTooltip label="Profit margin (this month)">
                          {(salesM > 0 ? (net / salesM) * 100 : 0).toFixed(1)}% = (sales − expenses) ÷ sales for the current fiscal month-to-date. Shows how much of each {formatCurrency(1)} of sales remains as profit after expenses.
                        </CardTooltip>
                      </p>
                      <p className={`text-xl md:text-2xl font-semibold mt-1 break-all ${positive ? "text-emerald-600" : "text-destructive"}`}>
                        {profitMargin.toFixed(1)}%
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {salesM > 0
                          ? `${t("app.sales.stats.thisMonth", "This month")} · ${formatCurrency(net)} net · ${formatCurrency(salesM)} sales`
                          : `${t("app.sales.stats.thisMonth", "This month")} · no sales`}
                      </p>
                    </div>
                  );
                })()}
              </div>
              {/* Sales vs Expenses comparison (fiscal month) */}
              {(() => {
                const salesM = monthSalesView.total || 0;
                const expM = thisMonthExpenses.total || 0;
                const net = salesM - expM;
                const positive = net >= 0;
                const ratio = salesM > 0 ? Math.min(100, (expM / salesM) * 100) : 0;
                const margin = salesM > 0 ? (net / salesM) * 100 : 0;
                return (
                  <div className="p-4 rounded-lg border bg-card">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-sm font-medium">{t("app.sales.stats.salesVsExpenses", "Sales vs Expenses")}</p>
                        <p className="text-xs text-muted-foreground">{t("app.sales.stats.thisMonth")} · {includeOpenDays ? "includes open day" : "closed days only"}</p>
                      </div>
                      <div className={`flex items-center gap-1 text-sm font-medium ${positive ? "text-emerald-600" : "text-destructive"}`}>
                        {positive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                        {margin.toFixed(1)}%
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3 mb-3">
                      <div>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <TrendingUp className="h-3 w-3 text-emerald-600" />
                          {t("app.sales.stats.sales", "Sales")}
                          <Popover>
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                aria-label="Sales breakdown details"
                                className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors"
                              >
                                <Info className="h-3 w-3" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent align="start" className="w-[340px] p-0">
                              <div ref={salesDetailRef} className="bg-background">
                              <div className="p-3 border-b">
                                <p className="text-sm font-medium">Sales detail</p>
                                <p className="text-xs text-muted-foreground">
                                  {t("app.sales.stats.thisMonth")} ·{" "}
                                  {includeOpenDays ? "includes open day" : "closed days only"} ·{" "}
                                  {monthSalesView.count} transactions
                                </p>
                              </div>
                              <div className="max-h-[50vh] overflow-y-auto overscroll-contain p-3 space-y-2">

                                {monthSalesView.days.length === 0 ? (
                                  <p className="text-xs text-muted-foreground">No sales in this period.</p>
                                ) : (
                                  monthSalesView.days.map((d) => (
                                    <div key={d.date} className="text-xs border-b last:border-0 pb-2 last:pb-0">
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="font-medium">
                                          {format(parseISO(d.date), "MMM d, yyyy")}
                                        </span>
                                        <span className="font-semibold">{formatCurrency(d.final)}</span>
                                      </div>
                                      <div className="text-[11px] text-muted-foreground mt-0.5 space-y-0.5">
                                        <div className="flex justify-between">
                                          <span>POS transactions</span>
                                          <span>{formatCurrency(d.raw)}</span>
                                        </div>
                                        {d.adjustments !== 0 && (
                                          <div className="flex justify-between">
                                            <span>Day-end adjustments</span>
                                            <span>{formatCurrency(d.adjustments)}</span>
                                          </div>
                                        )}
                                        {d.summary !== null && (
                                          <div className="flex justify-between">
                                            <span>Closed day total (used)</span>
                                            <span>{formatCurrency(d.summary)}</span>
                                          </div>
                                        )}
                                        <div>{d.closed ? "Day closed" : "Day still open"}</div>
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>
                              <div className="p-3 border-t flex items-center justify-between text-xs font-medium">
                                <span>Total</span>
                                <span>{formatCurrency(salesM)}</span>
                              </div>
                              </div>
                              <div className="p-2 border-t flex items-center justify-end gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={async () => {
                                    if (!salesDetailRef.current) return;
                                    try {
                                      const { exportSalesDetailImage } = await import("@/lib/salesDetailExport");
                                      await exportSalesDetailImage(salesDetailRef.current);
                                    } catch {
                                      sonnerToast.error("Could not create the image");
                                    }
                                  }}
                                >
                                  <ImageIcon className="h-3 w-3 mr-1" />
                                  Image
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={async () => {
                                    try {
                                      const { exportSalesDetailPdf } = await import("@/lib/salesDetailExport");
                                      await exportSalesDetailPdf({
                                        title: "Sales detail",
                                        subtitle: `${t("app.sales.stats.thisMonth")} · ${
                                          includeOpenDays ? "includes open days" : "closed days only"
                                        } · ${monthSalesView.count} transactions`,
                                        days: monthSalesView.days,
                                        total: salesM,
                                        money: formatCurrency,
                                      });
                                    } catch {
                                      sonnerToast.error("Could not create the PDF");
                                    }
                                  }}
                                >
                                  <FileText className="h-3 w-3 mr-1" />
                                  PDF
                                </Button>
                              </div>
                            </PopoverContent>
                          </Popover>

                        </p>
                        <p className="text-base md:text-lg font-semibold mt-0.5 break-all">{formatCurrency(salesM)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground flex items-center gap-1"><Wallet className="h-3 w-3 text-destructive" />{t("app.sales.stats.expenses", "Expenses")}</p>
                        <p className="text-base md:text-lg font-semibold mt-0.5 break-all">{formatCurrency(expM)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground flex items-center gap-1"><Scale className="h-3 w-3" />{t("app.sales.stats.net", "Net")}</p>
                        <p className={`text-base md:text-lg font-semibold mt-0.5 break-all ${positive ? "text-emerald-600" : "text-destructive"}`}>{formatCurrency(net)}</p>
                      </div>
                    </div>
                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden flex">
                      <div className="h-full bg-destructive/70" style={{ width: `${ratio}%` }} />
                      <div className="h-full bg-emerald-500/70" style={{ width: `${100 - ratio}%` }} />
                    </div>
                    <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                      <span>{t("app.sales.stats.expenseRatio", "Expense Ratio")}: {ratio.toFixed(1)}%</span>
                      <span>{t("app.sales.stats.profitMargin", "Profit Margin")}: {margin.toFixed(1)}%</span>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Filters */}
            <div className="fade-slide-in" style={{ animationDelay: "100ms" }}>
              {hasMultipleBranches && (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Branch
                  </span>
                  {!canSwitchBranches ? (
                    <div className="inline-flex items-center gap-2 h-9 px-3 rounded-md border border-input bg-muted/40 text-sm">
                      <span className="truncate max-w-[160px]">
                        {branches.find((b) => b.id === pinnedBranchId)?.name ?? "Branch"}
                      </span>
                    </div>
                  ) : (
                    <Select
                      value={salesBranchFilter}
                      onValueChange={(v) => {
                        setSalesBranchFilter(v as string | "all" | "untagged");
                        // Keep every chart on the page (and the header switcher)
                        // on the same active branch. "Untagged" is a table-only
                        // view, so it leaves the global scope untouched.
                        if (v !== "untagged") setActiveBranchId(v as string | "all");
                      }}
                    >
                      <SelectTrigger className="w-[200px] h-9">
                        <SelectValue placeholder="Select branch" />
                      </SelectTrigger>
                      <SelectContent className="z-50 bg-popover">
                        {(isOwner || hasRole("manager")) && (
                          <SelectItem value="all">All branches</SelectItem>
                        )}
                        {branches.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.name}
                          </SelectItem>
                        ))}
                        <SelectItem value="untagged">Untagged</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}
              <SalesFilters
                filters={filters}
                onFiltersChange={handleFiltersChange}
                totalFiltered={transactions.length}
                totalCount={totalCount}
                currency={restaurant?.currency || "SAR"}
                monthStartDay={monthStartDay}
              />
            </div>

            {/* Transactions Table */}
            <div className="fade-slide-in" style={{ animationDelay: "150ms" }}>
          <div className="rounded-lg border bg-card">
            {/* Table Header with Filtered Total */}
            <div className="flex items-center justify-between p-4 border-b">
              <div>
                <h3 className="text-lg font-semibold">{t("app.sales.tabs.transactions")}</h3>
                <p className="text-sm text-muted-foreground">
                  {t("app.sales.stats.transactionsFound", { count: totalCount })}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">{t("app.sales.stats.filteredTotal")}</p>
                <p className="text-xl font-semibold">{formatCurrency(filteredTotal)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("app.sales.stats.paid")}: {formatCurrency(fiscalMonthPaidUnpaid.paidTotal)} • {t("app.sales.stats.unpaid")}: {formatCurrency(fiscalMonthPaidUnpaid.unpaidTotal)}
                </p>
              </div>
            </div>
            {loading ? (
              <div className="flex items-center justify-center h-48">
                <div className="text-muted-foreground">{t("app.sales.table.loading")}</div>
              </div>
            ) : transactions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-center">
                <Receipt className="h-10 w-10 text-muted-foreground mb-3" />
                <p className="text-muted-foreground">{t("app.sales.table.noTransactions")}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[140px]">{t("app.sales.table.receipt")}</TableHead>
                    <TableHead className="w-[100px]">{t("app.sales.table.date")}</TableHead>
                    {hasMultipleBranches && (
                      <TableHead className="w-[120px]">{t("app.sales.table.branch")}</TableHead>
                    )}
                    <TableHead className="min-w-[180px]">{t("app.sales.table.items")}</TableHead>
                    {shiftsEnabled && <TableHead className="w-[120px]">{t("app.sales.table.shift")}</TableHead>}
                    <TableHead className="w-[100px]">{t("app.sales.table.total")}</TableHead>
                    <TableHead className="w-[80px]">{t("app.sales.table.payment")}</TableHead>
                    <TableHead className="w-[120px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((transaction) => {
                    const config = paymentMethodConfig[transaction.payment_method];
                    const items = transaction.sales_items || [];
                    const itemsSummary = items.length > 0 
                      ? items.map(item => `${item.quantity}x ${(item.menu_item as any)?.name || 'Item'}`).join(', ')
                      : null;
                    
                    // Format shift info with times
                    const shiftInfo = transaction.shift ? (() => {
                      const drawerName = (transaction.shift.drawers as any)?.name || 'Drawer';
                      const openedAt = transaction.shift.opened_at ? format(new Date(transaction.shift.opened_at), "HH:mm") : '';
                      const closedAt = transaction.shift.closed_at ? format(new Date(transaction.shift.closed_at), "HH:mm") : 'Active';
                      return { drawerName, timeRange: `${openedAt} → ${closedAt}` };
                    })() : null;

                    const isManualEod = !!transaction.receipt_number?.startsWith("EOD-");
                    const branchName = transaction.branch?.name || null;

                    return (
                      <TableRow key={transaction.id}>
                        <TableCell className="font-mono text-xs">
                          <div className="flex items-center gap-1.5">
                            <span>{transaction.receipt_number || "-"}</span>
                            {isManualEod && (
                              <Badge
                                variant="outline"
                                className="text-[9px] px-1 py-0 border-amber-400 text-amber-700"
                                title={t("app.sales.table.manualEodTitle")}
                              >
                                {t("app.sales.table.manualEod")}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                          {format(new Date(transaction.created_at), "MMM d, HH:mm")}
                        </TableCell>
                        {hasMultipleBranches && (
                          <TableCell>
                            {branchName ? (
                              <BranchBadge
                                name={branchName}
                                branchId={transaction.branch_id ?? null}
                                size="sm"
                              />
                            ) : (
                              <Badge
                                variant="outline"
                                className="text-[10px] border-destructive/40 text-destructive"
                                title={t("app.sales.table.untaggedTitle")}
                              >
                                {t("app.sales.table.untagged")}
                              </Badge>
                            )}
                          </TableCell>
                        )}
                        <TableCell>
                          {itemsSummary ? (
                            <span className="text-sm line-clamp-2" title={itemsSummary}>
                              {itemsSummary}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">{t("app.sales.table.quickSale")}</span>
                          )}
                        </TableCell>
                        {shiftsEnabled && (
                          <TableCell>
                            {shiftInfo ? (
                              <div className="flex flex-col">
                                <Badge variant="outline" className="text-xs w-fit" title={shiftInfo.drawerName}>
                                  {shiftInfo.drawerName.split(' ').map(w => w[0]).join('').toUpperCase()}
                                </Badge>
                                <span className="text-[10px] text-muted-foreground mt-0.5">
                                  {shiftInfo.timeRange}
                                </span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs">-</span>
                            )}
                          </TableCell>
                        )}
                        <TableCell className="font-medium whitespace-nowrap">
                          {formatCurrency(transaction.total)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Badge variant="secondary" className={config.color}>
                              {t(`app.sales.paymentMethods.${transaction.payment_method}`)}
                            </Badge>
                            {transaction.settlement_status === "unpaid" && (
                              <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                                {t("app.sales.table.unpaid")}
                              </Badge>
                            )}
                            {(transaction.settlement_status === "paid" ||
                              transaction.settlement_status === "settled") && (
                              <Badge
                                variant="secondary"
                                className="text-[10px] px-1.5 py-0 bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
                              >
                                {t("app.sales.table.paid")}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8"
                              onClick={() => openViewDetailsDialog(transaction)}
                              title={t("app.sales.actions.viewDetails")}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            {isOwner && (
                              <>
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  className="h-8 w-8"
                                  onClick={() => openEditDialog(transaction)}
                                  title={t("app.sales.actions.editSale")}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                {shiftsEnabled && (
                                  <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="h-8 w-8"
                                    onClick={() => openReassignShiftDialog(transaction)}
                                    title={t("app.sales.actions.reassignShift")}
                                  >
                                    <ArrowRightLeft className="h-4 w-4" />
                                  </Button>
                                )}
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive">
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>{t("app.sales.delete.title")}</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        {t("app.sales.delete.desc", { receipt: transaction.receipt_number })}
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>{t("app.sales.actions.cancel")}</AlertDialogCancel>
                                      <AlertDialogAction 
                                        onClick={() => handleDeleteSale(transaction.id)}
                                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                      >
                                        {t("app.sales.actions.delete")}
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              </div>
            )}

            {/* Pagination */}
            {totalCount > 0 && (
              <div className="p-4 border-t">
                <ExpensePagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  pageSize={pageSize}
                  totalItems={totalCount}
                  onPageChange={setCurrentPage}
                  onPageSizeChange={handlePageSizeChange}
                />
              </div>
            )}
          </div>
        </div>
          </TabsContent>

          <TabsContent value="breakdown" className="mt-6">
            <SalesBreakdown />
          </TabsContent>

          <TabsContent value="dayend" className="mt-6">
            <div className="space-y-6">
              <DailySalesRecorder />
              <DayEndAdjustmentBreakdown
                restaurantId={restaurant?.id}
                dateFrom={filters.dateFrom}
                dateTo={filters.dateTo}
              />
            </div>
          </TabsContent>
        </Tabs>

        {/* Edit Sale Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={(open) => {
          setEditDialogOpen(open);
          if (!open) {
            setEditingTransaction(null);
            resetForm();
          }
        }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t("app.sales.edit.title")}</DialogTitle>
              <DialogDescription>{t("app.sales.edit.desc", { receipt: editingTransaction?.receipt_number })}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Gross price, VAT inclusive ({restaurant?.currency || "SAR"})</Label>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={subtotal}
                  onChange={(e) => setSubtotal(e.target.value)}
                  min="0"
                  step="0.01"
                />
              </div>

              <div className="space-y-2">
                <Label>{t("app.sales.edit.taxRate")}</Label>
                <Input
                  type="number"
                  placeholder="15"
                  value={taxRate}
                  onChange={(e) => setTaxRate(e.target.value)}
                  min="0"
                  max="100"
                />
              </div>

              <div className="space-y-2">
                <Label>{t("app.sales.edit.paymentMethod")}</Label>
                <div className="flex gap-2">
                  {(["cash", "card", "other"] as const).map((method) => {
                    const config = paymentMethodConfig[method];
                    return (
                      <Button
                        key={method}
                        type="button"
                        variant={paymentMethod === method ? "default" : "outline"}
                        className="flex-1 gap-2"
                        onClick={() => setPaymentMethod(method)}
                      >
                        <config.icon className="h-4 w-4" />
                        {t(`app.sales.paymentMethods.${method}`)}
                      </Button>
                    );
                  })}
                </div>
              </div>

              <div className="border-t pt-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Net</span>
                  <span>{netSubtotal.toFixed(2)} {restaurant?.currency || "SAR"}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t("app.sales.edit.taxWithRate", { rate: taxRate })}</span>
                  <span>{tax.toFixed(2)} {restaurant?.currency || "SAR"}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>{t("app.sales.edit.total")}</span>
                  <span>{total.toFixed(2)} {restaurant?.currency || "SAR"}</span>
                </div>
              </div>

              <Button 
                className="w-full" 
                onClick={handleUpdateSale}
                disabled={submitting || !subtotal}
              >
                {submitting ? t("app.sales.edit.updating") : t("app.sales.edit.updateSale")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Reassign Shift Dialog */}
        <Dialog open={reassignShiftDialogOpen} onOpenChange={(open) => {
          setReassignShiftDialogOpen(open);
          if (!open) {
            setReassigningTransaction(null);
            setSelectedReassignShift("");
          }
        }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t("app.sales.reassign.title")}</DialogTitle>
              <DialogDescription>{t("app.sales.reassign.desc", { receipt: reassigningTransaction?.receipt_number })}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>{t("app.sales.reassign.currentShift")}</Label>
                <div className="p-3 bg-muted rounded-lg text-sm">
                  {reassigningTransaction?.shift ? (
                    <span>{(reassigningTransaction.shift.drawers as any)?.name || t("app.sales.table.drawer")}</span>
                  ) : (
                    <span className="text-muted-foreground">{t("app.sales.reassign.noShiftAssigned")}</span>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t("app.sales.reassign.newShift")}</Label>
                <Select value={selectedReassignShift} onValueChange={setSelectedReassignShift}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("app.sales.reassign.selectShift")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("app.sales.reassign.noShift")}</SelectItem>
                    {allShifts.map((shift) => (
                      <SelectItem key={shift.id} value={shift.id}>
                        {(shift.drawers as any)?.name || t("app.sales.table.drawer")} - {format(new Date(shift.opened_at), "MMM d, HH:mm")}
                        {shift.closed_at ? ` → ${format(new Date(shift.closed_at), "MMM d, HH:mm")}` : ""}
                        {shift.closed_at ? ` (${t("app.sales.reassign.shiftClosedSuffix")})` : ` (${t("app.sales.reassign.shiftActiveSuffix")})`}
                        {(shift.staff as any)?.name ? ` - ${(shift.staff as any).name}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button 
                className="w-full" 
                onClick={handleReassignShift}
                disabled={submitting}
              >
                {submitting ? t("app.sales.reassign.reassigning") : t("app.sales.reassign.reassignBtn")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* View Details Dialog */}
        <Dialog open={viewDetailsDialogOpen} onOpenChange={(open) => {
          setViewDetailsDialogOpen(open);
          if (!open) {
            setViewingTransaction(null);
          }
        }}>
          <DialogContent className="sm:max-w-lg h-[85vh] max-h-[720px] flex flex-col overflow-hidden p-0">
            <div className="shrink-0 bg-background z-10 px-6 pt-6 pb-2 border-b relative">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Receipt className="h-5 w-5" />
                  {t("app.sales.details.title")}
                </DialogTitle>
                <DialogDescription>
                  {viewingTransaction?.receipt_number || t("app.sales.details.saleDetails")}
                </DialogDescription>
              </DialogHeader>
              {viewingTransaction && (() => {
                const anchors: { id: string; label: string; show: boolean }[] = [
                  {
                    id: "section-items",
                    label: t("app.sales.details.anchors.items"),
                    show: !!viewingTransaction.sales_items?.length,
                  },
                  {
                    id: "section-payment-history",
                    label: t("app.sales.details.anchors.payments"),
                    show: !!viewingTransaction.settlement_invoice_id,
                  },
                  {
                    id: "section-customer-history",
                    label: t("app.sales.details.anchors.customerHistory"),
                    show:
                      viewingTransaction.settlement_status === "unpaid" &&
                      !!viewingTransaction.customer_id,
                  },
                  {
                    id: "section-settlement-breakdown",
                    label: t("app.sales.details.anchors.breakdown"),
                    show:
                      viewingTransaction.settlement_status === "unpaid" &&
                      !!viewingTransaction.customer_id,
                  },
                ];
                const visible = anchors.filter((a) => a.show);
                if (visible.length < 2) return null;
                const jumpTo = (id: string) => {
                  const root = detailsScrollRef.current;
                  if (!root) return;
                  const el = root.querySelector<HTMLElement>(`#${id}`);
                  if (!el) return;
                  const top = el.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - 8;
                  root.scrollTo({ top, behavior: "smooth" });
                };
                return (
                  <div className="flex flex-wrap gap-1.5 mt-2 -mb-1">
                    {visible.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => jumpTo(a.id)}
                        className="text-[11px] px-2 py-0.5 rounded-full border bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                );
              })()}
              <div
                aria-hidden
                className="absolute left-0 bottom-0 h-0.5 bg-primary/70 transition-[width] duration-150 ease-out"
                style={{ width: `${scrollProgress * 100}%` }}
              />
            </div>
            {viewingTransaction && (
              <div className="relative flex-1 min-h-0">
                <div
                  ref={detailsScrollRef}
                  className="dialog-visible-scrollbar h-full overflow-y-auto overflow-x-hidden overscroll-contain px-6 py-2"
                >
                  <div className="space-y-4">
                {/* Basic Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">{t("app.sales.details.receiptNumber")}</p>
                    <p className="font-mono text-sm font-medium">{viewingTransaction.receipt_number || "-"}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">{t("app.sales.details.dateTime")}</p>
                    <p className="text-sm font-medium">{format(new Date(viewingTransaction.created_at), "MMM d, yyyy HH:mm")}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">{t("app.sales.details.branch")}</p>
                    {viewingTransaction.branch ? (
                      <BranchBadge
                        name={viewingTransaction.branch.name}
                        branchId={viewingTransaction.branch_id ?? null}
                        size="sm"
                      />
                    ) : (
                      <Badge variant="outline" className="text-xs border-destructive/40 text-destructive">
                        {t("app.sales.table.untagged")}
                      </Badge>
                    )}
                  </div>
                  {viewingTransaction.receipt_number?.startsWith("EOD-") && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">{t("app.sales.details.entrySource")}</p>
                      <Badge
                        variant="outline"
                        className="text-xs border-amber-400 text-amber-700"
                      >
                        {t("app.sales.details.manualEodSummary")}
                      </Badge>
                    </div>
                  )}
                </div>

                {/* Payment Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">{t("app.sales.details.paymentMethod")}</p>
                    <Badge variant="secondary" className={paymentMethodConfig[viewingTransaction.payment_method].color}>
                      {t(`app.sales.paymentMethods.${viewingTransaction.payment_method}`)}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">{t("app.sales.details.shift")}</p>
                    {viewingTransaction.shift ? (
                      <div>
                        <Badge variant="outline" className="text-xs">
                          {(viewingTransaction.shift.drawers as any)?.name || t("app.sales.table.drawer")}
                        </Badge>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {viewingTransaction.shift.opened_at && format(new Date(viewingTransaction.shift.opened_at), "HH:mm")}
                          {" → "}
                          {viewingTransaction.shift.closed_at ? format(new Date(viewingTransaction.shift.closed_at), "HH:mm") : t("app.sales.table.active")}
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">{t("app.sales.details.noShift")}</p>
                    )}
                  </div>
                </div>

                {/* Items List */}
                {viewingTransaction.sales_items && viewingTransaction.sales_items.length > 0 && (
                  <div id="section-items" className="space-y-2 scroll-mt-2">
                    <p className="text-xs text-muted-foreground font-medium">{t("app.sales.details.itemsSold")}</p>
                    <div className="border rounded-lg divide-y">
                      {viewingTransaction.sales_items.map((item) => (
                        <div key={item.id} className="flex items-center justify-between p-3">
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                              <span className="text-xs font-semibold text-primary">{item.quantity}x</span>
                            </div>
                            <div>
                              <p className="text-sm font-medium">{(item.menu_item as any)?.name || t("app.sales.details.item")}</p>
                              {(item.menu_item as any)?.category && (
                                <p className="text-xs text-muted-foreground">{(item.menu_item as any).category}</p>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-medium">{item.total_price.toFixed(2)} {restaurant?.currency || "SAR"}</p>
                            <p className="text-xs text-muted-foreground">{item.unit_price.toFixed(2)} {t("app.sales.details.each")}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Totals */}
                <div className="border-t pt-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t("app.sales.details.subtotal")}</span>
                    <span>{viewingTransaction.subtotal.toFixed(2)} {restaurant?.currency || "SAR"}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t("app.sales.details.tax")}</span>
                    <span>{viewingTransaction.tax.toFixed(2)} {restaurant?.currency || "SAR"}</span>
                  </div>
                  <div className="flex justify-between font-semibold text-lg pt-2 border-t">
                    <span>{t("app.sales.details.total")}</span>
                    <span className="text-primary">{viewingTransaction.total.toFixed(2)} {restaurant?.currency || "SAR"}</span>
                  </div>
                </div>

                {/* Notes - unpaid attribution */}
                {viewingTransaction.settlement_status === "unpaid" && (
                  <div className="border-t pt-4 space-y-1">
                    <p className="text-xs text-muted-foreground font-medium">{t("app.sales.details.notes")}</p>
                    <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 p-3 space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="destructive" className="text-[10px]">{t("app.sales.details.unpaid")}</Badge>
                        <span className="text-sm font-medium">
                          {t("app.sales.details.owedBy", { name: viewingTransaction.customer?.name || t("app.sales.details.unknownCustomer") })}
                        </span>
                      </div>
                      {viewingTransaction.customer?.phone && (
                        <p className="text-xs text-muted-foreground pl-1">
                          {viewingTransaction.customer.phone}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground pl-1">
                        {t("app.sales.details.outstanding")}{" "}
                        <span className="font-semibold text-amber-700 dark:text-amber-400">
                          {(viewingTransaction.total - (viewingTransaction.paid_amount || 0)).toFixed(2)} {restaurant?.currency || "SAR"}
                        </span>
                        {!!viewingTransaction.paid_amount && viewingTransaction.paid_amount > 0 && (
                          <span className="text-muted-foreground">
                            {" "}{t("app.sales.details.paidAmount", { amount: viewingTransaction.paid_amount.toFixed(2) })}
                          </span>
                        )}
                      </p>
                      {viewingTransaction.customer && (
                        <p className="text-xs text-muted-foreground pl-1">
                          {t("app.sales.details.totalOwedByCustomer")}{" "}
                          <span className="font-semibold text-amber-700 dark:text-amber-400">
                            {(Number(viewingTransaction.customer.current_balance) || 0).toFixed(2)} {restaurant?.currency || "SAR"}
                          </span>
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Payment history */}
                {viewingTransaction.settlement_invoice_id && (
                  <div id="section-payment-history" className="border-t pt-4 space-y-2 scroll-mt-2">
                    <p className="text-xs text-muted-foreground font-medium">{t("app.sales.details.paymentHistory")}</p>
                    {paymentHistoryLoading ? (
                      <p className="text-xs text-muted-foreground">{t("app.sales.details.loadingDots")}</p>
                    ) : paymentHistory.length === 0 ? (
                      <p className="text-xs text-muted-foreground">{t("app.sales.details.noPaymentsYet")}</p>
                    ) : (
                      <div className="border rounded-lg divide-y">
                        {paymentHistory.map((p: any) => (
                          <div key={p.id} className="flex items-center justify-between p-2.5 text-sm">
                            <div className="space-y-0.5">
                              <p className="font-medium capitalize">{(p.payment_method || "").replace(/_/g, " ")}</p>
                              <p className="text-[11px] text-muted-foreground">
                                {format(new Date(p.created_at), "MMM d, yyyy HH:mm")}
                                {p.payment_reference ? ` · ${p.payment_reference}` : ""}
                              </p>
                              {p.notes && (
                                <p className="text-[11px] text-muted-foreground italic">{p.notes}</p>
                              )}
                            </div>
                            <span className="font-semibold text-emerald-600">
                              {Number(p.amount).toFixed(2)} {restaurant?.currency || "SAR"}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Customer-wide payment history (unpaid only) */}
                {viewingTransaction.settlement_status === "unpaid" &&
                  viewingTransaction.customer_id && (
                    <div id="section-customer-history" className="border-t pt-4 space-y-2 scroll-mt-2">
                      <p className="text-xs text-muted-foreground font-medium">
                        {t("app.sales.details.customerPaymentHistory")}
                        {viewingTransaction.customer?.name
                          ? ` - ${viewingTransaction.customer.name}`
                          : ""}
                      </p>
                      {customerPaymentHistoryLoading ? (
                        <p className="text-xs text-muted-foreground">{t("app.sales.details.loadingDots")}</p>
                      ) : customerPaymentHistory.length === 0 ? (
                        <p className="text-xs text-muted-foreground">{t("app.sales.details.noPaymentsYet")}</p>
                      ) : (
                        (() => {
                          const renderRow = (e: any) => {
                            const isCredit =
                              e.kind === "payment" ||
                              e.method === "credit" ||
                              e.method === "write_off";
                            return (
                              <div
                                className="flex items-start justify-between p-2.5 text-sm gap-3 border-b last:border-b-0"
                              >
                                <div className="space-y-0.5 min-w-0">
                                  <p className="font-medium capitalize truncate">
                                    {e.label}
                                  </p>
                                  <p className="text-[11px] text-muted-foreground">
                                    {format(
                                      new Date(e.created_at),
                                      "MMM d, yyyy HH:mm"
                                    )}
                                    {e.reference ? ` · ${e.reference}` : ""}
                                  </p>
                                  {e.notes && (
                                    <p className="text-[11px] text-muted-foreground italic line-clamp-2">
                                      {e.notes}
                                    </p>
                                  )}
                                </div>
                                <span
                                  className={
                                    isCredit
                                      ? "font-semibold text-emerald-600 whitespace-nowrap"
                                      : "font-semibold text-amber-600 whitespace-nowrap"
                                  }
                                >
                                  {isCredit ? "−" : "+"}
                                  {e.amount.toFixed(2)} {restaurant?.currency || "SAR"}
                                </span>
                              </div>
                            );
                          };
                          return customerPaymentHistory.length > 20 ? (
                            <VirtualizedList
                              items={customerPaymentHistory}
                              estimateSize={72}
                              className="border rounded-lg max-h-64"
                              itemKey={(e: any) => e.id}
                              renderItem={(e) => renderRow(e)}
                            />
                          ) : (
                            <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
                              {customerPaymentHistory.map((e: any) => (
                                <div key={e.id}>{renderRow(e)}</div>
                              ))}
                            </div>
                          );
                        })()
                      )}
                    </div>
                  )}

                {/* Settlement breakdown by invoice */}
                {viewingTransaction.settlement_status === "unpaid" &&
                  viewingTransaction.customer_id && (
                    <div id="section-settlement-breakdown" className="border-t pt-4 space-y-2 scroll-mt-2">
                      <p className="text-xs text-muted-foreground font-medium">
                        Settlement Breakdown by Invoice
                      </p>
                      {settlementBreakdownLoading ? (
                        <p className="text-xs text-muted-foreground">Loading…</p>
                      ) : settlementBreakdown.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          No settlement invoices generated for this customer yet.
                        </p>
                      ) : (
                        (() => {
                          const renderInvoice = (inv: any) => {
                            const total = Number(inv.total_amount) || 0;
                            const paid = Number(inv.amount_paid) || 0;
                            const remaining = Math.max(0, total - paid);
                            const payments = (inv.settlement_payments || []) as any[];
                            const isCurrent =
                              inv.id === viewingTransaction.settlement_invoice_id;
                            return (
                              <div
                                className={`rounded-lg border p-2.5 space-y-2 ${
                                  isCurrent ? "border-primary/50 bg-primary/5" : ""
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium font-mono truncate">
                                      {inv.invoice_number}
                                      {isCurrent && (
                                        <Badge
                                          variant="secondary"
                                          className="ml-2 text-[10px]"
                                        >
                                          this receipt
                                        </Badge>
                                      )}
                                    </p>
                                    <p className="text-[11px] text-muted-foreground">
                                      {format(
                                        new Date(inv.billing_period_start),
                                        "MMM d"
                                      )}{" "}
                                      –{" "}
                                      {format(
                                        new Date(inv.billing_period_end),
                                        "MMM d, yyyy"
                                      )}{" "}
                                      · {String(inv.status).replace(/_/g, " ")}
                                    </p>
                                  </div>
                                  <div className="text-right whitespace-nowrap">
                                    <p className="text-sm font-semibold">
                                      {paid.toFixed(2)} / {total.toFixed(2)}{" "}
                                      {restaurant?.currency || "SAR"}
                                    </p>
                                    {remaining > 0 ? (
                                      <p className="text-[11px] text-amber-600">
                                        {remaining.toFixed(2)} due
                                      </p>
                                    ) : (
                                      <p className="text-[11px] text-emerald-600">
                                        Fully paid
                                      </p>
                                    )}
                                  </div>
                                </div>

                                {/* progress bar */}
                                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-emerald-500 transition-all"
                                    style={{
                                      width: `${
                                        total > 0
                                          ? Math.min(100, (paid / total) * 100)
                                          : 0
                                      }%`,
                                    }}
                                  />
                                </div>

                                {/* payment applications */}
                                {payments.length === 0 ? (
                                  <p className="text-[11px] text-muted-foreground italic">
                                    No payments applied yet.
                                  </p>
                                ) : (
                                  <div className="border-t pt-2 space-y-1">
                                    {payments
                                      .slice()
                                      .sort(
                                        (a, b) =>
                                          new Date(b.created_at).getTime() -
                                          new Date(a.created_at).getTime()
                                      )
                                      .map((p) => (
                                        <div
                                          key={p.id}
                                          className="flex items-center justify-between text-[12px] gap-3"
                                        >
                                          <div className="min-w-0">
                                            <span className="capitalize font-medium">
                                              {String(p.payment_method).replace(
                                                /_/g,
                                                " "
                                              )}
                                            </span>
                                            <span className="text-muted-foreground">
                                              {" · "}
                                              {format(
                                                new Date(p.created_at),
                                                "MMM d, HH:mm"
                                              )}
                                              {p.payment_reference
                                                ? ` · ${p.payment_reference}`
                                                : ""}
                                            </span>
                                          </div>
                                          <span className="font-semibold text-emerald-600 whitespace-nowrap">
                                            −{Number(p.amount).toFixed(2)}{" "}
                                            {restaurant?.currency || "SAR"}
                                          </span>
                                        </div>
                                      ))}
                                  </div>
                                )}
                              </div>
                            );
                          };
                          return settlementBreakdown.length > 15 ? (
                            <VirtualizedList
                              items={settlementBreakdown}
                              estimateSize={140}
                              className="max-h-80 pr-1"
                              itemKey={(inv: any) => inv.id}
                              renderItem={(inv) => (
                                <div className="pb-2">{renderInvoice(inv)}</div>
                              )}
                            />
                          ) : (
                            <div className="space-y-2">
                              {settlementBreakdown.map((inv: any) => (
                                <div key={inv.id}>{renderInvoice(inv)}</div>
                              ))}
                            </div>
                          );
                        })()
                      )}
                    </div>
                  )}
                </div>
                </div>
                {showScrollTop && (
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    aria-label="Scroll to top"
                    onClick={() =>
                      detailsScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })
                    }
                    className="absolute bottom-4 right-4 h-9 w-9 rounded-full shadow-lg border bg-background/95 backdrop-blur hover:bg-background animate-in fade-in slide-in-from-bottom-2 duration-200"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
