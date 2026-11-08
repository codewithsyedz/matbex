import { useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Eye, EyeOff, QrCode } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { buildWifiQrPayload, type WifiSecurity } from "@/lib/wifiQr";

/**
 * Owner-side generator: renders a standard Wi-Fi QR that kiosk tablets can scan
 * from Actions → Change Wi-Fi → Scan QR to join without leaving kiosk mode.
 * Nothing is stored server-side — the QR is rendered locally on this screen.
 */
export function WifiQrCard({ canManage }: { canManage: boolean }) {
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [security, setSecurity] = useState<WifiSecurity>("WPA");
  const [hidden, setHidden] = useState(false);
  const [reveal, setReveal] = useState(false);

  const payload = useMemo(
    () => (ssid ? buildWifiQrPayload({ ssid, password, security, hidden }) : ""),
    [ssid, password, security, hidden],
  );

  if (!canManage) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <QrCode className="h-5 w-5 text-primary" />
          Wi-Fi QR for kiosk tablets
        </CardTitle>
        <CardDescription>
          Enter the network details to display a QR code. Tablets scan it from Actions → Change
          Wi-Fi → Scan Wi-Fi QR and join without unlocking kiosk mode. Credentials are never saved.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="qr-ssid">Network name (SSID)</Label>
            <Input
              id="qr-ssid"
              value={ssid}
              onChange={(e) => setSsid(e.target.value)}
              placeholder="Restaurant-WiFi"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qr-pass">Password</Label>
            <div className="flex gap-2">
              <Input
                id="qr-pass"
                type={reveal ? "text" : "password"}
                value={password}
                disabled={security === "nopass"}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setReveal((v) => !v)}
              >
                {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Security</Label>
            <Select value={security} onValueChange={(v) => setSecurity(v as WifiSecurity)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-50 bg-popover">
                <SelectItem value="WPA">WPA / WPA2</SelectItem>
                <SelectItem value="WEP">WEP</SelectItem>
                <SelectItem value="nopass">Open (no password)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <Label htmlFor="qr-hidden" className="text-sm font-normal">
              Hidden network
            </Label>
            <Switch id="qr-hidden" checked={hidden} onCheckedChange={setHidden} />
          </div>
        </div>

        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border p-4">
          {payload ? (
            <>
              <div className="rounded-lg bg-white p-3">
                <QRCodeSVG value={payload} size={176} level="M" includeMargin={false} />
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Show this to the tablet camera. Works fully offline.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground text-center">
              Enter a network name to generate the QR code.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
