import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useZatcaSettings } from "@/hooks/useZatcaSettings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Trash2, ShieldOff, Smartphone, ShieldCheck, Star } from "lucide-react";
import { toast } from "sonner";
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
import { useZatcaDevices, type ZatcaDevice } from "@/hooks/useZatcaDevices";

function StatusBadge({ status }: { status: ZatcaDevice["registration_status"] }) {
  const variant =
    status === "REGISTERED" ? "default" : status === "REVOKED" ? "destructive" : "secondary";
  return <Badge variant={variant}>{status}</Badge>;
}

export function ZatcaDevices() {
  const { devices, loading, create, creating, remove, revoke } = useZatcaDevices();
  const { settings, save } = useZatcaSettings();
  const [name, setName] = useState("");
  const [serial, setSerial] = useState("");
  const [model, setModel] = useState("");
  const [otp, setOtp] = useState("");
  const [onboardingId, setOnboardingId] = useState<string | null>(null);
  const activeId = settings?.active_device_id ?? null;

  const onOnboard = async (deviceId: string) => {
    setOnboardingId(deviceId);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zatca-onboard-device`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token ?? ""}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ device_id: deviceId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Onboarding failed");
      toast.success(
        json.mode === "live"
          ? "Device registered with ZATCA Fatoora."
          : "Device onboarded in simulation mode (set ZATCA_BASE_URL to go live).",
      );
      // Trigger a devices list refetch by toggling visibility - useQuery cache key handles it.
      window.dispatchEvent(new Event("zatca-devices-refresh"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOnboardingId(null);
    }
  };

  const onSetActive = async (deviceId: string) => {
    try {
      await save({ active_device_id: deviceId });
      toast.success("Active POS device updated.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const reset = () => {
    setName(""); setSerial(""); setModel(""); setOtp("");
  };

  const onAdd = async () => {
    if (!name.trim() || !serial.trim()) {
      toast.error("Device name and serial number are required.");
      return;
    }
    try {
      await create({ name: name.trim(), serial_number: serial.trim(), model: model.trim() || null, otp: otp.trim() || null });
      toast.success("Device registered (pending ZATCA onboarding).");
      reset();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Smartphone className="h-5 w-5" /> ZATCA Devices
        </CardTitle>
        <CardDescription>
          Register each POS device with ZATCA Fatoora. Required for Phase 2 e-invoicing.
          Each device gets its own ICV counter and previous-invoice-hash chain.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label htmlFor="zd-name">Device name</Label>
            <Input id="zd-name" placeholder="Front POS" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="zd-serial">Serial number</Label>
            <Input id="zd-serial" placeholder="SN-12345" value={serial} onChange={(e) => setSerial(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="zd-model">Model (optional)</Label>
            <Input id="zd-model" placeholder="e.g. Sunmi T2" value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="zd-otp">ZATCA OTP (optional)</Label>
            <Input id="zd-otp" placeholder="123456" value={otp} onChange={(e) => setOtp(e.target.value)} />
          </div>
        </div>
        <Button onClick={onAdd} disabled={creating} className="gap-2">
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add device
        </Button>

        <div className="space-y-2">
          <h4 className="text-sm font-medium">Registered devices</h4>
          {loading ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : devices.length === 0 ? (
            <div className="text-sm text-muted-foreground">No devices registered yet.</div>
          ) : (
            <div className="border rounded-lg divide-y">
              {devices.map((d) => (
                <div key={d.id} className="p-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{d.name}</span>
                      <StatusBadge status={d.registration_status} />
                      {activeId === d.id && (
                        <Badge variant="outline" className="gap-1">
                          <Star className="h-3 w-3" /> Active
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">SN: {d.serial_number}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      ICV: {d.icv_counter} {d.model ? `• ${d.model}` : ""}
                      {d.last_pih ? ` • PIH …${d.last_pih.slice(-8)}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {d.registration_status !== "REGISTERED" && (
                      <Button
                        variant="default"
                        size="sm"
                        className="gap-1"
                        disabled={onboardingId === d.id}
                        onClick={() => onOnboard(d.id)}
                      >
                        {onboardingId === d.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ShieldCheck className="h-3.5 w-3.5" />
                        )}
                        Onboard
                      </Button>
                    )}
                    {d.registration_status === "REGISTERED" && activeId !== d.id && (
                      <Button variant="outline" size="sm" className="gap-1" onClick={() => onSetActive(d.id)}>
                        <Star className="h-3.5 w-3.5" /> Set active
                      </Button>
                    )}
                    {d.registration_status !== "REVOKED" && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="sm" className="gap-1">
                            <ShieldOff className="h-3.5 w-3.5" /> Revoke
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Revoke device?</AlertDialogTitle>
                            <AlertDialogDescription>
                              The device will stop being eligible for ZATCA submissions. You can re-register a new serial later.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={async () => {
                                try { await revoke(d.id); toast.success("Device revoked."); }
                                catch (e) { toast.error((e as Error).message); }
                              }}
                            >Revoke</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="gap-1 text-destructive">
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete device?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Past sales linked to this device retain their stamps; only the device record is removed.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={async () => {
                              try { await remove(d.id); toast.success("Device removed."); }
                              catch (e) { toast.error((e as Error).message); }
                            }}
                          >Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}