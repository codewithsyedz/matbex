import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { payForPlan, quotePlan, type BillingPeriod, type PlanQuote } from "@/lib/billing/subscriptionPay";

const LABEL: Record<string, string> = { starter: "Starter", pro: "Growth", enterprise: "Enterprise" };
const sar = (n: number) => `SAR ${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Pay a plan through Moyasar: monthly or yearly (10 months' price), priced by the server per
 * active branch, with the add-ons that renew alongside. An upgrade mid-period costs the
 * difference for the days left.
 */
export function PlanCheckoutDialog({ planName, open, onOpenChange }: { planName: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [period, setPeriod] = useState<BillingPeriod>("month");
  const [quote, setQuote] = useState<PlanQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (!open || !planName) return;
    let stale = false;
    setLoading(true);
    setError(null);
    quotePlan(planName, period)
      .then((q) => { if (!stale) setQuote(q); })
      .catch((e: Error) => { if (!stale) { setQuote(null); setError(e.message); } })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [open, planName, period]);

  const pay = async () => {
    if (!planName) return;
    setPaying(true);
    try {
      await payForPlan(planName, period);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The payment could not be started");
      setPaying(false);
    }
  };

  const name = LABEL[planName ?? ""] ?? planName ?? "";
  const upgrade = quote?.mode === "upgrade";
  const until = quote?.current_period_end ? format(new Date(quote.current_period_end), "d MMM yyyy") : null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!paying) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{upgrade ? `Upgrade to ${name}` : quote?.mode === "renew" ? `Renew ${name}` : `${name} plan`}</DialogTitle>
          <DialogDescription>
            Paid securely through Moyasar with mada, Visa / Mastercard, Apple Pay or STC Pay. Each period is paid up front;
            renew any time from this page.
          </DialogDescription>
        </DialogHeader>

        {!upgrade && (
          <div className="grid grid-cols-2 gap-2">
            {(["month", "year"] as const).map((p) => (
              <Button key={p} variant={period === p ? "default" : "outline"} onClick={() => setPeriod(p)} disabled={loading || paying}>
                {p === "month" ? "Monthly" : "Yearly (2 months free)"}
              </Button>
            ))}
          </div>
        )}

        <div className="min-h-[96px] rounded-md border p-3 text-sm">
          {loading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
          {!loading && error && <p className="text-destructive">{error}</p>}
          {!loading && quote && (
            <div className="space-y-1">
              <div className="flex justify-between">
                <span>
                  {upgrade
                    ? `${name}: difference for ${quote.days_left} days left`
                    : `${name} × ${quote.branches} branch${quote.branches > 1 ? "es" : ""}, ${quote.months === 12 ? "1 year" : "1 month"}`}
                </span>
                <span className="tabular-nums">{sar(quote.plan_amount)}</span>
              </div>
              {quote.addons.map((a) => (
                <div key={a.addon_id} className="flex justify-between text-muted-foreground">
                  <span>Add-on: {a.name}</span><span className="tabular-nums">{sar(a.amount)}</span>
                </div>
              ))}
              <div className="flex justify-between border-t pt-1 font-semibold">
                <span>Total</span><span className="tabular-nums">{sar(quote.total)}</span>
              </div>
              <p className="pt-1 text-xs text-muted-foreground">
                {upgrade
                  ? `Your plan changes now; you stay paid until ${until}.`
                  : quote.mode === "new"
                    ? "Starts as soon as the payment is confirmed."
                    : `Starts when your current period ends (${until}).`}
              </p>
            </div>
          )}
        </div>

        <Button onClick={pay} disabled={!quote || loading || paying}>
          {paying && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
          {quote ? `Pay ${sar(quote.total)}` : "Pay"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
