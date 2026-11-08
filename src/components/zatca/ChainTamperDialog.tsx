import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ShieldAlert, AlertTriangle, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { useZatcaChainBreakDetail, type ChainBreakDetail } from "@/hooks/useZatcaCompliance";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

function HashRow({ label, value, tone }: { label: string; value: string; tone?: "ok" | "bad" }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 items-start">
      <span className="text-xs text-muted-foreground pt-0.5">{label}</span>
      <code
        className={`text-[11px] font-mono break-all rounded px-2 py-1 ${
          tone === "bad"
            ? "bg-destructive/10 text-destructive"
            : tone === "ok"
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "bg-muted"
        }`}
      >
        {value || "-"}
      </code>
    </div>
  );
}

/**
 * Computes a flat key→{prev,current} diff between two JSON objects.
 * Returns only keys whose stringified value differs or are added/removed.
 */
function diffJson(prev: unknown, current: unknown): Array<{ key: string; before: string; after: string }> {
  const a = (prev && typeof prev === "object" ? (prev as Record<string, unknown>) : {}) as Record<string, unknown>;
  const b = (current && typeof current === "object" ? (current as Record<string, unknown>) : {}) as Record<string, unknown>;
  const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).sort();
  const out: Array<{ key: string; before: string; after: string }> = [];
  for (const k of keys) {
    const av = JSON.stringify(a[k] ?? null);
    const bv = JSON.stringify(b[k] ?? null);
    if (av !== bv) out.push({ key: k, before: av, after: bv });
  }
  return out;
}

function DetailBody({ d }: { d: ChainBreakDetail }) {
  const diff = useMemo(() => diffJson(d.prevPayload, d.payload), [d.prevPayload, d.payload]);
  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 flex gap-2">
        <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-destructive">{d.reason}</p>
          <p className="text-xs text-muted-foreground">
            Sequence #{d.brokenSeq} · {d.entityType} · {d.action}
            {d.createdAt && ` · ${format(new Date(d.createdAt), "PPpp")}`}
          </p>
        </div>
      </div>

      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Hash mismatch
        </h3>
        <div className="space-y-2 rounded-lg border p-3">
          <HashRow label="Expected hash" value={d.expectedHash} tone="ok" />
          <HashRow label="Stored hash" value={d.storedHash} tone="bad" />
          <Separator />
          <HashRow label="Expected prev" value={d.expectedPrevHash} tone="ok" />
          <HashRow label="Stored prev" value={d.storedPrevHash} tone={d.storedPrevHash === d.expectedPrevHash ? "ok" : "bad"} />
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Payload diff vs previous row
          </h3>
          <Badge variant="outline" className="text-[10px]">
            {diff.length} changed field{diff.length === 1 ? "" : "s"}
          </Badge>
        </div>
        {diff.length === 0 ? (
          <div className="rounded-lg border p-3 text-xs text-muted-foreground">
            No structural difference between this payload and the previous row.
            Tampering likely altered values or whitespace inside the canonical form.
          </div>
        ) : (
          <div className="rounded-lg border divide-y">
            {diff.map((row) => (
              <div key={row.key} className="grid grid-cols-[140px_1fr] gap-3 p-2.5 text-xs">
                <span className="font-mono text-muted-foreground">{row.key}</span>
                <div className="space-y-1 min-w-0">
                  <div className="rounded bg-destructive/10 text-destructive px-2 py-1 font-mono text-[11px] break-all">
                    − {row.before}
                  </div>
                  <div className="rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-2 py-1 font-mono text-[11px] break-all">
                    + {row.after}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Tampered row payload
        </h3>
        <pre className="rounded-lg border bg-muted/40 p-3 text-[11px] font-mono overflow-x-auto whitespace-pre-wrap break-all">
          {JSON.stringify(d.payload, null, 2)}
        </pre>
      </section>
    </div>
  );
}

export function ChainTamperDialog({ open, onOpenChange }: Props) {
  const { data, isLoading, error } = useZatcaChainBreakDetail(open);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-destructive" />
            Audit chain tampering detected
          </DialogTitle>
          <DialogDescription>
            The first row whose stored SHA-256 hash no longer matches its sealed payload.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh] pr-3">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Re-walking chain…
            </div>
          ) : error ? (
            <p className="text-sm text-destructive py-4">
              Failed to load tamper details: {(error as Error).message}
            </p>
          ) : !data ? (
            <p className="text-sm text-muted-foreground py-4">
              Chain re-verified clean - no tampered row found.
            </p>
          ) : (
            <DetailBody d={data} />
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}