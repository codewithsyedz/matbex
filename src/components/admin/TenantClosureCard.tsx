import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/integrations/db/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Req {
  id: string; status: "pending" | "cancelled" | "completed"; requested_by_email: string | null; reason: string | null;
  requested_at: string; scheduled_for: string; cancelled_at: string | null; completed_at: string | null;
  summary: { erased?: Record<string, number>; kept_for_legal_retention?: { what: string; why: string; until: string } } | null;
}

/** SuperAdmin: the owner's account-closure request, and erasing the personal data after the grace period. */
export function TenantClosureCard({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const q = useQuery({
    queryKey: ["tenant-closure", tenantId],
    queryFn: async () => {
      const { data, error } = await db.from("tenant_deletion_requests").select("*").eq("tenant_id", tenantId).order("requested_at", { ascending: false }).limit(3);
      if (error) throw error;
      return (data ?? []) as Req[];
    },
  });
  const erase = useMutation({
    mutationFn: async (requestId: string) => {
      const { data, error } = await db.functions.invoke("admin-tenant-erasure", { body: { request_id: requestId, confirm_name: name } });
      if (error) {
        const ctx = (error as { context?: Response }).context;
        const msg = ctx && typeof ctx.json === "function" ? await ctx.json().then((b: { error?: string }) => b?.error).catch(() => null) : null;
        throw new Error(msg || error.message);
      }
      return data;
    },
    onSuccess: () => { toast.success("Personal data erased; the record is kept below"); setOpen(false); setName(""); void qc.invalidateQueries({ queryKey: ["tenant-closure", tenantId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const latest = q.data?.[0];
  if (!latest) return null;
  const due = new Date(latest.scheduled_for).getTime() <= Date.now();

  return (
    <Card className={latest.status === "pending" ? "border-destructive/40" : "border-border/40"}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-medium"><ShieldAlert className="h-4 w-4" />Account closure</CardTitle>
        <CardDescription>
          Requested by {latest.requested_by_email ?? "the owner"} on {format(new Date(latest.requested_at), "d MMM yyyy")}
          {latest.reason ? ` · “${latest.reason}”` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {latest.status === "pending" && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{due ? "The 30-day grace period has ended." : `Personal data can be erased from ${format(new Date(latest.scheduled_for), "d MMM yyyy")}.`}</span>
            <Button size="sm" variant="destructive" disabled={!due} onClick={() => setOpen(true)}>Erase personal data</Button>
          </div>
        )}
        {latest.status === "cancelled" && <p className="text-muted-foreground">Cancelled by the owner on {latest.cancelled_at ? format(new Date(latest.cancelled_at), "d MMM yyyy") : ""}.</p>}
        {latest.status === "completed" && latest.summary && (
          <div className="space-y-2">
            <p>Personal data erased on {latest.completed_at ? format(new Date(latest.completed_at), "d MMM yyyy, HH:mm") : ""}. The business is suspended.</p>
            <ul className="grid gap-x-6 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-3">
              {Object.entries(latest.summary.erased ?? {}).map(([k, n]) => <li key={k}>{k.replace(/_/g, " ")}: {n}</li>)}
            </ul>
            {latest.summary.kept_for_legal_retention && (
              <p className="text-xs text-muted-foreground">Kept until {latest.summary.kept_for_legal_retention.until}: {latest.summary.kept_for_legal_retention.what} ({latest.summary.kept_for_legal_retention.why}).</p>
            )}
          </div>
        )}
      </CardContent>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Erase personal data of {tenantName}?</DialogTitle>
            <DialogDescription>
              Customers, staff, riders, reservation guests, order and supplier contacts, chat and sessions are erased; every login of this
              business is disabled and the business is suspended. Tax records are kept. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="erase-name">Type <b>{tenantName}</b> to confirm</Label>
            <Input id="erase-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </div>
          <DialogFooter>
            <Button variant="destructive" onClick={() => erase.mutate(latest.id)} disabled={name.trim().toLowerCase() !== tenantName.trim().toLowerCase() || erase.isPending}>
              {erase.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Erase personal data
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
