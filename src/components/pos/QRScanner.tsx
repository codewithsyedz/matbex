import { useState, useEffect, useRef, useCallback } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Camera, Keyboard, X } from "lucide-react";
import { toast } from "sonner";

interface QRData {
  restaurantId: string;
  menuItemId: string;
  name: string;
  size: "quarter" | "half" | "full";
  price: number;
}

interface QRScannerProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (data: QRData) => void;
  restaurantId: string;
}

export function QRScanner({ isOpen, onClose, onScan, restaurantId }: QRScannerProps) {
  const [activeTab, setActiveTab] = useState<"camera" | "manual">("camera");
  const [manualInput, setManualInput] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const processQRData = useCallback((qrString: string): boolean => {
    try {
      const data: QRData = JSON.parse(qrString);
      
      // Validate the data structure
      if (!data.menuItemId || !data.name || !data.size || typeof data.price !== "number") {
        toast.error("Invalid QR code format");
        return false;
      }
      
      // Check if it belongs to this restaurant
      if (data.restaurantId !== restaurantId) {
        toast.error("QR code from different restaurant");
        return false;
      }
      
      onScan(data);
      toast.success(`Added: ${data.name} (${data.size})`);
      return true;
    } catch {
      toast.error("Could not read QR code");
      return false;
    }
  }, [onScan, restaurantId]);

  const startScanner = useCallback(async () => {
    if (!containerRef.current || scannerRef.current) return;
    
    try {
      const scanner = new Html5Qrcode("qr-reader");
      scannerRef.current = scanner;
      setIsScanning(true);
      
      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
        },
        (decodedText) => {
          if (processQRData(decodedText)) {
            // Continue scanning for more items
          }
        },
        () => {
          // Ignore errors during scanning
        }
      );
    } catch (err) {
      console.error("Failed to start scanner:", err);
      toast.error("Could not access camera");
      setIsScanning(false);
    }
  }, [processQRData]);

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch {
        // Ignore cleanup errors
      }
      scannerRef.current = null;
      setIsScanning(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && activeTab === "camera") {
      // Delay to allow DOM to render
      const timer = setTimeout(() => {
        startScanner();
      }, 100);
      return () => clearTimeout(timer);
    } else {
      stopScanner();
    }
    
    return () => {
      stopScanner();
    };
  }, [isOpen, activeTab, startScanner, stopScanner]);

  // Handle external scanner input (keyboard emulation)
  useEffect(() => {
    if (!isOpen || activeTab !== "manual") return;
    
    let buffer = "";
    let timeout: ReturnType<typeof setTimeout>;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      // External scanners typically end with Enter
      if (e.key === "Enter" && buffer.length > 0) {
        processQRData(buffer);
        buffer = "";
        setManualInput("");
        return;
      }
      
      // Ignore modifier keys
      if (e.key.length === 1) {
        buffer += e.key;
        setManualInput(buffer);
        
        // Clear buffer after 100ms of no input (scanner is fast)
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          buffer = "";
        }, 100);
      }
    };
    
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      clearTimeout(timeout);
    };
  }, [isOpen, activeTab, processQRData]);

  const handleManualSubmit = () => {
    if (manualInput.trim()) {
      processQRData(manualInput.trim());
      setManualInput("");
    }
  };

  const handleClose = () => {
    stopScanner();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent description="Scan a QR code with your device camera to capture a value." className="max-w-md">
        <DialogHeader>
          <DialogTitle>Scan QR Code</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "camera" | "manual")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="camera" className="gap-2">
              <Camera className="h-4 w-4" />
              Camera
            </TabsTrigger>
            <TabsTrigger value="manual" className="gap-2">
              <Keyboard className="h-4 w-4" />
              Scanner Input
            </TabsTrigger>
          </TabsList>

          <TabsContent value="camera" className="mt-4">
            <div
              ref={containerRef}
              id="qr-reader"
              className="w-full aspect-square bg-muted rounded-lg overflow-hidden"
            />
            {!isScanning && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/80">
                <p className="text-sm text-muted-foreground">Starting camera...</p>
              </div>
            )}
            <p className="text-xs text-muted-foreground text-center mt-2">
              Point camera at QR code on menu item
            </p>
          </TabsContent>

          <TabsContent value="manual" className="mt-4 space-y-4">
            <div className="p-8 border-2 border-dashed rounded-lg text-center">
              <Keyboard className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm font-medium">External Scanner Ready</p>
              <p className="text-xs text-muted-foreground mt-1">
                Scan with USB/Bluetooth barcode scanner
              </p>
            </div>
            
            <div className="space-y-2">
              <Label>Or paste QR data manually</Label>
              <div className="flex gap-2">
                <Input
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  placeholder="Paste scanned data..."
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleManualSubmit();
                    }
                  }}
                />
                <Button onClick={handleManualSubmit} disabled={!manualInput.trim()}>
                  Add
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={handleClose}>
            <X className="h-4 w-4 mr-2" />
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
