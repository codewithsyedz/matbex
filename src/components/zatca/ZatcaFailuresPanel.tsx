import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertTriangle,
  ChevronDown,
  Clock,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Smartphone,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { useZatcaDevices } from "@/hooks/useZatcaDevices";

type FailedStatus = "REJECTED" | "SCHEMA_INVALID" | "PENDING";

interface FailedSale {
  id: string;
  receipt_number: string | null;
  created_at: string;
  total_amount: number;
  zatca_device_id: string | null;
  zatca_uuid: string | null;
  zatca_invoice_hash: string | null;
  zatca_signed_xml_url: string | null;
  zatca_clearance_status: FailedStatus | null;
  zatca_clearance_response: unknown;
}

interface ParsedError {
  code: string | null;
  message: string;
  validations: string[];
  raw: string;
}

const STALE_PENDING_MS = 5 * 60 * 1000;

function parseError(resp: unknown): ParsedError {
  if (!resp) {
    return { code: null, message: "No response captured", validations: [], raw: "" };
  }
  if (typeof resp === "string") {
    return { code: null, message: resp, validations: [], raw: resp };
  }
  const r = resp as Record<string, unknown>;
  const rawStr = (() => {
    try {
      return JSON.stringify(resp, null, 2);
    } catch {
      return String(resp);
    }
  })();
  const code =
    (r.errorCode as string | undefined) ??
    (r.code as string | undefined) ??
    (typeof r.status === "number" ? `HTTP ${r.status}` : null);
  const message =
    (r.error as string | undefined) ??
    (r.message as string | undefined) ??
    (r.detail as string | undefined) ??
    "Clearance call failed";
  const validations: string[] = [];
  const v = (r.validationResults as { errorMessages?: unknown[] } | undefined) ?? null;
  if (v?.errorMessages && Array.isArray(v.errorMessages)) {
    for (const e of v.errorMessages) {
      if (e && typeof e === "object") {
        const er = e as Record<string, unknown>;
        validations.push(
          `${(er.code as string) ?? "ERR"}: ${(er.message as string) ?? JSON.stringify(er)}`,
        );
      } else {
        validations.push(String(e));
      }
    }
  }
  if (Array.isArray(r.errors)) {
    for (const e of r.errors) validations.push(typeof e === "string" ? e : JSON.stringify(e));
  }
  return { code, message, validations, raw: rawStr };
}

export function ZatcaFailuresPanel() {
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? null;
  const { devices } = useZatcaDevices();
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);

  const { data: sales = [], isLoading, refetch } = useQuery({
    queryKey: ["zatca-failures", tenantId],
    enabled: !!tenantId,
    refetchInterval: 30_000,
    queryFn: async (): Promise<FailedSale[]> => {
      const { data, error } = await supabase
        .from("sales_transactions")
        .select(
          "id, receipt_number, created_at, total_amount, zatca_device_id, zatca_uuid, zatca_invoice_hash, zatca_signed_xml_url, zatca_clearance_status, zatca_clearance_response",
        )
        .not("zatca_uuid", "is", null)
        .in("zatca_clearance_status", ["REJECTED", "SCHEMA_INVALID", "PENDING"])
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const rows = (data ?? []) as unknown as FailedSale[];
      // Pending only counts as a "failure" if it's been stale for >5min.
      return rows.filter((r) => {
        if (r.zatca_clearance_status !== "PENDING") return true;
        return Date.now() - new Date(r.created_at).getTime() > STALE_PENDING_MS;
      });
    },
  });

  const counts = useMemo(() => {
    let rejected = 0,
      schema = 0,
      stalePending = 0;
    for (const s of sales) {
      if (s.zatca_clearance_status === "REJECTED") rejected++;
      else if (s.zatca_clearance_status === "SCHEMA_INVALID") schema++;
      else stalePending++;
    }
    return { rejected, schema, stalePending, total: sales.length };
  }, [sales]);

  const deviceName = (id: string | null) => {
    if (!id) return "No device";
    return devices.find((d) => d.id === id)?.name ?? `Device ${id.slice(0, 6)}`;
  };

  async function resign(saleId: string): Promise<boolean> {
    const { data: sale, error } = await supabase
      .from("sales_transactions")
      .select(
        "id, receipt_number, zatca_device_id, zatca_invoice_hash, zatca_signed_xml_url",
      )
      .eq("id", saleId)
      .maybeSingle();
    if (error || !sale) {
      toast.error("Could not load sale for re-signing");
      return false;
    }
    if (!sale.zatca_device_id) {
      toast.error("Sale has no device assigned - cannot re-sign");
      return false;
    }
    if (!sale.zatca_signed_xml_url) {
      toast.error("No UBL XML on file. Re-record the sale to regenerate.");
      return false;
    }
    // Fetch the previously generated UBL so we can re-stamp via signing fn.
    const xmlResp = await fetch(sale.zatca_signed_xml_url);
    if (!xmlResp.ok) {
      toast.error("Could not download UBL XML from storage");
      return false;
    }
    const xml = await xmlResp.text();
    const { error: signErr } = await supabase.functions.invoke("zatca-sign-invoice", {
      body: {
        device_id: sale.zatca_device_id,
        sales_transaction_id: sale.id,
        receipt_number: sale.receipt_number,
        xml,
        invoice_hash: sale.zatca_invoice_hash,
      },
    });
    if (signErr) {
      toast.error(`Signing failed: ${signErr.message}`);
      return false;
    }
    return true;
  }

  async function submit(saleId: string): Promise<boolean> {
    const { error } = await supabase.functions.invoke("zatca-submit-clearance", {
      body: { sales_transaction_id: saleId },
    });
    if (error) {
      toast.error(`Resubmit failed: ${error.message}`);
      return false;
    }
    return true;
  }

  async function onRetry(sale: FailedSale, withResign: boolean) {
    setBusyId(sale.id);
    try {
      if (withResign) {
        const ok = await resign(sale.id);
        if (!ok) return;
      }
      const ok = await submit(sale.id);
      if (ok) {
        toast.success(
          `${withResign ? "Re-signed & resubmitted" : "Resubmitted"} ${sale.receipt_number ?? sale.id.slice(0, 6)}`,
        );
        qc.invalidateQueries({ queryKey: ["zatca-failures", tenantId] });
        qc.invalidateQueries({ queryKey: ["zatca-clearance-status", tenantId] });
        qc.invalidateQueries({ queryKey: ["zatca-compliance"] });
      }
    } finally {
      setBusyId(null);
    }
  }

  async function onBulkRetry() {
    if (!sales.length) return;
    setBulkRunning(true);
    let success = 0;
    let fail = 0;
    try {
      for (const s of sales) {
        const withResign = s.zatca_clearance_status === "SCHEMA_INVALID";
        const ok = withResign ? await resign(s.id) : true;
        if (!ok) {
          fail++;
          continue;
        }
        const submitted = await submit(s.id);
        submitted ? success++ : fail++;
      }
      toast.success(`Bulk retry complete - ${success} ok, ${fail} failed`);
      qc.invalidateQueries({ queryKey: ["zatca-failures", tenantId] });
      qc.invalidateQueries({ queryKey: ["zatca-clearance-status", tenantId] });
      qc.invalidateQueries({ queryKey: ["zatca-compliance"] });
    } finally {
      setBulkRunning(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
        <div>
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-destructive" />
            Failed clearances
          </CardTitle>
          <CardDescription>
            Rejected, schema-invalid, and stale pending invoices. Retry submits the existing
            signed UBL; re-sign rebuilds the cryptographic stamp first.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-2 hidden sm:inline">Refresh</span>
          </Button>
          <Button
            size="sm"
            onClick={onBulkRetry}
            disabled={bulkRunning || sales.length === 0}
          >
            {bulkRunning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-2">Retry all ({counts.total})</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Rejected" value={counts.rejected} tone="text-destructive" />
          <Stat label="Schema invalid" value={counts.schema} tone="text-destructive" />
          <Stat label="Stale pending" value={counts.stalePending} tone="text-amber-600" />
        </div>

        {sales.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No failed clearances. All ZATCA-stamped sales are healthy.
          </p>
        ) : (
          <ScrollArea className="max-h-[600px] pr-2">
            <div className="space-y-2">
              {sales.map((s) => (
                <FailureRow
                  key={s.id}
                  sale={s}
                  busy={busyId === s.id}
                  deviceName={deviceName(s.zatca_device_id)}
                  onRetry={() => onRetry(s, false)}
                  onResign={() => onRetry(s, true)}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-light ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

function FailureRow({
  sale,
  busy,
  deviceName,
  onRetry,
  onResign,
}: {
  sale: FailedSale;
  busy: boolean;
  deviceName: string;
  onRetry: () => void;
  onResign: () => void;
}) {
  const [open, setOpen] = useState(false);
  const err = parseError(sale.zatca_clearance_response);
  const status = sale.zatca_clearance_status ?? "PENDING";
  const statusBadge =
    status === "REJECTED"
      ? { label: "Rejected", variant: "destructive" as const, Icon: ShieldAlert }
      : status === "SCHEMA_INVALID"
        ? { label: "Schema invalid", variant: "destructive" as const, Icon: AlertTriangle }
        : { label: "Stale pending", variant: "outline" as const, Icon: Clock };
  const StatusIcon = statusBadge.Icon;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-md border bg-card overflow-hidden"
    >
      <div className="flex items-center gap-3 p-3">
        <StatusIcon className="h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-sm truncate">
              {sale.receipt_number ?? sale.id.slice(0, 8)}
            </span>
            <Badge variant={statusBadge.variant} className="h-5 text-[10px]">
              {statusBadge.label}
            </Badge>
            {err.code && (
              <Badge variant="outline" className="h-5 text-[10px] font-mono">
                {err.code}
              </Badge>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Smartphone className="h-3 w-3" />
              {deviceName}
            </span>
            <span>{new Date(sale.created_at).toLocaleString()}</span>
            <span>{Number(sale.total_amount ?? 0).toFixed(2)}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-destructive">{err.message}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            disabled={busy || !sale.zatca_signed_xml_url}
            title="Resubmit existing signed UBL"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            <span className="ml-1.5 hidden md:inline">Retry</span>
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={onResign}
            disabled={busy || !sale.zatca_signed_xml_url || !sale.zatca_device_id}
            title="Re-sign with device key, then resubmit"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wrench className="h-3.5 w-3.5" />
            )}
            <span className="ml-1.5 hidden md:inline">Re-sign</span>
          </Button>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ChevronDown
                className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
              />
            </Button>
          </CollapsibleTrigger>
        </div>
      </div>
      <CollapsibleContent>
        <div className="border-t bg-muted/30 p-3 space-y-2">
          {err.validations.length > 0 && (
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase mb-1">
                ZATCA validation errors
              </div>
              <ul className="space-y-1 text-xs">
                {err.validations.map((v, i) => (
                  <li
                    key={i}
                    className="rounded border-l-2 border-destructive/60 bg-background px-2 py-1 font-mono"
                  >
                    {v}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <div className="text-xs font-medium text-muted-foreground uppercase mb-1">
              Raw response
            </div>
            <pre className="max-h-64 overflow-auto rounded bg-background p-2 text-[11px] leading-snug font-mono whitespace-pre-wrap break-all">
              {err.raw || "(empty)"}
            </pre>
          </div>
          <div className="text-[10px] text-muted-foreground font-mono break-all">
            uuid: {sale.zatca_uuid ?? "-"} · hash: {sale.zatca_invoice_hash?.slice(0, 32) ?? "-"}…
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}