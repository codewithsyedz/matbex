import { useCallback, useEffect, useState } from "react";
import { Loader2, Lock, RefreshCw, ShieldCheck, Timer, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WifiQrJoinPanel } from "@/components/pos/WifiQrJoinPanel";
import { useAuth } from "@/contexts/AuthContext";
import {
  getWifiStatus,
  isNativeKioskAvailable,
  type WifiStatus,
} from "@/lib/kiosk";
import { useWifiConfigMode, WIFI_CONFIG_WINDOW_MS } from "@/hooks/useWifiConfigMode";
import {
  attemptsRemaining,
  getLockoutRemainingMs,
  readCachedPinMaterial,
  verifyPinOffline,
} from "@/lib/kioskPin";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * In-app Wi-Fi change flow for kiosk terminals. The owner PIN is verified
 * offline, then kiosk lock is temporarily released so the Android Wi-Fi picker
 * can be opened. Kiosk lock is restored from this screen when done.
 */
export function KioskWifiDialog({ open, onOpenChange }: Props) {
  const { restaurant } = useAuth();
  const restaurantId = restaurant?.id ?? null;
  const [pin, setPin] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockoutMs, setLockoutMs] = useState(0);
  const [wifi, setWifi] = useState<WifiStatus | null>(null);
  const configMode = useWifiConfigMode();

  const native = isNativeKioskAvailable();
  const hasCachedPin = restaurantId ? !!readCachedPinMaterial(restaurantId) : false;

  const refreshWifi = useCallback(async () => {
    setWifi(await getWifiStatus());
  }, []);

  useEffect(() => {
    if (!open) return;
    setPin("");
    setError(null);
    setUnlocked(false);
    void refreshWifi();
    if (!restaurantId) return;
    setLockoutMs(getLockoutRemainingMs(restaurantId));
    const t = window.setInterval(
      () => setLockoutMs(getLockoutRemainingMs(restaurantId)),
      1000,
    );
    return () => window.clearInterval(t);
  }, [open, restaurantId, refreshWifi]);

  // Keep the connection card fresh while the owner is switching networks.
  useEffect(() => {
    if (!open || (!unlocked && !configMode.active)) return;
    const t = window.setInterval(() => void refreshWifi(), 4000);
    return () => window.clearInterval(t);
  }, [open, unlocked, configMode.active, refreshWifi]);

  // Once config mode is running the PIN gate stays open so the operator can
  // extend or re-lock immediately after returning from Android settings.
  useEffect(() => {
    if (configMode.active) setUnlocked(true);
  }, [configMode.active]);

  const handleVerify = async () => {
    if (!restaurantId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await verifyPinOffline(restaurantId, pin);
      if (result.ok !== true) {
        setError(result.message);
        setLockoutMs(getLockoutRemainingMs(restaurantId));
        setPin("");
        return;
      }
      setUnlocked(true);
      setPin("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleOpenWifi = async () => {
    setBusy(true);
    setError(null);
    const res = await configMode.start();
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Could not open Wi-Fi settings");
      return;
    }
    toast.info("Wi-Fi settings opened", {
      description:
        "Kiosk unlocked for 60 seconds — connect to the network, then Matbex re-locks automatically.",
      duration: 12_000,
    });
  };

  const handleRelock = async () => {
    setBusy(true);
    const res = await configMode.relock();
    setBusy(false);
    if (res.ok) {
      toast.success("Kiosk mode re-locked");
      onOpenChange(false);
    } else {
      setError(res.error ?? "Could not re-lock kiosk mode");
    }
  };

  const locked = lockoutMs > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wifi className="h-5 w-5 text-primary" />
            Change Wi-Fi
          </DialogTitle>
          <DialogDescription>
            Verify the owner PIN, then scan the owner's Wi-Fi QR to join without leaving kiosk — or
            open Android Wi-Fi settings for 60 seconds.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border p-3 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Current connection</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() => void refreshWifi()}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {wifi?.connected ? (
              <Wifi className="h-4 w-4 text-emerald-600" />
            ) : (
              <WifiOff className="h-4 w-4 text-amber-600" />
            )}
            <span className="text-sm font-medium">
              {wifi?.ssid ?? (wifi?.connected ? "Wi-Fi connected" : "Not on Wi-Fi")}
            </span>
            <Badge variant={navigator.onLine ? "default" : "secondary"} className="ml-auto">
              {navigator.onLine ? "Online" : "Offline"}
            </Badge>
          </div>
        </div>

        {!native && (
          <Alert>
            <AlertDescription>
              Wi-Fi can only be changed from the Android tablet app. On desktop, use the device's
              own network settings.
            </AlertDescription>
          </Alert>
        )}

        {native && !hasCachedPin && (
          <Alert variant="destructive">
            <AlertDescription>
              No emergency PIN is stored on this tablet. Set one in Devices → Emergency kiosk PIN
              while online.
            </AlertDescription>
          </Alert>
        )}

        {!unlocked ? (
          <div className="space-y-2">
            <Label htmlFor="wifi-pin">Owner PIN</Label>
            <Input
              id="wifi-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              placeholder="••••••"
              className="text-center tracking-[0.5em] text-lg"
              value={pin}
              disabled={locked || busy || !hasCachedPin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 12))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && pin.length >= 6) void handleVerify();
              }}
            />
            {restaurantId && !locked && hasCachedPin && (
              <p className="text-xs text-muted-foreground">
                {attemptsRemaining(restaurantId)} attempt
                {attemptsRemaining(restaurantId) === 1 ? "" : "s"} before a 15 minute lockout.
              </p>
            )}
            {locked && (
              <p className="text-sm text-destructive">
                Locked for {Math.ceil(lockoutMs / 60000)} more minute
                {Math.ceil(lockoutMs / 60000) === 1 ? "" : "s"}.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <Tabs defaultValue="qr">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="qr">Scan Wi-Fi QR</TabsTrigger>
                <TabsTrigger value="settings">Android settings</TabsTrigger>
              </TabsList>
              <TabsContent value="qr" className="pt-3">
                <WifiQrJoinPanel onJoined={() => void refreshWifi()} />
              </TabsContent>
              <TabsContent value="settings" className="space-y-3 pt-3">
            <Alert>
              <ShieldCheck className="h-4 w-4" />
              <AlertDescription>
                PIN verified. Opening Wi-Fi settings unlocks kiosk for{" "}
                <strong>60 seconds</strong>, then Matbex re-locks automatically.
              </AlertDescription>
            </Alert>
            <Button
              className="w-full"
              onClick={() => void handleOpenWifi()}
              disabled={busy || configMode.relocking}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Wifi className="h-4 w-4 mr-2" />
              )}
              {configMode.active ? "Reopen Wi-Fi settings" : "Open Wi-Fi settings"}
            </Button>
            {configMode.active && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-amber-700">
                  <Timer className="h-4 w-4" />
                  Wi-Fi config mode — re-locking in {configMode.remainingSec}s
                </div>
                <Progress
                  value={(configMode.remainingMs / WIFI_CONFIG_WINDOW_MS) * 100}
                  className="h-1.5"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={configMode.extend}
                >
                  Give me another 60s
                </Button>
              </div>
            )}
            {configMode.relocking && (
              <p className="text-xs text-muted-foreground">Re-locking kiosk mode…</p>
            )}
              </TabsContent>
            </Tabs>
          </div>
        )}

        {(error || configMode.error) && (
          <p className="text-sm text-destructive">{error ?? configMode.error}</p>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Close
          </Button>
          {unlocked && (
            <Button onClick={() => void handleRelock()} disabled={busy || !native}>
              <Lock className="h-4 w-4 mr-2" />
              Re-lock kiosk
            </Button>
          )}
          {!unlocked && (
            <Button
              onClick={() => void handleVerify()}
              disabled={busy || locked || pin.length < 6 || !hasCachedPin}
            >
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Verify PIN
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
