import { format, parseISO } from "date-fns";

export interface SalesDetailDay {
  date: string;
  raw: number;
  adjustments: number;
  summary: number | null;
  final: number;
  closed: boolean;
}

export interface SalesDetailExportInput {
  title: string;
  subtitle: string;
  days: SalesDetailDay[];
  total: number;
  money: (v: number) => string;
}

const fileStamp = () => format(new Date(), "yyyy-MM-dd-HHmm");

export async function exportSalesDetailPdf(input: SalesDetailExportInput) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });

  // Standard PDF fonts cannot render the Riyal glyph, so amounts are plain
  // numbers and the currency is stated once in the header.
  const num = (v: number) =>
    v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dash = "-";

  doc.setFontSize(14);
  doc.text(input.title, 40, 44);
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(`${input.subtitle}  ·  Amounts in SAR`, 40, 60);
  doc.setTextColor(0);

  autoTable(doc, {
    startY: 78,
    margin: { left: 40, right: 40 },
    tableWidth: 515,
    head: [["Date", "POS", "Adjustments", "Closed day total", "Status", "Sales"]],
    body: input.days.map((d) => [
      format(parseISO(d.date), "MMM d, yyyy"),
      num(d.raw),
      d.adjustments !== 0 ? num(d.adjustments) : dash,
      d.summary !== null ? num(d.summary) : dash,
      d.closed ? "Closed" : "Open",
      num(d.final),
    ]),
    foot: [["Total", "", "", "", "", num(input.total)]],
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 8,
      cellPadding: 5,
      overflow: "linebreak",
      valign: "middle",
      lineColor: [225, 228, 232],
      lineWidth: 0.5,
    },
    headStyles: { fillColor: [0, 168, 89], textColor: 255, fontStyle: "bold", halign: "right" },
    footStyles: { fillColor: [245, 245, 245], textColor: 20, fontStyle: "bold", halign: "right" },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    columnStyles: {
      0: { cellWidth: 95, halign: "left" },
      1: { cellWidth: 85, halign: "right" },
      2: { cellWidth: 95, halign: "right" },
      3: { cellWidth: 105, halign: "right" },
      4: { cellWidth: 55, halign: "center" },
      5: { cellWidth: 80, halign: "right" },
    },
    didParseCell: (data) => {
      if (data.section === "head" && data.column.index === 0) data.cell.styles.halign = "left";
      if (data.section === "head" && data.column.index === 4) data.cell.styles.halign = "center";
      if (data.section === "foot" && data.column.index === 0) data.cell.styles.halign = "left";
    },
  });

  doc.save(`sales-detail-${fileStamp()}.pdf`);
}

export async function exportSalesDetailImage(node: HTMLElement) {
  const { default: html2canvas } = await import("html2canvas");

  // Temporarily unclip any scrollable areas so the export captures everything.
  const scrollables = [node, ...Array.from(node.querySelectorAll<HTMLElement>("*"))].filter((el) => {
    const s = getComputedStyle(el);
    return (
      el.scrollHeight > el.clientHeight + 1 &&
      (s.overflowY === "auto" || s.overflowY === "scroll" || s.overflowY === "hidden")
    );
  });
  const saved = scrollables.map((el) => ({
    el,
    maxHeight: el.style.maxHeight,
    height: el.style.height,
    overflow: el.style.overflow,
    overflowY: el.style.overflowY,
  }));
  for (const el of scrollables) {
    el.style.maxHeight = "none";
    el.style.height = "auto";
    el.style.overflow = "visible";
    el.style.overflowY = "visible";
  }

  let canvas: HTMLCanvasElement;
  try {
    canvas = await html2canvas(node, {
      backgroundColor: "#ffffff",
      scale: 2,
      windowHeight: Math.max(node.scrollHeight + 200, window.innerHeight),
      height: node.scrollHeight,
    });
  } finally {
    for (const s of saved) {
      s.el.style.maxHeight = s.maxHeight;
      s.el.style.height = s.height;
      s.el.style.overflow = s.overflow;
      s.el.style.overflowY = s.overflowY;
    }
  }
  const link = document.createElement("a");
  link.download = `sales-detail-${fileStamp()}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}
