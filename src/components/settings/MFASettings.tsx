import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Shield, ShieldCheck, ShieldOff, Smartphone, Copy, Check, Key } from "lucide-react";

interface MFAFactor {
  id: string;
  friendly_name?: string;
  factor_type: string;
  status: string;
  created_at: string;
  updated_at?: string;
}

export function MFASettings() {
  const { user, isOwner } = useAuth();
  const [factors, setFactors] = useState<MFAFactor[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchFactors = async () => {
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      setFactors(data.totp || []);
    } catch (error) {
      console.error("Error fetching MFA factors:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFactors();
  }, []);

  const handleEnroll = async () => {
    setEnrolling(true);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Authenticator App",
      });

      if (error) throw error;

      setQrCode(data.totp.qr_code);
      setSecret(data.totp.secret);
      setFactorId(data.id);
    } catch (error: any) {
      console.error("Error enrolling MFA:", error);
      toast.error(error.message || "Failed to set up MFA");
      setEnrolling(false);
    }
  };

  const handleVerify = async () => {
    if (!factorId || !verifyCode) return;

    setVerifying(true);
    try {
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId,
      });

      if (challengeError) throw challengeError;

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challengeData.id,
        code: verifyCode,
      });

      if (verifyError) throw verifyError;

      toast.success("Two-factor authentication enabled successfully");
      setEnrolling(false);
      setQrCode(null);
      setSecret(null);
      setFactorId(null);
      setVerifyCode("");
      fetchFactors();
    } catch (error: any) {
      console.error("Error verifying MFA:", error);
      toast.error(error.message || "Invalid verification code");
    } finally {
      setVerifying(false);
    }
  };

  const handleUnenroll = async (factorId: string) => {
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) throw error;
      toast.success("Two-factor authentication disabled");
      fetchFactors();
    } catch (error: any) {
      console.error("Error unenrolling MFA:", error);
      toast.error(error.message || "Failed to disable MFA");
    }
  };

  const copySecret = () => {
    if (secret) {
      navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const cancelEnrollment = () => {
    setEnrolling(false);
    setQrCode(null);
    setSecret(null);
    setFactorId(null);
    setVerifyCode("");
  };

  const hasActiveMFA = factors.some((f) => f.status === "verified");

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Shield className="h-4 w-4" />
          Two-Factor Authentication
        </CardTitle>
        <CardDescription>
          Add an extra layer of security to your account
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
          <div className="flex items-center gap-3">
            {hasActiveMFA ? (
              <div className="h-10 w-10 rounded-full bg-green-500/10 flex items-center justify-center">
                <ShieldCheck className="h-5 w-5 text-green-500" />
              </div>
            ) : (
              <div className="h-10 w-10 rounded-full bg-amber-500/10 flex items-center justify-center">
                <ShieldOff className="h-5 w-5 text-amber-500" />
              </div>
            )}
            <div>
              <p className="font-medium">
                {hasActiveMFA ? "MFA Enabled" : "MFA Not Enabled"}
              </p>
              <p className="text-sm text-muted-foreground">
                {hasActiveMFA
                  ? "Your account is protected with two-factor authentication"
                  : "Enable MFA for enhanced security"}
              </p>
            </div>
          </div>
          {hasActiveMFA ? (
            <Badge variant="default" className="bg-green-500">Active</Badge>
          ) : (
            <Badge variant="secondary">Inactive</Badge>
          )}
        </div>

        {factors.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Active Factors</p>
            {factors.map((factor) => (
              <div
                key={factor.id}
                className="flex items-center justify-between p-3 rounded-lg border"
              >
                <div className="flex items-center gap-3">
                  <Smartphone className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">
                      {factor.friendly_name || "Authenticator App"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Added {new Date(factor.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="text-destructive">
                      Remove
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Disable Two-Factor Authentication</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will remove the authenticator app from your account. 
                        Your account will be less secure without MFA.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => handleUnenroll(factor.id)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Disable MFA
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ))}
          </div>
        )}

        {!hasActiveMFA && !enrolling && (
          <Button onClick={handleEnroll} className="w-full">
            <Key className="h-4 w-4 mr-2" />
            Set Up Two-Factor Authentication
          </Button>
        )}

        <Dialog open={enrolling && !!qrCode} onOpenChange={(open) => !open && cancelEnrollment()}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Set Up Authenticator App</DialogTitle>
              <DialogDescription>
                Scan the QR code with your authenticator app (Google Authenticator, Authy, etc.)
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {qrCode && (
                <div className="flex justify-center">
                  <div className="p-4 bg-white rounded-lg">
                    <img src={qrCode} alt="QR Code" className="w-48 h-48" />
                  </div>
                </div>
              )}

              {secret && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground text-center">
                    Or enter this code manually:
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 p-2 bg-muted rounded text-xs font-mono text-center">
                      {secret}
                    </code>
                    <Button variant="outline" size="sm" onClick={copySecret}>
                      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium">Verification Code</label>
                <Input
                  type="text"
                  placeholder="Enter 6-digit code"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  maxLength={6}
                  className="text-center text-lg tracking-widest"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={cancelEnrollment}>
                Cancel
              </Button>
              <Button
                onClick={handleVerify}
                disabled={verifyCode.length !== 6 || verifying}
              >
                {verifying ? "Verifying..." : "Verify & Enable"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {isOwner && (
          <p className="text-xs text-muted-foreground">
            As an owner, we recommend enabling MFA to protect sensitive business data.
          </p>
        )}
      </CardContent>
    </Card>
  );
}