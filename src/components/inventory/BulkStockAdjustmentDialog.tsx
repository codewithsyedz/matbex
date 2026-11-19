import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Upload,
  FileDown,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ArrowUp,
  ArrowDown,
  Layers,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  parseAdjustmentCsv,
  validateAdjustmentRows,
  REASON_LABELS,
  type ParsedAdjustmentRow,
  type InventoryItemLookup,
  type ValidReasonCode,
} from "@/lib/stockAdjustmentParser";
import { downloadStockAdjustmentTemplate } from "@/lib/stockAdjustmentTemplate";

interface BulkStockAdjustmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = "upload" | "preview" | "submitting";

export function BulkStockAdjustmentDialog({
  open,
  onOpenChange,
}: BulkStockAdjustmentDialogProps) {
  const { restaurant, profile, user } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState<string>("");
  const [headerErrors, setHeaderErrors] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<ParsedAdjustmentRow[]>([]);
  const [submitProgress, setSubmitProgress] = useState({ done: 0, total: 0 });

  const validRows = parsedRows.filter((r) => r.errors.length === 0);
  const errorRows = parsedRows.filter((r) => r.errors.length > 0);
  const warningRows = parsedRows.filter((r) => r.errors.length === 0 && r.warnings.length > 0);

  const reset = () => {
    setStep("upload");
    setFileName("");
    setHeaderErrors([]);
    setParsedRows([]);
    setSubmitProgress({ done: 0, total: 0 });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleClose = (next: boolean) => {
    if (!next && step !== "submitting") {
      reset();
      onOpenChange(false);
    } else if (next) {
      onOpenChange(true);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !restaurant?.id) return;
    setFileName(file.name);

    try {
      const text = await file.text();
      const parsed = parseAdjustmentCsv(text);
      if (parsed.headerErrors.length > 0) {
        setHeaderErrors(parsed.headerErrors);
        setParsedRows([]);
        setStep("preview");
        return;
      }

      // Pull active items for validation
      const sb = db as any;
      const { data: items, error } = await sb
        .from("inventory_items")
        .select("id, name, current_stock, unit, stock_unit")
        .eq("restaurant_id", restaurant.id)
        .eq("is_active", true);
      if (error) throw error;

      const validated = validateAdjustmentRows(
        parsed.rows,
        (items || []) as InventoryItemLookup[],
      );
      setHeaderErrors([]);
      setParsedRows(validated);
      setStep("preview");
    } catch (err: any) {
      console.error("CSV parse failed", err);
      toast.error(err.message || "Failed to read CSV");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleImport = async () => {
    if (!restaurant?.id || !user?.id || !profile?.tenant_id) {
      toast.error("Authentication required");
      return;
    }
    if (validRows.length === 0) {
      toast.error("No valid rows to import");
      return;
    }

    setStep("submitting");
    setSubmitProgress({ done: 0, total: validRows.length });

    let successCount = 0;
    const failures: Array<{ rowNumber: number; itemName: string; message: string }> = [];

    // Process sequentially so each row picks up the previous row's running stock
    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      try {
        const signed = row.direction === "add" ? row.quantity : -row.quantity;

        // Re-read current_stock right before update for atomic correctness
        const { data: liveItem, error: readErr } = await db
          .from("inventory_items")
          .select("id, current_stock, unit, stock_unit")
          .eq("id", row.itemId!)
          .single();
        if (readErr) throw readErr;

        const stockBefore = Number(liveItem?.current_stock) || 0;
        const stockAfter = stockBefore + signed;
        const stockUnit =
          (liveItem as any)?.stock_unit || liveItem?.unit || row.stockUnit || "unit";

        const { error: updErr } = await db
          .from("inventory_items")
          .update({
            current_stock: stockAfter,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.itemId!);
        if (updErr) throw updErr;

        const reasonLabel = REASON_LABELS[row.reasonCode as ValidReasonCode];
        const fullReason = [
          `Bulk import - ${reasonLabel}`,
          row.notes,
        ]
          .filter(Boolean)
          .join(" - ");

        const sb = db as any;
        const { error: movErr } = await sb.from("stock_movements").insert({
          tenant_id: profile.tenant_id,
          restaurant_id: restaurant.id,
          inventory_item_id: row.itemId!,
          movement_type: "adjustment",
          quantity_change: signed,
          stock_before: stockBefore,
          stock_after: stockAfter,
          reason: fullReason,
          reference_type: "bulk_adjustment",
          reference_id: row.referenceNumber || null,
          created_by: user.id,
        });
        if (movErr) throw movErr;

        successCount++;
      } catch (err: any) {
        console.error("Bulk row failed", row, err);
        failures.push({
          rowNumber: row.rowNumber,
          itemName: row.itemName,
          message: err?.message || "Unknown error",
        });
      }
      setSubmitProgress({ done: i + 1, total: validRows.length });
    }

    queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
    queryClient.invalidateQueries({ queryKey: ["inventory-items-for-adjust"] });
    queryClient.invalidateQueries({ queryKey: ["inventory-items-for-movements"] });
    queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
    queryClient.invalidateQueries({ queryKey: ["inventory-negative-stock"] });

    if (failures.length === 0) {
      toast.success(`Imported ${successCount} stock adjustments`);
      reset();
      onOpenChange(false);
    } else {
      toast.error(
        `Imported ${successCount} of ${validRows.length} rows - ${failures.length} failed`,
        {
          description: failures
            .slice(0, 3)
            .map((f) => `Row ${f.rowNumber} (${f.itemName}): ${f.message}`)
            .join(" • "),
          duration: 8000,
        },
      );
      setStep("preview");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            Bulk Stock Correction
          </DialogTitle>
          <DialogDescription>
            Upload a CSV in the Movements Template format. Every valid row creates an entry in
            the stock movements audit trail.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={handleFileSelect}
        />

        {step === "upload" && (
          <div className="flex-1 flex flex-col items-center justify-center py-10 text-center space-y-4">
            <div className="rounded-full bg-primary/10 p-4">
              <Upload className="h-8 w-8 text-primary" />
            </div>
            <div>
              <p className="font-medium">Upload a stock adjustment CSV</p>
              <p className="text-sm text-muted-foreground mt-1">
                Required columns: item_name, direction, quantity, reason_code
              </p>
              <p className="text-xs text-muted-foreground">
                Optional columns: reference_number, notes
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={downloadStockAdjustmentTemplate}
                className="gap-1.5"
              >
                <FileDown className="h-4 w-4" />
                Download Template
              </Button>
              <Button
                onClick={() => fileInputRef.current?.click()}
                className="gap-1.5"
              >
                <Upload className="h-4 w-4" />
                Choose CSV file
              </Button>
            </div>
          </div>
        )}

        {step === "preview" && (
          <div className="flex-1 flex flex-col min-h-0 gap-3">
            {fileName && (
              <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {fileName}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 gap-1"
                  onClick={reset}
                >
                  <X className="h-3.5 w-3.5" />
                  Choose another
                </Button>
              </div>
            )}

            {headerErrors.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <p className="font-medium mb-1">Invalid CSV format</p>
                  <ul className="list-disc pl-4 text-xs space-y-0.5">
                    {headerErrors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {parsedRows.length > 0 && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <SummaryPill
                    icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                    label="Valid"
                    count={validRows.length}
                    tone="ok"
                  />
                  <SummaryPill
                    icon={<AlertTriangle className="h-3.5 w-3.5" />}
                    label="Warnings"
                    count={warningRows.length}
                    tone="warn"
                  />
                  <SummaryPill
                    icon={<X className="h-3.5 w-3.5" />}
                    label="Errors"
                    count={errorRows.length}
                    tone="error"
                  />
                </div>

                <div className="flex-1 overflow-auto border rounded-lg">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background z-10">
                      <TableRow>
                        <TableHead className="w-12">#</TableHead>
                        <TableHead>Item</TableHead>
                        <TableHead>Change</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Stock after</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parsedRows.map((r) => {
                        const hasError = r.errors.length > 0;
                        const hasWarn = !hasError && r.warnings.length > 0;
                        const signed =
                          r.direction === "add" ? r.quantity : -r.quantity;
                        return (
                          <TableRow
                            key={r.rowNumber}
                            className={
                              hasError
                                ? "bg-destructive/5"
                                : hasWarn
                                  ? "bg-amber-500/5"
                                  : ""
                            }
                          >
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {r.rowNumber}
                            </TableCell>
                            <TableCell className="font-medium">
                              {r.itemName || (
                                <span className="text-muted-foreground italic">-</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <span
                                className={`font-mono inline-flex items-center gap-1 ${
                                  signed >= 0
                                    ? "text-emerald-700 dark:text-emerald-400"
                                    : "text-amber-700 dark:text-amber-400"
                                }`}
                              >
                                {signed >= 0 ? (
                                  <ArrowUp className="h-3 w-3" />
                                ) : (
                                  <ArrowDown className="h-3 w-3" />
                                )}
                                {signed > 0 ? "+" : ""}
                                {signed.toFixed(2)} {r.stockUnit || ""}
                              </span>
                            </TableCell>
                            <TableCell className="text-xs">
                              {REASON_LABELS[r.reasonCode as ValidReasonCode] ||
                                r.reasonCode}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {r.stockAfter !== undefined ? (
                                <span
                                  className={
                                    r.stockAfter < 0
                                      ? "text-destructive font-semibold"
                                      : ""
                                  }
                                >
                                  {r.stockAfter.toFixed(2)}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {hasError ? (
                                <Badge
                                  variant="outline"
                                  className="border-destructive/40 text-destructive bg-destructive/5"
                                  title={r.errors.join("; ")}
                                >
                                  {r.errors.length} error
                                  {r.errors.length > 1 ? "s" : ""}
                                </Badge>
                              ) : hasWarn ? (
                                <Badge
                                  variant="outline"
                                  className="border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-500/5"
                                  title={r.warnings.join("; ")}
                                >
                                  Warning
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5"
                                >
                                  Ready
                                </Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {errorRows.length > 0 && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      {errorRows.length} row{errorRows.length > 1 ? "s have" : " has"} errors
                      and will be skipped. Hover the badge to see details.
                    </AlertDescription>
                  </Alert>
                )}
              </>
            )}
          </div>
        )}

        {step === "submitting" && (
          <div className="flex-1 flex flex-col items-center justify-center py-10 text-center space-y-3">
            <Loader2 className="h-8 w-8 text-primary animate-spin" />
            <p className="font-medium">Posting stock movements…</p>
            <p className="text-sm text-muted-foreground">
              {submitProgress.done} of {submitProgress.total} rows
            </p>
            <div className="w-64 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{
                  width: `${
                    submitProgress.total === 0
                      ? 0
                      : (submitProgress.done / submitProgress.total) * 100
                  }%`,
                }}
              />
            </div>
          </div>
        )}

        {step !== "submitting" && (
          <div className="flex items-center justify-between gap-2 pt-3 border-t">
            <p className="text-xs text-muted-foreground">
              {step === "preview" && parsedRows.length > 0
                ? `Will create ${validRows.length} stock_movements entr${validRows.length === 1 ? "y" : "ies"}.`
                : "Audit-trail safe - every imported row creates a stock_movements record."}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => handleClose(false)}>
                Cancel
              </Button>
              {step === "preview" && (
                <Button
                  onClick={handleImport}
                  disabled={validRows.length === 0}
                  className="gap-1.5"
                >
                  <Upload className="h-4 w-4" />
                  Import {validRows.length || ""} row{validRows.length === 1 ? "" : "s"}
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SummaryPill({
  icon,
  label,
  count,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  tone: "ok" | "warn" | "error";
}) {
  const styles =
    tone === "ok"
      ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
      : tone === "warn"
        ? "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300"
        : "border-destructive/40 bg-destructive/5 text-destructive";
  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm ${styles}`}
    >
      <span className="flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      <span className="font-mono font-semibold tabular-nums">{count}</span>
    </div>
  );
}