import { useState, memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Sparkles, Upload, Check } from "lucide-react";
import { OptimizedLottie } from "@/components/performance/OptimizedLottie";
import { cn } from "@/lib/utils";

interface LottieSelectorProps {
  value: string | undefined;
  onChange: (value: string, isPreset: boolean) => void;
}

// Curated Lottie presets for restaurants
const LOTTIE_PRESETS = [
  {
    id: 'welcome-food',
    name: 'Welcome',
    url: 'https://assets5.lottiefiles.com/packages/lf20_tljjahng.json',
    preview: '🍽️',
  },
  {
    id: 'chef-cooking',
    name: 'Chef',
    url: 'https://assets2.lottiefiles.com/packages/lf20_tll0j4bb.json',
    preview: '👨‍🍳',
  },
  {
    id: 'delivery',
    name: 'Delivery',
    url: 'https://assets9.lottiefiles.com/packages/lf20_uu0x8lqv.json',
    preview: '🛵',
  },
  {
    id: 'coffee',
    name: 'Coffee',
    url: 'https://assets3.lottiefiles.com/packages/lf20_b88nh30c.json',
    preview: '☕',
  },
  {
    id: 'celebration',
    name: 'Celebrate',
    url: 'https://assets4.lottiefiles.com/packages/lf20_u4yrau.json',
    preview: '🎉',
  },
  {
    id: 'heart',
    name: 'Love',
    url: 'https://assets1.lottiefiles.com/packages/lf20_dyv35myk.json',
    preview: '❤️',
  },
];

export const LottieSelector = memo(function LottieSelector({ value, onChange }: LottieSelectorProps) {
  const [customUrl, setCustomUrl] = useState('');
  const [loadingPreset, setLoadingPreset] = useState<string | null>(null);

  const isPresetSelected = (presetId: string) => value === presetId;

  const handlePresetSelect = (preset: typeof LOTTIE_PRESETS[0]) => {
    setLoadingPreset(preset.id);
    // OptimizedLottie handles loading internally via intersection observer
    onChange(preset.id, true);
    setLoadingPreset(null);
  };

  const handleCustomUrl = () => {
    if (customUrl.trim()) {
      onChange(customUrl.trim(), false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="h-5 w-5 text-primary" />
        <Label className="text-base font-medium">Lottie Animation</Label>
      </div>

      <p className="text-sm text-muted-foreground mb-4">
        Add a playful animation to your hero section. Choose from our curated library or upload your own.
      </p>

      {/* Preset Grid */}
      <div className="grid grid-cols-3 gap-3">
        {LOTTIE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            onClick={() => handlePresetSelect(preset)}
            disabled={loadingPreset === preset.id}
            className={cn(
              "relative p-4 rounded-lg border-2 transition-all hover:border-primary/50",
              isPresetSelected(preset.id) 
                ? "border-primary bg-primary/5" 
                : "border-muted bg-muted/30"
            )}
          >
            {isPresetSelected(preset.id) && (
              <div className="absolute top-1 right-1 h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                <Check className="h-3 w-3 text-primary-foreground" />
              </div>
            )}
            <div className="text-3xl mb-2">{preset.preview}</div>
            <p className="text-xs font-medium">{preset.name}</p>
          </button>
        ))}
      </div>

      {/* Preview of selected animation */}
      {value && LOTTIE_PRESETS.find(p => p.id === value) && (
        <Card className="overflow-hidden">
          <CardHeader className="py-2 px-3 pb-3">
            <CardTitle className="text-base font-medium">Preview</CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex justify-center bg-muted/20">
            <div className="h-32 w-32">
              <OptimizedLottie 
                src={LOTTIE_PRESETS.find(p => p.id === value)?.url || ''} 
                loop
                autoplay
                className="w-full h-full"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Custom URL input */}
      <div className="space-y-2 pt-4 border-t">
        <Label className="text-sm text-muted-foreground">Or use a custom Lottie URL</Label>
        <div className="flex gap-2">
          <input
            type="url"
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            placeholder="https://assets.lottiefiles.com/..."
            className="flex-1 px-3 py-2 text-sm border rounded-md bg-background"
          />
          <Button 
            size="sm" 
            variant="outline"
            onClick={handleCustomUrl}
            disabled={!customUrl.trim()}
          >
            <Upload className="h-4 w-4 mr-1" />
            Use
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Find free animations at{' '}
          <a 
            href="https://lottiefiles.com/featured" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            LottieFiles.com
          </a>
        </p>
      </div>

      {/* Remove animation option */}
      {value && (
        <Button 
          variant="ghost" 
          size="sm" 
          className="w-full text-muted-foreground"
          onClick={() => onChange('', false)}
        >
          Remove Animation
        </Button>
      )}
    </div>
  );
});
