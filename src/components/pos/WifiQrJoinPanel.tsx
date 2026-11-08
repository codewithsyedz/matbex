import { useCallback, useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { AlertTriangle, Check, Loader2, QrCode, Wifi } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { joinWifiNetwork, isNativeKioskAvailable } from "@/lib/kiosk";
import { parseWifiQrPayload, type WifiCredentials } from "@/lib/wifiQr";

const REGION_ID = "matbex-wifi-qr-region";

/**
 * Offline Wi-Fi onboarding: the owner shows a Wi-Fi QR (from Devices → Wi-Fi QR
 * or any standard Wi-Fi QR), the tablet scans it and joins natively — kiosk
 * lock-task mode is never released.
 */
export function WifiQrJoinPanel({ onJoined }: { onJoined?: () => void }) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [scanning, setScanning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creds, setCreds] = useState<WifiCredentials | null>(null);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);

  const stopScanner = useCallback(async () => {
    const inst = scannerRef.current;
    scannerRef.current = null;
    if (!inst) return;
    try {
      await inst.stop();
      inst.clear();
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => () => void stopScanner(), [stopScanner]);

  const startScan = async () => {
    setError(null);
    setJoined(false);
    setCreds(null);
    setScanning(true);
    setStarting(true);
    try {
      await new Promise((r) => setTimeout(r, 60));
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("No camera available on this device — enter the details manually.");
      }
      const instance = new Html5Qrcode(REGION_ID, { verbose: false });
      scannerRef.current = instance;
      await instance.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decoded) => {
          const parsed = parseWifiQrPayload(decoded);
          if (!parsed) return;
          setCreds(parsed);
          setScanning(false);
          void stopScanner();
        },
        () => {
          /* per-frame decode noise */
        },
      );
    } catch (e: any) {
      setError(
        e?.name === "NotAllowedError"
          ? "Camera access is blocked for Matbex. Allow the Camera permission, or enter the network manually."
          : (e?.message ?? "Could not start the camera"),
      );
      setScanning(false);
    } finally {
      setStarting(false);
    }
  };

  const handleJoin = async () => {
    if (!creds) return;
    setJoining(true);
    setError(null);
    const res = await joinWifiNetwork({
      ssid: creds.ssid,
      password: creds.password,
      security: creds.security,
      hidden: creds.hidden,
    });
    setJoining(false);
    if (!res.ok) {
      setError(res.error ?? "Could not join the network");
      return;
    }
    setJoined(true);
    toast.success(`Joining ${creds.ssid}`, {
      description:
        res.method === "suggestion"
          ? "Android will connect automatically when the network is in range."
          : "Kiosk mode stayed locked while switching networks.",
      duration: 10_000,
    });
    onJoined?.();
  };

  return (
    <div className="space-y-3">
      <Alert>
        <QrCode className="h-4 w-4" />
        <AlertDescription>
          Scan the Wi-Fi QR shown by the owner. The tablet joins the network without leaving kiosk
          mode — no internet needed.
        </AlertDescription>
      </Alert>

      {!isNativeKioskAvailable() && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Joining Wi-Fi natively only works in the Android tablet app.
          </AlertDescription>
        </Alert>
      )}

      {scanning && (
        <div className="relative overflow-hidden rounded-xl bg-black">
          <div id={REGION_ID} className="w-full aspect-square" />
          {starting && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}
        </div>
      )}

      {!scanning && (
        <Button variant="outline" className="w-full" onClick={() => void startScan()}>
          <QrCode className="h-4 w-4 mr-2" />
          {creds ? "Scan a different QR" : "Scan Wi-Fi QR"}
        </Button>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="wifi-ssid" className="text-xs">
            Network (SSID)
          </Label>
          <Input
            id="wifi-ssid"
            value={creds?.ssid ?? ""}
            onChange={(e) =>
              setCreds((c) => ({
                ssid: e.target.value,
                password: c?.password ?? "",
                security: c?.security ?? "WPA",
                hidden: c?.hidden ?? false,
              }))
            }
            placeholder="Restaurant-WiFi"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="wifi-pass" className="text-xs">
            Password
          </Label>
          <Input
            id="wifi-pass"
            type="password"
            value={creds?.password ?? ""}
            onChange={(e) =>
              setCreds((c) => ({
                ssid: c?.ssid ?? "",
                password: e.target.value,
                security: c?.security ?? "WPA",
                hidden: c?.hidden ?? false,
              }))
            }
            placeholder="••••••••"
          />
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button
        className="w-full"
        onClick={() => void handleJoin()}
        disabled={joining || !creds?.ssid}
      >
        {joining ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : joined ? (
          <Check className="h-4 w-4 mr-2" />
        ) : (
          <Wifi className="h-4 w-4 mr-2" />
        )}
        {joined ? "Network applied" : "Join network"}
      </Button>
    </div>
  );
}
