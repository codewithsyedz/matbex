import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Image, Upload, X } from "lucide-react";
import { db } from "@/integrations/db/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

interface HeroEditorProps {
  heroTitle: string;
  heroSubtitle: string;
  heroImageUrl: string | null;
  onTitleChange: (title: string) => void;
  onSubtitleChange: (subtitle: string) => void;
  onImageChange: (url: string | null) => void;
}

export function HeroEditor({
  heroTitle,
  heroSubtitle,
  heroImageUrl,
  onTitleChange,
  onSubtitleChange,
  onImageChange,
}: HeroEditorProps) {
  const { tenant } = useAuth();
  const tenantId = tenant?.id;
  const [isUploading, setIsUploading] = useState(false);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !tenantId) return;

    // Validate file type and size
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be less than 5MB");
      return;
    }

    setIsUploading(true);
    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `${tenantId}/hero-${Date.now()}.${fileExt}`;

      const { error: uploadError } = await db.storage
        .from("tenant-assets")
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = db.storage
        .from("tenant-assets")
        .getPublicUrl(fileName);

      onImageChange(publicUrl);
      toast.success("Hero image uploaded!");
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Failed to upload image");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-md bg-primary/10">
            <Image className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-base font-medium">Hero Section</CardTitle>
            <CardDescription>
              The visual anchor of your landing experience
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Hero Image */}
        <div className="space-y-2">
          <Label>Background Image</Label>
          <div className="relative">
            {heroImageUrl ? (
              <div className="relative aspect-video rounded-lg overflow-hidden border bg-muted">
                <img
                  src={heroImageUrl}
                  alt="Hero background"
                  className="w-full h-full object-cover"
                />
                <Button
                  variant="destructive"
                  size="icon"
                  className="absolute top-2 right-2 h-8 w-8"
                  onClick={() => onImageChange(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center aspect-video rounded-lg border-2 border-dashed border-muted-foreground/25 hover:border-primary/50 transition-colors cursor-pointer bg-muted/50">
                <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                <span className="text-sm text-muted-foreground">
                  {isUploading ? "Processing..." : "Awaiting your visual. Upload a hero image to begin."}
                </span>
                <span className="text-xs text-muted-foreground mt-1">
                  Optimal: 1920×1080px, max 5MB
                </span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageUpload}
                  disabled={isUploading}
                />
              </label>
            )}
          </div>
        </div>

        {/* Hero Title */}
        <div className="space-y-2">
          <Label htmlFor="hero-title">Headline</Label>
          <Input
            id="hero-title"
            value={heroTitle}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="Welcome to Our Restaurant"
            maxLength={60}
          />
          <p className="text-xs text-muted-foreground">
            {heroTitle.length}/60 characters
          </p>
        </div>

        {/* Hero Subtitle */}
        <div className="space-y-2">
          <Label htmlFor="hero-subtitle">Tagline</Label>
          <Textarea
            id="hero-subtitle"
            value={heroSubtitle}
            onChange={(e) => onSubtitleChange(e.target.value)}
            placeholder="Experience culinary excellence in the heart of the city"
            maxLength={160}
            rows={2}
          />
          <p className="text-xs text-muted-foreground">
            {heroSubtitle.length}/160 characters
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
