import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Trophy, TrendingUp, Search, ListFilter } from "lucide-react";
import { getRestaurantDayBoundsUTC } from "@/lib/timezone";
import { format as formatDate, isSameDay } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";

interface TopSeller {
  menuItemId: string;
  name: string;
  category: string | null;
  quantity: number;
  revenue: number;
}

interface TopSellersCardProps {
  /** Optional date range from the dashboard filters. Falls back to today. */
  dateRange?: { from?: Date; to?: Date } | null;
}

export function TopSellersCard({ dateRange }: TopSellersCardProps = {}) {
  const { restaurant } = useAuth();
  const { activeBranchId, isBranchReady } = useBranch();
  const { format: formatCurrency } = useCurrency();
  const timezone = restaurant?.timezone || "Asia/Riyadh";
  const qc = useQueryClient();

  // Resolve effective bounds in the restaurant's timezone.
  const today = new Date();
  const fromDate = dateRange?.from ?? today;
  const toDate = dateRange?.to ?? today;
  const { start: rangeStart } = getRestaurantDayBoundsUTC(fromDate, timezone);
  const { endExclusive: rangeEnd } = getRestaurantDayBoundsUTC(toDate, timezone);
  const startISO = rangeStart.toISOString();
  const endISO = rangeEnd.toISOString();

  const isToday = isSameDay(fromDate, today) && isSameDay(toDate, today);
  const rangeLabel = isToday
    ? "Today"
    : isSameDay(fromDate, toDate)
    ? formatDate(fromDate, "MMM d")
    : `${formatDate(fromDate, "MMM d")} – ${formatDate(toDate, "MMM d")}`;

  const { data, isLoading } = useQuery({
    queryKey: ["top-sellers", restaurant?.id, activeBranchId ?? "all", startISO, endISO],
    enabled: !!restaurant?.id && isBranchReady,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<TopSeller[]> => {
      let query = db
        .from("sales_items")
        .select("menu_item_id, quantity, total_price, menu_items(name, category)")
        .eq("restaurant_id", restaurant!.id)
        .gte("created_at", startISO)
        .lt("created_at", endISO);
      if (activeBranchId) query = query.eq("branch_id", activeBranchId);
      const { data: items, error } = await query;

      if (error) throw error;

      const summary = new Map<string, TopSeller>();
      (items || []).forEach((row: any) => {
        const id = row.menu_item_id;
        const existing = summary.get(id);
        if (existing) {
          existing.quantity += Number(row.quantity) || 0;
          existing.revenue += Number(row.total_price) || 0;
        } else {
          summary.set(id, {
            menuItemId: id,
            name: row.menu_items?.name || "Unknown",
            category: row.menu_items?.category || null,
            quantity: Number(row.quantity) || 0,
            revenue: Number(row.total_price) || 0,
          });
        }
      });

      return Array.from(summary.values()).sort((a, b) => b.quantity - a.quantity);
    },
  });

  // Real-time refresh on new sales line items for this restaurant.
  useEffect(() => {
    if (!restaurant?.id) return;
    const filter = `restaurant_id=eq.${restaurant.id}`;
    const channel = db
      .channel(`top-sellers-rt-${restaurant.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales_items", filter }, () => {
        qc.invalidateQueries({ queryKey: ["top-sellers", restaurant.id] });
      })
      .subscribe();
    return () => {
      db.removeChannel(channel);
    };
  }, [restaurant?.id, qc]);

  const topFive = useMemo(() => (data ?? []).slice(0, 5), [data]);

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const categories = useMemo(() => {
    const set = new Set<string>();
    (data ?? []).forEach((i) => i.category && set.add(i.category));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data ?? []).filter((i) => {
      if (categoryFilter !== "all" && (i.category ?? "") !== categoryFilter) return false;
      if (!q) return true;
      return (
        i.name.toLowerCase().includes(q) ||
        (i.category ?? "").toLowerCase().includes(q)
      );
    });
  }, [data, search, categoryFilter]);

  return (
    <Card className="fade-slide-in h-full flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          <Trophy className="h-4 w-4 text-amber-500" />
          Top Sellers · {rangeLabel}
        </CardTitle>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setOpen(true)}
          disabled={!data || data.length === 0}
        >
          View all
        </Button>
      </CardHeader>
      <CardContent className="flex-1">
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : topFive.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-8 text-center text-muted-foreground">
            <TrendingUp className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-xs">No sales recorded for this period</p>
          </div>
        ) : (
          <ol className="space-y-2">
            {topFive.map((item, idx) => (
              <li
                key={item.menuItemId}
                className="flex items-center justify-between gap-3 py-1.5 border-b border-border/40 last:border-0"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span
                    className={`flex items-center justify-center h-6 w-6 rounded-full text-xs font-semibold shrink-0 ${
                      idx === 0
                        ? "bg-amber-500/15 text-amber-600"
                        : idx === 1
                        ? "bg-secondary text-secondary-foreground"
                        : idx === 2
                        ? "bg-orange-500/15 text-orange-600"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {idx + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{item.name}</p>
                    {item.category && (
                      <p className="text-[10px] text-muted-foreground truncate">{item.category}</p>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold tabular-nums">×{item.quantity}</p>
                  <p className="text-[10px] text-muted-foreground tabular-nums">
                    {formatCurrency(item.revenue)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-500" />
              All Sellers · {rangeLabel}
            </DialogTitle>
            <DialogDescription>
              {(data?.length ?? 0)} item{(data?.length ?? 0) === 1 ? "" : "s"} sold in this period.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search items…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="sm:w-56 h-9">
                <ListFilter className="h-4 w-4 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <ScrollArea className="max-h-[60vh] pr-2">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
                <TrendingUp className="h-8 w-8 mb-2 opacity-40" />
                <p className="text-xs">No items match your filters</p>
              </div>
            ) : (
              <ol className="space-y-1">
                {filtered.map((item, idx) => (
                  <li
                    key={item.menuItemId}
                    className="flex items-center justify-between gap-3 py-2 px-2 rounded-md hover:bg-muted/40 border-b border-border/30 last:border-0"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="flex items-center justify-center h-6 w-6 rounded-full text-xs font-medium shrink-0 bg-muted text-muted-foreground tabular-nums">
                        {idx + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{item.name}</p>
                        {item.category && (
                          <p className="text-[10px] text-muted-foreground truncate">{item.category}</p>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold tabular-nums">×{item.quantity}</p>
                      <p className="text-[10px] text-muted-foreground tabular-nums">
                        {formatCurrency(item.revenue)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
