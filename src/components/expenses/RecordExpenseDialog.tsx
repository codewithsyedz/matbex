import { validatePaymentAccount } from "@/lib/paymentAccountRules";
import { useState, useEffect } from "react";
import {
  checkExpenseNotFixedAsset,
  explainPostingError,
  type RuleViolation,
} from "@/lib/accountPostingRules";
import { PostingRuleAlert } from "@/components/accounting/PostingRuleAlert";
import {
  FixedAssetQuickLink,
  type CapexReference,
} from "@/components/accounting/FixedAssetQuickLink";
import {
  clearCapexHandoff,
  describeResolution,
  persistCapexDraft,
  readCapexHandoff,
  setCapexLink as persistCapexLink,
  type CapexHandoff,
} from "@/lib/capexHandoff";
import { useRecordPostingRejection } from "@/hooks/usePostingRejections";
import {
  parseLedgerValidationError,
  type ParsedLedgerValidationError,
} from "@/lib/ledgerValidationError";
import { LedgerValidationAlert } from "@/components/expenses/LedgerValidationAlert";
import { toast } from "sonner";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useExpenseApproval, PaymentMethod } from "@/hooks/useExpenseApproval";
import { useFeatureFlag } from "@/hooks/useFeatureFlags";
import { useImpersonationGuard } from "@/hooks/useImpersonationGuard";
import { useResolveBranchAccount } from "@/hooks/useResolveBranchAccount";
import {
  useAllAccountBranchVisibility,
  buildVisibilityIndex,
  isAccountVisible,
} from "@/hooks/useAccountBranchVisibility";
import { ReceiptUploaderField } from "@/components/expenses/ReceiptUploaderField";
import { VatSplitField } from "@/components/accounting/VatSplitField";
import { splitVat, validateVatConsistency } from "@/lib/vatSplit";
import { useBranchVatRate } from "@/hooks/useBranchVatRate";
import {
  Loader2,
  Receipt,
  AlertCircle,
  Package,
  BookOpen,
  ArrowUp,
  ArrowDown,
  ListPlus,
  Settings2,
  Check,
  ChevronsUpDown,
} from "lucide-react";
import { Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
} from "@/components/ui/alert-dialog";
import {
  ExpenseLineItemsEditor,
  ExpenseLineItem,
  makeEmptyLine,
} from "@/components/expenses/ExpenseLineItemsEditor";
import { QuickAddInventoryItemDialog } from "@/components/expenses/QuickAddInventoryItemDialog";
import { ExpenseStatusField } from "@/components/expenses/ExpenseStatusField";
import {
  ExpenseFundingSourceDialog,
  type FundingSelection,
} from "@/components/expenses/ExpenseFundingSourceDialog";
import { getPaymentMethodStatusWarning } from "@/lib/expensePaymentValidation";
import { useTranslation } from "react-i18next";

/**
 * Categories whose expenses should always flow through inventory so that
 * Inventory Purchases, WAC and stock-on-hand stay in sync with what was
 * actually bought. Matched against the category name (case-insensitive).
 * Keep this list aligned with the COGS/asset rules in coaRecommendation.ts.
 */
const INVENTORY_BACKED_CATEGORY_RE =
  /\b(meat|chicken|beef|lamb|mutton|fish|seafood|poultry|food|ingredient|produce|vegetables?|veg|fruits?|groceries|grocery|spices?|flour|rice|bread|oils?|dairy|milk|cheese|yog(?:h)?urt|cream|butter|labneh|ghee|beverages?|drinks?|sodas?|juices?|waters?|coffee|tea|gas|cylinder|propane|lpg|packaging|container|wrap|napkin|disposable|takeaway|bag)\b/i;
interface RecordExpenseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultCategoryId?: string | null;
}

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "cash" },
  { value: "card", label: "card" },
  { value: "bank_transfer", label: "bank_transfer" },
  { value: "cheque", label: "cheque" },
  { value: "other", label: "other" },
];

export function RecordExpenseDialog({
  open,
  onOpenChange,
  defaultCategoryId,
}: RecordExpenseDialogProps) {
  const { restaurant, profile, hasRole } = useAuth();
  const { t } = useTranslation();
  const { activeBranchId, branches, canSwitchBranches, pinnedBranchId } =
    useBranch();
  // Branch this expense is recorded against. Defaults to the active branch and
  // can be changed by owners/managers when the tenant has multiple branches.
  const [branchId, setBranchId] = useState<string | null>(null);
  const isCashierOnly =
    hasRole("cashier") &&
    !hasRole("owner") &&
    !hasRole("manager") &&
    !hasRole("accountant");
  const navigate = useNavigate();
  const { createExpense } = useExpenseApproval();
  const guardWrite = useImpersonationGuard();
  const recordRejection = useRecordPostingRejection();
  const { resolve: resolveBranchAccount } = useResolveBranchAccount();
  const tenantId = profile?.tenant_id;
  const { data: visibilityRows = [] } = useAllAccountBranchVisibility();
  const queryClient = useQueryClient();
  const [quickAddItemOpen, setQuickAddItemOpen] = useState(false);
  // Branch used for filtering categories/suppliers/accounts and for the saved row.
  const selectableBranches = branches.filter((b: any) => b.is_active !== false);
  const effectiveBranchId =
    branchId ?? pinnedBranchId ?? activeBranchId ?? null;
  // Remote feature flag — admins can toggle itemized invoices from /admin/feature-flags.
  // Defaults to true so existing behavior is preserved if the flag isn't created.
  const itemizedInvoicesEnabled = useFeatureFlag("itemized_invoices", true);

  // Form state
  const [amount, setAmount] = useState("");
  // VAT net/input split — the typed amount is the gross settled with the supplier.
  const [vatEnabled, setVatEnabled] = useState(false);
  const [vatInclusive, setVatInclusive] = useState(true);
  const [vatRatePercent, setVatRatePercent] = useState("");
  const [description, setDescription] = useState("");
  const [expenseDate, setExpenseDate] = useState(
    format(new Date(), "yyyy-MM-dd")
  );
  const [categoryId, setCategoryId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [status, setStatus] = useState<"paid" | "unpaid">(
    isCashierOnly ? "unpaid" : "paid"
  );
  const [funding, setFunding] = useState<FundingSelection>({
    fundingSource: "company",
    paymentAccountId: null,
    capitalAccountId: null,
  });
  const [fundingOpen, setFundingOpen] = useState(false);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [isReceiptUploading, setIsReceiptUploading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [ruleViolation, setRuleViolation] = useState<RuleViolation | null>(null);
  // Last ledger-rejected posting, kept verbatim so it can be retried as-is
  // once the chart of accounts / mapping is corrected.
  const [ledgerError, setLedgerError] =
    useState<ParsedLedgerValidationError | null>(null);
  const [retryPayload, setRetryPayload] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [autoRetry, setAutoRetry] = useState(true);
  // Fixed Asset Register quick-link: the project / CIP entry this expense is
  // capitalised against, plus the outcome of a round-trip to the register.
  const [capexLink, setCapexLink] = useState<CapexReference | null>(null);
  const [capexHandoff, setCapexHandoff] = useState<CapexHandoff | null>(null);
  const [inventoryItemId, setInventoryItemId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [movementType, setMovementType] = useState<"purchase" | "usage">(
    "purchase"
  );
  const [stockChangeUnits, setStockChangeUnits] = useState<string>("");
  const [movementReason, setMovementReason] = useState<string>("");
  // Multi-line invoice mode
  const [itemizedMode, setItemizedMode] = useState(false);
  const [lineItems, setLineItems] = useState<ExpenseLineItem[]>([]);
  const [showMissingAccountConfirm, setShowMissingAccountConfirm] =
    useState(false);
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");

  // Fetch expense categories with linked account_id
  const { data: categories = [] } = useQuery({
    queryKey: ["expense-categories", restaurant?.id, effectiveBranchId],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await db
        .from("expense_categories")
        .select(
          "id, name, color, account_id, branch_id, default_inventory_item_id"
        )
        .eq("restaurant_id", restaurant.id)
        .order("name");
      if (error) throw error;
      const rows = (data || []) as Array<{
        id: string;
        name: string;
        color: string | null;
        account_id: string | null;
        branch_id: string | null;
        default_inventory_item_id: string | null;
      }>;
      const visible = rows.filter(
        (r) => !r.branch_id || r.branch_id === effectiveBranchId
      );
      const byName = new Map<string, (typeof visible)[number]>();
      for (const r of visible) {
        const key = r.name.toLowerCase();
        const existing = byName.get(key);
        if (!existing || (r.branch_id && !existing.branch_id))
          byName.set(key, r);
      }
      return Array.from(byName.values());
    },
    enabled: !!restaurant?.id && open,
  });

  // Fetch active suppliers for the optional supplier picker
  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers-active", restaurant?.id, effectiveBranchId],
    queryFn: async () => {
      if (!restaurant?.id) return [] as Array<{ id: string; name: string }>;
      const { data, error } = await db
        .from("suppliers")
        .select("id, name, is_active, branch_id")
        .eq("restaurant_id", restaurant.id)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      const rows = (data || []) as Array<{
        id: string;
        name: string;
        branch_id: string | null;
      }>;
      const visible = rows.filter(
        (r) => !r.branch_id || r.branch_id === effectiveBranchId
      );
      const byName = new Map<
        string,
        { id: string; name: string; branch_id: string | null }
      >();
      for (const r of visible) {
        const key = r.name.toLowerCase();
        const existing = byName.get(key);
        if (!existing || (r.branch_id && !existing.branch_id))
          byName.set(key, r);
      }
      return Array.from(byName.values()).map(({ id, name }) => ({ id, name }));
    },
    enabled: !!restaurant?.id && open,
  });

  const { data: expenseAccounts = [] } = useQuery({
    queryKey: ["expense-accounts", tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await db
        .from("chart_of_accounts")
        .select("id, account_code, account_name, account_type")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .in("account_type", ["cogs", "expense"]) // Include COGS (5000s) + Expense (6000s)
        .order("account_code");
      if (error) throw error;
      return data;
    },
    enabled: !!tenantId && open,
  });

  // Apply per-branch visibility rules.
  // When "All branches" is active (activeBranchId === null), show every account.
  // When a specific branch is active, hide accounts restricted to other branches.
  const visibilityIndex = buildVisibilityIndex(visibilityRows);
  const visibleExpenseAccounts = expenseAccounts.filter((a: any) =>
    isAccountVisible(visibilityIndex, a.id, effectiveBranchId)
  );

  // Reset the branch to the current scope each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setBranchId(
      pinnedBranchId ??
        activeBranchId ??
        selectableBranches.find((b: any) => b.is_primary)?.id ??
        selectableBranches[0]?.id ??
        null
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pinnedBranchId, activeBranchId, branches]);

  // Coming back from the Fixed Asset Register: restore what was typed before
  // the jump and surface what the register decided.
  useEffect(() => {
    if (!open) return;
    const handoff = readCapexHandoff();
    setCapexHandoff(handoff);
    if (!handoff) return;
    const d = handoff.draft ?? {};
    if (d.description) setDescription(d.description);
    if (d.amount) setAmount(d.amount);
    if (d.expenseDate) setExpenseDate(d.expenseDate);
    if (d.categoryId) setCategoryId(d.categoryId);
    if (d.branchId) setBranchId(d.branchId);
    if (d.accountId) setAccountId(d.accountId);
    if (d.supplierId) setSupplierId(d.supplierId);
    if (d.paymentMethod) setPaymentMethod(d.paymentMethod as PaymentMethod);
    if (d.status && !isCashierOnly) setStatus(d.status);
    if (d.fundingSource || d.paymentAccountId || d.capitalAccountId) {
      setFunding({
        fundingSource: (d.fundingSource ?? "company") as FundingSelection["fundingSource"],
        paymentAccountId: d.paymentAccountId ?? null,
        capitalAccountId: d.capitalAccountId ?? null,
      });
    }
    if (d.vatRatePercent) {
      setVatEnabled(true);
      setVatRatePercent(d.vatRatePercent);
      setVatInclusive(d.vatInclusive ?? true);
    }
    if (handoff.link?.projectId) {
      setCapexLink({
        projectId: handoff.link.projectId,
        projectName: handoff.link.projectName,
      });
    }
    if (handoff.resolution?.kind === "referenced" && handoff.resolution.projectId) {
      setCapexLink({
        projectId: handoff.resolution.projectId,
        projectName: handoff.resolution.projectName ?? "Linked project",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Auto-select an account when accounts load (fallback): the first operating expense
  // (6000s), not the first by code, which is a COGS account (5000) meant for stock
  // purchases.
  useEffect(() => {
    if (expenseAccounts.length > 0 && !accountId && !categoryId) {
      const operating = expenseAccounts.find((a) => a.account_type === "expense");
      setAccountId((operating ?? expenseAccounts[0]).id);
    }
  }, [expenseAccounts, accountId, categoryId]);

  // Auto-select account based on selected category
  useEffect(() => {
    if (categoryId && categories.length > 0) {
      const selectedCategory = categories.find((c) => c.id === categoryId);
      if (selectedCategory?.account_id) {
        // Verify the account exists in our list
        const accountExists = expenseAccounts.some(
          (a) => a.id === selectedCategory.account_id
        );
        if (accountExists) {
          setAccountId(selectedCategory.account_id);
        }
      } else if (selectedCategory) {
        // Category has no mapped account → clear the auto-selected one so the
        // user is forced to pick an account on purpose instead of silently
        // inheriting whatever was selected before.
        setAccountId("");
      }
    }
  }, [categoryId, categories, expenseAccounts]);

  // Fetch inventory items for linking expenses to stock
  const { data: inventoryItems = [] } = useQuery({
    queryKey: ["inventory-items-expense", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id)
        return [] as Array<{
          id: string;
          name: string;
          unit: string | null;
          unit_cost: number | null;
          category_id: string | null;
          default_cogs_account_id: string | null;
          current_stock: number | null;
          units_per_pack: number | null;
          stock_unit: string | null;
        }>;
      // Use any to avoid deep type instantiation issues with complex the API schema
      const sb = db as any;
      const result = await sb
        .from("inventory_items")
        .select(
          "id, name, unit, unit_cost, category_id, default_cogs_account_id, current_stock, units_per_pack, stock_unit"
        )
        .eq("restaurant_id", restaurant.id)
        .eq("is_active", true)
        .order("name");
      if (result.error) throw result.error;
      return (result.data || []) as Array<{
        id: string;
        name: string;
        unit: string | null;
        unit_cost: number | null;
        category_id: string | null;
        default_cogs_account_id: string | null;
        current_stock: number | null;
        units_per_pack: number | null;
        stock_unit: string | null;
      }>;
    },
    enabled: !!restaurant?.id && open,
  });

  // Cash/bank accounts, used to validate the chosen paying account.
  const { data: allAccounts = [] } = useQuery({
    queryKey: ["payment-accounts", tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await db
        .from("chart_of_accounts")
        .select("id, account_code, account_name, account_type, is_active")
        .eq("tenant_id", tenantId)
        .eq("account_type", "asset")
        .order("account_code");
      if (error) throw error;
      return data;
    },
    enabled: !!tenantId && open,
  });

  // Auto-select inventory item when category changes (match by name, case-insensitive)
  useEffect(() => {
    if (!categoryId || categories.length === 0 || inventoryItems.length === 0)
      return;
    const selectedCategory = categories.find((c) => c.id === categoryId);
    if (!selectedCategory) return;
    const match = inventoryItems.find(
      (item) =>
        item.name.trim().toLowerCase() ===
        selectedCategory.name.trim().toLowerCase()
    );
    if (match) {
      setInventoryItemId(match.id);
      // Fallback: if account wasn't set by category mapping, use inventory's COGS account
      if (match.default_cogs_account_id && !selectedCategory.account_id) {
        const accountExists = expenseAccounts.some(
          (a) => a.id === match.default_cogs_account_id
        );
        if (accountExists) setAccountId(match.default_cogs_account_id);
      }
    }
  }, [categoryId, categories, inventoryItems, expenseAccounts]);

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setAmount("");
      setDescription("");
      setExpenseDate(format(new Date(), "yyyy-MM-dd"));
      setCategoryId("");
      setAccountId("");
      setPaymentMethod("cash");
      setStatus(isCashierOnly ? "unpaid" : "paid");
      setReceiptUrl(null);
      setValidationError(null);
      setInventoryItemId("");
      setQuantity("1");
      setMovementType("purchase");
      setStockChangeUnits("");
      setMovementReason("");
      setItemizedMode(false);
      setLineItems([]);
      setSupplierId("");
    }
  }, [open, isCashierOnly]);

  useEffect(() => {
    if (open && isCashierOnly) {
      setStatus("unpaid");
    }
  }, [open, isCashierOnly]);

  // Apply default category when dialog opens (for quick-add buttons)
  useEffect(() => {
    if (open && defaultCategoryId) {
      setCategoryId(defaultCategoryId);
    }
  }, [open, defaultCategoryId]);

  // Inventory-backed categories (meat, dairy, gas, packaging, etc.) MUST
  // post through inventory so the Inventory Purchase screen and WAC stay
  // accurate. Detected from the category name.
  const selectedCategory = categoryId
    ? categories.find((c) => c.id === categoryId)
    : undefined;
  const requiresInventoryLink = !!(
    selectedCategory &&
    INVENTORY_BACKED_CATEGORY_RE.test(selectedCategory.name || "")
  );
  const inventoryLinkSatisfied =
    !requiresInventoryLink || itemizedMode || !!inventoryItemId;

  // ── VAT net / input split ────────────────────────────────────────────────
  // The amount field is what the supplier is paid (gross when VAT inclusive).
  // `net` hits the expense/inventory account, `vat` hits 1180 Input VAT.
  const { vatPercent: branchVatPercent } = useBranchVatRate(effectiveBranchId);
  const grossAmountEntered = itemizedMode
    ? lineItems.reduce(
        (s, li) =>
          s + (parseFloat(li.quantity) || 0) * (parseFloat(li.unit_cost) || 0),
        0
      )
    : parseFloat(amount) || 0;
  const effectiveVatRate =
    vatRatePercent !== "" ? parseFloat(vatRatePercent) || 0 : branchVatPercent;
  const vatSplit = splitVat({
    amount: grossAmountEntered,
    ratePercent: effectiveVatRate,
    inclusive: vatInclusive,
    vatEnabled,
  });

  // Rate / amount consistency — surfaced inline and re-checked on submit.
  const vatConsistency = validateVatConsistency({
    split: vatSplit,
    ratePercent: vatRatePercent !== "" ? vatRatePercent : branchVatPercent || "",
    enteredAmount: grossAmountEntered,
    inclusive: vatInclusive,
    branchRatePercent: branchVatPercent,
  });

  // Seed the rate box from the branch VAT setting the first time VAT is enabled.
  useEffect(() => {
    if (vatEnabled && vatRatePercent === "" && branchVatPercent > 0) {
      setVatRatePercent(String(branchVatPercent));
    }
  }, [vatEnabled, branchVatPercent, vatRatePercent]);

  // Auto-suggest: when a category with a configured default inventory item is
  // selected and the user hasn't already picked one, prefill the link.
  useEffect(() => {
    if (!open) return;
    if (itemizedMode) return;
    if (inventoryItemId) return;
    const def = (selectedCategory as any)?.default_inventory_item_id as
      | string
      | null
      | undefined;
    if (def) {
      setInventoryItemId(def);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedCategory?.id]);

  // The draft we hand to the Fixed Asset Register — also what we persist so a
  // navigation away and back lands on the exact same context.
  const capexDraft = {
    description,
    amount,
    expenseDate,
    categoryId: categoryId || null,
    branchId: effectiveBranchId,
    vatRatePercent: vatEnabled ? vatRatePercent : null,
    vatInclusive,
    accountId: accountId || null,
    accountLabel:
      (expenseAccounts.find((a: any) => a.id === accountId) as any)
        ? `${(expenseAccounts.find((a: any) => a.id === accountId) as any).account_code} · ${(expenseAccounts.find((a: any) => a.id === accountId) as any).account_name}`
        : null,
    supplierId: supplierId || null,
    paymentMethod,
    status,
    fundingSource: funding.fundingSource,
    paymentAccountId: funding.paymentAccountId,
    capitalAccountId: funding.capitalAccountId,
  };

  // Keep the stored context fresh while a capex guard is blocking the save.
  const capexGuardActive =
    ruleViolation?.rule === "expense_to_fixed_asset" ||
    ruleViolation?.rule === "partner_account_as_expense";
  useEffect(() => {
    if (!open || !capexGuardActive) return;
    persistCapexDraft(
      capexDraft,
      `${window.location.pathname}${window.location.search}`,
      capexLink,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    capexGuardActive,
    description,
    amount,
    expenseDate,
    categoryId,
    effectiveBranchId,
    accountId,
    supplierId,
    paymentMethod,
    status,
    vatEnabled,
    vatRatePercent,
    vatInclusive,
    funding.fundingSource,
    funding.paymentAccountId,
    funding.capitalAccountId,
    capexLink?.projectId,
  ]);

  const handleSubmit = async () => {
    if (!guardWrite("record an expense")) return;
    setValidationError(null);
    setRuleViolation(null);

    // Hard rule: never let an expense be capitalised to a fixed asset account
    // or charged to a partner loan/capital account. Mirrors the DB triggers.
    if (accountId) {
      const picked = expenseAccounts.find((a) => a.id === accountId);
      const violation = checkExpenseNotFixedAsset(picked as any, {
        projectId: capexLink?.projectId ?? null,
      });
      if (violation) {
        setRuleViolation(violation);
        recordRejection(violation, {
          source: "expense_form",
          origin: "client",
          entityType: "expense",
          attemptedAmount: parseFloat(amount) || null,
          attemptedDate: expenseDate || null,
          branchId: effectiveBranchId,
          fields: [
            {
              field: "account_id",
              label: "Expense account",
              value: picked ? `${picked.account_code} · ${picked.account_name}` : accountId,
            },
            { field: "category_id", label: "Category", value: categoryId || null },
            { field: "amount", label: "Amount", value: amount || null },
            { field: "payment_method", label: "Payment method", value: paymentMethod || null },
          ],
          values: { description, expense_date: expenseDate, itemized: itemizedMode },
        });
        return;
      }
    }

    // Blocking confirmation: category selected, has no account mapping,
    // and the user hasn't manually picked an account either.
    // Skip for cashiers - they shouldn't deal with CoA mapping.
    if (!isCashierOnly && !accountId && categoryId) {
      const cat = categories.find((c) => c.id === categoryId);
      if (cat && !cat.account_id) {
        // Fire-and-forget tracking so admins can prioritize which categories
        // most need a default mapping.
        if (restaurant?.id) {
          (db as any)
            .from("expense_category_mapping_gaps")
            .insert({
              restaurant_id: restaurant.id,
              tenant_id: tenantId ?? null,
              category_id: cat.id,
              user_id: profile?.id ?? null,
              resolution: "unresolved",
            })
            .then(() => {});
        }
        setShowMissingAccountConfirm(true);
        return;
      }
    }

    // Itemized mode validates differently - total comes from the line items
    if (itemizedMode) {
      if (lineItems.length === 0) {
        setValidationError("Add at least one line item to the invoice");
        return;
      }
      if (lineItems.some((li) => !li.inventory_item_id)) {
        setValidationError(
          "Every line item must have an inventory item selected"
        );
        return;
      }
      if (lineItems.some((li) => !(parseFloat(li.quantity) > 0))) {
        setValidationError(
          "Every line item must have a quantity greater than 0"
        );
        return;
      }
      const itemizedTotal = lineItems.reduce(
        (s, li) =>
          s + (parseFloat(li.quantity) || 0) * (parseFloat(li.unit_cost) || 0),
        0
      );
      if (!(itemizedTotal > 0)) {
        setValidationError(
          "Invoice total must be greater than 0 - set a unit cost on at least one line"
        );
        return;
      }
    } else {
      // Single-line / no-inventory expense
      if (!amount || parseFloat(amount) <= 0) {
        setValidationError("Amount is mandatory and must be greater than 0");
        return;
      }
    }
    if (!expenseDate) {
      setValidationError("Date is mandatory");
      return;
    }
    if (vatEnabled) {
      if (!vatConsistency.valid) {
        setValidationError(
          vatConsistency.errors.map((i) => i.message).join(" "),
        );
        return;
      }
    }
    if (!paymentMethod) {
      setValidationError("Payment method is mandatory");
      return;
    }
    // Paid status must be backed by a real cash/bank outflow — a credit-style
    // payment method means the bill is still owed and belongs in Accounts Payable.
    const methodStatusIssue = getPaymentMethodStatusWarning(status, paymentMethod);
    if (methodStatusIssue?.level === "error") {
      setValidationError(`${methodStatusIssue.title}. ${methodStatusIssue.suggestion}`);
      return;
    }
    // Force inventory linkage for inventory-backed categories. Without this
    // the expense posts to COGS/ledger but never creates a `purchases` row,
    // so it never appears in Inventory Purchase / WAC.
    if (requiresInventoryLink && !itemizedMode && !inventoryItemId) {
      setValidationError(
        `"${selectedCategory?.name}" is an inventory-backed category. Pick an inventory item (or switch to itemized invoice mode) so the purchase is recorded against stock.`
      );
      return;
    }
    // For cashiers, auto-fallback to the first available expense account
    // so they don't have to think about CoA mapping.
    let effectiveAccountId = accountId;
    if (!effectiveAccountId && isCashierOnly && expenseAccounts.length > 0) {
      effectiveAccountId = expenseAccounts[0].id;
    }
    if (!effectiveAccountId) {
      setValidationError("Chart of Accounts mapping is mandatory");
      return;
    }

    // Route to a branch-specific sub-account if one exists.
    effectiveAccountId =
      (await resolveBranchAccount(effectiveAccountId, effectiveBranchId)) ||
      effectiveAccountId;

    // Ask which account is paying before a paid expense hits the ledger.
    if (
      !isCashierOnly &&
      status === "paid" &&
      !funding.paymentAccountId &&
      !funding.capitalAccountId
    ) {
      setFundingOpen(true);
      return;
    }

    // Only real cash/bank accounts may be credited as the paying account —
    // mirrors the database guard so the save fails fast with a clear reason.
    if (funding.paymentAccountId) {
      const payIssue = validatePaymentAccount(
        funding.paymentAccountId,
        allAccounts as any[]
      );
      if (payIssue) {
        setValidationError(`${payIssue.detail} ${payIssue.suggestion}`);
        setFundingOpen(true);
        return;
      }
    }

    const payload = {
        // Gross is what is owed/paid; the ledger splits net vs input VAT.
        amount: vatSplit.gross,
        vat_amount: vatSplit.vat,
        net_amount: vatSplit.net,
        vat_inclusive: vatInclusive,
        vat_rate: vatEnabled ? effectiveVatRate : null,
        vat_split_status: vatEnabled ? "applied" : "pending",
        description: description || undefined,
        expense_date: expenseDate,
        category_id: categoryId || undefined,
        branch_id: effectiveBranchId || undefined,
        project_id: capexLink?.projectId ?? undefined,
        account_id: effectiveAccountId,
        payment_method: paymentMethod,
        funding_source: funding.fundingSource,
        payment_account_id: funding.paymentAccountId,
        capital_account_id: funding.capitalAccountId,
        status: isCashierOnly ? "unpaid" : status,
        receipt_url: receiptUrl || undefined,
        supplier_id: supplierId || undefined,
        inventory_item_id: itemizedMode
          ? undefined
          : inventoryItemId || undefined,
        quantity: itemizedMode
          ? undefined
          : inventoryItemId
          ? parseFloat(quantity) || 1
          : undefined,
        movement_type: itemizedMode
          ? undefined
          : inventoryItemId
          ? movementType
          : undefined,
        stock_change_units: itemizedMode
          ? undefined
          : inventoryItemId && stockChangeUnits
          ? parseFloat(stockChangeUnits) || undefined
          : undefined,
        movement_reason: itemizedMode
          ? undefined
          : inventoryItemId
          ? movementReason || undefined
          : undefined,
      line_items: itemizedMode
        ? lineItems.map((li) => ({
            inventory_item_id: li.inventory_item_id,
            quantity: parseFloat(li.quantity) || 0,
            unit_cost: parseFloat(li.unit_cost) || 0,
            stock_change_units: li.stock_change_units
              ? parseFloat(li.stock_change_units) || undefined
              : undefined,
            movement_type: "purchase",
            movement_reason: li.movement_reason || undefined,
          }))
        : undefined,
    };

    submitPayload(payload);
  };

  /**
   * Sends the built payload. On a ledger-validation rejection the exact payload
   * is kept in state so the user can retry the identical posting after fixing
   * the mapping — no need to re-enter the amount, VAT split or line items.
   */
  const submitPayload = (payload: Record<string, unknown>) => {
    setLedgerError(null);
    createExpense.mutate(payload as any, {
      onSuccess: () => {
        clearCapexHandoff();
        setCapexHandoff(null);
        setCapexLink(null);
        setRetryPayload(null);
        setLedgerError(null);
        onOpenChange(false);
      },
      // Server-side triggers enforce the same rules; translate their raw
      // Postgres message into the same guided explanation.
      onError: (err: unknown) => {
        const explained = explainPostingError(err);
        if (explained) setRuleViolation(explained);
        const parsed = parseLedgerValidationError(err);
        if (parsed.isLedgerValidation) {
          setLedgerError(parsed);
          setRetryPayload(payload);
        }
        if (explained) {
          recordRejection(explained, {
            source: "expense_form",
            origin: "database",
            entityType: "expense",
            attemptedAmount: parseFloat(amount) || null,
            attemptedDate: expenseDate || null,
            branchId: effectiveBranchId,
            fields: [
              { field: "account_id", label: "Expense account", value: accountId || null },
              { field: "category_id", label: "Category", value: categoryId || null },
              { field: "amount", label: "Amount", value: amount || null },
              { field: "payment_method", label: "Payment method", value: paymentMethod || null },
            ],
            values: { description, expense_date: expenseDate, itemized: itemizedMode },
          });
        }
      },
    });
  };

  // Auto-retry: when the user goes off to fix the mapping (Chart of Accounts,
  // Fixed Asset Register, …) and comes back to this tab, re-post the exact
  // same payload once instead of making them re-enter the splits.
  useEffect(() => {
    if (!retryPayload || !autoRetry) return;
    const onFocus = async () => {
      if (createExpense.isPending) return;
      await queryClient.invalidateQueries({ queryKey: ["payment-accounts"] });
      await queryClient.invalidateQueries({ queryKey: ["chart-of-accounts"] });
      toast.info("Retrying the ledger posting with your saved entry…");
      submitPayload(retryPayload);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryPayload, autoRetry, createExpense.isPending]);

  const isSubmitting = createExpense.isPending;
  // Allow Save when account is empty IF a category is selected - so the
  // blocking confirmation dialog can fire and explain the missing mapping.
  // Otherwise still require an account up front.
  const accountReady = isCashierOnly || !!accountId || !!categoryId;
  const canSubmit = itemizedMode
    ? lineItems.length > 0 &&
      lineItems.every(
        (li) => li.inventory_item_id && (parseFloat(li.quantity) || 0) > 0
      ) &&
      expenseDate &&
      paymentMethod &&
      accountReady &&
      !isReceiptUploading
    : !!amount &&
      parseFloat(amount) > 0 &&
      expenseDate &&
      paymentMethod &&
      accountReady &&
      !isReceiptUploading &&
      inventoryLinkSatisfied;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden p-0 sm:max-w-[44rem]">
        <DialogHeader className="flex-shrink-0 px-6 pt-6">
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            {t("app.expenses.form.record")}
          </DialogTitle>
        </DialogHeader>

        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6 [-webkit-overflow-scrolling:touch] [scrollbar-color:hsl(var(--border))_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/80 [&::-webkit-scrollbar-track]:bg-transparent"
          style={{ scrollbarGutter: "stable" }}
        >
          <div className="space-y-4 pb-2 pt-4">
            {capexHandoff?.status === "resolved" && capexHandoff.resolution && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="flex flex-wrap items-center gap-2 text-sm">
                  <span>{describeResolution(capexHandoff.resolution)}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-7 text-xs"
                    onClick={() => {
                      clearCapexHandoff();
                      setCapexHandoff(null);
                    }}
                  >
                    Dismiss
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {ruleViolation && (
              <div className="space-y-2">
                <PostingRuleAlert
                  violation={ruleViolation}
                  onNavigate={() => onOpenChange(false)}
                />
                {(ruleViolation.rule === "expense_to_fixed_asset" ||
                  ruleViolation.rule === "partner_account_as_expense") && (
                  <FixedAssetQuickLink
                    branchId={effectiveBranchId}
                    linked={capexLink}
                    draft={capexDraft}
                    onLink={(reference) => {
                      setCapexLink(reference);
                      persistCapexDraft(
                        capexDraft,
                        `${window.location.pathname}${window.location.search}`,
                        reference,
                      );
                      setRuleViolation(null);
                      toast.success(
                        `Linked to ${reference.projectName} — save the expense again to post it.`,
                      );
                    }}
                    onUnlink={() => {
                      setCapexLink(null);
                      persistCapexLink(null);
                    }}
                    onNavigateAway={() => onOpenChange(false)}
                  />
                )}
              </div>
            )}

            {validationError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{validationError}</AlertDescription>
              </Alert>
            )}

            {ledgerError && retryPayload && (
              <div className="space-y-2">
                <LedgerValidationAlert
                  error={ledgerError}
                  onDismiss={() => {
                    setLedgerError(null);
                    setRetryPayload(null);
                  }}
                />
                <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/40 p-2 text-xs">
                  <span className="text-muted-foreground">
                    Your entry is saved here — fix the account mapping, then
                    retry the exact same posting.
                  </span>
                  <div className="ml-auto flex items-center gap-3">
                    <label className="flex items-center gap-2">
                      <Switch
                        checked={autoRetry}
                        onCheckedChange={setAutoRetry}
                      />
                      <span>{t("app.expenses.form.autoRetry")}</span>
                    </label>
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={isSubmitting}
                      onClick={() => submitPayload(retryPayload)}
                    >
                      {isSubmitting ? t("app.expenses.form.retrying") : t("app.expenses.form.retry")}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              {/* Amount - Mandatory */}
              <div className="space-y-2">
                <Label htmlFor="amount">
                  {t("app.expenses.form.amount")} <span className="text-destructive">*</span>
                  {itemizedMode && (
                    <span className="ml-2 text-[11px] text-muted-foreground font-normal">
                      ({t("app.expenses.form.autoAmount")})
                    </span>
                  )}
                </Label>
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={
                    itemizedMode
                      ? lineItems
                          .reduce(
                            (s, li) =>
                              s +
                              (parseFloat(li.quantity) || 0) *
                                (parseFloat(li.unit_cost) || 0),
                            0
                          )
                          .toFixed(2)
                      : amount
                  }
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  disabled={itemizedMode}
                  className={
                    itemizedMode
                      ? "bg-muted/40 cursor-not-allowed font-mono"
                      : ""
                  }
                />
              </div>

              {/* Date - Mandatory */}
              <div className="space-y-2">
                <Label htmlFor="date">
                  {t("app.expenses.form.date")} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="date"
                  type="date"
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                  max={format(new Date(), "yyyy-MM-dd")}
                />
              </div>
            </div>

            <VatSplitField
              split={vatSplit}
              vatEnabled={vatEnabled}
              issues={vatConsistency.issues}
              onVatEnabledChange={setVatEnabled}
              inclusive={vatInclusive}
              onInclusiveChange={setVatInclusive}
              ratePercent={
                vatRatePercent !== ""
                  ? vatRatePercent
                  : branchVatPercent
                  ? String(branchVatPercent)
                  : ""
              }
              onRatePercentChange={setVatRatePercent}
              kind="input"
              netAccountLabel={
                requiresInventoryLink ? "Inventory / COGS account" : "Expense account"
              }
            />

            {/* Branch - which branch this expense belongs to */}
            {selectableBranches.length > 1 && (
              <div className="space-y-2">
                <Label>
                  {t("app.expenses.form.branch")} <span className="text-destructive">*</span>
                </Label>
                {canSwitchBranches ? (
                  <Select
                    value={branchId ?? ""}
                    onValueChange={(v) => setBranchId(v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("app.expenses.form.selectBranch")} />
                    </SelectTrigger>
                    <SelectContent>
                      {selectableBranches.map((b: any) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                          {b.is_primary ? ` (${t("app.expenses.form.primary")})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                    <Building2 className="h-4 w-4" />
                    {selectableBranches.find(
                      (b: any) => b.id === effectiveBranchId
                    )?.name ?? t("app.expenses.form.yourBranch")}
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Categories, suppliers and accounts below are scoped to this
                  branch.
                </p>
              </div>
            )}

            {/* Payment Method - Mandatory */}
            <div className="space-y-2">
              <Label>
                {t("app.expenses.form.payment")} <span className="text-destructive">*</span>
              </Label>
              <Select
                value={paymentMethod}
                onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("app.expenses.form.selectPayment")} />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((method) => (
                    <SelectItem key={method.value} value={method.value}>
                      {t(`app.expenses.form.methods.${method.label}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* CoA Account - Mandatory (optional for cashiers) */}
            <div className={cn("space-y-2", isCashierOnly && "hidden")}>
              <Label>
                {t("app.expenses.form.account")}{" "}
                {!isCashierOnly && <span className="text-destructive">*</span>}
              </Label>
              {(() => {
                // Branch-aware: hide accounts that are restricted away from the active branch.
                const cogs = visibleExpenseAccounts.filter(
                  (a) => a.account_type === "cogs"
                );
                const exp = visibleExpenseAccounts.filter(
                  (a) => a.account_type === "expense"
                );
                const selected = expenseAccounts.find(
                  (a) => a.id === accountId
                );
                const mappedAccountIds = new Set(
                  categories
                    .map((c) => c.account_id)
                    .filter(Boolean) as string[]
                );
                const renderAccountItem = (
                  account: (typeof expenseAccounts)[number]
                ) => {
                  const isMapped = mappedAccountIds.has(account.id);
                  return (
                    <CommandItem
                      key={account.id}
                      value={`${account.account_code} ${account.account_name}`}
                      onSelect={() => {
                        setAccountId(account.id);
                        setAccountPickerOpen(false);
                      }}
                      className="group"
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          accountId === account.id ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <span className="font-mono text-xs me-2 text-muted-foreground">
                        {account.account_code}
                      </span>
                      <span className="flex-1 truncate">
                        {account.account_name}
                      </span>
                      {!isMapped && (
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            // Prevent CommandItem's onSelect from firing
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setAccountPickerOpen(false);
                            onOpenChange(false);
                            navigate(
                              `/accounting?focusAccount=${account.account_code}`
                            );
                          }}
                          title="No expense category maps to this account - open the Chart of Accounts to fix"
                          className="ml-2 inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 hover:bg-amber-500/20 dark:text-amber-400"
                        >
                          <Settings2 className="h-3 w-3" />
                          Fix mapping
                        </button>
                      )}
                    </CommandItem>
                  );
                };
                return (
                  <Popover
                    open={accountPickerOpen}
                    onOpenChange={setAccountPickerOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={accountPickerOpen}
                        className="w-full justify-between font-normal"
                      >
                        {selected ? (
                          <span className="flex items-center gap-2 truncate">
                            <span className="font-mono text-xs text-muted-foreground">
                              {selected.account_code}
                            </span>
                            <span className="truncate">
                              {selected.account_name}
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            Select expense account
                          </span>
                        )}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-[--radix-popover-trigger-width] p-0"
                      align="start"
                    >
                      <Command
                        filter={(value, search) => {
                          const v = value.toLowerCase();
                          const s = search.toLowerCase().trim();
                          if (!s) return 1;
                          return v.includes(s) ? 1 : 0;
                        }}
                      >
                        <CommandInput placeholder="Search by code or name (e.g. 5000, Beverage)" />
                        <CommandList>
                          <CommandEmpty>No accounts found.</CommandEmpty>
                          {cogs.length > 0 && (
                            <CommandGroup
                              heading={
                                <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider">
                                  <span>COGS (5000–)</span>
                                  <span className="font-mono opacity-70">
                                    {cogs.length}
                                  </span>
                                </div>
                              }
                            >
                              {cogs.map(renderAccountItem)}
                            </CommandGroup>
                          )}
                          {cogs.length > 0 && exp.length > 0 && (
                            <CommandSeparator />
                          )}
                          {exp.length > 0 && (
                            <CommandGroup
                              heading={
                                <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider">
                                  <span>Expenses (6000–)</span>
                                  <span className="font-mono opacity-70">
                                    {exp.length}
                                  </span>
                                </div>
                              }
                            >
                              {exp.map(renderAccountItem)}
                            </CommandGroup>
                          )}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                );
              })()}
              {expenseAccounts.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No expense accounts found. Please set up your Chart of
                  Accounts first.
                </p>
              )}
              {accountId &&
                (() => {
                  const selected = expenseAccounts.find(
                    (a) => a.id === accountId
                  );
                  if (!selected) return null;
                  const cat = categories.find((c) => c.id === categoryId);
                  // The category is what says whether this is a cost of goods or an overhead;
                  // without one there is nothing to check the account against.
                  if (!cat) return null;
                  const catName = (cat?.name || "").toLowerCase();
                  const cogsKeywords = [
                    "food",
                    "beverage",
                    "drink",
                    "ingredient",
                    "packaging",
                    "raw material",
                    "produce",
                    "meat",
                    "dairy",
                    "cogs",
                    "kitchen supply",
                  ];
                  const isCogsCategory = cogsKeywords.some((k) =>
                    catName.includes(k)
                  );
                  const expectedType: "cogs" | "expense" = isCogsCategory
                    ? "cogs"
                    : "expense";
                  const actualType = selected.account_type as
                    | "cogs"
                    | "expense";
                  if (actualType === expectedType) return null;

                  // Find best alternative of the expected type
                  const alternatives = expenseAccounts.filter(
                    (a) => a.account_type === expectedType
                  );
                  let suggestion = alternatives[0];
                  if (cat && alternatives.length > 0) {
                    const tokens = catName
                      .split(/\s+/)
                      .filter((t) => t.length > 2);
                    const scored = alternatives
                      .map((a) => {
                        const n = a.account_name.toLowerCase();
                        let s = 0;
                        for (const t of tokens) if (n.includes(t)) s += 10;
                        return { a, s };
                      })
                      .sort((x, y) => y.s - x.s);
                    suggestion = scored[0]?.a || alternatives[0];
                  }

                  const wrongLabel =
                    actualType === "cogs"
                      ? "COGS (5000s)"
                      : "Operating Expense (6000s)";
                  const rightLabel =
                    expectedType === "cogs"
                      ? "COGS (5000s)"
                      : "Operating Expense (6000s)";
                  const explanation =
                    expectedType === "expense"
                      ? "COGS accounts are reserved for direct cost of goods sold (food, beverage, packaging consumed in sales). This looks like an operating expense - it should post to a 6000-series account."
                      : "Operating expense accounts are for overheads (rent, utilities, salaries). This looks like a direct cost of goods sold - it should post to a 5000-series COGS account.";

                  return (
                    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 space-y-2">
                      <p className="text-xs text-destructive flex items-start gap-1.5">
                        <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                        <span>
                          <strong>Account type mismatch.</strong> You selected a{" "}
                          <strong>{wrongLabel}</strong> account, but this entry
                          should typically post to <strong>{rightLabel}</strong>
                          .
                        </span>
                      </p>
                      <p className="text-[11px] text-muted-foreground pl-5">
                        {explanation}
                      </p>
                      {suggestion && (
                        <div className="flex flex-wrap items-center gap-2 pl-5">
                          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            Suggested
                          </span>
                          <button
                            type="button"
                            onClick={() => setAccountId(suggestion.id)}
                            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-primary/40 bg-primary/10 hover:bg-primary/20 text-xs transition-colors"
                          >
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {suggestion.account_code}
                            </span>
                            <span className="font-medium text-foreground">
                              {suggestion.account_name}
                            </span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()}
              {categoryId &&
                (() => {
                  const cat = categories.find((c) => c.id === categoryId);
                  if (!cat || cat.account_id) return null;

                  // Score every expense account against the category name and surface
                  // the top matches as one-click suggestions.
                  const catName = cat.name.trim().toLowerCase();
                  const catTokens = catName.split(/\s+/).filter(Boolean);
                  const scored = expenseAccounts.map((a) => {
                    const accName = a.account_name.toLowerCase();
                    let score = 0;
                    if (accName === catName) score += 100;
                    if (accName.includes(catName)) score += 40;
                    if (catName.includes(accName)) score += 25;
                    for (const t of catTokens) {
                      if (t.length > 2 && accName.includes(t)) score += 15;
                    }
                    return { account: a, score };
                  });
                  const suggestions = scored
                    .filter((s) => s.score > 0)
                    .sort((a, b) => b.score - a.score)
                    .slice(0, 4)
                    .map((s) => s.account);

                  return (
                    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
                      <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
                        <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                        <span>
                          The <strong>{cat.name}</strong> category has no Chart
                          of Accounts mapping yet. Pick one below or set a
                          default in <em>Settings → Expense Categories</em>.
                        </span>
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1.5 border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
                        onClick={() => {
                          onOpenChange(false);
                          navigate(`/expenses?editCategory=${cat.id}`);
                        }}
                        title="Open this category and pick a permanent default account"
                      >
                        <Settings2 className="h-3.5 w-3.5" />
                        {t("app.expenses.form.setMapping")}
                      </Button>
                      {suggestions.length > 0 ? (
                        <div className="space-y-1.5">
                          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            Suggested accounts
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {suggestions.map((a) => (
                              <button
                                key={a.id}
                                type="button"
                                onClick={() => setAccountId(a.id)}
                                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs transition-colors ${
                                  accountId === a.id
                                    ? "border-primary bg-primary/10 text-primary"
                                    : "border-border bg-background hover:bg-muted"
                                }`}
                              >
                                <span className="font-mono text-[10px] text-muted-foreground">
                                  {a.account_code}
                                </span>
                                <span className="font-medium text-foreground">
                                  {a.account_name}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="text-[11px] text-muted-foreground">
                          No close matches found - pick from the full list
                          above.
                        </p>
                      )}
                    </div>
                  );
                })()}
            </div>

            {/* Accounting Head Preview */}
            {accountId &&
              (() => {
                const selected = expenseAccounts.find(
                  (a) => a.id === accountId
                );
                if (!selected) return null;
                return (
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 flex items-start gap-3">
                    <BookOpen className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-muted-foreground mb-0.5">
                        Accounting Head (Auto-selected)
                      </p>
                      <p className="text-sm font-semibold text-foreground">
                        <span className="font-mono text-xs me-2 px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                          {selected.account_code}
                        </span>
                        {selected.account_name}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1 capitalize">
                        Type: {selected.account_type}
                      </p>
                    </div>
                  </div>
                );
              })()}

            {/* Category - Optional */}
            <div className="space-y-2">
              <Label>{t("app.expenses.form.category")}</Label>
              <Select
                value={categoryId || "none"}
                onValueChange={(v) => setCategoryId(v === "none" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("app.expenses.form.selectCategory")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("app.expenses.form.noCategory")}</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      <div className="flex items-center gap-2 w-full">
                        {category.color && (
                          <div
                            className="w-3 h-3 rounded-full flex-shrink-0"
                            style={{ backgroundColor: category.color }}
                          />
                        )}
                        <span className="flex-1">{category.name}</span>
                        {category.account_id ? (
                          <span className="ml-2 inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                            Mapped
                          </span>
                        ) : (
                          <span className="ml-2 inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                            Missing mapping
                          </span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                  {categories.length === 0 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      No categories yet. Open the Expenses page and click{" "}
                      <span className="font-medium text-foreground">
                        + Category
                      </span>{" "}
                      to create one.
                    </div>
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Supplier - Optional. When set, mirrors to Invoices list */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                {t("app.expenses.form.supplier")}
              </Label>
              <Select
                value={supplierId || "none"}
                onValueChange={(v) => setSupplierId(v === "none" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("app.expenses.form.selectSupplier")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("app.expenses.form.noSupplier")}</SelectItem>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {supplierId && (
                <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                  <Receipt className="h-3 w-3 mt-0.5 flex-shrink-0" />
                  This expense will also appear in the Invoices list under the
                  selected supplier. If it is unpaid, the ledger credits this
                  supplier's own payable head (auto-created under 2000 Accounts
                  Payable) instead of the shared payable account.
                </p>
              )}
            </div>

            {/* Inventory Item - Optional */}
            {/* Itemized invoice toggle */}
            {itemizedInvoicesEnabled && (
              <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/20 p-3">
                <div className="flex-1 min-w-0">
                  <Label
                    htmlFor="itemized-toggle"
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <ListPlus className="h-4 w-4" />
                    {t("app.expenses.form.itemized")}
                  </Label>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Turn on to add several inventory items on one expense. Each
                    line creates its own stock movement linked to this expense.
                  </p>
                </div>
                <Switch
                  id="itemized-toggle"
                  checked={itemizedMode}
                  onCheckedChange={(v) => {
                    setItemizedMode(v);
                    if (v) {
                      // Clear single-item fields when switching to itemized mode
                      setInventoryItemId("");
                      setQuantity("1");
                      setStockChangeUnits("");
                      setMovementReason("");
                      if (lineItems.length === 0) {
                        setLineItems([makeEmptyLine()]);
                      }
                    }
                  }}
                />
              </div>
            )}

            {itemizedMode ? (
              <ExpenseLineItemsEditor
                items={lineItems}
                inventoryItems={inventoryItems}
                onChange={setLineItems}
                onRequestCreateItem={() => setQuickAddItemOpen(true)}
              />
            ) : (
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  {t("app.expenses.form.inventoryItem")}{" "}
                  {requiresInventoryLink ? (
                    <span className="text-destructive">*</span>
                  ) : (
                    <span className="text-xs font-normal text-muted-foreground">
                      ({t("app.expenses.form.optional")})
                    </span>
                  )}
                </Label>
                <Select
                  value={inventoryItemId || "none"}
                  onValueChange={(v) =>
                    setInventoryItemId(v === "none" ? "" : v)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("app.expenses.form.linkItem")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("app.expenses.form.noItem")}</SelectItem>
                    {inventoryItems.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name} {item.unit && `(${item.unit})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {requiresInventoryLink && !inventoryItemId && (
                  <Alert variant="destructive" className="mt-2">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <strong>{selectedCategory?.name}</strong> is
                        inventory-backed — pick the item being purchased so it
                        lands in Inventory Purchases and updates WAC/stock.
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setQuickAddItemOpen(true)}
                        className="gap-1"
                      >
                        <ListPlus className="h-3.5 w-3.5" />
                        Create new item
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}

            {/* Stock movement controls - shown when inventory item linked (single-item mode only) */}
            {!itemizedMode &&
              inventoryItemId &&
              (() => {
                const item = inventoryItems.find(
                  (i) => i.id === inventoryItemId
                );
                const purchaseUnit = item?.unit || "unit";
                const stockUnit = item?.stock_unit || item?.unit || "unit";
                const unitsPerPack = Number(item?.units_per_pack) || 1;
                const currentStock = Number(item?.current_stock) || 0;
                const qtyNum = parseFloat(quantity) || 0;
                const overrideNum = parseFloat(stockChangeUnits) || 0;
                const baseDelta =
                  stockChangeUnits && overrideNum > 0
                    ? overrideNum
                    : qtyNum * unitsPerPack;
                const signedDelta =
                  movementType === "purchase" ? baseDelta : -baseDelta;
                const projectedStock = currentStock + signedDelta;
                const isUsage = movementType === "usage";
                const wouldGoNegative = projectedStock < 0;
                // Cost per stock unit: amount / (effective stock-unit delta)
                const amountNum = parseFloat(amount) || 0;
                const costPerStockUnit =
                  baseDelta > 0 && amountNum > 0 ? amountNum / baseDelta : 0;
                const itemUnitCost = Number(item?.unit_cost) || 0;
                const expectedCostPerStockUnit =
                  unitsPerPack > 0 ? itemUnitCost / unitsPerPack : 0;
                const costDeviationPct =
                  expectedCostPerStockUnit > 0 && costPerStockUnit > 0
                    ? ((costPerStockUnit - expectedCostPerStockUnit) /
                        expectedCostPerStockUnit) *
                      100
                    : 0;

                return (
                  <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                    {/* Movement type toggle */}
                    <div className="space-y-2">
                      <Label className="text-xs font-medium">
                        Stock Action
                      </Label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setMovementType("purchase")}
                          className={`flex items-center justify-center gap-2 rounded-md border-2 p-2 text-sm transition-colors ${
                            movementType === "purchase"
                              ? "border-primary bg-primary/10 text-primary font-medium"
                              : "border-border hover:border-primary/50"
                          }`}
                        >
                          <ArrowUp className="h-4 w-4" />
                          Purchase (add)
                        </button>
                        <button
                          type="button"
                          onClick={() => setMovementType("usage")}
                          className={`flex items-center justify-center gap-2 rounded-md border-2 p-2 text-sm transition-colors ${
                            movementType === "usage"
                              ? "border-amber-600 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 font-medium"
                              : "border-border hover:border-amber-500/50"
                          }`}
                        >
                          <ArrowDown className="h-4 w-4" />
                          Usage (remove)
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label htmlFor="quantity" className="text-xs">
                          Expense qty ({purchaseUnit})
                        </Label>
                        <Input
                          id="quantity"
                          type="number"
                          step="0.01"
                          min="0.01"
                          value={quantity}
                          onChange={(e) => setQuantity(e.target.value)}
                          placeholder="1"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="stock-units" className="text-xs">
                          Stock change ({stockUnit}){" "}
                          <span className="text-muted-foreground">
                            - optional
                          </span>
                        </Label>
                        <Input
                          id="stock-units"
                          type="number"
                          step="0.01"
                          min="0"
                          value={stockChangeUnits}
                          onChange={(e) => setStockChangeUnits(e.target.value)}
                          placeholder={`auto: ${(qtyNum * unitsPerPack).toFixed(
                            2
                          )}`}
                        />
                      </div>
                    </div>
                    {unitsPerPack !== 1 && !stockChangeUnits && (
                      <p className="text-[11px] text-muted-foreground">
                        Conversion: 1 {purchaseUnit} = {unitsPerPack}{" "}
                        {stockUnit}
                      </p>
                    )}

                    <div className="space-y-1">
                      <Label htmlFor="movement-reason" className="text-xs">
                        Reason for stock change{" "}
                        <span className="text-muted-foreground">
                          - optional
                        </span>
                      </Label>
                      <Input
                        id="movement-reason"
                        value={movementReason}
                        onChange={(e) => setMovementReason(e.target.value)}
                        placeholder={
                          isUsage
                            ? "e.g. Kitchen prep batch #4"
                            : "e.g. Weekly supplier delivery"
                        }
                      />
                    </div>

                    {/* Stock preview */}
                    {baseDelta > 0 && (
                      <div
                        className={`rounded-md border p-2.5 text-sm ${
                          wouldGoNegative
                            ? "border-destructive/40 bg-destructive/5"
                            : isUsage
                            ? "border-amber-500/40 bg-amber-50 dark:bg-amber-950/20"
                            : "border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/20"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-muted-foreground">
                            Stock change
                          </span>
                          <span
                            className={`font-mono font-semibold ${
                              isUsage
                                ? "text-amber-700 dark:text-amber-300"
                                : "text-emerald-700 dark:text-emerald-300"
                            }`}
                          >
                            {signedDelta > 0 ? "+" : ""}
                            {signedDelta.toFixed(2)} {stockUnit}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-1 pt-1 border-t border-border/50">
                          <span className="text-xs text-muted-foreground">
                            {currentStock.toFixed(2)} →{" "}
                            <span
                              className={
                                wouldGoNegative
                                  ? "text-destructive font-semibold"
                                  : "text-foreground font-semibold"
                              }
                            >
                              {projectedStock.toFixed(2)} {stockUnit}
                            </span>
                          </span>
                          {wouldGoNegative && (
                            <span className="text-[11px] text-destructive font-medium">
                              Would go negative
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Effective cost per stock unit */}
                    {!isUsage && baseDelta > 0 && amountNum > 0 && (
                      <div className="rounded-md border border-primary/30 bg-primary/5 p-2.5 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">
                            Effective cost / {stockUnit}
                          </span>
                          <span className="font-mono font-semibold text-foreground">
                            {costPerStockUnit.toFixed(4)}
                          </span>
                        </div>
                        {expectedCostPerStockUnit > 0 && (
                          <div className="flex items-center justify-between gap-2 mt-1 pt-1 border-t border-border/50">
                            <span className="text-muted-foreground">
                              Expected (item base cost / pack)
                            </span>
                            <span className="font-mono">
                              {expectedCostPerStockUnit.toFixed(4)}
                              {Math.abs(costDeviationPct) >= 5 && (
                                <span
                                  className={`ml-2 ${
                                    costDeviationPct > 0
                                      ? "text-destructive"
                                      : "text-emerald-700 dark:text-emerald-400"
                                  }`}
                                >
                                  {costDeviationPct > 0 ? "+" : ""}
                                  {costDeviationPct.toFixed(1)}%
                                </span>
                              )}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

            {/* Description - Optional */}
            <div className="space-y-2">
              <Label htmlFor="description">{t("app.expenses.form.description")}</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("app.expenses.form.descriptionPlaceholder")}
                className="min-h-[80px]"
              />
            </div>

            {/* Payment Status */}
            <ExpenseStatusField
              value={status}
              onChange={(v) => setStatus(v)}
              paymentMethod={paymentMethod}
              onFixToUnpaid={() => setStatus("unpaid")}
              locked={isCashierOnly}
              lockedReason="Cashier entries are saved as Unpaid. An accountant will mark them paid after checking, then the ledger will credit Cash."
              showLedgerHint={!isCashierOnly}
            />

            {/* Paying account */}
            {!isCashierOnly && status === "paid" && (
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t("app.expenses.form.paidFrom")}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {funding.capitalAccountId
                      ? funding.fundingSource === "owner_capital"
                        ? "Owner capital account (credits Equity)"
                        : "Partner capital account (credits Equity)"
                      : funding.paymentAccountId
                        ? t("app.expenses.form.companyAccount")
                        : t("app.expenses.form.notSelected")}
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => setFundingOpen(true)}>
                  {funding.paymentAccountId || funding.capitalAccountId ? t("app.expenses.form.change") : t("app.expenses.form.choose")}
                </Button>
              </div>
            )}

            {/* Receipt Upload - Optional */}
            {restaurant?.id && (
              <ReceiptUploaderField
                receiptUrl={receiptUrl}
                onReceiptChange={setReceiptUrl}
                restaurantId={restaurant.id}
                onUploadingChange={setIsReceiptUploading}
              />
            )}

            {/* Info about auto-posting */}
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {t("app.expenses.form.postingHelp")}
              </AlertDescription>
            </Alert>

            {/* Submit Button */}
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={!canSubmit || isSubmitting}
              >
                {isSubmitting && (
                  <Loader2 className="h-4 w-4 me-2 animate-spin" />
                )}
                {itemizedMode
                  ? `Record Invoice (${lineItems.length} item${
                      lineItems.length === 1 ? "" : "s"
                    })`
                  : "Record & Post to Ledger"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
      <ExpenseFundingSourceDialog
        open={fundingOpen}
        onOpenChange={setFundingOpen}
        value={funding}
        onChange={setFunding}
        branchId={effectiveBranchId ?? null}
        onConfirm={() => setTimeout(() => handleSubmit(), 0)}
      />
      <AlertDialog
        open={showMissingAccountConfirm}
        onOpenChange={setShowMissingAccountConfirm}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              {t("app.expenses.form.mappingRequired")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              The selected category
              {(() => {
                const cat = categories.find((c) => c.id === categoryId);
                return cat ? ` "${cat.name}"` : "";
              })()}{" "}
              has no Chart of Accounts mapping, and you haven&apos;t picked an
              account either. Every expense must post to a ledger account, so
              this entry can&apos;t be saved as-is.
              <br />
              <br />
              Pick an account from the dropdown (or one of the suggestions), or
              set a permanent default in <em>Settings → Expense Categories</em>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("app.expenses.form.back")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const cat = categories.find((c) => c.id === categoryId);
                setShowMissingAccountConfirm(false);
                onOpenChange(false);
                if (cat) navigate(`/expenses?editCategory=${cat.id}`);
              }}
            >
              {t("app.expenses.form.setMapping")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <QuickAddInventoryItemDialog
        open={quickAddItemOpen}
        onOpenChange={setQuickAddItemOpen}
        restaurantId={restaurant?.id}
        onCreated={(item) => {
          queryClient.invalidateQueries({
            queryKey: ["inventory-items-expense", restaurant?.id],
          });
          if (!itemizedMode) {
            setInventoryItemId(item.id);
            return;
          }
          setLineItems((prev) => {
            const next = prev.length === 0 ? [makeEmptyLine()] : [...prev];
            const targetIdx = next.findIndex((li) => !li.inventory_item_id);
            const idx =
              targetIdx === -1 ? next.push(makeEmptyLine()) - 1 : targetIdx;
            next[idx] = { ...next[idx], inventory_item_id: item.id };
            return next;
          });
        }}
      />
    </Dialog>
  );
}
