import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Download, FileArchive, Loader2, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface ExportRow { id: string; status: "queued" | "building" | "ready" | "failed" | "expired"; file_size: number | null; requested_at: string; completed_at: string | null; expires_at: string | null; error: string | null }
interface ClosureRow { id: string; status: "pending" | "cancelled" | "completed"; requested_at: string; scheduled_for: string; completed_at: string | null; summary: { erased?: Record<string, number>; kept_for_legal_retention?: { what: string; until: string } } | null }

async function call<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.functions.invoke(fn, { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const msg = ctx && typeof ctx.json === "function" ? await ctx.json().then((b: { error?: string }) => b?.error).catch(() => null) : null;
    throw new Error(msg || error.message);
  }
  return data as T;
}

const STATUS: Record<ExportRow["status"], string> = { queued: "Queued", building: "Preparing", ready: "Ready", failed: "Failed", expired: "Expired" };

/** Owners: download all of the business's data, or close the account and have its data deleted. */
export function DataPrivacyCard() {
  const { tenant, hasRole } = useAuth();
  const qc = useQueryClient();
  const isOwner = hasRole("owner");
  const [closeOpen, setCloseOpen] = useState(false);

  const exports = useQuery({
    queryKey: ["data-exports", tenant?.id],
    enabled: !!tenant?.id && isOwner,
    refetchInterval: (q) => ((q.state.data as ExportRow[] | undefined)?.some((e) => e.status === "queued" || e.status === "building") ? 5000 : false),
    queryFn: async () => {
      const { data, error } = await db.from("data_exports").select("id, status, file_size, requested_at, completed_at, expires_at, error")
        .eq("tenant_id", tenant!.id).order("requested_at", { ascending: false }).limit(5);
      if (error) throw error;
      return (data ?? []) as ExportRow[];
    },
  });
  const closure = useQuery({
    queryKey: ["closure-request", tenant?.id],
    enabled: !!tenant?.id && isOwner,
    queryFn: async () => {
      const { data, error } = await db.from("tenant_deletion_requests").select("id, status, requested_at, scheduled_for, completed_at, summary")
        .eq("tenant_id", tenant!.id).order("requested_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data as ClosureRow | null;
    },
  });

  const request = useMutation({
    mutationFn: () => call("tenant-data-export", { action: "request" }),
    onSuccess: () => { toast.success("Preparing your export. We'll email you when it's ready."); void qc.invalidateQueries({ queryKey: ["data-exports"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const download = useMutation({
    mutationFn: (id: string) => call<{ url: string }>("tenant-data-export", { action: "download", export_id: id }),
    onSuccess: (r) => { window.location.href = r.url; },
    onError: (e: Error) => toast.error(e.message),
  });
  const cancel = useMutation({
    mutationFn: () => call("account-closure", { action: "cancel" }),
    onSuccess: () => { toast.success("Closure request cancelled"); void qc.invalidateQueries({ queryKey: ["closure-request"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isOwner) return null;
  const busy = exports.data?.some((e) => e.status === "queued" || e.status === "building");
  const c = closure.data;

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-medium"><FileArchive className="h-4 w-4" />Your data</CardTitle>
        <CardDescription>Download everything Matbex holds for your business, or close your account and have your data deleted.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="text-sm">
              <p className="font-medium">Full data export</p>
              <p className="text-muted-foreground">A zip of CSV files: sales, invoices, ledger and VAT, menu, customers, stock and team. Kept for 7 days.</p>
            </div>
            <Button size="sm" onClick={() => request.mutate()} disabled={request.isPending || busy}>
              {request.isPending || busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
              {busy ? "Preparing…" : "Export all data"}
            </Button>
          </div>
          {!!exports.data?.length && (
            <ul className="divide-y rounded-md border text-sm">
              {exports.data.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span>
                    {format(new Date(e.requested_at), "d MMM yyyy, HH:mm")}
                    {e.file_size ? <span className="text-muted-foreground"> · {(e.file_size / 1_048_576).toFixed(1)} MB</span> : null}
                    {e.status === "ready" && e.expires_at ? <span className="text-muted-foreground"> · until {format(new Date(e.expires_at), "d MMM")}</span> : null}
                    {e.status === "failed" && e.error ? <span className="block text-xs text-destructive">{e.error}</span> : null}
                  </span>
                  {e.status === "ready" ? (
                    <Button size="sm" variant="outline" onClick={() => download.mutate(e.id)} disabled={download.isPending}><Download className="h-4 w-4 mr-1" />Download</Button>
                  ) : <Badge variant={e.status === "failed" ? "destructive" : "secondary"}>{STATUS[e.status]}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2 border-t pt-4">
          <p className="flex items-center gap-1.5 text-sm font-medium"><ShieldAlert className="h-4 w-4" />Close account and delete data</p>
          {c?.status === "pending" ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <span>Closure requested on {format(new Date(c.requested_at), "d MMM yyyy")}. Personal data will be deleted from {format(new Date(c.scheduled_for), "d MMM yyyy")}. Until then you can change your mind.</span>
              <Button size="sm" variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending}>Keep my account</Button>
            </div>
          ) : c?.status === "completed" ? (
            <p className="text-sm text-muted-foreground">Personal data was deleted on {c.completed_at ? format(new Date(c.completed_at), "d MMM yyyy") : ""}.
              {c.summary?.kept_for_legal_retention ? ` Kept as required by ZATCA until ${c.summary.kept_for_legal_retention.until}: ${c.summary.kept_for_legal_retention.what}.` : ""}</p>
          ) : (
            <div className="flex flex-wrap items-start justify-between gap-2 text-sm">
              <p className="max-w-xl text-muted-foreground">
                After 30 days we delete the personal data of your customers, staff and users and disable all logins. Tax invoices and accounting
                records are kept for 6 years, as ZATCA requires. Export your data first if you want a copy.
              </p>
              <Button size="sm" variant="outline" className="border-destructive/50 text-destructive hover:bg-destructive/10" onClick={() => setCloseOpen(true)}>
                <Trash2 className="h-4 w-4 mr-1" />Close account
              </Button>
            </div>
          )}
        </section>
      </CardContent>
      <CloseDialog open={closeOpen} onOpenChange={setCloseOpen} businessName={tenant?.name ?? ""} onDone={() => void qc.invalidateQueries({ queryKey: ["closure-request"] })} />
    </Card>
  );
}

function CloseDialog({ open, onOpenChange, businessName, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; businessName: string; onDone: () => void }) {
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const go = useMutation({
    mutationFn: () => call("account-closure", { action: "request", confirm_name: name, reason }),
    onSuccess: () => { toast.success("Closure requested. You have 30 days to change your mind."); onOpenChange(false); setName(""); setReason(""); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Close account and delete data</DialogTitle>
          <DialogDescription>
            In 30 days the personal data of your customers, staff and users is deleted and all logins stop working. You can cancel until then.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="close-reason">Why are you leaving? (optional)</Label>
            <Textarea id="close-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="close-name">Type <b>{businessName}</b> to confirm</Label>
            <Input id="close-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="destructive" onClick={() => go.mutate()} disabled={name.trim().toLowerCase() !== businessName.trim().toLowerCase() || go.isPending}>
            {go.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Request closure
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
