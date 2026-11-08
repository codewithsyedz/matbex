/**
 * Remembers which ad or link first brought a visitor to the site, so that a
 * later sign-up or demo booking can be credited to it. Stored in this browser
 * only (first-party), kept 90 days. Contains no personal data.
 */
const KEY = "matbex_lead_attribution_v1";
const TTL_MS = 90 * 24 * 60 * 60 * 1000;

export interface LeadAttribution {
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
  landing_path?: string | null;
  referrer?: string | null;
  first_seen_at?: string;
}

const clip = (v: string | null, n = 150) => (v ? v.slice(0, n) : null);

function read(): LeadAttribution | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LeadAttribution;
    if (parsed.first_seen_at && Date.now() - Date.parse(parsed.first_seen_at) > TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Call once per page load. A new ad click (utm/gclid/fbclid) replaces the stored source. */
export function captureAttribution(loc: Location = window.location) {
  try {
    const p = new URLSearchParams(loc.search);
    const fromAd = ["utm_source", "utm_campaign", "gclid", "fbclid"].some((k) => p.get(k));
    const existing = read();
    if (existing && !fromAd) return;
    let referrer: string | null = null;
    try {
      const r = document.referrer ? new URL(document.referrer) : null;
      if (r && r.host !== loc.host) referrer = r.host;
    } catch { /* ignore */ }
    const next: LeadAttribution = {
      utm_source: clip(p.get("utm_source")),
      utm_medium: clip(p.get("utm_medium")),
      utm_campaign: clip(p.get("utm_campaign")),
      utm_content: clip(p.get("utm_content")),
      utm_term: clip(p.get("utm_term")),
      gclid: clip(p.get("gclid"), 300),
      fbclid: clip(p.get("fbclid"), 300),
      landing_path: clip(loc.pathname, 200),
      referrer,
      first_seen_at: new Date().toISOString(),
    };
    localStorage.setItem(KEY, JSON.stringify(next));
    // Keep click IDs out of the visible URL once stored.
    if (p.get("gclid") || p.get("fbclid")) {
      p.delete("gclid");
      p.delete("fbclid");
      const qs = p.toString();
      window.history.replaceState(window.history.state, "", loc.pathname + (qs ? `?${qs}` : "") + loc.hash);
    }
  } catch { /* storage blocked */ }
}

export function getAttribution(): LeadAttribution {
  return read() ?? {};
}

/** Human label for a lead's source, used in the admin report. */
export function sourceLabel(a: Pick<LeadAttribution, "utm_source" | "gclid" | "fbclid" | "referrer">): string {
  if (a.gclid) return "Google Ads";
  if (a.fbclid) return a.utm_source ? `Facebook/Instagram (${a.utm_source})` : "Facebook/Instagram";
  if (a.utm_source) return a.utm_source;
  if (a.referrer) return a.referrer;
  return "Direct / unknown";
}
