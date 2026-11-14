import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Laptop, Loader2, ShieldOff, RefreshCw, Pencil, AlertTriangle, Info } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLicense } from "@/contexts/LicenseContext";
import { db } from "@/integrations/db/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { getTerminalId } from "@/lib/offline/terminal";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { LicenseDebugPanel } from "@/components/devices/LicenseDebugPanel";
import { RevokeDiagnosticsPanel } from "@/components/devices/RevokeDiagnosticsPanel";
import { KioskRemoteUnlockPanel } from "@/components/devices/KioskRemoteUnlockPanel";
import { KioskOfflinePinCard } from "@/components/devices/KioskOfflinePinCard";
import { WifiQrCard } from "@/components/devices/WifiQrCard";

interface DeviceRow {
  id: string;
  terminal_id: string;
  device_label: string | null;
  platform: string | null;
  user_agent: string | null;
  claimed_at: string;
  last_seen_at: string;
  last_validated_at: string | null;
}

export default function DeviceManagement() {
  const { restaurant, hasRole } = useAuth();
  const { revokeDevice, refresh } = useLicense();
  const restaurantId = restaurant?.id;
  const canManage = hasRole("owner") || hasRole("manager");
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [thisTerminal, setThisTerminal] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<DeviceRow | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [savingName, setSavingName] = useState(false);

  // Capture this device's terminal id once
  useEffect(() => {
    getTerminalId().then(setThisTerminal).catch(() => {});
  }, []);

  const devicesQuery = useQuery({
    queryKey: ["device-licenses", restaurantId],
    enabled: !!restaurantId,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<DeviceRow[]> => {
      const { data, error } = await db
        .from("device_licenses" as never)
        .select("id, terminal_id, device_label, platform, user_agent, claimed_at, last_seen_at, last_validated_at")
        .eq("restaurant_id", restaurantId!)
        .is("revoked_at", null)
        .order("last_seen_at", { ascending: false });
      if (error) throw error;
      return (data as unknown as DeviceRow[]) ?? [];
    },
  });

  const seatsQuery = useQuery({
    queryKey: ["branch-license-seats", restaurantId],
    enabled: !!restaurantId,
    queryFn: async () => {
      const { data, error } = await db
        .from("branch_license_seats" as never)
        .select("seat_count")
        .eq("restaurant_id", restaurantId!)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as { seat_count: number } | null) ?? { seat_count: 1 };
    },
  });

  const handleRevoke = async (id: string) => {
    if (!canManage) return;
    if (!confirm("Revoke this device? The terminal will be blocked until re-approved.")) return;
    setRevokingId(id);
    const res = await revokeDevice(id);
    setRevokingId(null);
    if (res.ok) {
      toast.success("Device revoked");
      devicesQuery.refetch();
      refresh();
    } else {
      toast.error(res.error || "Failed to revoke");
    }
  };

  const devices = devicesQuery.data ?? [];
  const cap = seatsQuery.data?.seat_count ?? 1;
  const used = devices.length;
  const remaining = Math.max(cap - used, 0);
  const overLimit = used > cap;

  // Heuristic duplicate detection: same user_agent appearing on multiple
  // active rows means the same physical device claimed more than one seat
  // (usually a legacy NULL-fingerprint row + a new fingerprinted row).
  const duplicateCount = (() => {
    const byUa = new Map<string, number>();
    for (const d of devices) {
      const ua = (d.user_agent ?? "").trim();
      if (!ua) continue;
      byUa.set(ua, (byUa.get(ua) ?? 0) + 1);
    }
    let extra = 0;
    byUa.forEach((n) => { if (n > 1) extra += n - 1; });
    return extra;
  })();

  // Auto-prompt: if THIS device was just claimed (no custom label, generic UA fallback)
  // open the rename dialog once so the user can name the terminal.
  useEffect(() => {
    if (!thisTerminal || devices.length === 0) return;
    const me = devices.find((d) => d.terminal_id === thisTerminal);
    if (!me) return;
    const key = `device-named-${me.id}`;
    if (localStorage.getItem(key)) return;
    const isGenericLabel = !me.device_label || me.device_label.length > 40;
    if (isGenericLabel) {
      setRenameTarget(me);
      setRenameValue("");
      localStorage.setItem(key, "1");
    }
  }, [thisTerminal, devices]);

  const handleSaveName = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    setSavingName(true);
    const { error } = await db
      .from("device_licenses" as never)
      .update(({ device_label: renameValue.trim() }) as never)
      .eq("id", renameTarget.id);
    setSavingName(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Device named");
    setRenameTarget(null);
    devicesQuery.refetch();
  };

  return (
    <>
      <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
        <div className="flex items-end justify-between gap-4 flex-wrap min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">Licensed Devices</h1>
            <p className="text-sm text-muted-foreground mt-1">
              POS terminals bound to this branch. Each seat = one physical device.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => devicesQuery.refetch()}
            disabled={devicesQuery.isFetching}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${devicesQuery.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {overLimit && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Over your plan's device limit</AlertTitle>
            <AlertDescription>
              You have {used} active devices but your current plan allows only {cap} per branch.
              Revoke {used - cap} device{used - cap === 1 ? "" : "s"} or upgrade your plan to stay compliant.
            </AlertDescription>
          </Alert>
        )}

        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Devices are deduplicated automatically</AlertTitle>
          <AlertDescription>
            Each physical terminal is identified by a stable device fingerprint,
            so reopening Matbex, clearing storage, or switching browsers will
            <span className="font-medium"> reuse the same seat</span> instead of
            adding a new one. This list refreshes every 30&nbsp;seconds.
            {duplicateCount > 0 && (
              <span className="block mt-2 text-foreground">
                We detected {duplicateCount} possible duplicate
                {duplicateCount === 1 ? "" : "s"} (legacy rows from before
                fingerprinting). They will merge on the next sign-in from that
                device, or you can revoke the older entry below.
              </span>
            )}
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Seats used</CardDescription>
              <CardTitle className="text-base font-medium">
                {used}
                <span className="text-base text-muted-foreground font-normal"> / {cap}</span>
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Available</CardDescription>
              <CardTitle className="text-base font-medium">{remaining}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>This device</CardDescription>
              <CardTitle className="text-base font-medium truncate">
                {thisTerminal ? thisTerminal.slice(0, 18) + "…" : "-"}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Laptop className="h-5 w-5" />
            Active Devices
          </CardTitle>
          <CardDescription>
            Revoke a device to free a seat for a new terminal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {devicesQuery.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : devices.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No devices claimed yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Device</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Claimed</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {devices.map((d) => {
                  const isCurrent = thisTerminal === d.terminal_id;
                  return (
                    <TableRow key={d.id}>
                      <TableCell className="max-w-[280px]">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {d.device_label || d.terminal_id.slice(0, 12)}
                          </span>
                          {isCurrent && (
                            <Badge variant="secondary" className="text-xs">
                              This device
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {d.terminal_id}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{d.platform || "-"}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {format(new Date(d.claimed_at), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {format(new Date(d.last_seen_at), "MMM d, HH:mm")}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!canManage}
                          onClick={() => {
                            setRenameTarget(d);
                            setRenameValue(d.device_label && d.device_label.length <= 40 ? d.device_label : "");
                          }}
                          className="mr-1"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!canManage || revokingId === d.id}
                          onClick={() => handleRevoke(d.id)}
                        >
                          {revokingId === d.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <ShieldOff className="h-4 w-4 mr-1" />
                              Revoke
                            </>
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          {!canManage && (
            <p className="text-xs text-muted-foreground mt-3">
              Only owners and managers can revoke devices.
            </p>
          )}
        </CardContent>
        </Card>

        <KioskRemoteUnlockPanel restaurantId={restaurantId} canManage={canManage} />
        <KioskOfflinePinCard canManage={canManage} />
        <WifiQrCard canManage={canManage} />
        <LicenseDebugPanel />
        <RevokeDiagnosticsPanel />
      </div>

      <Dialog open={!!renameTarget} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Name this device</DialogTitle>
            <DialogDescription>
              Give this terminal a friendly name like "Counter 1" or "Drive-Thru Tablet".
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Counter 1"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            maxLength={40}
            onKeyDown={(e) => {
              if (e.key === "Enter" && renameValue.trim()) handleSaveName();
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameTarget(null)}>
              Skip
            </Button>
            <Button onClick={handleSaveName} disabled={!renameValue.trim() || savingName}>
              {savingName ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save name"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}