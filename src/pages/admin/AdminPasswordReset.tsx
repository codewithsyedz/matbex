import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useSuperAdminAudit } from "@/hooks/useSuperAdminAudit";
import { useSuperAdmin } from "@/contexts/SuperAdminContext";
import { Navigate } from "react-router-dom";
import { KeyRound, ShieldAlert, Eye, EyeOff, Loader2 } from "lucide-react";

export default function AdminPasswordReset() {
  const { toast } = useToast();
  const { logEvent } = useSuperAdminAudit();
  const { isSuperAdmin, loading: roleLoading } = useSuperAdmin();
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // Defense-in-depth: even though ProtectedAdminRoute guards this page,
  // refuse to render anything for non-SuperAdmins.
  if (roleLoading) return null;
  if (!isSuperAdmin) return <Navigate to="/dashboard" replace />;

  const generatePassword = () => {
    const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
    const pwd = Array.from({ length: 16 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join("");
    setNewPassword(pwd);
    setConfirmPassword(pwd);
    setShowPassword(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim()) {
      toast({ title: "Email required", description: "Enter the user's email.", variant: "destructive" });
      return;
    }
    if (newPassword.length < 8) {
      toast({ title: "Password too short", description: "Use at least 8 characters.", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }

    const confirmed = window.confirm(
      `Reset password for ${email}? This action is logged in the SuperAdmin audit trail.`
    );
    if (!confirmed) return;

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-reset-password", {
        body: { email: email.trim().toLowerCase(), new_password: newPassword },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      await logEvent({
        actionType: "PASSWORD_RESET_FORCE",
        targetType: "user",
        targetIdentifier: email.trim().toLowerCase(),
        summary: `Force-reset password for "${email.trim().toLowerCase()}"`,
        context: { outcome: "success" },
      });

      toast({
        title: "Password reset successful",
        description: `Share the new password with ${email} via a secure channel.`,
      });
      setEmail("");
      setNewPassword("");
      setConfirmPassword("");
      setShowPassword(false);
    } catch (err: any) {
      // Log failed attempts so the audit trail captures both successful and
      // failed privileged actions.
      await logEvent({
        actionType: "PASSWORD_RESET_FORCE",
        targetType: "user",
        targetIdentifier: email.trim().toLowerCase(),
        summary: `Failed password reset for "${email.trim().toLowerCase()}"`,
        context: { outcome: "failure", error: err?.message || String(err) },
      }).catch(() => {});
      toast({
        title: "Reset failed",
        description: err.message || "Unable to reset password.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container max-w-2xl py-8 space-y-6">
      <div className="space-y-1">
        <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
          <KeyRound className="h-6 w-6" />
          Password Reset
        </h1>
        <p className="text-sm text-muted-foreground font-light">
          Force-reset a user's password. Every reset is logged in the SuperAdmin audit trail.
        </p>
      </div>

      <Alert variant="destructive" className="border-destructive/30">
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Use with care</AlertTitle>
        <AlertDescription>
          This bypasses email verification and the standard password reset flow. Only use for verified
          account-recovery requests. Always deliver the new password through a secure channel and ask
          the user to change it after first login.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-light">Reset user password</CardTitle>
          <CardDescription>Enter the user's email and the new password you want to set.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">User email</Label>
              <Input
                id="email"
                type="email"
                placeholder="user@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                autoComplete="off"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">New password</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={generatePassword}
                  disabled={loading}
                  className="h-auto px-2 py-1 text-xs"
                >
                  Generate strong password
                </Button>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="At least 8 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={loading}
                  autoComplete="new-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm">Confirm password</Label>
              <Input
                id="confirm"
                type={showPassword ? "text" : "password"}
                placeholder="Re-enter the new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loading}
                autoComplete="new-password"
              />
            </div>

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Resetting password...
                </>
              ) : (
                "Reset password"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}