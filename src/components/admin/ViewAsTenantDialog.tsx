import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SUPPORT_ACCESS_KEY, callAdminSupport } from "@/lib/admin/supportAccess";
import { useSuperAdmin } from "@/contexts/SuperAdminContext";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * "View as Tenant" asks why (or takes the help request it is for), records it in the business's
 * support access log (owners see it under Settings → Security), then opens the business's view.
 */
export function ViewAsTenantDialog({ tenant, requestId, defaultReason, open, onOpenChange }: {
  tenant: { id: string; name: string } | null;
  requestId?: string;
  defaultReason?: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const navigate = useNavigate();
  const { startImpersonation } = useSuperAdmin();
  const [reason, setReason] = useState("");
  useEffect(() => { if (open) setReason(defaultReason ?? ""); }, [open, defaultReason]);

  const go = useMutation({
    mutationFn: async () => {
      const r = await callAdminSupport<{ access_id: string }>({ action: "start_access", tenant_id: tenant!.id, reason: reason.trim(), ...(requestId ? { request_id: requestId } : {}) });
      try { sessionStorage.setItem(SUPPORT_ACCESS_KEY, r.access_id); } catch { /* storage blocked */ }
      await startImpersonation(tenant!.id);
    },
    onSuccess: () => { onOpenChange(false); navigate("/dashboard"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>View as {tenant?.name}</DialogTitle>
          <DialogDescription>
            You will see the app as this business sees it. The visit and its reason are recorded, and the business's owners can see
            them under Settings → Security.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="va-reason">Reason</Label>
          <Textarea id="va-reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Checking why the receipt printer settings are not saving (request #1004)" />
        </div>
        <DialogFooter>
          <Button onClick={() => go.mutate()} disabled={!tenant || reason.trim().length < 3 || go.isPending}>
            {go.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Eye className="h-4 w-4 mr-1" />}View as business
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
