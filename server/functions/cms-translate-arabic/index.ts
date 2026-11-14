import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
// Bulk-translates CMS page + block content from English to Arabic using
// Claude (Anthropic API) and writes results into the `translations.ar`
// JSONB column on each row. Idempotent: pass `force=true` to overwrite
// existing Arabic translations.
//
// Auth: requires the caller's JWT and an `app_admin` role (checked via
// the has_role security-definer function).
import { createClient } from "@matbex/client";
import { buildCorsHeaders, corsPreflight } from "../_shared/cors.ts";
import { completeText } from "../_runtime/ai.ts";

const API_URL = env("API_URL")!;
const ANON_KEY = env("ANON_KEY")!;
const SERVICE_ROLE = env("SERVICE_ROLE_KEY")!;

// Fields we ever try to translate. Anything else (icon names, URLs,
// hex colors, ids, sort order, etc.) is left untouched.
const TRANSLATABLE_KEYS = new Set([
  "title", "subtitle", "headline", "subheadline", "body", "content",
  "description", "eyebrow", "badge", "tagline", "label", "name",
  "quote", "author", "role", "answer", "question", "buttonText",
  "primaryCtaText", "secondaryCtaText", "searchPlaceholder",
  "screenshotCaption", "caption", "summary", "excerpt",
  "meta_title", "meta_description",
]);

function pickTranslatable(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) {
    const arr = value.map(pickTranslatable).filter((v) => v !== undefined);
    return arr.length ? arr : undefined;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (TRANSLATABLE_KEYS.has(k) && typeof v === "string" && v.trim()) {
        out[k] = v;
      } else if (typeof v === "object" && v !== null) {
        const sub = pickTranslatable(v);
        if (sub !== undefined) out[k] = sub;
      }
    }
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
}

async function translateJSON(payload: unknown): Promise<unknown> {
  const prompt = `You are a professional Arabic localizer for a Saudi restaurant management SaaS called Matbex. Translate every string value in the JSON below from English to natural, professional Modern Standard Arabic suitable for restaurant owners and managers in KSA. Keep the JSON shape, keys, and structure identical. Do NOT translate keys. Do NOT translate URLs, brand names ("Matbex", "ZATCA"), icon names, or hex colors. Preserve markdown formatting (headings, bold, links, lists). Return ONLY the translated JSON, no commentary.\n\nJSON:\n${JSON.stringify(payload)}`;

  let content: string;
  try {
    content = await completeText({
      system: "You are a precise JSON-in/JSON-out Arabic translator. Reply with JSON only.",
      prompt,
      maxTokens: 8192,
    });
  } catch (e) {
    if ((e as { status?: number }).status === 429) throw new Error("RATE_LIMITED");
    throw e;
  }
  try {
    return JSON.parse(content);
  } catch {
    // Strip ```json fences if the model added them.
    const cleaned = content.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    return JSON.parse(cleaned);
  }
}

serve(async (req) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;
  const cors = buildCorsHeaders(req);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(API_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const admin = createClient(API_URL, SERVICE_ROLE);
    const { data: isSuperAdmin } = await admin.rpc("has_role", {
      _user_id: userRes.user.id, _role: "superadmin",
    });
    const { data: isOwner } = await admin.rpc("has_role", {
      _user_id: userRes.user.id, _role: "owner",
    });
    if (!isSuperAdmin && !isOwner) {
      return new Response(JSON.stringify({ error: "Forbidden — admins only" }), {
        status: 403, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const force = body.force === true;
    const slugFilter: string | undefined = body.slug;

    // 1. Pages.
    let pageQuery = admin.from("cms_pages").select("id, slug, title, meta_title, meta_description, translations");
    if (slugFilter) pageQuery = pageQuery.eq("slug", slugFilter);
    const { data: pages, error: pagesErr } = await pageQuery;
    if (pagesErr) throw pagesErr;

    const summary: Record<string, any> = { pages: 0, blocks: 0, skipped: 0, errors: [] };

    for (const p of pages ?? []) {
      const tr = (p.translations as any) ?? {};
      if (!force && tr.ar) { summary.skipped++; continue; }
      const src = pickTranslatable({
        title: p.title, meta_title: p.meta_title, meta_description: p.meta_description,
      });
      if (!src) continue;
      try {
        const arOverride = await translateJSON(src);
        await admin
          .from("cms_pages")
          .update({ translations: { ...tr, ar: arOverride } })
          .eq("id", p.id);
        summary.pages++;
      } catch (e: any) {
        summary.errors.push({ page: p.slug, error: e.message });
        if (e.message === "RATE_LIMITED" || e.message === "AI_CREDITS_EXHAUSTED") {
          return new Response(JSON.stringify({ error: e.message, summary }), {
            status: e.message === "RATE_LIMITED" ? 429 : 402,
            headers: { ...cors, "Content-Type": "application/json" },
          });
        }
      }
    }

    // 2. Blocks.
    const pageIds = (pages ?? []).map((p) => p.id);
    let blockQuery = admin
      .from("cms_page_blocks")
      .select("id, page_id, block_type, config, translations");
    if (slugFilter && pageIds.length) blockQuery = blockQuery.in("page_id", pageIds);
    const { data: blocks, error: blocksErr } = await blockQuery;
    if (blocksErr) throw blocksErr;

    for (const b of blocks ?? []) {
      const tr = (b.translations as any) ?? {};
      if (!force && tr.ar) { summary.skipped++; continue; }
      const src = pickTranslatable(b.config);
      if (!src) continue;
      try {
        const arOverride = await translateJSON(src);
        await admin
          .from("cms_page_blocks")
          .update({ translations: { ...tr, ar: arOverride } })
          .eq("id", b.id);
        summary.blocks++;
      } catch (e: any) {
        summary.errors.push({ block: b.id, error: e.message });
        if (e.message === "RATE_LIMITED" || e.message === "AI_CREDITS_EXHAUSTED") {
          return new Response(JSON.stringify({ error: e.message, summary }), {
            status: e.message === "RATE_LIMITED" ? 429 : 402,
            headers: { ...cors, "Content-Type": "application/json" },
          });
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, summary }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[cms-translate-arabic]", e);
    return new Response(JSON.stringify({ error: e.message ?? "Unknown error" }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});