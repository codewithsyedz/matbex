import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Loader2, Unlock, ShieldCheck, XCircle, Clock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DeviceRow {
  id: string;
  terminal_id: string;
  device_label: string | null;
  platform: string | null;
  tenant_id: string;
}

interface UnlockRow {
  id: string;
  terminal_id: string;
  status: string;
  reason: string | null;
  created_at: string;
  expires_at: string;
  acknowledged_at: string | null;
}

interface Props {
  restaurantId?: string;
  canManage: boolean;
}

export function KioskRemoteUnlockPanel({ restaurantId, canManage }: Props) {
  const [target, setTarget] = useState<DeviceRow | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const devicesQuery = useQuery({
    queryKey: ["kiosk-unlock-devices", restaurantId],
    enabled: !!restaurantId,
    queryFn: async (): Promise<DeviceRow[]> => {
      const { data, error } = await supabase
        .from("device_licenses" as never)
        .select("id, terminal_id, device_label, platform, tenant_id")
        .eq("restaurant_id", restaurantId!)
        .is("revoked_at", null)
        .order("last_seen_at", { ascending: false });
      if (error) throw error;
      return (data as unknown as DeviceRow[]) ?? [];
    },
  });

  const requestsQuery = useQuery({
    queryKey: ["kiosk-unlock-requests", restaurantId],
    enabled: !!restaurantId,
    refetchInterval: 15_000,
    queryFn: async (): Promise<UnlockRow[]> => {
      const { data, error } = await supabase
        .from("kiosk_unlock_requests" as never)
        .select("id, terminal_id, status, reason, created_at, expires_at, acknowledged_at")
        .eq("restaurant_id", restaurantId!)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data as unknown as UnlockRow[]) ?? [];
    },
  });

  const requests = requestsQuery.data ?? [];
  const pendingByTerminal = new Map(
    requests.filter((r) => r.status === "pending").map((r) => [r.terminal_id, r]),
  );

  const submit = async () => {
    if (!target || !restaurantId) return;
    setSaving(true);
    const { data: userRes } = await supabase.auth.getUser();
    const { error } = await supabase.from("kiosk_unlock_requests" as never).insert({
      tenant_id: target.tenant_id,
      restaurant_id: restaurantId,
      terminal_id: target.terminal_id,
      device_license_id: target.id,
      reason: reason.trim() || null,
      requested_by_user_id: userRes?.user?.id ?? null,
    } as never);
    setSaving(false);
    if (error) {
      toast.error(
        error.code === "23505"
          ? "An unlock request is already pending for this terminal"
          : error.message,
      );
      return;
    }
    toast.success("Unlock sent — the terminal exits kiosk mode within ~20 seconds");
    setTarget(null);
    setReason("");
    requestsQuery.refetch();
  };

  const cancel = async (id: string) => {
    const { error } = await supabase
      .from("kiosk_unlock_requests" as never)
      .update({ status: "cancelled" } as never)
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Unlock request cancelled");
    requestsQuery.refetch();
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Unlock className="h-4 w-4" />
            Remote kiosk exit
          </CardTitle>
          <CardDescription>
            Release an Android terminal from kiosk (lock task) mode without touching the
            device. The terminal picks up the request within about 20 seconds while online,
            and requests expire after 15 minutes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {devicesQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading terminals…
            </div>
          ) : (devicesQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No active terminals paired.</p>
          ) : (
            <div className="space-y-2">
              {(devicesQuery.data ?? []).map((d) => {
                const pending = pendingByTerminal.get(d.terminal_id);
                return (
                  <div
                    key={d.id}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {d.device_label || d.terminal_id.slice(0, 8)}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {d.platform || "unknown platform"} · {d.terminal_id.slice(0, 12)}…
                      </p>
                    </div>
                    {pending ? (
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="gap-1">
                          <Clock className="h-3 w-3" /> Unlock pending
                        </Badge>
                        <Button size="sm" variant="ghost" onClick={() => cancel(pending.id)}>
                          <XCircle className="mr-1 h-4 w-4" /> Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canManage}
                        onClick={() => {
                          setTarget(d);
                          setReason("");
                        }}
                      >
                        <Unlock className="mr-1 h-4 w-4" /> Exit kiosk
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {requests.length > 0 && (
            <div className="space-y-1 pt-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Recent unlock activity
              </p>
              {requests.slice(0, 6).map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-muted-foreground">
                    {r.terminal_id.slice(0, 8)}… ·{" "}
                    {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                    {r.reason ? ` · ${r.reason}` : ""}
                  </span>
                  <Badge
                    variant={r.status === "acknowledged" ? "default" : "outline"}
                    className="gap-1"
                  >
                    {r.status === "acknowledged" && <ShieldCheck className="h-3 w-3" />}
                    {r.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Exit kiosk mode remotely</DialogTitle>
            <DialogDescription>
              {target?.device_label || target?.terminal_id} will leave kiosk lock the next time
              it checks in. Staff will then be able to exit the Matbex app on that device.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Reason (optional) — e.g. software update, maintenance"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send unlock
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}