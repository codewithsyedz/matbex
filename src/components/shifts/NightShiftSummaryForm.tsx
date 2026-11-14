import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/integrations/db/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Moon, CreditCard, Banknote, DollarSign, Save, CheckCircle2, Loader2 } from "lucide-react";
import { format as formatDate } from "date-fns";
import { useCurrency } from "@/hooks/useCurrency";
import { parseLedgerValidationError } from "@/lib/ledgerValidationError";

interface NightShift {
  id: string;
  opened_at: string;
  template_id: string | null;
  drawer_id: string | null;
  drawer?: { name: string } | null;
  shift_templates?: { name: string; shift_mode?: string } | null;
}

interface ExistingSummary {
  id: string;
  cash_collected: number;
  card_collected: number;
  net_sales: number;
  vat_amount: number;
  total_sales: number;
  ledger_posted: boolean;
}

export function NightShiftSummaryForm() {
  const { restaurant, profile, user } = useAuth();
  const { format: formatAmount } = useCurrency();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [nightShift, setNightShift] = useState<NightShift | null>(null);
  const [existingSummary, setExistingSummary] = useState<ExistingSummary | null>(null);

  // Form state
  const [cashCollected, setCashCollected] = useState("");
  const [cardCollected, setCardCollected] = useState("");
  const [vatAmount, setVatAmount] = useState("");
  const [notes, setNotes] = useState("");

  const businessDate = formatDate(new Date(), "yyyy-MM-dd");

  useEffect(() => {
    if (restaurant?.id) {
      fetchNightShift();
    }
  }, [restaurant?.id]);

  const fetchNightShift = async () => {
    if (!restaurant?.id) return;

    setLoading(true);
    try {
      // Find open night shift (shift_summary mode)
      const { data: shifts, error: shiftError } = await db
        .from("shifts")
        .select(`
          id, opened_at, template_id, drawer_id,
          drawer:drawers(name),
          shift_templates(name, shift_mode)
        `)
        .eq("restaurant_id", restaurant.id)
        .eq("status", "open")
        .order("opened_at", { ascending: false });

      if (shiftError) throw shiftError;

      // Find shift with summary mode
      const summaryShift = shifts?.find(
        (s: any) => s.shift_templates?.shift_mode === "shift_summary"
      );

      if (summaryShift) {
        setNightShift(summaryShift as any);

        // Check for existing summary
        const { data: summary } = await db
          .from("night_shift_summaries")
          .select("*")
          .eq("shift_id", summaryShift.id)
          .eq("business_date", businessDate)
          .single();

        if (summary) {
          setExistingSummary(summary);
          setCashCollected(summary.cash_collected.toString());
          setCardCollected(summary.card_collected.toString());
          setVatAmount(summary.vat_amount?.toString() || "0");
        }
      }
    } catch (error) {
      console.error("Error fetching night shift:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!nightShift || !restaurant?.id || !user?.id || !profile?.tenant_id) {
      toast.error("Missing required data");
      return;
    }

    const cash = parseFloat(cashCollected) || 0;
    const card = parseFloat(cardCollected) || 0;
    const vat = parseFloat(vatAmount) || 0;
    const netSales = cash + card - vat;
    const totalSales = cash + card;

    if (totalSales <= 0) {
      toast.error("Please enter sales amounts");
      return;
    }

    setSubmitting(true);
    try {
      const summaryData = {
        tenant_id: profile.tenant_id,
        restaurant_id: restaurant.id,
        shift_id: nightShift.id,
        business_date: businessDate,
        cash_collected: cash,
        card_collected: card,
        net_sales: netSales,
        vat_amount: vat,
        total_sales: totalSales,
        notes: notes.trim() || null,
        created_by: user.id,
      };

      if (existingSummary) {
        // Update existing
        const { error } = await db
          .from("night_shift_summaries")
          .update({
            cash_collected: cash,
            card_collected: card,
            net_sales: netSales,
            vat_amount: vat,
            total_sales: totalSales,
            notes: notes.trim() || null,
          })
          .eq("id", existingSummary.id);

        if (error) throw error;
        toast.success("Night summary updated");
      } else {
        // Insert new
        const { data: newSummary, error } = await db
          .from("night_shift_summaries")
          .insert(summaryData)
          .select()
          .single();

        if (error) throw error;
        
        setExistingSummary(newSummary);
        toast.success("Night summary saved");
      }

      fetchNightShift();
    } catch (error: any) {
      console.error("Error saving summary:", error);
      toast.error(error.message || "Failed to save summary");
    } finally {
      setSubmitting(false);
    }
  };

  const handlePostToLedger = async () => {
    if (!existingSummary) {
      toast.error("Save the summary first");
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await db.rpc("post_night_summary_to_ledger", {
        p_summary_id: existingSummary.id,
      });

      if (error) throw error;

      toast.success("Posted to ledger successfully");
      fetchNightShift();
    } catch (error: any) {
      console.error("Error posting to ledger:", error);
      const parsed = parseLedgerValidationError(error);
      if (parsed.isLedgerValidation) {
        toast.error(parsed.title, {
          description: `${parsed.detail} — ${parsed.fix}`,
          duration: 12000,
        });
      } else {
        toast.error(error.message || "Failed to post to ledger");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const totalSales = (parseFloat(cashCollected) || 0) + (parseFloat(cardCollected) || 0);
  const netSales = totalSales - (parseFloat(vatAmount) || 0);

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!nightShift) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Moon className="h-5 w-5" />
            Night Shift Summary
          </CardTitle>
          <CardDescription>
            No active night shift found. Open a shift with "Summary Mode" to record night totals.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Moon className="h-5 w-5" />
              Night Shift Summary
            </CardTitle>
            <CardDescription className="mt-1">
              Record end-of-shift totals for {formatDate(new Date(nightShift.opened_at), "MMM d, yyyy")}
            </CardDescription>
          </div>
          {existingSummary?.ledger_posted && (
            <Badge className="bg-green-500/10 text-green-600 border-green-500/20">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Posted
            </Badge>
          )}
        </div>
        <div className="flex gap-2 mt-2">
          <Badge variant="outline">{nightShift.shift_templates?.name || "Night Shift"}</Badge>
          {nightShift.drawer?.name && (
            <Badge variant="secondary">{nightShift.drawer.name}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Cash & Card Inputs */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Banknote className="h-4 w-4 text-green-600" />
              Cash Collected
            </Label>
            <Input
              type="number"
              placeholder="0.00"
              value={cashCollected}
              onChange={(e) => setCashCollected(e.target.value)}
              min="0"
              step="0.01"
              disabled={existingSummary?.ledger_posted}
            />
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-blue-600" />
              Card Collected
            </Label>
            <Input
              type="number"
              placeholder="0.00"
              value={cardCollected}
              onChange={(e) => setCardCollected(e.target.value)}
              min="0"
              step="0.01"
              disabled={existingSummary?.ledger_posted}
            />
          </div>
        </div>

        {/* VAT */}
        <div className="space-y-2">
          <Label>VAT Amount (optional)</Label>
          <Input
            type="number"
            placeholder="0.00"
            value={vatAmount}
            onChange={(e) => setVatAmount(e.target.value)}
            min="0"
            step="0.01"
            disabled={existingSummary?.ledger_posted}
          />
          <p className="text-xs text-muted-foreground">
            If VAT is included in sales, enter the VAT portion here
          </p>
        </div>

        {/* Notes */}
        <div className="space-y-2">
          <Label>Notes</Label>
          <Textarea
            placeholder="Any observations or notes..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            disabled={existingSummary?.ledger_posted}
          />
        </div>

        {/* Summary */}
        <div className="p-4 rounded-lg border bg-muted/30 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Total Sales:</span>
            <span className="font-semibold">{formatAmount(totalSales)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">VAT:</span>
            <span>({formatAmount(parseFloat(vatAmount) || 0)})</span>
          </div>
          <div className="flex justify-between text-sm border-t pt-2 mt-2">
            <span className="font-medium">Net Sales:</span>
            <span className="font-bold text-primary">{formatAmount(netSales)}</span>
          </div>
        </div>

        {/* Journal Preview */}
        <div className="p-4 rounded-lg border bg-accent/20">
          <p className="text-sm font-medium mb-2">Journal Entry Preview:</p>
          <div className="text-xs space-y-1 font-mono">
            <div className="flex justify-between">
              <span>Dr 1000 Cash</span>
              <span>{formatAmount(parseFloat(cashCollected) || 0)}</span>
            </div>
            <div className="flex justify-between">
              <span>Dr 1020 Card Clearing</span>
              <span>{formatAmount(parseFloat(cardCollected) || 0)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span className="ml-4">Cr 4000 Sales Revenue</span>
              <span>{formatAmount(netSales)}</span>
            </div>
            {(parseFloat(vatAmount) || 0) > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span className="ml-4">Cr 2200 VAT Payable</span>
                <span>{formatAmount(parseFloat(vatAmount) || 0)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            onClick={handleSave}
            disabled={submitting || existingSummary?.ledger_posted || totalSales <= 0}
            className="flex-1"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            {existingSummary ? "Update Summary" : "Save Summary"}
          </Button>
          {existingSummary && !existingSummary.ledger_posted && (
            <Button
              variant="secondary"
              onClick={handlePostToLedger}
              disabled={submitting}
            >
              <DollarSign className="h-4 w-4 mr-2" />
              Post to Ledger
            </Button>
          )}
        </div>

        {existingSummary?.ledger_posted && (
          <p className="text-xs text-muted-foreground text-center">
            This summary has been posted to the ledger and cannot be modified.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
