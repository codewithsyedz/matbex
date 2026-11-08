/**
 * Shared audit stamp for exported PDFs.
 * Renders a traceability block (timestamp, exporting user, applied filters)
 * on every page footer so a downloaded report can always be tied back to
 * who generated it and under which filter selection.
 */

const MUTED: [number, number, number] = [110, 118, 128];
const HAIRLINE: [number, number, number] = [216, 220, 224];

export interface PdfAuditStamp {
  /** Display name of the exporting user. */
  exportedBy: string;
  /** Optional email / identifier shown next to the name. */
  exportedByEmail?: string | null;
  /** Optional role of the exporting user at export time. */
  role?: string | null;
  /** Filter label pairs exactly as selected on screen. */
  filters: Array<{ label: string; value: string }>;
  /** Optional document reference, e.g. the generated file name. */
  reference?: string | null;
  /** Overrides the export moment (defaults to now). */
  exportedAt?: Date;
}

const fmtStamp = (d: Date) =>
  d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "medium" });

/** Human-readable one-liners used by both the PDF footer and any UI preview. */
export function auditStampLines(stamp: PdfAuditStamp): string[] {
  const who = [stamp.exportedBy || "Unknown user", stamp.exportedByEmail || null]
    .filter(Boolean)
    .join(" · ");
  const filters = stamp.filters
    .filter((f) => f.value && f.value.trim().length > 0)
    .map((f) => `${f.label}: ${f.value}`)
    .join("   |   ");

  return [
    `Exported ${fmtStamp(stamp.exportedAt ?? new Date())} by ${who}${
      stamp.role ? ` (${stamp.role})` : ""
    }`,
    filters ? `Filters — ${filters}` : "Filters — none applied",
    stamp.reference ? `Document reference: ${stamp.reference}` : "",
  ].filter(Boolean);
}

/**
 * Draws the audit stamp on every page of the document. Call this last,
 * after all tables have been laid out (it iterates existing pages).
 * Returns the vertical space (pt) the stamp occupies at the page bottom.
 */
export function drawPdfAuditStamp(doc: any, stamp: PdfAuditStamp, opts?: { margin?: number }) {
  const margin = opts?.margin ?? 40;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const lines = auditStampLines(stamp);
  const maxWidth = pageWidth - margin * 2;

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);

    const wrapped = lines.flatMap((l) => doc.splitTextToSize(l, maxWidth) as string[]);
    const blockHeight = wrapped.length * 9;
    const top = pageHeight - 14 - blockHeight;

    doc.setDrawColor(...HAIRLINE);
    doc.setLineWidth(0.5);
    doc.line(margin, top - 7, pageWidth - margin, top - 7);

    wrapped.forEach((line, idx) => {
      doc.text(line, margin, top + idx * 9);
    });

    doc.setTextColor(0, 0, 0);
  }

  return lines.length * 9 + 14;
}
