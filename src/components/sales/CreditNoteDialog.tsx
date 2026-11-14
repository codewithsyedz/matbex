import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Undo2, AlertTriangle, Plus } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type DocumentType = "CREDIT" | "DEBIT";
type ReasonCode = string;

interface SaleLine {
  name: string;
  quantity: number;
  unitPrice: number;
  total: number; // pre-tax extension
}

interface CreditNoteDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  sale: {
    id: string;
    receipt_number: string | null;
    total_amount: number;
    zatca_uuid: string | null;
    items?: SaleLine[]; // optional pre-loaded items
  };
}

const CREDIT_REASONS: Record<string, string> = {
  RETURN_OF_GOODS: "Return of goods",
  CORRECTION_OF_AMOUNTS: "Correction of amounts",
  CHANGE_OF_BUYER: "Change of buyer",
  CANCELLATION: "Cancellation",
  OTHER: "Other",
};
const DEBIT_REASONS: Record<string, string> = {
  ADDITIONAL_CHARGES: "Additional charges",
  PRICE_CORRECTION_UP: "Price correction (upward)",
  LATE_FEES: "Late fees / surcharge",
  UNDERCHARGED: "Originally undercharged",
  OTHER: "Other",
};

const VAT_RATE = 0.15;

export function CreditNoteDialog({ open, onOpenChange, sale }: CreditNoteDialogProps) {
  const qc = useQueryClient();
  const [documentType, setDocumentType] = useState<DocumentType>("CREDIT");
  const [reasonCode, setReasonCode] = useState<ReasonCode>("RETURN_OF_GOODS");
  const [reasonText, setReasonText] = useState("");
  const [items, setItems] = useState<Array<SaleLine & { selected: boolean; refundQty: number }>>([]);
  const [loadingLines, setLoadingLines] = useState(false);

  const reasonOptions = documentType === "DEBIT" ? DEBIT_REASONS : CREDIT_REASONS;
  useEffect(() => {
    // Reset to a valid reason whenever the doc type flips
    setReasonCode(Object.keys(reasonOptions)[0]);
  }, [documentType, reasonOptions]);

  // Load original sale items if not provided
  useEffect(() => {
    if (!open) return;
    if (sale.items && sale.items.length > 0) {
      setItems(sale.items.map((i) => ({ ...i, selected: false, refundQty: i.quantity })));
      return;
    }
    setLoadingLines(true);
    (async () => {
      const { data } = await db
        .from("sales_items")
        .select("quantity, unit_price, total_price, menu_items(name)")
        .eq("transaction_id", sale.id);
      type Row = { quantity: number; unit_price: number; total_price: number; menu_items: { name: string } | null };
      const lines = ((data ?? []) as unknown as Row[]).map((l) => ({
        name: l.menu_items?.name ?? "Item",
        quantity: Number(l.quantity),
        unitPrice: Number(l.unit_price),
        total: Number(l.total_price),
        selected: false,
        refundQty: Number(l.quantity),
      }));
      // Fallback synthetic line if no items table rows
      if (lines.length === 0) {
        const pretax = Number(sale.total_amount) / (1 + VAT_RATE);
        lines.push({
          name: `Sale ${sale.receipt_number ?? sale.id.slice(0, 8)}`,
          quantity: 1,
          unitPrice: pretax,
          total: pretax,
          selected: true,
          refundQty: 1,
        });
      }
      setItems(lines);
      setLoadingLines(false);
    })();
  }, [open, sale.id, sale.items, sale.receipt_number, sale.total_amount]);

  const totals = useMemo(() => {
    const selected = items.filter((i) => i.selected && i.refundQty > 0);
    const exclusive = selected.reduce(
      (s, i) => s + i.unitPrice * Math.min(i.refundQty, i.quantity),
      0,
    );
    const tax = exclusive * VAT_RATE;
    return { exclusive, tax, inclusive: exclusive + tax, count: selected.length };
  }, [items]);

  const issue = useMutation({
    mutationFn: async () => {
      const refundLines = items
        .filter((i) => i.selected && i.refundQty > 0)
        .map((i) => {
          const qty = Math.min(i.refundQty, i.quantity);
          const lineExtension = i.unitPrice * qty;
          return {
            name: i.name,
            quantity: qty,
            unitPrice: i.unitPrice,
            lineExtension,
            taxAmount: lineExtension * VAT_RATE,
          };
        });
      if (refundLines.length === 0) throw new Error("Select at least one line to refund");
      const { data, error } = await db.functions.invoke("zatca-issue-credit-note", {
        body: {
          original_sales_transaction_id: sale.id,
          reason_code: reasonCode,
          reason_text: reasonText || null,
          refund_lines: refundLines,
          document_type: documentType,
        },
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (d: { number?: string; status?: string }) => {
      const label = documentType === "DEBIT" ? "Debit note" : "Credit note";
      toast.success(`${label} ${d?.number ?? "issued"} - ${d?.status ?? "submitted"}`);
      qc.invalidateQueries({ queryKey: ["zatca-credit-notes"] });
      qc.invalidateQueries({ queryKey: ["zatca-clearance-status"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(
      `${documentType === "DEBIT" ? "Debit" : "Credit"} note failed`,
      { description: e.message },
    ),
  });

  const noZatca = !sale.zatca_uuid;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {documentType === "DEBIT"
              ? <><Plus className="h-5 w-5" /> Issue Debit Note</>
              : <><Undo2 className="h-5 w-5" /> Issue Credit Note</>}
          </DialogTitle>
          <DialogDescription>
            For sale <span className="font-mono">{sale.receipt_number ?? sale.id.slice(0, 8)}</span>.
            {documentType === "DEBIT"
              ? " Select lines to charge additionally. A ZATCA-compliant debit note will be generated, signed, and reported."
              : " Select lines to refund. A ZATCA-compliant credit note will be generated, signed, and reported."}
          </DialogDescription>
        </DialogHeader>

        {noZatca ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
            <p>This sale was not stamped with ZATCA - adjustment note cannot be issued.</p>
          </div>
        ) : (
          <ScrollArea className="max-h-[60vh] pr-2">
            <div className="space-y-4">
              <Tabs value={documentType} onValueChange={(v) => setDocumentType(v as DocumentType)}>
                <TabsList className="grid grid-cols-2 w-full">
                  <TabsTrigger value="CREDIT">Credit (refund)</TabsTrigger>
                  <TabsTrigger value="DEBIT">Debit (additional charge)</TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Reason</Label>
                  <Select value={reasonCode} onValueChange={(v) => setReasonCode(v as ReasonCode)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(reasonOptions).map(([k, l]) => (
                        <SelectItem key={k} value={k}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Original total</Label>
                  <div className="h-9 flex items-center text-sm font-mono">
                    {Number(sale.total_amount ?? 0).toFixed(2)} ﷼
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Notes (optional)</Label>
                <Textarea
                  rows={2}
                  value={reasonText}
                  onChange={(e) => setReasonText(e.target.value)}
                  placeholder="Customer-facing note for this credit"
                />
              </div>

              <div>
                <Label>{documentType === "DEBIT" ? "Lines to charge" : "Lines to refund"}</Label>
                {loadingLines ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin inline-block mr-2" />Loading lines…
                  </div>
                ) : (
                  <div className="rounded-md border divide-y">
                    {items.map((it, idx) => (
                      <div key={idx} className="flex items-center gap-3 px-3 py-2.5">
                        <Checkbox
                          checked={it.selected}
                          onCheckedChange={(c) =>
                            setItems((prev) => prev.map((p, i) =>
                              i === idx ? { ...p, selected: !!c } : p,
                            ))
                          }
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{it.name}</div>
                          <div className="text-xs text-muted-foreground">
                            sold {it.quantity} × {it.unitPrice.toFixed(2)} ﷼
                          </div>
                        </div>
                        <Input
                          type="number"
                          min={0}
                          max={it.quantity}
                          step="0.01"
                          value={it.refundQty}
                          disabled={!it.selected}
                          onChange={(e) => {
                            const v = Math.max(0, Math.min(it.quantity, Number(e.target.value)));
                            setItems((prev) => prev.map((p, i) =>
                              i === idx ? { ...p, refundQty: v } : p,
                            ));
                          }}
                          className="w-24 text-right font-mono"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-md bg-muted/50 p-3 space-y-1 text-sm">
                <div className="flex justify-between"><span>Subtotal</span><span className="font-mono">{totals.exclusive.toFixed(2)} ﷼</span></div>
                <div className="flex justify-between"><span>VAT (15%)</span><span className="font-mono">{totals.tax.toFixed(2)} ﷼</span></div>
                <div className="flex justify-between font-medium pt-1 border-t mt-1">
                  <span>{documentType === "DEBIT" ? "Total charge" : "Total refund"}</span>
                  <span className="font-mono">{totals.inclusive.toFixed(2)} ﷼</span>
                </div>
                <Badge variant="outline" className="text-xs">{totals.count} line{totals.count === 1 ? "" : "s"} selected</Badge>
              </div>
            </div>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => issue.mutate()}
            disabled={noZatca || issue.isPending || totals.inclusive <= 0}
          >
            {issue.isPending
              ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
              : documentType === "DEBIT"
                ? <Plus className="h-4 w-4 mr-2" />
                : <Undo2 className="h-4 w-4 mr-2" />}
            Issue {documentType === "DEBIT" ? "debit" : "credit"} note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}