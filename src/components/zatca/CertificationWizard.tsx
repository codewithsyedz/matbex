import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2,
  Circle,
  Loader2,
  ShieldCheck,
  ExternalLink,
  Download,
  Eye,
  FileText,
  Trash2,
  History,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useZatcaSettings } from "@/hooks/useZatcaSettings";
import { useZatcaDevices } from "@/hooks/useZatcaDevices";
import { useZatcaCompliance } from "@/hooks/useZatcaCompliance";
import { useAuth } from "@/contexts/AuthContext";
import { useRestaurantBranding } from "@/hooks/useRestaurantBranding";
import { useZatcaCertificationReports } from "@/hooks/useZatcaCertificationReports";
import { CertificationReportPreview } from "./CertificationReportPreview";
import type { CertificationReportInput } from "@/lib/zatca/certificationReportPdf";
import { format } from "date-fns";
import { toast } from "sonner";

type StepState = "done" | "pending" | "todo";

interface Step {
  id: string;
  title: string;
  description: string;
  state: StepState;
  cta?: { label: string; href: string };
}

function StepRow({ step, index }: { step: Step; index: number }) {
  const Icon =
    step.state === "done" ? CheckCircle2 : step.state === "pending" ? Loader2 : Circle;
  const tone =
    step.state === "done"
      ? "text-emerald-600"
      : step.state === "pending"
      ? "text-amber-600"
      : "text-muted-foreground";
  return (
    <div className="flex items-start gap-3 py-3">
      <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${tone} ${step.state === "pending" ? "animate-spin" : ""}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium">
            <span className="text-muted-foreground mr-1.5">{index + 1}.</span>
            {step.title}
          </p>
          {step.state === "done" && (
            <Badge variant="secondary" className="text-[10px] h-5">Complete</Badge>
          )}
          {step.state === "pending" && (
            <Badge variant="outline" className="text-[10px] h-5">In progress</Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
      </div>
      {step.cta && step.state !== "done" && (
        <Button asChild size="sm" variant="outline" className="shrink-0 gap-1">
          <Link to={step.cta.href}>
            {step.cta.label}
            <ExternalLink className="h-3 w-3" />
          </Link>
        </Button>
      )}
    </div>
  );
}

export function CertificationWizard() {
  const { settings, loading: sLoading } = useZatcaSettings();
  const { devices, loading: dLoading } = useZatcaDevices();
  const { data: metrics } = useZatcaCompliance();
  const { tenant } = useAuth();
  const { branding } = useRestaurantBranding();
  const [previewOpen, setPreviewOpen] = useState(false);
  const { list: history, save, download, remove } = useZatcaCertificationReports();

  const sellerOk = !!(
    settings?.seller_name_en?.trim() &&
    settings?.seller_name_ar?.trim() &&
    settings?.vat_registration_number &&
    /^\d{15}$/.test(settings.vat_registration_number)
  );
  const phase2Ready = settings?.zatca_phase_mode === "PHASE_2_READY";
  const hasDevice = (devices ?? []).length > 0;

  // Read extra fields off the raw row - interface omits them, but `select("*")`
  // returns them. Cast as unknown then index.
  const devRows = (devices ?? []) as unknown as Array<{
    id: string;
    compliance_csid: string | null;
    production_csid: string | null;
    compliance_passed_at: string | null;
    registration_status: string;
  }>;
  const complianceDone = devRows.some((d) => !!d.compliance_passed_at);
  const productionDone = devRows.some((d) => !!d.production_csid);
  const activeSet = !!settings?.active_device_id;
  const firstCleared = (metrics?.cleared ?? 0) > 0;

  const steps: Step[] = [
    {
      id: "seller",
      title: "Configure seller identity",
      description: "Set English + Arabic seller names and a valid 15-digit VAT number.",
      state: sellerOk ? "done" : "todo",
      cta: { label: "Open settings", href: "/settings?tab=zatca" },
    },
    {
      id: "phase2",
      title: "Enable Phase 2 e-invoicing mode",
      description: "Switches the engine from QR-only (Phase 1) to UBL + Fatoora clearance.",
      state: phase2Ready ? "done" : sellerOk ? "todo" : "todo",
      cta: { label: "Enable", href: "/settings?tab=zatca" },
    },
    {
      id: "device",
      title: "Register a POS device",
      description: "Each terminal needs a serial number and a ZATCA Fatoora OTP.",
      state: hasDevice ? "done" : "todo",
      cta: { label: "Add device", href: "/settings?tab=zatca" },
    },
    {
      id: "compliance",
      title: "Pass compliance checks",
      description: "Submit the 6 sample invoices required by Fatoora to issue a Compliance CSID.",
      state: complianceDone ? "done" : hasDevice ? "pending" : "todo",
      cta: { label: "Onboard device", href: "/settings?tab=zatca" },
    },
    {
      id: "production",
      title: "Issue Production CSID",
      description: "Exchange the compliance request for the production certificate used in live clearance.",
      state: productionDone ? "done" : complianceDone ? "pending" : "todo",
    },
    {
      id: "active",
      title: "Set active device for this restaurant",
      description: "Live sales will sign with this device's ICV counter and PIH chain.",
      state: activeSet ? "done" : productionDone ? "todo" : "todo",
      cta: { label: "Choose device", href: "/settings?tab=zatca" },
    },
    {
      id: "live",
      title: "Clear your first live invoice",
      description: "Record one sale and confirm Fatoora returns CLEARED.",
      state: firstCleared ? "done" : activeSet ? "todo" : "todo",
      cta: { label: "Go to POS", href: "/record-sale" },
    },
  ];

  const doneCount = steps.filter((s) => s.state === "done").length;
  const progress = Math.round((doneCount / steps.length) * 100);
  const certified = doneCount === steps.length;

  const reportData: CertificationReportInput = {
    tenantName: (tenant as { name?: string } | null)?.name ?? "Restaurant",
    settings,
    devices: devices ?? [],
    metrics: metrics ?? null,
    steps: steps.map((s) => ({ id: s.id, title: s.title, state: s.state })),
    branding: branding
      ? {
          logoUrl: branding.logo_url,
          businessName: branding.business_display_name,
          tagline: branding.tagline,
          primaryColor: branding.primary_color,
        }
      : null,
  };

  const onPreview = () => setPreviewOpen(true);

  const onDownload = async () => {
    try {
      const { blob, fileName } = await save.mutateAsync(reportData);
      // Trigger the immediate browser download for the just-generated file
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Report saved to history");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const formatSize = (bytes: number | null) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              Phase 2 production certification
            </CardTitle>
            <CardDescription>
              Track every step required by ZATCA Fatoora to go live with e-invoicing.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant={certified ? "default" : "secondary"}
              className={certified ? "bg-emerald-600 hover:bg-emerald-600" : ""}
            >
              {certified ? "Certified" : `${doneCount}/${steps.length} steps`}
            </Badge>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={onPreview}
              disabled={sLoading || dLoading}
            >
              <Eye className="h-3.5 w-3.5" />
              Preview & download
            </Button>
          </div>
        </div>
        <div className="pt-3 space-y-1">
          <Progress value={progress} className="h-1.5" />
          <p className="text-[11px] text-muted-foreground">{progress}% complete</p>
        </div>
      </CardHeader>
      <CardContent>
        {sLoading || dLoading ? (
          <p className="text-sm text-muted-foreground py-4">Loading certification status…</p>
        ) : (
          <div className="divide-y">
            {steps.map((s, i) => (
              <StepRow key={s.id} step={s} index={i} />
            ))}
          </div>
        )}

        <div className="mt-6 pt-4 border-t">
          <div className="flex items-center gap-2 mb-2">
            <History className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-medium">Report history</p>
            {history.data && history.data.length > 0 && (
              <Badge variant="secondary" className="text-[10px] h-5">
                {history.data.length}
              </Badge>
            )}
          </div>
          {history.isLoading ? (
            <p className="text-xs text-muted-foreground py-2">Loading history…</p>
          ) : !history.data || history.data.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">
              No reports saved yet. Use Preview &amp; download to generate one.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {history.data.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center gap-3 px-3 py-2 text-sm"
                >
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="truncate font-medium">{r.file_name}</p>
                      {r.certified ? (
                        <Badge className="bg-emerald-600 hover:bg-emerald-600 text-[10px] h-5">
                          Certified
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] h-5">
                          {r.completed_steps}/{r.total_steps} steps
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {format(new Date(r.created_at), "PPp")}
                      {r.file_size_bytes ? ` • ${formatSize(r.file_size_bytes)}` : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 gap-1"
                    onClick={() => download.mutate(r)}
                    disabled={download.isPending}
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      if (confirm(`Delete ${r.file_name}?`)) remove.mutate(r);
                    }}
                    disabled={remove.isPending}
                    aria-label="Delete report"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
      <CertificationReportPreview
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        data={reportData}
        onDownload={onDownload}
      />
    </Card>
  );
}