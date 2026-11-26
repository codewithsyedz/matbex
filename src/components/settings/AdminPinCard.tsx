import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Settings card for owners/managers to set or change the tenant-level
 * admin PIN. The PIN is required to log out a cashier on the POS device.
 */
export function AdminPinCard() {
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const canManage = hasRole("owner") || hasRole("manager");

  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: isSet, isLoading } = useQuery({
    queryKey: ["tenant-admin-pin-is-set"],
    queryFn: async () => {
      const { data, error } = await db.rpc("tenant_admin_pin_is_set");
      if (error) throw error;
      return Boolean(data);
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!canManage) {
      setPin("");
      setConfirm("");
    }
  }, [canManage]);

  const submit = async () => {
    if (pin.length < 4) {
      toast.error("PIN must be 4-12 digits");
      return;
    }
    if (pin !== confirm) {
      toast.error("PINs do not match");
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await db.rpc("set_tenant_admin_pin", { p_pin: pin });
      if (error) throw error;
      toast.success(isSet ? "Admin PIN updated" : "Admin PIN set");
      setPin("");
      setConfirm("");
      qc.invalidateQueries({ queryKey: ["tenant-admin-pin-is-set"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save PIN");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" />
          Admin PIN
        </CardTitle>
        <CardDescription>
          Used to log out a cashier on the POS device so an admin or another user can sign in.
          {isLoading ? null : isSet ? (
            <span className="ml-1 inline-flex items-center gap-1 text-emerald-600">
              <ShieldCheck className="h-3.5 w-3.5" /> A PIN is currently set.
            </span>
          ) : (
            <span className="ml-1 text-amber-600">No PIN set yet.</span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canManage ? (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="new-admin-pin">New PIN (4-12 digits)</Label>
                <Input
                  id="new-admin-pin"
                  type="password"
                  inputMode="numeric"
                  maxLength={12}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                  placeholder="••••"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-admin-pin">Confirm PIN</Label>
                <Input
                  id="confirm-admin-pin"
                  type="password"
                  inputMode="numeric"
                  maxLength={12}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))}
                  placeholder="••••"
                />
              </div>
            </div>
            <Button onClick={() => void submit()} disabled={submitting || pin.length < 4}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : isSet ? "Update PIN" : "Set PIN"}
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Only owners or managers can set the admin PIN.
          </p>
        )}
      </CardContent>
    </Card>
  );
}