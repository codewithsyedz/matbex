import { useEffect, useState, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, RefreshCcw, Check, X, MessageSquare, Activity } from "lucide-react";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";

interface AuditRow {
  id: string;
  created_at: string;
  action: string;
  entity_id: string | null;
  new_data: Record<string, unknown> | null;
}

function fmt(ts: string) {
  return new Date(ts).toLocaleString("en-GB", {
    timeZone: "Asia/Riyadh",
    hour12: false,
  });
}

/**
 * Admin-visible audit log for daily WhatsApp summary deliveries.
 * Reads from `audit_logs` (RLS already limits to tenant owners + superadmins)
 * filtered to entity_type = 'whatsapp_summary'.
 */
export function WhatsAppDeliveryAudit() {
  const { tenant, isOwner } = useAuth();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!tenant?.id) return;
    setLoading(true);
    const { data, error } = await db
      .from("audit_logs")
      .select("id, created_at, action, entity_id, new_data")
      .eq("tenant_id", tenant.id)
      .eq("entity_type", "whatsapp_summary")
      .order("created_at", { ascending: false })
      .limit(50);
    if (!error && data) setRows(data as AuditRow[]);
    setLoading(false);
  }, [tenant?.id]);

  useEffect(() => {
    load();
  }, [load]);

  if (!isOwner) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div>
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            WhatsApp delivery log
          </CardTitle>
          <CardDescription>
            Last 50 daily-summary attempts and Twilio status callbacks
            (queued / sent / delivered / read / failed).
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCcw className="h-4 w-4" />
          )}
        </Button>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No deliveries logged yet.
          </p>
        ) : (
          <ScrollArea className="max-h-[420px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">When (Riyadh)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Day</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Magic link</TableHead>
                  <TableHead>Redirect</TableHead>
                  <TableHead>Twilio SID / error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const d = (r.new_data ?? {}) as Record<string, unknown>;
                  const ok = d.ok === true;
                  const isStatus = r.action === "whatsapp_summary_status" || r.action === "whatsapp_summary_status_failed";
                  const magicOk = d.magic_link_generated === true;
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs font-mono">
                        {fmt(r.created_at)}
                      </TableCell>
                      <TableCell>
                        {isStatus ? (
                          <Badge
                            variant="outline"
                            className={
                              ok
                                ? "gap-1 text-blue-600 border-blue-200"
                                : "gap-1 text-destructive border-destructive/40"
                            }
                          >
                            <Activity className="h-3 w-3" />
                            {String(d.status ?? "status")}
                          </Badge>
                        ) : ok ? (
                          <Badge variant="outline" className="gap-1 text-emerald-600 border-emerald-200">
                            <Check className="h-3 w-3" /> Sent
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="gap-1">
                            <X className="h-3 w-3" /> Failed
                          </Badge>
                        )}
                        {d.test ? (
                          <Badge variant="secondary" className="ml-1">test</Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-xs font-mono">{String(d.ymd ?? "-")}</TableCell>
                      <TableCell className="text-xs font-mono">{String(d.phone_masked ?? "-")}</TableCell>
                      <TableCell>
                        {isStatus ? (
                          <span className="text-xs text-muted-foreground">-</span>
                        ) : magicOk ? (
                          <Badge variant="outline" className="gap-1 text-emerald-600 border-emerald-200">
                            <Check className="h-3 w-3" /> generated
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1 text-muted-foreground">
                            fallback
                          </Badge>
                        )}
                        {d.magic_link_error ? (
                          <div className="text-[10px] text-muted-foreground mt-1 max-w-[160px] truncate" title={String(d.magic_link_error)}>
                            {String(d.magic_link_error)}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-xs font-mono max-w-[180px] truncate" title={String(d.redirect_target ?? "")}>
                        {String(d.redirect_target ?? (isStatus ? "(callback)" : "-"))}
                      </TableCell>
                      <TableCell className="text-xs font-mono max-w-[240px]">
                        {isStatus ? (
                          <div className="space-y-0.5">
                            <span className="truncate block" title={String(d.twilio_sid ?? "")}>
                              {String(d.twilio_sid ?? "-")}
                            </span>
                            {d.error_code || d.error_message ? (
                              <span className="text-[10px] text-destructive block truncate" title={`${d.error_code ?? ""} ${d.error_message ?? ""}`}>
                                {String(d.error_code ?? "")} {String(d.error_message ?? "")}
                              </span>
                            ) : null}
                          </div>
                        ) : ok ? (
                          <span className="truncate block" title={String(d.twilio_sid ?? "")}>
                            {String(d.twilio_sid ?? "-")}
                          </span>
                        ) : (
                          <span className="text-destructive truncate block" title={String(d.error ?? "")}>
                            {String(d.error ?? "unknown error")}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}