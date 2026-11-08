// =====================================================================
// zatca-submit-clearance
// ---------------------------------------------------------------------
// Submits a signed UBL invoice to ZATCA Fatoora for clearance (B2B
// `/invoices/clearance/single`) or reporting (B2C simplified
// `/invoices/reporting/single`). Updates the originating sale row with
// the clearance status, ZATCA-returned UUID + clearedInvoice (signed
// QR/hash) and stores the response payload for audit.
//
// Live mode is gated on the ZATCA_BASE_URL secret; without it we run
// in *simulation* mode and stamp `CLEARED_SIM` so the rest of the
// pipeline (UI badges, audit export) can be exercised end-to-end.
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { buildCorsHeaders } from "../_shared/cors.ts";

// Request-scoped CORS headers. Assigned at the top of every request so the
// module-level response helpers below can spread them without a ReferenceError.
let corsHeaders: Record<string, string> = buildCorsHeaders(new Request("https://matbex.com"));
interface Body {
  sales_transaction_id: string;
  /** Override channel; default chosen from invoice subtype (Simplified=reporting). */
  channel?: "clearance" | "reporting";
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function b64(s: string): string { return btoa(s); }

async function sha256B64(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function downloadXml(supabase: ReturnType<typeof createClient>, signedUrl: string): Promise<string> {
  const res = await fetch(signedUrl);
  if (!res.ok) throw new Error(`Failed to fetch signed XML: ${res.status}`);
  return await res.text();
}

Deno.serve(async (req) => {
  corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: claims } = await supabase.auth.getClaims(authHeader.replace("Bearer ", ""));
  if (!claims?.claims) return json({ error: "Unauthorized" }, 401);

  let body: Body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!body.sales_transaction_id) return json({ error: "sales_transaction_id is required" }, 400);

  // Load sale + device CSID (RLS scopes by tenant).
  const { data: sale, error: saleErr } = await supabase
    .from("sales_transactions")
    .select("id, zatca_uuid, zatca_invoice_hash, zatca_signed_xml_url, zatca_device_id, zatca_clearance_status, zatca_invoice_subtype")
    .eq("id", body.sales_transaction_id)
    .single();
  if (saleErr || !sale) return json({ error: saleErr?.message ?? "Sale not found" }, 404);

  if (!sale.zatca_signed_xml_url) {
    return json({ error: "Sale has no signed UBL - sign it first" }, 409);
  }
  if (sale.zatca_clearance_status === "CLEARED" || sale.zatca_clearance_status === "REPORTED") {
    return json({ ok: true, already: true, status: sale.zatca_clearance_status });
  }

  const { data: device } = await supabase
    .from("zatca_devices")
    .select("production_csid, production_csid_secret, public_cert_pem")
    .eq("id", sale.zatca_device_id)
    .maybeSingle();

  let signedXml: string;
  try { signedXml = await downloadXml(supabase, sale.zatca_signed_xml_url); }
  catch (e) { return json({ error: (e as Error).message }, 502); }

  // Auto-route by invoice subtype: STANDARD/B2B → clearance, SIMPLIFIED/B2C → reporting.
  const channel: "clearance" | "reporting" =
    body.channel ??
    ((sale as { zatca_invoice_subtype?: string }).zatca_invoice_subtype === "STANDARD"
      ? "clearance"
      : "reporting");
  const baseUrl = Deno.env.get("ZATCA_BASE_URL");

  let status: "CLEARED" | "REPORTED" | "REJECTED" | "CLEARED_SIM";
  let response: unknown;
  let httpStatus = 200;

  if (baseUrl) {
    const path = channel === "clearance"
      ? "/invoices/clearance/single"
      : "/invoices/reporting/single";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Language": "en",
      "Accept-Version": "V2",
      "Clearance-Status": channel === "clearance" ? "1" : "0",
    };
    if (device?.production_csid) {
      // ZATCA Basic auth = base64(productionCSID : productionCSIDSecret).
      // The secret is captured during onboarding (Step 3 - Production
      // CSID issuance) and stored on the device row.
      const secret = (device as { production_csid_secret?: string })
        .production_csid_secret ?? "";
      headers.Authorization = `Basic ${btoa(`${device.production_csid}:${secret}`)}`;
    }
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        invoiceHash: sale.zatca_invoice_hash,
        uuid: sale.zatca_uuid,
        invoice: b64(signedXml),
      }),
    });
    httpStatus = res.status;
    try { response = await res.json(); } catch { response = await res.text(); }
    const ok = res.ok || (response as { clearanceStatus?: string })?.clearanceStatus === "CLEARED";
    if (!ok) status = "REJECTED";
    else status = channel === "clearance" ? "CLEARED" : "REPORTED";
  } else {
    status = "CLEARED_SIM";
    response = {
      simulated: true,
      uuid: sale.zatca_uuid,
      invoiceHash: sale.zatca_invoice_hash,
      clearedInvoice: b64(signedXml).slice(0, 32) + "...",
    };
  }

  // Persist on the sale row. We compute a fresh sha256 of the signed
  // XML so the audit hash matches what was actually submitted.
  const submittedHash = await sha256B64(signedXml);
  const { error: updErr } = await supabase
    .from("sales_transactions")
    .update({
      zatca_clearance_status: status,
      zatca_clearance_response: response as never,
      zatca_cleared_at: new Date().toISOString(),
      // Refresh the canonical hash to the one ZATCA actually saw.
      zatca_invoice_hash: submittedHash,
    })
    .eq("id", sale.id);
  if (updErr) console.warn("[zatca-submit] update failed", updErr.message);

  return json({
    ok: status !== "REJECTED",
    status,
    http_status: httpStatus,
    response,
  });
});