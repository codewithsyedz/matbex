import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Palette, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const themes = [
  {
    id: "fine-diner",
    name: "The Fine Diner",
    description: "Elegant serif typography with dark mode sophistication",
    preview: {
      bg: "bg-zinc-900",
      accent: "bg-amber-500",
      text: "text-zinc-100",
      font: "font-serif",
    },
  },
  {
    id: "urban-cafe",
    name: "The Urban Café",
    description: "Clean sans-serif with minimalist aesthetic",
    preview: {
      bg: "bg-stone-50",
      accent: "bg-emerald-600",
      text: "text-stone-900",
      font: "font-sans",
    },
  },
  {
    id: "rustic-bistro",
    name: "Rustic Bistro",
    description: "Warm tones with handcrafted charm",
    preview: {
      bg: "bg-amber-50",
      accent: "bg-orange-600",
      text: "text-amber-900",
      font: "font-serif",
    },
  },
  {
    id: "modern-minimal",
    name: "Modern Minimal",
    description: "Bold contrasts with geometric precision",
    preview: {
      bg: "bg-white",
      accent: "bg-black",
      text: "text-zinc-900",
      font: "font-sans",
    },
  },
  {
    id: "vibrant-street",
    name: "Vibrant Street",
    description: "Energetic colors for casual dining",
    preview: {
      bg: "bg-rose-50",
      accent: "bg-rose-500",
      text: "text-rose-900",
      font: "font-sans",
    },
  },
];

interface ThemeSelectorProps {
  value: string;
  onChange: (theme: string) => void;
}

export function ThemeSelector({ value, onChange }: ThemeSelectorProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-md bg-primary/10">
            <Palette className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-base font-medium">Visual Theme</CardTitle>
            <CardDescription>
              Choose a design vibe that matches your brand
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <RadioGroup value={value} onValueChange={onChange} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {themes.map((theme) => (
            <div key={theme.id}>
              <RadioGroupItem
                value={theme.id}
                id={theme.id}
                className="peer sr-only"
              />
              <Label
                htmlFor={theme.id}
                className={cn(
                  "flex flex-col cursor-pointer rounded-lg border-2 p-4 transition-all",
                  "hover:border-primary/50",
                  value === theme.id
                    ? "border-primary bg-primary/5"
                    : "border-border"
                )}
              >
                {/* Theme Preview */}
                <div className={cn(
                  "h-20 rounded-md mb-3 relative overflow-hidden",
                  theme.preview.bg
                )}>
                  <div className={cn(
                    "absolute inset-x-0 top-0 h-8 flex items-center px-3",
                    theme.preview.text,
                    theme.preview.font
                  )}>
                    <span className="text-xs font-medium opacity-70">Restaurant Name</span>
                  </div>
                  <div className={cn(
                    "absolute bottom-2 left-3 h-2 w-12 rounded-full",
                    theme.preview.accent
                  )} />
                  <div className={cn(
                    "absolute bottom-2 left-[4.5rem] h-2 w-8 rounded-full opacity-30",
                    theme.preview.accent
                  )} />
                  
                  {value === theme.id && (
                    <div className="absolute top-2 right-2 h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                      <Check className="h-3 w-3 text-primary-foreground" />
                    </div>
                  )}
                </div>
                
                <span className={cn(
                  "font-medium text-sm",
                  theme.preview.font === "font-serif" && "font-serif"
                )}>
                  {theme.name}
                </span>
                <span className="text-xs text-muted-foreground mt-0.5">
                  {theme.description}
                </span>
              </Label>
            </div>
          ))}
        </RadioGroup>
      </CardContent>
    </Card>
  );
}
