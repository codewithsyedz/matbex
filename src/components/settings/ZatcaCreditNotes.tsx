import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { Undo2, ShieldCheck, ShieldAlert, Clock, AlertTriangle } from "lucide-react";

type Status = "PENDING" | "CLEARED" | "REPORTED" | "CLEARED_SIM" | "REJECTED" | "SCHEMA_INVALID";

interface Row {
  id: string;
  credit_note_number: string;
  uuid: string;
  original_uuid: string;
  total_refunded: number;
  vat_refunded: number;
  reason_code: string;
  reason_text: string | null;
  clearance_status: Status;
  clearance_response: unknown;
  schema_validation_errors: unknown;
  created_at: string;
}

function statusMeta(s: Status) {
  switch (s) {
    case "CLEARED":
    case "REPORTED":
      return { label: s, variant: "default" as const, icon: ShieldCheck, tone: "text-emerald-600" };
    case "CLEARED_SIM":
      return { label: "SIMULATED", variant: "secondary" as const, icon: ShieldCheck, tone: "text-amber-600" };
    case "REJECTED":
      return { label: "REJECTED", variant: "destructive" as const, icon: ShieldAlert, tone: "text-destructive" };
    case "SCHEMA_INVALID":
      return { label: "SCHEMA INVALID", variant: "destructive" as const, icon: AlertTriangle, tone: "text-destructive" };
    case "PENDING":
    default:
      return { label: "PENDING", variant: "outline" as const, icon: Clock, tone: "text-muted-foreground" };
  }
}

export function ZatcaCreditNotes() {
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? null;
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["zatca-credit-notes", tenantId],
    enabled: !!tenantId,
    refetchInterval: 30_000,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await db
        .from("zatca_credit_notes" as never)
        .select("id, credit_note_number, uuid, original_uuid, total_refunded, vat_refunded, reason_code, reason_text, clearance_status, clearance_response, schema_validation_errors, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Undo2 className="h-5 w-5" />
          Credit notes
        </CardTitle>
        <CardDescription>
          ZATCA-compliant refunds linked to original invoices. Auto-refreshes every 30s.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No credit notes yet. Issue one from the sale row in the Sales screen.
          </p>
        ) : (
          <ScrollArea className="max-h-[480px] pr-2">
            <div className="space-y-1.5">
              {rows.map((r) => {
                const meta = statusMeta(r.clearance_status);
                const Icon = meta.icon;
                const errors = Array.isArray(r.schema_validation_errors) ? r.schema_validation_errors : null;
                return (
                  <div
                    key={r.id}
                    className="flex items-start gap-3 px-3 py-2.5 rounded-md hover:bg-accent/30 cursor-pointer"
                    onClick={() => setOpenId(openId === r.id ? null : r.id)}
                  >
                    <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${meta.tone}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{r.credit_note_number}</span>
                        <Badge variant={meta.variant} className="text-[10px] py-0 h-5">{meta.label}</Badge>
                        <Badge variant="outline" className="text-[10px] py-0 h-5">{r.reason_code}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {new Date(r.created_at).toLocaleString()}
                        {" · "}
                        <span className="font-mono">{Number(r.total_refunded).toFixed(2)} ﷼</span>
                        {" · VAT "}
                        <span className="font-mono">{Number(r.vat_refunded).toFixed(2)}</span>
                      </div>
                      {openId === r.id && (
                        <div className="mt-2 space-y-1.5 text-xs">
                          <div className="font-mono text-muted-foreground">UUID: {r.uuid}</div>
                          <div className="font-mono text-muted-foreground">Original: {r.original_uuid}</div>
                          {r.reason_text && <div>Note: {r.reason_text}</div>}
                          {errors && errors.length > 0 && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="text-destructive cursor-help">
                                    {errors.length} schema error{errors.length === 1 ? "" : "s"}
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-md">
                                  <pre className="text-[11px] whitespace-pre-wrap break-all">
                                    {JSON.stringify(errors, null, 2)}
                                  </pre>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                          {r.clearance_response != null && (
                            <details>
                              <summary className="text-muted-foreground cursor-pointer">Response payload</summary>
                              <pre className="mt-1 text-[10px] bg-muted/50 p-2 rounded overflow-auto max-h-40">
                                {JSON.stringify(r.clearance_response, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}