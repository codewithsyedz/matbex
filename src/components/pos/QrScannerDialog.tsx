import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Loader2 } from "lucide-react";

interface QrScannerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (value: string) => void;
  title?: string;
  description?: string;
}

const REGION_ID = "matbex-qr-scanner-region";

/**
 * Camera-based QR scanner using html5-qrcode. Works in Capacitor WebView
 * (Android/iOS) and in modern browsers that support getUserMedia.
 */
export function QrScannerDialog({
  open,
  onOpenChange,
  onScan,
  title = "Scan Workspace QR",
  description = "Point the camera at the Workspace code QR shown in Settings → Security.",
}: QrScannerDialogProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setError(null);
    setStarting(true);

    const start = async () => {
      try {
        // Wait a tick for the dialog DOM node to mount.
        await new Promise((r) => setTimeout(r, 50));
        if (cancelled) return;

        // Ask for the camera explicitly first: inside the Android WebView a missing
        // CAMERA permission fails silently and html5-qrcode just renders a blank box.
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            "This device/browser does not expose a camera to the app. Enter the Workspace code manually instead.",
          );
        }
        try {
          const probe = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment" },
          });
          probe.getTracks().forEach((t) => t.stop());
        } catch (permErr: any) {
          const name = permErr?.name ?? "";
          if (name === "NotAllowedError" || name === "SecurityError") {
            throw new Error(
              "Camera access is blocked for Matbex. Open Android Settings → Apps → Matbex → Permissions → Camera → Allow, then try again. You can also type the Workspace code manually.",
            );
          }
          if (name === "NotFoundError" || name === "OverconstrainedError") {
            throw new Error(
              "No usable camera was found on this device. Enter the Workspace code manually instead.",
            );
          }
          throw permErr;
        }
        if (cancelled) return;

        const instance = new Html5Qrcode(REGION_ID, { verbose: false });
        scannerRef.current = instance;

        await instance.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decodedText) => {
            const value = decodedText.trim();
            if (!value) return;
            // Fire once, then close.
            onScan(value);
            onOpenChange(false);
          },
          () => {
            // Per-frame decode errors are noisy — ignore.
          },
        );
      } catch (err: any) {
        if (!cancelled) {
          setError(
            err?.message ??
              "Unable to access the camera. Grant camera permission and try again.",
          );
        }
      } finally {
        if (!cancelled) setStarting(false);
      }
    };

    start();

    return () => {
      cancelled = true;
      const inst = scannerRef.current;
      scannerRef.current = null;
      if (inst) {
        inst
          .stop()
          .catch(() => {})
          .finally(() => {
            try {
              inst.clear();
            } catch {
              /* noop */
            }
          });
      }
    };
  }, [open, onScan, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {error ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
          <div className="relative overflow-hidden rounded-xl bg-black">
            <div id={REGION_ID} className="w-full aspect-square" />
            {starting && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}