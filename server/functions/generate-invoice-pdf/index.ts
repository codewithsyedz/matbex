import { serve } from "../_runtime/serve.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { withMetrics } from "../_shared/metrics.ts";
// @deno-types="https://esm.sh/@types/pdfkit@0.12.7"
import PDFDocument from "pdfkit";

interface InvoiceItem {
  description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
}

interface Invoice {
  invoice_number: string;
  supplier_name: string;
  invoice_date: string;
  due_date: string | null;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  notes: string | null;
}

interface Restaurant {
  name: string;
  currency: string;
}

interface RequestBody {
  invoice: Invoice;
  items: InvoiceItem[];
  restaurant: Restaurant;
}

const handler = async (req: Request): Promise<Response> => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { invoice, items, restaurant }: RequestBody = await req.json();

    console.log("Generating PDF for invoice:", invoice.invoice_number);

    // Create PDF document
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Uint8Array[] = [];

    doc.on("data", (chunk: Uint8Array) => chunks.push(chunk));

    // Header
    doc.fontSize(24).font("Helvetica-Bold").text(restaurant.name, { align: "left" });
    doc.moveDown(0.5);
    doc.fontSize(12).font("Helvetica").fillColor("#666666").text("Purchase Invoice", { align: "left" });
    
    // Invoice details box
    doc.moveDown(2);
    const topY = doc.y;
    
    // Left column - Invoice details
    doc.fillColor("#000000");
    doc.fontSize(10).font("Helvetica-Bold").text("Invoice Number:", 50, topY);
    doc.font("Helvetica").text(invoice.invoice_number, 150, topY);
    
    doc.font("Helvetica-Bold").text("Date:", 50, topY + 15);
    doc.font("Helvetica").text(new Date(invoice.invoice_date).toLocaleDateString(), 150, topY + 15);
    
    if (invoice.due_date) {
      doc.font("Helvetica-Bold").text("Due Date:", 50, topY + 30);
      doc.font("Helvetica").text(new Date(invoice.due_date).toLocaleDateString(), 150, topY + 30);
    }

    // Right column - Supplier
    doc.font("Helvetica-Bold").text("Supplier:", 350, topY);
    doc.font("Helvetica").text(invoice.supplier_name || "N/A", 350, topY + 15);

    // Items table
    doc.moveDown(4);
    const tableTop = doc.y;
    const tableLeft = 50;
    const colWidths = [250, 60, 80, 100];

    // Table header
    doc.fillColor("#f5f5f5");
    doc.rect(tableLeft, tableTop, 495, 25).fill();
    
    doc.fillColor("#000000");
    doc.font("Helvetica-Bold").fontSize(10);
    doc.text("Description", tableLeft + 10, tableTop + 8);
    doc.text("Qty", tableLeft + colWidths[0] + 10, tableTop + 8);
    doc.text("Unit Price", tableLeft + colWidths[0] + colWidths[1] + 10, tableTop + 8);
    doc.text("Total", tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + 10, tableTop + 8);

    // Table rows
    let rowY = tableTop + 25;
    doc.font("Helvetica").fontSize(10);
    
    items.forEach((item, index) => {
      if (index % 2 === 1) {
        doc.fillColor("#fafafa");
        doc.rect(tableLeft, rowY, 495, 25).fill();
      }
      
      doc.fillColor("#000000");
      doc.text(item.description || "-", tableLeft + 10, rowY + 8, { width: colWidths[0] - 20 });
      doc.text(item.quantity.toString(), tableLeft + colWidths[0] + 10, rowY + 8);
      doc.text(`${Number(item.unit_price).toFixed(2)}`, tableLeft + colWidths[0] + colWidths[1] + 10, rowY + 8);
      doc.text(`${Number(item.total_price).toFixed(2)}`, tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + 10, rowY + 8);
      
      rowY += 25;
    });

    // Border around table
    doc.strokeColor("#e0e0e0");
    doc.rect(tableLeft, tableTop, 495, rowY - tableTop).stroke();

    // Totals
    const totalsX = 400;
    rowY += 20;
    
    doc.font("Helvetica").text("Subtotal:", totalsX, rowY);
    doc.text(`${Number(invoice.subtotal).toFixed(2)} ${restaurant.currency}`, totalsX + 80, rowY, { align: "right", width: 65 });
    
    rowY += 18;
    doc.text("VAT (15%):", totalsX, rowY);
    doc.text(`${Number(invoice.tax_amount).toFixed(2)} ${restaurant.currency}`, totalsX + 80, rowY, { align: "right", width: 65 });
    
    rowY += 18;
    doc.strokeColor("#000000").moveTo(totalsX, rowY).lineTo(545, rowY).stroke();
    rowY += 8;
    
    doc.font("Helvetica-Bold").fontSize(12);
    doc.text("Total:", totalsX, rowY);
    doc.text(`${Number(invoice.total_amount).toFixed(2)} ${restaurant.currency}`, totalsX + 80, rowY, { align: "right", width: 65 });

    // Notes
    if (invoice.notes) {
      rowY += 40;
      doc.font("Helvetica-Bold").fontSize(10).text("Notes:", 50, rowY);
      doc.font("Helvetica").text(invoice.notes, 50, rowY + 15, { width: 495 });
    }

    // Footer
    doc.fontSize(8).fillColor("#999999");
    doc.text(
      `Generated on ${new Date().toLocaleString()}`,
      50,
      doc.page.height - 50,
      { align: "center", width: 495 }
    );

    doc.end();

    // Wait for PDF to be generated
    await new Promise<void>((resolve) => {
      doc.on("end", () => resolve());
    });

    // Combine chunks into single Uint8Array
    const pdfBytes = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      pdfBytes.set(chunk, offset);
      offset += chunk.length;
    }

    // Convert to base64
    const base64 = btoa(String.fromCharCode(...pdfBytes));

    console.log("PDF generated successfully, size:", pdfBytes.length);

    return new Response(
      JSON.stringify({ pdf: base64 }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("Error generating PDF:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(withMetrics("generate-invoice-pdf", handler));
