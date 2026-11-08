import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrency } from "@/hooks/useCurrency";
import { ClipboardList, AlertTriangle, Search, TrendingUp, TrendingDown, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface AuditTx {
  id: string;
  receipt_number: string | null;
  payment_method: string | null;
  total: number;
  created_at: string;
  bucket: 'cash' | 'card' | 'delivery' | 'other';
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  timezone: string;
  startISO: string;
  endExclusiveISO: string;
  transactions: AuditTx[];
  totals: { cash: number; card: number; delivery: number; other: number };
  /** Values currently entered in the Day-End form (for mismatch highlighting). */
  reportedTotals?: { cash: number; card: number; delivery: number; other: number };
}

const bucketColor: Record<AuditTx['bucket'], string> = {
  cash: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  card: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  delivery: 'bg-orange-500/10 text-orange-700 dark:text-orange-400',
  other: 'bg-muted text-muted-foreground',
};

function fmtZoned(iso: string, tz: string) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

type BucketKey = AuditTx['bucket'];
const BUCKETS: BucketKey[] = ['cash', 'card', 'delivery', 'other'];

export function DayEndAuditLogDialog({
  open, onOpenChange, date, timezone, startISO, endExclusiveISO, transactions, totals, reportedTotals,
}: Props) {
  const { format: formatCurrency } = useCurrency();
  const [bucketFilter, setBucketFilter] = useState<BucketKey | 'all'>('all');
  const [search, setSearch] = useState('');

  const grandTotal = transactions.reduce((s, t) => s + t.total, 0);

  // Per-bucket variance vs reported (entered) values
  const variances = useMemo(() => {
    if (!reportedTotals) return null;
    return BUCKETS.map((b) => {
      const sys = totals[b] || 0;
      const rep = reportedTotals[b] || 0;
      return { bucket: b, system: sys, reported: rep, diff: rep - sys };
    });
  }, [reportedTotals, totals]);

  const totalDiff = variances?.reduce((s, v) => s + v.diff, 0) ?? 0;
  const mismatchedBuckets = variances?.filter((v) => Math.abs(v.diff) >= 0.01) ?? [];

  // Group "other" bucket by payment_method to surface unmapped methods
  const unmappedSummary = useMemo(() => {
    const byMethod = new Map<string, { count: number; amount: number }>();
    for (const t of transactions) {
      if (t.bucket !== 'other') continue;
      const key = (t.payment_method || '(blank)').trim() || '(blank)';
      const cur = byMethod.get(key) || { count: 0, amount: 0 };
      byMethod.set(key, { count: cur.count + 1, amount: cur.amount + t.total });
    }
    return Array.from(byMethod.entries())
      .map(([method, v]) => ({ method, ...v }))
      .sort((a, b) => b.amount - a.amount);
  }, [transactions]);

  const filteredTx = useMemo(() => {
    const q = search.trim().toLowerCase();
    return transactions.filter((t) => {
      if (bucketFilter !== 'all' && t.bucket !== bucketFilter) return false;
      if (!q) return true;
      return (
        (t.receipt_number || '').toLowerCase().includes(q) ||
        (t.payment_method || '').toLowerCase().includes(q)
      );
    });
  }, [transactions, bucketFilter, search]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[90vh] max-h-[90vh] min-h-0 overflow-hidden flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4" />
            Day-End Auto-Prefill Audit Log
          </DialogTitle>
          <DialogDescription>
            Exact transactions and day bounds used to compute the prefilled values for {date}.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea type="always" className="flex-1 min-h-0 h-full -mx-6 px-6">
        <div className="space-y-4">
        <div className="rounded-lg border bg-muted/30 p-3 text-xs space-y-1.5">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Restaurant timezone</span>
            <span className="font-mono">{timezone}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Window start (local)</span>
            <span className="font-mono">{startISO ? fmtZoned(startISO, timezone) : '-'}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Window end (local, exclusive)</span>
            <span className="font-mono">{endExclusiveISO ? fmtZoned(endExclusiveISO, timezone) : '-'}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Window start (UTC)</span>
            <span className="font-mono">{startISO || '-'}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Window end (UTC, exclusive)</span>
            <span className="font-mono">{endExclusiveISO || '-'}</span>
          </div>
          <div className="flex justify-between gap-4 pt-1 border-t border-border/50">
            <span className="text-muted-foreground">Filter applied</span>
            <span className="font-mono">created_at ≥ start AND created_at &lt; endExclusive</span>
          </div>
        </div>

        {/* Per-bucket totals + mismatch highlighting */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
          {BUCKETS.map((b) => {
            const v = variances?.find((x) => x.bucket === b);
            const mismatch = v && Math.abs(v.diff) >= 0.01;
            return (
              <div
                key={b}
                className={cn(
                  "rounded-md border p-2 transition-colors",
                  mismatch && "border-amber-500/60 bg-amber-50/60 dark:bg-amber-950/20"
                )}
              >
                <div className="text-muted-foreground capitalize">{b}</div>
                <div className="font-semibold">{formatCurrency(totals[b])}</div>
                {v && (
                  <div className={cn(
                    "text-[10px] mt-0.5 flex items-center gap-1",
                    mismatch ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"
                  )}>
                    {mismatch ? (
                      v.diff > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />
                    ) : (
                      <CheckCircle2 className="h-3 w-3" />
                    )}
                    {mismatch
                      ? `Reported ${formatCurrency(v.reported)} (${v.diff > 0 ? '+' : ''}${formatCurrency(v.diff)})`
                      : 'Matches reported'}
                  </div>
                )}
              </div>
            );
          })}
          <div className="rounded-md border p-2 bg-muted/50">
            <div className="text-muted-foreground">Total ({transactions.length})</div>
            <div className="font-semibold">{formatCurrency(grandTotal)}</div>
            {variances && (
              <div className={cn(
                "text-[10px] mt-0.5",
                Math.abs(totalDiff) >= 0.01 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"
              )}>
                Diff {totalDiff >= 0 ? '+' : ''}{formatCurrency(totalDiff)}
              </div>
            )}
          </div>
        </div>

        {/* Root-cause callouts */}
        {mismatchedBuckets.length > 0 && (
          <Alert className="border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/20">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertTitle className="text-sm">Likely causes of the mismatch</AlertTitle>
            <AlertDescription>
              <ul className="text-xs list-disc pl-4 space-y-1 mt-1">
                {mismatchedBuckets.map((v) => (
                  <li key={v.bucket}>
                    <span className="capitalize font-medium">{v.bucket}</span>: reported{' '}
                    {formatCurrency(v.reported)} vs system {formatCurrency(v.system)}{' '}
                    ({v.diff > 0 ? 'over' : 'short'} by {formatCurrency(Math.abs(v.diff))}).{' '}
                    {v.diff > 0
                      ? 'Manual edit added value not present in POS transactions.'
                      : 'Some POS transactions in this bucket were excluded or manually reduced.'}
                  </li>
                ))}
                {unmappedSummary.length > 0 && (
                  <li>
                    <span className="font-medium">Unmapped payment methods</span> are routed to{' '}
                    <span className="font-mono">other</span>:{' '}
                    {unmappedSummary.slice(0, 4).map((u, i) => (
                      <span key={u.method} className="font-mono">
                        {i > 0 ? ', ' : ''}{u.method} ({u.count}× = {formatCurrency(u.amount)})
                      </span>
                    ))}
                    {unmappedSummary.length > 4 && '…'}
                    . Map them via Payment Mapping to fix bucket assignment.
                  </li>
                )}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1">
            {(['all', ...BUCKETS] as const).map((b) => (
              <Button
                key={b}
                size="sm"
                variant={bucketFilter === b ? 'default' : 'outline'}
                onClick={() => setBucketFilter(b)}
                className="h-7 px-2.5 text-xs capitalize"
              >
                {b}
              </Button>
            ))}
          </div>
          <div className="relative ml-auto w-full sm:w-64">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search receipt or method..."
              className="h-8 pl-7 text-xs"
            />
          </div>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Receipt</TableHead>
                <TableHead>Time (local)</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Bucket</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTx.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground text-sm py-6">
                    No transactions match the current filter.
                  </TableCell>
                </TableRow>
              ) : filteredTx.map((t) => {
                const isMismatchBucket = mismatchedBuckets.some((m) => m.bucket === t.bucket);
                return (
                <TableRow key={t.id} className={cn(isMismatchBucket && "bg-amber-50/40 dark:bg-amber-950/10")}>
                  <TableCell className="font-mono text-xs">{t.receipt_number || '-'}</TableCell>
                  <TableCell className="font-mono text-xs">{fmtZoned(t.created_at, timezone)}</TableCell>
                  <TableCell className="text-xs">{t.payment_method || '-'}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={bucketColor[t.bucket]}>{t.bucket}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(t.total)}</TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}