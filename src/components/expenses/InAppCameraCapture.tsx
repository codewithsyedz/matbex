import { useRef, useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Camera, X, RotateCcw, Check, Loader2 } from "lucide-react";

interface InAppCameraCaptureProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
}

export function InAppCameraCapture({ isOpen, onClose, onCapture }: InAppCameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  const [isStreaming, setIsStreaming] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const startCamera = useCallback(async () => {
    setError(null);
    setIsInitializing(true);
    setCapturedImage(null);
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setIsStreaming(true);
      }
    } catch (err) {
      console.error("Camera access error:", err);
      setError("Unable to access camera. Please check permissions or use Gallery instead.");
    } finally {
      setIsInitializing(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      startCamera();
    } else {
      stopStream();
      setCapturedImage(null);
      setError(null);
    }
    
    return () => {
      stopStream();
    };
  }, [isOpen, startCamera, stopStream]);

  const handleCapture = () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      setCapturedImage(dataUrl);
      stopStream();
    }
  };

  const handleRetake = () => {
    setCapturedImage(null);
    startCamera();
  };

  const handleConfirm = async () => {
    if (!capturedImage) return;
    
    // Convert data URL to File
    const response = await fetch(capturedImage);
    const blob = await response.blob();
    const file = new File([blob], `receipt_${Date.now()}.jpg`, { type: "image/jpeg" });
    
    onCapture(file);
    onClose();
  };

  const handleClose = () => {
    stopStream();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent description="Capture a receipt photo using your device camera." className="max-w-lg p-0 overflow-hidden bg-black border-0">
        <div className="relative aspect-[3/4] bg-black">
          {/* Close Button */}
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 z-20 h-10 w-10 rounded-full bg-black/50 text-white hover:bg-black/70"
            onClick={handleClose}
          >
            <X className="h-5 w-5" />
          </Button>

          {/* Video Preview */}
          {!capturedImage && (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
          )}

          {/* Captured Image Preview */}
          {capturedImage && (
            <img
              src={capturedImage}
              alt="Captured"
              className="w-full h-full object-cover"
            />
          )}

          {/* Canvas for capture (hidden) */}
          <canvas ref={canvasRef} className="hidden" />

          {/* Loading State */}
          {isInitializing && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80">
              <div className="text-center text-white">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                <p className="text-sm">Starting camera...</p>
              </div>
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-6">
              <div className="text-center text-white">
                <Camera className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="text-sm mb-4">{error}</p>
                <Button variant="secondary" onClick={handleClose}>
                  Close
                </Button>
              </div>
            </div>
          )}

          {/* Controls */}
          <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/80 to-transparent">
            {!capturedImage && isStreaming && (
              <div className="flex justify-center">
                <button
                  onClick={handleCapture}
                  className="h-16 w-16 rounded-full bg-white flex items-center justify-center shadow-lg active:scale-95 transition-transform"
                  aria-label="Take photo"
                >
                  <Camera className="h-7 w-7 text-black" />
                </button>
              </div>
            )}

            {capturedImage && (
              <div className="flex justify-center gap-6">
                <Button
                  variant="outline"
                  size="lg"
                  className="gap-2 bg-white/10 border-white/30 text-white hover:bg-white/20"
                  onClick={handleRetake}
                >
                  <RotateCcw className="h-4 w-4" />
                  Retake
                </Button>
                <Button
                  size="lg"
                  className="gap-2"
                  onClick={handleConfirm}
                >
                  <Check className="h-4 w-4" />
                  Use Photo
                </Button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
