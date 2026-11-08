import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useStaffPosPins } from "@/hooks/useStaffPosPins";
import { validateStaffPinFormat } from "@/lib/pos/staffPin";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Member {
  user_id: string;
  role: string;
  full_name: string;
}

/**
 * Manage the 4-8 digit till PINs staff use to sign in on a shared terminal.
 * Hashes mirror to each terminal so sign-in keeps working with no internet.
 */
export function StaffPinManager() {
  const { restaurant } = useAuth();
  const restaurantId = restaurant?.id ?? null;
  const { pins, setPin, clearPin } = useStaffPosPins();
  const [target, setTarget] = useState<Member | null>(null);
  const [pin, setPinValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: members = [] } = useQuery({
    queryKey: ["till-pin-members", restaurantId],
    enabled: !!restaurantId,
    queryFn: async (): Promise<Member[]> => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .eq("restaurant_id", restaurantId!);
      if (error) throw error;
      const rows = (data ?? []) as { user_id: string; role: string }[];
      const unique = Array.from(new Map(rows.map((r) => [r.user_id, r])).values());
      const withNames = await Promise.all(
        unique.map(async (r) => {
          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("id", r.user_id)
            .maybeSingle();
          return {
            user_id: r.user_id,
            role: r.role,
            full_name: (profile?.full_name as string) || "Team member",
          };
        }),
      );
      return withNames;
    },
  });

  const save = async () => {
    if (!target) return;
    const formatError = validateStaffPinFormat(pin);
    if (formatError) {
      toast.error(formatError);
      return;
    }
    if (pin !== confirm) {
      toast.error("The two PINs do not match");
      return;
    }
    setBusy(true);
    try {
      await setPin.mutateAsync({
        userId: target.user_id,
        displayName: target.full_name,
        pin,
      });
      toast.success(`Till PIN set for ${target.full_name}`);
      setTarget(null);
      setPinValue("");
      setConfirm("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the PIN");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (member: Member) => {
    try {
      await clearPin.mutateAsync(member.user_id);
      toast.success(`Till PIN removed for ${member.full_name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove the PIN");
    }
  };

  const hasPin = (userId: string) => pins.some((p) => p.user_id === userId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-4 w-4" /> Till PINs
        </CardTitle>
        <CardDescription>
          Staff tap in at the till with a short PIN. Set one for each person while online — the
          terminal then accepts it even with no internet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {members.length === 0 && (
          <p className="text-sm text-muted-foreground">No team members yet.</p>
        )}
        {members.map((m) => (
          <div
            key={m.user_id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
          >
            <div>
              <p className="text-sm font-medium">{m.full_name}</p>
              <p className="text-xs text-muted-foreground capitalize">{m.role}</p>
            </div>
            <div className="flex items-center gap-2">
              {hasPin(m.user_id) ? (
                <Badge variant="secondary" className="gap-1">
                  <ShieldCheck className="h-3.5 w-3.5" /> PIN set
                </Badge>
              ) : (
                <Badge variant="outline">No PIN</Badge>
              )}
              <Button
                size="sm"
                variant="outline"
                className="min-h-[44px]"
                onClick={() => {
                  setTarget(m);
                  setPinValue("");
                  setConfirm("");
                }}
              >
                {hasPin(m.user_id) ? "Change" : "Set PIN"}
              </Button>
              {hasPin(m.user_id) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="min-h-[44px]"
                  onClick={() => void remove(m)}
                  aria-label={`Remove till PIN for ${m.full_name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>

      <Dialog open={!!target} onOpenChange={(v) => !v && setTarget(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Till PIN for {target?.full_name}</DialogTitle>
            <DialogDescription>4 to 8 digits. Avoid obvious sequences.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="staff-pin">PIN</Label>
              <Input
                id="staff-pin"
                type="password"
                inputMode="numeric"
                className="min-h-[44px]"
                value={pin}
                onChange={(e) => setPinValue(e.target.value.replace(/\D/g, "").slice(0, 8))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="staff-pin-confirm">Confirm PIN</Label>
              <Input
                id="staff-pin-confirm"
                type="password"
                inputMode="numeric"
                className="min-h-[44px]"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value.replace(/\D/g, "").slice(0, 8))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => void save()}>
              Save PIN
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
