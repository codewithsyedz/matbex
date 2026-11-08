// =====================================================================
// Offline Audit Report page
// ---------------------------------------------------------------------
// Summarises every offline POS event, sync outcome, and reconciliation
// total grouped by business day and shift. Reads only from local
// IndexedDB so it works fully offline. CSV export included.
// =====================================================================

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { RefreshCw, Download, FileBarChart, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";
import { buildAuditReport, reportToCsv, type AuditReport, type ShiftSummary } from "@/lib/offline/auditReport";
import { ensureOfflineBootstrapped } from "@/lib/offline/lazyBootstrap";
import { toast } from "sonner";

function StatusBadges({ s }: { s: ShiftSummary }) {
  return (
    <div className="flex flex-wrap gap-1">
      {s.synced > 0 && <Badge variant="secondary">{s.synced} synced</Badge>}
      {s.pending > 0 && <Badge variant="outline">{s.pending} pending</Badge>}
      {s.syncing > 0 && <Badge variant="outline">{s.syncing} syncing</Badge>}
      {s.failed > 0 && (
        <Badge variant="destructive" className="gap-1">
          <AlertTriangle className="h-3 w-3" /> {s.failed} failed
        </Badge>
      )}
    </div>
  );
}

export default function OfflineAuditReport() {
  const { format: formatAmount } = useCurrency();
  const [report, setReport] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await buildAuditReport();
      setReport(r);
    } catch (err) {
      toast.error("Failed to build audit report", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Boot the offline layer (IDB stores must exist before we read them).
    void ensureOfflineBootstrapped(null);
    void refresh();
  }, []);

  const grand = useMemo(() => {
    if (!report) return null;
    return report.days.reduce(
      (acc, d) => {
        acc.gross += d.totals.gross_sales;
        acc.collected += d.totals.payments_collected;
        acc.failed += d.totals.failed;
        acc.synced += d.totals.synced;
        acc.pending += d.totals.pending + d.totals.syncing;
        return acc;
      },
      { gross: 0, collected: 0, failed: 0, synced: 0, pending: 0 },
    );
  }, [report]);

  const downloadCsv = () => {
    if (!report) return;
    const csv = reportToCsv(report);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `offline-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="space-y-6 p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
              <FileBarChart className="h-6 w-6 text-primary" />
              Offline Audit Report
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Per-shift summary of offline events, sync outcomes, and reconciliation totals
              from this device.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={downloadCsv} disabled={!report || report.days.length === 0}>
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </div>

        {/* Top-level KPIs */}
        {grand && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base font-medium text-muted-foreground">Gross sales</CardTitle></CardHeader>
              <CardContent className="text-xl font-light">{formatAmount(grand.gross)}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base font-medium text-muted-foreground">Collected</CardTitle></CardHeader>
              <CardContent className="text-xl font-light">{formatAmount(grand.collected)}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base font-medium text-muted-foreground">Synced events</CardTitle></CardHeader>
              <CardContent className="text-xl font-light flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />{grand.synced}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base font-medium text-muted-foreground">In queue</CardTitle></CardHeader>
              <CardContent className="text-xl font-light">{grand.pending}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base font-medium text-muted-foreground">Failed</CardTitle></CardHeader>
              <CardContent className={`text-xl font-light ${grand.failed > 0 ? "text-destructive" : ""}`}>
                {grand.failed}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Per-day / per-shift breakdown */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Breakdown by day &amp; shift</CardTitle>
          </CardHeader>
          <CardContent>
            {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {!loading && report && report.days.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No offline events on this device yet.
              </p>
            )}
            {!loading && report && report.days.length > 0 && (
              <ScrollArea className="max-h-[60vh]">
                <div className="space-y-6">
                  {report.days.map((day) => (
                    <div key={day.business_date} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-medium">{day.business_date}</h3>
                        <div className="text-xs text-muted-foreground">
                          {day.totals.orders} orders · gross {formatAmount(day.totals.gross_sales)} ·
                          collected {formatAmount(day.totals.payments_collected)} ·
                          variance{" "}
                          <span className={day.totals.variance < 0 ? "text-destructive" : ""}>
                            {formatAmount(day.totals.variance)}
                          </span>
                        </div>
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Shift</TableHead>
                            <TableHead className="text-right">Orders</TableHead>
                            <TableHead className="text-right">Payments</TableHead>
                            <TableHead className="text-right">Cash in / out</TableHead>
                            <TableHead className="text-right">Gross</TableHead>
                            <TableHead className="text-right">Collected</TableHead>
                            <TableHead className="text-right">Variance</TableHead>
                            <TableHead>Sync</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {day.shifts.map((s) => (
                            <TableRow key={s.shift_id}>
                              <TableCell className="font-mono text-xs">
                                {s.shift_id === "unassigned" ? (
                                  <span className="text-muted-foreground">unassigned</span>
                                ) : (
                                  s.shift_id.slice(0, 8)
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                {s.orders}
                                {s.unpaid_orders > 0 && (
                                  <span className="text-xs text-muted-foreground ml-1">
                                    ({s.unpaid_orders} unpaid)
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="text-right">{s.payments}</TableCell>
                              <TableCell className="text-right text-xs">
                                {formatAmount(s.cash_in)} / {formatAmount(s.cash_out)}
                              </TableCell>
                              <TableCell className="text-right">{formatAmount(s.gross_sales)}</TableCell>
                              <TableCell className="text-right">{formatAmount(s.payments_collected)}</TableCell>
                              <TableCell className={`text-right ${s.variance < 0 ? "text-destructive" : ""}`}>
                                {formatAmount(s.variance)}
                              </TableCell>
                              <TableCell><StatusBadges s={s} /></TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        {report && (
          <p className="text-xs text-muted-foreground">
            Generated {new Date(report.generated_at).toLocaleString()} ·
            {" "}{report.total_records} local records · queue depth {report.queue_depth}
            {report.failed_queue_items > 0 && ` · ${report.failed_queue_items} dead-letter`}
          </p>
        )}
      </motion.div>
    </>
  );
}