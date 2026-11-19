import { useMemo, useState } from "react";
import { Loader2, FlaskConical, Check, X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useWhatsAppSubscription } from "@/hooks/useWhatsAppSubscription";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// Build a UTC ISO from a Riyadh-local (UTC+3) input: "YYYY-MM-DDTHH:mm"
function riyadhLocalToUtcIso(local: string): string {
  return new Date(`${local}:00+03:00`).toISOString();
}

// Format an ISO UTC string in Riyadh local for display
function fmtRiyadh(iso: string): string {
  const d = new Date(iso);
  const shifted = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 16).replace("T", " ");
}

function todayRiyadhYmd(): string {
  const shifted = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

interface Row {
  label: string;
  localInput: string; // YYYY-MM-DDTHH:mm in Riyadh local
  expectedYmd: string; // the date we EXPECT the function to resolve to
}

interface ResultRow extends Row {
  loading: boolean;
  result?: {
    resolvedYmd: string;
    window: { startUTC: string; endExclusiveUTC: string };
    counts: { sales: number; expenses: number; shifts: number };
    atUtc: string;
  };
  error?: string;
}

export function RiyadhCutoffTester() {
  const { restaurant } = useAuth();
  const { cutoffCheck } = useWhatsAppSubscription();

  const today = todayRiyadhYmd();
  const tomorrow = (() => {
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  })();

  const defaults: Row[] = useMemo(
    () => [
      { label: "Mid-evening",   localInput: `${today}T20:00`,    expectedYmd: today },
      { label: "Summary send",  localInput: `${today}T23:00`,    expectedYmd: today },
      { label: "1 min before midnight", localInput: `${today}T23:59`, expectedYmd: today },
      { label: "1 min after midnight",  localInput: `${tomorrow}T00:01`, expectedYmd: tomorrow },
      { label: "Pre-dawn",      localInput: `${tomorrow}T03:00`, expectedYmd: tomorrow },
    ],
    [today, tomorrow],
  );

  const [rows, setRows] = useState<ResultRow[]>(
    defaults.map((r) => ({ ...r, loading: false })),
  );
  const [running, setRunning] = useState(false);

  const runOne = async (idx: number, row: ResultRow) => {
    if (!restaurant?.id) return;
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, loading: true, error: undefined } : r)));
    try {
      const atUtc = riyadhLocalToUtcIso(row.localInput);
      const { data, error } = await db.functions.invoke("send-daily-whatsapp-summary", {
        body: { restaurant_id: restaurant.id, cutoffCheck: true, atUtc },
      });
      if (error) throw error;
      setRows((prev) =>
        prev.map((r, i) => (i === idx ? { ...r, loading: false, result: data } : r)),
      );
    } catch (e: any) {
      setRows((prev) =>
        prev.map((r, i) => (i === idx ? { ...r, loading: false, error: e?.message ?? "Failed" } : r)),
      );
    }
  };

  const runAll = async () => {
    setRunning(true);
    await Promise.all(rows.map((r, i) => runOne(i, r)));
    setRunning(false);
    const failed = rows.filter((r) => r.result && r.result.resolvedYmd !== r.expectedYmd).length;
    if (failed === 0) toast.success("All cutoff cases match expectations");
    else toast.error(`${failed} case(s) did not match expected day`);
  };

  const addCustom = () => {
    setRows((prev) => [
      ...prev,
      {
        label: "Custom",
        localInput: `${today}T12:00`,
        expectedYmd: today,
        loading: false,
      },
    ]);
  };

  const updateRow = (idx: number, patch: Partial<Row>) => {
    setRows((prev) =>
      prev.map((r, i) =>
        i === idx ? { ...r, ...patch, result: undefined, error: undefined } : r,
      ),
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-primary/10 text-primary">
              <FlaskConical className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base font-medium">Riyadh day-cutoff tester</CardTitle>
              <CardDescription className="text-xs">
                Simulate UTC instants and confirm the WhatsApp pipeline resolves them to the correct
                Riyadh-local business day (Asia/Riyadh = UTC+3, no DST).
              </CardDescription>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={addCustom}>
              <Plus className="h-4 w-4 mr-2" />
              Add case
            </Button>
            <Button size="sm" onClick={runAll} disabled={running}>
              {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FlaskConical className="h-4 w-4 mr-2" />}
              Run all
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Case</TableHead>
              <TableHead>Riyadh local (input)</TableHead>
              <TableHead>Expected day</TableHead>
              <TableHead>Resolved day</TableHead>
              <TableHead className="text-right">Sales</TableHead>
              <TableHead className="text-right">Expenses</TableHead>
              <TableHead className="text-right">Shifts</TableHead>
              <TableHead className="text-right">Run</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, idx) => {
              const matches = row.result ? row.result.resolvedYmd === row.expectedYmd : null;
              return (
                <TableRow key={idx}>
                  <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                  <TableCell>
                    <Input
                      value={row.label}
                      onChange={(e) => updateRow(idx, { label: e.target.value })}
                      className="h-8 w-32"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="datetime-local"
                      value={row.localInput}
                      onChange={(e) => updateRow(idx, { localInput: e.target.value })}
                      className="h-8 w-48 font-mono text-xs"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="date"
                      value={row.expectedYmd}
                      onChange={(e) => updateRow(idx, { expectedYmd: e.target.value })}
                      className="h-8 w-36 font-mono text-xs"
                    />
                  </TableCell>
                  <TableCell>
                    {row.loading ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : row.error ? (
                      <span className="text-xs text-destructive">{row.error}</span>
                    ) : row.result ? (
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs">{row.result.resolvedYmd}</span>
                        {matches ? (
                          <Badge variant="secondary" className="text-success bg-success/10 border-success/30">
                            <Check className="h-3 w-3 mr-1" /> match
                          </Badge>
                        ) : (
                          <Badge variant="destructive">
                            <X className="h-3 w-3 mr-1" /> mismatch
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {row.result?.counts.sales ?? "-"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {row.result?.counts.expenses ?? "-"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {row.result?.counts.shifts ?? "-"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => runOne(idx, row)}
                      disabled={row.loading}
                    >
                      Run
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        <div className="mt-4 rounded-md bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">How it works</p>
          <p>
            Each row is sent to the WhatsApp summary edge function in <span className="font-mono">cutoffCheck</span> mode.
            The server converts the input to UTC, then runs the exact same <span className="font-mono">ymdRiyadh()</span>
            and <span className="font-mono">riyadhDayBoundsUTC()</span> helpers used by the nightly job, and reports the
            resolved day plus the row counts inside the resulting window.
          </p>
          <p>
            <span className="font-medium text-foreground">Expected behaviour:</span> 23:59 Riyadh resolves to today;
            00:01 Riyadh resolves to the next day. A mismatch indicates a timezone/DST bug in the pipeline.
          </p>
          {rows.some((r) => r.result) && (
            <p>
              Last UTC window for row #1: <span className="font-mono">{rows[0]?.result ? `${fmtRiyadh(rows[0].result.window.startUTC)} → ${fmtRiyadh(rows[0].result.window.endExclusiveUTC)}` : "-"}</span>
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}