import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { endOfMonth, format, subMonths } from "date-fns";
import { CalendarCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

interface AccrualLine { item: string; account: string; debit: number }
interface AccrualBranch {
  branch_id: string | null; reference: string; total: number; daily_overhead_reversed: number;
  already_posted: boolean; lines: AccrualLine[];
}
interface AccrualResult { month: string; posted_total: number; branches: AccrualBranch[] }
interface UnpostedPayment {
  id: string; amount_paid: number; payment_date: string; payment_month: string; payment_method: string | null;
  overhead_allocation: { name: string } | null;
}

/**
 * Month-end accrual of the monthly overhead items (rent, utilities, internet...): one journal per
 * branch and month, DR each item's expense account / CR 2100 Accrued Liabilities, dated the month
 * end (post_overhead_month_accrual). Paying an item later clears 2100. Also lists overhead
 * payments that never reached the ledger, with a button to post each.
 */
export function OverheadAccrualCard() {
  const { restaurant } = useAuth();
  const { branches } = useBranch();
  const { format: money } = useCurrency();
  const qc = useQueryClient();
  const [month, setMonth] = useState(format(endOfMonth(subMonths(new Date(), 1)), "yyyy-MM"));
  const monthDate = `${month}-01`;

  const preview = useQuery({
    queryKey: ["overhead-accrual", restaurant?.id, month],
    enabled: !!restaurant?.id && /^\d{4}-\d{2}$/.test(month),
    queryFn: async () => {
      const { data, error } = await db.rpc("post_overhead_month_accrual" as never, {
        p_restaurant_id: restaurant!.id, p_month: monthDate, p_dry_run: true,
      } as never);
      if (error) throw error;
      return data as unknown as AccrualResult;
    },
  });

  const payments = useQuery({
    queryKey: ["overhead-payments-unposted", restaurant?.id],
    enabled: !!restaurant?.id,
    queryFn: async () => {
      const { data, error } = await db.from("overhead_payments")
        .select("id, amount_paid, payment_date, payment_month, payment_method, overhead_allocation:overhead_allocation_id(name)")
        .eq("restaurant_id", restaurant!.id).eq("ledger_posted", false).order("payment_date");
      if (error) throw error;
      return (data || []) as unknown as UnpostedPayment[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["overhead-accrual"] });
    qc.invalidateQueries({ queryKey: ["overhead-payments-unposted"] });
    qc.invalidateQueries({ queryKey: ["overhead-payments"] });
    qc.invalidateQueries({ queryKey: ["accountant-overhead-accrual"] });
    qc.invalidateQueries({ queryKey: ["trial-balance"] });
    qc.invalidateQueries({ queryKey: ["profit-loss"] });
  };

  const post = useMutation({
    mutationFn: async () => {
      const { data, error } = await db.rpc("post_overhead_month_accrual" as never, {
        p_restaurant_id: restaurant!.id, p_month: monthDate, p_dry_run: false,
      } as never);
      if (error) throw error;
      return data as unknown as AccrualResult;
    },
    onSuccess: (r) => { toast.success(`Overheads accrued for ${month}: ${money(Number(r?.posted_total || 0))}`); invalidate(); },
    onError: (e: any) => toast.error(e?.message || "Could not post the accrual"),
  });

  const postPayment = useMutation({
    mutationFn: async (p: UnpostedPayment) => {
      const { error } = await db.rpc("post_overhead_payment_to_ledger", {
        p_payment_id: p.id, p_payment_method: p.payment_method || "cash",
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Payment posted: Accrued Liabilities cleared"); invalidate(); },
    onError: (e: any) => toast.error(e?.message || "Could not post the payment"),
  });

  const branchName = (id: string | null) => (id ? branches.find((b) => b.id === id)?.name ?? "Branch" : "All branches");
  const rows = preview.data?.branches ?? [];
  const toPost = rows.filter((b) => !b.already_posted && b.total > 0);
  const toPostTotal = toPost.reduce((s, b) => s + Number(b.total || 0), 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <CalendarCheck className="h-4 w-4 text-primary" /> Month-end overhead accrual
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Books the month's rent, utilities and other monthly overheads (Settings → Overheads) as an expense of
          that month, owed until paid (Accrued Liabilities). Marking an item paid then clears what is owed.
          Daily overhead closings already posted in the month are reversed so nothing is counted twice.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <Label htmlFor="overhead-accrual-month">Month</Label>
            <Input id="overhead-accrual-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-[170px]" />
          </div>
          <Button disabled={toPost.length === 0 || post.isPending || preview.isLoading} onClick={() => post.mutate()}>
            {post.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {toPost.length === 0 ? "Nothing to post" : `Post ${money(toPostTotal)}`}
          </Button>
        </div>
        {preview.isError && <p className="text-sm text-destructive">{(preview.error as Error)?.message || "Could not load the overheads"}</p>}
        {preview.isSuccess && rows.length === 0 && <p className="text-sm text-muted-foreground">No active overhead items for this month.</p>}
        {rows.map((b) => (
          <div key={b.reference} className="rounded-md border p-3 text-sm space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">{branchName(b.branch_id)} <span className="text-muted-foreground font-normal">· {b.reference}</span></p>
              {b.already_posted ? <Badge variant="secondary">Posted for this month</Badge> : <span className="font-medium tabular-nums">{money(Number(b.total))}</span>}
            </div>
            <ul className="space-y-1">
              {b.lines.map((l, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-2">
                  <span>{l.item} <span className="text-muted-foreground">→ {l.account}</span></span>
                  <span className="tabular-nums">{money(Number(l.debit))}</span>
                </li>
              ))}
            </ul>
            {Number(b.daily_overhead_reversed) > 0 && !b.already_posted && (
              <p className="text-xs text-muted-foreground">Reverses {money(Number(b.daily_overhead_reversed))} of daily overhead closings posted this month.</p>
            )}
          </div>
        ))}
        {(payments.data?.length ?? 0) > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Overhead payments not in the ledger</p>
            {payments.data!.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
                <span>{p.overhead_allocation?.name ?? "Overhead"} · {format(new Date(p.payment_month), "MMM yyyy")} · paid {p.payment_date} ({p.payment_method || "cash"})</span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{money(Number(p.amount_paid))}</span>
                  <Button size="sm" variant="outline" disabled={postPayment.isPending} onClick={() => postPayment.mutate(p)}>
                    {postPayment.isPending && postPayment.variables?.id === p.id && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Post
                  </Button>
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Posting needs the right to post journal entries (owners and managers; accountants when allowed on the Team page).
          Each branch is accrued once per month; a locked month cannot be posted.
        </p>
      </CardContent>
    </Card>
  );
}
