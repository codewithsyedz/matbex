import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatZonedYMD } from "@/lib/timezone";
import { buildDailyRows } from "@/lib/starterPlan";

export function useStarterDaily(days = 14) {
  const { restaurant } = useAuth();
  const tz = (restaurant as any)?.timezone || "Asia/Riyadh";
  const today = formatZonedYMD(new Date(), tz);
  const from = formatZonedYMD(new Date(Date.now() - (days - 1) * 86400000), tz);

  const query = useQuery({
    queryKey: ["starter-daily", restaurant?.id, from, today],
    enabled: !!restaurant?.id,
    staleTime: 120_000,
    queryFn: async () => {
      const [s, e] = await Promise.all([
        db
          .from("daily_sales_summary")
          .select("sales_date,cash_sales,card_sales,delivery_sales,other_sales,status")
          .eq("restaurant_id", restaurant!.id)
          .gte("sales_date", from)
          .lte("sales_date", today),
        db
          .from("expenses")
          .select("expense_date,amount")
          .eq("restaurant_id", restaurant!.id)
          .is("deleted_at", null)
          .gte("expense_date", from)
          .lte("expense_date", today + "T23:59:59"),
      ]);
      if (s.error) throw s.error;
      if (e.error) throw e.error;
      return buildDailyRows(s.data ?? [], e.data ?? []);
    },
  });
  return { ...query, today, from };
}

export function formatMoney(n: number) {
  return `﷼ ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
