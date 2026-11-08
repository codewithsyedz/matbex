import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Loader2, RefreshCw, ShieldCheck, ShieldAlert, Clock, Smartphone, ChevronRight, Undo2, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { useZatcaDevices } from "@/hooks/useZatcaDevices";
import { CreditNoteDialog } from "@/components/sales/CreditNoteDialog";

type Status = "PENDING" | "CLEARED" | "REPORTED" | "CLEARED_SIM" | "REJECTED" | "SCHEMA_INVALID" | null;

interface SaleRow {
  id: string;
  receipt_number: string | null;
  created_at: string;
  total_amount: number;
  zatca_device_id: string | null;
  zatca_clearance_status: Status;
  zatca_clearance_response: unknown;
  zatca_cleared_at: string | null;
  zatca_uuid: string | null;
  zatca_invoice_hash: string | null;
  zatca_signed_xml_url: string | null;
}

function statusMeta(status: Status): {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
  icon: typeof Clock;
  tone: string;
} {
  switch (status) {
    case "CLEARED":
    case "REPORTED":
      return { label: status, variant: "default", icon: ShieldCheck, tone: "text-emerald-600" };
    case "CLEARED_SIM":
      return { label: "SIMULATED", variant: "secondary", icon: ShieldCheck, tone: "text-amber-600" };
    case "REJECTED":
      return { label: "FAILED", variant: "destructive", icon: ShieldAlert, tone: "text-destructive" };
    case "SCHEMA_INVALID":
      return { label: "SCHEMA INVALID", variant: "destructive", icon: AlertTriangle, tone: "text-destructive" };
    case "PENDING":
    default:
      return { label: "PENDING", variant: "outline", icon: Clock, tone: "text-muted-foreground" };
  }
}

function extractError(resp: unknown): string | null {
  if (!resp || typeof resp !== "object") return null;
  const r = resp as Record<string, unknown>;
  return (r.error as string | undefined)
    ?? (r.message as string | undefined)
    ?? (Array.isArray(r.errors) && r.errors.length > 0 ? JSON.stringify(r.errors[0]) : null);
}

export function ZatcaClearanceStatus() {
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? null;
  const { devices } = useZatcaDevices();
  const qc = useQueryClient();
  const [retrying, setRetrying] = useState<string | null>(null);
  const [creditFor, setCreditFor] = useState<SaleRow | null>(null);

  const { data: rows = [], isLoading, refetch } = useQuery({
    queryKey: ["zatca-clearance-status", tenantId],
    enabled: !!tenantId,
    refetchInterval: 30_000,
    queryFn: async (): Promise<SaleRow[]> => {
      const { data, error } = await supabase
        .from("sales_transactions")
        .select(
          "id, receipt_number, created_at, total_amount, zatca_device_id, zatca_clearance_status, zatca_clearance_response, zatca_cleared_at, zatca_uuid, zatca_invoice_hash, zatca_signed_xml_url",
        )
        .not("zatca_uuid", "is", null)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as SaleRow[];
    },
  });

  const { data: queueDepth = 0 } = useQuery({
    queryKey: ["zatca-queue-depth", tenantId],
    enabled: !!tenantId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("zatca_clearance_queue" as never)
        .select("id", { count: "exact", head: true });
      if (error) return 0;
      return count ?? 0;
    },
  });

  const grouped = useMemo(() => {
    const m = new Map<string, SaleRow[]>();
    for (const r of rows) {
      const k = r.zatca_device_id ?? "_unassigned";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return m;
  }, [rows]);

  const counts = useMemo(() => {
    let pending = 0, ok = 0, failed = 0;
    for (const r of rows) {
      const s = r.zatca_clearance_status;
      if (s === "CLEARED" || s === "REPORTED" || s === "CLEARED_SIM") ok++;
      else if (s === "REJECTED") failed++;
      else pending++;
    }
    return { pending, ok, failed };
  }, [rows]);

  const onRetry = async (sale: SaleRow) => {
    if (!sale.zatca_signed_xml_url) {
      toast.error("No signed UBL - sale must be re-signed first");
      return;
    }
    setRetrying(sale.id);
    try {
      const { error } = await supabase.functions.invoke("zatca-submit-clearance", {
        body: { sales_transaction_id: sale.id },
      });
      if (error) throw error;
      toast.success(`Resubmitted ${sale.receipt_number ?? sale.id.slice(0, 6)}`);
      qc.invalidateQueries({ queryKey: ["zatca-clearance-status", tenantId] });
    } catch (e) {
      toast.error((e as Error).message ?? "Resubmission failed");
    } finally {
      setRetrying(null);
    }
  };

  const deviceName = (id: string) => {
    if (id === "_unassigned") return "No device assigned";
    return devices.find((d) => d.id === id)?.name ?? `Device ${id.slice(0, 6)}`;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
        <div>
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Clearance status
          </CardTitle>
          <CardDescription>
            Per-device submission state for the last 200 ZATCA-stamped sales. Auto-refreshes every 30s.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          <span className="ml-2 hidden sm:inline">Refresh</span>
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="Pending" value={counts.pending} icon={Clock} tone="text-muted-foreground" />
          <StatTile label="Cleared" value={counts.ok} icon={ShieldCheck} tone="text-emerald-600" />
          <StatTile label="Failed" value={counts.failed} icon={ShieldAlert} tone="text-destructive" />
        </div>
        {queueDepth > 0 && (
          <p className="text-xs text-muted-foreground text-center">
            Background retry queue: <span className="font-medium text-foreground">{queueDepth}</span> in flight - auto-retried with exponential backoff.
          </p>
        )}

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No ZATCA-stamped sales yet. Once a sale is recorded with an active device, it will appear here.
          </p>
        ) : (
          <Accordion type="multiple" className="w-full">
            {Array.from(grouped.entries()).map(([deviceId, sales]) => {
              const dPending = sales.filter((s) => !s.zatca_clearance_status || s.zatca_clearance_status === "PENDING").length;
              const dFailed = sales.filter((s) => s.zatca_clearance_status === "REJECTED").length;
              const dOk = sales.length - dPending - dFailed;
              return (
                <AccordionItem value={deviceId} key={deviceId}>
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-3 flex-1 min-w-0 pr-3">
                      <Smartphone className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="font-medium truncate">{deviceName(deviceId)}</span>
                      <div className="ml-auto flex items-center gap-2 text-xs">
                        {dOk > 0 && <Badge variant="default" className="bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15">{dOk} ok</Badge>}
                        {dPending > 0 && <Badge variant="outline">{dPending} pending</Badge>}
                        {dFailed > 0 && <Badge variant="destructive">{dFailed} failed</Badge>}
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <ScrollArea className="max-h-[480px] pr-2">
                      <div className="space-y-2">
                        {sales.map((s) => (
                          <SaleRowItem
                            key={s.id}
                            sale={s}
                            retrying={retrying === s.id}
                            onRetry={() => onRetry(s)}
                            onIssueCredit={() => setCreditFor(s)}
                          />
                        ))}
                      </div>
                    </ScrollArea>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        )}
      </CardContent>
      {creditFor && (
        <CreditNoteDialog
          open={!!creditFor}
          onOpenChange={(o) => { if (!o) setCreditFor(null); }}
          sale={{
            id: creditFor.id,
            receipt_number: creditFor.receipt_number,
            total_amount: creditFor.total_amount,
            zatca_uuid: creditFor.zatca_uuid,
          }}
        />
      )}
    </Card>
  );
}

function StatTile({
  label, value, icon: Icon, tone,
}: { label: string; value: number; icon: typeof Clock; tone: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className={`h-3.5 w-3.5 ${tone}`} />
        <span>{label}</span>
      </div>
      <div className={`mt-1 text-2xl font-light ${tone}`}>{value}</div>
    </div>
  );
}

function SaleRowItem({
  sale, retrying, onRetry, onIssueCredit,
}: { sale: SaleRow; retrying: boolean; onRetry: () => void; onIssueCredit: () => void }) {
  const meta = statusMeta(sale.zatca_clearance_status);
  const Icon = meta.icon;
  const err = extractError(sale.zatca_clearance_response);
  const canRetry = sale.zatca_clearance_status === "REJECTED"
    || !sale.zatca_clearance_status
    || sale.zatca_clearance_status === "PENDING";
  const canCredit = sale.zatca_clearance_status === "CLEARED"
    || sale.zatca_clearance_status === "REPORTED"
    || sale.zatca_clearance_status === "CLEARED_SIM";

  return (
    <div className="flex items-center gap-3 py-2 px-2 rounded-md hover:bg-accent/30 transition-colors text-sm">
      <Icon className={`h-4 w-4 shrink-0 ${meta.tone}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{sale.receipt_number ?? sale.id.slice(0, 8)}</span>
          <Badge variant={meta.variant} className="text-[10px] py-0 h-5">{meta.label}</Badge>
        </div>
        <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
          <span>{new Date(sale.created_at).toLocaleString()}</span>
          <ChevronRight className="h-3 w-3" />
          <span>{Number(sale.total_amount ?? 0).toFixed(2)}</span>
          {sale.zatca_uuid && (
            <>
              <ChevronRight className="h-3 w-3" />
              <span className="font-mono">{sale.zatca_uuid.slice(0, 8)}…</span>
            </>
          )}
        </div>
        {err && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <p className="text-xs text-destructive mt-1 line-clamp-1 cursor-help">{err}</p>
              </TooltipTrigger>
              <TooltipContent className="max-w-md">
                <pre className="text-[11px] whitespace-pre-wrap break-all">
                  {JSON.stringify(sale.zatca_clearance_response, null, 2)}
                </pre>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      {canRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          disabled={retrying || !sale.zatca_signed_xml_url}
        >
          {retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          <span className="ml-1.5 hidden sm:inline">Retry</span>
        </Button>
      )}
      {canCredit && (
        <Button variant="ghost" size="sm" onClick={onIssueCredit}>
          <Undo2 className="h-3.5 w-3.5" />
          <span className="ml-1.5 hidden sm:inline">Credit</span>
        </Button>
      )}
    </div>
  );
}