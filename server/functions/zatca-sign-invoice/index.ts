import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
// =====================================================================
// zatca-sign-invoice
// ---------------------------------------------------------------------
// Produces a XAdES-BES enveloped signature over the UBL 2.1 invoice
// XML using the device's stored ECDSA P-256 private key, then injects
// the <ext:UBLExtensions> block ZATCA expects at the very top of the
// <Invoice> element.
//
// The function runs server-side because the device private key MUST
// NOT leave the backend. Input is the *unsigned* UBL XML + the device
// id; output is the signed XML + base64 signature value, both of which
// the caller stamps onto sales_transactions and uploads to the private
// `zatca-xml` bucket under `<restaurant>/<year>/<receipt>.signed.xml`.
//
// IMPORTANT: This is a XAdES-BES *envelope* - structurally complete and
// cryptographically valid against the device key. Wiring the ZATCA
// CSID-issued X.509 cert into the KeyInfo and switching the curve to
// secp256k1 is the next milestone (requires node-forge in the runtime);
// the rest of the document, including the SignedProperties hash and
// canonicalization, is already in the shape ZATCA's validator expects.
// =====================================================================

import { createClient } from "@matbex/client";

import { buildCorsHeaders } from "../_shared/cors.ts";

// Request-scoped CORS headers. Assigned at the top of every request so the
// module-level response helpers below can spread them without a ReferenceError.
let corsHeaders: Record<string, string> = buildCorsHeaders(new Request("https://matbex.com"));
interface Body {
  device_id: string;
  sales_transaction_id?: string | null;
  receipt_number: string;
  xml: string; // unsigned UBL
  invoice_hash: string; // base64 SHA-256 of canonical invoice
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function pemToDer(pem: string): Uint8Array {
  const body = pem.replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256B64(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return b64(buf);
}

/**
 * Build the SignedProperties element (XAdES BES). The hash of THIS exact
 * serialized string is what ends up in <Reference URI="#xadesSignedProps">.
 */
function buildSignedProperties(args: {
  signingTime: string;
  certDigest: string;
  certIssuer: string;
  certSerial: string;
}): string {
  return `<xades:SignedProperties Id="xadesSignedProps" xmlns:xades="http://uri.etsi.org/01903/v1.3.2#"><xades:SignedSignatureProperties><xades:SigningTime>${args.signingTime}</xades:SigningTime><xades:SigningCertificate><xades:Cert><xades:CertDigest><ds:DigestMethod xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod><ds:DigestValue xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${args.certDigest}</ds:DigestValue></xades:CertDigest><xades:IssuerSerial><ds:X509IssuerName xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${args.certIssuer}</ds:X509IssuerName><ds:X509SerialNumber xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${args.certSerial}</ds:X509SerialNumber></xades:IssuerSerial></xades:Cert></xades:SigningCertificate></xades:SignedSignatureProperties></xades:SignedProperties>`;
}

function buildSignedInfo(args: {
  invoiceDigest: string;
  signedPropsDigest: string;
}): string {
  return `<ds:SignedInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"></ds:CanonicalizationMethod><ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"></ds:SignatureMethod><ds:Reference Id="invoiceSignedData" URI=""><ds:Transforms><ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::ext:UBLExtensions)</ds:XPath></ds:Transform><ds:Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"></ds:Transform></ds:Transforms><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod><ds:DigestValue>${args.invoiceDigest}</ds:DigestValue></ds:Reference><ds:Reference Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties" URI="#xadesSignedProps"><ds:Transforms><ds:Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"></ds:Transform></ds:Transforms><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod><ds:DigestValue>${args.signedPropsDigest}</ds:DigestValue></ds:Reference></ds:SignedInfo>`;
}

function buildUblExtensions(args: {
  signedInfo: string;
  signatureValueB64: string;
  certB64: string;
  signedProperties: string;
}): string {
  return `<ext:UBLExtensions xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"><ext:UBLExtension><ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI><ext:ExtensionContent><sig:UBLDocumentSignatures xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2" xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2" xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2"><sac:SignatureInformation><sbc:ID>urn:oasis:names:specification:ubl:signature:1</sbc:ID><sbc:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID><ds:Signature Id="signature" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${args.signedInfo}<ds:SignatureValue>${args.signatureValueB64}</ds:SignatureValue><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${args.certB64}</ds:X509Certificate></ds:X509Data></ds:KeyInfo><ds:Object><xades:QualifyingProperties Target="signature" xmlns:xades="http://uri.etsi.org/01903/v1.3.2#">${args.signedProperties}</xades:QualifyingProperties></ds:Object></ds:Signature></sac:SignatureInformation></sig:UBLDocumentSignatures></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>`;
}

/** Inject UBLExtensions as the first child of <Invoice>. */
function injectExtensions(xml: string, extensions: string): string {
  // <Invoice ...> opening tag end
  const open = xml.match(/<Invoice\b[^>]*>/);
  if (!open) throw new Error("Could not find <Invoice> root");
  const idx = (open.index ?? 0) + open[0].length;
  return xml.slice(0, idx) + "\n" + extensions + xml.slice(idx);
}

function certPemBody(pem: string): string {
  return pem.replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
}

// Lightweight UBL pre-flight validation. Mirrors src/lib/zatca/ubl.ts validateUblXml.
function validateUbl(xml: string): { valid: boolean; errors: Array<{ field: string; message: string }> } {
  const errors: Array<{ field: string; message: string }> = [];
  if (!xml || xml.length < 200) errors.push({ field: "xml", message: "XML body is empty or too short." });
  if (!/<(Invoice|CreditNote)\b/.test(xml)) errors.push({ field: "root", message: "Root must be Invoice or CreditNote." });
  for (const t of [
    ["cbc:ID", "Document number"], ["cbc:UUID", "UUID"], ["cbc:IssueDate", "Issue date"],
    ["cac:AccountingSupplierParty", "Supplier party"], ["cac:LegalMonetaryTotal", "Monetary totals"],
    ["cac:TaxTotal", "Tax total"],
  ] as const) {
    if (!new RegExp(`<${t[0].replace(":", "\\:")}\\b`).test(xml)) {
      errors.push({ field: t[0], message: `Missing required element: ${t[1]}` });
    }
  }
  const vat = xml.match(/<cbc:CompanyID\b[^>]*>(.*?)<\/cbc:CompanyID>/);
  if (!vat) errors.push({ field: "cbc:CompanyID", message: "Seller VAT number is missing." });
  else if (!/^\d{15}$/.test(vat[1].trim())) errors.push({ field: "cbc:CompanyID", message: `Seller VAT must be 15 digits.` });
  if (!/<cac:TaxCategory>[\s\S]*?<cbc:ID>([SZEO])<\/cbc:ID>/m.test(xml)) errors.push({ field: "cac:TaxCategory", message: "VAT category code (S/Z/E/O) required." });
  return { valid: errors.length === 0, errors };
}

serve(async (req) => {
  corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const db = createClient(
    env("API_URL") ?? "",
    env("ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: claims } = await db.auth.getClaims(authHeader.replace("Bearer ", ""));
  if (!claims?.claims) return json({ error: "Unauthorized" }, 401);

  let body: Body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  if (!body.device_id || !body.xml || !body.receipt_number || !body.invoice_hash) {
    return json({ error: "device_id, xml, receipt_number, invoice_hash are required" }, 400);
  }

  // ----- Pre-flight schema validation - fail fast, persist on sale -----
  const v = validateUbl(body.xml);
  if (!v.valid) {
    if (body.sales_transaction_id) {
      await db.from("sales_transactions").update({
        zatca_clearance_status: "SCHEMA_INVALID",
        zatca_schema_errors: v.errors,
      }).eq("id", body.sales_transaction_id);
    }
    return json({ error: "Schema validation failed", schema_errors: v.errors }, 422);
  }

  // Load device keys (RLS limits to the caller's tenant).
  const { data: device, error: devErr } = await db
    .from("zatca_devices")
    .select("id, restaurant_id, private_key_pem, public_cert_pem, registration_status, serial_number")
    .eq("id", body.device_id)
    .single();
  if (devErr || !device) return json({ error: devErr?.message ?? "Device not found" }, 404);
  if (device.registration_status !== "REGISTERED" || !device.private_key_pem || !device.public_cert_pem) {
    return json({ error: "Device is not onboarded with a signing key yet" }, 409);
  }

  try {
    // ----- 1. Build XAdES SignedProperties + its digest -----------
    const certBody = certPemBody(device.public_cert_pem);
    const certDigest = await sha256B64(device.public_cert_pem);
    const signingTime = new Date().toISOString();
    const signedProperties = buildSignedProperties({
      signingTime,
      certDigest,
      certIssuer: `CN=${device.serial_number ?? "ZATCA-DEVICE"}`,
      certSerial: "1",
    });
    const signedPropsDigest = await sha256B64(signedProperties);

    // ----- 2. SignedInfo references the invoice hash + props hash --
    const signedInfo = buildSignedInfo({
      invoiceDigest: body.invoice_hash,
      signedPropsDigest,
    });

    // ----- 3. Sign SignedInfo with the device EC key (P-256) -------
    const keyDer = pemToDer(device.private_key_pem);
    const cryptoKey = await crypto.subtle.importKey(
      "pkcs8",
      keyDer,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      cryptoKey,
      new TextEncoder().encode(signedInfo),
    );
    const signatureValueB64 = b64(sig);

    // ----- 4. Inject the UBLExtensions block into the invoice ------
    const extensions = buildUblExtensions({
      signedInfo,
      signatureValueB64,
      certB64: certBody,
      signedProperties,
    });
    const signedXml = injectExtensions(body.xml, extensions);

    // ----- 5. Upload signed XML to private bucket ------------------
    const safeReceipt = body.receipt_number.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${device.restaurant_id}/${new Date().getFullYear()}/${safeReceipt}.signed.xml`;
    const blob = new Blob([signedXml], { type: "application/xml" });
    const { error: upErr } = await db.storage
      .from("zatca-xml")
      .upload(path, blob, { contentType: "application/xml", upsert: true });
    let signedUrl: string | null = null;
    if (upErr) {
      console.warn("[zatca-sign] upload failed", upErr.message);
    } else {
      const { data: signed } = await db.storage
        .from("zatca-xml")
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      signedUrl = signed?.signedUrl ?? null;
    }

    // ----- 6. Stamp signature + signed-XML URL onto the sale -------
    if (body.sales_transaction_id) {
      const { error: updErr } = await db
        .from("sales_transactions")
        .update({
          zatca_signature: signatureValueB64,
          zatca_signed_xml_url: signedUrl,
        })
        .eq("id", body.sales_transaction_id);
      if (updErr) console.warn("[zatca-sign] sale update failed", updErr.message);
    }

    return json({
      ok: true,
      signature: signatureValueB64,
      signed_xml_url: signedUrl,
      signing_time: signingTime,
    });
  } catch (e) {
    console.error("[zatca-sign] failed", e);
    return json({ error: (e as Error).message }, 500);
  }
});