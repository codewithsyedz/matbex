import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useRestaurantBranding, RestaurantBranding } from "@/hooks/useRestaurantBranding";
import { FaviconSettings, applyToDocument } from "@/components/settings/FaviconSettings";
import { Loader2, Upload, Palette, Type, Image as ImageIcon, Save, RotateCcw } from "lucide-react";

const COLOR_PRESETS = [
  { name: "Emerald", primary: "#10B981", secondary: "#059669", accent: "#34D399" },
  { name: "Blue", primary: "#3B82F6", secondary: "#2563EB", accent: "#60A5FA" },
  { name: "Purple", primary: "#8B5CF6", secondary: "#7C3AED", accent: "#A78BFA" },
  { name: "Rose", primary: "#F43F5E", secondary: "#E11D48", accent: "#FB7185" },
  { name: "Amber", primary: "#F59E0B", secondary: "#D97706", accent: "#FBBF24" },
  { name: "Teal", primary: "#14B8A6", secondary: "#0D9488", accent: "#2DD4BF" },
];

export function BrandingSettings() {
  const { branding, loading, saving, saveBranding, uploadLogo, defaultBranding } = useRestaurantBranding();
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState<Partial<RestaurantBranding>>({
    logo_url: null,
    favicon_url: null,
    business_display_name: "",
    tagline: "",
    primary_color: defaultBranding.primary_color,
    secondary_color: defaultBranding.secondary_color,
    accent_color: defaultBranding.accent_color,
    background_color: defaultBranding.background_color,
    text_color: defaultBranding.text_color,
  });

  const [uploading, setUploading] = useState<'logo' | 'favicon' | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (branding) {
      setFormData({
        logo_url: branding.logo_url,
        favicon_url: branding.favicon_url,
        business_display_name: branding.business_display_name || "",
        tagline: branding.tagline || "",
        primary_color: branding.primary_color,
        secondary_color: branding.secondary_color,
        accent_color: branding.accent_color,
        background_color: branding.background_color,
        text_color: branding.text_color,
      });
      applyToDocument(branding.favicon_url);
    }
  }, [branding]);

  const handleChange = (field: keyof RestaurantBranding, value: string | null) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  const handleImageUpload = async (file: File, type: 'logo' | 'favicon') => {
    setUploading(type);
    const url = await uploadLogo(file, type);
    if (url) {
      const field = type === 'logo' ? 'logo_url' : 'favicon_url';
      handleChange(field, url);
    }
    setUploading(null);
  };

  const applyPreset = (preset: typeof COLOR_PRESETS[0]) => {
    setFormData(prev => ({
      ...prev,
      primary_color: preset.primary,
      secondary_color: preset.secondary,
      accent_color: preset.accent,
    }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    const success = await saveBranding(formData);
    if (success) {
      setHasChanges(false);
    }
  };

  const handleReset = () => {
    if (branding) {
      setFormData({
        logo_url: branding.logo_url,
        favicon_url: branding.favicon_url,
        business_display_name: branding.business_display_name || "",
        tagline: branding.tagline || "",
        primary_color: branding.primary_color,
        secondary_color: branding.secondary_color,
        accent_color: branding.accent_color,
        background_color: branding.background_color,
        text_color: branding.text_color,
      });
    } else {
      setFormData({
        logo_url: null,
        favicon_url: null,
        business_display_name: "",
        tagline: "",
        ...defaultBranding,
      });
    }
    setHasChanges(false);
  };

  if (loading) {
    return (
      <Card className="border-border/40">
        <CardContent className="pt-6 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Logo & Favicon */}
      <Card className="border-border/40">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5 text-primary" />
            <CardTitle className="text-base font-medium">Logo</CardTitle>
          </div>
          <CardDescription>
            Upload your restaurant logo for branding across the app
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-6">
            {/* Logo Upload */}
            <div className="space-y-3">
              <Label>Restaurant Logo</Label>
              <div 
                className="border-2 border-dashed border-border rounded-lg p-6 flex flex-col items-center justify-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => logoInputRef.current?.click()}
              >
                {formData.logo_url ? (
                  <img 
                    src={formData.logo_url} 
                    alt="Logo preview" 
                    className="max-h-24 max-w-full object-contain"
                  />
                ) : (
                  <div className="text-center">
                    <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">Click to upload logo</p>
                    <p className="text-xs text-muted-foreground mt-1">PNG, JPG up to 5MB</p>
                  </div>
                )}
                {uploading === 'logo' && (
                  <Loader2 className="h-6 w-6 animate-spin text-primary mt-2" />
                )}
              </div>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImageUpload(file, 'logo');
                }}
              />
              {formData.logo_url && (
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => handleChange('logo_url', null)}
                >
                  Remove Logo
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Favicon panel with square preview */}
      <FaviconSettings
        faviconUrl={formData.favicon_url ?? null}
        onSaved={(url) => handleChange('favicon_url', url)}
      />

      {/* Business Info */}
      <Card className="border-border/40">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Type className="h-5 w-5 text-blue-500" />
            <CardTitle className="text-base font-medium">Business Info</CardTitle>
          </div>
          <CardDescription>
            Customize how your business name appears
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="business_name">Display Name</Label>
            <Input
              id="business_name"
              value={formData.business_display_name || ""}
              onChange={(e) => handleChange('business_display_name', e.target.value)}
              placeholder="e.g., Joe's Diner"
            />
            <p className="text-xs text-muted-foreground">
              This name appears in headers, receipts, and customer-facing pages
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tagline">Tagline</Label>
            <Input
              id="tagline"
              value={formData.tagline || ""}
              onChange={(e) => handleChange('tagline', e.target.value)}
              placeholder="e.g., Best burgers in town since 1985"
            />
          </div>
        </CardContent>
      </Card>

      {/* Color Theme */}
      <Card className="border-border/40">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Palette className="h-5 w-5 text-purple-500" />
            <CardTitle className="text-base font-medium">Color Theme</CardTitle>
          </div>
          <CardDescription>
            Customize your brand colors for the dashboard and customer pages
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Presets */}
          <div className="space-y-3">
            <Label>Quick Presets</Label>
            <div className="flex flex-wrap gap-2">
              {COLOR_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => applyPreset(preset)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:border-primary/50 transition-colors"
                >
                  <div 
                    className="h-4 w-4 rounded-full" 
                    style={{ backgroundColor: preset.primary }}
                  />
                  <span className="text-sm">{preset.name}</span>
                </button>
              ))}
            </div>
          </div>

          <Separator />

          {/* Custom Colors */}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="primary_color">Primary Color</Label>
              <div className="flex gap-2">
                <input
                  type="color"
                  id="primary_color"
                  value={formData.primary_color || "#10B981"}
                  onChange={(e) => handleChange('primary_color', e.target.value)}
                  className="h-10 w-12 rounded border border-input cursor-pointer"
                />
                <Input
                  value={formData.primary_color || ""}
                  onChange={(e) => handleChange('primary_color', e.target.value)}
                  placeholder="#10B981"
                  className="flex-1"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="secondary_color">Secondary Color</Label>
              <div className="flex gap-2">
                <input
                  type="color"
                  id="secondary_color"
                  value={formData.secondary_color || "#059669"}
                  onChange={(e) => handleChange('secondary_color', e.target.value)}
                  className="h-10 w-12 rounded border border-input cursor-pointer"
                />
                <Input
                  value={formData.secondary_color || ""}
                  onChange={(e) => handleChange('secondary_color', e.target.value)}
                  placeholder="#059669"
                  className="flex-1"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="accent_color">Accent Color</Label>
              <div className="flex gap-2">
                <input
                  type="color"
                  id="accent_color"
                  value={formData.accent_color || "#34D399"}
                  onChange={(e) => handleChange('accent_color', e.target.value)}
                  className="h-10 w-12 rounded border border-input cursor-pointer"
                />
                <Input
                  value={formData.accent_color || ""}
                  onChange={(e) => handleChange('accent_color', e.target.value)}
                  placeholder="#34D399"
                  className="flex-1"
                />
              </div>
            </div>
          </div>

          {/* Preview */}
          <div className="space-y-3">
            <Label>Preview</Label>
            <div className="border border-border rounded-lg p-4 flex items-center gap-4">
              <div 
                className="h-12 w-12 rounded-lg flex items-center justify-center text-white font-bold"
                style={{ backgroundColor: formData.primary_color }}
              >
                {formData.business_display_name?.charAt(0) || "R"}
              </div>
              <div>
                <p className="font-medium" style={{ color: formData.text_color }}>
                  {formData.business_display_name || "Your Restaurant"}
                </p>
                <p className="text-sm" style={{ color: formData.secondary_color }}>
                  {formData.tagline || "Your tagline here"}
                </p>
              </div>
              <div className="ml-auto flex gap-2">
                <div 
                  className="h-8 px-4 rounded flex items-center text-white text-sm"
                  style={{ backgroundColor: formData.primary_color }}
                >
                  Primary
                </div>
                <div 
                  className="h-8 px-4 rounded flex items-center text-sm border"
                  style={{ borderColor: formData.accent_color, color: formData.accent_color }}
                >
                  Accent
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3">
        <Button
          variant="outline"
          onClick={handleReset}
          disabled={!hasChanges || saving}
        >
          <RotateCcw className="h-4 w-4 mr-2" />
          Reset
        </Button>
        <Button
          onClick={handleSave}
          disabled={!hasChanges || saving}
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              Save Branding
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
