import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { db } from "@/integrations/db/client";
import { format } from "date-fns";

export interface DlqTraceRow {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  terminal_id: string | null;
  event_type: string;
  event_id: string | null;
  batch_id?: string | null;
  request_id?: string | null;
  http_status?: number | null;
  request_trace?: unknown;
  response_trace?: unknown;
  input_payload?: unknown;
  payload?: unknown;
  validation_errors?: unknown;
  last_attempt?: unknown;
  error_category?: string | null;
  error_code?: string | null;
  error_message: string;
  retry_count: number;
  max_retries?: number | null;
  retry_exhausted?: boolean | null;
  status: string;
  operator_approved?: boolean;
  approved_at?: string | null;
  retry_requested_at?: string | null;
  discard_reason?: string | null;
  created_at: string;
}

interface AttemptRow {
  id: string;
  attempt_number: number;
  kind: string;
  outcome: string;
  http_status: number | null;
  duration_ms: number | null;
  request_trace: unknown;
  response_trace: unknown;
  error_message: string | null;
  reason: string | null;
  attempted_at: string;
}

function Json({ value, tone }: { value: unknown; tone?: "error" }) {
  return (
    <pre
      className={`rounded border p-2 text-[11px] overflow-x-auto ${
        tone === "error" ? "bg-destructive/10" : "bg-muted/30"
      }`}
    >
      {JSON.stringify(value ?? {}, null, 2)}
    </pre>
  );
}

export function DlqItemTraceDialog({
  row,
  onOpenChange,
}: {
  row: DlqTraceRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: attempts = [], isLoading } = useQuery({
    queryKey: ["dlq-attempts", row?.id],
    enabled: !!row?.id,
    queryFn: async () => {
      const { data, error } = await (db as any)
        .from("failed_sync_attempts")
        .select("*")
        .eq("failed_sync_item_id", row!.id)
        .order("attempted_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AttemptRow[];
    },
  });

  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-base flex flex-wrap items-center gap-2">
            {row?.event_type}
            <span className="text-muted-foreground font-mono text-xs">{row?.event_id}</span>
            {row?.retry_exhausted && <Badge variant="destructive">Retries exhausted</Badge>}
          </DialogTitle>
        </DialogHeader>
        {row && (
          <ScrollArea className="max-h-[75vh]">
            <Tabs defaultValue="overview" className="pr-2">
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="request">Request</TabsTrigger>
                <TabsTrigger value="response">Response</TabsTrigger>
                <TabsTrigger value="payload">Payload</TabsTrigger>
                <TabsTrigger value="history">Attempts ({attempts.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-4">
                <div className="rounded border bg-muted/30 p-2 text-xs whitespace-pre-wrap break-words">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{row.error_category ?? "uncategorised"}</Badge>
                    {row.error_code && <span className="font-mono">{row.error_code}</span>}
                    {row.http_status != null && <Badge variant="secondary">HTTP {row.http_status}</Badge>}
                  </div>
                  <div className="mt-2">{row.error_message}</div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <Field label="Batch" value={row.batch_id ?? "—"} mono />
                  <Field label="Request id" value={row.request_id ?? "—"} mono />
                  <Field label="Retries" value={`${row.retry_count}${row.max_retries ? ` / ${row.max_retries}` : ""}`} />
                  <Field label="Status" value={row.status} />
                  <Field label="Branch" value={row.branch_id ?? "—"} mono />
                  <Field label="Terminal" value={row.terminal_id ?? "—"} mono />
                  <Field label="Operator approved" value={row.operator_approved ? "yes" : "no"} />
                  <Field label="Retry requested" value={row.retry_requested_at ?? "—"} />
                  <Field label="First failed" value={format(new Date(row.created_at), "PPpp")} />
                  <Field label="Discard reason" value={row.discard_reason ?? "—"} />
                </div>
                <section>
                  <div className="text-xs font-medium mb-1">Last attempt summary</div>
                  <Json value={row.last_attempt} />
                </section>
                {row.validation_errors != null && (
                  <section>
                    <div className="text-xs font-medium mb-1">Validation errors</div>
                    <Json value={row.validation_errors} tone="error" />
                  </section>
                )}
              </TabsContent>

              <TabsContent value="request">
                <div className="text-xs text-muted-foreground mb-1">
                  Exact HTTP call the terminal made (auth tokens are never captured).
                </div>
                <Json value={row.request_trace} />
              </TabsContent>

              <TabsContent value="response">
                <div className="text-xs text-muted-foreground mb-1">Raw edge-function response or transport error.</div>
                <Json value={row.response_trace} tone={row.http_status && row.http_status >= 400 ? "error" : undefined} />
              </TabsContent>

              <TabsContent value="payload">
                <div className="text-xs font-medium mb-1">Input payload</div>
                <Json value={row.input_payload ?? row.payload} />
              </TabsContent>

              <TabsContent value="history" className="space-y-3">
                {isLoading && <div className="text-xs text-muted-foreground">Loading attempts…</div>}
                {!isLoading && attempts.length === 0 && (
                  <div className="text-xs text-muted-foreground">No attempt history recorded for this item yet.</div>
                )}
                {attempts.map((a) => (
                  <div key={a.id} className="rounded border p-2 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge variant="outline">#{a.attempt_number}</Badge>
                      <Badge variant="secondary">{a.kind.replace(/_/g, " ")}</Badge>
                      <Badge variant={a.outcome === "failed" ? "destructive" : "outline"}>{a.outcome}</Badge>
                      {a.http_status != null && <span className="font-mono">HTTP {a.http_status}</span>}
                      {a.duration_ms != null && <span className="text-muted-foreground">{a.duration_ms} ms</span>}
                      <span className="text-muted-foreground ml-auto">
                        {format(new Date(a.attempted_at), "PPpp")}
                      </span>
                    </div>
                    {a.error_message && <div className="text-xs break-words">{a.error_message}</div>}
                    {a.reason && <div className="text-xs text-muted-foreground">Operator note: {a.reason}</div>}
                    {(a.request_trace || a.response_trace) && (
                      <div className="grid md:grid-cols-2 gap-2">
                        <div>
                          <div className="text-[11px] text-muted-foreground mb-1">Request</div>
                          <Json value={a.request_trace} />
                        </div>
                        <div>
                          <div className="text-[11px] text-muted-foreground mb-1">Response</div>
                          <Json value={a.response_trace} />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </TabsContent>
            </Tabs>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}:</span>{" "}
      <span className={mono ? "font-mono text-[11px] break-all" : ""}>{value}</span>
    </div>
  );
}