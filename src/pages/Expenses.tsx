import { Fragment, useState, useRef, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Folder,
  TrendingDown,
  TrendingUp,
  Wallet,
  Calendar,
  Edit2,
  Trash2,
  Upload,
  Download,
  FileSpreadsheet,
  FileDown,
  Image,
  ChevronDown,
  ChevronUp,
  Clock,
  CheckCircle2,
  X,
  Copy,
  History,
  ArrowRightLeft,
} from "lucide-react";
import { Link as RouterLink } from "react-router-dom";
import { Link2 } from "lucide-react";
import { ChevronRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { exportToCSV, prepareExpensesExportData } from "@/lib/exportUtils";
import { useAuth } from "@/contexts/AuthContext";
import { useFeatureFlag } from "@/hooks/useFeatureFlags";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format, subDays, startOfMonth, endOfMonth } from "date-fns";
import {
  ExpenseFilters,
  ExpenseFiltersState,
} from "@/components/expenses/ExpenseFilters";
import { ExpensePagination } from "@/components/expenses/ExpensePagination";
import { CumulativeExpenseChart } from "@/components/expenses/CumulativeExpenseChart";
import { DailyExpenseBarChart } from "@/components/expenses/DailyExpenseBarChart";
import { BranchSpendingTrendChart } from "@/components/expenses/BranchSpendingTrendChart";
import { SalesReconciliationCard } from "@/components/expenses/SalesReconciliationCard";
import { useCurrency } from "@/hooks/useCurrency";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import {
  useFiscalSettings,
  getFiscalMonthRange,
} from "@/hooks/useFiscalSettings";
import {
  ReceiptUploader,
  ReceiptThumbnail,
} from "@/components/expenses/ReceiptUploader";
import { RecordExpenseDialog } from "@/components/expenses/RecordExpenseDialog";
import { ExpenseApprovalQueue } from "@/components/expenses/ExpenseApprovalQueue";
import { ExpenseStatusField } from "@/components/expenses/ExpenseStatusField";
import { getPaymentMethodStatusWarning } from "@/lib/expensePaymentValidation";
import { DayEndAdjustmentDialog } from "@/components/dayend/DayEndAdjustmentDialog";
import { DayEndAdjustmentsList } from "@/components/dayend/DayEndAdjustmentsList";
import { Scale } from "lucide-react";
import { KitchenPurchaseDialog } from "@/components/expenses/KitchenPurchaseDialog";
import { MappingGapsPanel } from "@/components/expenses/MappingGapsPanel";
import { PendingVatSplitPanel } from "@/components/expenses/PendingVatSplitPanel";
import { ExpensePostingStatusPanel } from "@/components/expenses/ExpensePostingStatusPanel";
import { ExpenseAmendmentAuditPanel } from "@/components/expenses/ExpenseAmendmentAuditPanel";

import { AmendPostedExpenseDialog, type AmendPayload } from "@/components/expenses/AmendPostedExpenseDialog";
import {
  getMaterialExpenseChanges,
  requiresLedgerAdjustment,
  type MaterialChange,
} from "@/lib/postedExpenseGuard";
import { VerifyPostingDialog } from "@/components/expenses/VerifyPostingDialog";
import { ExpenseCoAAuditDialog } from "@/components/expenses/ExpenseCoAAuditDialog";
import { mirrorExpenseToInvoice } from "@/hooks/useExpenseApproval";
import { Building2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  ExpenseLineItemsEditor,
  ExpenseLineItem,
  makeEmptyLine,
} from "@/components/expenses/ExpenseLineItemsEditor";
import { ListPlus } from "lucide-react";
import { QuickAddInventoryItemDialog } from "@/components/expenses/QuickAddInventoryItemDialog";
import { fetchReconciledSalesByDay } from "@/lib/reconciledSales";
import { CopyToBranchDialog } from "@/components/shared/CopyToBranchDialog";
import { BulkCopyToBranchDialog } from "@/components/shared/BulkCopyToBranchDialog";
import { ExpenseSettlementTimeline } from "@/components/expenses/ExpenseSettlementTimeline";
import { ExpenseClosureChecklist } from "@/components/expenses/ExpenseClosureChecklist";
import { LedgerValidationAlert } from "@/components/expenses/LedgerValidationAlert";
import {
  parseLedgerValidationError,
  type ParsedLedgerValidationError,
} from "@/lib/ledgerValidationError";
import { ApSettlementReversalDialog } from "@/components/expenses/ApSettlementReversalDialog";
import { ApSettlementPostingPreview } from "@/components/expenses/ApSettlementPostingPreview";
import { BulkApSettlementPreviewDialog } from "@/components/expenses/BulkApSettlementPreviewDialog";
import { useBranch } from "@/contexts/BranchContext";
import { BranchBadge } from "@/components/branch/BranchBadge";
import { AiExpenseJournalButton } from "@/components/expenses/AiExpenseJournalButton";
import { ReverseExpenseVatDialog } from "@/components/expenses/ReverseExpenseVatDialog";
import { correctedExpenseTotals } from "@/lib/accountantCorrections";

interface ExpenseCategory {
  id: string;
  name: string;
  color: string | null;
  account_id?: string | null;
  branch_id?: string | null;
}

interface Expense {
  id: string;
  amount: number;
  description: string | null;
  expense_date: string;
  category_id: string | null;
  created_at: string;
  receipt_url: string | null;
  status: "paid" | "unpaid";
  paid_amount?: number;
  account_id?: string | null;
  supplier_id?: string | null;
  purchase_invoice_id?: string | null;
  is_inventory_item?: boolean;
  inventory_item_id?: string | null;
  quantity?: number | null;
  branch_id?: string | null;
  payment_method?: string | null;
  ledger_posted?: boolean;
  vat_amount?: number | null;
  expense_categories?: ExpenseCategory | null;
}

export default function Expenses() {
  const {
    user,
    restaurant,
    isManager,
    isOwner,
    isAccountant,
    profile,
    hasRole,
    roles,
  } = useAuth();
  const {
    activeBranchId,
    hasMultipleBranches,
    branches,
    canSwitchBranches,
    pinnedBranchId,
    setActiveBranchId,
  } = useBranch();
  const branchNameById = useMemo(
    () =>
      Object.fromEntries(branches.map((b) => [b.id, b.name])) as Record<
        string,
        string
      >,
    [branches]
  );
  const { t } = useTranslation();
  const tenantId = profile?.tenant_id;
  const [searchParams, setSearchParams] = useSearchParams();
  const { format: formatCurrency } = useCurrency();
  const { monthStartDay } = useFiscalSettings();
  const queryClient = useQueryClient();
  const canMarkExpensesPaid = isManager || hasRole("accountant");
  // Reversing a POSTED settlement is stricter than marking an expense paid:
  // only owners / accountants (mirrored by the DB role guard).
  const canReverseSettlement =
    isOwner || isAccountant || roles.some((r) => r.role === "superadmin");
  const [reversalTarget, setReversalTarget] = useState<Expense | null>(null);
  const [vatReversalTarget, setVatReversalTarget] = useState<Expense | null>(null);
  const [isExpenseOpen, setIsExpenseOpen] = useState(false);
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  const [isKitchenPurchaseOpen, setIsKitchenPurchaseOpen] = useState(false);
  const [isDayEndAdjOpen, setIsDayEndAdjOpen] = useState(false);
  const [quickAddCategoryId, setQuickAddCategoryId] = useState<string | null>(
    null
  );
  const [editQuickAddItemOpen, setEditQuickAddItemOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [expenseDate, setExpenseDate] = useState(
    format(new Date(), "yyyy-MM-dd")
  );
  const [expenseStatus, setExpenseStatus] = useState<"paid" | "unpaid">("paid");
  const [paidAmount, setPaidAmount] = useState<string>("");
  // Exact ledger validation rule that rejected the last settlement attempt.
  const [ledgerError, setLedgerError] =
    useState<ParsedLedgerValidationError | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [categoryColor, setCategoryColor] = useState("#3B9A8C");
  const [categoryAccountId, setCategoryAccountId] = useState<string>("");
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [expenseAccountId, setExpenseAccountId] = useState<string>("");
  const [isReceiptUploading, setIsReceiptUploading] = useState(false);
  const [supplierId, setSupplierId] = useState<string>("");
  // Itemized invoice mode for Edit Expense
  const [editItemizedMode, setEditItemizedMode] = useState(false);
  // Remote feature flag — admins can toggle this from /admin/feature-flags.
  // Defaults to true so existing behavior is preserved if the flag isn't created.
  const itemizedInvoicesEnabled = useFeatureFlag("itemized_invoices", true);
  const [editLineItems, setEditLineItems] = useState<ExpenseLineItem[]>([]);
  // Snapshot of the line items as they existed when the dialog opened.
  // Used to compute per-item stock deltas on save so inventory stays in sync.
  const [editOriginalLines, setEditOriginalLines] = useState<
    Array<{ inventory_item_id: string; quantity: number; unit_cost: number }>
  >([]);
  const editComputedTotal = useMemo(
    () =>
      editLineItems.reduce(
        (sum, li) =>
          sum +
          (parseFloat(li.quantity) || 0) * (parseFloat(li.unit_cost) || 0),
        0
      ),
    [editLineItems]
  );

  // Edit states
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  // Posted expenses require an adjusting journal entry before they can change.
  const [amendOpen, setAmendOpen] = useState(false);
  const [amendChanges, setAmendChanges] = useState<MaterialChange[]>([]);
  const [amendPayload, setAmendPayload] = useState<AmendPayload | null>(null);
  const [editingCategory, setEditingCategory] =
    useState<ExpenseCategory | null>(null);
  const [copyCategorySource, setCopyCategorySource] =
    useState<ExpenseCategory | null>(null);
  const [bulkCopyCategoriesOpen, setBulkCopyCategoriesOpen] = useState(false);
  const [bulkCopyCategoriesAllOpen, setBulkCopyCategoriesAllOpen] =
    useState(false);
  const [deletingExpense, setDeletingExpense] = useState<Expense | null>(null);
  const [timelineExpense, setTimelineExpense] = useState<Expense | null>(null);
  const [expandedLedgerIds, setExpandedLedgerIds] = useState<Set<string>>(
    new Set()
  );
  const [verifyPostingOpen, setVerifyPostingOpen] = useState(false);
  const toggleLedgerRow = (id: string) =>
    setExpandedLedgerIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const [isCSVUploadOpen, setIsCSVUploadOpen] = useState(false);
  const [csvData, setCsvData] = useState<
    Array<{
      date: string;
      amount: string;
      category: string;
      description: string;
    }>
  >([]);
  const [isUploading, setIsUploading] = useState(false);
  const [csvPreviewExpanded, setCsvPreviewExpanded] = useState(false);
  const [isCoAAuditOpen, setIsCoAAuditOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Multi-selection state
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<Set<string>>(
    new Set()
  );
  const [bulkPreviewOpen, setBulkPreviewOpen] = useState(false);
  const [bulkPaymentAccountId, setBulkPaymentAccountId] = useState<string | null>(null);
  const { accounts: chartAccounts } = useChartOfAccounts();

  // Filters and pagination state
  const [filters, setFilters] = useState<ExpenseFiltersState>({
    search: "",
    categoryId: "",
    branchId: "",
    supplierId: "",
    dateFrom: "",
    dateTo: "",
    amountMin: "",
    amountMax: "",
    status: "",
    sortBy: "expense_date",
    sortOrder: "desc",
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Branch scope: page-level branch filter overrides the global active branch
  const selectedBranchFilter =
    filters.branchId && filters.branchId !== "all" ? filters.branchId : null;
  const globalBranchId =
    activeBranchId && activeBranchId !== "all" ? activeBranchId : null;
  const branchScope = selectedBranchFilter ?? globalBranchId;
  const branchUnassignedOnly = branchScope === "unassigned";
  const branchFilterId = branchUnassignedOnly ? null : branchScope;
  const applyBranchScope = <T extends { eq: any; is: any }>(query: T): T => {
    if (branchUnassignedOnly) return query.is("branch_id", null) as T;
    if (branchFilterId) return query.eq("branch_id", branchFilterId) as T;
    return query;
  };
  const [filtersInitialized, setFiltersInitialized] = useState(false);

  // Initialize filters based on fiscal month settings once loaded
  useEffect(() => {
    if (!filtersInitialized && monthStartDay) {
      const fiscalMonth = getFiscalMonthRange(new Date(), monthStartDay);
      setFilters((prev) => ({
        ...prev,
        dateFrom: format(fiscalMonth.start, "yyyy-MM-dd"),
        dateTo: format(fiscalMonth.end, "yyyy-MM-dd"),
      }));
      setFiltersInitialized(true);
    }
  }, [monthStartDay, filtersInitialized]);

  // Fetch categories
  const { data: categories = [] } = useQuery({
    queryKey: ["expense-categories", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await supabase
        .from("expense_categories")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .order("name");
      if (error) throw error;
      return data as ExpenseCategory[];
    },
    enabled: !!restaurant?.id,
  });

  // Fetch expense accounts (Chart of Accounts) for the per-category mapping picker
  const { data: expenseAccounts = [] } = useQuery({
    queryKey: ["expense-accounts-categories", tenantId],
    queryFn: async () => {
      if (!tenantId)
        return [] as Array<{
          id: string;
          account_code: string;
          account_name: string;
        }>;
      const { data, error } = await supabase
        .from("chart_of_accounts")
        .select("id, account_code, account_name")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .eq("account_type", "expense")
        .order("account_code");
      if (error) throw error;
      return data as Array<{
        id: string;
        account_code: string;
        account_name: string;
      }>;
    },
    enabled: !!tenantId,
  });

  // All postable accounts (COGS + Expense) - used by the Edit Expense account picker
  // so users can re-map an expense to the correct CoA line (e.g. 5000 Cost of Food Sold
  // for a meat purchase, or 6060 Water Expense for a utility bill).
  const { data: allPostableAccounts = [] } = useQuery({
    queryKey: ["postable-accounts-edit-expense", tenantId],
    queryFn: async () => {
      if (!tenantId)
        return [] as Array<{
          id: string;
          account_code: string;
          account_name: string;
          account_type: string;
        }>;
      const { data, error } = await supabase
        .from("chart_of_accounts")
        .select("id, account_code, account_name, account_type")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .in("account_type", ["cogs", "expense"])
        .order("account_code");
      if (error) throw error;
      return data as Array<{
        id: string;
        account_code: string;
        account_name: string;
        account_type: string;
      }>;
    },
    enabled: !!tenantId,
  });

  // Active suppliers for the edit-expense supplier picker. Mirrors the
  // query used in RecordExpenseDialog so the dropdown behaves identically.
  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers-active", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [] as Array<{ id: string; name: string }>;
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, name, is_active")
        .eq("restaurant_id", restaurant.id)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data || []) as Array<{ id: string; name: string }>;
    },
    enabled: !!restaurant?.id,
  });

  // Inventory items used by the Edit Expense itemized invoice editor.
  const { data: editDialogInventoryItems = [] } = useQuery({
    queryKey: ["inventory-items-edit-expense", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id)
        return [] as Array<{
          id: string;
          name: string;
          unit: string | null;
          stock_unit: string | null;
          units_per_pack: number | null;
          unit_cost: number | null;
          current_stock: number | null;
        }>;
      const sb = supabase as any;
      const result = await sb
        .from("inventory_items")
        .select(
          "id, name, unit, unit_cost, current_stock, units_per_pack, stock_unit"
        )
        .eq("restaurant_id", restaurant.id)
        .eq("is_active", true)
        .order("name");
      if (result.error) throw result.error;
      return result.data || [];
    },
    enabled: !!restaurant?.id && !!editingExpense,
  });

  // Deep-link: open Edit Category dialog for ?editCategory=<id>
  useEffect(() => {
    const targetId = searchParams.get("editCategory");
    if (!targetId || categories.length === 0) return;
    const cat = categories.find((c) => c.id === targetId);
    if (cat && (!editingCategory || editingCategory.id !== cat.id)) {
      openEditCategory(cat);
      // Clear the param so we don't re-open on every render / refresh
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("editCategory");
          return next;
        },
        { replace: true }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, categories]);

  // Deep-link from notifications: /expenses?expense=<id>&branch=<branch_id>
  useEffect(() => {
    const targetExpenseId = searchParams.get("expense");
    if (!targetExpenseId || !restaurant?.id) return;
    if (editingExpense?.id === targetExpenseId) return;

    const targetBranchId = searchParams.get("branch");
    if (
      targetBranchId &&
      canSwitchBranches &&
      activeBranchId !== targetBranchId &&
      branches.some((b) => b.id === targetBranchId)
    ) {
      setActiveBranchId(targetBranchId);
    }

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("expenses")
        .select("*, expense_categories(*)")
        .eq("id", targetExpenseId)
        .maybeSingle();

      if (cancelled) return;

      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("expense");
          next.delete("branch");
          return next;
        },
        { replace: true }
      );

      if (error || !data) {
        toast.error("Expense not found or you don't have access to it.");
        return;
      }
      openEditExpense(data as unknown as Expense);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, restaurant?.id, branches, canSwitchBranches]);

  // Fetch total count for pagination
  const { data: totalCount = 0 } = useQuery({
    queryKey: ["expenses-count", restaurant?.id, filters, branchFilterId],
    queryFn: async () => {
      if (!restaurant?.id) return 0;

      let query = supabase
        .from("expenses")
        .select("*", { count: "exact", head: true })
        .eq("restaurant_id", restaurant.id)
        .is("deleted_at", null);

      query = applyBranchScope(query);

      // Apply filters
      if (filters.categoryId && filters.categoryId !== "all") {
        if (filters.categoryId === "uncategorized") {
          query = query.is("category_id", null);
        } else {
          query = query.eq("category_id", filters.categoryId);
        }
      }
      if (filters.dateFrom) {
        query = query.gte("expense_date", filters.dateFrom);
      }
      if (filters.dateTo) {
        query = query.lte("expense_date", filters.dateTo);
      }
      if (filters.amountMin) {
        query = query.gte("amount", parseFloat(filters.amountMin));
      }
      if (filters.amountMax) {
        query = query.lte("amount", parseFloat(filters.amountMax));
      }
      if (filters.search) {
        query = query.ilike("description", `%${filters.search}%`);
      }
      if (filters.status) {
        query = query.eq("status", filters.status);
      }
      if (filters.supplierId && filters.supplierId !== "all") {
        if (filters.supplierId === "none") {
          query = query.is("supplier_id", null);
        } else {
          query = query.eq("supplier_id", filters.supplierId);
        }
      }

      const { count, error } = await query;
      if (error) throw error;
      return count || 0;
    },
    enabled: !!restaurant?.id,
  });

  // Fetch expenses with filters and pagination
  const { data: expenses = [], isLoading } = useQuery({
    queryKey: [
      "expenses",
      restaurant?.id,
      filters,
      currentPage,
      pageSize,
      branchFilterId,
    ],
    queryFn: async () => {
      if (!restaurant?.id) return [];

      let query = supabase
        .from("expenses")
        .select("*, expense_categories(*)")
        .eq("restaurant_id", restaurant.id)
        .is("deleted_at", null);

      query = applyBranchScope(query);

      // Apply filters
      if (filters.categoryId && filters.categoryId !== "all") {
        if (filters.categoryId === "uncategorized") {
          query = query.is("category_id", null);
        } else {
          query = query.eq("category_id", filters.categoryId);
        }
      }
      if (filters.dateFrom) {
        query = query.gte("expense_date", filters.dateFrom);
      }
      if (filters.dateTo) {
        query = query.lte("expense_date", filters.dateTo);
      }
      if (filters.amountMin) {
        query = query.gte("amount", parseFloat(filters.amountMin));
      }
      if (filters.amountMax) {
        query = query.lte("amount", parseFloat(filters.amountMax));
      }
      if (filters.search) {
        query = query.ilike("description", `%${filters.search}%`);
      }
      if (filters.status) {
        query = query.eq("status", filters.status);
      }
      if (filters.supplierId && filters.supplierId !== "all") {
        if (filters.supplierId === "none") {
          query = query.is("supplier_id", null);
        } else {
          query = query.eq("supplier_id", filters.supplierId);
        }
      }

      // Apply sorting
      query = query.order(filters.sortBy, {
        ascending: filters.sortOrder === "asc",
      });

      // Apply pagination
      const from = (currentPage - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);

      const { data, error } = await query;
      if (error) throw error;
      return data as Expense[];
    },
    enabled: !!restaurant?.id,
  });

  // Fetch expenses for totals calculation using fiscal month
  const { data: allExpensesForTotals = [] } = useQuery({
    queryKey: [
      "expenses-totals",
      restaurant?.id,
      monthStartDay,
      branchFilterId,
    ],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const fiscalMonth = getFiscalMonthRange(new Date(), monthStartDay);
      const fiscalStart = format(fiscalMonth.start, "yyyy-MM-dd");
      const fiscalEnd = format(fiscalMonth.end, "yyyy-MM-dd");

      let q = supabase
        .from("expenses")
        .select("amount, expense_date, status")
        .eq("restaurant_id", restaurant.id)
        .is("deleted_at", null)
        .gte("expense_date", fiscalStart)
        .lte("expense_date", fiscalEnd);
      q = applyBranchScope(q);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
    enabled: !!restaurant?.id && !!monthStartDay,
  });

  // Fetch total expenses (all time)
  const { data: totalExpensesAllTime = 0 } = useQuery({
    queryKey: ["expenses-all-time-total", restaurant?.id, branchFilterId],
    queryFn: async () => {
      if (!restaurant?.id) return 0;
      let q = supabase
        .from("expenses")
        .select("amount")
        .eq("restaurant_id", restaurant.id)
        .is("deleted_at", null);
      q = applyBranchScope(q);
      const { data, error } = await q;
      if (error) throw error;
      return data?.reduce((sum, e) => sum + Number(e.amount), 0) || 0;
    },
    enabled: !!restaurant?.id,
  });

  // Fetch pending expenses total (fiscal month)
  const { data: pendingExpensesTotal = 0 } = useQuery({
    queryKey: [
      "expenses-pending-total",
      restaurant?.id,
      monthStartDay,
      branchFilterId,
    ],
    queryFn: async () => {
      if (!restaurant?.id) return 0;
      const fiscalMonth = getFiscalMonthRange(new Date(), monthStartDay);
      const fiscalStart = format(fiscalMonth.start, "yyyy-MM-dd");
      const fiscalEnd = format(fiscalMonth.end, "yyyy-MM-dd");

      let q = supabase
        .from("expenses")
        .select("amount")
        .eq("restaurant_id", restaurant.id)
        .is("deleted_at", null)
        .eq("status", "unpaid")
        .gte("expense_date", fiscalStart)
        .lte("expense_date", fiscalEnd);
      q = applyBranchScope(q);
      const { data, error } = await q;
      if (error) throw error;
      return data?.reduce((sum, e) => sum + Number(e.amount), 0) || 0;
    },
    enabled: !!restaurant?.id && !!monthStartDay,
  });

  // Fetch pending expenses count (fiscal month)
  const { data: pendingExpensesCount = 0 } = useQuery({
    queryKey: [
      "expenses-pending-count",
      restaurant?.id,
      monthStartDay,
      branchFilterId,
    ],
    queryFn: async () => {
      if (!restaurant?.id) return 0;
      const fiscalMonth = getFiscalMonthRange(new Date(), monthStartDay);
      const fiscalStart = format(fiscalMonth.start, "yyyy-MM-dd");
      const fiscalEnd = format(fiscalMonth.end, "yyyy-MM-dd");

      let q = supabase
        .from("expenses")
        .select("*", { count: "exact", head: true })
        .eq("restaurant_id", restaurant.id)
        .is("deleted_at", null)
        .eq("status", "unpaid")
        .gte("expense_date", fiscalStart)
        .lte("expense_date", fiscalEnd);
      q = applyBranchScope(q);
      const { count, error } = await q;
      if (error) throw error;
      return count || 0;
    },
    enabled: !!restaurant?.id && !!monthStartDay,
  });

  // Fetch this month's sales total (fiscal month) for Sales vs Expenses comparison
  const { data: thisMonthSalesTotal = 0 } = useQuery({
    queryKey: [
      "sales-this-month-total",
      restaurant?.id,
      monthStartDay,
      branchFilterId,
    ],
    queryFn: async () => {
      if (!restaurant?.id || !monthStartDay) return 0;
      const fiscalMonth = getFiscalMonthRange(new Date(), monthStartDay);
      const fromDate = format(fiscalMonth.start, "yyyy-MM-dd");
      const toDate = format(fiscalMonth.end, "yyyy-MM-dd");
      const reconciled = await fetchReconciledSalesByDay({
        restaurantId: restaurant.id,
        dateFrom: fromDate,
        dateTo: toDate,
        branchId: branchFilterId,
      });
      return reconciled.total;
    },
    enabled: !!restaurant?.id && !!monthStartDay,
  });

  const totalPages = Math.ceil(totalCount / pageSize);

  // Calculate totals from fiscal month's data
  const yesterday = format(subDays(new Date(), 1), "yyyy-MM-dd");

  const yesterdayTotal = useMemo(
    () =>
      allExpensesForTotals
        .filter((e) => e.expense_date === yesterday)
        .reduce((sum, e) => sum + Number(e.amount), 0),
    [allExpensesForTotals, yesterday]
  );

  const monthTotal = useMemo(
    () => allExpensesForTotals.reduce((sum, e) => sum + Number(e.amount), 0),
    [allExpensesForTotals]
  );

  const monthPaidTotal = useMemo(
    () =>
      allExpensesForTotals
        .filter((e) => (e as any).status === "paid")
        .reduce((sum, e) => sum + Number(e.amount), 0),
    [allExpensesForTotals]
  );

  const monthUnpaidTotal = useMemo(
    () =>
      allExpensesForTotals
        .filter((e) => (e as any).status === "unpaid")
        .reduce((sum, e) => sum + Number(e.amount), 0),
    [allExpensesForTotals]
  );

  // Fetch filtered totals (sum of all expenses matching current filters, split by status)
  const { data: filteredTotals = { total: 0, paid: 0, unpaid: 0 } } = useQuery({
    queryKey: [
      "expenses-filtered-total",
      restaurant?.id,
      filters,
      branchFilterId,
    ],
    queryFn: async () => {
      if (!restaurant?.id) return { total: 0, paid: 0, unpaid: 0 };

      let query = supabase
        .from("expenses")
        .select("amount, status")
        .eq("restaurant_id", restaurant.id)
        .is("deleted_at", null);

      query = applyBranchScope(query);

      // Apply same filters as the main query
      if (filters.categoryId && filters.categoryId !== "all") {
        if (filters.categoryId === "uncategorized") {
          query = query.is("category_id", null);
        } else {
          query = query.eq("category_id", filters.categoryId);
        }
      }
      if (filters.dateFrom) {
        query = query.gte("expense_date", filters.dateFrom);
      }
      if (filters.dateTo) {
        query = query.lte("expense_date", filters.dateTo);
      }
      if (filters.amountMin) {
        query = query.gte("amount", parseFloat(filters.amountMin));
      }
      if (filters.amountMax) {
        query = query.lte("amount", parseFloat(filters.amountMax));
      }
      if (filters.search) {
        query = query.ilike("description", `%${filters.search}%`);
      }
      if (filters.status) {
        query = query.eq("status", filters.status);
      }
      if (filters.supplierId && filters.supplierId !== "all") {
        if (filters.supplierId === "none") {
          query = query.is("supplier_id", null);
        } else {
          query = query.eq("supplier_id", filters.supplierId);
        }
      }

      const { data, error } = await query;
      if (error) throw error;

      const total = data?.reduce((sum, e) => sum + Number(e.amount), 0) || 0;
      const paid =
        data
          ?.filter((e) => e.status === "paid")
          .reduce((sum, e) => sum + Number(e.amount), 0) || 0;
      const unpaid =
        data
          ?.filter((e) => e.status === "unpaid")
          .reduce((sum, e) => sum + Number(e.amount), 0) || 0;

      return { total, paid, unpaid };
    },
    enabled: !!restaurant?.id,
  });

  // For backwards compatibility
  const filteredTotal = filteredTotals.total;

  // Fetch ALL filtered expenses for export (no pagination)
  const { data: allFilteredExpenses = [], refetch: refetchAllExpenses } =
    useQuery({
      queryKey: [
        "expenses-all-filtered",
        restaurant?.id,
        filters,
        branchFilterId,
      ],
      queryFn: async () => {
        if (!restaurant?.id) return [];

        let query = supabase
          .from("expenses")
          .select("*, expense_categories(*)")
          .eq("restaurant_id", restaurant.id)
          .is("deleted_at", null);

        query = applyBranchScope(query);

        // Apply same filters as the main query
        if (filters.categoryId && filters.categoryId !== "all") {
          if (filters.categoryId === "uncategorized") {
            query = query.is("category_id", null);
          } else {
            query = query.eq("category_id", filters.categoryId);
          }
        }
        if (filters.dateFrom) {
          query = query.gte("expense_date", filters.dateFrom);
        }
        if (filters.dateTo) {
          query = query.lte("expense_date", filters.dateTo);
        }
        if (filters.amountMin) {
          query = query.gte("amount", parseFloat(filters.amountMin));
        }
        if (filters.amountMax) {
          query = query.lte("amount", parseFloat(filters.amountMax));
        }
        if (filters.search) {
          query = query.ilike("description", `%${filters.search}%`);
        }
        if (filters.status) {
          query = query.eq("status", filters.status);
        }
        if (filters.supplierId && filters.supplierId !== "all") {
          if (filters.supplierId === "none") {
            query = query.is("supplier_id", null);
          } else {
            query = query.eq("supplier_id", filters.supplierId);
          }
        }


        // Apply sorting
        query = query.order(filters.sortBy, {
          ascending: filters.sortOrder === "asc",
        });

        const { data, error } = await query;
        if (error) throw error;
        return data as Expense[];
      },
      enabled: false, // Only fetch when export is triggered
    });

  // Category total - calculates total for the selected category from ALL expenses matching the category
  const selectedCategoryTotal = useMemo(() => {
    if (!filters.categoryId) return 0;
    return expenses.reduce((sum, e) => sum + Number(e.amount), 0);
  }, [expenses, filters.categoryId]);

  // Get selected category name for display
  const selectedCategoryName = useMemo(() => {
    if (!filters.categoryId) return null;
    return categories.find((c) => c.id === filters.categoryId)?.name || null;
  }, [filters.categoryId, categories]);

  // Reset page when filters change
  const handleFiltersChange = (newFilters: ExpenseFiltersState) => {
    setFilters(newFilters);
    setCurrentPage(1);
  };

  // --- Running summary drill-downs -------------------------------------
  const expenseListRef = useRef<HTMLDivElement | null>(null);
  const [categoryBreakdownOpen, setCategoryBreakdownOpen] = useState(false);

  const drillDown = (patch: Partial<ExpenseFiltersState>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setCurrentPage(1);
    setTimeout(() => {
      expenseListRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 50);
  };

  // Per-category totals for the current branch + filter context
  const { data: categoryBreakdown = [] } = useQuery({
    queryKey: [
      "expenses-category-breakdown",
      restaurant?.id,
      filters,
      branchFilterId,
    ],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      let query = supabase
        .from("expenses")
        .select("amount, status, category_id")
        .eq("restaurant_id", restaurant.id)
        .is("deleted_at", null);

      query = applyBranchScope(query);
      if (filters.dateFrom) query = query.gte("expense_date", filters.dateFrom);
      if (filters.dateTo) query = query.lte("expense_date", filters.dateTo);
      if (filters.amountMin)
        query = query.gte("amount", parseFloat(filters.amountMin));
      if (filters.amountMax)
        query = query.lte("amount", parseFloat(filters.amountMax));
      if (filters.search)
        query = query.ilike("description", `%${filters.search}%`);
      if (filters.status) query = query.eq("status", filters.status);
      if (filters.supplierId && filters.supplierId !== "all") {
        if (filters.supplierId === "none") {
          query = query.is("supplier_id", null);
        } else {
          query = query.eq("supplier_id", filters.supplierId);
        }
      }


      const { data, error } = await query;
      if (error) throw error;

      const map = new Map<
        string,
        {
          categoryId: string;
          total: number;
          paid: number;
          unpaid: number;
          count: number;
        }
      >();
      (data || []).forEach((row: any) => {
        const key = row.category_id || "uncategorized";
        const entry = map.get(key) || {
          categoryId: key,
          total: 0,
          paid: 0,
          unpaid: 0,
          count: 0,
        };
        const amt = Number(row.amount) || 0;
        entry.total += amt;
        entry.count += 1;
        if (row.status === "paid") entry.paid += amt;
        else entry.unpaid += amt;
        map.set(key, entry);
      });
      return Array.from(map.values()).sort((a, b) => b.total - a.total);
    },
    enabled: !!restaurant?.id,
  });

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setCurrentPage(1);
  };

  // Helper to get default category (first available category)
  const getDefaultCategoryId = (): string | null => {
    if (categories.length > 0) {
      return categories[0].id;
    }
    return null;
  };

  // Add expense mutation
  const addExpenseMutation = useMutation({
    mutationFn: async () => {
      if (!restaurant?.id || !user?.id) throw new Error("Missing context");
      // Auto-assign default category if none selected
      const finalCategoryId = categoryId || getDefaultCategoryId();
      const { error } = await supabase.from("expenses").insert({
        restaurant_id: restaurant.id,
        created_by: user.id,
        amount: parseFloat(amount),
        description: description || null,
        category_id: finalCategoryId,
        expense_date: expenseDate,
        receipt_url: receiptUrl,
        status: expenseStatus,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-count"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-totals"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-pending-total"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-pending-count"] });
      setIsExpenseOpen(false);
      resetExpenseForm();
      toast.success("Expense recorded");
    },
    onError: () => toast.error("Failed to record expense"),
  });

  // Update expense mutation
  const updateExpenseMutation = useMutation({
    mutationFn: async () => {
      if (!editingExpense) throw new Error("No expense to edit");
      // In itemized mode the total is derived from the line items so the
      // expense and the linked invoice always stay in sync.
      const itemizedTotal = editItemizedMode
        ? editLineItems.reduce(
            (s, li) =>
              s +
              (parseFloat(li.quantity) || 0) * (parseFloat(li.unit_cost) || 0),
            0
          )
        : 0;
      if (editItemizedMode) {
        if (editLineItems.length === 0) {
          throw new Error("Add at least one line item to the invoice");
        }
        if (editLineItems.some((li) => !li.inventory_item_id)) {
          throw new Error(
            "Every line item must have an inventory item selected"
          );
        }
        if (editLineItems.some((li) => !(parseFloat(li.quantity) > 0))) {
          throw new Error(
            "Every line item must have a quantity greater than 0"
          );
        }
        if (!(itemizedTotal > 0)) {
          throw new Error(
            "Invoice total must be greater than 0 — set a unit cost on at least one line"
          );
        }
      }
      const totalAmount = editItemizedMode ? itemizedTotal : parseFloat(amount);
      if (!Number.isFinite(totalAmount) || totalAmount <= 0) throw new Error("Expense amount must be greater than zero");
      const correctedTotals = correctedExpenseTotals(totalAmount, Number(editingExpense.amount), Number(editingExpense.vat_amount || 0));
      const nextStatus = canMarkExpensesPaid
        ? expenseStatus
        : editingExpense.status || "unpaid";
      let nextPaid =
        nextStatus === "paid"
          ? totalAmount
          : canMarkExpensesPaid
          ? parseFloat(paidAmount || "0")
          : Number(editingExpense.paid_amount) || 0;
      if (isNaN(nextPaid) || nextPaid < 0) nextPaid = 0;
      if (nextPaid > totalAmount) {
        throw new Error(`Paid amount cannot exceed ${totalAmount.toFixed(2)}`);
      }
      const { error } = await supabase
        .from("expenses")
        .update({
          amount: totalAmount,
          vat_amount: correctedTotals.vat,
          net_amount: correctedTotals.net,
          description: description || null,
          category_id: categoryId || null,
          expense_date: expenseDate,
          receipt_url: receiptUrl,
          status: nextStatus,
          paid_amount: nextPaid,
          account_id: expenseAccountId || null,
          supplier_id: supplierId || null,
          is_inventory_item: editItemizedMode,
        } as any)
        .eq("id", editingExpense.id);
      if (error) throw error;

      // Mirror to Invoices when a supplier is attached for the first time.
      // We deliberately do NOT auto-delete a previously mirrored invoice if
      // the user clears the supplier — the invoice may have been edited
      // independently and silently deleting it would surprise the user.
      const wasUnlinked =
        !editingExpense.supplier_id && !editingExpense.purchase_invoice_id;
      if (supplierId && wasUnlinked && restaurant?.id && user?.id) {
        await mirrorExpenseToInvoice({
          expenseId: editingExpense.id,
          restaurantId: restaurant.id,
          userId: user.id,
          supplierId,
          total: totalAmount,
          invoiceDate: expenseDate,
          notes: description || undefined,
          imageUrl: receiptUrl || undefined,
          status: nextStatus,
          lineItems: editItemizedMode
            ? editLineItems.map((li) => ({
                inventory_item_id: li.inventory_item_id,
                description:
                  li.movement_reason ||
                  editDialogInventoryItems.find(
                    (it: any) => it.id === li.inventory_item_id
                  )?.name ||
                  "",
                quantity: parseFloat(li.quantity) || 0,
                unit_cost: parseFloat(li.unit_cost) || 0,
              }))
            : undefined,
        });
      }

      // Sync line items on an already-linked invoice. This goes through the
      // replace_invoice_items RPC which deletes + reinserts atomically with
      // definer rights. A plain client-side delete could silently remove 0 rows
      // (RLS) and the following insert then DOUBLED the invoice/expense total.
      if (editItemizedMode && editingExpense.purchase_invoice_id) {
        const sb = supabase as any;
        const rows = editLineItems.map((li) => {
          const qty = parseFloat(li.quantity) || 0;
          const cost = parseFloat(li.unit_cost) || 0;
          return {
            inventory_item_id: li.inventory_item_id,
            description:
              li.movement_reason ||
              editDialogInventoryItems.find(
                (it: any) => it.id === li.inventory_item_id
              )?.name ||
              "",
            quantity: qty,
            unit_price: cost,
          };
        });
        const { error: replaceErr } = await sb.rpc("replace_invoice_items", {
          p_invoice_id: editingExpense.purchase_invoice_id,
          p_items: rows,
          p_auto_create_purchase: false,
        });
        if (replaceErr) throw replaceErr;
      }

      // Sync inventory: compute per-item stock-unit delta between the
      // original lines and the edited lines, then post a single 'adjustment'
      // stock_movement + update current_stock for each item that changed.
      if (editItemizedMode && restaurant?.id && tenantId && user?.id) {
        const sb2 = supabase as any;
        const { error: delOriginalMovementsErr } = await sb2
          .from("stock_movements")
          .delete()
          .eq("reference_type", "expense_snapshot")
          .eq("reference_id", editingExpense.id);
        if (delOriginalMovementsErr) throw delOriginalMovementsErr;

        const currentRows = editLineItems.map((li) => {
          const info = editDialogInventoryItems.find(
            (it: any) => it.id === li.inventory_item_id
          );
          const upp = Number(info?.units_per_pack) || 1;
          const qty = parseFloat(li.quantity) || 0;
          const cost = parseFloat(li.unit_cost) || 0;
          const baseDelta = qty * upp;
          return {
            tenant_id: tenantId,
            restaurant_id: restaurant.id,
            inventory_item_id: li.inventory_item_id,
            movement_type: "purchase",
            quantity_change: baseDelta,
            stock_before: 0,
            stock_after: 0,
            reason: [
              li.movement_reason,
              description ? `Invoice: ${description}` : null,
              `Line: ${qty} × ${cost.toFixed(2)} = ${(qty * cost).toFixed(2)}`,
            ]
              .filter(Boolean)
              .join(" - "),
            reference_type: "expense_snapshot",
            reference_id: editingExpense.id,
            created_by: user.id,
          };
        });
        if (currentRows.length > 0) {
          const { error: insOriginalMovementsErr } = await sb2
            .from("stock_movements")
            .insert(currentRows);
          if (insOriginalMovementsErr) throw insOriginalMovementsErr;
        }

        const allItemIds = Array.from(
          new Set([
            ...editOriginalLines.map((l) => l.inventory_item_id),
            ...editLineItems.map((l) => l.inventory_item_id).filter(Boolean),
          ])
        );
        if (allItemIds.length > 0) {
          const { data: invRows, error: invErr } = await sb2
            .from("inventory_items")
            .select("id, current_stock, units_per_pack, name")
            .in("id", allItemIds);
          if (invErr) throw invErr;
          const invMap = new Map<
            string,
            { current_stock: number; units_per_pack: number; name: string }
          >();
          for (const r of invRows || []) {
            invMap.set(r.id, {
              current_stock: Number(r.current_stock) || 0,
              units_per_pack: Number(r.units_per_pack) || 1,
              name: r.name,
            });
          }

          // Aggregate stock-units per item (qty * units_per_pack) for old + new.
          const oldByItem = new Map<string, number>();
          for (const l of editOriginalLines) {
            const upp = invMap.get(l.inventory_item_id)?.units_per_pack ?? 1;
            oldByItem.set(
              l.inventory_item_id,
              (oldByItem.get(l.inventory_item_id) || 0) + l.quantity * upp
            );
          }
          const newByItem = new Map<string, number>();
          const newCostByItem = new Map<string, number>();
          for (const l of editLineItems) {
            if (!l.inventory_item_id) continue;
            const upp = invMap.get(l.inventory_item_id)?.units_per_pack ?? 1;
            const qty = parseFloat(l.quantity) || 0;
            const cost = parseFloat(l.unit_cost) || 0;
            newByItem.set(
              l.inventory_item_id,
              (newByItem.get(l.inventory_item_id) || 0) + qty * upp
            );
            if (cost > 0 && !newCostByItem.has(l.inventory_item_id)) {
              newCostByItem.set(l.inventory_item_id, cost);
            }
          }

          for (const itemId of allItemIds) {
            const delta =
              (newByItem.get(itemId) || 0) - (oldByItem.get(itemId) || 0);
            if (Math.abs(delta) < 1e-9) continue;
            const info = invMap.get(itemId);
            if (!info) continue;
            const before = info.current_stock;
            const after = before + delta;
            const { error: updErr } = await sb2
              .from("inventory_items")
              .update({
                current_stock: after,
                updated_at: new Date().toISOString(),
              })
              .eq("id", itemId);
            if (updErr) throw updErr;
            const { error: movErr } = await sb2.from("stock_movements").insert({
              tenant_id: tenantId,
              restaurant_id: restaurant.id,
              inventory_item_id: itemId,
              movement_type: "adjustment",
              quantity_change: delta,
              stock_before: before,
              stock_after: after,
              reason: (() => {
                const upp = info.units_per_pack || 1;
                const qtyPacks = Math.abs(delta) / upp;
                const cost = newCostByItem.get(itemId) ?? 0;
                return `Expense line edit — ${info.name} (${
                  delta > 0 ? "+" : ""
                }${delta.toFixed(
                  3
                )} stock units) - Line: ${qtyPacks} × ${cost.toFixed(2)} = ${(
                  qtyPacks * cost
                ).toFixed(2)}`;
              })(),
              reference_type: "expense_edit",
              reference_id: editingExpense.id,
              created_by: user.id,
            });
            if (movErr) throw movErr;
          }
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-totals"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-pending-total"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-pending-count"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
      queryClient.invalidateQueries({
        queryKey: ["inventory-items-edit-expense"],
      });
      queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
      setLedgerError(null);
      setEditingExpense(null);
      resetExpenseForm();
      toast.success("Expense updated");
    },
    onError: (err: Error) => {
      const parsed = parseLedgerValidationError(err);
      setLedgerError(parsed);
      toast.error(parsed.title, { description: parsed.detail });
    },
  });

  // Add category mutation
  const addCategoryMutation = useMutation({
    mutationFn: async () => {
      if (!restaurant?.id) throw new Error("Missing restaurant");
      const { error } = await supabase.from("expense_categories").insert({
        restaurant_id: restaurant.id,
        name: categoryName,
        color: categoryColor,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expense-categories"] });
      setIsCategoryOpen(false);
      resetCategoryForm();
      toast.success("Category added");
    },
    onError: () => toast.error("Failed to add category"),
  });

  // Update category mutation
  const updateCategoryMutation = useMutation({
    mutationFn: async () => {
      if (!editingCategory) throw new Error("No category to edit");
      const { error } = await supabase
        .from("expense_categories")
        .update({
          name: categoryName,
          color: categoryColor,
          account_id: categoryAccountId || null,
        })
        .eq("id", editingCategory.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expense-categories"] });
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      setEditingCategory(null);
      resetCategoryForm();
      toast.success("Category updated");
    },
    onError: () => toast.error("Failed to update category"),
  });

  // Soft delete expense mutation
  const deleteExpenseMutation = useMutation({
    mutationFn: async (expenseId: string) => {
      const { error } = await supabase
        .from("expenses")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", expenseId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-count"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-totals"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-pending-total"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-pending-count"] });
      setDeletingExpense(null);
      toast.success("Expense deleted");
    },
    onError: () => toast.error("Failed to delete expense"),
  });

  // Bulk mark as paid mutation
  const bulkMarkAsPaidMutation = useMutation({
    mutationFn: async ({
      expenseIds,
      paymentAccountId,
    }: {
      expenseIds: string[];
      paymentAccountId: string;
    }) => {
      setLedgerError(null);
      // Fetch current amounts so we can set paid_amount = amount per row.
      // A bulk .in() update can't write per-row values, so we update one-by-one.
      const { data: rows, error: fetchError } = await supabase
        .from("expenses")
        .select("id, amount")
        .in("id", expenseIds);
      if (fetchError) throw fetchError;

      const account = (chartAccounts as any[]).find(
        (a) => a.id === paymentAccountId
      );
      const paymentMethod = /bank/i.test(String(account?.account_name ?? ""))
        ? "bank_transfer"
        : "cash";

      const results = await Promise.all(
        (rows || []).map((row: any) =>
          supabase
            .from("expenses")
            .update({
              status: "paid" as const,
              paid_amount: Number(row.amount) || 0,
              payment_account_id: paymentAccountId,
              payment_method: paymentMethod,
            } as any)
            .eq("id", row.id)
        )
      );
      const firstError = results.find((r) => r.error)?.error;
      if (firstError) throw firstError;
    },
    onSuccess: (_, { expenseIds }) => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-totals"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-pending-total"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-pending-count"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-filtered-total"] });
      queryClient.invalidateQueries({ queryKey: ["expense-posting-status"] });
      queryClient.invalidateQueries({ queryKey: ["chart-of-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["account-transactions"] });
      setSelectedExpenseIds(new Set());
      toast.success(
        `${expenseIds.length} expense${
          expenseIds.length > 1 ? "s" : ""
        } marked as paid`
      );
    },
    onError: (err: unknown) => {
      const parsed = parseLedgerValidationError(err);
      setLedgerError(parsed);
      toast.error(parsed.title, { description: parsed.detail });
    },
  });

  // CSV upload handler
  const handleCSVUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split("\n").filter((line) => line.trim());
      const headers = lines[0]
        .toLowerCase()
        .split(",")
        .map((h) => h.trim());

      // Find column indices
      const dateIdx = headers.findIndex((h) => h.includes("date"));
      const amountIdx = headers.findIndex((h) => h.includes("amount"));
      const categoryIdx = headers.findIndex((h) => h.includes("category"));
      const descIdx = headers.findIndex(
        (h) => h.includes("description") || h.includes("desc")
      );

      if (dateIdx === -1 || amountIdx === -1) {
        toast.error("CSV must have 'date' and 'amount' columns");
        return;
      }

      const parsedData = lines
        .slice(1)
        .map((line) => {
          const values = line
            .split(",")
            .map((v) => v.trim().replace(/^["']|["']$/g, ""));
          return {
            date: values[dateIdx] || "",
            amount: values[amountIdx] || "",
            category: categoryIdx >= 0 ? values[categoryIdx] || "" : "",
            description: descIdx >= 0 ? values[descIdx] || "" : "",
          };
        })
        .filter((row) => row.date && row.amount);

      setCsvData(parsedData);
      setIsCSVUploadOpen(true);
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const uploadCSVExpenses = async () => {
    if (!restaurant?.id || !user?.id || csvData.length === 0) return;

    setIsUploading(true);
    try {
      // Get default category for CSV imports without category
      const defaultCategoryId = categories.length > 0 ? categories[0].id : null;

      const expensesToInsert = csvData.map((row) => {
        // Find category by name, fallback to default
        const category = row.category
          ? categories.find(
              (c) => c.name.toLowerCase() === row.category.toLowerCase()
            )
          : null;

        // Parse date - try multiple formats
        let parsedDate = row.date;
        if (row.date.includes("/")) {
          const parts = row.date.split("/");
          if (parts.length === 3) {
            // Assume DD/MM/YYYY or MM/DD/YYYY
            const [p1, p2, p3] = parts;
            if (parseInt(p1) > 12) {
              // DD/MM/YYYY
              parsedDate = `${p3}-${p2.padStart(2, "0")}-${p1.padStart(
                2,
                "0"
              )}`;
            } else {
              // MM/DD/YYYY
              parsedDate = `${p3}-${p1.padStart(2, "0")}-${p2.padStart(
                2,
                "0"
              )}`;
            }
          }
        }

        return {
          restaurant_id: restaurant.id,
          created_by: user.id,
          amount: parseFloat(row.amount.replace(/[^0-9.-]/g, "")),
          description: row.description || null,
          category_id: category?.id || defaultCategoryId,
          expense_date: parsedDate,
        };
      });

      const { error } = await supabase
        .from("expenses")
        .insert(expensesToInsert);
      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-count"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-totals"] });
      setCsvData([]);
      setIsCSVUploadOpen(false);
      toast.success(
        `${expensesToInsert.length} expenses imported successfully`
      );
    } catch (error) {
      toast.error("Failed to import expenses");
    } finally {
      setIsUploading(false);
    }
  };

  const downloadCSVTemplate = () => {
    const template =
      "date,amount,category,description\n2024-01-15,150.00,Supplies,Office supplies purchase\n2024-01-16,200.00,Utilities,Electricity bill";
    const blob = new Blob([template], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "expenses_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetExpenseForm = () => {
    setAmount("");
    setDescription("");
    setCategoryId("");
    setExpenseDate(format(new Date(), "yyyy-MM-dd"));
    setReceiptUrl(null);
    setExpenseStatus("paid");
    setExpenseAccountId("");
    setPaidAmount("");
    setSupplierId("");
    setEditItemizedMode(false);
    setEditLineItems([]);
    setEditOriginalLines([]);
  };

  const resetCategoryForm = () => {
    setCategoryName("");
    setCategoryColor("#3B9A8C");
    setCategoryAccountId("");
  };

  const hydrateLineFromExpenseHeader = (expense: Expense) => {
    if (!expense.inventory_item_id) return false;
    const qty = Math.max(Number(expense.quantity) || 1, 1);
    const total = Number(expense.amount) || 0;
    const unitCost = qty > 0 ? total / qty : total;
    const line: ExpenseLineItem = {
      uid:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      inventory_item_id: expense.inventory_item_id,
      quantity: String(qty),
      unit_cost: unitCost.toFixed(2),
      stock_change_units: "",
      movement_reason: expense.description || "",
      movement_type: "purchase",
    };
    setEditLineItems([line]);
    setEditItemizedMode(true);
    setEditOriginalLines([
      {
        inventory_item_id: line.inventory_item_id,
        quantity: qty,
        unit_cost: unitCost,
      },
    ]);
    return true;
  };

  // Fallback hydration: itemized expenses without a linked purchase invoice
  // still write stock_movements (reference_type='expense'). Rebuild the line
  // items from there so the editor shows them.
  const hydrateLinesFromStockMovements = async (expense: Expense) => {
    const sb = supabase as any;
    const { data, error } = await sb
      .from("stock_movements")
      .select(
        "inventory_item_id, quantity_change, movement_type, reason, created_at, reference_type, inventory_items(units_per_pack)"
      )
      .in("reference_type", ["expense", "expense_snapshot", "expense_edit"])
      .eq("reference_id", expense.id)
      .order("created_at", { ascending: true });
    if (error || !data || data.length === 0) {
      if (hydrateLineFromExpenseHeader(expense)) return;
      // No itemized history found — fall back to flat amount edit so the
      // user still sees the stored expense amount instead of 0.00.
      setEditItemizedMode(false);
      return;
    }
    const snapshotRows = data.filter(
      (r: any) => r.reference_type === "expense_snapshot"
    );
    const originalRows = data.filter(
      (r: any) => r.reference_type === "expense"
    );
    const fallbackRows = (() => {
      if (snapshotRows.length > 0) return snapshotRows;
      if (originalRows.length > 0) return originalRows;
      const editRows = data.filter(
        (r: any) => r.reference_type === "expense_edit"
      );
      if (editRows.length === 0) return [];
      const latestTs = new Date(
        editRows[editRows.length - 1].created_at
      ).getTime();
      return editRows.filter(
        (r: any) => latestTs - new Date(r.created_at).getTime() <= 30_000
      );
    })();
    // For expense_edit fallback rows, the per-line unit cost wasn't embedded
    // in `reason`, so backfill from inventory_items.unit_cost as a sensible
    // default that the user can edit.
    const missingCostItemIds = Array.from(
      new Set(
        fallbackRows
          .filter(
            (r: any) =>
              r.reference_type === "expense_edit" && r.inventory_item_id
          )
          .map((r: any) => r.inventory_item_id as string)
      )
    );
    const costFallbackMap = new Map<string, number>();
    if (missingCostItemIds.length > 0) {
      const { data: invRows } = await sb
        .from("inventory_items")
        .select("id, unit_cost")
        .in("id", missingCostItemIds);
      for (const r of invRows || []) {
        costFallbackMap.set(r.id, Number(r.unit_cost) || 0);
      }
    }
    const lines: ExpenseLineItem[] = fallbackRows
      .filter((r: any) => r.inventory_item_id)
      .map((r: any) => {
        const upp = Number(r.inventory_items?.units_per_pack) || 1;
        const baseDelta = Math.abs(Number(r.quantity_change) || 0);
        const qty = upp > 0 ? baseDelta / upp : baseDelta;
        // unit cost was embedded in the reason string as "Line: q × cost = total"
        const reason: string = r.reason || "";
        const m = reason.match(/Line:\s*[\d.]+\s*[×x*]\s*([\d.]+)/i);
        const unitCost = m
          ? Number(m[1])
          : fallbackRows.length === 1 &&
            expense.inventory_item_id === r.inventory_item_id &&
            (Number(expense.amount) || 0) > 0 &&
            qty > 0
          ? (Number(expense.amount) || 0) / qty
          : Number(costFallbackMap.get(r.inventory_item_id) ?? 0);
        return {
          uid:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          inventory_item_id: r.inventory_item_id,
          quantity: String(qty),
          unit_cost: unitCost.toFixed(2),
          stock_change_units: "",
          movement_reason: reason,
          movement_type: (r.movement_type as any) || "purchase",
        };
      });
    if (lines.length === 0) {
      if (hydrateLineFromExpenseHeader(expense)) return;
      setEditItemizedMode(false);
      return;
    }
    if (
      lines.every((line) => !(parseFloat(line.unit_cost) > 0)) &&
      hydrateLineFromExpenseHeader(expense)
    ) {
      return;
    }
    setEditLineItems(lines);
    setEditItemizedMode(true);
    setEditOriginalLines(
      lines.map((l) => ({
        inventory_item_id: l.inventory_item_id,
        quantity: parseFloat(l.quantity) || 0,
        unit_cost: parseFloat(l.unit_cost) || 0,
      }))
    );
  };

  const openEditExpense = (expense: Expense) => {
    setLedgerError(null);
    setAmount(expense.amount.toString());
    setDescription(expense.description || "");
    setCategoryId(expense.category_id || "");
    setExpenseDate(expense.expense_date);
    setReceiptUrl(expense.receipt_url);
    setExpenseStatus(expense.status || "paid");
    setExpenseAccountId(expense.account_id || "");
    setSupplierId(expense.supplier_id || "");
    setPaidAmount(
      expense.paid_amount != null
        ? String(expense.paid_amount)
        : expense.status === "paid"
        ? expense.amount.toString()
        : "0"
    );
    setEditingExpense(expense);
    // Reset itemized state; will hydrate from the linked invoice if any.
    setEditItemizedMode(!!expense.is_inventory_item);
    setEditLineItems([]);
    setEditOriginalLines([]);
    if (expense.purchase_invoice_id) {
      (async () => {
        const { data, error } = await (supabase as any)
          .from("invoice_items")
          .select("id, inventory_item_id, description, quantity, unit_price")
          .eq("invoice_id", expense.purchase_invoice_id)
          .order("created_at", { ascending: true });
        if (error || !data || data.length === 0) {
          await hydrateLinesFromStockMovements(expense);
          return;
        }
        const lines: ExpenseLineItem[] = data
          .filter((r: any) => r.inventory_item_id)
          .map((r: any) => ({
            uid:
              typeof crypto !== "undefined" && "randomUUID" in crypto
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            inventory_item_id: r.inventory_item_id,
            quantity: String(r.quantity ?? 1),
            unit_cost: String(r.unit_price ?? 0),
            stock_change_units: "",
            movement_reason: r.description || "",
            movement_type: "purchase",
          }));
        if (lines.length > 0) {
          setEditLineItems(lines);
          setEditItemizedMode(true);
          setEditOriginalLines(
            lines.map((l) => ({
              inventory_item_id: l.inventory_item_id,
              quantity: parseFloat(l.quantity) || 0,
              unit_cost: parseFloat(l.unit_cost) || 0,
            }))
          );
        }
      })();
    } else {
      // Itemized expenses without a linked purchase invoice still record
      // stock_movements with reference_type='expense'. Hydrate from those
      // so the user can see/edit the original lines.
      hydrateLinesFromStockMovements(expense);
    }
  };

  const openEditCategory = (category: ExpenseCategory) => {
    setCategoryName(category.name);
    setCategoryColor(category.color || "#3B9A8C");
    setCategoryAccountId(category.account_id || "");
    setEditingCategory(category);
  };

  // Multi-selection helpers
  const unpaidExpensesOnPage = expenses.filter((e) => e.status === "unpaid");
  const selectedUnpaidCount = Array.from(selectedExpenseIds).filter(
    (id) => expenses.find((e) => e.id === id)?.status === "unpaid"
  ).length;

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const unpaidIds = unpaidExpensesOnPage.map((e) => e.id);
      setSelectedExpenseIds(new Set(unpaidIds));
    } else {
      setSelectedExpenseIds(new Set());
    }
  };

  const handleSelectExpense = (expenseId: string, checked: boolean) => {
    setSelectedExpenseIds((prev) => {
      const newSet = new Set(prev);
      if (checked) {
        newSet.add(expenseId);
      } else {
        newSet.delete(expenseId);
      }
      return newSet;
    });
  };

  const handleBulkMarkAsPaid = () => {
    if (!canMarkExpensesPaid) {
      toast.error("Only managers or accountants can mark expenses as paid");
      return;
    }
    const idsToUpdate = Array.from(selectedExpenseIds).filter(
      (id) => expenses.find((e) => e.id === id)?.status === "unpaid"
    );
    if (idsToUpdate.length > 0) {
      setBulkPreviewOpen(true);
    }
  };

  // Expenses queued for the bulk settlement preview dialog.
  const bulkPreviewExpenses = Array.from(selectedExpenseIds)
    .map((id) => expenses.find((e) => e.id === id))
    .filter((e): e is (typeof expenses)[number] => !!e && e.status === "unpaid")
    .map((e) => ({
      id: e.id,
      description: e.description || e.expense_categories?.name || "Expense",
      amount: Number(e.amount) || 0,
    }));

  const clearSelection = () => {
    setSelectedExpenseIds(new Set());
  };

  return (
    <>
      <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 fade-slide-in mb-6 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">
              {t("app.expenses.title")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t("app.expenses.subtitle")}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            {/* Hidden file input for CSV */}
            <input
              type="file"
              ref={fileInputRef}
              accept=".csv"
              onChange={handleCSVUpload}
              className="hidden"
            />

            <Button
              size="sm"
              className="gap-1.5 min-h-[36px]"
              onClick={() => setIsExpenseOpen(true)}
            >
              <Plus className="h-4 w-4" />
              {t("app.expenses.actions.add")}
            </Button>

            {isManager && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 min-h-[36px]"
                onClick={() => setIsKitchenPurchaseOpen(true)}
              >
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">{t("app.expenses.actions.kitchenPurchase")}</span>
                <span className="sm:hidden">{t("app.expenses.actions.kitchen")}</span>
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 min-h-[36px]"
                >
                  <MoreHorizontal className="h-4 w-4" />
                  <span className="hidden sm:inline">{t("app.expenses.actions.more")}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel>Data</DropdownMenuLabel>
                {isManager && (
                  <>
                    <DropdownMenuItem
                      disabled={totalCount === 0}
                      onSelect={async () => {
                        const { data } = await refetchAllExpenses();
                        if (data && data.length > 0) {
                          const dateRange = `${filters.dateFrom}_to_${filters.dateTo}`;
                          const exportData = prepareExpensesExportData(
                            data,
                            filteredTotal,
                            dateRange,
                            {
                              branchNameById,
                              branchId: branchFilterId,
                              branchLabel: branchFilterId
                                ? branchNameById[branchFilterId] ?? "Branch"
                                : "All-branches",
                            }
                          );
                          exportToCSV(exportData);
                          toast.success(`${data.length} expenses exported`);
                        } else {
                          toast.error("No expenses to export");
                        }
                      }}
                    >
                      <FileDown className="h-4 w-4 mr-2" /> Export expenses
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => downloadCSVTemplate()}>
                      <Download className="h-4 w-4 mr-2" /> Download template
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => fileInputRef.current?.click()}
                    >
                      <Upload className="h-4 w-4 mr-2" /> Import from file
                    </DropdownMenuItem>

                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Accounting checks</DropdownMenuLabel>
                    <DropdownMenuItem
                      onSelect={() => setVerifyPostingOpen(true)}
                    >
                      <Scale className="h-4 w-4 mr-2" /> Verify posting
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={async () => {
                        const { data, error } = await (supabase as any).rpc(
                          "reconcile_expense_ledger",
                          { p_tenant_id: profile?.tenant_id ?? null }
                        );
                        if (error) {
                          toast.error("Reconciliation failed", {
                            description: error.message,
                          });
                          return;
                        }
                        const rows = (data ?? []) as Array<{
                          action: string;
                          expense_id: string;
                        }>;
                        const fixed = rows.filter(
                          (r) => r.action === "backfilled"
                        ).length;
                        const flagged = rows.filter(
                          (r) => r.action === "flagged"
                        ).length;
                        if (rows.length === 0) {
                          toast.success(
                            "Ledger is balanced — nothing to reconcile"
                          );
                        } else {
                          toast.success(
                            `Reconciliation complete: ${fixed} backfilled, ${flagged} flagged`
                          );
                        }
                        queryClient.invalidateQueries({
                          queryKey: ["expenses"],
                        });
                        queryClient.invalidateQueries({
                          queryKey: ["expense-posting-status"],
                        });
                      }}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-2" /> Reconcile ledger
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setIsCoAAuditOpen(true)}>
                      <Scale className="h-4 w-4 mr-2" /> Chart of accounts audit
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setIsDayEndAdjOpen(true)}>
                      <Scale className="h-4 w-4 mr-2" /> Day-end adjustment
                    </DropdownMenuItem>

                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Categories & links</DropdownMenuLabel>
                    <DropdownMenuItem onSelect={() => setIsCategoryOpen(true)}>
                      <Folder className="h-4 w-4 mr-2" /> New category
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => setBulkCopyCategoriesOpen(true)}
                    >
                      <Copy className="h-4 w-4 mr-2" /> Copy to branch
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => setBulkCopyCategoriesAllOpen(true)}
                    >
                      <Copy className="h-4 w-4 mr-2" /> Copy to all branches
                    </DropdownMenuItem>

                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Inventory links</DropdownMenuLabel>
                    <DropdownMenuItem asChild>
                      <RouterLink to="/inventory-link-audit">
                        <Link2 className="h-4 w-4 mr-2" /> Inventory link audit
                      </RouterLink>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <RouterLink to="/inventory-link-rules">
                        <Link2 className="h-4 w-4 mr-2" /> Link rules
                      </RouterLink>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <RouterLink to="/inventory-purchase-verification">
                        <Link2 className="h-4 w-4 mr-2" /> Purchase verification
                      </RouterLink>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <Dialog
              open={isCategoryOpen}
              onOpenChange={(open) => {
                setIsCategoryOpen(open);
                if (!open) resetCategoryForm();
              }}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Expense Category</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label>Category Name</Label>
                    <Input
                      value={categoryName}
                      onChange={(e) => setCategoryName(e.target.value)}
                      placeholder="e.g., Supplies, Utilities"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Color</Label>
                    <Input
                      type="color"
                      value={categoryColor}
                      onChange={(e) => setCategoryColor(e.target.value)}
                      className="h-10 w-full"
                    />
                  </div>
                  <Button
                    onClick={() => addCategoryMutation.mutate()}
                    disabled={!categoryName || addCategoryMutation.isPending}
                    className="w-full"
                  >
                    Add Category
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
            <RecordExpenseDialog
              open={isExpenseOpen}
              onOpenChange={(open) => {
                setIsExpenseOpen(open);
                if (!open) resetExpenseForm();
                if (!open) setQuickAddCategoryId(null);
              }}
              defaultCategoryId={quickAddCategoryId}
            />
            <KitchenPurchaseDialog
              open={isKitchenPurchaseOpen}
              onOpenChange={setIsKitchenPurchaseOpen}
            />
            <ExpenseCoAAuditDialog
              open={isCoAAuditOpen}
              onOpenChange={setIsCoAAuditOpen}
              onEditExpense={(id) => {
                const exp = expenses.find((e) => e.id === id);
                if (exp) openEditExpense(exp);
              }}
            />
            <DayEndAdjustmentDialog
              open={isDayEndAdjOpen}
              onOpenChange={setIsDayEndAdjOpen}
              scope="expense_day"
              businessDate={format(new Date(), "yyyy-MM-dd")}
              title="Expenses | Day-End Adjustment"
            />
          </div>
        </header>

        <ExpenseApprovalQueue />

        <MappingGapsPanel />

        <div className="mt-4">
          <PendingVatSplitPanel collapsible defaultOpen={false} showPageLink todayOnly />
        </div>

        <div className="mt-4">
          <DayEndAdjustmentsList scope="expense_day" />
        </div>

        {/* Quick-Add Buttons for Common Expenses */}
        {(() => {
          const QUICK_ADD = ["Milk", "Chicken", "Gas", "Water"];
          const quickCategories = QUICK_ADD.map((name) => ({
            name,
            cat: categories.find(
              (c) => c.name.trim().toLowerCase() === name.toLowerCase()
            ),
          })).filter((q) => q.cat);
          if (quickCategories.length === 0) return null;
          return (
            <div className="mb-6 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground me-1">
                {t("app.expenses.quickAdd")}
              </span>
              {quickCategories.map(({ name, cat }) => (
                <Button
                  key={cat!.id}
                  variant="outline"
                  size="sm"
                  className="gap-1.5 hover:border-primary hover:text-primary transition-colors"
                  onClick={() => {
                    setQuickAddCategoryId(cat!.id);
                    setIsExpenseOpen(true);
                  }}
                >
                  {cat!.color && (
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ backgroundColor: cat!.color }}
                    />
                  )}
                  <Plus className="h-3.5 w-3.5" />
                  {name}
                </Button>
              ))}
            </div>
          );
        })()}

        {/* Edit Expense Dialog */}
        <Dialog
          open={!!editingExpense}
          onOpenChange={(open) => {
            if (!open) {
              setEditingExpense(null);
              resetExpenseForm();
            }
          }}
        >
          <DialogContent className="sm:max-w-[44rem] max-h-[90vh] overflow-y-auto overflow-x-auto">
            <DialogHeader>
              <DialogTitle>Edit Expense</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>
                  Amount
                  {editItemizedMode && (
                    <span className="ml-2 text-[11px] text-muted-foreground font-normal">
                      (auto from line items)
                    </span>
                  )}
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  value={
                    editItemizedMode ? editComputedTotal.toFixed(2) : amount
                  }
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  disabled={editItemizedMode}
                  className={
                    editItemizedMode
                      ? "bg-muted/40 cursor-not-allowed font-mono"
                      : ""
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={categoryId}
                  onValueChange={(v) => {
                    setCategoryId(v);
                    // Auto-suggest the category's default CoA mapping when the user
                    // hasn't explicitly chosen an account for this expense yet.
                    const cat = categories.find((c) => c.id === v);
                    if (cat?.account_id && !expenseAccountId) {
                      setExpenseAccountId(cat.account_id);
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        <span className="flex items-center gap-2">
                          <span
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: cat.color || "#888" }}
                          />
                          {cat.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Chart of Accounts</Label>
                <Select
                  value={expenseAccountId || "none"}
                  onValueChange={(v) =>
                    setExpenseAccountId(v === "none" ? "" : v)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select account" />
                  </SelectTrigger>
                  <SelectContent className="max-h-80">
                    <SelectItem value="none">No account mapping</SelectItem>
                    {allPostableAccounts.filter(
                      (a) => a.account_type === "cogs"
                    ).length > 0 && (
                      <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">
                        COGS (5000–)
                      </div>
                    )}
                    {allPostableAccounts
                      .filter((a) => a.account_type === "cogs")
                      .map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          <span className="font-mono text-xs mr-2">
                            {a.account_code}
                          </span>
                          {a.account_name}
                        </SelectItem>
                      ))}
                    {allPostableAccounts.filter(
                      (a) => a.account_type === "expense"
                    ).length > 0 && (
                      <div className="px-2 py-1 text-xs font-semibold text-muted-foreground border-t mt-1">
                        Expenses (6000–)
                      </div>
                    )}
                    {allPostableAccounts
                      .filter((a) => a.account_type === "expense")
                      .map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          <span className="font-mono text-xs mr-2">
                            {a.account_code}
                          </span>
                          {a.account_name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Controls where this expense posts in your ledger.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Description (Optional)</Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description"
                />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Supplier (Optional)
                </Label>
                <Select
                  value={supplierId || "none"}
                  onValueChange={(v) => setSupplierId(v === "none" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select supplier" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No supplier</SelectItem>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {supplierId && !editingExpense?.purchase_invoice_id && (
                  <p className="text-[11px] text-muted-foreground">
                    Attaching a supplier will also create a matching entry in
                    the Invoices list.
                  </p>
                )}
                {editingExpense?.purchase_invoice_id && (
                  <p className="text-[11px] text-muted-foreground">
                    Already linked to an invoice. Clearing the supplier here
                    keeps the original invoice intact.
                  </p>
                )}
              </div>
              {ledgerError && (
                <LedgerValidationAlert
                  error={ledgerError}
                  onDismiss={() => setLedgerError(null)}
                />
              )}
              {canMarkExpensesPaid ? (
                <ExpenseStatusField
                  value={expenseStatus}
                  onChange={(next) => {
                    const currentTotal = editItemizedMode
                      ? editComputedTotal
                      : parseFloat(amount) || 0;
                    // Reversing a posted settlement requires an explicit approval prompt.
                    if (
                      next === "unpaid" &&
                      editingExpense?.status === "paid" &&
                      (editingExpense as any)?.ledger_posted
                    ) {
                      setReversalTarget(editingExpense);
                      return;
                    }
                    setExpenseStatus(next);
                    // Sync the partial-payment helper field with the new status so
                    // the user always sees a sensible default.
                    if (next === "paid") {
                      setPaidAmount(
                        currentTotal > 0 ? currentTotal.toFixed(2) : "0"
                      );
                    } else if (
                      paidAmount === amount ||
                      paidAmount === currentTotal.toFixed(2)
                    ) {
                      // Was fully paid - reset to zero so the user enters the partial.
                      setPaidAmount("0");
                    }
                  }}
                  paymentMethod={editingExpense?.payment_method || undefined}
                />
              ) : (
                <ExpenseStatusField
                  value={expenseStatus}
                  onChange={() => {}}
                  locked
                  lockedReason="Payment status is locked for cashier entries. Accountant review is required before marking paid."
                  showLedgerHint={false}
                />
              )}
              {canMarkExpensesPaid &&
                expenseStatus === "paid" &&
                editingExpense?.status === "unpaid" && (
                  <ApSettlementPostingPreview expenseId={editingExpense.id} />
                )}
              {expenseStatus === "unpaid" &&
                (() => {
                  const total = editItemizedMode
                    ? editComputedTotal
                    : parseFloat(amount) || 0;
                  return (
                    <ExpenseClosureChecklist
                      status={expenseStatus}
                      ledgerPosted={Boolean(
                        (editingExpense as any)?.ledger_posted
                      )}
                      paidAmount={Math.max(0, parseFloat(paidAmount) || 0)}
                      totalAmount={total}
                      canSettle={canMarkExpensesPaid}
                    />
                  );
                })()}
              {canMarkExpensesPaid &&
                expenseStatus === "unpaid" &&
                (() => {
                  const total = editItemizedMode
                    ? editComputedTotal
                    : parseFloat(amount) || 0;
                  const paid = Math.max(0, parseFloat(paidAmount) || 0);
                  const outstanding = Math.max(0, total - paid);
                  const overpaid = paid > total;
                  return (
                    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="expense-paid-amount">
                          Amount Paid So Far
                        </Label>
                        <span className="text-xs text-muted-foreground">
                          Outstanding:{" "}
                          <strong className="text-foreground">
                            {formatCurrency(outstanding)}
                          </strong>
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          id="expense-paid-amount"
                          type="number"
                          step="0.01"
                          min="0"
                          max={total || undefined}
                          value={paidAmount}
                          onChange={(e) => setPaidAmount(e.target.value)}
                          placeholder="0.00"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setPaidAmount("0")}
                        >
                          Clear
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Record a partial payment to track how much is still
                        owed. Leave at 0 if nothing has been paid yet.
                        {paid > 0 &&
                          paid < total &&
                          " The expense stays Unpaid until fully settled."}
                      </p>
                      {overpaid && (
                        <p className="text-xs text-destructive">
                          Paid amount cannot exceed the total (
                          {formatCurrency(total)}).
                        </p>
                      )}
                    </div>
                  );
                })()}
              {restaurant?.id && (
                <ReceiptUploader
                  receiptUrl={receiptUrl}
                  onReceiptChange={setReceiptUrl}
                  restaurantId={restaurant.id}
                  disabled={updateExpenseMutation.isPending}
                />
              )}
              {/* Itemized invoice mode — edit / add / remove invoice line items */}
              {itemizedInvoicesEnabled && (
                <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <Label className="flex items-center gap-2 text-sm">
                        <ListPlus className="h-4 w-4" />
                        Itemized invoice
                      </Label>
                      <p className="text-[11px] text-muted-foreground">
                        Add multiple items that make up this expense. The total
                        is calculated from the lines below.
                      </p>
                    </div>
                    <Switch
                      checked={editItemizedMode}
                      onCheckedChange={(checked) => {
                        setEditItemizedMode(checked);
                        if (checked && editLineItems.length === 0) {
                          setEditLineItems([makeEmptyLine()]);
                        }
                      }}
                    />
                  </div>
                  {editItemizedMode && (
                    <ExpenseLineItemsEditor
                      items={editLineItems}
                      inventoryItems={editDialogInventoryItems as any}
                      onChange={setEditLineItems}
                      onRequestCreateItem={() => setEditQuickAddItemOpen(true)}
                    />
                  )}
                  {editItemizedMode &&
                    !editingExpense?.purchase_invoice_id &&
                    !supplierId && (
                      <p className="text-[11px] text-muted-foreground">
                        Select a supplier above so an itemized invoice can be
                        generated from these lines.
                      </p>
                    )}
                </div>
              )}
              <Button
                onClick={() => {
                  const issue = getPaymentMethodStatusWarning(
                    expenseStatus,
                    editingExpense?.payment_method,
                  );
                  if (issue?.level === "error") {
                    toast.error(issue.title, { description: issue.suggestion });
                    return;
                  }
                  // Posted expenses can only change through an adjusting entry.
                  if (editingExpense) {
                    const nextAmount = editItemizedMode
                      ? editLineItems.reduce(
                          (s, li) =>
                            s +
                            (parseFloat(li.quantity) || 0) *
                              (parseFloat(li.unit_cost) || 0),
                          0
                        )
                      : parseFloat(amount) || 0;
                    const changes = getMaterialExpenseChanges(
                      {
                        amount: Number(editingExpense.amount) || 0,
                        expenseDate: editingExpense.expense_date,
                        categoryId: editingExpense.category_id || null,
                        accountId: (editingExpense as any).account_id || null,
                        supplierId: (editingExpense as any).supplier_id || null,
                      },
                      {
                        amount: nextAmount,
                        expenseDate: expenseDate,
                        categoryId: categoryId || null,
                        accountId: expenseAccountId || null,
                        supplierId: supplierId || null,
                      }
                    );
                    if (
                      requiresLedgerAdjustment(
                        (editingExpense as any).ledger_posted,
                        changes
                      )
                    ) {
                      setAmendChanges(changes);
                      setAmendPayload({
                        expenseId: editingExpense.id,
                        amount: nextAmount,
                        expenseDate,
                        description: description || null,
                        categoryId: categoryId || null,
                        accountId: expenseAccountId || null,
                        supplierId: supplierId || null,
                      });
                      setAmendOpen(true);
                      return;
                    }
                  }
                  updateExpenseMutation.mutate();
                }}
                disabled={
                  updateExpenseMutation.isPending ||
                  (editItemizedMode
                    ? editLineItems.length === 0 ||
                      editLineItems.some(
                        (li) =>
                          !li.inventory_item_id ||
                          !(parseFloat(li.quantity) > 0)
                      )
                    : !amount)
                }
                className="w-full"
              >
                {updateExpenseMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
              {canReverseSettlement && Number(editingExpense?.vat_amount || 0) > 0 && (
                <Button variant="outline" className="w-full" onClick={() => setVatReversalTarget(editingExpense)}>
                  {t("app.expenses.reverseVat", { defaultValue: "Reverse VAT" })}
                </Button>
              )}
              <ExpensePostingStatusPanel
                expenseId={editingExpense?.id}
                ledgerPosted={(editingExpense as any)?.ledger_posted}
                branchId={editingExpense?.branch_id}
              />
              <ExpenseAmendmentAuditPanel expenseId={editingExpense?.id} />

            </div>
          </DialogContent>
        </Dialog>

        <ReverseExpenseVatDialog expense={vatReversalTarget} onClose={() => setVatReversalTarget(null)} onReversed={() => { setEditingExpense(null); resetExpenseForm(); }} />
        <AmendPostedExpenseDialog
          open={amendOpen}
          onOpenChange={setAmendOpen}
          changes={amendChanges}
          payload={amendPayload}
          onAmended={() => {
            setEditingExpense(null);
            resetExpenseForm();
          }}
        />

        {/* Edit Category Dialog */}
        <QuickAddInventoryItemDialog
          open={editQuickAddItemOpen}
          onOpenChange={setEditQuickAddItemOpen}
          restaurantId={restaurant?.id}
          onCreated={(item) => {
            queryClient.invalidateQueries({
              queryKey: ["inventory-items-edit-expense"],
            });
            queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
            setEditLineItems((prev) => {
              const emptyIdx = prev.findIndex((li) => !li.inventory_item_id);
              if (emptyIdx >= 0) {
                const next = [...prev];
                next[emptyIdx] = {
                  ...next[emptyIdx],
                  inventory_item_id: item.id,
                };
                return next;
              }
              return [
                ...prev,
                { ...makeEmptyLine(), inventory_item_id: item.id },
              ];
            });
          }}
        />

        <Dialog
          open={!!editingCategory}
          onOpenChange={(open) => {
            if (!open) {
              setEditingCategory(null);
              resetCategoryForm();
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Category</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Category Name</Label>
                <Input
                  value={categoryName}
                  onChange={(e) => setCategoryName(e.target.value)}
                  placeholder="e.g., Supplies, Utilities"
                />
              </div>
              <div className="space-y-2">
                <Label>Color</Label>
                <Input
                  type="color"
                  value={categoryColor}
                  onChange={(e) => setCategoryColor(e.target.value)}
                  className="h-10 w-full"
                />
              </div>
              <div className="space-y-2">
                <Label>Default Account (Chart of Accounts)</Label>
                <Select
                  value={categoryAccountId || "none"}
                  onValueChange={(v) =>
                    setCategoryAccountId(v === "none" ? "" : v)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="No default account" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No default account</SelectItem>
                    {expenseAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        <span className="font-mono text-xs mr-2">
                          {a.account_code}
                        </span>
                        {a.account_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Auto-fills the account on Record Expense whenever this
                  category is picked.
                </p>
              </div>
              <Button
                onClick={() => updateCategoryMutation.mutate()}
                disabled={!categoryName || updateCategoryMutation.isPending}
                className="w-full"
              >
                {updateCategoryMutation.isPending
                  ? "Saving..."
                  : "Save Changes"}
              </Button>
              {editingCategory && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => setCopyCategorySource(editingCategory)}
                >
                  Copy to branch…
                </Button>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {restaurant?.id && (
          <CopyToBranchDialog
            open={!!copyCategorySource}
            onOpenChange={(o) => {
              if (!o) setCopyCategorySource(null);
            }}
            entity="expense_category"
            restaurantId={restaurant.id}
            source={copyCategorySource}
            sourceLabel={copyCategorySource?.name}
          />
        )}

        {restaurant?.id && (
          <BulkCopyToBranchDialog
            open={bulkCopyCategoriesOpen}
            onOpenChange={setBulkCopyCategoriesOpen}
            entity="expense_category"
            restaurantId={restaurant.id}
            sourceBranchId={activeBranchId}
          />
        )}

        {restaurant?.id && (
          <BulkCopyToBranchDialog
            open={bulkCopyCategoriesAllOpen}
            onOpenChange={setBulkCopyCategoriesAllOpen}
            entity="expense_category"
            restaurantId={restaurant.id}
            sourceBranchId={activeBranchId}
            defaultTargetBranch="__ALL__"
          />
        )}

        {/* Delete Expense Confirmation */}
        <AlertDialog
          open={!!deletingExpense}
          onOpenChange={(open) => !open && setDeletingExpense(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Expense</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this expense of{" "}
                {deletingExpense && Number(deletingExpense.amount).toFixed(2)}{" "}
                SAR from{" "}
                {deletingExpense &&
                  format(new Date(deletingExpense.expense_date), "MMM d, yyyy")}
                ? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  deletingExpense &&
                  deleteExpenseMutation.mutate(deletingExpense.id)
                }
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleteExpenseMutation.isPending ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* CSV Import Preview Dialog */}
        <Dialog
          open={isCSVUploadOpen}
          onOpenChange={(open) => {
            if (!open) {
              setCsvData([]);
              setCsvPreviewExpanded(false);
              setIsCSVUploadOpen(false);
            }
          }}
        >
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5" />
                Import Expenses from CSV
              </DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-auto">
              <p className="text-sm text-muted-foreground mb-4">
                Review the data before importing. Found {csvData.length}{" "}
                expenses.
              </p>
              {csvData.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Description</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(csvPreviewExpanded ? csvData : csvData.slice(0, 10)).map(
                      (row, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="font-medium">
                            {row.date}
                          </TableCell>
                          <TableCell>{row.amount}</TableCell>
                          <TableCell>
                            {row.category ? (
                              categories.find(
                                (c) =>
                                  c.name.toLowerCase() ===
                                  row.category.toLowerCase()
                              ) ? (
                                <Badge variant="secondary">
                                  {row.category}
                                </Badge>
                              ) : (
                                <span className="text-amber-600 text-xs">
                                  "{row.category}" (not found)
                                </span>
                              )
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {row.description || "-"}
                          </TableCell>
                        </TableRow>
                      )
                    )}
                  </TableBody>
                </Table>
              )}
              {csvData.length > 10 && (
                <button
                  type="button"
                  onClick={() => setCsvPreviewExpanded(!csvPreviewExpanded)}
                  className="text-xs text-muted-foreground hover:text-foreground text-center mt-2 w-full flex items-center justify-center gap-1 py-1"
                >
                  {csvPreviewExpanded ? (
                    <>
                      <ChevronUp className="h-3 w-3" />
                      Show less
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3 w-3" />
                      ...and {csvData.length - 10} more expenses
                    </>
                  )}
                </button>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button
                variant="outline"
                onClick={() => setIsCSVUploadOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={uploadCSVExpenses}
                disabled={isUploading || csvData.length === 0}
              >
                {isUploading
                  ? "Importing..."
                  : `Import ${csvData.length} Expenses`}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Summary Cards */}
        <TooltipProvider delayDuration={200}>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4 mt-6 md:mt-8">
            <Tooltip>
              <TooltipTrigger asChild>
                <Card
                  className="fade-slide-in flex flex-col min-h-[120px] cursor-default"
                  style={{ animationDelay: "50ms" }}
                >
                  <CardHeader className="flex-shrink-0 px-3 md:px-6 pt-3 md:pt-6 pb-3">
                    <CardTitle className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5 md:h-4 md:w-4 flex-shrink-0" />
                      <span className="line-clamp-1">Yesterday's Expenses</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col justify-center">
                    <p className="font-display text-2xl font-semibold text-foreground tabular-nums leading-tight break-words">
                      {formatCurrency(yesterdayTotal)}
                    </p>
                  </CardContent>
                </Card>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <p className="font-medium">Yesterday's Expenses</p>
                <p className="text-lg font-semibold">
                  {formatCurrency(yesterdayTotal)}
                </p>
              </TooltipContent>
            </Tooltip>

            {selectedCategoryName ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Card
                    className="fade-slide-in flex flex-col min-h-[120px] cursor-default border-primary/30 bg-primary/5"
                    style={{ animationDelay: "100ms" }}
                  >
                    <CardHeader className="flex-shrink-0 px-3 md:px-6 pt-3 md:pt-6 pb-3">
                      <CardTitle className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                        <Folder className="h-3.5 w-3.5 md:h-4 md:w-4 text-primary flex-shrink-0" />
                        <span className="line-clamp-1">
                          {selectedCategoryName} Total
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="flex-1 flex flex-col justify-center">
                      <p className="font-display text-2xl font-semibold text-primary tabular-nums leading-tight break-words">
                        {formatCurrency(selectedCategoryTotal)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {expenses.length} expense
                        {expenses.length !== 1 ? "s" : ""}
                      </p>
                    </CardContent>
                  </Card>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  <p className="font-medium">{selectedCategoryName} Total</p>
                  <p className="text-lg font-semibold">
                    {formatCurrency(selectedCategoryTotal)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {expenses.length} expense{expenses.length !== 1 ? "s" : ""}{" "}
                    in this category
                  </p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Card
                    className="fade-slide-in flex flex-col min-h-[120px] cursor-default"
                    style={{ animationDelay: "100ms" }}
                  >
                    <CardHeader className="flex-shrink-0 px-3 md:px-6 pt-3 md:pt-6 pb-3">
                      <CardTitle className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                        <TrendingDown className="h-3.5 w-3.5 md:h-4 md:w-4 flex-shrink-0" />
                        <span className="line-clamp-1">{t("app.expenses.summary.thisMonth")}</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="flex-1 flex flex-col justify-center">
                      <p className="font-display text-2xl font-semibold text-foreground tabular-nums leading-tight break-words">
                        {formatCurrency(monthTotal)}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-xs">
                        <span className="flex items-center gap-1 text-success">
                          <CheckCircle2 className="h-3 w-3 flex-shrink-0" />
                          <span className="whitespace-nowrap">
                            {formatCurrency(monthPaidTotal)}
                          </span>
                        </span>
                        <span className="flex items-center gap-1 text-warning">
                          <Clock className="h-3 w-3 flex-shrink-0" />
                          <span className="whitespace-nowrap">
                            {formatCurrency(monthUnpaidTotal)}
                          </span>
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  <p className="font-medium">This Month Total</p>
                  <p className="text-lg font-semibold">
                    {formatCurrency(monthTotal)}
                  </p>
                  <div className="flex flex-col gap-1 mt-1 text-sm">
                    <span className="flex items-center gap-1 text-success">
                      <CheckCircle2 className="h-3 w-3" /> Paid:{" "}
                      {formatCurrency(monthPaidTotal)}
                    </span>
                    <span className="flex items-center gap-1 text-warning">
                      <Clock className="h-3 w-3" /> Unpaid:{" "}
                      {formatCurrency(monthUnpaidTotal)}
                    </span>
                  </div>
                </TooltipContent>
              </Tooltip>
            )}

            <Tooltip>
              <TooltipTrigger asChild>
                <Card
                  className="fade-slide-in flex flex-col min-h-[120px] cursor-default border-warning/30 bg-warning/5"
                  style={{ animationDelay: "125ms" }}
                >
                  <CardHeader className="flex-shrink-0 px-3 md:px-6 pt-3 md:pt-6 pb-3">
                    <CardTitle className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5 md:h-4 md:w-4 text-warning flex-shrink-0" />
                      <span className="line-clamp-1">{t("app.expenses.summary.unpaidExpenses")}</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col justify-center">
                    <p className="font-display text-2xl font-semibold text-warning tabular-nums leading-tight break-words">
                      {formatCurrency(pendingExpensesTotal)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("app.expenses.summary.unpaidCount", { count: pendingExpensesCount })}
                    </p>
                  </CardContent>
                </Card>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <p className="font-medium">Unpaid Expenses</p>
                <p className="text-lg font-semibold text-warning">
                  {formatCurrency(pendingExpensesTotal)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {pendingExpensesCount} unpaid expense
                  {pendingExpensesCount !== 1 ? "s" : ""} pending
                </p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Card
                  className="fade-slide-in flex flex-col min-h-[120px] cursor-default"
                  style={{ animationDelay: "150ms" }}
                >
                  <CardHeader className="flex-shrink-0 px-3 md:px-6 pt-3 md:pt-6 pb-3">
                    <CardTitle className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                      <TrendingDown className="h-3.5 w-3.5 md:h-4 md:w-4 flex-shrink-0" />
                      <span className="line-clamp-1">{t("app.expenses.summary.totalExpense")}</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col justify-center">
                    <p className="font-display text-2xl font-semibold text-foreground tabular-nums leading-tight break-words">
                      {formatCurrency(totalExpensesAllTime)}
                    </p>
                  </CardContent>
                </Card>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <p className="font-medium">Total Expenses (All Time)</p>
                <p className="text-lg font-semibold">
                  {formatCurrency(totalExpensesAllTime)}
                </p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Card
                  className="fade-slide-in flex flex-col min-h-[120px] cursor-default col-span-2 sm:col-span-1"
                  style={{ animationDelay: "175ms" }}
                >
                  <CardHeader className="flex-shrink-0 px-3 md:px-6 pt-3 md:pt-6 pb-3">
                    <CardTitle className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                      <Folder className="h-3.5 w-3.5 md:h-4 md:w-4 flex-shrink-0" />
                      <span className="line-clamp-1">{t("app.expenses.summary.categories")}</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1">
                    <div className="flex flex-wrap gap-1">
                      {categories.slice(0, 5).map((cat) => (
                        <Tooltip key={cat.id}>
                          <TooltipTrigger asChild>
                            <Badge
                              variant="secondary"
                              className="cursor-pointer hover:bg-secondary/80 text-xs max-w-[100px]"
                              style={{
                                borderLeft: `3px solid ${cat.color || "#888"}`,
                              }}
                              onClick={() => isManager && openEditCategory(cat)}
                            >
                              <span className="truncate">{cat.name}</span>
                              {isManager && (
                                <Edit2 className="h-2.5 w-2.5 ml-1 opacity-50 flex-shrink-0" />
                              )}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            <p>{cat.name}</p>
                            {isManager && (
                              <p className="text-xs text-muted-foreground">
                                Click to edit
                              </p>
                            )}
                          </TooltipContent>
                        </Tooltip>
                      ))}
                      {categories.length > 5 && (
                        <Badge variant="outline" className="text-xs">
                          +{categories.length - 5}
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <p className="font-medium">Expense Categories</p>
                <p className="text-sm text-muted-foreground">
                  {categories.length} categories configured
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>

        {/* Sales vs Expenses comparison (fiscal month) */}
        {(() => {
          const salesM = thisMonthSalesTotal || 0;
          const expM = filteredTotals?.total || 0;
          const net = salesM - expM;
          const positive = net >= 0;
          const ratio =
            salesM > 0
              ? Math.min(100, (expM / salesM) * 100)
              : expM > 0
              ? 100
              : 0;
          const margin = salesM > 0 ? (net / salesM) * 100 : 0;
          return (
            <div
              className="mt-6 p-4 rounded-lg border bg-card fade-slide-in"
              style={{ animationDelay: "190ms" }}
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                   <p className="text-sm font-medium">{t("app.expenses.summary.salesVsExpenses")}</p>
                  <p className="text-xs text-muted-foreground">
                     {t("app.expenses.summary.thisFiscalMonth")}
                  </p>
                </div>
                <div
                  className={`flex items-center gap-1 text-sm font-medium ${
                    positive ? "text-emerald-600" : "text-destructive"
                  }`}
                >
                  {positive ? (
                    <TrendingUp className="h-4 w-4" />
                  ) : (
                    <TrendingDown className="h-4 w-4" />
                  )}
                  {margin.toFixed(1)}%
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <TrendingUp className="h-3 w-3 text-emerald-600" />
                     {t("app.expenses.summary.sales")}
                  </p>
                  <p className="text-base md:text-lg font-semibold mt-0.5 break-all">
                    {formatCurrency(salesM)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Wallet className="h-3 w-3 text-destructive" />
                     {t("app.expenses.summary.expenses")}
                  </p>
                  <p className="text-base md:text-lg font-semibold mt-0.5 break-all">
                    {formatCurrency(expM)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Scale className="h-3 w-3" />
                     {t("app.expenses.summary.net")}
                  </p>
                  <p
                    className={`text-base md:text-lg font-semibold mt-0.5 break-all ${
                      positive ? "text-emerald-600" : "text-destructive"
                    }`}
                  >
                    {formatCurrency(net)}
                  </p>
                </div>
              </div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden flex">
                <div
                  className="h-full bg-destructive/70"
                  style={{ width: `${ratio}%` }}
                />
                <div
                  className="h-full bg-emerald-500/70"
                  style={{ width: `${100 - ratio}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                 <span>{t("app.expenses.summary.expenseRatio")}: {ratio.toFixed(1)}%</span>
                 <span>{t("app.expenses.summary.profitMargin")}: {margin.toFixed(1)}%</span>
              </div>
            </div>
          );
        })()}

        {/* Expenses Table */}
        <div
          className="mt-8 rounded-lg border bg-card fade-slide-in"
          style={{ animationDelay: "200ms" }}
        >
          {/* Table Header with Filtered Total */}
          <div className="flex items-center justify-between p-4 border-b">
            <div>
               <h3 className="text-lg font-semibold">{t("app.expenses.title")}</h3>
              <p className="text-sm text-muted-foreground">
                 {t("app.expenses.summary.found", { count: totalCount })}
              </p>
            </div>
             <div className="text-end">
               <p className="text-sm text-muted-foreground">{t("app.expenses.summary.filteredTotal")}</p>
              <p className="text-xl font-semibold">
                {formatCurrency(filteredTotal)}
              </p>
               <div className="flex items-center justify-end rtl:justify-start gap-3 mt-1">
                <span className="text-xs flex items-center gap-1 text-emerald-600">
                  <CheckCircle2 className="h-3 w-3" />
                  {formatCurrency(filteredTotals?.paid || 0)}
                </span>
                <span className="text-xs flex items-center gap-1 text-amber-600">
                  <Clock className="h-3 w-3" />
                  {formatCurrency(filteredTotals?.unpaid || 0)}
                </span>
              </div>
            </div>
          </div>
          <div className="p-4 space-y-4">
            {/* Filters */}
            {hasMultipleBranches && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                   {t("app.expenses.filters.branch")}
                </span>
                {!canSwitchBranches ? (
                  <div className="inline-flex items-center gap-2 h-9 px-3 rounded-md border border-input bg-muted/40 text-sm">
                    <span className="truncate max-w-[160px]">
                      {branches.find((b) => b.id === pinnedBranchId)?.name ??
                        "Branch"}
                    </span>
                  </div>
                ) : branches.length <= 5 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(hasRole("owner") ||
                      hasRole("manager") ||
                      hasRole("accountant")) && (
                      <Button
                        type="button"
                        size="sm"
                        variant={
                          activeBranchId === null || activeBranchId === "all"
                            ? "default"
                            : "outline"
                        }
                        className="h-8"
                        onClick={() => setActiveBranchId("all")}
                      >
                         {t("app.expenses.filters.allBranches")}
                      </Button>
                    )}
                    {branches.map((b) => (
                      <Button
                        key={b.id}
                        type="button"
                        size="sm"
                        variant={
                          activeBranchId === b.id ? "default" : "outline"
                        }
                        className="h-8 gap-1.5"
                        onClick={() => setActiveBranchId(b.id)}
                      >
                        <Building2 className="h-3.5 w-3.5" />
                        {b.name}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <Select
                    value={activeBranchId === null ? "all" : activeBranchId}
                    onValueChange={(v) =>
                      setActiveBranchId(v as string | "all")
                    }
                  >
                    <SelectTrigger className="w-[200px] h-9">
                       <SelectValue placeholder={t("app.expenses.filters.selectBranch")} />
                    </SelectTrigger>
                    <SelectContent className="z-50 bg-popover">
                      {(hasRole("owner") || hasRole("manager")) && (
                         <SelectItem value="all">{t("app.expenses.filters.allBranches")}</SelectItem>
                      )}
                      {branches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
            {/* Running summary — reacts to branch + filter changes */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-lg border bg-muted/30 p-3">
              <button
                type="button"
                 className="text-start rounded-md p-1 -m-1 hover:bg-muted/60 transition-colors"
                onClick={() => drillDown({ status: "" })}
                title="Show all entries for the current branch and date range"
              >
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                   {t("app.expenses.summary.entries")}{" "}
                  {branchFilterId
                    ? `· ${branchNameById[branchFilterId] ?? "Branch"}`
                    : "· All branches"}
                </p>
                <p className="text-lg font-semibold underline-offset-4 hover:underline">
                  {totalCount}
                </p>
              </button>
              <div className="rounded-md p-1 -m-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                   {t("app.expenses.summary.totalSpend")}
                </p>
                <p className="text-lg font-semibold">
                  {formatCurrency(filteredTotals?.total || 0)}
                </p>
                {(() => {
                  const total = filteredTotals?.total || 0;
                  const paid = filteredTotals?.paid || 0;
                  const unpaid = filteredTotals?.unpaid || 0;
                  if (total <= 0) return null;
                  const paidPct = (paid / total) * 100;
                  const unpaidPct = (unpaid / total) * 100;
                  return (
                    <div className="mt-2 space-y-1">
                      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <button
                          type="button"
                          style={{ width: `${paidPct}%` }}
                          className="bg-emerald-500 hover:bg-emerald-600 transition-colors"
                          onClick={() => drillDown({ status: "paid" })}
                          title="Paid cash"
                        />
                        <button
                          type="button"
                          style={{ width: `${unpaidPct}%` }}
                          className="bg-amber-500 hover:bg-amber-600 transition-colors"
                          onClick={() => drillDown({ status: "unpaid" })}
                          title="Unpaid / Accounts Payable"
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <button
                          type="button"
                          className="text-emerald-600 underline-offset-4 hover:underline"
                          onClick={() => drillDown({ status: "paid" })}
                          title="Show paid cash"
                        >
                          {t("app.expenses.summary.paidCash", { amount: formatCurrency(paid) })}
                        </button>
                        <span className="text-muted-foreground">
                          ({paidPct.toFixed(0)}%)
                        </span>
                        <span className="text-muted-foreground">·</span>
                        <button
                          type="button"
                          className="text-amber-600 underline-offset-4 hover:underline"
                          onClick={() => drillDown({ status: "unpaid" })}
                          title="Show unpaid / AP"
                        >
                          {t("app.expenses.summary.unpaidAp", { amount: formatCurrency(unpaid) })}
                        </button>
                        <span className="text-muted-foreground">
                          ({unpaidPct.toFixed(0)}%)
                        </span>
                      </div>
                    </div>
                  );
                })()}
                <button
                  type="button"
                  className="text-[11px] text-primary underline-offset-4 hover:underline inline-flex items-center gap-1"
                  onClick={() => setCategoryBreakdownOpen(true)}
                >
                   {t("app.expenses.summary.categoryBreakdown")}
                   <ChevronRight className="h-3 w-3 rtl:rotate-180" />
                </button>
              </div>
              <div className="rounded-md p-1 -m-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                   {t("app.expenses.summary.cashImpact")}
                </p>
                <button
                  type="button"
                  className="text-lg font-semibold text-emerald-600 underline-offset-4 hover:underline"
                  onClick={() => drillDown({ status: "paid" })}
                  title="Show only paid expenses"
                >
                  -{formatCurrency(filteredTotals?.paid || 0)}
                </button>
                <button
                  type="button"
                  className="block text-[11px] text-amber-600 underline-offset-4 hover:underline"
                  onClick={() => drillDown({ status: "unpaid" })}
                  title="Show only unpaid expenses"
                >
                   {t("app.expenses.summary.stillUnpaid", { amount: formatCurrency(filteredTotals?.unpaid || 0) })}
                </button>
              </div>
            </div>
            <div ref={expenseListRef}>
              <ExpenseFilters
                filters={filters}
                onFiltersChange={handleFiltersChange}
                categories={categories}
                branches={branches}
                suppliers={suppliers}
                totalFiltered={totalCount}
                totalCount={totalCount}
                monthStartDay={monthStartDay}
              />
            </div>

            <Dialog
              open={categoryBreakdownOpen}
              onOpenChange={setCategoryBreakdownOpen}
            >
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>
                    Category breakdown
                    {branchFilterId
                      ? ` · ${branchNameById[branchFilterId] ?? "Branch"}`
                      : " · All branches"}
                  </DialogTitle>
                </DialogHeader>
                <ScrollArea className="max-h-[60vh] pr-3">
                  <div className="divide-y">
                    {categoryBreakdown.length === 0 && (
                      <p className="text-sm text-muted-foreground py-6 text-center">
                        No expenses match the current filters.
                      </p>
                    )}
                    {categoryBreakdown.map((row) => {
                      const name =
                        row.categoryId === "uncategorized"
                          ? "Uncategorized"
                          : categories.find((c) => c.id === row.categoryId)
                              ?.name ?? "Unknown category";
                      return (
                        <button
                          key={row.categoryId}
                          type="button"
                          className="w-full text-left py-2 px-1 hover:bg-muted/60 rounded-md transition-colors"
                          onClick={() => {
                            setCategoryBreakdownOpen(false);
                            drillDown({ categoryId: row.categoryId });
                          }}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-medium">{name}</span>
                            <span className="text-sm font-semibold">
                              {formatCurrency(row.total)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3 mt-0.5">
                            <span className="text-[11px] text-muted-foreground">
                              {row.count} entries
                            </span>
                            <span className="text-[11px]">
                              <span className="text-emerald-600">
                                {formatCurrency(row.paid)} paid
                              </span>
                              {" · "}
                              <span className="text-amber-600">
                                {formatCurrency(row.unpaid)} unpaid
                              </span>
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </ScrollArea>
              </DialogContent>
            </Dialog>

            <SalesReconciliationCard
              restaurantId={restaurant?.id}
              dateFrom={filters.dateFrom}
              dateTo={filters.dateTo}
              branchId={branchFilterId}
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <CumulativeExpenseChart
                restaurantId={restaurant?.id}
                dateFrom={filters.dateFrom}
                dateTo={filters.dateTo}
                branchId={branchFilterId}
              />
              <DailyExpenseBarChart
                restaurantId={restaurant?.id}
                dateFrom={filters.dateFrom}
                dateTo={filters.dateTo}
                branchId={branchFilterId}
              />
            </div>

            <BranchSpendingTrendChart
              restaurantId={restaurant?.id}
              branchId={branchFilterId}
              filters={filters}
              branches={branches ?? []}
            />

            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 skeleton-shimmer rounded" />
                ))}
              </div>
            ) : expenses.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <TrendingDown className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No expenses found</p>
                <p className="text-sm mt-1">
                  {filters.search ||
                  filters.categoryId ||
                  filters.dateFrom ||
                  filters.dateTo ||
                  filters.amountMin ||
                  filters.amountMax
                    ? "Try adjusting your filters"
                    : 'Click "Record Expense" to add one'}
                </p>
              </div>
            ) : (
              <>
                {/* Bulk Action Bar */}
                {selectedExpenseIds.size > 0 && (
                  <div className="flex items-center justify-between p-3 mb-4 rounded-lg border bg-muted/50">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium">
                        {selectedExpenseIds.size} selected
                        {selectedUnpaidCount > 0 &&
                          selectedUnpaidCount < selectedExpenseIds.size && (
                            <span className="text-muted-foreground ml-1">
                              ({selectedUnpaidCount} unpaid)
                            </span>
                          )}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearSelection}
                        className="h-7 px-2 text-muted-foreground"
                      >
                        <X className="h-3.5 w-3.5 mr-1" />
                        Clear
                      </Button>
                    </div>
                    {canMarkExpensesPaid ? (
                      <Button
                        size="sm"
                        onClick={handleBulkMarkAsPaid}
                        disabled={
                          selectedUnpaidCount === 0 ||
                          bulkMarkAsPaidMutation.isPending
                        }
                        className="gap-1.5"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        {bulkMarkAsPaidMutation.isPending
                          ? "Updating..."
                          : `Mark ${selectedUnpaidCount} as Paid`}
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Accountant review required to mark paid
                      </span>
                    )}
                  </div>
                )}

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={
                            unpaidExpensesOnPage.length > 0 &&
                            unpaidExpensesOnPage.every((e) =>
                              selectedExpenseIds.has(e.id)
                            )
                          }
                          onCheckedChange={handleSelectAll}
                          aria-label="Select all unpaid expenses"
                          disabled={unpaidExpensesOnPage.length === 0}
                        />
                      </TableHead>
                      <TableHead>Date</TableHead>
                      {hasMultipleBranches && (
                        <TableHead className="w-[150px]">Branch</TableHead>
                      )}
                      <TableHead>Category</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="w-10"></TableHead>
                      <TableHead className="w-20"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {expenses.map((expense) => (
                      <Fragment key={expense.id}>
                      <TableRow
                        key={expense.id}
                        data-state={
                          selectedExpenseIds.has(expense.id)
                            ? "selected"
                            : undefined
                        }
                      >
                        <TableCell>
                          <Checkbox
                            checked={selectedExpenseIds.has(expense.id)}
                            onCheckedChange={(checked) =>
                              handleSelectExpense(expense.id, !!checked)
                            }
                            aria-label={`Select expense ${
                              expense.description || expense.id
                            }`}
                            disabled={expense.status === "paid"}
                          />
                        </TableCell>
                        <TableCell className="font-medium">
                          {format(
                            new Date(expense.expense_date),
                            "MMM d, yyyy"
                          )}
                        </TableCell>
                        {hasMultipleBranches && (
                          <TableCell className="w-[150px] max-w-[150px]">
                            <BranchBadge
                              size="sm"
                              branchId={expense.branch_id}
                              name={
                                expense.branch_id
                                  ? branchNameById[expense.branch_id] ??
                                    "Unknown"
                                  : null
                              }
                              untaggedLabel="Unassigned"
                            />
                          </TableCell>
                        )}
                        <TableCell>
                          {expense.expense_categories ? (
                            <Badge
                              variant="secondary"
                              className="gap-1"
                              style={{
                                borderLeft: `3px solid ${
                                  expense.expense_categories.color || "#888"
                                }`,
                              }}
                            >
                              {expense.expense_categories.name}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {expense.description || "-"}
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const total = Number(expense.amount) || 0;
                            const paid =
                              Number((expense as any).paid_amount) || 0;
                            const pending = Math.max(0, total - paid);
                            const isPartial =
                              expense.status === "unpaid" &&
                              paid > 0 &&
                              paid < total;
                            if (expense.status === "unpaid") {
                              return (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="flex flex-col gap-0.5 cursor-help">
                                      <Badge
                                        variant="outline"
                                        className="gap-1 border-amber-500 text-amber-600 bg-amber-50 w-fit"
                                      >
                                        <Clock className="h-3 w-3" />
                                        {isPartial ? "Partial" : "Unpaid"}
                                      </Badge>
                                      {isPartial && (
                                        <span className="text-[10px] text-muted-foreground tabular-nums leading-tight">
                                          Paid {paid.toFixed(2)} · Pending{" "}
                                          {pending.toFixed(2)}
                                        </span>
                                      )}
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent
                                    side="top"
                                    className="max-w-xs space-y-1"
                                  >
                                    <p className="font-medium text-xs">
                                      {isPartial
                                        ? "Partial payment"
                                        : "Unpaid / credit purchase"}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {isPartial
                                        ? "Part of this bill has been settled. The remaining balance is still credited to Accounts Payable until fully paid."
                                        : "The ledger debits the expense/inventory account and credits the supplier's own payable head (auto-created under 2000 Accounts Payable), creating a supplier balance."}
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              );
                            }
                            return (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge
                                    variant="outline"
                                    className="gap-1 border-green-500 text-green-600 bg-green-50 w-fit cursor-help"
                                  >
                                    <CheckCircle2 className="h-3 w-3" />
                                    Paid
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent
                                  side="top"
                                  className="max-w-xs space-y-1"
                                >
                                  <p className="font-medium text-xs">
                                    Paid / settled
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    The ledger debits the expense/inventory
                                    account and credits Cash or Bank. No
                                    Accounts Payable was created because the
                                    bill was settled immediately.
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {Number(expense.amount).toFixed(2)} SAR
                        </TableCell>
                        <TableCell>
                          <ReceiptThumbnail receiptUrl={expense.receipt_url} />
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {(isOwner || isManager || isAccountant || roles.some((r) => r.role === "superadmin")) &&
                              expense.ledger_posted !== true && (
                                <AiExpenseJournalButton
                                  expenseId={expense.id}
                                  disabled={!expense.description}
                                />
                              )}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  asChild
                                >
                                  <RouterLink
                                    to={`/reports/ledger-mapping?expense=${expense.id}&from=${format(
                                      startOfMonth(new Date(expense.expense_date)),
                                      "yyyy-MM-dd"
                                    )}&to=${format(
                                      endOfMonth(new Date(expense.expense_date)),
                                      "yyyy-MM-dd"
                                    )}`}
                                  >
                                    <ArrowRightLeft className="h-4 w-4" />
                                  </RouterLink>
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>View Ledger Mapping</TooltipContent>
                            </Tooltip>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => openEditExpense(expense)}
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => setTimelineExpense(expense)}
                                >
                                  <History className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                Payment & settlement timeline
                              </TooltipContent>
                            </Tooltip>
                            {isManager && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => setDeletingExpense(expense)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  aria-expanded={expandedLedgerIds.has(expense.id)}
                                  aria-label="Show journal lines"
                                  onClick={() => toggleLedgerRow(expense.id)}
                                >
                                  {expandedLedgerIds.has(expense.id) ? (
                                    <ChevronUp className="h-4 w-4" />
                                  ) : (
                                    <ChevronDown className="h-4 w-4" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                Journal lines posted for this expense
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        </TableCell>
                      </TableRow>
                      {expandedLedgerIds.has(expense.id) && (
                        <TableRow className="bg-muted/20 hover:bg-muted/20">
                          <TableCell colSpan={hasMultipleBranches ? 9 : 8} className="p-3">
                            <ExpensePostingStatusPanel
                              expenseId={expense.id}
                              ledgerPosted={(expense as any).ledger_posted}
                              branchId={expense.branch_id}
                            />
                            <div className="mt-3">
                              <ExpenseAmendmentAuditPanel expenseId={expense.id} />
                            </div>

                          </TableCell>
                        </TableRow>
                      )}
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>

                {/* Pagination */}
                <ExpensePagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  pageSize={pageSize}
                  totalItems={totalCount}
                  onPageChange={setCurrentPage}
                  onPageSizeChange={handlePageSizeChange}
                />
              </>
            )}
          </div>
        </div>
      </div>
      <ApSettlementReversalDialog
        open={!!reversalTarget}
        onOpenChange={(o) => !o && setReversalTarget(null)}
        expenseId={reversalTarget?.id ?? null}
        expenseDescription={reversalTarget?.description ?? null}
        amountLabel={
          reversalTarget
            ? formatCurrency(Number(reversalTarget.amount) || 0)
            : null
        }
        authorized={canReverseSettlement}
        onReversed={() => {
          setReversalTarget(null);
          setEditingExpense(null);
          queryClient.invalidateQueries({ queryKey: ["expenses"] });
        }}
      />
      <ExpenseSettlementTimeline
        open={!!timelineExpense}
        onOpenChange={(o) => !o && setTimelineExpense(null)}
        expenseId={timelineExpense?.id ?? null}
        expenseDescription={timelineExpense?.description ?? null}
      />
      <VerifyPostingDialog
        open={verifyPostingOpen}
        onOpenChange={setVerifyPostingOpen}
        branchId={branchFilterId}
        from={filters.dateFrom || null}
        to={filters.dateTo || null}
      />
      <BulkApSettlementPreviewDialog
        open={bulkPreviewOpen}
        onOpenChange={setBulkPreviewOpen}
        expenses={bulkPreviewExpenses}
        isPending={bulkMarkAsPaidMutation.isPending}
        paymentAccountId={bulkPaymentAccountId}
        onPaymentAccountChange={setBulkPaymentAccountId}
        onConfirm={() => {
          if (!bulkPaymentAccountId) {
            toast.error("Choose which account is paying first");
            return;
          }
          bulkMarkAsPaidMutation.mutate(
            {
              expenseIds: bulkPreviewExpenses.map((e) => e.id),
              paymentAccountId: bulkPaymentAccountId,
            },
            { onSettled: () => setBulkPreviewOpen(false) }
          );
        }}
      />
    </>
  );
}
