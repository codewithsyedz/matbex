import { serve } from "../_runtime/serve.ts";
// Read a photographed / scanned supplier invoice with Claude and return a draft for the invoice
// form (supplier, number, dates, lines matched to stock items, VAT, totals, warnings).
//
// POST { restaurant_id, image_path }   image_path: "invoice-images/<restaurant_id>/..." as stored by
//                                       the invoice image uploader
// The caller must belong to the restaurant (checked through RLS) and the file must be that
// restaurant's. Nothing is saved to the invoice here: the person reviews the draft and saves it
// through the usual form (stock received, invoice owed). Every scan is logged in invoice_scans.

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/payments/settle.ts";
import { CLAUDE_MODEL, claudeClient } from "../_runtime/ai.ts";
import {
  INVOICE_JSON_SCHEMA, InvoiceExtraction, SYSTEM_PROMPT, buildUserText, checkExtraction,
  type CatalogItem, type CatalogSupplier,
} from "../_shared/ai/invoiceScan.ts";

const Body = z.object({ restaurant_id: z.string().uuid(), image_path: z.string().min(1).max(500) });
const DAILY_SCANS_PER_RESTAURANT = 200;
const MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES: Record<string, "image/jpeg" | "image/png" | "image/webp" | "image/gif"> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
};

serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  let auth;
  try {
    auth = await requireUser(req);
  } catch (r) {
    if (r instanceof Response) return json(await r.json().catch(() => ({ error: "Unauthorized" })), r.status);
    throw r;
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid request" }, 400);
  const { restaurant_id } = parsed.data;

  // The caller's own view (RLS) must include the restaurant.
  const { data: mine } = await auth.db.from("restaurants").select("id").eq("id", restaurant_id).maybeSingle();
  if (!mine) return json({ error: "Not your restaurant" }, 403);

  // Only this restaurant's uploads (the uploader stores <restaurant_id>/<file>).
  const path = parsed.data.image_path.replace(/^invoice-images\//, "");
  if (!path.startsWith(`${restaurant_id}/`) || path.includes("..")) return json({ error: "This file does not belong to the restaurant" }, 403);
  const ext = (path.split(".").pop() ?? "").toLowerCase();
  if (!IMAGE_TYPES[ext] && ext !== "pdf") return json({ error: "Use a photo (JPG, PNG, WebP) or a PDF" }, 400);

  const db = serviceClient();
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await db.from("invoice_scans").select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurant_id).gte("created_at", since);
  if ((count ?? 0) >= DAILY_SCANS_PER_RESTAURANT) return json({ error: "Daily scan limit reached; try again tomorrow" }, 429);

  const { data: file, error: dlErr } = await db.storage.from("invoice-images").download(path);
  if (dlErr || !file) return json({ error: "The invoice image could not be read" }, 404);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) return json({ error: "The file is too large (10 MB at most)" }, 400);
  const data = Buffer.from(bytes).toString("base64");

  const [{ data: itemRows }, { data: supplierRows }] = await Promise.all([
    db.from("inventory_items").select("id, name, unit").eq("restaurant_id", restaurant_id).neq("is_active", false).order("name").limit(600),
    db.from("suppliers").select("id, name, vat_number").eq("restaurant_id", restaurant_id).neq("is_active", false).order("name").limit(300),
  ]);
  const items = (itemRows ?? []) as CatalogItem[];
  const suppliers = (supplierRows ?? []) as CatalogSupplier[];

  const source: Anthropic.Beta.BetaContentBlockParam = ext === "pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
    : { type: "image", source: { type: "base64", media_type: IMAGE_TYPES[ext], data } };

  const log = (row: Record<string, unknown>) =>
    db.from("invoice_scans").insert({ restaurant_id, image_path: path, model: CLAUDE_MODEL, created_by: auth.userId, ...row });

  try {
    const response = await claudeClient().beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      // A declined request is retried on the server-chosen fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM_PROMPT,
      output_config: { format: { type: "json_schema", schema: INVOICE_JSON_SCHEMA as unknown as Record<string, unknown> } },
      messages: [{ role: "user", content: [source, { type: "text", text: buildUserText(items, suppliers) }] }],
    });
    const usage = { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens };

    if (response.stop_reason === "refusal") {
      await log({ status: "failed", error: "refusal", ...usage });
      return json({ error: "The AI could not read this file. Enter the invoice by hand." }, 422);
    }
    if (response.stop_reason === "max_tokens") {
      await log({ status: "failed", error: "max_tokens", ...usage });
      return json({ error: "The invoice is too long to read at once. Enter it by hand or split it." }, 422);
    }
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const extracted = InvoiceExtraction.safeParse(JSON.parse(text));
    if (!extracted.success) {
      await log({ status: "failed", error: "invalid output", ...usage });
      return json({ error: "The AI answer could not be used. Try again." }, 502);
    }
    if (!extracted.data.is_invoice) {
      await log({ status: "failed", error: "not an invoice", draft: extracted.data, ...usage });
      return json({ error: "This does not look like a supplier invoice, or it is unreadable. Retake the photo." }, 422);
    }
    const draft = checkExtraction(extracted.data, items, suppliers);
    await log({ status: "ok", draft, ...usage });
    return json({ draft });
  } catch (e) {
    const msg = e instanceof Anthropic.RateLimitError
      ? "The AI service is busy; try again in a minute."
      : e instanceof Anthropic.AuthenticationError
        ? "AI is not set up correctly on this server."
        : e instanceof Anthropic.APIError
          ? `The AI service failed (${e.status}).`
          : e instanceof Error ? e.message : "Scanning failed";
    await log({ status: "failed", error: e instanceof Error ? e.message.slice(0, 500) : String(e) });
    return json({ error: msg }, 424);
  }
});
