import { forwardRef, useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Camera, Loader2, Upload, X, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { InAppCameraCapture } from "./InAppCameraCapture";
import { useQuota } from "@/hooks/useQuota";

export interface ReceiptUploaderFieldProps {
  receiptUrl: string | null;
  onReceiptChange: (url: string | null) => void;
  restaurantId: string;
  disabled?: boolean;
  onUploadingChange?: (uploading: boolean) => void;
}

/**
 * Mobile-safe receipt uploader.
 * Uses in-app camera capture (getUserMedia) to avoid page refresh issues on mobile.
 * Falls back to native file input for gallery selection.
 */
export const ReceiptUploaderField = forwardRef<HTMLDivElement, ReceiptUploaderFieldProps>(
  (
    { receiptUrl, onReceiptChange, restaurantId, disabled = false, onUploadingChange },
    ref
  ) => {
    const [isUploading, setIsUploading] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(receiptUrl);
    const [isCameraOpen, setIsCameraOpen] = useState(false);
    const [supportsCamera, setSupportsCamera] = useState(false);
    const { checkQuota, incrementUsage, isAtLimit, isNearLimit } = useQuota();

    // Check if getUserMedia is supported
    useEffect(() => {
      setSupportsCamera(
        typeof navigator !== "undefined" &&
        !!navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === "function"
      );
    }, []);

    // Generate signed URL when receiptUrl changes (for viewing existing receipts)
    // Skip if we already have a valid preview URL (e.g., from a fresh upload)
    useEffect(() => {
      const generateSignedUrl = async () => {
        if (!receiptUrl) {
          setPreviewUrl(null);
          return;
        }
        
        // If previewUrl is already a valid signed URL, keep it
        if (previewUrl && previewUrl.includes('token=')) {
          return;
        }
        
        // If it's already a signed URL or a blob URL, use it directly
        if (receiptUrl.includes('token=') || receiptUrl.startsWith('blob:')) {
          setPreviewUrl(receiptUrl);
          return;
        }
        
        // Extract the file path and generate a signed URL
        try {
          let filePath = receiptUrl;
          // Handle both formats: "expense-receipts/path" and full URLs
          if (receiptUrl.includes('expense-receipts/')) {
            filePath = receiptUrl.split('expense-receipts/').pop() || receiptUrl;
          }
          
          const { data, error } = await supabase.storage
            .from('expense-receipts')
            .createSignedUrl(filePath, 3600);
          
          if (error) {
            console.error('Error generating signed URL:', error);
            setPreviewUrl(null);
            return;
          }
          
          setPreviewUrl(data.signedUrl);
        } catch (err) {
          console.error('Error generating signed URL:', err);
          setPreviewUrl(null);
        }
      };
      
      generateSignedUrl();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [receiptUrl]);

    useEffect(() => {
      onUploadingChange?.(isUploading);
    }, [isUploading, onUploadingChange]);

    const handleFileUpload = useCallback(async (file: File) => {
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        toast.error("Please select an image file");
        return;
      }

      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        toast.error("Image must be less than 5MB");
        return;
      }

      // Check image upload quota
      const quotaCheck = await checkQuota("image_uploads");
      if (!quotaCheck.allowed) {
        toast.error(`Image upload limit reached (${quotaCheck.current}/${quotaCheck.limit}). Please upgrade your plan.`);
        return;
      }

      setIsUploading(true);
      try {
        const timestamp = Date.now();
        const fileExt = (file.name.split(".").pop() || "jpg").toLowerCase();
        const fileName = `${restaurantId}/${timestamp}.${fileExt}`;

        const { data, error } = await supabase.storage
          .from("expense-receipts")
          .upload(fileName, file, { cacheControl: "3600", upsert: false });
        if (error) throw error;

        // Store the file path (not a public URL) since the bucket is now private
        // The path can be used to generate signed URLs when viewing
        const storedPath = data.path;
        
        // Generate a signed URL for immediate preview (1 hour expiry)
        const { data: signedData, error: signError } = await supabase.storage
          .from("expense-receipts")
          .createSignedUrl(storedPath, 3600);
        
        if (signError) throw signError;
        
        setPreviewUrl(signedData.signedUrl);
        // Store the path reference (not the signed URL) for persistence
        // Format: bucket path that can be used to generate signed URLs later
        onReceiptChange(`expense-receipts/${storedPath}`);
        
        // Increment usage counter
        await incrementUsage("image_uploads");
        
        toast.success("Receipt uploaded");
      } catch (error) {
        console.error("Receipt upload error:", error);
        toast.error("Failed to upload receipt");
      } finally {
        setIsUploading(false);
      }
    }, [restaurantId, onReceiptChange, checkQuota, incrementUsage]);

    const handleRemoveReceipt = async () => {
      if (receiptUrl) {
        // Handle both formats: "expense-receipts/path" and full URLs
        let filePath = receiptUrl;
        if (receiptUrl.includes("expense-receipts/")) {
          filePath = receiptUrl.split("expense-receipts/").pop() || receiptUrl;
        }
        if (filePath) {
          await supabase.storage.from("expense-receipts").remove([filePath]);
        }
      }
      setPreviewUrl(null);
      onReceiptChange(null);
    };

    const inputDisabled = disabled || isUploading;

    const handleGalleryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFileUpload(file);
      // allow picking the same file again
      e.target.value = "";
    };

    const handleCameraCapture = (file: File) => {
      handleFileUpload(file);
    };

    const handleCameraClick = () => {
      if (supportsCamera) {
        setIsCameraOpen(true);
      }
    };

    return (
      <div ref={ref} className="space-y-2">
        <Label className="text-sm">Receipt Photo (Optional)</Label>

        {previewUrl ? (
          <div className="relative">
            <div className="relative rounded-lg overflow-hidden border border-border bg-muted">
              <img
                src={previewUrl}
                alt="Receipt"
                className="w-full h-32 object-cover"
                loading="lazy"
              />
              <Button
                type="button"
                variant="destructive"
                size="icon"
                className="absolute top-2 right-2 h-7 w-7"
                onClick={handleRemoveReceipt}
                disabled={inputDisabled}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {/* Camera - uses in-app capture on supported devices */}
            {supportsCamera ? (
              <button
                type="button"
                onClick={handleCameraClick}
                disabled={inputDisabled}
                className={cn(
                  "h-20 flex flex-col items-center justify-center gap-1 rounded-md border border-input bg-background cursor-pointer hover:bg-accent hover:text-accent-foreground transition-colors",
                  inputDisabled && "opacity-50 pointer-events-none"
                )}
              >
                {isUploading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Camera className="h-5 w-5" />
                )}
                <span className="text-xs">Camera</span>
              </button>
            ) : (
              // Fallback to native capture for browsers without getUserMedia
              <label
                className={cn(
                  "h-20 flex flex-col items-center justify-center gap-1 rounded-md border border-input bg-background cursor-pointer hover:bg-accent hover:text-accent-foreground transition-colors",
                  inputDisabled && "opacity-50 pointer-events-none"
                )}
              >
                {isUploading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Camera className="h-5 w-5" />
                )}
                <span className="text-xs">Camera</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  disabled={inputDisabled}
                  onChange={handleGalleryChange}
                />
              </label>
            )}

            {/* Gallery */}
            <label
              className={cn(
                "h-20 flex flex-col items-center justify-center gap-1 rounded-md border border-input bg-background cursor-pointer hover:bg-accent hover:text-accent-foreground transition-colors",
                inputDisabled && "opacity-50 pointer-events-none"
              )}
            >
              {isUploading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Upload className="h-5 w-5" />
              )}
              <span className="text-xs">Gallery</span>
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={inputDisabled}
                onChange={handleGalleryChange}
              />
            </label>
          </div>
        )}

        {/* In-App Camera Modal */}
        <InAppCameraCapture
          isOpen={isCameraOpen}
          onClose={() => setIsCameraOpen(false)}
          onCapture={handleCameraCapture}
        />
      </div>
    );
  }
);

ReceiptUploaderField.displayName = "ReceiptUploaderField";
