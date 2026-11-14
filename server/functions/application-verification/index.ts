import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
import { createClient } from "@matbex/client";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUCKET = "application-docs";
const ALLOWED_TYPES = [
  "commercial_registration",
  "tax_registration",
  "bank_iban",
  "brand_logo",
  "cover_photo",
  "dine_in_menu",
  "opening_hours",
] as const;
type DocType = typeof ALLOWED_TYPES[number];

const TYPE_TO_URL_COLUMN: Partial<Record<DocType, string>> = {
  commercial_registration: "cr_document_url",
  tax_registration: "vat_document_url",
  bank_iban: "iban_document_url",
  brand_logo: "brand_logo_url",
  cover_photo: "cover_photo_url",
  dine_in_menu: "dine_in_menu_url",
};

const db = createClient(
  env("API_URL")!,
  env("SERVICE_ROLE_KEY")!,
);

const SIGNED_URL_TTL = 60 * 60; // 1 hour — refreshed on every list call

async function signOne(pathOrUrl: string): Promise<string> {
  if (!pathOrUrl) return "";
  // Legacy rows may have stored full public URLs; extract object path.
  let path = pathOrUrl;
  const marker = `/object/public/${BUCKET}/`;
  const idx = path.indexOf(marker);
  if (idx >= 0) path = path.slice(idx + marker.length);
  const signedMarker = `/object/sign/${BUCKET}/`;
  const sidx = path.indexOf(signedMarker);
  if (sidx >= 0) path = path.slice(sidx + signedMarker.length).split("?")[0];
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  if (error || !data?.signedUrl) return "";
  return data.signedUrl;
}

async function assertSuperadminFromAuthHeader(req: Request): Promise<string> {
  const header = req.headers.get("authorization") ?? "";
  const jwt = header.toLowerCase().startsWith("bearer ") ? header.slice(7) : "";
  if (!jwt) throw new Error("Missing auth token");
  const { data: userRes, error } = await db.auth.getUser(jwt);
  if (error || !userRes?.user) throw new Error("Invalid auth token");
  const uid = userRes.user.id;
  const { data: ok } = await db.rpc("is_superadmin", { _user_id: uid });
  if (!ok) throw new Error("Forbidden");
  return uid;
}

async function verifyApplicant(applicationId: string, email: string) {
  const { data, error } = await db
    .from("tenant_applications")
    .select("id, email, status, verification_stage, opening_hours")
    .eq("id", applicationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Application not found");
  if (data.email.toLowerCase() !== email.toLowerCase()) {
    throw new Error("Email does not match application");
  }
  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? "list";

    if (action === "list") {
      const { applicationId, email } = await req.json();
      if (!applicationId || !email) throw new Error("applicationId and email required");
      const app = await verifyApplicant(applicationId, email);
      const { data: docs, error } = await db
        .from("application_documents")
        .select("*")
        .eq("application_id", applicationId)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      const signed = await Promise.all(
        (docs ?? []).map(async (d: any) => ({ ...d, file_url: await signOne(d.file_path) })),
      );
      return new Response(JSON.stringify({ application: app, documents: signed }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "upload") {
      const form = await req.formData();
      const applicationId = String(form.get("applicationId") ?? "");
      const email = String(form.get("email") ?? "");
      const docType = String(form.get("docType") ?? "") as DocType;
      const file = form.get("file") as File | null;
      if (!applicationId || !email || !docType || !file) {
        throw new Error("applicationId, email, docType, and file are required");
      }
      if (!ALLOWED_TYPES.includes(docType)) throw new Error("Invalid doc type");
      await verifyApplicant(applicationId, email);

      const ext = file.name.split(".").pop() ?? "bin";
      const path = `${applicationId}/${docType}/${Date.now()}.${ext}`;
      const bytes = new Uint8Array(await file.arrayBuffer());

      const { error: upErr } = await db.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: file.type, upsert: true });
      if (upErr) throw new Error(upErr.message);

      const signedUrl = await signOne(path);

      // Delete any existing doc of this type and old file
      const { data: existing } = await db
        .from("application_documents")
        .select("id, file_path")
        .eq("application_id", applicationId)
        .eq("doc_type", docType)
        .maybeSingle();
      if (existing) {
        await db.storage.from(BUCKET).remove([existing.file_path]);
        await db.from("application_documents").delete().eq("id", existing.id);
      }

      const { data: row, error: insErr } = await db
        .from("application_documents")
        .insert({
          application_id: applicationId,
          doc_type: docType,
          file_url: signedUrl,
          file_path: path,
          file_name: file.name,
          size_bytes: file.size,
          mime_type: file.type,
          status: "pending",
        })
        .select()
        .single();
      if (insErr) throw new Error(insErr.message);

      // Mirror path (not URL) to tenant_applications convenience columns so the
      // admin queue can re-sign on demand without leaking long-lived URLs.
      const col = TYPE_TO_URL_COLUMN[docType];
      if (col) {
        await db
          .from("tenant_applications")
          .update({ [col]: path })
          .eq("id", applicationId);
      }

      return new Response(JSON.stringify({ document: row }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "delete") {
      const { applicationId, email, docType } = await req.json();
      if (!applicationId || !email || !docType) throw new Error("Missing fields");
      await verifyApplicant(applicationId, email);
      const { data: existing } = await db
        .from("application_documents")
        .select("id, file_path, status")
        .eq("application_id", applicationId)
        .eq("doc_type", docType)
        .maybeSingle();
      if (!existing) return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (existing.status === "approved") throw new Error("Approved documents cannot be deleted");
      await db.storage.from(BUCKET).remove([existing.file_path]);
      await db.from("application_documents").delete().eq("id", existing.id);
      const col = TYPE_TO_URL_COLUMN[docType as DocType];
      if (col) {
        await db.from("tenant_applications").update({ [col]: null }).eq("id", applicationId);
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "save-hours") {
      const { applicationId, email, openingHours } = await req.json();
      if (!applicationId || !email || !openingHours) throw new Error("Missing fields");
      await verifyApplicant(applicationId, email);
      // Persist on tenant_applications, and as a "document" row of type opening_hours
      const { error: appErr } = await db
        .from("tenant_applications")
        .update({ opening_hours: openingHours })
        .eq("id", applicationId);
      if (appErr) throw new Error(appErr.message);
      const { error: upErr } = await db
        .from("application_documents")
        .upsert(
          {
            application_id: applicationId,
            doc_type: "opening_hours",
            file_url: "",
            file_path: "",
            file_name: "opening_hours.json",
            mime_type: "application/json",
            status: "pending",
          },
          { onConflict: "application_id,doc_type" },
        );
      if (upErr) throw new Error(upErr.message);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "submit") {
      const { applicationId, email } = await req.json();
      if (!applicationId || !email) throw new Error("Missing fields");
      await verifyApplicant(applicationId, email);
      const { data: docs } = await db
        .from("application_documents")
        .select("doc_type")
        .eq("application_id", applicationId);
      const have = new Set((docs ?? []).map((d) => d.doc_type));
      const missing = ALLOWED_TYPES.filter((t) => !have.has(t));
      if (missing.length) {
        return new Response(JSON.stringify({ error: "missing_documents", missing }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      await db
        .from("tenant_applications")
        .update({ status: "pending_approval", verification_stage: "under_review" })
        .eq("id", applicationId);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // -----------------------------------------------------------------
    // Admin-only: fresh signed URLs for a single application's docs.
    // Used by the SuperAdmin queue (private bucket has no public URLs).
    // -----------------------------------------------------------------
    if (action === "admin-list") {
      await assertSuperadminFromAuthHeader(req);
      const { applicationId } = await req.json();
      if (!applicationId) throw new Error("applicationId required");
      const [{ data: app }, { data: docs }] = await Promise.all([
        db
          .from("tenant_applications")
          .select("*")
          .eq("id", applicationId)
          .maybeSingle(),
        db
          .from("application_documents")
          .select("*")
          .eq("application_id", applicationId)
          .order("created_at", { ascending: true }),
      ]);
      const signedDocs = await Promise.all(
        (docs ?? []).map(async (d: any) => ({ ...d, file_url: await signOne(d.file_path) })),
      );
      const mirrorCols = ["cr_document_url", "vat_document_url", "iban_document_url"] as const;
      const mirrorUrls: Record<string, string> = {};
      if (app) {
        for (const col of mirrorCols) {
          const v = (app as any)[col];
          if (v) mirrorUrls[col] = await signOne(v);
        }
      }
      return new Response(
        JSON.stringify({ application: app, documents: signedDocs, mirrorUrls }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    throw new Error("Unknown action");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});