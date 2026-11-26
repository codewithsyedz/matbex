import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { db } from "@/integrations/db/client";
import { cn } from "@/lib/utils";
import { Camera, Loader2, Upload, X, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { InAppCameraCapture } from "@/components/expenses/InAppCameraCapture";

export interface InvoiceImageUploaderProps {
  imageUrl: string | null;
  onImageChange: (url: string | null) => void;
  restaurantId: string;
  disabled?: boolean;
}

/**
 * Invoice image uploader component.
 * Allows uploading invoice/receipt images via camera or file picker.
 */
export function InvoiceImageUploader({
  imageUrl,
  onImageChange,
  restaurantId,
  disabled = false,
}: InvoiceImageUploaderProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [supportsCamera, setSupportsCamera] = useState(false);

  // Check if getUserMedia is supported
  useEffect(() => {
    setSupportsCamera(
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === "function"
    );
  }, []);

  // Generate signed URL when imageUrl changes
  useEffect(() => {
    const generateSignedUrl = async () => {
      if (!imageUrl) {
        setPreviewUrl(null);
        return;
      }

      // If previewUrl is already a valid signed URL, keep it
      if (previewUrl && previewUrl.includes("token=")) {
        return;
      }

      // If it's already a signed URL or a blob URL, use it directly
      if (imageUrl.includes("token=") || imageUrl.startsWith("blob:")) {
        setPreviewUrl(imageUrl);
        return;
      }

      try {
        let filePath = imageUrl;
        if (imageUrl.includes("invoice-images/")) {
          filePath = imageUrl.split("invoice-images/").pop() || imageUrl;
        }

        const { data, error } = await db.storage
          .from("invoice-images")
          .createSignedUrl(filePath, 3600);

        if (error) {
          console.error("Error generating signed URL:", error);
          setPreviewUrl(null);
          return;
        }

        setPreviewUrl(data.signedUrl);
      } catch (err) {
        console.error("Error generating signed URL:", err);
        setPreviewUrl(null);
      }
    };

    generateSignedUrl();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  const handleFileUpload = useCallback(
    async (file: File) => {
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

      setIsUploading(true);
      try {
        const timestamp = Date.now();
        const fileExt = (file.name.split(".").pop() || "jpg").toLowerCase();
        const fileName = `${restaurantId}/${timestamp}.${fileExt}`;

        const { data, error } = await db.storage
          .from("invoice-images")
          .upload(fileName, file, { cacheControl: "3600", upsert: false });
        if (error) throw error;

        const storedPath = data.path;

        // Generate a signed URL for immediate preview
        const { data: signedData, error: signError } = await db.storage
          .from("invoice-images")
          .createSignedUrl(storedPath, 3600);

        if (signError) throw signError;

        setPreviewUrl(signedData.signedUrl);
        onImageChange(`invoice-images/${storedPath}`);

        toast.success("Invoice image uploaded");
      } catch (error) {
        console.error("Invoice image upload error:", error);
        toast.error("Failed to upload image");
      } finally {
        setIsUploading(false);
      }
    },
    [restaurantId, onImageChange]
  );

  const handleRemoveImage = async () => {
    if (imageUrl) {
      let filePath = imageUrl;
      if (imageUrl.includes("invoice-images/")) {
        filePath = imageUrl.split("invoice-images/").pop() || imageUrl;
      }
      if (filePath) {
        await db.storage.from("invoice-images").remove([filePath]);
      }
    }
    setPreviewUrl(null);
    onImageChange(null);
  };

  const inputDisabled = disabled || isUploading;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
    e.target.value = "";
  };

  const handleCameraCapture = (file: File) => {
    handleFileUpload(file);
  };

  return (
    <div className="space-y-2">
      <Label className="text-sm">Invoice Image (Optional)</Label>

      {previewUrl ? (
        <div className="relative">
          <div className="relative rounded-lg overflow-hidden border border-border bg-muted">
            <img
              src={previewUrl}
              alt="Invoice"
              className="w-full h-32 object-cover"
              loading="lazy"
            />
            <Button
              type="button"
              variant="destructive"
              size="icon"
              className="absolute top-2 right-2 h-7 w-7"
              onClick={handleRemoveImage}
              disabled={inputDisabled}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {/* Camera */}
          {supportsCamera ? (
            <button
              type="button"
              onClick={() => setIsCameraOpen(true)}
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
                onChange={handleFileChange}
              />
            </label>
          )}

          {/* Gallery/File picker */}
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
              onChange={handleFileChange}
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
