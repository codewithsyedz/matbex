import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Upload, Save, Trash2, Image as ImageIcon } from "lucide-react";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { withAssetVersion, freshAssetVersion } from "@/lib/assetVersion";
import { FaviconLegibilityPreview } from "@/components/settings/FaviconLegibilityPreview";

type FitMode = "contain" | "cover";

const CANVAS_SIZE = 256;

interface FaviconSettingsProps {
  faviconUrl: string | null;
  onSaved: (url: string | null) => void;
}

/**
 * Upload a custom image and preview the resulting square favicon
 * (padded or cropped, with background + rounding) before saving.
 */
export function FaviconSettings({ faviconUrl, onSaved }: FaviconSettingsProps) {
  const { restaurant } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);
  const [sourceName, setSourceName] = useState<string>("");
  const [fit, setFit] = useState<FitMode>("contain");
  const [background, setBackground] = useState<string>("#FFFFFF");
  const [transparent, setTransparent] = useState(false);
  const [padding, setPadding] = useState(8); // percent
  const [radius, setRadius] = useState(0); // percent
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sourceImage) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = CANVAS_SIZE;
    canvas.width = size;
    canvas.height = size;
    ctx.clearRect(0, 0, size, size);

    const r = (radius / 100) * (size / 2);
    ctx.save();
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(0, 0, size, size, r);
    } else {
      ctx.rect(0, 0, size, size);
    }
    ctx.closePath();
    ctx.clip();

    if (!transparent) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, size, size);
    }

    const pad = (padding / 100) * size;
    const box = size - pad * 2;
    const { width: iw, height: ih } = sourceImage;
    const scale = fit === "contain" ? Math.min(box / iw, box / ih) : Math.max(box / iw, box / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(sourceImage, (size - dw) / 2, (size - dh) / 2, dw, dh);
    ctx.restore();

    setPreviewUrl(canvas.toDataURL("image/png"));
  }, [sourceImage, fit, background, transparent, padding, radius]);

  useEffect(() => {
    draw();
  }, [draw]);

  const handleFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        setSourceImage(img);
        setSourceName(file.name);
      };
      img.onerror = () => toast.error("Could not read that image");
      img.src = e.target?.result as string;
    };
    reader.onerror = () => toast.error("Could not read that image");
    reader.readAsDataURL(file);
  };

  const exportBlob = (size: number): Promise<Blob | null> =>
    new Promise((resolve) => {
      const src = canvasRef.current;
      if (!src) return resolve(null);
      const out = document.createElement("canvas");
      out.width = size;
      out.height = size;
      const ctx = out.getContext("2d");
      if (!ctx) return resolve(null);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(src, 0, 0, size, size);
      out.toBlob((b) => resolve(b), "image/png");
    });

  const handleSave = async () => {
    if (!restaurant?.id || !sourceImage) return;
    setSaving(true);
    try {
      const blob = await exportBlob(64);
      if (!blob) throw new Error("Failed to render favicon");
      const path = `${restaurant.id}/favicon-${Date.now()}.png`;
      const { error } = await db.storage
        .from("restaurant-logos")
        .upload(path, blob, { cacheControl: "3600", upsert: true, contentType: "image/png" });
      if (error) throw error;
      const { data } = db.storage.from("restaurant-logos").getPublicUrl(path);
      onSaved(data.publicUrl);
      applyToDocument(data.publicUrl, { bustCache: true });
      toast.success("Favicon saved");
    } catch (err) {
      console.error("Favicon save failed", err);
      toast.error("Failed to save favicon");
    } finally {
      setSaving(false);
    }
  };

  const previewSizes = useMemo(() => [16, 32, 64], []);

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-5 w-5 text-primary" />
          <CardTitle className="text-base font-medium">Favicon</CardTitle>
        </div>
        <CardDescription>
          Upload any image, adjust how it fills the square, and preview the result before saving.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-6 md:grid-cols-2">
          {/* Upload / source */}
          <div className="space-y-3">
            <Label>Source image</Label>
            <div
              className="border-2 border-dashed border-border rounded-lg p-6 flex flex-col items-center justify-center cursor-pointer hover:border-primary/50 transition-colors min-h-[160px]"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) handleFile(file);
              }}
            >
              {sourceImage ? (
                <img src={sourceImage.src} alt="Selected source" className="max-h-28 max-w-full object-contain" />
              ) : (
                <div className="text-center">
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">Click or drop an image</p>
                  <p className="text-xs text-muted-foreground mt-1">PNG, JPG or SVG</p>
                </div>
              )}
            </div>
            {sourceName && <p className="text-xs text-muted-foreground truncate">{sourceName}</p>}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = "";
              }}
            />
          </div>

          {/* Preview */}
          <div className="space-y-3">
            <Label>Square preview</Label>
            <div className="rounded-lg border border-border/60 bg-muted/30 p-4 flex flex-col items-center gap-4 min-h-[160px] justify-center">
              {previewUrl ? (
                <>
                  <img
                    src={previewUrl}
                    alt="Favicon preview"
                    className="h-24 w-24 rounded-md shadow-sm"
                    style={{ imageRendering: "auto" }}
                  />
                  <div className="flex items-end gap-4">
                    {previewSizes.map((s) => (
                      <div key={s} className="flex flex-col items-center gap-1">
                        <img src={previewUrl} alt={`${s}px preview`} style={{ width: s, height: s }} />
                        <span className="text-[10px] text-muted-foreground">{s}px</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : faviconUrl ? (
                <div className="flex flex-col items-center gap-2">
                  <img src={faviconUrl} alt="Current favicon" className="h-16 w-16 object-contain" />
                  <span className="text-xs text-muted-foreground">Current favicon</span>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Upload an image to see the preview</p>
              )}
            </div>
          </div>
        </div>

        <FaviconLegibilityPreview
          url={previewUrl ?? faviconUrl}
          caption={previewUrl ? "Unsaved preview" : "Current favicon"}
        />

        {sourceImage && (
          <div className="space-y-5 rounded-lg border border-border/40 p-4">
            <div className="grid gap-5 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Fit</Label>
                <Tabs value={fit} onValueChange={(v) => setFit(v as FitMode)}>
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="contain">Pad to square</TabsTrigger>
                    <TabsTrigger value="cover">Crop to square</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              <div className="space-y-2">
                <Label htmlFor="favicon-bg">Background</Label>
                <div className="flex items-center gap-3">
                  <Input
                    id="favicon-bg"
                    type="color"
                    value={background}
                    disabled={transparent}
                    onChange={(e) => setBackground(e.target.value)}
                    className="h-10 w-16 p-1"
                  />
                  <Button
                    type="button"
                    variant={transparent ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTransparent((t) => !t)}
                  >
                    Transparent
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Padding · {padding}%</Label>
                <Slider value={[padding]} min={0} max={30} step={1} onValueChange={([v]) => setPadding(v)} />
              </div>
              <div className="space-y-2">
                <Label>Corner rounding · {radius}%</Label>
                <Slider value={[radius]} min={0} max={100} step={5} onValueChange={([v]) => setRadius(v)} />
              </div>
            </div>
          </div>
        )}

        <canvas ref={canvasRef} className="hidden" />

        <div className="flex flex-wrap gap-2">
          <Button onClick={handleSave} disabled={!sourceImage || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin me-2" /> : <Save className="h-4 w-4 me-2" />}
            Save favicon
          </Button>
          {(faviconUrl || sourceImage) && (
            <Button
              variant="outline"
              onClick={() => {
                setSourceImage(null);
                setSourceName("");
                setPreviewUrl(null);
                if (faviconUrl) onSaved(null);
              }}
            >
              <Trash2 className="h-4 w-4 me-2" />
              {sourceImage ? "Discard" : "Remove favicon"}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Saved as a 64×64 PNG. A new version token is added on every save, so the icon updates without a hard refresh.
        </p>
      </CardContent>
    </Card>
  );
}

export function applyToDocument(url: string | null, opts?: { bustCache?: boolean }) {
  if (typeof document === "undefined" || !url) return;
  const href = opts?.bustCache
    ? withAssetVersion(url, freshAssetVersion())
    : withAssetVersion(url);

  // Remove existing icon links so the browser re-reads the new href instead of
  // reusing the cached resource attached to the old element.
  const existing = Array.from(document.querySelectorAll<HTMLLinkElement>("link[rel~='icon']"));
  const rels = existing.length
    ? Array.from(new Set(existing.map((l) => l.rel)))
    : ["icon"];
  existing.forEach((l) => l.remove());

  rels.forEach((rel) => {
    const link = document.createElement("link");
    link.rel = rel;
    link.type = "image/png";
    link.href = href;
    document.head.appendChild(link);
  });
}