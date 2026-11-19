import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { db } from "@/integrations/db/client";
import { useCurrency } from "@/hooks/useCurrency";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import { bucketForPaymentMethod, fetchPaymentMap, fetchPaymentRules, type PaymentBucket } from "@/lib/posPaymentMapping";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
  date: string; // yyyy-MM-dd
}

interface POSRow {
  id: string;
  receipt_number: string | null;
  payment_method: string | null;
  total: number | string | null;
  created_at: string;
}

const BUCKET_VARIANT: Record<string, string> = {
  cash: "bg-emerald-100 text-emerald-700 hover:bg-emerald-100",
  card: "bg-blue-100 text-blue-700 hover:bg-blue-100",
  delivery: "bg-orange-100 text-orange-700 hover:bg-orange-100",
  other: "bg-gray-100 text-gray-700 hover:bg-gray-100",
};

export function POSDetailsDialog({ open, onOpenChange, restaurantId, date }: Props) {
  const { format: formatCurrency } = useCurrency();

  const { data: overrides = {} } = useQuery({
    queryKey: ["pos-payment-map", restaurantId],
    enabled: open && !!restaurantId,
    queryFn: () => fetchPaymentMap(restaurantId),
  });

  const { data: rules = [] } = useQuery({
    queryKey: ["pos-payment-rules", restaurantId],
    enabled: open && !!restaurantId,
    queryFn: () => fetchPaymentRules(restaurantId),
  });

  const bucketOf = (pm: string | null): PaymentBucket =>
    bucketForPaymentMethod(pm, overrides, rules);

  const { data, isLoading } = useQuery({
    queryKey: ["pos-details", restaurantId, date],
    enabled: open && !!restaurantId && !!date,
    queryFn: async (): Promise<POSRow[]> => {
      const { data, error } = await db
        .from("sales_transactions")
        .select("id,receipt_number,payment_method,total,created_at")
        .eq("restaurant_id", restaurantId)
        .gte("created_at", `${date}T00:00:00`)
        .lt("created_at", `${date}T23:59:59.999`)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as POSRow[];
    },
  });

  const rows = data || [];
  const totals = rows.reduce(
    (acc, r) => {
      const amt = Number(r.total) || 0;
      acc[bucketOf(r.payment_method)] += amt;
      acc.all += amt;
      return acc;
    },
    { cash: 0, card: 0, delivery: 0, other: 0, all: 0 },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>POS Transactions - {date}</DialogTitle>
          <DialogDescription>
            Underlying sales used to prefill Cash, Card, Delivery and Other for this day.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          {(["cash", "card", "delivery", "other"] as const).map((k) => (
            <div key={k} className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground capitalize">{k}</div>
              <div className="font-semibold">{formatCurrency(totals[k])}</div>
            </div>
          ))}
        </div>

        <ScrollArea className="max-h-[60vh] mt-2 rounded-md border">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading transactions…
            </div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No POS transactions recorded for this date.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Receipt</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const b = bucketOf(r.payment_method);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">
                        {format(new Date(r.created_at), "HH:mm")}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.receipt_number || "-"}
                      </TableCell>
                      <TableCell>
                        <Badge className={BUCKET_VARIANT[b]} variant="secondary">
                          {b}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(Number(r.total) || 0)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </ScrollArea>

        <div className="flex items-center justify-between pt-2 text-sm">
          <span className="text-muted-foreground">{rows.length} transaction(s)</span>
          <span className="font-semibold">{formatCurrency(totals.all)}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}