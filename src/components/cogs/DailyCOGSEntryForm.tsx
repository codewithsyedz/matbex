import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Package,
  ShoppingCart,
  DollarSign,
  AlertTriangle,
  CheckCircle,
  Plus,
  Trash2,
  FileText,
  Send,
  Save,
  Calculator,
  Percent,
  TrendingUp,
  Clock,
  User,
  ChefHat,
  Download,
} from "lucide-react";
import { exportCOGSToExcel } from "@/lib/cogsExportUtils";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/hooks/useCurrency";
import {
  useCOGSSubmissions,
  useCOGSStockItems,
  useCOGSPurchases,
  COGSSubmission,
  STOCK_CATEGORIES,
  ITEM_TYPES,
  PAYMENT_MODES,
  SHIFT_TYPES,
  EXCEPTION_REASONS,
} from "@/hooks/useCOGSSubmissions";
import { format } from "date-fns";

interface DailyCOGSEntryFormProps {
  submission: COGSSubmission;
  onClose: () => void;
  readOnly?: boolean;
}

export function DailyCOGSEntryForm({ submission, onClose, readOnly = false }: DailyCOGSEntryFormProps) {
  const { format: formatCurrency } = useCurrency();
  const { updateSubmission, submitForApproval, checkRemarksRequired, getFoodCostStatus } = useCOGSSubmissions();
  const { stockItems, upsertStockItem, openingTotal, closingTotal } = useCOGSStockItems(submission.id);
  const { purchases, addPurchase, deletePurchase, purchasesTotal, missingBillsCount } = useCOGSPurchases(submission.id);

  // Local state for form values
  const [cashSales, setCashSales] = useState(submission.cash_sales.toString());
  const [cardSales, setCardSales] = useState(submission.card_sales.toString());
  const [onlineSales, setOnlineSales] = useState(submission.online_sales.toString());
  const [kitchenIncharge, setKitchenIncharge] = useState(submission.kitchen_incharge_name || "");
  
  // Purchase form state
  const [showPurchaseForm, setShowPurchaseForm] = useState(false);
  const [purchaseSupplier, setPurchaseSupplier] = useState("");
  const [purchaseInvoice, setPurchaseInvoice] = useState("");
  const [purchasePaymentMode, setPurchasePaymentMode] = useState<'cash' | 'credit' | 'transfer'>('cash');
  const [purchaseItemType, setPurchaseItemType] = useState("");
  const [purchaseAmount, setPurchaseAmount] = useState("");
  const [purchaseNotes, setPurchaseNotes] = useState("");

  // Remarks dialog state
  const [showRemarksDialog, setShowRemarksDialog] = useState(false);
  const [remarksReasonCode, setRemarksReasonCode] = useState("");
  const [remarksText, setRemarksText] = useState("");

  // Calculate values
  const totalSales = parseFloat(cashSales || "0") + parseFloat(cardSales || "0") + parseFloat(onlineSales || "0");
  const cogs = openingTotal + purchasesTotal - closingTotal;
  const foodCostPercentage = totalSales > 0 ? (cogs / totalSales) * 100 : 0;
  const foodCostStatus = getFoodCostStatus(foodCostPercentage);

  // Update submission when values change
  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      if (!readOnly && (
        parseFloat(cashSales) !== submission.cash_sales ||
        parseFloat(cardSales) !== submission.card_sales ||
        parseFloat(onlineSales) !== submission.online_sales ||
        openingTotal !== submission.opening_stock_value ||
        closingTotal !== submission.closing_stock_value ||
        purchasesTotal !== submission.purchases_value
      )) {
        updateSubmission.mutate({
          id: submission.id,
          cash_sales: parseFloat(cashSales) || 0,
          card_sales: parseFloat(cardSales) || 0,
          online_sales: parseFloat(onlineSales) || 0,
          opening_stock_value: openingTotal,
          closing_stock_value: closingTotal,
          purchases_value: purchasesTotal,
        });
      }
    }, 500);

    return () => clearTimeout(debounceTimer);
  }, [cashSales, cardSales, onlineSales, openingTotal, closingTotal, purchasesTotal]);

  const handleStockChange = (stockType: 'opening' | 'closing', category: string, value: string) => {
    if (readOnly) return;
    upsertStockItem.mutate({
      submission_id: submission.id,
      stock_type: stockType,
      category,
      amount: parseFloat(value) || 0,
    });
  };

  const handleAddPurchase = () => {
    if (!purchaseItemType || !purchaseAmount) return;
    
    addPurchase.mutate({
      submission_id: submission.id,
      supplier_name: purchaseSupplier || undefined,
      invoice_number: purchaseInvoice || undefined,
      payment_mode: purchasePaymentMode,
      item_type: purchaseItemType,
      amount: parseFloat(purchaseAmount) || 0,
      notes: purchaseNotes || undefined,
    }, {
      onSuccess: () => {
        setShowPurchaseForm(false);
        setPurchaseSupplier("");
        setPurchaseInvoice("");
        setPurchasePaymentMode('cash');
        setPurchaseItemType("");
        setPurchaseAmount("");
        setPurchaseNotes("");
      },
    });
  };

  const handleKitchenVerify = () => {
    if (!kitchenIncharge.trim()) return;
    updateSubmission.mutate({
      id: submission.id,
      kitchen_incharge_name: kitchenIncharge,
      kitchen_verified_at: new Date().toISOString(),
    });
  };

  const handleSubmit = () => {
    // Check if remarks are required
    const remarksCheck = checkRemarksRequired({
      ...submission,
      food_cost_percentage: foodCostPercentage,
      purchases_value: purchasesTotal,
    });

    if (remarksCheck.required) {
      setShowRemarksDialog(true);
    } else {
      submitForApproval.mutate({
        id: submission.id,
        requiresRemarks: false,
      }, {
        onSuccess: onClose,
      });
    }
  };

  const handleSubmitWithRemarks = () => {
    if (!remarksReasonCode || !remarksText.trim()) return;
    
    submitForApproval.mutate({
      id: submission.id,
      requiresRemarks: true,
      reasonCode: remarksReasonCode,
      remarks: remarksText,
    }, {
      onSuccess: () => {
        setShowRemarksDialog(false);
        onClose();
      },
    });
  };

  const getStockValue = (stockType: 'opening' | 'closing', category: string) => {
    const item = stockItems?.find(i => i.stock_type === stockType && i.category === category);
    return item?.amount?.toString() || "";
  };

  const isSubmittable = totalSales > 0 && submission.status === 'draft';

  return (
    <>
      <div className="space-y-6">
        {/* Header Info */}
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">{format(new Date(submission.submission_date), "MMMM d, yyyy")}</span>
            </div>
            <Badge variant="outline">
              {SHIFT_TYPES.find(s => s.value === submission.shift_type)?.label || submission.shift_type}
            </Badge>
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">{submission.cashier_name}</span>
            </div>
            <Badge
              variant={submission.status === 'approved' ? 'default' : submission.status === 'rejected' ? 'destructive' : 'secondary'}
            >
              {submission.status.charAt(0).toUpperCase() + submission.status.slice(1)}
            </Badge>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (stockItems && purchases) {
                exportCOGSToExcel(submission, stockItems, purchases);
              }
            }}
          >
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>

        {/* COGS Summary Card */}
        <Card className={cn("border-2", foodCostStatus.status === 'critical' ? "border-destructive/50" : foodCostStatus.status === 'warning' ? "border-warning/50" : "border-success/50")}>
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-center justify-center gap-4 text-sm">
              <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-muted">
                <Package className="h-5 w-5 text-muted-foreground" />
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Opening Stock</p>
                  <p className="font-semibold text-lg">{formatCurrency(openingTotal)}</p>
                </div>
              </div>
              <span className="text-2xl font-light text-muted-foreground">+</span>
              <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-muted">
                <ShoppingCart className="h-5 w-5 text-muted-foreground" />
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Purchases</p>
                  <p className="font-semibold text-lg">{formatCurrency(purchasesTotal)}</p>
                </div>
              </div>
              <span className="text-2xl font-light text-muted-foreground">−</span>
              <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-muted">
                <Package className="h-5 w-5 text-muted-foreground" />
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Closing Stock</p>
                  <p className="font-semibold text-lg">{formatCurrency(closingTotal)}</p>
                </div>
              </div>
              <span className="text-2xl font-light text-muted-foreground">=</span>
              <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-primary/10 border border-primary/20">
                <Calculator className="h-5 w-5 text-primary" />
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">COGS</p>
                  <p className="font-semibold text-lg text-primary">{formatCurrency(cogs)}</p>
                </div>
              </div>
            </div>

            {/* Food Cost % */}
            <div className="mt-4 pt-4 border-t">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Percent className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Food Cost %</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn("text-2xl font-bold", foodCostStatus.color)}>
                    {foodCostPercentage.toFixed(1)}%
                  </span>
                  {foodCostStatus.status === 'healthy' ? (
                    <CheckCircle className="h-5 w-5 text-success" />
                  ) : (
                    <AlertTriangle className={cn("h-5 w-5", foodCostStatus.color)} />
                  )}
                </div>
              </div>
              <Progress 
                value={Math.min(foodCostPercentage, 100)} 
                className={cn(
                  "h-2",
                  foodCostStatus.status === 'critical' && "[&>div]:bg-destructive",
                  foodCostStatus.status === 'warning' && "[&>div]:bg-warning"
                )}
              />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>Target: ≤40%</span>
                <span className={foodCostStatus.color}>{foodCostStatus.label}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Missing Bills Alert */}
        {missingBillsCount > 0 && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-warning/10 border border-warning/30 text-warning">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm font-medium">{missingBillsCount} purchase(s) flagged for missing bill</span>
          </div>
        )}

        {/* Accordion Sections */}
        <Accordion type="multiple" defaultValue={["opening-stock", "sales"]} className="w-full">
          {/* Opening Stock */}
          <AccordionItem value="opening-stock">
            <AccordionTrigger className="text-base font-medium">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4" />
                Opening Stock
                <Badge variant="secondary" className="ml-2">{formatCurrency(openingTotal)}</Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-2">
                {STOCK_CATEGORIES.map((cat) => (
                  <div key={`opening-${cat.value}`}>
                    <Label className="text-xs text-muted-foreground">{cat.label}</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={getStockValue('opening', cat.value)}
                      onChange={(e) => handleStockChange('opening', cat.value, e.target.value)}
                      disabled={readOnly}
                      className="mt-1"
                    />
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Purchases */}
          <AccordionItem value="purchases">
            <AccordionTrigger className="text-base font-medium">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-4 w-4" />
                Purchases During Shift
                <Badge variant="secondary" className="ml-2">{formatCurrency(purchasesTotal)}</Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-4 pt-2">
                {purchases && purchases.length > 0 && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Supplier</TableHead>
                        <TableHead>Invoice #</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Payment</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        {!readOnly && <TableHead className="w-10"></TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {purchases.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell>{p.supplier_name || "-"}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              {p.invoice_number || "-"}
                              {p.missing_bill && (
                                <AlertTriangle className="h-3 w-3 text-warning" />
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {ITEM_TYPES.find(t => t.value === p.item_type)?.label || p.item_type}
                          </TableCell>
                          <TableCell>
                            {PAYMENT_MODES.find(m => m.value === p.payment_mode)?.label || p.payment_mode}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(p.amount)}
                          </TableCell>
                          {!readOnly && (
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => deletePurchase.mutate(p.id)}
                              >
                                <Trash2 className="h-4 w-4 text-muted-foreground" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}

                {!readOnly && !showPurchaseForm && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setShowPurchaseForm(true)}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Purchase
                  </Button>
                )}

                {showPurchaseForm && (
                  <Card className="border-dashed">
                    <CardContent className="pt-6 space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label>Supplier Name</Label>
                          <Input
                            value={purchaseSupplier}
                            onChange={(e) => setPurchaseSupplier(e.target.value)}
                            placeholder="Optional"
                          />
                        </div>
                        <div>
                          <Label>Invoice / Bill #</Label>
                          <Input
                            value={purchaseInvoice}
                            onChange={(e) => setPurchaseInvoice(e.target.value)}
                            placeholder="Optional (flagged if missing)"
                          />
                        </div>
                        <div>
                          <Label>Item Type *</Label>
                          <Select value={purchaseItemType} onValueChange={setPurchaseItemType}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                            <SelectContent>
                              {ITEM_TYPES.map((type) => (
                                <SelectItem key={type.value} value={type.value}>
                                  {type.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>Payment Mode</Label>
                          <Select value={purchasePaymentMode} onValueChange={(v: any) => setPurchasePaymentMode(v)}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {PAYMENT_MODES.map((mode) => (
                                <SelectItem key={mode.value} value={mode.value}>
                                  {mode.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>Amount (SAR) *</Label>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={purchaseAmount}
                            onChange={(e) => setPurchaseAmount(e.target.value)}
                            placeholder="0.00"
                          />
                        </div>
                        <div>
                          <Label>Notes</Label>
                          <Input
                            value={purchaseNotes}
                            onChange={(e) => setPurchaseNotes(e.target.value)}
                            placeholder="Optional"
                          />
                        </div>
                      </div>
                      <div className="flex gap-2 justify-end">
                        <Button variant="ghost" onClick={() => setShowPurchaseForm(false)}>
                          Cancel
                        </Button>
                        <Button onClick={handleAddPurchase} disabled={!purchaseItemType || !purchaseAmount}>
                          Add
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Closing Stock */}
          <AccordionItem value="closing-stock">
            <AccordionTrigger className="text-base font-medium">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4" />
                Closing Stock
                <Badge variant="secondary" className="ml-2">{formatCurrency(closingTotal)}</Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-2">
                {STOCK_CATEGORIES.map((cat) => (
                  <div key={`closing-${cat.value}`}>
                    <Label className="text-xs text-muted-foreground">{cat.label}</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={getStockValue('closing', cat.value)}
                      onChange={(e) => handleStockChange('closing', cat.value, e.target.value)}
                      disabled={readOnly}
                      className="mt-1"
                    />
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Sales Summary */}
          <AccordionItem value="sales">
            <AccordionTrigger className="text-base font-medium">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Sales Summary
                <Badge variant="secondary" className="ml-2">{formatCurrency(totalSales)}</Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                <div>
                  <Label>Cash Sales</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={cashSales}
                    onChange={(e) => setCashSales(e.target.value)}
                    disabled={readOnly}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Card Sales</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={cardSales}
                    onChange={(e) => setCardSales(e.target.value)}
                    disabled={readOnly}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Online / Delivery Sales</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={onlineSales}
                    onChange={(e) => setOnlineSales(e.target.value)}
                    disabled={readOnly}
                    className="mt-1"
                  />
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Kitchen Verification */}
          <AccordionItem value="verification">
            <AccordionTrigger className="text-base font-medium">
              <div className="flex items-center gap-2">
                <ChefHat className="h-4 w-4" />
                Kitchen Verification
                {submission.kitchen_verified_at && (
                  <CheckCircle className="h-4 w-4 text-success ml-2" />
                )}
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-4 pt-2">
                <div className="flex gap-4 items-end">
                  <div className="flex-1">
                    <Label>Kitchen In-Charge Name</Label>
                    <Input
                      value={kitchenIncharge}
                      onChange={(e) => setKitchenIncharge(e.target.value)}
                      placeholder="Enter name for verification"
                      disabled={readOnly || !!submission.kitchen_verified_at}
                      className="mt-1"
                    />
                  </div>
                  {!readOnly && !submission.kitchen_verified_at && (
                    <Button
                      onClick={handleKitchenVerify}
                      disabled={!kitchenIncharge.trim()}
                    >
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Verify Stock
                    </Button>
                  )}
                </div>
                {submission.kitchen_verified_at && (
                  <div className="flex items-center gap-2 text-sm text-success">
                    <CheckCircle className="h-4 w-4" />
                    Verified by {submission.kitchen_incharge_name} at{" "}
                    {format(new Date(submission.kitchen_verified_at), "MMM d, h:mm a")}
                  </div>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {/* Action Buttons */}
        {!readOnly && submission.status === 'draft' && (
          <div className="flex gap-3 pt-4 border-t">
            <Button variant="outline" onClick={onClose} className="flex-1">
              <Save className="h-4 w-4 mr-2" />
              Save Draft
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!isSubmittable}
              className="flex-1"
            >
              <Send className="h-4 w-4 mr-2" />
              Submit for Approval
            </Button>
          </div>
        )}

        {submission.status === 'rejected' && submission.rejection_reason && (
          <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/30">
            <div className="flex items-center gap-2 text-destructive font-medium mb-1">
              <AlertTriangle className="h-4 w-4" />
              Rejection Reason
            </div>
            <p className="text-sm text-muted-foreground">{submission.rejection_reason}</p>
          </div>
        )}
      </div>

      {/* Remarks Dialog */}
      <Dialog open={showRemarksDialog} onOpenChange={setShowRemarksDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              Remarks Required
            </DialogTitle>
            <DialogDescription>
              Food Cost % is {foodCostPercentage.toFixed(1)}% which exceeds the 45% threshold.
              Please provide a reason before submitting.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div>
              <Label>Reason *</Label>
              <Select value={remarksReasonCode} onValueChange={setRemarksReasonCode}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select a reason" />
                </SelectTrigger>
                <SelectContent>
                  {EXCEPTION_REASONS.map((reason) => (
                    <SelectItem key={reason.value} value={reason.value}>
                      {reason.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Remarks *</Label>
              <Textarea
                value={remarksText}
                onChange={(e) => setRemarksText(e.target.value)}
                placeholder="Provide detailed explanation..."
                className="mt-1"
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRemarksDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmitWithRemarks}
              disabled={!remarksReasonCode || !remarksText.trim()}
            >
              Submit with Remarks
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
