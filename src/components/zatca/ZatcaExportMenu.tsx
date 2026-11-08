import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Download, FileText, FileSpreadsheet } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import jsPDF from "jspdf";

type Metrics = {
  total: number;
  cleared: number;
  reported: number;
  pending: number;
  rejected: number;
  schemaInvalid: number;
  successRate: number;
  avgLatencyMs: number | null;
};

type Device = {
  id: string;
  name: string;
  serial_number: string;
  registration_status: string | null;
  csid_expires_at: string | null;
};

type AuditRow = {
  id: string;
  action: string;
  created_at: string;
  payload_hash: string;
  prev_hash: string | null;
};

type FailureRow = { bucket: string; label: string; count: number };

interface Props {
  metrics: Metrics | null | undefined;
  devices: Device[] | undefined;
  audit: AuditRow[] | undefined;
  failures?: FailureRow[] | undefined;
}

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function buildCsv(
  metrics: Metrics | null | undefined,
  devices: Device[] = [],
  audit: AuditRow[] = [],
  failures: FailureRow[] = [],
) {
  const lines: string[] = [];
  lines.push("ZATCA Compliance Export");
  lines.push(`Generated,${csvEscape(format(new Date(), "yyyy-MM-dd HH:mm:ss"))}`);
  lines.push("");

  lines.push("# KPIs (last 30 days)");
  lines.push("Metric,Value");
  if (metrics) {
    lines.push(`Total events,${metrics.total}`);
    lines.push(`Cleared,${metrics.cleared}`);
    lines.push(`Reported,${metrics.reported}`);
    lines.push(`Pending,${metrics.pending}`);
    lines.push(`Rejected,${metrics.rejected}`);
    lines.push(`Schema invalid,${metrics.schemaInvalid}`);
    lines.push(`Success rate,${(metrics.successRate * 100).toFixed(2)}%`);
    lines.push(`Avg latency (ms),${metrics.avgLatencyMs ?? ""}`);
  }
  lines.push("");

  lines.push("# Devices");
  lines.push("Name,Serial,Status,CSID Expires");
  for (const d of devices) {
    lines.push(
      [d.name, d.serial_number, d.registration_status ?? "", d.csid_expires_at ?? ""]
        .map(csvEscape)
        .join(",")
    );
  }
  lines.push("");

  lines.push("# Failure Breakdown (last 30 days)");
  lines.push("Bucket,Count");
  if (failures.length === 0) {
    lines.push("No failures,0");
  } else {
    for (const f of failures) {
      lines.push([f.label, f.count].map(csvEscape).join(","));
    }
  }
  lines.push("");

  lines.push("# Audit Trail");
  lines.push("Timestamp,Action,Payload Hash,Prev Hash");
  for (const a of audit) {
    lines.push(
      [a.created_at, a.action, a.payload_hash, a.prev_hash ?? ""].map(csvEscape).join(",")
    );
  }

  return lines.join("\n");
}

function buildPdf(
  metrics: Metrics | null | undefined,
  devices: Device[] = [],
  audit: AuditRow[] = [],
  failures: FailureRow[] = [],
) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 40;
  let y = 50;

  const ensureSpace = (h: number) => {
    if (y + h > pageH - 40) {
      doc.addPage();
      y = 50;
    }
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("ZATCA Compliance Report", marginX, y);
  y += 18;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`Generated ${format(new Date(), "PPpp")} · last 30 days`, marginX, y);
  doc.setTextColor(0);
  y += 24;

  // KPIs
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("KPIs", marginX, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  if (metrics) {
    const rows: [string, string][] = [
      ["Total events", String(metrics.total)],
      ["Cleared", String(metrics.cleared)],
      ["Reported", String(metrics.reported)],
      ["Pending", String(metrics.pending)],
      ["Rejected", String(metrics.rejected)],
      ["Schema invalid", String(metrics.schemaInvalid)],
      ["Success rate", `${(metrics.successRate * 100).toFixed(2)}%`],
      ["Avg latency", metrics.avgLatencyMs != null ? `${(metrics.avgLatencyMs / 1000).toFixed(2)}s` : "-"],
    ];
    for (const [k, v] of rows) {
      ensureSpace(14);
      doc.text(k, marginX, y);
      doc.text(v, marginX + 200, y);
      y += 14;
    }
  } else {
    doc.text("No data", marginX, y);
    y += 14;
  }
  y += 10;

  // Devices
  ensureSpace(30);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Devices", marginX, y);
  y += 14;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Name", marginX, y);
  doc.text("Serial", marginX + 160, y);
  doc.text("Status", marginX + 320, y);
  doc.text("CSID Expires", marginX + 410, y);
  y += 12;
  doc.setFont("helvetica", "normal");
  if (!devices.length) {
    doc.setTextColor(120);
    doc.text("No devices onboarded", marginX, y);
    doc.setTextColor(0);
    y += 14;
  }
  for (const d of devices) {
    ensureSpace(12);
    doc.text(String(d.name).slice(0, 28), marginX, y);
    doc.text(String(d.serial_number).slice(0, 28), marginX + 160, y);
    doc.text(String(d.registration_status ?? "-"), marginX + 320, y);
    doc.text(d.csid_expires_at ? format(new Date(d.csid_expires_at), "yyyy-MM-dd") : "-", marginX + 410, y);
    y += 12;
  }
  y += 14;

  // Failure breakdown
  ensureSpace(30);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Failure Breakdown", marginX, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  if (!failures.length) {
    doc.setTextColor(120);
    doc.text("No failures in the last 30 days", marginX, y);
    doc.setTextColor(0);
    y += 14;
  } else {
    for (const f of failures) {
      ensureSpace(14);
      doc.text(f.label, marginX, y);
      doc.text(String(f.count), marginX + 200, y);
      y += 14;
    }
  }
  y += 10;

  // Audit
  ensureSpace(30);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Audit Trail", marginX, y);
  y += 14;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Timestamp", marginX, y);
  doc.text("Action", marginX + 140, y);
  doc.text("Payload Hash", marginX + 240, y);
  y += 12;
  doc.setFont("helvetica", "normal");
  if (!audit.length) {
    doc.setTextColor(120);
    doc.text("No audit events", marginX, y);
    doc.setTextColor(0);
  }
  for (const a of audit) {
    ensureSpace(12);
    doc.text(format(new Date(a.created_at), "yyyy-MM-dd HH:mm"), marginX, y);
    doc.text(String(a.action).slice(0, 18), marginX + 140, y);
    doc.setFont("courier", "normal");
    doc.text(a.payload_hash.slice(0, 32), marginX + 240, y);
    doc.setFont("helvetica", "normal");
    y += 12;
  }

  // Page numbers
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`Page ${i} of ${pages}`, pageW - marginX, pageH - 20, { align: "right" });
  }

  return doc;
}

export function ZatcaExportMenu({ metrics, devices, audit, failures }: Props) {
  const { toast } = useToast();
  const stamp = format(new Date(), "yyyyMMdd-HHmm");

  const handleCsv = () => {
    const csv = buildCsv(metrics, devices ?? [], audit ?? [], failures ?? []);
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `zatca-compliance-${stamp}.csv`);
    toast({ title: "CSV exported", description: "Compliance snapshot downloaded." });
  };

  const handlePdf = () => {
    const doc = buildPdf(metrics, devices ?? [], audit ?? [], failures ?? []);
    doc.save(`zatca-compliance-${stamp}.pdf`);
    toast({ title: "PDF exported", description: "Compliance report downloaded." });
  };

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" className="gap-2" onClick={handleCsv}>
        <FileSpreadsheet className="h-4 w-4" />
        Export CSV
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Download className="h-4 w-4" />
            More
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Compliance snapshot</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleCsv} className="gap-2">
            <FileSpreadsheet className="h-4 w-4" />
            Download CSV
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handlePdf} className="gap-2">
            <FileText className="h-4 w-4" />
            Download PDF
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}