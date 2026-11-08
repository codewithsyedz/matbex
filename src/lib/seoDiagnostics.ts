/**
 * Client-side SEO diagnostics.
 *
 * Everything here reads the *live* document head of the running app and
 * probes the static assets Google fetches (favicon, manifest, robots,
 * sitemap). It is intentionally dependency-free so the diagnostics page
 * reflects exactly what a crawler would see for the current origin.
 */

export type CheckStatus = "pass" | "warn" | "fail";

export interface SeoCheck {
  id: string;
  label: string;
  status: CheckStatus;
  value?: string | null;
  detail: string;
}

export interface AssetProbe {
  url: string;
  ok: boolean;
  httpStatus: number | null;
  contentType: string | null;
  bytes: number | null;
  error?: string;
}

export interface HeadTag {
  kind: "meta" | "link" | "title" | "jsonld";
  key: string;
  value: string;
}

export interface SeoDiagnosticsReport {
  origin: string;
  scannedAt: string;
  checks: SeoCheck[];
  headTags: HeadTag[];
  iconProbes: AssetProbe[];
  manifest: {
    href: string | null;
    probe: AssetProbe | null;
    parsed: Record<string, unknown> | null;
    icons: { src: string; sizes?: string; type?: string; purpose?: string }[];
    parseError?: string;
  };
  robots: AssetProbe & { body?: string; disallowsAll?: boolean; sitemapLines?: string[] };
  sitemap: AssetProbe & { body?: string; urlCount?: number };
}

const TITLE_MAX = 60;
const DESC_MIN = 70;
const DESC_MAX = 160;

function metaContent(selector: string): string | null {
  const el = document.head.querySelector<HTMLMetaElement>(selector);
  return el?.content?.trim() || null;
}

async function probe(url: string): Promise<AssetProbe> {
  try {
    // GET (not HEAD) — static hosts frequently 405 a HEAD, and we need the
    // body length to detect zero-byte placeholder assets.
    const res = await fetch(url, { cache: "no-store" });
    const buf = await res.arrayBuffer();
    return {
      url,
      ok: res.ok && buf.byteLength > 0,
      httpStatus: res.status,
      contentType: res.headers.get("content-type"),
      bytes: buf.byteLength,
    };
  } catch (e) {
    return {
      url,
      ok: false,
      httpStatus: null,
      contentType: null,
      bytes: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function probeText(url: string): Promise<AssetProbe & { body?: string }> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const body = await res.text();
    return {
      url,
      ok: res.ok && body.trim().length > 0,
      httpStatus: res.status,
      contentType: res.headers.get("content-type"),
      bytes: body.length,
      body,
    };
  } catch (e) {
    return {
      url,
      ok: false,
      httpStatus: null,
      contentType: null,
      bytes: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function collectHeadTags(): HeadTag[] {
  const tags: HeadTag[] = [];
  const title = document.title?.trim();
  if (title) tags.push({ kind: "title", key: "title", value: title });

  document.head.querySelectorAll("meta").forEach((m) => {
    const key = m.getAttribute("name") ?? m.getAttribute("property") ?? m.getAttribute("http-equiv");
    if (!key) return;
    tags.push({ kind: "meta", key, value: m.getAttribute("content") ?? "" });
  });

  document.head.querySelectorAll("link").forEach((l) => {
    const rel = l.getAttribute("rel");
    if (!rel) return;
    const sizes = l.getAttribute("sizes");
    tags.push({
      kind: "link",
      key: sizes ? `${rel} (${sizes})` : rel,
      value: l.getAttribute("href") ?? "",
    });
  });

  document.head.querySelectorAll('script[type="application/ld+json"]').forEach((s, i) => {
    let key = `ld+json #${i + 1}`;
    try {
      const parsed = JSON.parse(s.textContent ?? "{}");
      const type = Array.isArray(parsed) ? parsed.map((p) => p["@type"]).join(", ") : parsed["@type"];
      if (type) key = `ld+json (${type})`;
    } catch {
      key = `ld+json #${i + 1} — invalid JSON`;
    }
    tags.push({ kind: "jsonld", key, value: (s.textContent ?? "").trim().slice(0, 400) });
  });

  return tags;
}

export async function runSeoDiagnostics(): Promise<SeoDiagnosticsReport> {
  const origin = window.location.origin;
  const checks: SeoCheck[] = [];
  const push = (c: SeoCheck) => checks.push(c);

  /* ---------------------------------------------------------- head tags */
  const title = document.title?.trim() ?? "";
  push({
    id: "title",
    label: "Title tag",
    value: title || null,
    status: !title || /lovable app/i.test(title) ? "fail" : title.length > TITLE_MAX ? "warn" : "pass",
    detail: !title
      ? "No <title> found — Google will invent one from page content."
      : /lovable app/i.test(title)
        ? "Still the template default. Replace it with a real product title."
        : `${title.length} characters (recommended ≤ ${TITLE_MAX}).`,
  });

  const description = metaContent('meta[name="description"]');
  push({
    id: "description",
    label: "Meta description",
    value: description,
    status: !description || /lovable generated project/i.test(description)
      ? "fail"
      : description.length > DESC_MAX || description.length < DESC_MIN
        ? "warn"
        : "pass",
    detail: !description
      ? "Missing — Google will pick an arbitrary snippet."
      : /lovable generated project/i.test(description)
        ? "Still the template default."
        : `${description.length} characters (recommended ${DESC_MIN}–${DESC_MAX}).`,
  });

  const robotsMeta = metaContent('meta[name="robots"]');
  push({
    id: "robots-meta",
    label: "Robots meta",
    value: robotsMeta,
    status: robotsMeta && /noindex/i.test(robotsMeta) ? "fail" : "pass",
    detail: robotsMeta
      ? /noindex/i.test(robotsMeta)
        ? "noindex is set — this page will be dropped from the index."
        : "Indexing is allowed."
      : "No robots meta — defaults to index, follow.",
  });

  const canonicalEl = document.head.querySelectorAll('link[rel="canonical"]');
  const canonical = canonicalEl[0]?.getAttribute("href") ?? null;
  push({
    id: "canonical",
    label: "Canonical URL",
    value: canonical,
    status: !canonical ? "warn" : canonicalEl.length > 1 ? "fail" : "pass",
    detail: !canonical
      ? "No canonical link on this route."
      : canonicalEl.length > 1
        ? `${canonicalEl.length} canonical tags found — crawlers ignore conflicting canonicals.`
        : "Single self-referencing canonical.",
  });

  const ogTitle = metaContent('meta[property="og:title"]');
  const ogDesc = metaContent('meta[property="og:description"]');
  const ogImage = metaContent('meta[property="og:image"]');
  const ogUrl = metaContent('meta[property="og:url"]');
  const missingOg = [
    !ogTitle && "og:title",
    !ogDesc && "og:description",
    !ogImage && "og:image",
    !ogUrl && "og:url",
  ].filter(Boolean) as string[];
  push({
    id: "open-graph",
    label: "Open Graph tags",
    value: ogTitle,
    status: missingOg.length === 0 ? "pass" : missingOg.length >= 3 ? "fail" : "warn",
    detail: missingOg.length ? `Missing: ${missingOg.join(", ")}.` : "Title, description, image and URL are all set.",
  });

  const twitterCard = metaContent('meta[name="twitter:card"]');
  push({
    id: "twitter",
    label: "Twitter card",
    value: twitterCard,
    status: twitterCard ? "pass" : "warn",
    detail: twitterCard ? "Card type declared." : "No twitter:card — X falls back to a small preview.",
  });

  const jsonLd = document.head.querySelectorAll('script[type="application/ld+json"]');
  let jsonLdInvalid = 0;
  jsonLd.forEach((s) => {
    try {
      JSON.parse(s.textContent ?? "");
    } catch {
      jsonLdInvalid += 1;
    }
  });
  push({
    id: "jsonld",
    label: "Structured data (JSON-LD)",
    value: `${jsonLd.length} block(s)`,
    status: jsonLd.length === 0 ? "warn" : jsonLdInvalid > 0 ? "fail" : "pass",
    detail: jsonLd.length === 0
      ? "No JSON-LD found — rich results need structured data."
      : jsonLdInvalid > 0
        ? `${jsonLdInvalid} block(s) contain invalid JSON and will be ignored.`
        : "All blocks parse as valid JSON.",
  });

  const lang = document.documentElement.getAttribute("lang");
  push({
    id: "lang",
    label: "html lang attribute",
    value: lang,
    status: lang ? "pass" : "warn",
    detail: lang ? `Declared as "${lang}".` : "Missing — set a language for accessibility and localisation signals.",
  });

  const viewport = metaContent('meta[name="viewport"]');
  push({
    id: "viewport",
    label: "Responsive viewport",
    value: viewport,
    status: viewport ? "pass" : "fail",
    detail: viewport ? "Viewport meta present." : "Missing — mobile usability will fail.",
  });

  /* ------------------------------------------------------------ favicons */
  const iconLinks = Array.from(
    document.head.querySelectorAll<HTMLLinkElement>(
      'link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]',
    ),
  );
  const iconUrls = Array.from(
    new Set([
      `${origin}/favicon.ico`, // the exact file Google fetches for the SERP icon
      ...iconLinks.map((l) => new URL(l.getAttribute("href") ?? "", origin).toString()),
    ]),
  );
  const iconProbes = await Promise.all(iconUrls.map(probe));
  const rootIcon = iconProbes.find((p) => p.url.split("?")[0].endsWith("/favicon.ico"));
  const brokenIcons = iconProbes.filter((p) => !p.ok);
  push({
    id: "favicon-root",
    label: "/favicon.ico (Google SERP icon)",
    value: rootIcon ? `HTTP ${rootIcon.httpStatus ?? "—"} · ${rootIcon.bytes ?? 0} bytes` : null,
    status: rootIcon?.ok ? "pass" : "fail",
    detail: rootIcon?.ok
      ? "Served correctly. Google caches it and may take weeks to refresh."
      : "Google fetches /favicon.ico at the site root — it must return a real icon file.",
  });
  push({
    id: "favicon-links",
    label: "Declared favicon links",
    value: `${iconLinks.length} link tag(s)`,
    status: iconLinks.length === 0 ? "fail" : brokenIcons.length ? "fail" : "pass",
    detail: iconLinks.length === 0
      ? "No icon <link> tags in the head."
      : brokenIcons.length
        ? `${brokenIcons.length} declared icon(s) are unreachable or empty.`
        : "Every declared icon resolves to a real file.",
  });

  /* ------------------------------------------------------------ manifest */
  const manifestHref = document.head.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.getAttribute("href") ?? null;
  const manifestUrl = manifestHref ? new URL(manifestHref, origin).toString() : null;
  const manifestProbe = manifestUrl ? await probeText(manifestUrl) : null;
  let parsed: Record<string, unknown> | null = null;
  let parseError: string | undefined;
  if (manifestProbe?.body) {
    try {
      parsed = JSON.parse(manifestProbe.body);
    } catch (e) {
      parseError = e instanceof Error ? e.message : String(e);
    }
  }
  const manifestIcons = Array.isArray(parsed?.icons)
    ? (parsed!.icons as { src: string; sizes?: string; type?: string; purpose?: string }[])
    : [];
  push({
    id: "manifest",
    label: "Web app manifest",
    value: manifestUrl,
    status: !manifestUrl || !manifestProbe?.ok ? "fail" : parseError ? "fail" : manifestIcons.length ? "pass" : "warn",
    detail: !manifestUrl
      ? "No <link rel=\"manifest\"> in the head."
      : !manifestProbe?.ok
        ? `Manifest returned HTTP ${manifestProbe?.httpStatus ?? "error"}.`
        : parseError
          ? `Manifest is not valid JSON: ${parseError}`
          : manifestIcons.length
            ? `Valid JSON with ${manifestIcons.length} icon entr${manifestIcons.length === 1 ? "y" : "ies"}.`
            : "Valid JSON but no icons declared — install prompts will have no icon.",
  });
  const maskable = manifestIcons.some((i) => (i.purpose ?? "").includes("maskable"));
  push({
    id: "manifest-maskable",
    label: "Maskable icon",
    value: maskable ? "present" : null,
    status: !manifestIcons.length ? "warn" : maskable ? "pass" : "warn",
    detail: maskable
      ? "A maskable icon is declared for adaptive Android launchers."
      : "No icon with purpose \"maskable\" — Android may letterbox the icon.",
  });

  /* -------------------------------------------------------------- robots */
  const robotsRaw = await probeText(`${origin}/robots.txt`);
  const robotsBody = robotsRaw.body ?? "";
  const disallowsAll = /^\s*disallow:\s*\/\s*$/im.test(robotsBody);
  const sitemapLines = robotsBody
    .split("\n")
    .filter((l) => /^\s*sitemap:/i.test(l))
    .map((l) => l.trim());
  push({
    id: "robots-txt",
    label: "robots.txt",
    value: robotsRaw.ok ? `HTTP ${robotsRaw.httpStatus}` : null,
    status: !robotsRaw.ok ? "fail" : disallowsAll ? "fail" : sitemapLines.length ? "pass" : "warn",
    detail: !robotsRaw.ok
      ? "robots.txt is missing or empty."
      : disallowsAll
        ? "Contains a site-wide Disallow: / — crawlers are blocked."
        : sitemapLines.length
          ? `Crawlable, and advertises ${sitemapLines.length} sitemap${sitemapLines.length === 1 ? "" : "s"}.`
          : "Crawlable, but no Sitemap: directive.",
  });

  /* ------------------------------------------------------------- sitemap */
  const sitemapRaw = await probeText(`${origin}/sitemap.xml`);
  const urlCount = (sitemapRaw.body?.match(/<loc>/g) ?? []).length;
  push({
    id: "sitemap",
    label: "sitemap.xml",
    value: sitemapRaw.ok ? `${urlCount} URL(s)` : null,
    status: !sitemapRaw.ok ? "fail" : urlCount === 0 ? "warn" : "pass",
    detail: !sitemapRaw.ok
      ? "sitemap.xml is missing or unreachable."
      : urlCount === 0
        ? "Sitemap loads but lists no <loc> entries."
        : `Lists ${urlCount} URL${urlCount === 1 ? "" : "s"} for discovery.`,
  });

  return {
    origin,
    scannedAt: new Date().toISOString(),
    checks,
    headTags: collectHeadTags(),
    iconProbes,
    manifest: { href: manifestUrl, probe: manifestProbe, parsed, icons: manifestIcons, parseError },
    robots: { ...robotsRaw, disallowsAll, sitemapLines },
    sitemap: { ...sitemapRaw, urlCount },
  };
}

export function summarise(checks: SeoCheck[]) {
  return {
    pass: checks.filter((c) => c.status === "pass").length,
    warn: checks.filter((c) => c.status === "warn").length,
    fail: checks.filter((c) => c.status === "fail").length,
  };
}

export function reportToCsv(report: SeoDiagnosticsReport): string {
  const rows = [
    ["Check", "Status", "Value", "Detail"],
    ...report.checks.map((c) => [c.label, c.status, c.value ?? "", c.detail]),
  ];
  return rows
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}
