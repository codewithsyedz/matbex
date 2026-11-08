import { useEffect, useState } from "react";
import { ShieldAlert, Loader2, WifiOff } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { getTerminalId } from "@/lib/offline/terminal";
import { exitKioskMode, isNativeKioskAvailable } from "@/lib/kiosk";
import {
  attemptsRemaining,
  getLockoutRemainingMs,
  type PinVerifyResult,
  queueUnlockEvent,
  readCachedPinMaterial,
  verifyPinOffline,
} from "@/lib/kioskPin";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Owner-operated emergency exit from Android kiosk (lock-task) mode using the
 * restaurant's offline PIN. Works with no internet: the PIN hash is cached on
 * the device, and the audit event is queued until connectivity returns.
 */
export function EmergencyKioskUnlockDialog({ open, onOpenChange }: Props) {
  const { restaurant, tenant, user } = useAuth();
  const restaurantId = restaurant?.id ?? null;
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockoutMs, setLockoutMs] = useState(0);

  const hasCachedPin = restaurantId ? !!readCachedPinMaterial(restaurantId) : false;
  const online = typeof navigator === "undefined" ? true : navigator.onLine;

  useEffect(() => {
    if (!open || !restaurantId) return;
    setPin("");
    setError(null);
    setLockoutMs(getLockoutRemainingMs(restaurantId));
    const t = window.setInterval(
      () => setLockoutMs(getLockoutRemainingMs(restaurantId)),
      1000,
    );
    return () => window.clearInterval(t);
  }, [open, restaurantId]);

  const handleUnlock = async () => {
    if (!restaurantId) return;
    setBusy(true);
    setError(null);
    try {
      const result: PinVerifyResult = await verifyPinOffline(restaurantId, pin);
      if (result.ok !== true) {
        setError(result.message);
        setLockoutMs(getLockoutRemainingMs(restaurantId));
        setPin("");
        setBusy(false);
        return;
      }

      const exit = isNativeKioskAvailable()
        ? await exitKioskMode()
        : { ok: false, error: "Kiosk mode is only active on the Android app" };

      const terminalId = await getTerminalId().catch(() => "unknown");
      const event = {
        restaurant_id: restaurantId,
        tenant_id: tenant?.id ?? null,
        terminal_id: terminalId,
        performed_by_user_id: user?.id ?? null,
        reason: reason.trim() || null,
        succeeded: exit.ok,
        occurred_at: new Date().toISOString(),
        platform: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 200) : null,
      };

      if (online) {
        const { error: insertError } = await supabase
          .from("kiosk_offline_unlock_events" as never)
          .insert(event as never);
        if (insertError) queueUnlockEvent(event as never);
      } else {
        queueUnlockEvent(event as never);
      }

      if (exit.ok) {
        toast.success("Kiosk mode released", {
          description: "You can now leave the Matbex app on this tablet.",
          duration: 10_000,
        });
        setReason("");
        onOpenChange(false);
      } else {
        setError(exit.error ?? "Could not release kiosk mode");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const locked = lockoutMs > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-destructive" />
            Emergency kiosk exit
          </DialogTitle>
          <DialogDescription>
            Enter the owner PIN to release Android kiosk lock on this tablet. Works without
            internet — the action is logged and synced later.
          </DialogDescription>
        </DialogHeader>

        {!online && (
          <Alert>
            <WifiOff className="h-4 w-4" />
            <AlertDescription>
              Offline mode — the PIN is checked against the copy stored on this tablet.
            </AlertDescription>
          </Alert>
        )}

        {!hasCachedPin && (
          <Alert variant="destructive">
            <AlertDescription>
              No emergency PIN is stored on this tablet yet. Set one in Devices → Emergency kiosk
              PIN while online.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="kiosk-pin">Owner PIN</Label>
            <Input
              id="kiosk-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              placeholder="••••••"
              className="text-center tracking-[0.5em] text-lg"
              value={pin}
              disabled={locked || busy || !hasCachedPin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 12))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && pin.length >= 6) void handleUnlock();
              }}
            />
            {restaurantId && !locked && hasCachedPin && (
              <p className="text-xs text-muted-foreground">
                {attemptsRemaining(restaurantId)} attempt
                {attemptsRemaining(restaurantId) === 1 ? "" : "s"} before a 15 minute lockout.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="kiosk-reason">Reason (optional)</Label>
            <Textarea
              id="kiosk-reason"
              rows={2}
              placeholder="e.g. printer driver update"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {locked && (
            <p className="text-sm text-destructive">
              Locked for {Math.ceil(lockoutMs / 60000)} more minute
              {Math.ceil(lockoutMs / 60000) === 1 ? "" : "s"}.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => void handleUnlock()}
            disabled={busy || locked || pin.length < 6 || !hasCachedPin}
          >
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Exit kiosk
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}