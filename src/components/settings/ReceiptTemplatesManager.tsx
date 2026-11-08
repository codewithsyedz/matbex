import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Pencil, Trash2, ScrollText, FileText, ReceiptText, Languages, Star } from "lucide-react";
import {
  useReceiptTemplates,
  ReceiptTemplate,
  ReceiptTemplatePreset,
  ReceiptTemplateLanguage,
  ReceiptTemplateOptions,
} from "@/hooks/useReceiptTemplates";

const PRESETS: Array<{
  id: ReceiptTemplatePreset;
  label: string;
  desc: string;
}> = [
  { id: "simple", label: "Simple", desc: "Minimal cash receipt. No VAT, no QR." },
  { id: "tax_invoice", label: "Tax Invoice", desc: "Simplified ZATCA invoice with VAT + QR." },
  { id: "detailed", label: "Detailed", desc: "Adds cashier, customer, order type and item notes." },
  {
    id: "saudi_bilingual",
    label: "Saudi Bilingual",
    desc: 'Bilingual EN/AR labels — "Simplified Tax Invoice / فاتورة ضريبية مبسطة".',
  },
  {
    id: "zatca_standard",
    label: "ZATCA Standard (B2B)",
    desc: "B2B invoice with buyer name, buyer VAT number, address.",
  },
];

const DEFAULT_OPTIONS: ReceiptTemplateOptions = {
  showLogo: true,
  showCashier: false,
  showCustomer: false,
  showOrderType: false,
  showItemNotes: false,
  showQR: true,
  showVat: true,
  showBranchName: true,
  showBuyerBlock: false,
};

function previewLines(preset: ReceiptTemplatePreset, lang: "en" | "ar") {
  const isAr = lang === "ar";
  switch (preset) {
    case "simple":
      return isAr
        ? ["═══════════", "اسم المتجر", "صنف × 2     20.00", "صنف         15.00", "───────────", "الإجمالي 35.00", "شكراً لكم!"]
        : ["═══════════", "Store Name", "Item × 2    20.00", "Item        15.00", "───────────", "TOTAL  35.00", "Thank you!"];
    case "tax_invoice":
      return isAr
        ? ["═══════════", "اسم المتجر", "ر.ض 30000…", "صنف × 2     20.00", "المجموع   30.43", "ض.ق ١٥٪    4.57", "الإجمالي 35.00", "▣ QR ▣"]
        : ["═══════════", "Store Name", "VAT 30000…", "Item × 2    20.00", "Subtotal  30.43", "VAT 15%    4.57", "TOTAL  35.00", "▣ QR ▣"];
    case "detailed":
      return isAr
        ? ["═══════════", "اسم المتجر", "الكاشير: أحمد", "العميل: زائر", "النوع: محلي", "صنف × 2     20.00", "  ملاحظة: بدون بصل", "الإجمالي 35.00"]
        : ["═══════════", "Store Name", "Cashier: Ahmed", "Customer: Walk-in", "Type: Dine-in", "Item × 2    20.00", "  note: no onions", "TOTAL  35.00"];
    case "saudi_bilingual":
      return [
        "═════════════════",
        "Jamaan Al-Dosari",
        "تموينات جمعان الدوسري",
        "VAT No. 3000000000003",
        "Second Ring Road, Riyadh",
        "─────────────────",
        "Simplified Tax Invoice",
        "فاتورة ضريبية مبسطة",
        "─────────────────",
        "Invoice / فاتورة  #529202",
        "Date / التاريخ  2026-06-06",
        "─────────────────",
        "Description / الوصف",
        "Unit / السعر  Qty  Total",
        "Nadec Laban 1.75L",
        "نادك لبن 1.75 لتر",
        "11.00          1     11.00",
        "─────────────────",
        "Total Taxable      SAR 11.00",
        "VAT / الضريبة      SAR  0.00",
        "TOTAL / الإجمالي   SAR 11.00",
        "Cash / نقدي        SAR 11.00",
        "      ▣ ZATCA QR ▣",
        "Thank You · شكراً لكم",
      ];
    case "zatca_standard":
      return [
        "═════════════════",
        "Store Name",
        "اسم المتجر",
        "VAT 3000000000003",
        "─────────────────",
        "Standard Tax Invoice",
        "فاتورة ضريبية",
        "─────────────────",
        "Buyer / المشتري:",
        "  Acme Trading LLC",
        "  VAT 3111111111113",
        "  P.O. Box 1234, Riyadh",
        "─────────────────",
        "Item × 2          20.00",
        "Subtotal          30.43",
        "VAT 15%            4.57",
        "TOTAL  SAR 35.00",
        "      ▣ ZATCA QR ▣",
      ];
  }
}

function presetIcon(preset: ReceiptTemplatePreset) {
  switch (preset) {
    case "simple": return <FileText className="h-4 w-4" />;
    case "tax_invoice": return <ReceiptText className="h-4 w-4" />;
    case "detailed": return <ScrollText className="h-4 w-4" />;
    case "saudi_bilingual": return <Languages className="h-4 w-4" />;
    case "zatca_standard": return <ReceiptText className="h-4 w-4" />;
  }
}

interface TemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: ReceiptTemplate | null;
  onSubmit: (input: {
    name: string;
    preset: ReceiptTemplatePreset;
    language: ReceiptTemplateLanguage;
    paper_width: 58 | 80;
    options: ReceiptTemplateOptions;
    header_note_en: string | null;
    header_note_ar: string | null;
    footer_note_en: string | null;
    footer_note_ar: string | null;
    is_default_simplified: boolean;
    is_default_standard: boolean;
    restaurant_id: string | null;
  }) => void;
}

function TemplateDialog({ open, onOpenChange, initial, onSubmit }: TemplateDialogProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [preset, setPreset] = useState<ReceiptTemplatePreset>(initial?.preset ?? "saudi_bilingual");
  const [language, setLanguage] = useState<ReceiptTemplateLanguage>(initial?.language ?? "bilingual");
  const [paperWidth, setPaperWidth] = useState<58 | 80>((initial?.paper_width ?? 80) as 58 | 80);
  const [options, setOptions] = useState<ReceiptTemplateOptions>({
    ...DEFAULT_OPTIONS,
    ...(initial?.options ?? {}),
  });
  const [headerEn, setHeaderEn] = useState(initial?.header_note_en ?? "");
  const [headerAr, setHeaderAr] = useState(initial?.header_note_ar ?? "");
  const [footerEn, setFooterEn] = useState(initial?.footer_note_en ?? "");
  const [footerAr, setFooterAr] = useState(initial?.footer_note_ar ?? "");
  const [previewLang, setPreviewLang] = useState<"en" | "ar">("en");

  const isStandard = preset === "zatca_standard";

  // Reset state when re-opening for a different template
  useMemo(() => {
    if (open) {
      setName(initial?.name ?? "");
      setPreset(initial?.preset ?? "saudi_bilingual");
      setLanguage(initial?.language ?? "bilingual");
      setPaperWidth(((initial?.paper_width ?? 80) as 58 | 80));
      setOptions({ ...DEFAULT_OPTIONS, ...(initial?.options ?? {}) });
      setHeaderEn(initial?.header_note_en ?? "");
      setHeaderAr(initial?.header_note_ar ?? "");
      setFooterEn(initial?.footer_note_en ?? "");
      setFooterAr(initial?.footer_note_ar ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  const toggle = (k: keyof ReceiptTemplateOptions) =>
    setOptions((o) => ({ ...o, [k]: !o[k] }));

  const handleSubmit = () => {
    if (!name.trim()) return;
    onSubmit({
      name: name.trim(),
      preset,
      language,
      paper_width: paperWidth,
      options,
      header_note_en: headerEn || null,
      header_note_ar: headerAr || null,
      footer_note_en: footerEn || null,
      footer_note_ar: footerAr || null,
      is_default_simplified: initial?.is_default_simplified ?? false,
      is_default_standard: initial?.is_default_standard ?? isStandard,
      restaurant_id: initial?.restaurant_id ?? null,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0">
        <ScrollArea className="max-h-[90vh]">
          <div className="p-6">
            <DialogHeader>
              <DialogTitle>{initial ? "Edit template" : "New receipt template"}</DialogTitle>
              <DialogDescription>
                Pick a preset, set the language and paper width, then toggle sections.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-6 grid gap-6 md:grid-cols-2">
              {/* Left column: form */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input
                    placeholder="e.g. Front Counter — Bilingual"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Preset</Label>
                  <Select value={preset} onValueChange={(v) => setPreset(v as ReceiptTemplatePreset)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRESETS.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          <div className="flex items-center gap-2">
                            {presetIcon(p.id)}
                            <span>{p.label}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {PRESETS.find((p) => p.id === preset)?.desc}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Language</Label>
                    <Select
                      value={language}
                      onValueChange={(v) => setLanguage(v as ReceiptTemplateLanguage)}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en">English</SelectItem>
                        <SelectItem value="ar">العربية</SelectItem>
                        <SelectItem value="bilingual">Bilingual EN + AR</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Paper width</Label>
                    <Select
                      value={String(paperWidth)}
                      onValueChange={(v) => setPaperWidth(Number(v) as 58 | 80)}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="58">58 mm</SelectItem>
                        <SelectItem value="80">80 mm</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="rounded-lg border p-3 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Sections</p>
                  {([
                    ["showLogo", "Show logo"],
                    ["showBranchName", "Show branch name"],
                    ["showCashier", "Show cashier line"],
                    ["showCustomer", "Show customer line"],
                    ["showOrderType", "Show order type (Dine-in / Takeaway)"],
                    ["showItemNotes", "Show item notes"],
                    ["showVat", "Show VAT breakdown"],
                    ["showQR", "Show ZATCA QR"],
                    ["showBuyerBlock", "Show buyer block (B2B)"],
                  ] as const).map(([key, label]) => (
                    <div key={key} className="flex items-center justify-between">
                      <Label htmlFor={key} className="text-sm font-normal">{label}</Label>
                      <Switch
                        id={key}
                        checked={!!options[key as keyof ReceiptTemplateOptions]}
                        onCheckedChange={() => toggle(key as keyof ReceiptTemplateOptions)}
                      />
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Header note (EN)</Label>
                    <Textarea rows={2} value={headerEn} onChange={(e) => setHeaderEn(e.target.value)} placeholder="e.g. Welcome!" />
                  </div>
                  <div className="space-y-2">
                    <Label>Header note (AR)</Label>
                    <Textarea dir="rtl" rows={2} value={headerAr} onChange={(e) => setHeaderAr(e.target.value)} placeholder="مثال: مرحباً بكم" />
                  </div>
                  <div className="space-y-2">
                    <Label>Footer note (EN)</Label>
                    <Textarea rows={2} value={footerEn} onChange={(e) => setFooterEn(e.target.value)} placeholder="Thank you for your visit" />
                  </div>
                  <div className="space-y-2">
                    <Label>Footer note (AR)</Label>
                    <Textarea dir="rtl" rows={2} value={footerAr} onChange={(e) => setFooterAr(e.target.value)} placeholder="شكراً لزيارتكم" />
                  </div>
                </div>
              </div>

              {/* Right column: preview */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Preview</Label>
                  <div className="inline-flex rounded-md border bg-muted/40 p-0.5">
                    <button
                      type="button"
                      onClick={() => setPreviewLang("en")}
                      className={`px-2 py-1 text-xs rounded ${previewLang === "en" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
                    >EN</button>
                    <button
                      type="button"
                      onClick={() => setPreviewLang("ar")}
                      className={`px-2 py-1 text-xs rounded ${previewLang === "ar" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
                    >AR</button>
                  </div>
                </div>
                <pre
                  dir={previewLang === "ar" ? "rtl" : "ltr"}
                  className={`bg-muted/50 rounded-lg p-3 text-[11px] leading-tight font-mono whitespace-pre overflow-auto ${
                    previewLang === "ar" ? "text-right" : "text-left"
                  }`}
                  style={{ minHeight: 380 }}
                >
{previewLines(preset, previewLang).join("\n")}
                </pre>
              </div>
            </div>

            <DialogFooter className="mt-6">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={!name.trim()}>
                {initial ? "Save changes" : "Create template"}
              </Button>
            </DialogFooter>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

export function ReceiptTemplatesManager({
  onTestPrint,
}: {
  onTestPrint?: (template: ReceiptTemplate, lang: "en" | "ar") => void;
}) {
  const {
    templates,
    isLoading,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    setDefault,
  } = useReceiptTemplates();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ReceiptTemplate | null>(null);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (t: ReceiptTemplate) => {
    setEditing(t);
    setDialogOpen(true);
  };

  const hasSaudiBilingual = templates.some((t) => t.preset === "saudi_bilingual");
  const quickAddSaudiBilingual = () => {
    createTemplate({
      name: "Saudi Bilingual (Simplified)",
      preset: "saudi_bilingual",
      language: "bilingual",
      paper_width: 80,
      options: {
        showLogo: true,
        showBranchName: true,
        showCashier: false,
        showCustomer: true,
        showOrderType: false,
        showItemNotes: false,
        showVat: true,
        showQR: true,
        showBuyerBlock: false,
      },
      header_note_en: null,
      header_note_ar: null,
      footer_note_en: "Thank You",
      footer_note_ar: "شكراً لكم",
      is_default_simplified: true,
      is_default_standard: false,
      restaurant_id: null,
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <ScrollText className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base font-medium">Receipt templates</CardTitle>
              <CardDescription>
                Create, edit and activate the layout used for every sale receipt. The active template is auto-picked by invoice type (Simplified / Standard) at print time.
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!hasSaudiBilingual && (
              <Button onClick={quickAddSaudiBilingual} size="sm" variant="outline" title="Add the Saudi bilingual ZATCA simplified layout shown in your reference receipt">
                <Languages className="h-4 w-4 mr-1" /> Add Saudi Bilingual
              </Button>
            )}
            <Button onClick={openCreate} size="sm">
              <Plus className="h-4 w-4 mr-1" /> New template
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && (
          <p className="text-sm text-muted-foreground">Loading templates…</p>
        )}
        {!isLoading && templates.length === 0 && (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <p className="text-sm text-muted-foreground mb-3">
              No custom templates yet. The built-in Tax Invoice will be used.
            </p>
            <Button onClick={openCreate} size="sm" variant="outline">
              <Plus className="h-4 w-4 mr-1" /> Create your first template
            </Button>
          </div>
        )}
        {templates.map((t) => (
          <div key={t.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center shrink-0">
                {presetIcon(t.preset)}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{t.name}</span>
                  <Badge variant="secondary" className="text-[10px] capitalize">
                    {t.preset.replace("_", " ")}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">{t.paper_width}mm</Badge>
                  <Badge variant="outline" className="text-[10px] uppercase">{t.language}</Badge>
                  {t.is_default_simplified && (
                    <Badge className="text-[10px]"><Star className="h-3 w-3 mr-1" />Default · Simplified</Badge>
                  )}
                  {t.is_default_standard && (
                    <Badge className="text-[10px]"><Star className="h-3 w-3 mr-1" />Default · Standard</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {PRESETS.find((p) => p.id === t.preset)?.desc}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {t.preset === "zatca_standard" ? (
                t.is_default_standard ? (
                  <Badge className="text-[10px] bg-emerald-600 hover:bg-emerald-600"><Star className="h-3 w-3 mr-1" />Active · Standard</Badge>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDefault({ id: t.id, kind: "standard" })}
                    title="Activate this template for Standard (B2B) invoices"
                  >
                    <Star className="h-4 w-4 mr-1" /> Activate
                  </Button>
                )
              ) : t.is_default_simplified ? (
                <Badge className="text-[10px] bg-emerald-600 hover:bg-emerald-600"><Star className="h-3 w-3 mr-1" />Active</Badge>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDefault({ id: t.id, kind: "simplified" })}
                  title="Activate this template — it will be used for every Simplified (B2C) sale receipt"
                >
                  <Star className="h-4 w-4 mr-1" /> Activate
                </Button>
              )}
              {onTestPrint && (
                <>
                  <Button variant="ghost" size="sm" onClick={() => onTestPrint(t, "en")}>EN</Button>
                  <Button variant="ghost" size="sm" onClick={() => onTestPrint(t, "ar")}>AR</Button>
                </>
              )}
              <Button variant="ghost" size="sm" onClick={() => openEdit(t)}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (confirm(`Delete template "${t.name}"?`)) deleteTemplate(t.id);
                }}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </div>
        ))}

        <TemplateDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          initial={editing}
          onSubmit={(input) => {
            if (editing) updateTemplate({ id: editing.id, patch: input });
            else createTemplate(input);
          }}
        />
      </CardContent>
    </Card>
  );
}