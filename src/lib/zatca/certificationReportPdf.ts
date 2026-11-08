import jsPDF from "jspdf";
import { format } from "date-fns";
import QRCode from "qrcode";
import type { ZatcaSettings } from "@/hooks/useZatcaSettings";
import type { ZatcaDevice } from "@/hooks/useZatcaDevices";
import type { ZatcaComplianceMetrics } from "@/hooks/useZatcaCompliance";

export interface CertificationStepSnapshot {
  id: string;
  title: string;
  state: "done" | "pending" | "todo";
}

export interface CertificationBranding {
  logoUrl: string | null;
  businessName: string | null;
  tagline: string | null;
  primaryColor: string;
}

export interface CertificationReportInput {
  tenantName: string;
  settings: ZatcaSettings | null;
  devices: ZatcaDevice[];
  metrics: ZatcaComplianceMetrics | null;
  steps: CertificationStepSnapshot[];
  branding?: CertificationBranding | null;
  verificationUrl?: string | null;
}

function stateLabel(s: CertificationStepSnapshot["state"]) {
  return s === "done" ? "COMPLETE" : s === "pending" ? "IN PROGRESS" : "TODO";
}

function hexToRgb(hex: string): [number, number, number] {
  const cleaned = (hex || "").replace("#", "").trim();
  const full =
    cleaned.length === 3
      ? cleaned.split("").map((c) => c + c).join("")
      : cleaned.padEnd(6, "0").slice(0, 6);
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return [0, 168, 89];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

async function loadImageAsDataUrl(
  url: string,
): Promise<{ dataUrl: string; width: number; height: number; format: "PNG" | "JPEG" } | null> {
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const dims = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = reject;
      img.src = dataUrl;
    });
    const fmt: "PNG" | "JPEG" =
      blob.type.includes("jpeg") || blob.type.includes("jpg") ? "JPEG" : "PNG";
    return { dataUrl, width: dims.width, height: dims.height, format: fmt };
  } catch {
    return null;
  }
}

export async function generateCertificationReportPdf(
  input: CertificationReportInput,
): Promise<jsPDF> {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 48;
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = margin;

  const primary = hexToRgb(input.branding?.primaryColor ?? "#00A859");
  const displayName = input.branding?.businessName || input.tenantName;

  const line = (
    text: string,
    opts?: { size?: number; bold?: boolean; color?: [number, number, number] },
  ) => {
    const size = opts?.size ?? 10;
    doc.setFontSize(size);
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    if (opts?.color) doc.setTextColor(opts.color[0], opts.color[1], opts.color[2]);
    else doc.setTextColor(20, 20, 20);
    const wrapped = doc.splitTextToSize(text, pageWidth - margin * 2);
    doc.text(wrapped, margin, y);
    y += wrapped.length * (size + 4);
    if (y > doc.internal.pageSize.getHeight() - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const hr = (color?: [number, number, number]) => {
    if (color) doc.setDrawColor(color[0], color[1], color[2]);
    else doc.setDrawColor(220, 220, 220);
    doc.line(margin, y, pageWidth - margin, y);
    y += 14;
  };

  // ---- Branded header band ----
  const headerHeight = 76;
  doc.setFillColor(primary[0], primary[1], primary[2]);
  doc.rect(0, 0, pageWidth, headerHeight, "F");

  const logo = input.branding?.logoUrl ? await loadImageAsDataUrl(input.branding.logoUrl) : null;
  let textX = margin;
  if (logo) {
    const maxH = 44;
    const ratio = logo.width / logo.height || 1;
    const h = maxH;
    const w = Math.min(maxH * ratio, 120);
    const logoY = (headerHeight - h) / 2;
    try {
      doc.addImage(logo.dataUrl, logo.format, margin, logoY, w, h, undefined, "FAST");
      textX = margin + w + 14;
    } catch {
      // ignore broken image
    }
  }

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(displayName, textX, 34);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(input.branding?.tagline || "ZATCA Phase 2 - Certification Report", textX, 50);
  doc.setFontSize(8);
  doc.text(`Generated ${format(new Date(), "PPpp")}`, textX, 64);

  y = headerHeight + 24;

  // ---- Verification QR (top-right) ----
  if (input.verificationUrl) {
    try {
      const qrDataUrl = await QRCode.toDataURL(input.verificationUrl, {
        margin: 0,
        width: 256,
        errorCorrectionLevel: "M",
        color: { dark: "#0f172a", light: "#ffffff" },
      });
      const qrSize = 78;
      const qrX = pageWidth - margin - qrSize;
      const qrY = y;
      doc.addImage(qrDataUrl, "PNG", qrX, qrY, qrSize, qrSize, undefined, "FAST");
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(120, 120, 120);
      doc.text("Scan to verify", qrX, qrY + qrSize + 9, {
        maxWidth: qrSize,
        align: "left",
      });
    } catch {
      // ignore QR failures
    }
  }

  line("Certification summary", { size: 14, bold: true, color: primary });
  y += 2;
  hr(primary);

  if (input.verificationUrl) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(110, 110, 110);
    const verifyText = `Verify: ${input.verificationUrl}`;
    const wrapped = doc.splitTextToSize(verifyText, pageWidth - margin * 2);
    doc.text(wrapped, margin, y);
    y += wrapped.length * 12 + 4;
  }

  // Seller identity
  line("Seller identity", { size: 12, bold: true });
  line(`Tenant: ${input.tenantName}`);
  line(`Name (EN): ${input.settings?.seller_name_en ?? "-"}`);
  line(`Name (AR): ${input.settings?.seller_name_ar ?? "-"}`);
  line(`VAT number: ${input.settings?.vat_registration_number ?? "-"}`);
  line(`Phase mode: ${input.settings?.zatca_phase_mode ?? "-"}`);
  line(`PDF generation mode: ${input.settings?.pdf_generation_mode ?? "-"}`);
  y += 6;
  hr();

  // Checklist
  line("Certification checklist", { size: 12, bold: true });
  const done = input.steps.filter((s) => s.state === "done").length;
  line(`${done} of ${input.steps.length} steps complete`, { size: 9, color: [120, 120, 120] });
  y += 4;
  input.steps.forEach((s, i) => {
    const tone: [number, number, number] =
      s.state === "done" ? [16, 122, 70] : s.state === "pending" ? [180, 110, 0] : [120, 120, 120];
    line(`${i + 1}. ${s.title}  -  ${stateLabel(s.state)}`, { color: tone });
  });
  y += 6;
  hr();

  // Devices
  line("Registered devices", { size: 12, bold: true });
  if (input.devices.length === 0) {
    line("No devices registered.", { color: [120, 120, 120] });
  } else {
    input.devices.forEach((d) => {
      const extra = d as unknown as {
        compliance_csid: string | null;
        production_csid: string | null;
        compliance_passed_at: string | null;
      };
      line(`• ${d.name}  (SN ${d.serial_number})`, { bold: true });
      line(`   Status: ${d.registration_status}`);
      line(`   ICV counter: ${d.icv_counter}`);
      line(
        `   Compliance CSID: ${extra.compliance_csid ? "issued" : "-"}` +
          `   Production CSID: ${extra.production_csid ? "issued" : "-"}`,
      );
      if (extra.compliance_passed_at) {
        line(`   Compliance passed: ${format(new Date(extra.compliance_passed_at), "PPp")}`);
      }
      if (d.csid_expires_at) {
        line(`   CSID expires: ${format(new Date(d.csid_expires_at), "PPp")}`);
      }
      y += 2;
    });
  }
  y += 6;
  hr();

  // Metrics
  line("Clearance health (last 30 days)", { size: 12, bold: true });
  if (!input.metrics) {
    line("No clearance activity yet.", { color: [120, 120, 120] });
  } else {
    const m = input.metrics;
    line(`Success rate: ${(m.successRate * 100).toFixed(1)}%`);
    line(`Total events: ${m.total}`);
    line(`Cleared: ${m.cleared}    Reported: ${m.reported}`);
    line(`Pending: ${m.pending}    Rejected: ${m.rejected}    Schema invalid: ${m.schemaInvalid}`);
    if (m.avgLatencyMs != null) {
      line(`Average latency: ${(m.avgLatencyMs / 1000).toFixed(2)}s`);
    }
  }
  y += 10;
  hr();

  line(
    "This report is generated from the live audit trail. The hash-chained " +
      "clearance ledger in zatca_audit_trail is the authoritative source for " +
      "ZATCA inspections.",
    { size: 8, color: [140, 140, 140] },
  );

  // Branded footer on every page
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const ph = doc.internal.pageSize.getHeight();
    doc.setFillColor(primary[0], primary[1], primary[2]);
    doc.rect(0, ph - 6, pageWidth, 6, "F");
    doc.setTextColor(140, 140, 140);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(`${displayName} • Page ${i} of ${pageCount}`, margin, ph - 14);
  }

  return doc;
}

export async function downloadCertificationReportPdf(input: CertificationReportInput) {
  const doc = await generateCertificationReportPdf(input);
  const stamp = format(new Date(), "yyyy-MM-dd");
  doc.save(`zatca-certification-${stamp}.pdf`);
}

export async function generateCertificationReportBlob(
  input: CertificationReportInput,
): Promise<{ blob: Blob; fileName: string }> {
  const doc = await generateCertificationReportPdf(input);
  const blob = doc.output("blob");
  const stamp = format(new Date(), "yyyyMMdd-HHmmss");
  return { blob, fileName: `zatca-certification-${stamp}.pdf` };
}