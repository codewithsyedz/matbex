import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, endOfMonth, subMonths } from "date-fns";
import { Loader2, PackageCheck } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Account { id: string; account_code: string; account_name: string; account_type: string }

/**
 * Month-end stock count (periodic method): for each inventory account (1200-1299) the book
 * value at the chosen date minus the value counted on the shelves is the cost of goods used,
 * posted DR cost of goods / CR inventory by post_stock_count_true_up (once per account and
 * month). For businesses that buy food into inventory without recipes, this is what books
 * food cost at all.
 */
export function StockCountTrueUpCard() {
  const { restaurant, profile } = useAuth() as any;
  const tenantId: string | undefined = restaurant?.tenant_id ?? profile?.tenant_id;
  const { format: money } = useCurrency();
  const qc = useQueryClient();
  const [periodEnd, setPeriodEnd] = useState(format(endOfMonth(subMonths(new Date(), 1)), "yyyy-MM-dd"));
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [cogsChoice, setCogsChoice] = useState<string>("");

  const accountsQ = useQuery({
    queryKey: ["stock-count-accounts", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await db.from("chart_of_accounts")
        .select("id, account_code, account_name, account_type")
        .eq("tenant_id", tenantId!).eq("is_active", true)
        .in("account_type", ["asset", "cogs"]).order("account_code");
      if (error) throw error;
      return (data || []) as Account[];
    },
  });
  const inventoryAccounts = (accountsQ.data || []).filter((a) => a.account_type === "asset" && a.account_code >= "1200" && a.account_code <= "1299");
  const cogsAccounts = (accountsQ.data || []).filter((a) => a.account_type === "cogs");
  const cogsId = cogsChoice || cogsAccounts.find((a) => a.account_code === "5000")?.id || cogsAccounts[0]?.id || "";

  // Book value per inventory account at the chosen date, and which are already counted for that month.
  const bookQ = useQuery({
    queryKey: ["stock-count-book", tenantId, periodEnd, inventoryAccounts.map((a) => a.id).join(",")],
    enabled: !!tenantId && inventoryAccounts.length > 0,
    queryFn: async () => {
      const ids = inventoryAccounts.map((a) => a.id);
      const book: Record<string, number> = {};
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await db.from("account_transactions")
          .select("account_id, debit, credit")
          .eq("tenant_id", tenantId!).in("account_id", ids).lte("transaction_date", periodEnd)
          .or("is_voided.is.null,is_voided.eq.false")
          .order("id").range(offset, offset + 999);
        if (error) throw error;
        for (const r of (data || []) as Array<{ account_id: string; debit: number | null; credit: number | null }>) {
          book[r.account_id] = (book[r.account_id] || 0) + Number(r.debit || 0) - Number(r.credit || 0);
        }
        if (!data || data.length < 1000) break;
      }
      const month = periodEnd.slice(0, 7).replace("-", "");
      const refs = inventoryAccounts.map((a) => `STOCK-${a.account_code}-${month}`);
      const { data: posted, error } = await db.from("journal_entry_batches")
        .select("reference_number").eq("tenant_id", tenantId!).in("reference_number", refs);
      if (error) throw error;
      return { book, posted: new Set((posted || []).map((p: { reference_number: string }) => p.reference_number)) };
    },
  });

  const post = useMutation({
    mutationFn: async (account: Account) => {
      const counted = Number(counts[account.id]);
      const { data, error } = await db.rpc("post_stock_count_true_up" as never, {
        p_restaurant_id: restaurant!.id, p_period_end: periodEnd, p_inventory_account_id: account.id,
        p_counted_value: counted, p_cogs_account_id: cogsId || null,
      } as never);
      if (error) throw error;
      return data as unknown as { cost_of_goods: number };
    },
    onSuccess: (r, account) => {
      toast.success(`${account.account_code} posted: cost of goods ${money(Number(r?.cost_of_goods || 0))}`);
      qc.invalidateQueries({ queryKey: ["stock-count-book"] });
      qc.invalidateQueries({ queryKey: ["trial-balance"] });
      qc.invalidateQueries({ queryKey: ["profit-loss"] });
    },
    onError: (e: any) => toast.error(e?.message || "Could not post the stock count"),
  });

  const month = useMemo(() => periodEnd.slice(0, 7).replace("-", ""), [periodEnd]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <PackageCheck className="h-4 w-4 text-primary" /> Month-end stock count
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Count what is on the shelves at month end and enter its value per inventory account. The
          difference from the book value is the cost of goods used that month, posted to the cost of
          goods account. Use this when food is bought into inventory without recipes.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <Label htmlFor="stock-count-date">Count date (month end)</Label>
            <Input id="stock-count-date" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="w-[170px]" />
          </div>
          <div className="space-y-1">
            <Label>Cost of goods account</Label>
            <Select value={cogsId} onValueChange={setCogsChoice}>
              <SelectTrigger className="w-[260px]"><SelectValue placeholder="Choose account" /></SelectTrigger>
              <SelectContent>
                {cogsAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.account_code} · {a.account_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        {inventoryAccounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active inventory accounts (1200-1299).</p>
        ) : (
          <div className="space-y-2">
            {inventoryAccounts.map((a) => {
              const book = bookQ.data?.book[a.id] ?? 0;
              const done = bookQ.data?.posted.has(`STOCK-${a.account_code}-${month}`);
              const raw = counts[a.id] ?? "";
              const counted = raw === "" ? null : Number(raw);
              const used = counted === null || Number.isNaN(counted) ? null : book - counted;
              return (
                <div key={a.id} className="grid grid-cols-1 sm:grid-cols-[1fr_140px_150px_150px_auto] gap-2 items-center rounded-md border p-3 text-sm">
                  <div className="min-w-0"><p className="font-medium truncate">{a.account_code} · {a.account_name}</p></div>
                  <div className="tabular-nums"><span className="text-xs text-muted-foreground block">Book value</span>{bookQ.isLoading ? "…" : money(book)}</div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Counted value</span>
                    <Input type="number" min={0} step="0.01" inputMode="decimal" disabled={done} value={raw}
                      onChange={(e) => setCounts((c) => ({ ...c, [a.id]: e.target.value }))} className="h-8" aria-label={`Counted value for ${a.account_code}`} />
                  </div>
                  <div className="tabular-nums"><span className="text-xs text-muted-foreground block">Cost of goods</span>{used === null ? "-" : money(used)}</div>
                  <div className="justify-self-end">
                    {done ? <Badge variant="secondary">Posted for this month</Badge> : (
                      <Button size="sm" disabled={used === null || (counted ?? -1) < 0 || !cogsId || post.isPending} onClick={() => post.mutate(a)}>
                        {post.isPending && post.variables?.id === a.id && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Post
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Posting needs the right to post journal entries (owners and managers; accountants when allowed on the Team page).
          Each account can be counted once per month; a locked month cannot be posted.
        </p>
      </CardContent>
    </Card>
  );
}
