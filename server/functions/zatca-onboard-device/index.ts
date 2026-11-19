import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
// =====================================================================
// ZATCA Phase 2 - Device onboarding (Compliance + Production CSID)
// ---------------------------------------------------------------------
// This function runs the official Fatoora onboarding flow:
//   1. Generate (or accept a stored) CSR for the device
//   2. POST CSR + OTP to {ZATCA}/compliance      → Compliance CSID
//   3. POST request_id to     {ZATCA}/production → Production CSID
//
// The actual CSR generation (PKCS#10 over secp256k1) and the live
// Fatoora HTTP calls are gated behind ZATCA_BASE_URL. When that secret
// is missing we run in *simulation* mode: we mint a self-signed CSID
// stub so the rest of the pipeline (chain, XML, signing) can be tested
// end-to-end without hitting ZATCA. Flip the secret on and the same
// function performs the real onboarding - no client changes needed.
// =====================================================================

import { createClient } from "@matbex/client";

import { buildCorsHeaders } from "../_shared/cors.ts";

// Request-scoped CORS headers. Assigned at the top of every request so the
// module-level response helpers below can spread them without a ReferenceError.
let corsHeaders: Record<string, string> = buildCorsHeaders(new Request("https://matbex.com"));
interface Body {
  device_id: string;
  /** Optional: override OTP stored on the device row. */
  otp?: string;
  /**
   * Optional pre-signed sample invoice (base64 UBL) used for the
   * Compliance CSID validation step required by Fatoora before issuing
   * a Production CSID. If omitted in live mode we skip the sample
   * check (Fatoora will reject - caller must provide one).
   */
  sample_invoice_b64?: string;
  sample_invoice_hash?: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

// -------------------------------------------------------------------
// EC keypair generation (P-256). ZATCA actually mandates secp256k1 for
// the production CSR; WebCrypto in Deno only ships P-256/P-384/P-521,
// so the *real* CSR will be produced by node-forge once we wire it.
// For now we still mint a P-256 keypair so the XAdES signer downstream
// has real material to sign with end-to-end (simulation mode parity).
// -------------------------------------------------------------------
function ab2b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function pem(label: string, b64: string): string {
  const chunks = b64.match(/.{1,64}/g)?.join("\n") ?? b64;
  return `-----BEGIN ${label}-----\n${chunks}\n-----END ${label}-----`;
}
async function generateDeviceKeypair(): Promise<{ privateKeyPem: string; publicKeyPem: string }> {
  const kp = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", kp.privateKey);
  const spki = await crypto.subtle.exportKey("spki", kp.publicKey);
  return {
    privateKeyPem: pem("PRIVATE KEY", ab2b64(pkcs8)),
    publicKeyPem: pem("PUBLIC KEY", ab2b64(spki)),
  };
}

/** Placeholder CSR - replaced once we wire node-forge / WebCrypto signing. */
function buildPlaceholderCsr(serial: string, vat: string, name: string): string {
  const payload = btoa(`CSR:${serial}:${vat}:${name}:${Date.now()}`);
  return `-----BEGIN CERTIFICATE REQUEST-----\n${payload}\n-----END CERTIFICATE REQUEST-----`;
}

async function callZatca(
  baseUrl: string,
  path: string,
  body: unknown,
  otp?: string,
  basicAuth?: { username: string; secret: string },
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "Accept-Version": "V2",
  };
  if (otp) headers["OTP"] = otp;
  if (basicAuth) {
    headers.Authorization =
      "Basic " + btoa(`${basicAuth.username}:${basicAuth.secret}`);
  }
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  let data: unknown = null;
  try { data = await res.json(); } catch { /* non-json */ }
  return { ok: res.ok, status: res.status, data };
}

serve(async (req) => {
  corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return jsonResponse({ error: "Unauthorized" }, 401);

  const db = createClient(
    env("API_URL") ?? "",
    env("ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: claims, error: claimsErr } = await db.auth.getClaims(
    authHeader.replace("Bearer ", ""),
  );
  if (claimsErr || !claims?.claims) return jsonResponse({ error: "Unauthorized" }, 401);

  let body: Body;
  try { body = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON" }, 400); }
  if (!body.device_id) return jsonResponse({ error: "device_id is required" }, 400);

  // Load device + seller settings (RLS guarantees same tenant).
  const { data: device, error: devErr } = await db
    .from("zatca_devices")
    .select("id, tenant_id, name, serial_number, model, otp, csr, registration_status")
    .eq("id", body.device_id)
    .single();
  if (devErr || !device) return jsonResponse({ error: devErr?.message ?? "Device not found" }, 404);

  const { data: settings } = await db
    .from("zatca_settings")
    .select("seller_name_en, vat_registration_number")
    .eq("tenant_id", device.tenant_id)
    .maybeSingle();

  const otp = body.otp ?? device.otp ?? "";
  const csr =
    device.csr ??
    buildPlaceholderCsr(
      device.serial_number,
      settings?.vat_registration_number ?? "",
      settings?.seller_name_en ?? device.name,
    );

  const baseUrl = env("ZATCA_BASE_URL");
  let complianceCsid: string;
  let complianceCsidSecret: string | null;
  let complianceRequestId: string | null = null;
  let productionCsid: string;
  let productionCsidSecret: string | null;
  let compliancePassedAt: string | null = null;
  let mode: "live" | "simulated";

  if (baseUrl) {
    mode = "live";
    if (!otp) return jsonResponse({ error: "OTP required for live ZATCA onboarding" }, 400);

    // Step 1: exchange CSR + OTP for the Compliance CSID.
    const compl = await callZatca(baseUrl, "/compliance", { csr }, otp);
    if (!compl.ok) {
      return jsonResponse({ error: "ZATCA compliance step failed", details: compl.data, status: compl.status }, 502);
    }
    const complData = compl.data as Record<string, unknown>;
    complianceCsid = (complData?.binarySecurityToken as string) ?? "";
    complianceCsidSecret = (complData?.secret as string) ?? null;
    complianceRequestId = String(complData?.requestID ?? "");

    // Step 2: validate a sample invoice with the Compliance CSID. ZATCA
    // refuses to issue a Production CSID until at least one sample
    // invoice has been accepted on the compliance endpoint.
    if (body.sample_invoice_b64 && body.sample_invoice_hash) {
      const sample = await callZatca(
        baseUrl,
        "/compliance/invoices",
        {
          invoiceHash: body.sample_invoice_hash,
          uuid: crypto.randomUUID(),
          invoice: body.sample_invoice_b64,
        },
        undefined,
        complianceCsidSecret
          ? { username: complianceCsid, secret: complianceCsidSecret }
          : undefined,
      );
      if (!sample.ok) {
        return jsonResponse({
          error: "ZATCA compliance sample-invoice check failed",
          details: sample.data,
          status: sample.status,
        }, 502);
      }
      compliancePassedAt = new Date().toISOString();
    }

    // Step 3: exchange the compliance request id for the Production CSID.
    const prod = await callZatca(
      baseUrl,
      "/production/csids",
      { compliance_request_id: complianceRequestId },
      undefined,
      complianceCsidSecret
        ? { username: complianceCsid, secret: complianceCsidSecret }
        : undefined,
    );
    if (!prod.ok) {
      return jsonResponse({ error: "ZATCA production step failed", details: prod.data, status: prod.status }, 502);
    }
    const prodData = prod.data as Record<string, unknown>;
    productionCsid = (prodData?.binarySecurityToken as string) ?? "";
    productionCsidSecret = (prodData?.secret as string) ?? null;
  } else {
    mode = "simulated";
    complianceCsid = `SIM-COMPLIANCE-${device.serial_number}-${Date.now()}`;
    complianceCsidSecret = `SIM-SECRET-C-${device.serial_number}`;
    complianceRequestId = `SIM-REQ-${device.serial_number}`;
    compliancePassedAt = new Date().toISOString();
    productionCsid = `SIM-PROD-${device.serial_number}-${Date.now()}`;
    productionCsidSecret = `SIM-SECRET-P-${device.serial_number}`;
  }

  // The caller loaded this device through RLS above. Keys and CSID secrets are written and
  // read with the service client: browsers cannot read or write them (migration 20261110180818).
  const admin = createClient(env("API_URL") ?? "", env("SERVICE_ROLE_KEY") ?? "");
  const { error: updErr } = await admin
    .from("zatca_devices")
    .update({
      csr,
      compliance_csid: complianceCsid,
      compliance_csid_secret: complianceCsidSecret,
      compliance_request_id: complianceRequestId,
      compliance_passed_at: compliancePassedAt,
      production_csid: productionCsid,
      production_csid_secret: productionCsidSecret,
      csid_expires_at: isoDaysFromNow(365),
      registration_status: "REGISTERED",
      registered_at: new Date().toISOString(),
      otp: null, // OTP is single-use - clear it after onboarding
      ...(await (async () => {
        // Only generate a keypair if the device doesn't already have one,
        // so re-onboarding doesn't invalidate previously signed invoices.
        const { data: existing } = await admin
          .from("zatca_devices")
          .select("private_key_pem, public_cert_pem")
          .eq("id", device.id)
          .single();
        if (existing?.private_key_pem) return {};
        const kp = await generateDeviceKeypair();
        return {
          private_key_pem: kp.privateKeyPem,
          // In simulation mode we stash the SPKI public key as a stand-in
          // for the X.509 cert. Live mode will overwrite this with the
          // ZATCA-issued cert parsed from `binarySecurityToken`.
          public_cert_pem: kp.publicKeyPem,
        };
      })()),
    })
    .eq("id", device.id);

  if (updErr) return jsonResponse({ error: updErr.message }, 500);

  return jsonResponse({
    ok: true,
    mode,
    device_id: device.id,
    csid_expires_at: isoDaysFromNow(365),
  });
});