import { useState } from "react";
import { KeyRound, Loader2, ShieldCheck, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useKioskOfflinePin } from "@/hooks/useKioskOfflinePin";
import { KIOSK_PIN_MIN_LENGTH, validatePinFormat } from "@/lib/kioskPin";

/**
 * Owner/manager control for the emergency kiosk-exit PIN used on tablets when
 * there's no internet. Only the hash is ever stored.
 */
export function KioskOfflinePinCard({ canManage }: { canManage: boolean }) {
  const { material, cachedOnDevice, isLoading, setPin, savingPin } = useKioskOfflinePin();
  const [pin1, setPin1] = useState("");
  const [pin2, setPin2] = useState("");

  const formatError = pin1 ? validatePinFormat(pin1) : null;
  const mismatch = pin2.length > 0 && pin1 !== pin2;

  const save = async () => {
    try {
      await setPin(pin1);
      setPin1("");
      setPin2("");
      toast.success(material ? "Emergency PIN rotated" : "Emergency PIN set");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save PIN");
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <KeyRound className="h-4 w-4" />
              Emergency kiosk PIN
            </CardTitle>
            <CardDescription>
              Lets an owner exit Android kiosk mode directly on the tablet when there is no
              internet. Only a salted hash is stored — never the PIN itself.
            </CardDescription>
          </div>
          {isLoading ? null : material ? (
            <Badge variant="secondary" className="gap-1">
              <ShieldCheck className="h-3 w-3" /> PIN set
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 text-destructive border-destructive/40">
              <ShieldAlert className="h-3 w-3" /> Not configured
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          {cachedOnDevice
            ? "This device has the PIN cached and can unlock offline."
            : "This device has no cached PIN yet — it caches automatically once a PIN exists."}
          {material?.rotated_at
            ? ` Last changed ${new Date(material.rotated_at).toLocaleString()}.`
            : ""}
        </p>

        {canManage ? (
          <div className="grid gap-3 sm:grid-cols-2 max-w-lg">
            <div className="space-y-1.5">
              <Label htmlFor="kiosk-pin-new">New PIN</Label>
              <Input
                id="kiosk-pin-new"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                placeholder={`${KIOSK_PIN_MIN_LENGTH}–12 digits`}
                value={pin1}
                onChange={(e) => setPin1(e.target.value.replace(/\D/g, "").slice(0, 12))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kiosk-pin-confirm">Confirm PIN</Label>
              <Input
                id="kiosk-pin-confirm"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                value={pin2}
                onChange={(e) => setPin2(e.target.value.replace(/\D/g, "").slice(0, 12))}
              />
            </div>
            <div className="sm:col-span-2 flex items-center gap-3">
              <Button
                onClick={() => void save()}
                disabled={!!formatError || mismatch || !pin1 || !pin2 || savingPin}
              >
                {savingPin && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {material ? "Rotate PIN" : "Set PIN"}
              </Button>
              {(formatError || mismatch) && (
                <span className="text-sm text-destructive">
                  {formatError ?? "PINs do not match"}
                </span>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Only owners and managers can set the emergency PIN.
          </p>
        )}
      </CardContent>
    </Card>
  );
}