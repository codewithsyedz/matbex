import { useEffect, useState } from "react";
import { editSale } from "@/lib/api/pos";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Building2, History, Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";

export interface DrilldownRow {
  id: string;
  receipt: string;
  date: string;
  branchId?: string | null;
  branchName: string;
  terminalName: string;
  ratePercent: number;
  itemsSum: number;
  before: { subtotal: number; tax: number; total: number };
  after: { subtotal: number; tax: number; total: number };
  issueLabels: string[];
}

const UNASSIGNED = "__unassigned__";

interface Props {
  row: DrilldownRow;
  fmt: (n: number) => string;
  onReconcile: () => void;
}

/**
 * Explains exactly which stored fields feed the inclusive-VAT recalculation,
 * shows before/after side by side, and lists the audit trail for the receipt.
 */
export function VatReceiptDrilldown({ row, fmt, onReconcile }: Props) {
  const { restaurant } = useAuth();
  const { branches } = useBranch();
  const queryClient = useQueryClient();
  const [branchChoice, setBranchChoice] = useState<string>(row.branchId ?? UNASSIGNED);

  useEffect(() => {
    setBranchChoice(row.branchId ?? UNASSIGNED);
  }, [row.id, row.branchId]);

  const reassign = useMutation({
    // PATCH /api/v1/pos/sales/:id { branchId }: the server checks the branch and logs the change.
    mutationFn: async (nextBranchId: string | null) => {
      if (!restaurant?.id) throw new Error("Missing restaurant context");
      await editSale(row.id, { restaurantId: restaurant.id, branchId: nextBranchId });
    },
    onSuccess: () => {
      toast.success("Branch updated for this receipt");
      queryClient.invalidateQueries({ queryKey: ["vat-audit"] });
      queryClient.invalidateQueries({ queryKey: ["vat-audit-trail", row.id] });
      queryClient.invalidateQueries({ queryKey: ["vat-incidents"] });
    },
    onError: (e: any) => toast.error(e?.message || "Failed to reassign branch"),
  });

  const nextBranchId = branchChoice === UNASSIGNED ? null : branchChoice;
  const branchDirty = (row.branchId ?? null) !== nextBranchId;

  const { data: items = [], isLoading: itemsLoading } = useQuery({
    queryKey: ["vat-audit-items", row.id],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (db as any)
        .from("sales_items")
        .select("id, item_name, quantity, unit_price, total_price")
        .eq("transaction_id", row.id);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const { data: trail = [], isLoading: trailLoading } = useQuery({
    queryKey: ["vat-audit-trail", row.id],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (db as any)
        .from("audit_logs")
        .select("id, action, created_at, old_data, new_data")
        .eq("entity_id", row.id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) return [];
      return (data ?? []) as any[];
    },
  });

  const rate = row.ratePercent / 100;

  return (
    <ScrollArea className="max-h-[70vh] pr-3">
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{row.issueLabels.join(", ")}</AlertTitle>
          <AlertDescription className="text-xs">
            Line items total {fmt(row.itemsSum)} — the VAT-inclusive gross this receipt should
            settle at.
          </AlertDescription>
        </Alert>

        {/* Branch reassignment */}
        <section className="space-y-2">
          <h4 className="flex items-center gap-1.5 text-sm font-medium">
            <Building2 className="h-4 w-4" /> Branch
          </h4>
          <div className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center">
            <Select value={branchChoice} onValueChange={setBranchChoice}>
              <SelectTrigger className="sm:w-64">
                <SelectValue placeholder="Select branch" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                {(branches as any[]).map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="secondary"
              disabled={!branchDirty || reassign.isPending}
              onClick={() => reassign.mutate(nextBranchId)}
            >
              {reassign.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Save branch
            </Button>
            <span className="text-xs text-muted-foreground sm:ml-auto">
              Currently: {row.branchName}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Reassigning re-tags the sale; VAT is recalculated against the new branch rate on the
            next audit refresh.
          </p>
        </section>

        {/* Source fields */}
        <section className="space-y-2">
          <h4 className="text-sm font-medium">Fields used in the calculation</h4>
          <div className="rounded-md border divide-y text-sm">
            <FieldRow name="branches.vat_rate" value={`${row.ratePercent}%`} note="Branch VAT rate" />
            <FieldRow
              name="sales_items.total_price (sum)"
              value={fmt(row.itemsSum)}
              note="Gross, VAT-inclusive"
            />
            <FieldRow name="sales_transactions.subtotal" value={fmt(row.before.subtotal)} note="Stored net" />
            <FieldRow name="sales_transactions.tax" value={fmt(row.before.tax)} note="Stored VAT" />
            <FieldRow name="sales_transactions.total" value={fmt(row.before.total)} note="Stored gross" />
          </div>
          <div className="rounded-md bg-muted/50 p-3 text-xs font-mono leading-relaxed">
            gross = Σ sales_items.total_price = {fmt(row.itemsSum)}
            <br />
            net = round(gross ÷ (1 + {rate.toFixed(4)})) = {fmt(row.after.subtotal)}
            <br />
            vat = round(gross − net) = {fmt(row.after.tax)}
          </div>
        </section>

        {/* Before / after side by side */}
        <section className="space-y-2">
          <h4 className="text-sm font-medium">Before → after</h4>
          <div className="grid grid-cols-[1fr_auto_1fr] gap-x-3 rounded-md border p-3 text-sm">
            <div className="text-xs font-medium text-muted-foreground">Stored</div>
            <div />
            <div className="text-xs font-medium text-muted-foreground text-right">Corrected</div>
            {(
              [
                ["Net (subtotal)", row.before.subtotal, row.after.subtotal],
                ["VAT", row.before.tax, row.after.tax],
                ["Total", row.before.total, row.after.total],
              ] as const
            ).map(([label, b, a]) => (
              <FragmentRow key={label} label={label} before={fmt(b)} after={fmt(a)} changed={Math.abs(a - b) > 0.005} />
            ))}
          </div>
        </section>

        {/* Line items */}
        <section className="space-y-2">
          <h4 className="text-sm font-medium">Line items ({items.length})</h4>
          {itemsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading items…
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No line items stored — corrected totals fall back to the receipt total.
            </p>
          ) : (
            <div className="rounded-md border divide-y text-sm">
              {items.map((it) => {
                const gross = Number(it.total_price ?? 0);
                const net = gross / (1 + rate);
                return (
                  <div key={it.id} className="flex items-center justify-between gap-2 p-2">
                    <span className="truncate">
                      {it.item_name} <span className="text-muted-foreground">× {it.quantity}</span>
                    </span>
                    <span className="tabular-nums text-xs text-muted-foreground">
                      net {fmt(net)} · vat {fmt(gross - net)} ·{" "}
                      <span className="text-foreground">{fmt(gross)}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <Separator />

        {/* Audit trail */}
        <section className="space-y-2">
          <h4 className="flex items-center gap-1.5 text-sm font-medium">
            <History className="h-4 w-4" /> Audit trail
          </h4>
          {trailLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
            </div>
          ) : trail.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No recorded changes yet. Reconciling this receipt writes an entry here.
            </p>
          ) : (
            <div className="space-y-2">
              {trail.map((e) => (
                <div key={e.id} className="rounded-md border p-2 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="secondary">{e.action}</Badge>
                    <span className="text-muted-foreground">
                      {new Date(e.created_at).toLocaleString()}
                    </span>
                  </div>
                  {e.old_data && e.new_data && (
                    <div className="font-mono text-muted-foreground">
                      total {fmt(Number(e.old_data.total ?? 0))} → {fmt(Number(e.new_data.total ?? 0))} ·
                      vat {fmt(Number(e.old_data.tax ?? 0))} → {fmt(Number(e.new_data.tax ?? 0))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="flex justify-end">
          <Button className="gap-1.5" onClick={onReconcile}>
            <Wand2 className="h-4 w-4" /> Reconcile receipt
          </Button>
        </div>
      </div>
    </ScrollArea>
  );
}

function FieldRow({ name, value, note }: { name: string; value: string; note: string }) {
  return (
    <div className="flex items-center justify-between gap-2 p-2">
      <span className="font-mono text-xs">{name}</span>
      <span className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{note}</span>
        <span className="tabular-nums">{value}</span>
      </span>
    </div>
  );
}

function FragmentRow({
  label,
  before,
  after,
  changed,
}: {
  label: string;
  before: string;
  after: string;
  changed: boolean;
}) {
  return (
    <>
      <div className="py-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="tabular-nums">{before}</div>
      </div>
      <div className="flex items-center">
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="py-1 text-right">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`tabular-nums ${changed ? "font-medium text-primary" : ""}`}>{after}</div>
      </div>
    </>
  );
}
