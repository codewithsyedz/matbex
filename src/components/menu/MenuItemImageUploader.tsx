import { useState, useRef } from "react";
import { toCdnUrl } from "@/lib/imageCdn";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Upload, X, ImageIcon, Loader2 } from "lucide-react";
import { useQuota } from "@/hooks/useQuota";

interface MenuItemImageUploaderProps {
  currentImageUrl?: string | null;
  onImageUploaded: (url: string | null) => void;
  restaurantId: string;
  menuItemId?: string;
}

// Resize and compress image based on orientation
const resizeImage = (
  file: File,
  maxSize: number = 400,
  quality: number = 0.8
): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    img.onload = () => {
      let { width, height } = img;
      const aspectRatio = width / height;

      // Resize based on orientation while maintaining aspect ratio
      if (aspectRatio > 1) {
        // Landscape: constrain by width
        if (width > maxSize) {
          width = maxSize;
          height = Math.round(maxSize / aspectRatio);
        }
      } else if (aspectRatio < 1) {
        // Portrait: constrain by height
        if (height > maxSize) {
          height = maxSize;
          width = Math.round(maxSize * aspectRatio);
        }
      } else {
        // Square: constrain both equally
        if (width > maxSize) {
          width = maxSize;
          height = maxSize;
        }
      }

      canvas.width = width;
      canvas.height = height;

      // Draw and compress
      ctx?.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("Failed to create blob"));
          }
        },
        "image/jpeg",
        quality
      );
    };

    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = URL.createObjectURL(file);
  });
};

export function MenuItemImageUploader({
  currentImageUrl,
  onImageUploaded,
  restaurantId,
  menuItemId,
}: MenuItemImageUploaderProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentImageUrl || null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { checkQuota, incrementUsage } = useQuota();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }

    // Validate file size (max 10MB before compression)
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Image must be less than 10MB");
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
      // Resize and compress the image
      const resizedBlob = await resizeImage(file, 400, 0.85);
      
      // Generate unique filename
      const fileName = `${restaurantId}/${menuItemId || "new"}-${Date.now()}.jpg`;

      // Upload to Supabase storage
      const { error: uploadError } = await supabase.storage
        .from("menu-images")
        .upload(fileName, resizedBlob, { 
          upsert: true,
          contentType: "image/jpeg"
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from("menu-images")
        .getPublicUrl(fileName);

      // Persist/preview the CDN-hosted URL so records and the UI never leak the
      // raw backend storage host. Existing rows are normalized again at render.
      const cdnUrl = toCdnUrl(publicUrl) as string;
      setPreviewUrl(cdnUrl);
      onImageUploaded(cdnUrl);
      
      // Increment usage counter
      await incrementUsage("image_uploads");
      
      toast.success("Image uploaded & optimized");
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Failed to upload image");
    } finally {
      setIsUploading(false);
      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleRemove = () => {
    setPreviewUrl(null);
    onImageUploaded(null);
  };

  return (
    <div className="space-y-2">
      {previewUrl ? (
        <div className="relative w-full aspect-video rounded-lg overflow-hidden border bg-muted">
          <img
            src={previewUrl}
            alt="Menu item"
            className="w-full h-full object-cover"
          />
          <Button
            type="button"
            variant="destructive"
            size="icon"
            className="absolute top-2 right-2 h-7 w-7"
            onClick={handleRemove}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <label className="flex flex-col items-center justify-center w-full aspect-video border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/50 transition-colors">
          <div className="flex flex-col items-center justify-center py-4">
            {isUploading ? (
              <div className="flex flex-col items-center text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin mb-2" />
                <span className="text-sm">Optimizing...</span>
              </div>
            ) : (
              <>
                <ImageIcon className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Click to upload image</p>
                <p className="text-xs text-muted-foreground mt-1">Auto-resized to 400×400</p>
              </>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/*"
            onChange={handleFileChange}
            disabled={isUploading}
          />
        </label>
      )}
    </div>
  );
}
