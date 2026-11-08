import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { QRCodeSVG } from "qrcode.react";
import { Loader2, Save, ScanLine, ShieldCheck, AlertCircle } from "lucide-react";
import { RotateCcw, FileText, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { z } from "zod";
import { useZatcaSettings, type ZatcaSettingsInput } from "@/hooks/useZatcaSettings";
import { BranchReceiptOverridesEditor } from "@/components/settings/BranchReceiptOverridesEditor";
import {
  generateZatcaQrBase64,
  tlvTagsFromInput,
  validateZatcaInput,
  type ZatcaQrInput,
} from "@/lib/zatca/tlv";
import { generateZatcaPdf, pdfBase64ToBlobUrl } from "@/lib/zatca/receipt";

type FormState = Required<Omit<ZatcaSettingsInput,
  "seller_name_en" | "seller_name_ar" | "vat_registration_number" | "active_device_id">> & {
  seller_name_en: string;
  seller_name_ar: string;
  vat_registration_number: string;
};

const DEFAULT_FORM: FormState = {
  seller_name_en: "",
  seller_name_ar: "",
  vat_registration_number: "",
  qr_enabled: true,
  zatca_phase_mode: "PHASE_1",
  qr_size: "MEDIUM",
  show_on_printed_receipt: true,
  show_on_digital_receipt: true,
  auto_generate_pdf_receipt: true,
  show_seller_name_on_receipt: true,
  show_vat_number_on_receipt: true,
  pdf_generation_mode: "SOFT",
  cr_number: "",
  branch_address_ar: "",
  branch_address_en: "",
  google_maps_url: "",
  tagline_ar: "",
  tagline_en: "",
  footer_message_ar: "",
  footer_message_en: "",
  show_discount_row: true,
  show_item_count: true,
  show_terminal_id: true,
  show_printer_id: true,
  show_branch_name: true,
  show_logo: true,
  phone_display: "",
  whatsapp_number: "",
  instagram_handle: "",
  x_handle: "",
  tiktok_handle: "",
  snapchat_handle: "",
  loyalty_qr_url: "",
  loyalty_qr_label_ar: "",
  loyalty_qr_label_en: "",
  reorder_qr_url: "",
  reorder_qr_label_ar: "",
  reorder_qr_label_en: "",
  promo_message_ar: "",
  promo_message_en: "",
  show_phone: true,
  show_social_handles: true,
  show_loyalty_qr: false,
  show_reorder_qr: false,
  show_promo_message: false,
};

const QR_PIXELS: Record<FormState["qr_size"], number> = {
  SMALL: 128,
  MEDIUM: 192,
  LARGE: 256,
};

// Arabic Unicode ranges (incl. supplements + presentation forms) plus
// whitespace/punctuation commonly found in registered names.
const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const LATIN_RE = /[A-Za-z]/;
const NAME_ALLOWED_RE =
  /^[\p{L}\p{M}\p{N}\s\.\-'’&,()/]+$/u;

const zatcaFormSchema = z
  .object({
    seller_name_en: z
      .string()
      .trim()
      .max(120, "English seller name must be 120 characters or fewer.")
      .refine((v) => v === "" || v.length >= 2, {
        message: "English seller name must be at least 2 characters.",
      })
      .refine((v) => v === "" || NAME_ALLOWED_RE.test(v), {
        message: "English seller name contains invalid characters.",
      })
      .refine((v) => v === "" || LATIN_RE.test(v), {
        message: "English seller name must contain Latin letters.",
      }),
    seller_name_ar: z
      .string()
      .trim()
      .max(120, "Arabic seller name must be 120 characters or fewer.")
      .refine((v) => v === "" || v.length >= 2, {
        message: "Arabic seller name must be at least 2 characters.",
      })
      .refine((v) => v === "" || NAME_ALLOWED_RE.test(v), {
        message: "Arabic seller name contains invalid characters.",
      })
      .refine((v) => v === "" || ARABIC_RE.test(v), {
        message: "Arabic seller name must contain Arabic characters.",
      }),
    vat_registration_number: z
      .string()
      .trim()
      .regex(/^\d{15}$/, "VAT number must be exactly 15 digits.")
      .refine((v) => v.startsWith("3"), {
        message: "Saudi VAT numbers must start with '3'.",
      })
      .refine((v) => v.endsWith("3"), {
        message: "Saudi VAT numbers must end with '3'.",
      })
      .refine((v) => !/^(\d)\1{14}$/.test(v), {
        message: "VAT number cannot be all the same digit.",
      }),
    qr_enabled: z.boolean(),
    show_on_printed_receipt: z.boolean(),
    show_on_digital_receipt: z.boolean(),
    auto_generate_pdf_receipt: z.boolean(),
    show_seller_name_on_receipt: z.boolean(),
    show_vat_number_on_receipt: z.boolean(),
    zatca_phase_mode: z.enum(["PHASE_1", "PHASE_2_READY"]),
    qr_size: z.enum(["SMALL", "MEDIUM", "LARGE"]),
    pdf_generation_mode: z.enum(["SOFT", "STRICT"]),
    cr_number: z.string().trim().max(20).optional().or(z.literal("")),
    branch_address_ar: z.string().trim().max(300).optional().or(z.literal("")),
    branch_address_en: z.string().trim().max(300).optional().or(z.literal("")),
    google_maps_url: z
      .string()
      .trim()
      .max(500)
      .optional()
      .or(z.literal(""))
      .refine((v) => !v || /^https?:\/\//i.test(v), {
        message: "Google Maps URL must start with http:// or https://",
      }),
    tagline_ar: z.string().trim().max(120).optional().or(z.literal("")),
    tagline_en: z.string().trim().max(120).optional().or(z.literal("")),
    footer_message_ar: z.string().trim().max(300).optional().or(z.literal("")),
    footer_message_en: z.string().trim().max(300).optional().or(z.literal("")),
    show_discount_row: z.boolean(),
    show_item_count: z.boolean(),
    show_terminal_id: z.boolean(),
    show_printer_id: z.boolean(),
    show_branch_name: z.boolean(),
    show_logo: z.boolean(),
    phone_display: z.string().trim().max(40).optional().or(z.literal("")),
    whatsapp_number: z.string().trim().max(40).optional().or(z.literal("")),
    instagram_handle: z.string().trim().max(60).optional().or(z.literal("")),
    x_handle: z.string().trim().max(60).optional().or(z.literal("")),
    tiktok_handle: z.string().trim().max(60).optional().or(z.literal("")),
    snapchat_handle: z.string().trim().max(60).optional().or(z.literal("")),
    loyalty_qr_url: z
      .string().trim().max(500).optional().or(z.literal(""))
      .refine((v) => !v || /^https?:\/\//i.test(v), {
        message: "Loyalty URL must start with http:// or https://",
      }),
    loyalty_qr_label_ar: z.string().trim().max(80).optional().or(z.literal("")),
    loyalty_qr_label_en: z.string().trim().max(80).optional().or(z.literal("")),
    reorder_qr_url: z
      .string().trim().max(500).optional().or(z.literal(""))
      .refine((v) => !v || /^https?:\/\//i.test(v), {
        message: "Re-order URL must start with http:// or https://",
      }),
    reorder_qr_label_ar: z.string().trim().max(80).optional().or(z.literal("")),
    reorder_qr_label_en: z.string().trim().max(80).optional().or(z.literal("")),
    promo_message_ar: z.string().trim().max(160).optional().or(z.literal("")),
    promo_message_en: z.string().trim().max(160).optional().or(z.literal("")),
    show_phone: z.boolean(),
    show_social_handles: z.boolean(),
    show_loyalty_qr: z.boolean(),
    show_reorder_qr: z.boolean(),
    show_promo_message: z.boolean(),
  })
  .superRefine((data, ctx) => {
    if (!data.qr_enabled) return;
    if (!data.seller_name_en && !data.seller_name_ar) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["seller_name_en"],
        message: "At least one seller name (English or Arabic) is required when QR is enabled.",
      });
    }
    if (
      data.auto_generate_pdf_receipt &&
      !data.show_on_printed_receipt &&
      !data.show_on_digital_receipt
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["show_on_printed_receipt"],
        message:
          "Enable QR on at least one receipt channel (printed or digital) when auto-generating PDFs.",
      });
    }
    if (data.pdf_generation_mode === "STRICT" && !data.auto_generate_pdf_receipt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pdf_generation_mode"],
        message: "Strict mode requires auto-generated PDF receipts to be enabled.",
      });
    }
  });

type FieldErrors = Partial<Record<keyof FormState, string>>;

export function ZatcaSettings() {
  const { settings, loading, saving, save } = useZatcaSettings();
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [dirty, setDirty] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const [touched, setTouched] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [testingPdf, setTestingPdf] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const summaryRef = useRef<HTMLDivElement | null>(null);
  const fieldRefs = useRef<Partial<Record<keyof FormState, HTMLElement | null>>>({});

  const registerFieldRef = (key: keyof FormState) => (el: HTMLElement | null) => {
    fieldRefs.current[key] = el;
  };

  const focusFirstError = (errs: FieldErrors) => {
    const order: Array<keyof FormState> = [
      "seller_name_en",
      "seller_name_ar",
      "vat_registration_number",
      "show_on_printed_receipt",
      "pdf_generation_mode",
    ];
    const firstKey = order.find((k) => errs[k]);
    const el = firstKey ? fieldRefs.current[firstKey] : null;
    if (el && typeof el.focus === "function") {
      el.focus({ preventScroll: false });
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (summaryRef.current) {
      summaryRef.current.focus();
      summaryRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  useEffect(() => {
    if (settings) {
      setForm({
        seller_name_en: settings.seller_name_en ?? "",
        seller_name_ar: settings.seller_name_ar ?? "",
        vat_registration_number: settings.vat_registration_number ?? "",
        qr_enabled: settings.qr_enabled,
        zatca_phase_mode: settings.zatca_phase_mode,
        qr_size: settings.qr_size,
        show_on_printed_receipt: settings.show_on_printed_receipt,
        show_on_digital_receipt: settings.show_on_digital_receipt,
        auto_generate_pdf_receipt: settings.auto_generate_pdf_receipt,
        show_seller_name_on_receipt: settings.show_seller_name_on_receipt,
        show_vat_number_on_receipt: settings.show_vat_number_on_receipt,
        pdf_generation_mode: settings.pdf_generation_mode,
        cr_number: settings.cr_number ?? "",
        branch_address_ar: settings.branch_address_ar ?? "",
        branch_address_en: settings.branch_address_en ?? "",
        google_maps_url: settings.google_maps_url ?? "",
        tagline_ar: settings.tagline_ar ?? "",
        tagline_en: settings.tagline_en ?? "",
        footer_message_ar: settings.footer_message_ar ?? "",
        footer_message_en: settings.footer_message_en ?? "",
        show_discount_row: settings.show_discount_row,
        show_item_count: settings.show_item_count,
        show_terminal_id: settings.show_terminal_id,
        show_printer_id: settings.show_printer_id,
        show_branch_name: settings.show_branch_name,
        show_logo: settings.show_logo,
        phone_display: settings.phone_display ?? "",
        whatsapp_number: settings.whatsapp_number ?? "",
        instagram_handle: settings.instagram_handle ?? "",
        x_handle: settings.x_handle ?? "",
        tiktok_handle: settings.tiktok_handle ?? "",
        snapchat_handle: settings.snapchat_handle ?? "",
        loyalty_qr_url: settings.loyalty_qr_url ?? "",
        loyalty_qr_label_ar: settings.loyalty_qr_label_ar ?? "",
        loyalty_qr_label_en: settings.loyalty_qr_label_en ?? "",
        reorder_qr_url: settings.reorder_qr_url ?? "",
        reorder_qr_label_ar: settings.reorder_qr_label_ar ?? "",
        reorder_qr_label_en: settings.reorder_qr_label_en ?? "",
        promo_message_ar: settings.promo_message_ar ?? "",
        promo_message_en: settings.promo_message_en ?? "",
        show_phone: settings.show_phone,
        show_social_handles: settings.show_social_handles,
        show_loyalty_qr: settings.show_loyalty_qr,
        show_reorder_qr: settings.show_reorder_qr,
        show_promo_message: settings.show_promo_message,
      });
      setDirty(false);
    }
  }, [settings]);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };

  const validation = useMemo(() => {
    const result = zatcaFormSchema.safeParse(form);
    if (result.success) return { valid: true, errors: [] as string[], fieldErrors: {} as FieldErrors };
    const fieldErrors: FieldErrors = {};
    const errors: string[] = [];
    for (const issue of result.error.issues) {
      const key = issue.path[0] as keyof FormState | undefined;
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
      errors.push(issue.message);
    }
    return { valid: false, errors, fieldErrors };
  }, [form]);

  const FIELD_LABELS: Record<keyof FormState, string> = {
    seller_name_en: "Seller name (EN)",
    seller_name_ar: "Seller name (AR)",
    vat_registration_number: "VAT registration number",
    qr_enabled: "ZATCA QR enabled",
    zatca_phase_mode: "ZATCA phase",
    qr_size: "QR size",
    show_on_printed_receipt: "Show QR on printed receipt",
    show_on_digital_receipt: "Show QR on digital receipt",
    auto_generate_pdf_receipt: "Auto-generate PDF receipt",
    show_seller_name_on_receipt: "Show seller name on receipt",
    show_vat_number_on_receipt: "Show VAT number on receipt",
    pdf_generation_mode: "PDF generation mode",
    cr_number: "Commercial Registration (CR) number",
    branch_address_ar: "Branch address (Arabic)",
    branch_address_en: "Branch address (English)",
    google_maps_url: "Google Maps URL",
    tagline_ar: "Tagline (Arabic)",
    tagline_en: "Tagline (English)",
    footer_message_ar: "Footer thank-you (Arabic)",
    footer_message_en: "Footer thank-you (English)",
    show_discount_row: "Show discount row on receipt",
    show_item_count: "Show item count on receipt",
    show_terminal_id: "Show terminal # on receipt",
    show_printer_id: "Show printer # on receipt",
    show_branch_name: "Show branch name on receipt",
    show_logo: "Show restaurant logo on receipt",
    phone_display: "Phone (printed on receipt)",
    whatsapp_number: "WhatsApp number",
    instagram_handle: "Instagram handle",
    x_handle: "X / Twitter handle",
    tiktok_handle: "TikTok handle",
    snapchat_handle: "Snapchat handle",
    loyalty_qr_url: "Loyalty sign-up URL",
    loyalty_qr_label_ar: "Loyalty QR caption (Arabic)",
    loyalty_qr_label_en: "Loyalty QR caption (English)",
    reorder_qr_url: "Re-order / menu URL",
    reorder_qr_label_ar: "Re-order QR caption (Arabic)",
    reorder_qr_label_en: "Re-order QR caption (English)",
    promo_message_ar: "Promotional message (Arabic)",
    promo_message_en: "Promotional message (English)",
    show_phone: "Show phone on receipt",
    show_social_handles: "Show social handles on receipt",
    show_loyalty_qr: "Show loyalty QR on receipt",
    show_reorder_qr: "Show re-order QR on receipt",
    show_promo_message: "Show promotional message on receipt",
  };

  const formatDiffValue = (v: unknown): string => {
    if (v === null || v === undefined || v === "") return "-";
    if (typeof v === "boolean") return v ? "On" : "Off";
    return String(v);
  };

  const diff = useMemo(() => {
    if (!settings) return [] as Array<{ key: keyof FormState; from: unknown; to: unknown }>;
    const baseline: FormState = {
      seller_name_en: settings.seller_name_en ?? "",
      seller_name_ar: settings.seller_name_ar ?? "",
      vat_registration_number: settings.vat_registration_number ?? "",
      qr_enabled: settings.qr_enabled,
      zatca_phase_mode: settings.zatca_phase_mode,
      qr_size: settings.qr_size,
      show_on_printed_receipt: settings.show_on_printed_receipt,
      show_on_digital_receipt: settings.show_on_digital_receipt,
      auto_generate_pdf_receipt: settings.auto_generate_pdf_receipt,
      show_seller_name_on_receipt: settings.show_seller_name_on_receipt,
      show_vat_number_on_receipt: settings.show_vat_number_on_receipt,
      pdf_generation_mode: settings.pdf_generation_mode,
      cr_number: settings.cr_number ?? "",
      branch_address_ar: settings.branch_address_ar ?? "",
      branch_address_en: settings.branch_address_en ?? "",
      google_maps_url: settings.google_maps_url ?? "",
      tagline_ar: settings.tagline_ar ?? "",
      tagline_en: settings.tagline_en ?? "",
      footer_message_ar: settings.footer_message_ar ?? "",
      footer_message_en: settings.footer_message_en ?? "",
      show_discount_row: settings.show_discount_row,
      show_item_count: settings.show_item_count,
      show_terminal_id: settings.show_terminal_id,
      show_printer_id: settings.show_printer_id,
      show_branch_name: settings.show_branch_name,
      show_logo: settings.show_logo,
      phone_display: settings.phone_display ?? "",
      whatsapp_number: settings.whatsapp_number ?? "",
      instagram_handle: settings.instagram_handle ?? "",
      x_handle: settings.x_handle ?? "",
      tiktok_handle: settings.tiktok_handle ?? "",
      snapchat_handle: settings.snapchat_handle ?? "",
      loyalty_qr_url: settings.loyalty_qr_url ?? "",
      loyalty_qr_label_ar: settings.loyalty_qr_label_ar ?? "",
      loyalty_qr_label_en: settings.loyalty_qr_label_en ?? "",
      reorder_qr_url: settings.reorder_qr_url ?? "",
      reorder_qr_label_ar: settings.reorder_qr_label_ar ?? "",
      reorder_qr_label_en: settings.reorder_qr_label_en ?? "",
      promo_message_ar: settings.promo_message_ar ?? "",
      promo_message_en: settings.promo_message_en ?? "",
      show_phone: settings.show_phone,
      show_social_handles: settings.show_social_handles,
      show_loyalty_qr: settings.show_loyalty_qr,
      show_reorder_qr: settings.show_reorder_qr,
      show_promo_message: settings.show_promo_message,
    };
    const out: Array<{ key: keyof FormState; from: unknown; to: unknown }> = [];
    (Object.keys(form) as Array<keyof FormState>).forEach((k) => {
      const a = baseline[k];
      const b = form[k];
      const an = typeof a === "string" ? a.trim() : a;
      const bn = typeof b === "string" ? b.trim() : b;
      if (an !== bn) out.push({ key: k, from: a, to: b });
    });
    return out;
  }, [settings, form]);

  const performSave = async () => {
    try {
      await save({
        ...form,
        seller_name_en: form.seller_name_en.trim() || null,
        seller_name_ar: form.seller_name_ar.trim() || null,
        vat_registration_number: form.vat_registration_number.trim() || null,
        cr_number: form.cr_number.trim() || null,
        branch_address_ar: form.branch_address_ar.trim() || null,
        branch_address_en: form.branch_address_en.trim() || null,
        google_maps_url: form.google_maps_url.trim() || null,
        tagline_ar: form.tagline_ar.trim() || null,
        tagline_en: form.tagline_en.trim() || null,
        footer_message_ar: form.footer_message_ar.trim() || null,
        footer_message_en: form.footer_message_en.trim() || null,
        phone_display: form.phone_display.trim() || null,
        whatsapp_number: form.whatsapp_number.trim() || null,
        instagram_handle: form.instagram_handle.trim().replace(/^@+/, "") || null,
        x_handle: form.x_handle.trim().replace(/^@+/, "") || null,
        tiktok_handle: form.tiktok_handle.trim().replace(/^@+/, "") || null,
        snapchat_handle: form.snapchat_handle.trim().replace(/^@+/, "") || null,
        loyalty_qr_url: form.loyalty_qr_url.trim() || null,
        loyalty_qr_label_ar: form.loyalty_qr_label_ar.trim() || null,
        loyalty_qr_label_en: form.loyalty_qr_label_en.trim() || null,
        reorder_qr_url: form.reorder_qr_url.trim() || null,
        reorder_qr_label_ar: form.reorder_qr_label_ar.trim() || null,
        reorder_qr_label_en: form.reorder_qr_label_en.trim() || null,
        promo_message_ar: form.promo_message_ar.trim() || null,
        promo_message_en: form.promo_message_en.trim() || null,
      });
      toast.success("ZATCA settings saved");
      setDirty(false);
      setTouched(false);
      setDiffOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save settings");
    }
  };

  const handleSave = async () => {
    setTouched(true);
    if (!validation.valid) {
      toast.error("Fix the errors before saving", {
        description: validation.errors[0],
      });
      // Defer to allow aria-invalid + summary to render before moving focus.
      setTimeout(() => focusFirstError(validation.fieldErrors), 0);
      return;
    }
    // STRICT mode: surface a field-level diff and require confirmation
    // before persisting changes that affect every future invoice.
    if (form.pdf_generation_mode === "STRICT" && diff.length > 0) {
      setDiffOpen(true);
      return;
    }
    await performSave();
  };

  const handleReset = () => {
    // Preserve tenant-specific seller info; restore all toggles/modes to safe defaults.
    setForm((f) => ({
      ...DEFAULT_FORM,
      seller_name_en: f.seller_name_en,
      seller_name_ar: f.seller_name_ar,
      vat_registration_number: f.vat_registration_number,
    }));
    setDirty(true);
    setTouched(false);
    setResetOpen(false);
    toast.success("Reset to safe defaults - review and save to apply");
  };

  const handleTestPdf = async () => {
    setTouched(true);
    if (!validation.valid) {
      toast.error("Fix the errors before testing", {
        description: validation.errors[0],
      });
      setTimeout(() => focusFirstError(validation.fieldErrors), 0);
      return;
    }
    if (!sampleValidation.valid || !sampleBase64) {
      toast.error("Cannot generate test QR with current values");
      return;
    }

    setTestingPdf(true);
    const tid = toast.loading("Generating sample PDF…");
    try {
      const result = await generateZatcaPdf({
      receiptNumber: `TEST-${Date.now().toString().slice(-6)}`,
      date: sampleInput.timestamp,
      cashierName: "Preview",
      paymentMethod: "cash",
      currencySymbol: "﷼",
      items: [
        { name: "Sample item A", quantity: 1, unitPrice: 60, total: 60 },
        { name: "Sample item B", quantity: 2, unitPrice: 20, total: 40 },
      ],
      subtotal: 100,
      tax: 15,
      total: 115,
      mode: "SOFT",
      zatca: {
        sellerName: sampleInput.sellerName,
        sellerNameAr: form.seller_name_ar.trim() || null,
        vatNumber: sampleInput.vatNumber,
        timestamp: sampleInput.timestamp,
        invoiceTotal: sampleInput.invoiceTotal,
        vatTotal: sampleInput.vatTotal,
        qrBase64: sampleBase64,
        showQr: true,
      },
      });
      const url = pdfBase64ToBlobUrl(result.pdf);
      toast.success("Sample PDF ready", { id: tid });
      const win = window.open(url, "_blank", "noopener,noreferrer");
      if (!win) {
        toast.message("Pop-up blocked", {
          description: "Allow pop-ups to preview the sample PDF.",
        });
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to generate sample PDF", {
        id: tid,
      });
    } finally {
      setTestingPdf(false);
    }
  };

  const fieldErrors = touched ? validation.fieldErrors : ({} as FieldErrors);
  const showSummary = touched && !validation.valid;

  // Test QR - always uses live form values, sample totals.
  const sampleInput: ZatcaQrInput = useMemo(() => ({
    sellerName: form.seller_name_ar.trim() || form.seller_name_en.trim() || "",
    vatNumber: form.vat_registration_number.trim(),
    timestamp: new Date().toISOString(),
    invoiceTotal: "115.00",
    vatTotal: "15.00",
  }), [form.seller_name_ar, form.seller_name_en, form.vat_registration_number]);

  const sampleValidation = useMemo(() => validateZatcaInput(sampleInput), [sampleInput]);
  const sampleBase64 = useMemo(() => {
    if (!sampleValidation.valid) return "";
    try {
      return generateZatcaQrBase64(sampleInput);
    } catch {
      return "";
    }
  }, [sampleInput, sampleValidation.valid]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading ZATCA settings…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            ZATCA Configuration
          </CardTitle>
          <CardDescription>
            Configure your seller details and QR generation for Saudi Arabia
            simplified e-invoicing (Phase 1).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* General */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Enable ZATCA QR code</Label>
                <p className="text-xs text-muted-foreground">
                  When enabled, every completed sale receives a TLV QR.
                </p>
              </div>
              <Switch
                checked={form.qr_enabled}
                onCheckedChange={(v) => update("qr_enabled", v)}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">ZATCA phase</Label>
                <Select
                  value={form.zatca_phase_mode}
                  onValueChange={(v) =>
                    update("zatca_phase_mode", v as FormState["zatca_phase_mode"])
                  }
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PHASE_1">Phase 1 (Generation)</SelectItem>
                    <SelectItem value="PHASE_2_READY">Phase 2 ready</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">QR size</Label>
                <Select
                  value={form.qr_size}
                  onValueChange={(v) => update("qr_size", v as FormState["qr_size"])}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SMALL">Small</SelectItem>
                    <SelectItem value="MEDIUM">Medium</SelectItem>
                    <SelectItem value="LARGE">Large</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          <Separator />

          {/* Seller info */}
          <section className="space-y-4">
            <h3 className="text-sm font-medium">Seller information</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="zatca-name-en" className="text-xs">
                  Seller name (English)
                </Label>
                <Input
                  id="zatca-name-en"
                  ref={registerFieldRef("seller_name_en") as any}
                  value={form.seller_name_en}
                  onChange={(e) => update("seller_name_en", e.target.value)}
                  placeholder="Matbex Restaurant"
                  maxLength={120}
                  aria-invalid={!!fieldErrors.seller_name_en}
                  aria-describedby={fieldErrors.seller_name_en ? "zatca-name-en-error" : undefined}
                />
                {fieldErrors.seller_name_en && (
                  <p
                    id="zatca-name-en-error"
                    role="alert"
                    aria-live="polite"
                    className="text-[11px] text-destructive"
                  >
                    {fieldErrors.seller_name_en}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="zatca-name-ar" className="text-xs">
                  Seller name (Arabic)
                </Label>
                <Input
                  id="zatca-name-ar"
                  ref={registerFieldRef("seller_name_ar") as any}
                  value={form.seller_name_ar}
                  onChange={(e) => update("seller_name_ar", e.target.value)}
                  placeholder="مطعم سفرة"
                  dir="rtl"
                  maxLength={120}
                  aria-invalid={!!fieldErrors.seller_name_ar}
                  aria-describedby={fieldErrors.seller_name_ar ? "zatca-name-ar-error" : undefined}
                />
                {fieldErrors.seller_name_ar && (
                  <p
                    id="zatca-name-ar-error"
                    role="alert"
                    aria-live="polite"
                    className="text-[11px] text-destructive"
                  >
                    {fieldErrors.seller_name_ar}
                  </p>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="zatca-vat" className="text-xs">
                VAT registration number (15 digits)
              </Label>
              <Input
                id="zatca-vat"
                ref={registerFieldRef("vat_registration_number") as any}
                value={form.vat_registration_number}
                onChange={(e) =>
                  update(
                    "vat_registration_number",
                    e.target.value.replace(/\D/g, "").slice(0, 15),
                  )
                }
                placeholder="300000000000003"
                inputMode="numeric"
                pattern="\d{15}"
                aria-invalid={!!fieldErrors.vat_registration_number}
                aria-describedby={
                  fieldErrors.vat_registration_number
                    ? "zatca-vat-error"
                    : "zatca-vat-help"
                }
              />
              {fieldErrors.vat_registration_number ? (
                <p
                  id="zatca-vat-error"
                  role="alert"
                  aria-live="polite"
                  className="text-[11px] text-destructive"
                >
                  {fieldErrors.vat_registration_number}
                </p>
              ) : (
                <p id="zatca-vat-help" className="text-[11px] text-muted-foreground">
                  Saudi VAT numbers are 15 digits, start and end with “3”.
                </p>
              )}
            </div>
          </section>

          <Separator />

          {/* Receipt display */}
          <section className="space-y-3">
            <h3 className="text-sm font-medium">Receipt display</h3>
            <ToggleRow
              label="Show QR on printed receipt"
              checked={form.show_on_printed_receipt}
              onChange={(v) => update("show_on_printed_receipt", v)}
            />
            <ToggleRow
              label="Show QR on digital receipt"
              checked={form.show_on_digital_receipt}
              onChange={(v) => update("show_on_digital_receipt", v)}
            />
            <ToggleRow
              label="Show seller name on receipt"
              checked={form.show_seller_name_on_receipt}
              onChange={(v) => update("show_seller_name_on_receipt", v)}
            />
            <ToggleRow
              label="Show VAT number on receipt"
              checked={form.show_vat_number_on_receipt}
              onChange={(v) => update("show_vat_number_on_receipt", v)}
            />
          </section>

          <Separator />

          {/* Receipt customization (branding + branch + optional rows) */}
          <section className="space-y-4">
            <div>
              <h3 className="text-sm font-medium">Receipt customization</h3>
              <p className="text-[11px] text-muted-foreground">
                Branch details, branding, and optional rows printed on every receipt.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="zatca-cr">CR number (Commercial Registration)</Label>
                <Input
                  id="zatca-cr"
                  inputMode="numeric"
                  value={form.cr_number}
                  placeholder="1010848100"
                  onChange={(e) => update("cr_number", e.target.value.replace(/[^0-9]/g, ""))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="zatca-maps">Google Maps URL (optional)</Label>
                <Input
                  id="zatca-maps"
                  type="url"
                  value={form.google_maps_url}
                  placeholder="https://maps.google.com/?q=..."
                  onChange={(e) => update("google_maps_url", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="zatca-addr-en">Branch address (English)</Label>
                <Input
                  id="zatca-addr-en"
                  value={form.branch_address_en}
                  placeholder="Riyadh - An Nuzhah Dist. - Prince Turki Bin Abdulaziz Rd."
                  onChange={(e) => update("branch_address_en", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="zatca-addr-ar">Branch address (Arabic)</Label>
                <Input
                  id="zatca-addr-ar"
                  dir="rtl"
                  value={form.branch_address_ar}
                  placeholder="الرياض - حي النزهة - طريق الأمير تركي بن عبدالعزيز"
                  onChange={(e) => update("branch_address_ar", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="zatca-tag-en">Tagline (English)</Label>
                <Input
                  id="zatca-tag-en"
                  value={form.tagline_en}
                  placeholder="SMART POS. STRONG BUSINESS."
                  onChange={(e) => update("tagline_en", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="zatca-tag-ar">Tagline (Arabic)</Label>
                <Input
                  id="zatca-tag-ar"
                  dir="rtl"
                  value={form.tagline_ar}
                  placeholder="نظام نقاط البيع الذكي لإدارة مطعمك"
                  onChange={(e) => update("tagline_ar", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="zatca-footer-en">Footer message (English)</Label>
                <Input
                  id="zatca-footer-en"
                  value={form.footer_message_en}
                  placeholder="Thank you for your visit ✨ We wish you a great day!"
                  onChange={(e) => update("footer_message_en", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="zatca-footer-ar">Footer message (Arabic)</Label>
                <Input
                  id="zatca-footer-ar"
                  dir="rtl"
                  value={form.footer_message_ar}
                  placeholder="شكراً لزيارتكم ✨ نتمنى لكم يوماً سعيداً"
                  onChange={(e) => update("footer_message_ar", e.target.value)}
                />
              </div>
            </div>

            <div className="pt-1 grid grid-cols-1 md:grid-cols-2 gap-1.5">
              <ToggleRow
                label="Show restaurant logo"
                checked={form.show_logo}
                onChange={(v) => update("show_logo", v)}
              />
              <ToggleRow
                label="Show branch name"
                checked={form.show_branch_name}
                onChange={(v) => update("show_branch_name", v)}
              />
              <ToggleRow
                label="Show discount row"
                checked={form.show_discount_row}
                onChange={(v) => update("show_discount_row", v)}
              />
              <ToggleRow
                label="Show item count"
                checked={form.show_item_count}
                onChange={(v) => update("show_item_count", v)}
              />
              <ToggleRow
                label="Show terminal number"
                checked={form.show_terminal_id}
                onChange={(v) => update("show_terminal_id", v)}
              />
              <ToggleRow
                label="Show printer number"
                checked={form.show_printer_id}
                onChange={(v) => update("show_printer_id", v)}
              />
            </div>
          </section>

          <Separator />

          {/* Customer engagement: phone, social, promo, loyalty/re-order QRs */}
          <section className="space-y-4">
            <div>
              <h3 className="text-sm font-medium">Customer engagement & contact</h3>
              <p className="text-[11px] text-muted-foreground">
                Phone, social handles, promo banner and customer QR codes printed
                next to the ZATCA QR.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Phone (printed on receipt)</Label>
                <Input
                  value={form.phone_display}
                  placeholder="+966 11 234 5678"
                  onChange={(e) => update("phone_display", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">WhatsApp number</Label>
                <Input
                  value={form.whatsapp_number}
                  placeholder="+966 55 123 4567"
                  onChange={(e) => update("whatsapp_number", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Instagram handle</Label>
                <Input
                  value={form.instagram_handle}
                  placeholder="@matbex.os"
                  onChange={(e) => update("instagram_handle", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">X / Twitter handle</Label>
                <Input
                  value={form.x_handle}
                  placeholder="@matbex_os"
                  onChange={(e) => update("x_handle", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">TikTok handle</Label>
                <Input
                  value={form.tiktok_handle}
                  placeholder="@matbex"
                  onChange={(e) => update("tiktok_handle", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Snapchat handle</Label>
                <Input
                  value={form.snapchat_handle}
                  placeholder="@matbex"
                  onChange={(e) => update("snapchat_handle", e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Promotional message (English)</Label>
                <Input
                  value={form.promo_message_en}
                  placeholder="Get 10% off on your next visit - show this receipt!"
                  maxLength={160}
                  onChange={(e) => update("promo_message_en", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Promotional message (Arabic)</Label>
                <Input
                  dir="rtl"
                  value={form.promo_message_ar}
                  placeholder="احصل على خصم 10٪ في زيارتك القادمة - أحضر هذه الفاتورة!"
                  maxLength={160}
                  onChange={(e) => update("promo_message_ar", e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5 rounded-md border p-3">
                <Label className="text-xs font-medium">Loyalty sign-up QR</Label>
                <Input
                  type="url"
                  value={form.loyalty_qr_url}
                  placeholder="https://join.matbex.com/loyalty"
                  onChange={(e) => update("loyalty_qr_url", e.target.value)}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    value={form.loyalty_qr_label_en}
                    placeholder="Join & save"
                    onChange={(e) => update("loyalty_qr_label_en", e.target.value)}
                  />
                  <Input
                    dir="rtl"
                    value={form.loyalty_qr_label_ar}
                    placeholder="انضم ووفّر"
                    onChange={(e) => update("loyalty_qr_label_ar", e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5 rounded-md border p-3">
                <Label className="text-xs font-medium">Re-order QR (menu link)</Label>
                <Input
                  type="url"
                  value={form.reorder_qr_url}
                  placeholder="https://www.matbex.com/m/your-restaurant"
                  onChange={(e) => update("reorder_qr_url", e.target.value)}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    value={form.reorder_qr_label_en}
                    placeholder="Order again"
                    onChange={(e) => update("reorder_qr_label_en", e.target.value)}
                  />
                  <Input
                    dir="rtl"
                    value={form.reorder_qr_label_ar}
                    placeholder="اطلب مجدداً"
                    onChange={(e) => update("reorder_qr_label_ar", e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="pt-1 grid grid-cols-1 md:grid-cols-2 gap-1.5">
              <ToggleRow
                label="Show phone on receipt"
                checked={form.show_phone}
                onChange={(v) => update("show_phone", v)}
              />
              <ToggleRow
                label="Show social handles on receipt"
                checked={form.show_social_handles}
                onChange={(v) => update("show_social_handles", v)}
              />
              <ToggleRow
                label="Show promo message"
                checked={form.show_promo_message}
                onChange={(v) => update("show_promo_message", v)}
              />
              <ToggleRow
                label="Show loyalty QR"
                checked={form.show_loyalty_qr}
                onChange={(v) => update("show_loyalty_qr", v)}
              />
              <ToggleRow
                label="Show re-order QR"
                checked={form.show_reorder_qr}
                onChange={(v) => update("show_reorder_qr", v)}
              />
            </div>
          </section>

          <Separator />

          {/* PDF */}
          <section className="space-y-3">
            <h3 className="text-sm font-medium">PDF receipt</h3>
            <ToggleRow
              label="Auto-generate PDF receipt for every sale"
              checked={form.auto_generate_pdf_receipt}
              onChange={(v) => update("auto_generate_pdf_receipt", v)}
            />
            <div className="space-y-1.5">
              <Label className="text-xs">PDF generation mode</Label>
              <Select
                value={form.pdf_generation_mode}
                onValueChange={(v) =>
                  update("pdf_generation_mode", v as FormState["pdf_generation_mode"])
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="SOFT">
                    Soft - complete sale, retry PDF later
                  </SelectItem>
                  <SelectItem value="STRICT">
                    Strict - block sale if PDF fails
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </section>

          {showSummary && (
            <div
              ref={summaryRef}
              role="alert"
              aria-live="assertive"
              tabIndex={-1}
              className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive outline-none focus-visible:ring-2 focus-visible:ring-destructive/50"
            >
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="font-medium">
                  {Array.from(new Set(validation.errors)).length} issue
                  {Array.from(new Set(validation.errors)).length === 1 ? "" : "s"} to fix before saving:
                </p>
                <ul className="list-disc pl-4 space-y-0.5">
                  {Array.from(
                    new Map(
                      Object.entries(validation.fieldErrors).map(([k, msg]) => [k, msg as string]),
                    ).entries(),
                  ).map(([key, msg]) => (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={() => {
                          const el = fieldRefs.current[key as keyof FormState];
                          if (el && typeof el.focus === "function") {
                            el.focus();
                            el.scrollIntoView({ behavior: "smooth", block: "center" });
                          }
                        }}
                        className="underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/60 rounded-sm"
                      >
                        {FIELD_LABELS[key as keyof FormState]}: {msg}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-2">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setShowTest((s) => !s)}
                className="gap-2"
                disabled={!sampleValidation.valid}
              >
                <ScanLine className="h-4 w-4" />
                {showTest ? "Hide test QR" : "Test QR"}
              </Button>
              <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" className="gap-2 text-muted-foreground" disabled={saving}>
                    <RotateCcw className="h-4 w-4" />
                    Reset to defaults
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset ZATCA settings?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This restores all toggles, phase, QR size and PDF mode to the
                      recommended safe defaults (Phase 1, QR enabled on printed and
                      digital receipts, soft PDF mode). Your seller name and VAT
                      registration number are preserved. Changes are not saved until
                      you click <strong>Save settings</strong>.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleReset}>
                      Reset
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <AlertDialog open={diffOpen} onOpenChange={setDiffOpen}>
                <AlertDialogContent className="max-w-lg">
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Confirm changes (STRICT mode)
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      You are saving in <strong>Strict</strong> mode - sales will
                      be blocked if PDF generation fails. Review the field-by-field
                      changes below before applying.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <div className="rounded-md border divide-y text-xs max-h-72 overflow-auto">
                    {diff.length === 0 ? (
                      <div className="px-3 py-4 text-center text-muted-foreground">
                        No changes to apply.
                      </div>
                    ) : (
                      diff.map((d) => (
                        <div
                          key={d.key}
                          className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center px-3 py-2"
                        >
                          <div className="min-w-0">
                            <div className="text-muted-foreground text-[10px] uppercase tracking-wide">
                              {FIELD_LABELS[d.key]}
                            </div>
                            <div className="font-mono truncate text-destructive line-through">
                              {formatDiffValue(d.from)}
                            </div>
                          </div>
                          <div className="text-muted-foreground">→</div>
                          <div className="min-w-0">
                            <div className="text-muted-foreground text-[10px] uppercase tracking-wide">
                              New
                            </div>
                            <div className="font-mono truncate text-emerald-600">
                              {formatDiffValue(d.to)}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={performSave} disabled={saving}>
                      {saving ? "Saving…" : `Apply ${diff.length} change${diff.length === 1 ? "" : "s"}`}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button
                variant="outline"
                onClick={handleTestPdf}
                className="gap-2"
                disabled={testingPdf || !validation.valid}
              >
                {testingPdf ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
                Test PDF
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                onClick={async () => {
                  try {
                    const to = new Date().toISOString();
                    const from = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
                    const { data: sess } = await supabase.auth.getSession();
                    const token = sess.session?.access_token;
                    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zatca-audit-export`;
                    const res = await fetch(url, {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token ?? ""}`,
                        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
                      },
                      body: JSON.stringify({ from, to }),
                    });
                    if (!res.ok) throw new Error(await res.text());
                    const blob = await res.blob();
                    const a = document.createElement("a");
                    const objUrl = URL.createObjectURL(blob);
                    a.href = objUrl;
                    a.download = `zatca-audit-${from.slice(0,10)}_to_${to.slice(0,10)}.csv`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(objUrl), 60_000);
                    toast.success("Audit export downloaded.");
                  } catch (e) {
                    toast.error((e as Error).message || "Export failed");
                  }
                }}
              >
                <Download className="h-4 w-4" />
                Export audit (last 12 mo)
              </Button>
            </div>
            <Button onClick={handleSave} disabled={!dirty || saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save settings
            </Button>
          </div>
        </CardContent>
      </Card>

      {showTest && sampleValidation.valid && sampleBase64 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Test QR preview</CardTitle>
            <CardDescription>
              Sample using total <strong>115.00</strong>, VAT <strong>15.00</strong>,
              and current timestamp. Scan with any QR reader to verify decoding.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-6 items-start">
              <div className="rounded-lg bg-white p-3 border shrink-0">
                <QRCodeSVG
                  value={sampleBase64}
                  size={QR_PIXELS[form.qr_size]}
                  level="M"
                />
              </div>
              <div className="space-y-3 min-w-0 flex-1">
                <div>
                  <Label className="text-xs text-muted-foreground">TLV tags</Label>
                  <div className="mt-1 rounded-md border divide-y text-xs">
                    {tlvTagsFromInput(sampleInput).map((t) => (
                      <div key={t.tag} className="flex justify-between gap-3 px-3 py-1.5">
                        <span className="text-muted-foreground">
                          {t.tag}. {t.name}
                        </span>
                        <span className="font-mono truncate">{t.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">
                    Base64 TLV value
                  </Label>
                  <textarea
                    readOnly
                    value={sampleBase64}
                    className="mt-1 w-full h-20 rounded-md border bg-muted/30 p-2 font-mono text-[10px] resize-none"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <BranchReceiptOverridesEditor />
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <Label className="text-sm font-normal">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}