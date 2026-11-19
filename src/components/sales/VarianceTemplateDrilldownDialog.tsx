import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { Search, TrendingDown, TrendingUp, Calendar, FileText } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  templateKey: string | null;
  templateLabel: string;
  fromISO: string;
  toISO: string;
  rangeLabel?: string;
  initialMin?: number;
  initialMax?: number;
}

interface EventRow {
  id: string;
  used_at: string;
  variance_amount: number;
  abs_variance: number;
  business_date: string | null;
  daily_sales_id: string | null;
  notes_snapshot: string | null;
}

export function VarianceTemplateDrilldownDialog({
  open,
  onOpenChange,
  templateKey,
  templateLabel,
  fromISO,
  toISO,
  rangeLabel,
  initialMin,
  initialMax,
}: Props) {
  const { tenant, restaurant } = useAuth();
  const { format: formatCurrency } = useCurrency();
  const [minAbs, setMinAbs] = useState<string>("");
  const [maxAbs, setMaxAbs] = useState<string>("");

  // Initialize range when opening / template changes
  useEffect(() => {
    if (open) {
      setMinAbs(initialMin != null ? String(Math.floor(initialMin)) : "");
      setMaxAbs(initialMax != null ? String(Math.ceil(initialMax)) : "");
    }
  }, [open, templateKey, initialMin, initialMax]);

  const { data: events, isLoading } = useQuery({
    queryKey: [
      "variance-template-drilldown",
      tenant?.id,
      restaurant?.id,
      templateKey,
      fromISO,
      toISO,
    ],
    queryFn: async (): Promise<EventRow[]> => {
      if (!tenant?.id || !templateKey) return [];
      const { data, error } = await db
        .from("variance_template_usage_events")
        .select(
          "id, used_at, variance_amount, abs_variance, business_date, daily_sales_id, notes_snapshot"
        )
        .eq("tenant_id", tenant.id)
        .eq("template_key", templateKey)
        .or(
          `restaurant_id.eq.${
            restaurant?.id ?? "00000000-0000-0000-0000-000000000000"
          },restaurant_id.is.null`
        )
        .gte("used_at", fromISO)
        .lte("used_at", toISO)
        .order("used_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as EventRow[];
    },
    enabled: open && !!tenant?.id && !!templateKey,
  });

  const filtered = useMemo(() => {
    const min = minAbs.trim() === "" ? null : Number(minAbs);
    const max = maxAbs.trim() === "" ? null : Number(maxAbs);
    return (events ?? []).filter((e) => {
      const a = Number(e.abs_variance ?? Math.abs(e.variance_amount));
      if (min != null && !Number.isNaN(min) && a < min) return false;
      if (max != null && !Number.isNaN(max) && a > max) return false;
      return true;
    });
  }, [events, minAbs, maxAbs]);

  const totalCount = events?.length ?? 0;
  const shortCount = filtered.filter((e) => Number(e.variance_amount) < 0).length;
  const overCount = filtered.filter((e) => Number(e.variance_amount) > 0).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-4 w-4 text-primary" />
            Drilldown · {templateLabel}
          </DialogTitle>
          <DialogDescription>
            Shifts and notes where this template was applied
            {rangeLabel ? ` · ${rangeLabel}` : ""}.
            Filter by an absolute variance range to focus on a specific impact band.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Min |variance|</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={minAbs}
              onChange={(e) => setMinAbs(e.target.value)}
              placeholder="e.g. 0"
              className="h-8 text-xs tabular-nums"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Max |variance|</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={maxAbs}
              onChange={(e) => setMaxAbs(e.target.value)}
              placeholder="No upper limit"
              className="h-8 text-xs tabular-nums"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Badge variant="outline" className="text-[10px]">
            {filtered.length} / {totalCount} match
          </Badge>
          <span className="inline-flex items-center gap-1 text-rose-600">
            <TrendingDown className="h-3 w-3" /> {shortCount} short
          </span>
          <span className="inline-flex items-center gap-1 text-emerald-600">
            <TrendingUp className="h-3 w-3" /> {overCount} over
          </span>
        </div>

        <ScrollArea className="max-h-[55vh] pr-2">
          {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
          {!isLoading && filtered.length === 0 && (
            <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
              No template applications fall in this variance range.
            </div>
          )}
          <div className="space-y-2">
            {filtered.map((e) => {
              const isShort = Number(e.variance_amount) < 0;
              return (
                <div key={e.id} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      <span>
                        {e.business_date
                          ? new Date(e.business_date).toLocaleDateString()
                          : new Date(e.used_at).toLocaleDateString()}
                      </span>
                      <span className="opacity-60">
                        · {new Date(e.used_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      {e.daily_sales_id && (
                        <Badge variant="outline" className="text-[10px] font-mono">
                          shift {e.daily_sales_id.slice(0, 8)}
                        </Badge>
                      )}
                    </div>
                    <div
                      className={`text-sm font-semibold tabular-nums ${
                        isShort ? "text-rose-600" : "text-emerald-600"
                      }`}
                    >
                      {formatCurrency(Number(e.variance_amount))}
                    </div>
                  </div>
                  {e.notes_snapshot ? (
                    <div className="rounded bg-muted/40 p-2 text-[11px] whitespace-pre-wrap break-words flex gap-2">
                      <FileText className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground" />
                      <span>{e.notes_snapshot}</span>
                    </div>
                  ) : (
                    <p className="text-[11px] italic text-muted-foreground">
                      No note snapshot saved for this application.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
