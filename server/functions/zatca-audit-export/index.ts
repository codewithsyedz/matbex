import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
// ZATCA Audit Export - generates a CSV export of all sales transactions
// with their ZATCA stamps for a given date range. Used to satisfy ZATCA's
// 6-year archival/retention audit requirement.
import { createClient } from "@matbex/client";

import { buildCorsHeaders } from "../_shared/cors.ts";
interface Body {
  from?: string; // ISO date
  to?: string;   // ISO date
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const db = createClient(
      env("API_URL") ?? "",
      env("ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userData, error: userErr } = await db.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: Body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const from = body.from ?? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const to = body.to ?? new Date().toISOString();

    const { data, error } = await db
      .from("sales_transactions")
      .select(
        "id, receipt_number, created_at, total_amount:total, payment_method, zatca_seller_name, zatca_vat_number, zatca_invoice_total, zatca_vat_total, zatca_timestamp, zatca_qr_base64, zatca_pdf_url, zatca_xml_url, zatca_signed_xml_url, zatca_signature, zatca_device_id, zatca_icv, zatca_pih, zatca_invoice_hash, zatca_uuid, zatca_clearance_status, zatca_cleared_at, legal_retention_until",
      )
      .gte("created_at", from)
      .lte("created_at", to)
      .order("created_at", { ascending: true })
      .limit(50_000);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rows = data ?? [];
    const headers = [
      "id","receipt_number","created_at","total_amount","payment_method",
      "zatca_seller_name","zatca_vat_number","zatca_invoice_total","zatca_vat_total",
      "zatca_timestamp","has_qr","zatca_pdf_url","zatca_xml_url","zatca_signed_xml_url","has_signature","zatca_device_id","zatca_icv",
      "zatca_pih","zatca_invoice_hash","zatca_uuid","zatca_clearance_status",
      "zatca_cleared_at","legal_retention_until",
    ];
    const lines = [headers.join(",")];
    for (const r of rows) {
      lines.push([
        r.id, r.receipt_number, r.created_at, r.total_amount, r.payment_method,
        r.zatca_seller_name, r.zatca_vat_number, r.zatca_invoice_total, r.zatca_vat_total,
        r.zatca_timestamp, r.zatca_qr_base64 ? "yes" : "no", r.zatca_pdf_url, r.zatca_xml_url, r.zatca_signed_xml_url, r.zatca_signature ? "yes" : "no", r.zatca_device_id,
        r.zatca_icv, r.zatca_pih, r.zatca_invoice_hash, r.zatca_uuid, r.zatca_clearance_status,
        r.zatca_cleared_at, r.legal_retention_until,
      ].map(csvEscape).join(","));
    }
    const csv = lines.join("\n");

    return new Response(csv, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="zatca-audit-${from.slice(0,10)}_to_${to.slice(0,10)}.csv"`,
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});