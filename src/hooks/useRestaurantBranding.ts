import { useState, useEffect, useCallback } from "react";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface RestaurantBranding {
  id: string;
  restaurant_id: string;
  tenant_id: string;
  logo_url: string | null;
  favicon_url: string | null;
  business_display_name: string | null;
  tagline: string | null;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  background_color: string;
  text_color: string;
  created_at: string;
  updated_at: string;
}

const defaultBranding: Omit<RestaurantBranding, 'id' | 'restaurant_id' | 'tenant_id' | 'created_at' | 'updated_at'> = {
  logo_url: null,
  favicon_url: null,
  business_display_name: null,
  tagline: null,
  primary_color: "#10B981",
  secondary_color: "#059669",
  accent_color: "#34D399",
  background_color: "#FFFFFF",
  text_color: "#1F2937",
};

export function useRestaurantBranding() {
  const { restaurant, tenant } = useAuth();
  const restaurantId = restaurant?.id;
  const tenantId = tenant?.id;
  const [branding, setBranding] = useState<RestaurantBranding | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchBranding = useCallback(async () => {
    if (!restaurantId) {
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await db
        .from("restaurant_branding")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .maybeSingle();

      if (error) throw error;
      setBranding(data);
    } catch (error) {
      console.error("Error fetching branding:", error);
    } finally {
      setLoading(false);
    }
  }, [restaurantId]);

  useEffect(() => {
    fetchBranding();
  }, [fetchBranding]);

  const saveBranding = async (updates: Partial<RestaurantBranding>) => {
    if (!restaurantId || !tenantId) {
      toast.error("Restaurant context required");
      return false;
    }

    setSaving(true);
    try {
      if (branding) {
        // Update existing
        const { error } = await db
          .from("restaurant_branding")
          .update({
            ...updates,
            updated_at: new Date().toISOString(),
          })
          .eq("id", branding.id);

        if (error) throw error;
      } else {
        // Create new
        const { error } = await db
          .from("restaurant_branding")
          .insert({
            restaurant_id: restaurantId,
            tenant_id: tenantId,
            ...defaultBranding,
            ...updates,
          });

        if (error) throw error;
      }

      await fetchBranding();
      toast.success("Branding saved successfully");
      return true;
    } catch (error) {
      console.error("Error saving branding:", error);
      toast.error("Failed to save branding");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (file: File, type: 'logo' | 'favicon' = 'logo'): Promise<string | null> => {
    if (!restaurantId) return null;

    try {
      // Resize image for optimization
      const resizedFile = await resizeImage(file, type === 'favicon' ? 64 : 400);
      
      const fileExt = 'png';
      const fileName = `${restaurantId}/${type}-${Date.now()}.${fileExt}`;

      const { error: uploadError } = await db.storage
        .from("restaurant-logos")
        .upload(fileName, resizedFile, {
          cacheControl: "3600",
          upsert: true,
        });

      if (uploadError) throw uploadError;

      const { data: urlData } = db.storage
        .from("restaurant-logos")
        .getPublicUrl(fileName);

      return urlData.publicUrl;
    } catch (error) {
      console.error("Error uploading logo:", error);
      toast.error("Failed to upload image");
      return null;
    }
  };

  const resizeImage = (file: File, maxSize: number): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          let { width, height } = img;

          if (width > height) {
            if (width > maxSize) {
              height = (height * maxSize) / width;
              width = maxSize;
            }
          } else {
            if (height > maxSize) {
              width = (width * maxSize) / height;
              height = maxSize;
            }
          }

          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Failed to get canvas context"));
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob(
            (blob) => {
              if (blob) resolve(blob);
              else reject(new Error("Failed to create blob"));
            },
            "image/png",
            0.9
          );
        };
        img.onerror = reject;
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  return {
    branding,
    loading,
    saving,
    saveBranding,
    uploadLogo,
    refetch: fetchBranding,
    defaultBranding,
  };
}
