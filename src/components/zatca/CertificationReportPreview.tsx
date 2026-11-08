import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Download, FileText, CheckCircle2, Loader2, Circle, ShieldCheck } from "lucide-react";
import { format } from "date-fns";
import type { CertificationReportInput } from "@/lib/zatca/certificationReportPdf";

interface CertificationReportPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: CertificationReportInput | null;
  onDownload: () => void;
}

function StateBadge({ state }: { state: "done" | "pending" | "todo" }) {
  if (state === "done") {
    return (
      <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">
        COMPLETE
      </Badge>
    );
  }
  if (state === "pending") {
    return (
      <Badge variant="outline" className="text-amber-600 border-amber-200 text-[10px]">
        IN PROGRESS
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground text-[10px]">
      TODO
    </Badge>
  );
}

function StateIcon({ state }: { state: "done" | "pending" | "todo" }) {
  if (state === "done") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (state === "pending") return <Loader2 className="h-4 w-4 text-amber-500 animate-spin" />;
  return <Circle className="h-4 w-4 text-muted-foreground" />;
}

export function CertificationReportPreview({
  open,
  onOpenChange,
  data,
  onDownload,
}: CertificationReportPreviewProps) {
  const [downloading, setDownloading] = useState(false);

  if (!data) return null;

  const doneCount = data.steps.filter((s) => s.state === "done").length;
  const progress = Math.round((doneCount / data.steps.length) * 100);

  const handleDownload = () => {
    setDownloading(true);
    try {
      onDownload();
    } finally {
      setTimeout(() => {
        setDownloading(false);
        onOpenChange(false);
      }, 600);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0 gap-0 overflow-hidden">
        <DialogHeader
          className="px-6 pt-6 pb-5 border-b"
          style={{
            backgroundColor: data.branding?.primaryColor || "#00A859",
          }}
        >
          <div className="flex items-center gap-3">
            {data.branding?.logoUrl ? (
              <div className="w-12 h-12 rounded-lg bg-white/95 flex items-center justify-center overflow-hidden shrink-0">
                <img
                  src={data.branding.logoUrl}
                  alt={data.branding.businessName || data.tenantName}
                  className="max-w-full max-h-full object-contain p-1"
                />
              </div>
            ) : (
              <div className="w-12 h-12 rounded-lg bg-white/20 flex items-center justify-center shrink-0">
                <FileText className="h-6 w-6 text-white" />
              </div>
            )}
            <div className="space-y-0.5 text-white">
              <DialogTitle className="text-base text-white">
                {data.branding?.businessName || data.tenantName}
              </DialogTitle>
              <DialogDescription className="text-xs text-white/85">
                {data.branding?.tagline || "ZATCA Phase 2 - Certification Report"} ·{" "}
                {format(new Date(), "PP")}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="px-6 py-5 space-y-6">
            {/* Header block */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  ZATCA Phase 2 - Certification Report
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">Tenant: {data.tenantName}</p>
              </div>
              <Badge variant={progress === 100 ? "default" : "secondary"} className="shrink-0">
                {progress === 100 ? "Certified" : `${doneCount}/${data.steps.length} steps`}
              </Badge>
            </div>

            {/* Seller identity */}
            <div className="rounded-lg border bg-card p-4 space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Seller Identity
              </h4>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground text-xs">Name (EN)</span>
                  <p className="font-medium">{data.settings?.seller_name_en ?? "-"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Name (AR)</span>
                  <p className="font-medium">{data.settings?.seller_name_ar ?? "-"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">VAT Number</span>
                  <p className="font-medium">{data.settings?.vat_registration_number ?? "-"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Phase Mode</span>
                  <p className="font-medium">{data.settings?.zatca_phase_mode ?? "-"}</p>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground text-xs">PDF Generation Mode</span>
                  <p className="font-medium">{data.settings?.pdf_generation_mode ?? "-"}</p>
                </div>
              </div>
            </div>

            {/* Steps checklist */}
            <div className="rounded-lg border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Certification Checklist
                </h4>
                <span className="text-xs text-muted-foreground">{doneCount} of {data.steps.length} complete</span>
              </div>
              <div className="space-y-1">
                {data.steps.map((step, i) => (
                  <div
                    key={step.id}
                    className="flex items-center gap-3 py-2 px-3 rounded-md hover:bg-muted/50 transition-colors"
                  >
                    <span className="text-xs text-muted-foreground w-4">{i + 1}</span>
                    <StateIcon state={step.state} />
                    <span className="text-sm flex-1">{step.title}</span>
                    <StateBadge state={step.state} />
                  </div>
                ))}
              </div>
            </div>

            {/* Devices */}
            <div className="rounded-lg border bg-card p-4 space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Registered Devices
              </h4>
              {data.devices.length === 0 ? (
                <p className="text-sm text-muted-foreground">No devices registered.</p>
              ) : (
                <div className="space-y-3">
                  {data.devices.map((d) => {
                    const extra = d as unknown as {
                      compliance_csid: string | null;
                      production_csid: string | null;
                      compliance_passed_at: string | null;
                    };
                    return (
                      <div key={d.id} className="rounded-md border p-3 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium">{d.name}</p>
                          <span className="text-xs text-muted-foreground">SN {d.serial_number}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <span className="text-muted-foreground">Status: <span className="text-foreground font-medium">{d.registration_status}</span></span>
                          <span className="text-muted-foreground">ICV: <span className="text-foreground font-medium">{d.icv_counter}</span></span>
                          <span className="text-muted-foreground">Compliance: <span className="text-foreground font-medium">{extra.compliance_csid ? "issued" : "-"}</span></span>
                          <span className="text-muted-foreground">Production: <span className="text-foreground font-medium">{extra.production_csid ? "issued" : "-"}</span></span>
                        </div>
                        {extra.compliance_passed_at && (
                          <p className="text-xs text-muted-foreground">
                            Compliance passed: {format(new Date(extra.compliance_passed_at), "PPp")}
                          </p>
                        )}
                        {d.csid_expires_at && (
                          <p className="text-xs text-muted-foreground">
                            CSID expires: {format(new Date(d.csid_expires_at), "PPp")}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Clearance metrics */}
            <div className="rounded-lg border bg-card p-4 space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Clearance Health (Last 30 Days)
              </h4>
              {!data.metrics ? (
                <p className="text-sm text-muted-foreground">No clearance activity yet.</p>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-md border p-3 text-center">
                    <p className="text-lg font-bold text-emerald-600">
                      {(data.metrics.successRate * 100).toFixed(1)}%
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">Success Rate</p>
                  </div>
                  <div className="rounded-md border p-3 text-center">
                    <p className="text-lg font-bold">{data.metrics.total}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Total Events</p>
                  </div>
                  <div className="rounded-md border p-3 text-center">
                    <p className="text-lg font-bold text-emerald-600">{data.metrics.cleared}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Cleared</p>
                  </div>
                  <div className="rounded-md border p-3 text-center">
                    <p className="text-lg font-bold">{data.metrics.reported}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Reported</p>
                  </div>
                  <div className="rounded-md border p-3 text-center">
                    <p className="text-lg font-bold text-amber-600">{data.metrics.pending}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Pending</p>
                  </div>
                  <div className="rounded-md border p-3 text-center">
                    <p className="text-lg font-bold text-red-600">{data.metrics.rejected}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Rejected</p>
                  </div>
                  {data.metrics.avgLatencyMs != null && (
                    <div className="rounded-md border p-3 text-center col-span-3">
                      <p className="text-lg font-bold">{(data.metrics.avgLatencyMs / 1000).toFixed(2)}s</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Average Latency</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer disclaimer */}
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              This report is generated from the live audit trail. The hash-chained clearance ledger in{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-[10px]">zatca_audit_trail</code> is the
              authoritative source for ZATCA inspections.
            </p>
          </div>
        </ScrollArea>

        <DialogFooter className="px-6 py-4 border-t gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleDownload} disabled={downloading} className="gap-2">
            {downloading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {downloading ? "Downloading…" : "Download PDF"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
