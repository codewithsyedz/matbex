import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { splitInclusive } from "@/lib/vatInclusive";
import {
  ArrowLeft,
  Wallet,
  CreditCard,
  Receipt,
  Clock,
  CheckCircle2,
  Ban,
  FileText,
  DollarSign,
  Calendar,
  Mail,
  Phone,
  MapPin,
  AlertTriangle,
  Edit,
  TrendingDown,
  TrendingUp,
  FileX,
  FileCheck,
  History,
  Eye,
  ShoppingCart,
  Undo2,
  Trash2,
} from "lucide-react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useCurrency } from "@/hooks/useCurrency";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { BalanceAdjustmentDialog } from "@/components/customers/BalanceAdjustmentDialog";

type SettlementStatus = "pending" | "partial" | "settled" | "overdue";
type TransactionSettlementStatus = "paid" | "unpaid" | "settled";

export default function CustomerDetail() {
  const { id: customerId } = useParams<{ id: string }>();
  const { user, restaurant } = useAuth();
  const { format: formatCurrency } = useCurrency();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [isSettlementDialogOpen, setIsSettlementDialogOpen] = useState(false);
  const [settlementPeriod, setSettlementPeriod] = useState<{ start: string; end: string }>({
    start: format(startOfMonth(subMonths(new Date(), 1)), "yyyy-MM-dd"),
    end: format(endOfMonth(subMonths(new Date(), 1)), "yyyy-MM-dd"),
  });
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [isAdjustmentDialogOpen, setIsAdjustmentDialogOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<any>(null);
  const [transactionToDelete, setTransactionToDelete] = useState<any>(null);
  const [transactionToWriteOff, setTransactionToWriteOff] = useState<any>(null);
  const [adjustmentToRevert, setAdjustmentToRevert] = useState<any>(null);
  const [invoiceToDelete, setInvoiceToDelete] = useState<any>(null);
  const [includeFullBalance, setIncludeFullBalance] = useState(true);
  const [customSettlementAmount, setCustomSettlementAmount] = useState("");
  const [settlementMode, setSettlementMode] = useState<"full" | "period" | "custom">("full");
  
  // Partial payment state
  const [transactionToPartialPay, setTransactionToPartialPay] = useState<any>(null);
  const [partialPaymentAmount, setPartialPaymentAmount] = useState("");
  const [partialPaymentMethod, setPartialPaymentMethod] = useState("cash");
  const [partialPaymentNotes, setPartialPaymentNotes] = useState("");
  
  // Edit transaction state
  const [transactionToEdit, setTransactionToEdit] = useState<any>(null);
  const [editSubtotal, setEditSubtotal] = useState("");
  const [editTaxRate, setEditTaxRate] = useState("15");
  const [editPaymentMethod, setEditPaymentMethod] = useState<"cash" | "card" | "other">("cash");
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  // Fetch customer
  const { data: customer, isLoading: customerLoading } = useQuery({
    queryKey: ["customer", customerId],
    queryFn: async () => {
      if (!customerId) return null;
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .eq("id", customerId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!customerId,
  });

  // Fetch unpaid transactions for this customer
  const { data: unpaidTransactionsRaw = [] } = useQuery({
    queryKey: ["customer-transactions", customerId, "unpaid"],
    queryFn: async () => {
      if (!customerId) return [];
      const { data, error } = await supabase
        .from("sales_transactions")
        .select("*, settlement_invoice:settlement_invoices(status, invoice_number), sales_items(*, menu_items(name))")
        .eq("customer_id", customerId)
        .eq("settlement_status", "unpaid")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!customerId,
  });

  const unpaidTransactions = unpaidTransactionsRaw.filter((tx) => {
    const remaining = (Number(tx.total) || 0) - (Number(tx.paid_amount) || 0);
    const linkedInvoiceSettled = tx.settlement_invoice?.status === "settled";
    return remaining > 0.0001 && !linkedInvoiceSettled;
  });

  // Fetch settlement invoices
  const { data: settlementInvoices = [] } = useQuery({
    queryKey: ["settlement-invoices", customerId],
    queryFn: async () => {
      if (!customerId) return [];
      const { data, error } = await supabase
        .from("settlement_invoices")
        .select("*")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!customerId,
  });

  // Fetch balance adjustments
  const { data: balanceAdjustments = [] } = useQuery({
    queryKey: ["customer-adjustments", customerId],
    queryFn: async () => {
      if (!customerId) return [];
      const { data, error } = await supabase
        .from("customer_balance_adjustments")
        .select("*")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!customerId,
  });

  // Calculate settlement preview based on mode
  const filteredTransactions = unpaidTransactions.filter((t) => {
    const txDate = format(new Date(t.created_at), "yyyy-MM-dd");
    return txDate >= settlementPeriod.start && txDate <= settlementPeriod.end;
  });

  const transactionsForSettlement = settlementMode === "full" ? unpaidTransactions : 
    settlementMode === "period" ? filteredTransactions : [];

  const customAmount = parseFloat(customSettlementAmount) || 0;
  
  const settlementPreview = settlementMode === "custom" 
    ? { count: 0, subtotal: customAmount, tax: 0, total: customAmount }
    : settlementMode === "full"
      ? {
          count: unpaidTransactions.length,
          subtotal: customer?.current_balance ?? 0,
          tax: 0,
          total: customer?.current_balance ?? 0,
        }
      : transactionsForSettlement.reduce(
          (acc, t) => ({
            count: acc.count + 1,
            subtotal: acc.subtotal + t.subtotal,
            tax: acc.tax + t.tax,
            total: acc.total + t.total,
          }),
          { count: 0, subtotal: 0, tax: 0, total: 0 }
        );

  // Create settlement mutation
  const createSettlementMutation = useMutation({
    mutationFn: async () => {
      if (!customer || !restaurant?.id || !user?.id) throw new Error("Missing context");

      const transactionsToSettle = settlementMode === "full" 
        ? unpaidTransactions 
        : settlementMode === "period"
          ? unpaidTransactions.filter((t) => {
              const txDate = format(new Date(t.created_at), "yyyy-MM-dd");
              return txDate >= settlementPeriod.start && txDate <= settlementPeriod.end;
            })
          : []; // Custom mode doesn't link specific transactions

      // For custom mode, validate the amount
      if (settlementMode === "custom") {
        const amount = parseFloat(customSettlementAmount);
        if (!amount || amount <= 0) {
          throw new Error("Please enter a valid amount");
        }
      } else if (transactionsToSettle.length === 0) {
        throw new Error("No transactions to settle");
      }

      // Generate invoice number
      const invoiceNumber = `INV-${customer.name.substring(0, 3).toUpperCase()}-${format(new Date(), "yyyyMMdd")}-${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;

      // Create settlement invoice
      const { data: invoice, error: invoiceError } = await supabase
        .from("settlement_invoices")
        .insert({
          restaurant_id: restaurant.id,
          customer_id: customer.id,
          invoice_number: invoiceNumber,
          billing_period_start: settlementPeriod.start,
          billing_period_end: settlementPeriod.end,
          subtotal: settlementPreview.subtotal,
          tax_amount: settlementPreview.tax,
          total_amount: settlementPreview.total,
          due_date: format(new Date(new Date().setDate(new Date().getDate() + 30)), "yyyy-MM-dd"),
        })
        .select()
        .single();

      if (invoiceError) throw invoiceError;

      // Link transactions to the invoice (only for non-custom modes)
      if (transactionsToSettle.length > 0) {
        const transactionIds = transactionsToSettle.map((t) => t.id);
        const { error: updateError } = await supabase
          .from("sales_transactions")
          .update({ settlement_invoice_id: invoice.id })
          .in("id", transactionIds);

        if (updateError) throw updateError;
      }

      // Log audit
      await supabase.from("settlement_audit_logs").insert({
        restaurant_id: restaurant.id,
        settlement_invoice_id: invoice.id,
        customer_id: customer.id,
        action: "invoice_created",
        actor_id: user.id,
        details: {
          transaction_count: transactionsToSettle.length,
          total_amount: settlementPreview.total,
          settlement_mode: settlementMode,
        },
      });

      return invoice;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["settlement-invoices"] });
      setIsSettlementDialogOpen(false);
      toast.success("Settlement invoice created successfully");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to create settlement");
      console.error(error);
    },
  });

  // Record payment mutation
  const recordPaymentMutation = useMutation({
    mutationFn: async () => {
      if (!selectedInvoice || !restaurant?.id || !user?.id) throw new Error("Missing context");

      const amount = parseFloat(paymentAmount);
      if (isNaN(amount) || amount <= 0) throw new Error("Invalid payment amount");

      const remaining = selectedInvoice.total_amount - selectedInvoice.amount_paid;
      if (amount > remaining) throw new Error("Payment exceeds remaining balance");

      // Record the payment
      const { data: payment, error: paymentError } = await supabase
        .from("settlement_payments")
        .insert({
          restaurant_id: restaurant.id,
          settlement_invoice_id: selectedInvoice.id,
          amount: amount,
          payment_method: paymentMethod,
          paid_by: user.id,
          notes: paymentNotes || null,
        })
        .select("id, ledger_posted, ledger_transaction_id")
        .single();

      if (paymentError) throw paymentError;

      // Update invoice
      const newAmountPaid = selectedInvoice.amount_paid + amount;
      const isFullyPaid = newAmountPaid >= selectedInvoice.total_amount;
      const newStatus: SettlementStatus = isFullyPaid ? "settled" : "partial";

      const { error: updateError } = await supabase
        .from("settlement_invoices")
        .update({
          amount_paid: newAmountPaid,
          status: newStatus,
          ...(isFullyPaid && { paid_at: new Date().toISOString(), paid_by: user.id }),
        })
        .eq("id", selectedInvoice.id);

      if (updateError) throw updateError;

      // Allocate this payment across linked transactions (oldest first) so
      // partial payments correctly reduce each transaction's outstanding
      // balance, not just the parent invoice.
      const { data: linkedTx, error: linkedTxError } = await supabase
        .from("sales_transactions")
        .select("id, total, paid_amount, settlement_status")
        .eq("settlement_invoice_id", selectedInvoice.id)
        .neq("settlement_status", "settled")
        .order("created_at", { ascending: true });

      if (linkedTxError) throw linkedTxError;

      let settlementAdjustmentId: string | null = null;

      if (linkedTx && linkedTx.length > 0) {
        let toApply = amount;
        const nowIso = new Date().toISOString();
        for (const tx of linkedTx) {
          if (toApply <= 0.0001) break;
          const txTotal = Number(tx.total) || 0;
          const txPaid = Number(tx.paid_amount) || 0;
          const txRemaining = Math.max(0, txTotal - txPaid);
          if (txRemaining <= 0.0001) continue;
          const apply = Math.min(toApply, txRemaining);
          const newPaid = txPaid + apply;
          const fully = newPaid + 0.0001 >= txTotal;
          const { error: txErr } = await supabase
            .from("sales_transactions")
            .update({
              paid_amount: newPaid,
              ...(fully && {
                settlement_status: "settled" as const,
                settled_at: nowIso,
              }),
            })
            .eq("id", tx.id);
          if (txErr) throw txErr;
          toApply -= apply;
        }

        // If the invoice is fully paid, force-settle ALL linked transactions
        // even if their raw remaining exceeds what was allocated (covers
        // cases where current_balance was already reduced by prior credits
        // or write-offs at the customer level).
        if (isFullyPaid) {
          const nowIso2 = new Date().toISOString();
          for (const tx of linkedTx) {
            const { error: forceSettleError } = await supabase
              .from("sales_transactions")
              .update({
                paid_amount: Number(tx.total) || 0,
                settlement_status: "settled" as const,
                settled_at: nowIso2,
              })
              .eq("id", tx.id);

            if (forceSettleError) throw forceSettleError;
          }
        }
      }

      if (isFullyPaid) {
          const { data: existingAdjustment, error: existingAdjustmentError } = await supabase
            .from("customer_balance_adjustments")
            .select("id, ledger_posted")
            .eq("customer_id", selectedInvoice.customer_id)
            .eq("reference_number", selectedInvoice.invoice_number)
            .eq("adjustment_type", "settlement")
            .maybeSingle();

          if (existingAdjustmentError) throw existingAdjustmentError;

          if (existingAdjustment?.id) {
            settlementAdjustmentId = existingAdjustment.id;
            if (!existingAdjustment.ledger_posted) {
              const { error: markExistingPostedError } = await supabase
                .from("customer_balance_adjustments")
                .update({
                  ledger_posted: true,
                  ledger_transaction_id: payment.ledger_transaction_id,
                })
                .eq("id", existingAdjustment.id);
              if (markExistingPostedError) throw markExistingPostedError;
            }
          } else {
            const { data: adjustmentData, error: adjustmentError } = await supabase
            .from("customer_balance_adjustments")
            .insert({
              restaurant_id: restaurant.id,
              tenant_id: restaurant.tenant_id!,
              customer_id: selectedInvoice.customer_id,
              adjustment_type: "settlement",
              amount: selectedInvoice.total_amount,
              reason: `Settlement invoice ${selectedInvoice.invoice_number} paid`,
              notes: linkedTx && linkedTx.length > 0
                ? "Settlement payment received for linked invoice transactions"
                : "Custom amount settlement - reduces customer balance",
              created_by: user.id,
              reference_number: selectedInvoice.invoice_number,
              ledger_posted: true,
              ledger_transaction_id: payment.ledger_transaction_id,
            })
            .select("id")
            .single();

            if (adjustmentError) throw adjustmentError;
            settlementAdjustmentId = adjustmentData?.id ?? null;
          }

          // The settlement-payment insert already posts DR Cash/Bank and CR A/R.
          // The balance adjustment only records customer-state history, preventing
          // the same receipt from being posted to the ledger twice.
        }

      // Log audit
      await supabase.from("settlement_audit_logs").insert({
        restaurant_id: restaurant.id,
        settlement_invoice_id: selectedInvoice.id,
        customer_id: selectedInvoice.customer_id,
        action: isFullyPaid ? "invoice_settled" : "payment_recorded",
        actor_id: user.id,
        details: { amount, payment_method: paymentMethod },
      });

      return { isFullyPaid };
    },
    onSuccess: ({ isFullyPaid }) => {
      queryClient.invalidateQueries({ queryKey: ["settlement-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["customer-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      queryClient.invalidateQueries({ queryKey: ["unpaid-counts"] });
      queryClient.invalidateQueries({ queryKey: ["customer-adjustments"] });
      setIsPaymentDialogOpen(false);
      setSelectedInvoice(null);
      setPaymentAmount("");
      setPaymentNotes("");
      toast.success(isFullyPaid ? "Invoice fully settled!" : "Payment recorded");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to record payment");
    },
  });

  // Delete settlement invoice mutation
  const deleteInvoiceMutation = useMutation({
    mutationFn: async (invoice: any) => {
      if (!restaurant?.id) throw new Error("Missing restaurant context");

      // Unlink all transactions from this invoice
      const { error: unlinkError } = await supabase
        .from("sales_transactions")
        .update({ settlement_invoice_id: null })
        .eq("settlement_invoice_id", invoice.id);

      if (unlinkError) throw unlinkError;

      // Delete related payments
      const { error: paymentsError } = await supabase
        .from("settlement_payments")
        .delete()
        .eq("settlement_invoice_id", invoice.id);

      if (paymentsError) throw paymentsError;

      // Delete audit logs for this invoice
      const { error: auditError } = await supabase
        .from("settlement_audit_logs")
        .delete()
        .eq("settlement_invoice_id", invoice.id);

      if (auditError) throw auditError;

      // Delete linked balance adjustments referencing this invoice number
      const { error: adjError } = await supabase
        .from("customer_balance_adjustments")
        .delete()
        .eq("restaurant_id", restaurant.id)
        .eq("reference_number", invoice.invoice_number);

      if (adjError) throw adjError;

      // Delete the invoice itself
      const { error: invoiceError } = await supabase
        .from("settlement_invoices")
        .delete()
        .eq("id", invoice.id);

      if (invoiceError) throw invoiceError;

      return invoice;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settlement-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["customer-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      queryClient.invalidateQueries({ queryKey: ["unpaid-counts"] });
      queryClient.invalidateQueries({ queryKey: ["customer-adjustments"] });
      setInvoiceToDelete(null);
      toast.success("Invoice deleted successfully");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to delete invoice");
    },
  });

  // Delete transaction mutation
  const deleteTransactionMutation = useMutation({
    mutationFn: async (transactionId: string): Promise<void> => {
      if (!restaurant?.id) throw new Error("Missing restaurant context");

      // Delete items directly
      const itemDelete = supabase.from("sales_items");
      // @ts-expect-error - Supabase type recursion workaround
      await itemDelete.delete().eq("sale_id", transactionId);

      // Delete transaction
      const txDelete = supabase.from("sales_transactions");
      const { error: txError } = await txDelete.delete().eq("id", transactionId);
      
      if (txError) throw txError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      queryClient.invalidateQueries({ queryKey: ["unpaid-counts"] });
      setTransactionToDelete(null);
      toast.success("Transaction deleted successfully");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to delete transaction");
    },
  });

  // Write off transaction mutation
  const writeOffTransactionMutation = useMutation({
    mutationFn: async (transaction: any) => {
      if (!restaurant?.id || !user?.id || !customer?.id) throw new Error("Missing context");

      // Create a write_off balance adjustment for the transaction amount
      const { error } = await supabase.from("customer_balance_adjustments").insert({
        restaurant_id: restaurant.id,
        tenant_id: restaurant.tenant_id,
        customer_id: customer.id,
        adjustment_type: "write_off",
        amount: transaction.total,
        reason: `Write-off for transaction ${transaction.receipt_number}`,
        notes: `Transaction dated ${format(new Date(transaction.created_at), "MMM dd, yyyy")} written off`,
        created_by: user.id,
      });

      if (error) throw error;

      // Mark the transaction as settled (written off)
      const { error: updateError } = await supabase
        .from("sales_transactions")
        .update({ 
          settlement_status: "settled", 
          settled_at: new Date().toISOString() 
        })
        .eq("id", transaction.id);

      if (updateError) throw updateError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      queryClient.invalidateQueries({ queryKey: ["customer-adjustments"] });
      queryClient.invalidateQueries({ queryKey: ["unpaid-counts"] });
      setTransactionToWriteOff(null);
      toast.success("Transaction written off successfully");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to write off transaction");
    },
  });

  // Revert a write-off by creating an opposite (debit) adjustment
  const revertWriteOffMutation = useMutation({
    mutationFn: async (adjustment: any) => {
      if (!restaurant?.id || !user?.id || !customer?.id || !restaurant.tenant_id) {
        throw new Error("Missing context");
      }

      // Create a reversing debit adjustment
      const { error } = await supabase.from("customer_balance_adjustments").insert({
        restaurant_id: restaurant.id,
        tenant_id: restaurant.tenant_id,
        customer_id: customer.id,
        adjustment_type: "debit",
        amount: adjustment.amount,
        reason: `Reversal of write-off: ${adjustment.reason}`,
        notes: `Reverted write-off from ${format(new Date(adjustment.created_at), "MMM dd, yyyy")}. Original reference: ${adjustment.reference_number || "N/A"}`,
        created_by: user.id,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      queryClient.invalidateQueries({ queryKey: ["customer-adjustments"] });
      queryClient.invalidateQueries({ queryKey: ["unpaid-counts"] });
      setAdjustmentToRevert(null);
      toast.success("Write-off reverted successfully - balance restored");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to revert write-off");
    },
  });

  // Record partial payment against a specific transaction
  const partialPaymentMutation = useMutation({
    mutationFn: async () => {
      if (!restaurant?.id || !user?.id || !customer?.id || !restaurant.tenant_id || !transactionToPartialPay) {
        throw new Error("Missing context");
      }

      const amount = parseFloat(partialPaymentAmount);
      if (isNaN(amount) || amount <= 0) {
        throw new Error("Please enter a valid amount");
      }

      const currentPaid = transactionToPartialPay.paid_amount || 0;
      const remaining = transactionToPartialPay.total - currentPaid;
      
      if (amount > remaining) {
        throw new Error(`Amount exceeds remaining balance of ${remaining.toFixed(2)}`);
      }

      const newPaidAmount = currentPaid + amount;
      const isFullyPaid = newPaidAmount >= transactionToPartialPay.total;

      // Update the transaction's paid_amount
      const { error: updateError } = await supabase
        .from("sales_transactions")
        .update({ 
          paid_amount: newPaidAmount,
          ...(isFullyPaid && { 
            settlement_status: "paid" as const, 
            settled_at: new Date().toISOString() 
          })
        })
        .eq("id", transactionToPartialPay.id);

      if (updateError) throw updateError;

      // Create a credit balance adjustment to reduce customer balance
      const { error: adjustmentError } = await supabase
        .from("customer_balance_adjustments")
        .insert({
          restaurant_id: restaurant.id,
          tenant_id: restaurant.tenant_id,
          customer_id: customer.id,
          transaction_id: transactionToPartialPay.id,
          adjustment_type: "credit",
          amount: amount,
          reason: `Payment for ${transactionToPartialPay.receipt_number}`,
          notes: `${partialPaymentMethod.toUpperCase()} payment${partialPaymentNotes ? `: ${partialPaymentNotes}` : ""}`,
          created_by: user.id,
          reference_number: transactionToPartialPay.receipt_number,
        });

      if (adjustmentError) throw adjustmentError;

      return { isFullyPaid };
    },
    onSuccess: ({ isFullyPaid }) => {
      queryClient.invalidateQueries({ queryKey: ["customer-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      queryClient.invalidateQueries({ queryKey: ["customer-adjustments"] });
      queryClient.invalidateQueries({ queryKey: ["unpaid-counts"] });
      setTransactionToPartialPay(null);
      setPartialPaymentAmount("");
      setPartialPaymentNotes("");
      toast.success(isFullyPaid ? "Transaction fully paid!" : "Partial payment recorded");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to record payment");
    },
  });

  // Edit transaction mutation
  const editTransactionMutation = useMutation({
    mutationFn: async () => {
      if (!transactionToEdit || !restaurant?.id || !editSubtotal) {
        throw new Error("Missing required fields");
      }

      const gross = parseFloat(editSubtotal);
      const taxRateNum = parseFloat(editTaxRate) || 0;
      const { net: subtotal, vat: tax, gross: total } = splitInclusive(gross, taxRateNum / 100);

      const { error } = await supabase
        .from("sales_transactions")
        .update({
          subtotal,
          tax,
          total,
          payment_method: editPaymentMethod,
        })
        .eq("id", transactionToEdit.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      queryClient.invalidateQueries({ queryKey: ["unpaid-counts"] });
      setIsEditDialogOpen(false);
      setTransactionToEdit(null);
      setEditSubtotal("");
      toast.success("Transaction updated successfully");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to update transaction");
    },
  });

  // Open edit dialog with prefilled values
  const openEditDialog = (tx: any) => {
    setTransactionToEdit(tx);
    setEditSubtotal(tx.total?.toString() || "");
    // Calculate tax rate from existing values
    const calculatedTaxRate = tx.subtotal > 0 ? ((tx.tax / tx.subtotal) * 100).toFixed(0) : "15";
    setEditTaxRate(calculatedTaxRate);
    setEditPaymentMethod(tx.payment_method || "cash");
    setIsEditDialogOpen(true);
  };

  const getStatusBadge = (status: SettlementStatus) => {
    switch (status) {
      case "pending":
        return <Badge variant="outline" className="text-amber-600 border-amber-500/30"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
      case "partial":
        return <Badge variant="outline" className="text-blue-600 border-blue-500/30"><DollarSign className="h-3 w-3 mr-1" />Partial</Badge>;
      case "settled":
        return <Badge variant="outline" className="text-emerald-600 border-emerald-500/30"><CheckCircle2 className="h-3 w-3 mr-1" />Settled</Badge>;
      case "overdue":
        return <Badge variant="outline" className="text-red-600 border-red-500/30"><AlertTriangle className="h-3 w-3 mr-1" />Overdue</Badge>;
    }
  };

  if (customerLoading || !customer) {
    return (
      <>
        <div className="p-8 text-center text-muted-foreground">Loading...</div>
      </>
    );
  }

  const creditUtilization = customer.credit_limit > 0
    ? Math.min((customer.current_balance / customer.credit_limit) * 100, 100)
    : 0;

  return (
    <>
      <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/customers")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">{customer.name}</h1>
            <div className="flex flex-wrap gap-4 mt-1 text-sm text-muted-foreground">
              {customer.email && (
                <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{customer.email}</span>
              )}
              {customer.phone && (
                <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{customer.phone}</span>
              )}
              {customer.address && (
                <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{customer.address}</span>
              )}
            </div>
          </div>
          <Badge
            className={
              customer.credit_status === "active"
                ? "bg-emerald-500/10 text-emerald-600"
                : customer.credit_status === "suspended"
                ? "bg-amber-500/10 text-amber-600"
                : "bg-red-500/10 text-red-600"
            }
          >
            {customer.credit_status === "active" && <CheckCircle2 className="h-3 w-3 mr-1" />}
            {customer.credit_status === "suspended" && <Clock className="h-3 w-3 mr-1" />}
            {customer.credit_status === "blocked" && <Ban className="h-3 w-3 mr-1" />}
            {customer.credit_status.charAt(0).toUpperCase() + customer.credit_status.slice(1)}
          </Badge>
        </div>

        {/* Balance Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                <Wallet className="h-4 w-4 text-amber-500" />
                Current Balance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-amber-600">
                {formatCurrency(customer.current_balance)}
              </p>
              <div className="flex items-center justify-between mt-2">
                <p className="text-xs text-muted-foreground">
                  {unpaidTransactions.length} unpaid transaction(s)
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsAdjustmentDialogOpen(true)}
                >
                  <Edit className="h-3.5 w-3.5 mr-1" />
                  Adjust
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-blue-500" />
                Credit Limit
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">
                {customer.credit_limit > 0 ? formatCurrency(customer.credit_limit) : "Unlimited"}
              </p>
              {customer.credit_limit > 0 && (
                <div className="mt-2">
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>Utilization</span>
                    <span>{creditUtilization.toFixed(0)}%</span>
                  </div>
                  <Progress
                    value={creditUtilization}
                    className={`h-2 ${creditUtilization > 80 ? "[&>div]:bg-red-500" : creditUtilization > 50 ? "[&>div]:bg-amber-500" : "[&>div]:bg-emerald-500"}`}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                Pending Invoices
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">
                {settlementInvoices.filter((i) => i.status === "pending" || i.status === "partial").length}
              </p>
              <Button
                size="sm"
                className="mt-2"
                onClick={() => setIsSettlementDialogOpen(true)}
                disabled={unpaidTransactions.length === 0}
              >
                <Receipt className="h-4 w-4 mr-1" />
                Create Settlement
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="transactions" className="space-y-4">
          <TabsList>
            <TabsTrigger value="transactions">Unpaid Transactions</TabsTrigger>
            <TabsTrigger value="invoices">Settlement Invoices</TabsTrigger>
            <TabsTrigger value="adjustments">
              Adjustments
              {balanceAdjustments.length > 0 && (
                <span className="ml-1.5 text-xs bg-muted px-1.5 py-0.5 rounded-full">
                  {balanceAdjustments.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="transactions" className="space-y-4">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Receipt #</TableHead>
                      <TableHead className="hidden md:table-cell">Items</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead className="text-right">Remaining</TableHead>
                      <TableHead className="text-right w-24"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unpaidTransactions.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8">
                          <CheckCircle2 className="h-8 w-8 mx-auto text-emerald-500 mb-2" />
                          <p className="text-muted-foreground">No unpaid transactions</p>
                        </TableCell>
                      </TableRow>
                    ) : (
                      unpaidTransactions.map((tx) => {
                        const paidAmount = tx.paid_amount || 0;
                        const remaining = tx.total - paidAmount;
                        return (
                          <TableRow 
                            key={tx.id} 
                            className="cursor-pointer hover:bg-muted/50 transition-colors"
                            onClick={() => setSelectedTransaction(tx)}
                          >
                            <TableCell>{format(new Date(tx.created_at), "MMM dd, yyyy")}</TableCell>
                            <TableCell className="font-mono text-sm">{tx.receipt_number}</TableCell>
                            <TableCell className="hidden md:table-cell">
                              <span className="text-sm text-muted-foreground">
                                {tx.sales_items?.length || 0} item(s)
                              </span>
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {formatCurrency(tx.total)}
                            </TableCell>
                            <TableCell className="text-right text-emerald-600">
                              {paidAmount > 0 ? formatCurrency(paidAmount) : "-"}
                            </TableCell>
                            <TableCell className="text-right text-amber-600 font-medium">
                              {formatCurrency(remaining)}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button 
                                  size="sm" 
                                  variant="ghost" 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedTransaction(tx);
                                  }}
                                  title="View details"
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                                <Button 
                                  size="sm" 
                                  variant="ghost" 
                                  className="text-blue-600 hover:text-blue-700 hover:bg-blue-500/10"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openEditDialog(tx);
                                  }}
                                  title="Edit transaction"
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button 
                                  size="sm" 
                                  variant="ghost" 
                                  className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setTransactionToPartialPay(tx);
                                    setPartialPaymentAmount(remaining.toFixed(2));
                                  }}
                                  title="Record payment"
                                >
                                  <DollarSign className="h-4 w-4" />
                                </Button>
                                <Button 
                                  size="sm" 
                                  variant="ghost" 
                                  className="text-amber-600 hover:text-amber-700 hover:bg-amber-500/10"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setTransactionToWriteOff(tx);
                                  }}
                                  title="Write off"
                                >
                                  <FileCheck className="h-4 w-4" />
                                </Button>
                                <Button 
                                  size="sm" 
                                  variant="ghost" 
                                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setTransactionToDelete(tx);
                                  }}
                                  title="Delete"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                  {unpaidTransactions.length > 0 && (
                    <tfoot>
                      <TableRow className="bg-muted/50 font-medium">
                        <TableCell colSpan={5} className="text-right">
                          Current Balance
                        </TableCell>
                        <TableCell className="text-right text-amber-600 font-bold">
                          {formatCurrency(customer.current_balance)}
                        </TableCell>
                        <TableCell></TableCell>
                      </TableRow>
                    </tfoot>
                  )}
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="invoices" className="space-y-4">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Paid</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {settlementInvoices.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8">
                          <FileText className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                          <p className="text-muted-foreground">No settlement invoices yet</p>
                        </TableCell>
                      </TableRow>
                    ) : (
                      settlementInvoices.map((invoice) => (
                        <TableRow key={invoice.id}>
                          <TableCell className="font-mono text-sm">{invoice.invoice_number}</TableCell>
                          <TableCell className="text-sm">
                            {format(new Date(invoice.billing_period_start), "MMM dd")} -{" "}
                            {format(new Date(invoice.billing_period_end), "MMM dd, yyyy")}
                          </TableCell>
                          <TableCell className="font-medium">{formatCurrency(invoice.total_amount)}</TableCell>
                          <TableCell>{formatCurrency(invoice.amount_paid)}</TableCell>
                          <TableCell>{getStatusBadge(invoice.status)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {invoice.status !== "settled" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setSelectedInvoice(invoice);
                                    setPaymentAmount((invoice.total_amount - invoice.amount_paid).toString());
                                    setIsPaymentDialogOpen(true);
                                  }}
                                >
                                  <DollarSign className="h-3.5 w-3.5 mr-1" />
                                  Pay
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => setInvoiceToDelete(invoice)}
                                title="Delete invoice"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="adjustments" className="space-y-4">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead className="hidden md:table-cell">Reason</TableHead>
                      <TableHead className="w-[80px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {balanceAdjustments.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8">
                          <History className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                          <p className="text-muted-foreground">No balance adjustments</p>
                        </TableCell>
                      </TableRow>
                    ) : (
                      balanceAdjustments.map((adj) => (
                        <TableRow key={adj.id}>
                          <TableCell>{format(new Date(adj.created_at), "MMM dd, yyyy")}</TableCell>
                          <TableCell className="font-mono text-sm">{adj.reference_number}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              {adj.adjustment_type === "credit" && (
                                <TrendingDown className="h-3.5 w-3.5 text-emerald-600" />
                              )}
                              {adj.adjustment_type === "debit" && (
                                <TrendingUp className="h-3.5 w-3.5 text-amber-600" />
                              )}
                              {adj.adjustment_type === "correction" && (
                                <Edit className="h-3.5 w-3.5 text-blue-600" />
                              )}
                              {adj.adjustment_type === "write_off" && (
                                <FileX className="h-3.5 w-3.5 text-red-600" />
                              )}
                              {adj.adjustment_type === "settlement" && (
                                <Wallet className="h-3.5 w-3.5 text-emerald-600" />
                              )}
                              <span className="capitalize text-sm">{adj.adjustment_type.replace("_", " ")}</span>
                            </div>
                          </TableCell>
                          <TableCell
                            className={`font-medium ${
                              adj.adjustment_type === "credit" || adj.adjustment_type === "write_off" || adj.adjustment_type === "settlement"
                                ? "text-emerald-600"
                                : "text-amber-600"
                            }`}
                          >
                            {adj.adjustment_type === "credit" || adj.adjustment_type === "write_off" || adj.adjustment_type === "settlement" ? "-" : "+"}
                            {formatCurrency(adj.amount)}
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            <div className="max-w-xs">
                              <p className="truncate text-sm">{adj.reason}</p>
                              {adj.notes && (
                                <p className="text-xs text-muted-foreground truncate">{adj.notes}</p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {adj.adjustment_type === "write_off" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                onClick={() => setAdjustmentToRevert(adj)}
                              >
                                <Undo2 className="h-3.5 w-3.5 mr-1" />
                                Revert
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Create Settlement Dialog */}
        <Dialog open={isSettlementDialogOpen} onOpenChange={setIsSettlementDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Settlement Invoice</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {/* Settlement Mode Selection */}
              <div className="space-y-3">
                {/* Full Balance Option */}
                <div 
                  className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                    settlementMode === "full" ? "bg-primary/10 border-primary/30" : "bg-muted/30 hover:bg-muted/50"
                  }`}
                  onClick={() => setSettlementMode("full")}
                >
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium cursor-pointer">
                      Include Full Balance
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Settle all unpaid transactions at once
                    </p>
                  </div>
                  <div className={`h-4 w-4 rounded-full border-2 ${
                    settlementMode === "full" ? "border-primary bg-primary" : "border-muted-foreground"
                  }`}>
                    {settlementMode === "full" && (
                      <div className="h-full w-full flex items-center justify-center">
                        <div className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
                      </div>
                    )}
                  </div>
                </div>

                {/* Date Range Option */}
                <div 
                  className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                    settlementMode === "period" ? "bg-primary/10 border-primary/30" : "bg-muted/30 hover:bg-muted/50"
                  }`}
                  onClick={() => setSettlementMode("period")}
                >
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium cursor-pointer">
                      By Date Range
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Select transactions within a period
                    </p>
                  </div>
                  <div className={`h-4 w-4 rounded-full border-2 ${
                    settlementMode === "period" ? "border-primary bg-primary" : "border-muted-foreground"
                  }`}>
                    {settlementMode === "period" && (
                      <div className="h-full w-full flex items-center justify-center">
                        <div className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
                      </div>
                    )}
                  </div>
                </div>

                {/* Custom Amount Option */}
                <div 
                  className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                    settlementMode === "custom" ? "bg-primary/10 border-primary/30" : "bg-muted/30 hover:bg-muted/50"
                  }`}
                  onClick={() => setSettlementMode("custom")}
                >
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium cursor-pointer">
                      Custom Amount
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Enter any amount to settle
                    </p>
                  </div>
                  <div className={`h-4 w-4 rounded-full border-2 ${
                    settlementMode === "custom" ? "border-primary bg-primary" : "border-muted-foreground"
                  }`}>
                    {settlementMode === "custom" && (
                      <div className="h-full w-full flex items-center justify-center">
                        <div className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Current Balance Highlight (for full mode) */}
              {settlementMode === "full" && (
                <Card className="border bg-primary/10 border-primary/30">
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Wallet className="h-5 w-5 text-primary" />
                        <span className="text-sm font-medium text-primary">
                          Current Balance
                        </span>
                      </div>
                      <span className="text-2xl font-bold text-primary">
                        {formatCurrency(customer.current_balance)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {unpaidTransactions.length} transaction(s) will be included
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Date Filter (for period mode) */}
              {settlementMode === "period" && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Period Start</Label>
                    <Input
                      type="date"
                      value={settlementPeriod.start}
                      onChange={(e) => setSettlementPeriod({ ...settlementPeriod, start: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Period End</Label>
                    <Input
                      type="date"
                      value={settlementPeriod.end}
                      onChange={(e) => setSettlementPeriod({ ...settlementPeriod, end: e.target.value })}
                    />
                  </div>
                </div>
              )}

              {/* Custom Amount Input (for custom mode) */}
              {settlementMode === "custom" && (
                <div className="space-y-2">
                  <Label>Settlement Amount</Label>
                  <Input
                    type="number"
                    placeholder="Enter amount"
                    value={customSettlementAmount}
                    onChange={(e) => setCustomSettlementAmount(e.target.value)}
                    min="0"
                    step="0.01"
                  />
                  <p className="text-xs text-muted-foreground">
                    Current balance: {formatCurrency(customer.current_balance)}
                  </p>
                </div>
              )}

              <Card className="bg-muted/50">
                <CardContent className="pt-6">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Transactions</p>
                      <p className="font-semibold text-lg">
                        {settlementMode === "custom" ? "-" : settlementPreview.count}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Subtotal</p>
                      <p className="font-semibold text-lg">{formatCurrency(settlementPreview.subtotal)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Tax</p>
                      <p className="font-semibold">{formatCurrency(settlementPreview.tax)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Invoice Amount</p>
                      <p className="font-bold text-xl text-primary">{formatCurrency(settlementPreview.total)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsSettlementDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => createSettlementMutation.mutate()}
                disabled={
                  (settlementMode === "custom" && (!customSettlementAmount || parseFloat(customSettlementAmount) <= 0)) ||
                  (settlementMode !== "custom" && settlementPreview.count === 0) ||
                  createSettlementMutation.isPending
                }
              >
                Create Invoice
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Payment Dialog */}
        <Dialog open={isPaymentDialogOpen} onOpenChange={setIsPaymentDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Record Payment</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {selectedInvoice && (
                <Card className="bg-muted/50">
                  <CardContent className="pt-6">
                    <div className="flex justify-between text-sm">
                      <span>Invoice Total</span>
                      <span className="font-semibold">{formatCurrency(selectedInvoice.total_amount)}</span>
                    </div>
                    <div className="flex justify-between text-sm mt-1">
                      <span>Already Paid</span>
                      <span>{formatCurrency(selectedInvoice.amount_paid)}</span>
                    </div>
                    <div className="flex justify-between text-sm mt-1 pt-2 border-t">
                      <span className="font-medium">Remaining</span>
                      <span className="font-bold text-primary">
                        {formatCurrency(selectedInvoice.total_amount - selectedInvoice.amount_paid)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              )}
              <div className="space-y-2">
                <Label>Payment Amount</Label>
                <Input
                  type="number"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label>Payment Method</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                    <SelectItem value="cheque">Cheque</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Notes (Optional)</Label>
                <Textarea
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  placeholder="Payment reference, cheque number, etc."
                  rows={2}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsPaymentDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => recordPaymentMutation.mutate()}
                disabled={!paymentAmount || parseFloat(paymentAmount) <= 0 || recordPaymentMutation.isPending}
              >
                Record Payment
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Balance Adjustment Dialog */}
        <BalanceAdjustmentDialog
          open={isAdjustmentDialogOpen}
          onOpenChange={setIsAdjustmentDialogOpen}
          customer={{
            id: customer.id,
            name: customer.name,
            current_balance: customer.current_balance,
          }}
        />

        {/* Transaction Detail Dialog */}
        <Dialog open={!!selectedTransaction} onOpenChange={(open) => !open && setSelectedTransaction(null)}>
          <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Receipt className="h-5 w-5" />
                Transaction Details
              </DialogTitle>
            </DialogHeader>
            
            {selectedTransaction && (
              <ScrollArea className="flex-1 max-h-[65vh] pr-4" type="auto">
                <div className="space-y-4 py-2">
                  {/* Transaction Header */}
                  <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Receipt Number</span>
                      <span className="font-mono font-medium">{selectedTransaction.receipt_number}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Date & Time</span>
                      <span className="font-medium">
                        {format(new Date(selectedTransaction.created_at), "MMM dd, yyyy 'at' h:mm a")}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Payment Method</span>
                      <Badge variant="outline" className="capitalize">
                        {selectedTransaction.payment_method}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Status</span>
                      {selectedTransaction.settlement_status === "settled" || selectedTransaction.settlement_status === "paid" ? (
                        <Badge variant="outline" className="text-emerald-600 border-emerald-500/30">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Paid
                        </Badge>
                      ) : (selectedTransaction.paid_amount ?? 0) > 0 ? (
                        <Badge variant="outline" className="text-blue-600 border-blue-500/30">
                          <Clock className="h-3 w-3 mr-1" />
                          Partial
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-amber-600 border-amber-500/30">
                          <Clock className="h-3 w-3 mr-1" />
                          Unpaid
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Items Breakdown */}
                  <div className="space-y-2">
                    <h4 className="font-medium flex items-center gap-2">
                      <ShoppingCart className="h-4 w-4" />
                      Items ({selectedTransaction.sales_items?.length || 0})
                    </h4>
                    <div className="border rounded-lg divide-y">
                      {selectedTransaction.sales_items && selectedTransaction.sales_items.length > 0 ? (
                        selectedTransaction.sales_items.map((item: any, index: number) => (
                          <div key={item.id || index} className="flex items-center justify-between p-3">
                            <div className="flex-1">
                              <p className="font-medium">
                                {item.menu_items?.name || "Unknown Item"}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                {item.quantity} × {formatCurrency(item.unit_price)}
                              </p>
                            </div>
                            <p className="font-medium">
                              {formatCurrency(item.total_price)}
                            </p>
                          </div>
                        ))
                      ) : (
                        <div className="p-4 text-center text-muted-foreground">
                          No item details available
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Totals */}
                  <div className="border rounded-lg p-4 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span>{formatCurrency(selectedTransaction.subtotal)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Tax</span>
                      <span>{formatCurrency(selectedTransaction.tax)}</span>
                    </div>
                    <div className="border-t pt-2 mt-2 flex items-center justify-between font-bold text-lg">
                      <span>Total</span>
                      <span className="text-amber-600">{formatCurrency(selectedTransaction.total)}</span>
                    </div>
                  </div>
                </div>
              </ScrollArea>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setSelectedTransaction(null)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={!!transactionToDelete} onOpenChange={(open) => !open && setTransactionToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <Trash2 className="h-5 w-5 text-destructive" />
                Delete Transaction
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3">
                  <p>Are you sure you want to delete this unpaid transaction?</p>
                  {transactionToDelete && (
                    <>
                      <div className="p-3 bg-muted rounded-md space-y-1">
                        <p className="font-medium">{transactionToDelete.receipt_number}</p>
                        <p className="text-sm">Amount: {formatCurrency(transactionToDelete.total)}</p>
                      </div>
                      <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-md text-amber-700 dark:text-amber-400">
                        <p className="text-sm font-medium flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4" />
                          Balance Impact
                        </p>
                        <p className="text-sm mt-1">
                          Customer's balance will decrease by {formatCurrency(transactionToDelete.total)} (from {formatCurrency(customer.current_balance)} to {formatCurrency(Math.max(0, customer.current_balance - transactionToDelete.total))}).
                        </p>
                        <p className="text-xs mt-2 opacity-80">
                          Consider using "Write Off" instead to keep the transaction record.
                        </p>
                      </div>
                    </>
                  )}
                  <p className="text-sm text-muted-foreground">This action cannot be undone.</p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => transactionToDelete && deleteTransactionMutation.mutate(transactionToDelete.id)}
              >
                {deleteTransactionMutation.isPending ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Write Off Confirmation Dialog */}
        <AlertDialog open={!!transactionToWriteOff} onOpenChange={(open) => !open && setTransactionToWriteOff(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <FileCheck className="h-5 w-5 text-amber-600" />
                Write Off Transaction
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3">
                  <p>This will mark the transaction as written off and reduce the customer's balance.</p>
                  {transactionToWriteOff && (
                    <>
                      <div className="p-3 bg-muted rounded-md space-y-1">
                        <p className="font-medium">{transactionToWriteOff.receipt_number}</p>
                        <p className="text-sm">Amount: {formatCurrency(transactionToWriteOff.total)}</p>
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(transactionToWriteOff.created_at), "MMM dd, yyyy")}
                        </p>
                      </div>
                      <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-md text-emerald-700 dark:text-emerald-400">
                        <p className="text-sm font-medium flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4" />
                          What happens
                        </p>
                        <ul className="text-sm mt-1 space-y-1 list-disc list-inside">
                          <li>Transaction is marked as settled</li>
                          <li>A write-off adjustment is recorded</li>
                          <li>Balance decreases by {formatCurrency(transactionToWriteOff.total)}</li>
                          <li>Transaction history is preserved</li>
                        </ul>
                      </div>
                    </>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-amber-600 text-white hover:bg-amber-700"
                onClick={() => transactionToWriteOff && writeOffTransactionMutation.mutate(transactionToWriteOff)}
              >
                {writeOffTransactionMutation.isPending ? "Processing..." : "Write Off"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Revert Write-Off Confirmation Dialog */}
        <AlertDialog open={!!adjustmentToRevert} onOpenChange={(open) => !open && setAdjustmentToRevert(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <Undo2 className="h-5 w-5 text-blue-600" />
                Revert Write-Off
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3">
                  <p>This will create a reversing entry to restore the customer's balance.</p>
                  {adjustmentToRevert && (
                    <>
                      <div className="p-3 bg-muted rounded-md space-y-1">
                        <p className="font-medium">Original Write-Off</p>
                        <p className="text-sm">Amount: {formatCurrency(adjustmentToRevert.amount)}</p>
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(adjustmentToRevert.created_at), "MMM dd, yyyy")}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Reason: {adjustmentToRevert.reason}
                        </p>
                      </div>
                      <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-md text-blue-700 dark:text-blue-400">
                        <p className="text-sm font-medium flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4" />
                          What happens
                        </p>
                        <ul className="text-sm mt-1 space-y-1 list-disc list-inside">
                          <li>A debit adjustment is created to reverse the write-off</li>
                          <li>Balance increases by {formatCurrency(adjustmentToRevert.amount)}</li>
                          <li>Original write-off record is preserved</li>
                          <li>Full audit trail maintained</li>
                        </ul>
                      </div>
                    </>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-blue-600 text-white hover:bg-blue-700"
                onClick={() => adjustmentToRevert && revertWriteOffMutation.mutate(adjustmentToRevert)}
              >
                {revertWriteOffMutation.isPending ? "Processing..." : "Revert Write-Off"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Partial Payment Dialog */}
        <Dialog 
          open={!!transactionToPartialPay} 
          onOpenChange={(open) => {
            if (!open) {
              setTransactionToPartialPay(null);
              setPartialPaymentAmount("");
              setPartialPaymentNotes("");
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-emerald-600" />
                Record Payment
              </DialogTitle>
            </DialogHeader>
            {transactionToPartialPay && (
              <div className="space-y-4 py-4">
                {/* Transaction Info */}
                <div className="p-3 bg-muted rounded-lg space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Receipt</span>
                    <span className="font-mono text-sm">{transactionToPartialPay.receipt_number}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Total Amount</span>
                    <span className="font-medium">{formatCurrency(transactionToPartialPay.total)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Already Paid</span>
                    <span className="text-emerald-600">{formatCurrency(transactionToPartialPay.paid_amount || 0)}</span>
                  </div>
                  <div className="flex justify-between border-t pt-2">
                    <span className="text-sm font-medium">Remaining</span>
                    <span className="font-bold text-amber-600">
                      {formatCurrency(transactionToPartialPay.total - (transactionToPartialPay.paid_amount || 0))}
                    </span>
                  </div>
                </div>

                {/* Payment Amount */}
                <div className="space-y-2">
                  <Label>Payment Amount</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={transactionToPartialPay.total - (transactionToPartialPay.paid_amount || 0)}
                    value={partialPaymentAmount}
                    onChange={(e) => setPartialPaymentAmount(e.target.value)}
                    placeholder="Enter amount"
                  />
                </div>

                {/* Payment Method */}
                <div className="space-y-2">
                  <Label>Payment Method</Label>
                  <Select value={partialPaymentMethod} onValueChange={setPartialPaymentMethod}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="card">Card</SelectItem>
                      <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Notes */}
                <div className="space-y-2">
                  <Label>Notes (Optional)</Label>
                  <Textarea
                    value={partialPaymentNotes}
                    onChange={(e) => setPartialPaymentNotes(e.target.value)}
                    placeholder="Add any notes about this payment..."
                    rows={2}
                  />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setTransactionToPartialPay(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => partialPaymentMutation.mutate()}
                disabled={partialPaymentMutation.isPending || !partialPaymentAmount || parseFloat(partialPaymentAmount) <= 0}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {partialPaymentMutation.isPending ? "Processing..." : "Record Payment"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Transaction Dialog */}
        <Dialog 
          open={isEditDialogOpen} 
          onOpenChange={(open) => {
            if (!open) {
              setIsEditDialogOpen(false);
              setTransactionToEdit(null);
              setEditSubtotal("");
            }
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Edit className="h-5 w-5 text-blue-600" />
                Edit Transaction
              </DialogTitle>
            </DialogHeader>
            {transactionToEdit && (
              <div className="space-y-4 py-4">
                <div className="p-3 bg-muted rounded-lg">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Receipt #</span>
                    <span className="font-mono">{transactionToEdit.receipt_number}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Gross price, VAT inclusive</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={editSubtotal}
                    onChange={(e) => setEditSubtotal(e.target.value)}
                    placeholder="Enter subtotal"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Tax Rate (%)</Label>
                  <Input
                    type="number"
                    step="1"
                    min="0"
                    max="100"
                    value={editTaxRate}
                    onChange={(e) => setEditTaxRate(e.target.value)}
                    placeholder="15"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Payment Method</Label>
                  <Select 
                    value={editPaymentMethod} 
                    onValueChange={(v) => setEditPaymentMethod(v as "cash" | "card" | "other")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="card">Card</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Preview */}
                <div className="border-t pt-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Net</span>
                    <span>{formatCurrency(splitInclusive(parseFloat(editSubtotal) || 0, (parseFloat(editTaxRate) || 0) / 100).net)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Tax ({editTaxRate}%)</span>
                    <span>{formatCurrency(splitInclusive(parseFloat(editSubtotal) || 0, (parseFloat(editTaxRate) || 0) / 100).vat)}</span>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <span>Total</span>
                    <span>{formatCurrency(parseFloat(editSubtotal) || 0)}</span>
                  </div>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => editTransactionMutation.mutate()}
                disabled={editTransactionMutation.isPending || !editSubtotal || parseFloat(editSubtotal) <= 0}
              >
                {editTransactionMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Invoice Confirmation Dialog */}
        <AlertDialog open={!!invoiceToDelete} onOpenChange={(open) => !open && setInvoiceToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <Trash2 className="h-5 w-5 text-destructive" />
                Delete Settlement Invoice
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3">
                  <p>Are you sure you want to delete this settlement invoice?</p>
                  {invoiceToDelete && (
                    <>
                      <div className="p-3 bg-muted rounded-md space-y-1">
                        <p className="font-medium">{invoiceToDelete.invoice_number}</p>
                        <p className="text-sm">Amount: {formatCurrency(invoiceToDelete.total_amount)}</p>
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(invoiceToDelete.billing_period_start), "MMM dd")} -{" "}
                          {format(new Date(invoiceToDelete.billing_period_end), "MMM dd, yyyy")}
                        </p>
                      </div>
                      <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-md text-amber-700 dark:text-amber-400">
                        <p className="text-sm font-medium flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4" />
                          What happens
                        </p>
                        <ul className="text-sm mt-1 space-y-1 list-disc list-inside">
                          <li>Linked transactions will be unlinked</li>
                          <li>Any recorded payments will be removed</li>
                          <li>Transactions will return to unpaid status</li>
                          <li>This action cannot be undone</li>
                        </ul>
                      </div>
                    </>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => invoiceToDelete && deleteInvoiceMutation.mutate(invoiceToDelete)}
              >
                {deleteInvoiceMutation.isPending ? "Deleting..." : "Delete Invoice"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </>
  );
}
