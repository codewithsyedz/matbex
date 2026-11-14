import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Zap } from "lucide-react";
import { format as formatDate, parseISO } from "date-fns";
import { useCurrency } from "@/hooks/useCurrency";
import {
  usePendingDailySalesPostings,
  useAutoPostDailySales,
} from "@/hooks/useAutoPostDailySales";

interface Props {
  date: Date;
  branchId: string | null;
  lookbackDays?: number;
}

const AI_CHOOSES = "__ai__";

/**
 * Posts every closed, unposted day's net sales to the ledger. lookbackDays 0 (default): every
 * such day, however old. The revenue account is either chosen by the AI per day (it asks when
 * unsure, and those days are left for confirmation) or one account a person picks for all.
 */
export function AutoPostNetSalesButton({ date, branchId, lookbackDays = 0 }: Props) {
  const [open, setOpen] = useState(false);
  const [accountChoice, setAccountChoice] = useState<string>("");
  const { profile } = useAuth();
  const { data: days, isLoading } = usePendingDailySalesPostings(date, branchId, lookbackDays);
  const { data: revenueAccounts = [] } = useQuery({
    queryKey: ["revenue-accounts", profile?.tenant_id],
    enabled: open && !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await db
        .from("chart_of_accounts")
        .select("id, account_code, account_name")
        .eq("tenant_id", profile!.tenant_id!)
        .eq("account_type", "revenue")
        .eq("is_active", true)
        .order("account_code");
      if (error) throw error;
      return (data || []) as Array<{ id: string; account_code: string; account_name: string }>;
    },
  });
  // Default: the standard sales account (4000) when there is one, else let the AI choose.
  const choice =
    accountChoice || revenueAccounts.find((a) => a.account_code === "4000")?.id || AI_CHOOSES;
  const autoPost = useAutoPostDailySales();
  const { format: formatCurrency } = useCurrency();

  const pending = days || [];
  const total = pending.reduce((s, d) => s + d.netSales, 0);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        disabled={isLoading}
        onClick={() => setOpen(true)}
      >
        <Zap className="h-4 w-4" />
        Auto-post
        {pending.length > 0 && (
          <Badge variant="secondary" className="ml-1">
            {pending.length}
          </Badge>
        )}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="font-medium">Auto-post net sales</DialogTitle>
            <DialogDescription>
              Creates the ledger entries for each closed day's net sales that is not in the ledger yet
              {lookbackDays > 0 ? ` (last ${lookbackDays} days)` : ""}
              {branchId ? " for the selected branch" : ""}. Until they are posted, these sales are
              missing from revenue, VAT and cash.
            </DialogDescription>
          </DialogHeader>

          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Every closed day's net sales is already posted to the ledger.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{pending.length} day(s) pending</span>
                <span className="font-medium">{formatCurrency(total)}</span>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Revenue account</Label>
                <Select value={choice} onValueChange={setAccountChoice}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={AI_CHOOSES}>Let the AI choose for each day (asks when unsure)</SelectItem>
                    {revenueAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.account_code} · {a.account_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  {choice === AI_CHOOSES
                    ? "Days the AI is unsure about are left for you to confirm."
                    : "Every day below is posted to this account. Delivery sales still go to the delivery sales account, and VAT is calculated as usual."}
                </p>
              </div>
              <ScrollArea className="max-h-[45vh] pr-3">
                <div className="space-y-1">
                  {pending.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                    >
                      <span>{formatDate(parseISO(d.salesDate), "MMM d, yyyy")}</span>
                      <span className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {d.status}
                        </Badge>
                        <span className="font-medium">{formatCurrency(d.netSales)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button
              disabled={pending.length === 0 || autoPost.isPending}
              onClick={() =>
                autoPost.mutate({ days: pending, accountId: choice === AI_CHOOSES ? null : choice }, {
                  onSuccess: ({ failures }) => {
                    if (failures.length === 0) setOpen(false);
                  },
                })
              }
            >
              {autoPost.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Post {pending.length} day(s)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
