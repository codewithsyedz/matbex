/**
 * Split bill (docs/plans/split-payments.md, phase 2a): the sales one cart was divided into share
 * sales_transactions.bill_group_id. Shows every part of a sale's bill (receipt, total, voided),
 * marking the one being looked at, in the sale details and the void dialog, so a manager sees
 * what else was on the bill before voiding one part (voiding never touches the other parts).
 */
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { db } from "@/integrations/db/client";
import { useCurrency } from "@/hooks/useCurrency";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface BillSibling {
  id: string;
  receipt_number: string | null;
  total: number;
  voided_at: string | null;
}

/** Every part of the bill `billGroupId` belongs to, in receipt order (none for an ordinary sale). */
export function useBillSiblings(restaurantId: string | null | undefined, billGroupId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["sale-bill-siblings", restaurantId, billGroupId],
    enabled: enabled && !!restaurantId && !!billGroupId,
    staleTime: 30_000,
    queryFn: async (): Promise<BillSibling[]> => {
      const { data, error } = await db
        .from("sales_transactions")
        .select("id, receipt_number, total, voided_at")
        .eq("restaurant_id", restaurantId!)
        .eq("bill_group_id", billGroupId!);
      if (error) throw error;
      return ((data ?? []) as BillSibling[]).sort((a, b) =>
        (a.receipt_number ?? "").localeCompare(b.receipt_number ?? "", undefined, { numeric: true }),
      );
    },
  });
}

export function BillSiblings({
  restaurantId,
  billGroupId,
  currentId,
  enabled = true,
  note,
  className,
}: {
  restaurantId: string | null | undefined;
  billGroupId: string | null | undefined;
  /** The sale being viewed or voided. */
  currentId: string;
  enabled?: boolean;
  /** Shown under the heading (e.g. what a void does to the other parts). */
  note?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const { format: money } = useCurrency();
  const { data: parts = [] } = useBillSiblings(restaurantId, billGroupId, enabled);
  if (parts.length < 2) return null;
  const index = parts.findIndex((p) => p.id === currentId) + 1;
  return (
    <div className={cn("space-y-1 rounded-md border p-2", className)} data-testid="bill-siblings">
      <p className="text-xs font-medium">
        {index > 0 ? t("app.sales.billSiblings.title", { index, count: parts.length }) : t("app.sales.billSiblings.titleShort", { count: parts.length })}
      </p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      <ul className="space-y-0.5 text-xs">
        {parts.map((p, i) => (
          <li key={p.id} className={cn("flex items-center justify-between gap-2", p.id === currentId && "font-semibold")}>
            <span className="flex items-center gap-1.5">
              <span className="text-muted-foreground">{t("app.sales.billPart", { index: i + 1, count: parts.length })}</span>
              <span className="font-mono">{p.receipt_number ?? "-"}</span>
              {p.id === currentId && <Badge variant="outline" className="px-1 py-0 text-[9px]">{t("app.sales.billSiblings.thisSale")}</Badge>}
              {p.voided_at && <Badge variant="destructive" className="px-1 py-0 text-[9px]">{t("app.sales.billSiblings.voided")}</Badge>}
            </span>
            <span className="tabular-nums">{money(Number(p.total))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
