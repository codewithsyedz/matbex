import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { buildCorsHeaders } from "../_shared/cors.ts";
interface InvoiceData {
  invoice: {
    invoice_number: string;
    billing_period_start: string;
    billing_period_end: string;
    subtotal: number;
    tax_amount: number;
    total_amount: number;
    amount_paid: number;
    due_date: string | null;
    status: string;
    created_at: string;
  };
  customer: {
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
  };
  restaurant: {
    name: string;
    currency: string;
  };
  transactions: Array<{
    created_at: string;
    receipt_number: string | null;
    total: number;
    payment_method: string;
  }>;
}

function formatCurrency(amount: number, currency: string): string {
  const symbol = currency === "SAR" ? "﷼" : "$";
  return `${symbol}${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function generateInvoiceHTML(data: InvoiceData): string {
  const { invoice, customer, restaurant, transactions } = data;
  const currency = restaurant.currency;
  const balance = invoice.total_amount - invoice.amount_paid;

  const transactionRows = transactions
    .map(
      (t) => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #eee;">${formatDate(t.created_at)}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee;">${t.receipt_number || "-"}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee; text-transform: capitalize;">${t.payment_method}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">${formatCurrency(t.total, currency)}</td>
      </tr>
    `
    )
    .join("");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Invoice ${invoice.invoice_number}</title>
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 40px; color: #333; }
    .header { display: flex; justify-content: space-between; margin-bottom: 40px; }
    .company { font-size: 24px; font-weight: bold; color: #1a1a1a; }
    .invoice-title { font-size: 32px; font-weight: bold; color: #666; text-align: right; }
    .invoice-number { font-size: 14px; color: #888; text-align: right; }
    .customer-info { margin-bottom: 30px; }
    .customer-info h3 { margin: 0 0 10px 0; color: #666; font-size: 12px; text-transform: uppercase; }
    .customer-info p { margin: 4px 0; }
    .period { background: #f8f8f8; padding: 15px; border-radius: 8px; margin-bottom: 30px; }
    .period-label { font-size: 12px; color: #666; text-transform: uppercase; }
    .period-dates { font-size: 16px; font-weight: 500; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
    th { text-align: left; padding: 12px 8px; border-bottom: 2px solid #333; font-size: 12px; text-transform: uppercase; color: #666; }
    th:last-child { text-align: right; }
    .totals { margin-left: auto; width: 300px; }
    .totals-row { display: flex; justify-content: space-between; padding: 8px 0; }
    .totals-row.total { font-size: 18px; font-weight: bold; border-top: 2px solid #333; padding-top: 12px; margin-top: 8px; }
    .totals-row.balance { color: ${balance > 0 ? "#dc2626" : "#16a34a"}; }
    .status { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 500; text-transform: uppercase; }
    .status.paid { background: #dcfce7; color: #16a34a; }
    .status.partial { background: #fef3c7; color: #d97706; }
    .status.pending { background: #fee2e2; color: #dc2626; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #888; text-align: center; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="company">${restaurant.name}</div>
    </div>
    <div>
      <div class="invoice-title">INVOICE</div>
      <div class="invoice-number">${invoice.invoice_number}</div>
      <div style="margin-top: 10px;">
        <span class="status ${invoice.status}">${invoice.status}</span>
      </div>
    </div>
  </div>

  <div class="customer-info">
    <h3>Bill To</h3>
    <p style="font-weight: 500; font-size: 18px;">${customer.name}</p>
    ${customer.phone ? `<p>${customer.phone}</p>` : ""}
    ${customer.email ? `<p>${customer.email}</p>` : ""}
    ${customer.address ? `<p>${customer.address}</p>` : ""}
  </div>

  <div class="period">
    <div class="period-label">Billing Period</div>
    <div class="period-dates">${formatDate(invoice.billing_period_start)} - ${formatDate(invoice.billing_period_end)}</div>
    ${invoice.due_date ? `<div style="margin-top: 8px; font-size: 14px;">Due Date: <strong>${formatDate(invoice.due_date)}</strong></div>` : ""}
  </div>

  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Receipt #</th>
        <th>Payment Method</th>
        <th>Amount</th>
      </tr>
    </thead>
    <tbody>
      ${transactionRows}
    </tbody>
  </table>

  <div class="totals">
    <div class="totals-row">
      <span>Subtotal</span>
      <span>${formatCurrency(invoice.subtotal, currency)}</span>
    </div>
    <div class="totals-row">
      <span>Tax</span>
      <span>${formatCurrency(invoice.tax_amount, currency)}</span>
    </div>
    <div class="totals-row total">
      <span>Total</span>
      <span>${formatCurrency(invoice.total_amount, currency)}</span>
    </div>
    <div class="totals-row">
      <span>Amount Paid</span>
      <span>${formatCurrency(invoice.amount_paid, currency)}</span>
    </div>
    <div class="totals-row balance">
      <span>Balance Due</span>
      <span>${formatCurrency(balance, currency)}</span>
    </div>
  </div>

  <div class="footer">
    Generated on ${formatDate(new Date().toISOString())} | Invoice ${invoice.invoice_number}
  </div>
</body>
</html>
  `;
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { invoiceId } = await req.json();

    if (!invoiceId) {
      throw new Error("Invoice ID is required");
    }

    // Fetch invoice with related data
    const { data: invoice, error: invoiceError } = await supabase
      .from("settlement_invoices")
      .select(`
        *,
        customers!inner(name, phone, email, address),
        restaurants!inner(name, currency)
      `)
      .eq("id", invoiceId)
      .single();

    if (invoiceError || !invoice) {
      throw new Error("Invoice not found");
    }

    // Fetch transactions linked to this invoice
    const { data: transactions } = await supabase
      .from("sales_transactions")
      .select("created_at, receipt_number, total, payment_method")
      .eq("settlement_invoice_id", invoiceId)
      .order("created_at", { ascending: true });

    const invoiceData: InvoiceData = {
      invoice: {
        invoice_number: invoice.invoice_number,
        billing_period_start: invoice.billing_period_start,
        billing_period_end: invoice.billing_period_end,
        subtotal: invoice.subtotal,
        tax_amount: invoice.tax_amount,
        total_amount: invoice.total_amount,
        amount_paid: invoice.amount_paid,
        due_date: invoice.due_date,
        status: invoice.status,
        created_at: invoice.created_at,
      },
      customer: invoice.customers,
      restaurant: invoice.restaurants,
      transactions: transactions || [],
    };

    const html = generateInvoiceHTML(invoiceData);

    return new Response(
      JSON.stringify({ html, invoiceNumber: invoice.invoice_number }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: unknown) {
    console.error("Error generating invoice:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      }
    );
  }
});
