/**
 * Split tender on the POS payment step: the cashier adds tenders (cash / card / other) until
 * the remaining balance is 0. Cash shows the change; a card tender approved on the terminal is
 * locked so it is never charged twice. State and rules: src/lib/pos/splitTenders.ts.
 * Used by the quick-sale dialog (SalesRecorder) and the POS pages (RecordSale, RecordSaleMobile).
 */
import { useTranslation } from "react-i18next";
import { Banknote, CreditCard, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { roundMoney } from "@/lib/vatInclusive";
import { money, type SplitTenders, type TenderMethod } from "@/lib/pos/splitTenders";

export function SplitTenderPanel({ split, formatCurrency }: { split: SplitTenders; formatCurrency: (n: number) => string }) {
  const { t } = useTranslation();
  const { tenders, remaining, addTender, updateTender, removeTender } = split;
  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-card p-2">
      <p className="text-xs text-muted-foreground">{t("app.pos.recorder.splitHelp")}</p>
      {tenders.map((d) => {
        const approved = !!d.approval;
        const change = d.method === "cash" && d.tendered.trim() ? roundMoney(money(d.tendered) - money(d.amount)) : null;
        return (
          <div key={d.id} className="space-y-1 rounded-md border border-border/40 p-2">
            <div className="flex items-center gap-1.5">
              <Select value={d.method} disabled={approved} onValueChange={(v) => updateTender(d.id, { method: v as TenderMethod, tendered: "" })}>
                <SelectTrigger className="h-8 w-24 text-xs" aria-label={t("app.pos.mobile.paymentMethod")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">{t("app.sales.paymentMethods.cash")}</SelectItem>
                  <SelectItem value="card">{t("app.sales.paymentMethods.card")}</SelectItem>
                  <SelectItem value="other">{t("app.sales.paymentMethods.other")}</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                className="h-8 text-xs"
                aria-label={t("app.pos.recorder.amount")}
                placeholder={t("app.pos.recorder.amount")}
                value={d.amount}
                disabled={approved}
                onChange={(e) => updateTender(d.id, { amount: e.target.value })}
              />
              {approved ? (
                <Badge variant="secondary" className="text-[10px]">{t("app.pos.recorder.approved")}</Badge>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                  aria-label={t("app.pos.recorder.removeTender")}
                  onClick={() => removeTender(d.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            {d.method === "cash" && (
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  className="h-8 text-xs"
                  aria-label={t("app.pos.recorder.tendered")}
                  placeholder={t("app.pos.recorder.tendered")}
                  value={d.tendered}
                  onChange={(e) => updateTender(d.id, { tendered: e.target.value })}
                />
                {change != null && (
                  <span className={`whitespace-nowrap text-xs ${change < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                    {t("app.pos.recorder.change")}: {formatCurrency(Math.max(0, change))}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{t("app.pos.recorder.remaining")}</span>
        <span className={`font-semibold ${Math.abs(remaining) < 0.005 ? "" : "text-destructive"}`}>{formatCurrency(remaining)}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" disabled={remaining <= 0} onClick={() => addTender("cash", remaining)}>
          <Banknote className="h-3.5 w-3.5" />
          {t("app.pos.recorder.restCash")}
        </Button>
        <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" disabled={remaining <= 0} onClick={() => addTender("card", remaining)}>
          <CreditCard className="h-3.5 w-3.5" />
          {t("app.pos.recorder.restCard")}
        </Button>
      </div>
      <Button variant="ghost" size="sm" className="h-8 w-full gap-1 text-xs" onClick={() => addTender("cash", 0)}>
        <Plus className="h-3.5 w-3.5" />
        {t("app.pos.recorder.addTender")}
      </Button>
    </div>
  );
}
