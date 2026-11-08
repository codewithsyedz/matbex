import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { LayoutGrid, Image as ImageIcon, List, Maximize2, Check, Receipt, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PosLayoutTemplate, PosLayoutConfig } from "@/components/pos/POSAlternateLayouts";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

const TEMPLATES: { key: PosLayoutTemplate; name: string; description: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "classic_dense", name: "Classic Dense", description: "Tight image grid + side cart. Best for high-volume cashiers.", Icon: LayoutGrid },
  { key: "showcase", name: "Showcase", description: "Icon category strip with large image-forward menu cards.", Icon: ImageIcon },
  { key: "compact_list", name: "Compact List", description: "Text rows with price + add. Maximum items per screen, no images.", Icon: List },
  { key: "kiosk_grid", name: "Kiosk Grid", description: "Extra-large tiles for self-serve and big touch targets.", Icon: Maximize2 },
  { key: "poscom_card", name: "POS.COM Card", description: "Image inside card top with bold name, description and large price + button.", Icon: Receipt },
];

const SHAPES: { key: NonNullable<PosLayoutConfig["imageShape"]>; label: string; preview: string }[] = [
  { key: "round", label: "Round", preview: "rounded-full" },
  { key: "rounded", label: "Rounded", preview: "rounded-xl" },
  { key: "square", label: "Square", preview: "rounded-none" },
];

interface Props {
  value: PosLayoutTemplate;
  onChange: (v: PosLayoutTemplate) => void;
  config?: PosLayoutConfig;
  onConfigChange?: (c: PosLayoutConfig) => void;
}

export function POSLayoutPicker({ value, onChange, config, onConfigChange }: Props) {
  const cfg: Required<PosLayoutConfig> = {
    showCategoryStrip: config?.showCategoryStrip ?? true,
    showChooseItemsTitle: config?.showChooseItemsTitle ?? true,
    showCategoryHeaders: config?.showCategoryHeaders ?? true,
    showDescription: config?.showDescription ?? true,
    imageShape: config?.imageShape ?? "rounded",
    compactTopSpacing: config?.compactTopSpacing ?? false,
    floatImageTop: config?.floatImageTop ?? false,
    showInvoicePaymentSection: config?.showInvoicePaymentSection ?? true,
  };
  const update = (patch: Partial<PosLayoutConfig>) => onConfigChange?.({ ...cfg, ...patch });

  const toggles: { key: keyof PosLayoutConfig; label: string; desc: string }[] = [
    { key: "showCategoryStrip", label: "Category strip", desc: "Top row of category chips/icons." },
    { key: "showChooseItemsTitle", label: '"Choose Items" title', desc: "Heading above the menu grid." },
    { key: "showCategoryHeaders", label: "Category section headers", desc: "Section labels between grouped items." },
    { key: "showDescription", label: "Item descriptions", desc: "Short description under each item name." },
    { key: "compactTopSpacing", label: "Move items up (compact spacing)", desc: "Tighten top padding so items start higher on screen." },
    { key: "floatImageTop", label: "Float image on top", desc: "Lifts the thumbnail above the card so it overhangs the top edge." },
    { key: "showInvoicePaymentSection", label: "Invoice, Payment & Settlement panel", desc: "Cart-side panel for ZATCA invoice type, payment details and the Unpaid – Pending Settlement toggle. Collapsed by default." },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <LayoutGrid className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-base font-medium">POS Screen Layout</CardTitle>
            <CardDescription>Choose how the Record Sale screen displays items. Applies to all cashiers in this restaurant.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {TEMPLATES.map(({ key, name, description, Icon }) => {
            const active = value === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onChange(key)}
                className={cn(
                  "relative text-left rounded-xl border-2 p-4 transition-all active:scale-[0.99]",
                  active ? "border-primary bg-primary/5 shadow-sm" : "border-border hover:border-primary/40 hover:bg-muted/30"
                )}
              >
                {active && (
                  <div className="absolute top-3 right-3 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                    <Check className="h-4 w-4" />
                  </div>
                )}
                <div className="flex items-center gap-3 mb-2">
                  <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center", active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <p className="font-semibold">{name}</p>
                </div>
                <p className="text-xs text-muted-foreground">{description}</p>
              </button>
            );
          })}
        </div>

        {onConfigChange && (
          <>
            <Separator />
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Eye className="h-4 w-4 text-primary" />
                <h4 className="font-semibold text-sm">Template areas</h4>
              </div>
              <p className="text-xs text-muted-foreground mb-4">Show or hide sections of the selected template. Applies live to the Record Sale screen.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {toggles.map((t) => {
                  const on = Boolean(cfg[t.key]);
                  return (
                    <label
                      key={t.key}
                      className={cn(
                        "flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors",
                        on ? "border-primary/40 bg-primary/5" : "border-border hover:bg-muted/40"
                      )}
                    >
                      <Switch
                        checked={on}
                        onCheckedChange={(v) => update({ [t.key]: v } as Partial<PosLayoutConfig>)}
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          {on ? <Eye className="h-3.5 w-3.5 text-primary" /> : <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />}
                          <p className="font-medium text-sm">{t.label}</p>
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">{t.desc}</p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            <div>
              <Label className="text-sm font-semibold">Thumbnail shape</Label>
              <p className="text-xs text-muted-foreground mb-3">How item images are clipped inside cards.</p>
              <div className="grid grid-cols-3 gap-3">
                {SHAPES.map((s) => {
                  const active = cfg.imageShape === s.key;
                  return (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => update({ imageShape: s.key })}
                      className={cn(
                        "flex flex-col items-center gap-2 rounded-xl border-2 p-3 transition-all active:scale-95",
                        active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                      )}
                    >
                      <div className={cn("h-12 w-12 bg-gradient-to-br from-primary/30 to-primary/60", s.preview)} />
                      <span className="text-xs font-medium">{s.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}