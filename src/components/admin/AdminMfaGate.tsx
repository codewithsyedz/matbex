import { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/integrations/db/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Factor { id: string; friendly_name?: string | null }

/**
 * SuperAdmin rights need a session that passed two-factor (is_superadmin and the admin server
 * functions require aal2). This screen gets the session there: the 6-digit code from the
 * authenticator app, or, the first time, setting one up.
 */
export function AdminMfaGate({ onVerified }: { onVerified: () => void }) {
  const [loading, setLoading] = useState(true);
  const [factor, setFactor] = useState<Factor | null>(null);
  const [enrol, setEnrol] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    db.auth.mfa.listFactors().then(({ data }) => {
      setFactor((data?.totp?.[0] as Factor | undefined) ?? null);
      setLoading(false);
    });
  }, []);

  const startEnrol = async () => {
    setBusy(true);
    const { data, error } = await db.auth.mfa.enroll({ factorType: "totp", friendlyName: "Matbex SuperAdmin" });
    setBusy(false);
    if (error) { toast.error(error.message || "Could not start the setup"); return; }
    setEnrol({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  };

  const verify = async () => {
    const factorId = enrol?.id ?? factor?.id;
    if (!factorId || code.trim().length < 6) return;
    setBusy(true);
    const { error } = await db.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    setBusy(false);
    if (error) { toast.error(error.message || "That code did not work; try the next one"); return; }
    toast.success("Verified");
    onVerified();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /> Two-factor verification</CardTitle>
          <CardDescription>
            SuperAdmin access needs a second factor: a 6-digit code from an authenticator app (Google Authenticator,
            Microsoft Authenticator, 1Password…).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : !factor && !enrol ? (
            <Button onClick={startEnrol} disabled={busy} className="w-full">
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Set up an authenticator app
            </Button>
          ) : (
            <>
              {enrol && (
                <div className="space-y-2 text-sm">
                  <p>Scan this code with your authenticator app, then enter the 6-digit code it shows.</p>
                  <div className="flex justify-center rounded-md bg-white p-3">
                    {enrol.qr.startsWith("data:") || enrol.qr.startsWith("http")
                      ? <img src={enrol.qr} alt="Authenticator QR code" className="h-44 w-44" />
                      : <div className="h-44 w-44" dangerouslySetInnerHTML={{ __html: enrol.qr }} />}
                  </div>
                  <p className="text-xs text-muted-foreground break-all">Or enter this key by hand: <code>{enrol.secret}</code></p>
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="mfa-code">6-digit code</Label>
                <Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={(e) => { if (e.key === "Enter") void verify(); }} autoFocus />
              </div>
              <Button onClick={verify} disabled={busy || code.length < 6} className="w-full">
                {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Verify
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
