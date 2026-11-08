import { useState, useEffect } from "react";
import { Eye, FileText, Download, Check, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { useCurrency } from "@/hooks/useCurrency";
import { toast } from "sonner";
import { format } from "date-fns";

interface Invoice {
  id: string;
  invoice_number: string;
  supplier_id: string | null;
  invoice_date: string;
  due_date: string | null;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  status: string;
  notes: string | null;
  image_url: string | null;
  account_id: string | null;
  ledger_posted: boolean | null;
  suppliers: { name: string } | null;
}

interface InvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
}

interface ViewInvoiceDialogProps {
  invoice: Invoice;
  onLedgerPosted?: () => void;
}

export function ViewInvoiceDialog({ invoice, onLedgerPosted }: ViewInvoiceDialogProps) {
  const { restaurant, isManager, isOwner, hasFeature } = useAuth();
  const { format: formatCurrency } = useCurrency();
  const { accounts } = useChartOfAccounts();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string>(invoice.account_id || "");
  const [signedImageUrl, setSignedImageUrl] = useState<string | null>(null);

  const hasAccounting = hasFeature("accounting");
  const canPost = (isManager || isOwner) && hasAccounting && !invoice.ledger_posted;

  // Get COGS and Expense accounts for selection
  const cogsExpenseAccounts = accounts.filter(
    (acc) => acc.is_active && (acc.account_type === "cogs" || acc.account_type === "expense" || acc.account_type === "asset")
  );

  // Get the mapped account details
  const mappedAccount = accounts.find((acc) => acc.id === invoice.account_id);

  useEffect(() => {
    if (open) {
      fetchInvoiceItems();
      if (invoice.image_url) {
        fetchSignedUrl();
      }
    }
  }, [open, invoice.id]);

  const fetchInvoiceItems = async () => {
    setLoading(true);
    try {
      const { data, error } = await db
        .from("invoice_items")
        .select("*")
        .eq("invoice_id", invoice.id);

      if (error) throw error;
      setItems(data || []);
    } catch (error) {
      console.error("Error fetching invoice items:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSignedUrl = async () => {
    if (!invoice.image_url) return;
    
    try {
      const { data, error } = await db.storage
        .from("invoice-images")
        .createSignedUrl(invoice.image_url.replace("invoice-images/", ""), 3600);

      if (error) throw error;
      setSignedImageUrl(data.signedUrl);
    } catch (error) {
      console.error("Error getting signed URL:", error);
    }
  };

  const handlePostToLedger = async () => {
    if (!selectedAccountId) {
      toast.error("Please select an account to post to");
      return;
    }

    setPosting(true);
    try {
      const { error } = await db.rpc("post_purchase_invoice_to_ledger", {
        p_invoice_id: invoice.id,
        p_account_id: selectedAccountId,
      });

      if (error) throw error;
      toast.success("Invoice posted to ledger");
      onLedgerPosted?.();
      setOpen(false);
    } catch (error: any) {
      console.error("Error posting to ledger:", error);
      toast.error(error.message || "Failed to post to ledger");
    } finally {
      setPosting(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "paid":
        return "bg-emerald-500/10 text-emerald-600";
      case "pending":
        return "bg-amber-500/10 text-amber-600";
      case "overdue":
        return "bg-red-500/10 text-red-600";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" title="View Invoice">
          <Eye className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent
        description={`Invoice ${invoice.invoice_number} from ${invoice.suppliers?.name ?? "supplier"} dated ${format(new Date(invoice.invoice_date), "MMM d, yyyy")} - status ${invoice.status}.`}
        className="sm:max-w-2xl max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Invoice {invoice.invoice_number}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Invoice Header Info */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Supplier:</span>
              <p className="font-medium">{invoice.suppliers?.name || "-"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Status:</span>
              <div className="mt-1">
                <Badge variant="secondary" className={getStatusColor(invoice.status)}>
                  {invoice.status}
                </Badge>
              </div>
            </div>
            <div>
              <span className="text-muted-foreground">Invoice Date:</span>
              <p className="font-medium">{format(new Date(invoice.invoice_date), "MMM d, yyyy")}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Due Date:</span>
              <p className="font-medium">
                {invoice.due_date ? format(new Date(invoice.due_date), "MMM d, yyyy") : "-"}
              </p>
            </div>
          </div>

          <Separator />

          {/* Line Items */}
          <div>
            <h4 className="font-medium mb-2">Line Items</h4>
            {loading ? (
              <div className="text-center py-4 text-muted-foreground">Loading items...</div>
            ) : items.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground">No items</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit Price</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.description}</TableCell>
                      <TableCell className="text-right">{item.quantity}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.unit_price)}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(item.total_price)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-56 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal:</span>
                <span>{formatCurrency(invoice.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tax:</span>
                <span>{formatCurrency(invoice.tax_amount)}</span>
              </div>
              <Separator />
              <div className="flex justify-between font-semibold text-base">
                <span>Total:</span>
                <span>{formatCurrency(invoice.total_amount)}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          {invoice.notes && (
            <>
              <Separator />
              <div>
                <h4 className="font-medium mb-1">Notes</h4>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{invoice.notes}</p>
              </div>
            </>
          )}

          {/* Invoice Image */}
          {signedImageUrl && (
            <>
              <Separator />
              <div>
                <h4 className="font-medium mb-2">Invoice Image</h4>
                <a href={signedImageUrl} target="_blank" rel="noopener noreferrer">
                  <img
                    src={signedImageUrl}
                    alt="Invoice"
                    className="max-h-48 rounded-lg border object-contain hover:opacity-90 transition-opacity cursor-pointer"
                  />
                </a>
              </div>
            </>
          )}

          <Separator />

          {/* COA Integration Section */}
          <div className="space-y-3">
            <h4 className="font-medium flex items-center gap-2">
              Accounting Integration
              {invoice.ledger_posted && (
                <Badge variant="outline" className="text-emerald-600 border-emerald-300 bg-emerald-50">
                  <Check className="h-3 w-3 mr-1" />
                  Posted
                </Badge>
              )}
            </h4>

            {invoice.ledger_posted ? (
              <div className="text-sm space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Posted to Account:</span>
                  <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">
                    {mappedAccount?.account_code}
                  </span>
                  <span className="font-medium">{mappedAccount?.account_name}</span>
                </div>
                <p className="text-muted-foreground text-xs">
                  This invoice has been posted to the ledger. DR {mappedAccount?.account_name}, CR Accounts Payable.
                </p>
              </div>
            ) : hasAccounting ? (
              <div className="space-y-3">
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">
                    Select Account for Posting
                  </label>
                  <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select COGS/Expense/Asset account" />
                    </SelectTrigger>
                    <SelectContent>
                      {cogsExpenseAccounts.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          <span className="flex items-center gap-2">
                            <span className="font-mono text-xs text-muted-foreground">
                              {account.account_code}
                            </span>
                            {account.account_name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {canPost && (
                  <Button
                    onClick={handlePostToLedger}
                    disabled={posting || !selectedAccountId}
                    className="w-full"
                  >
                    {posting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Posting...
                      </>
                    ) : (
                      <>
                        <Check className="h-4 w-4 mr-2" />
                        Post to Ledger
                      </>
                    )}
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Enable the Accounting feature to post invoices to the ledger.
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
