import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { db } from "@/integrations/db/client";

export interface ScannedLine {
  description: string;
  quantity: number;
  unit: string | null;
  unit_price_excl_vat: number;
  line_total_excl_vat: number;
  vat_rate: number | null;
  matched_inventory_item_id: string | null;
  match_confidence: "high" | "medium" | "low" | "none";
}
export interface InvoiceScanDraft {
  supplier: { name: string | null; vat_number: string | null; matched_supplier_id: string | null };
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  currency: string;
  prices_include_vat: boolean;
  lines: ScannedLine[];
  subtotal_excl_vat: number | null;
  vat_amount: number | null;
  total: number | null;
  warnings: string[];
}

/**
 * "Read with AI": sends the uploaded invoice photo/PDF to scan-supplier-invoice, which reads it with
 * Claude and returns a draft for the form. Nothing is saved until the person checks and saves.
 */
export function InvoiceScanButton({ restaurantId, imagePath, onDraft, disabled }: {
  restaurantId: string;
  imagePath: string | null;
  onDraft: (draft: InvoiceScanDraft) => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  const scan = async () => {
    if (!imagePath) return;
    setBusy(true);
    try {
      const { data, error } = await db.functions.invoke("scan-supplier-invoice", {
        body: { restaurant_id: restaurantId, image_path: imagePath },
      });
      if (error) {
        const ctx = (error as { context?: Response }).context;
        const body = ctx && typeof ctx.clone === "function" ? await ctx.clone().json().catch(() => null) : null;
        throw new Error(body?.error || error.message);
      }
      onDraft(data.draft as InvoiceScanDraft);
      toast.success("Invoice read. Check the highlighted values before saving.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scanning failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button type="button" variant="secondary" onClick={scan} disabled={!imagePath || busy || disabled}>
      {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
      {busy ? "Reading invoice…" : "Read with AI"}
    </Button>
  );
}
