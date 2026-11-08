/**
 * Advertising consent + ad tags (Meta Pixel, Google Ads).
 *
 * - Visitors in regions that require consent (EEA, UK, Switzerland) see a
 *   banner; ad tags stay off until they accept.
 * - Everywhere else ad tags load without a banner. Global Privacy Control
 *   always blocks them.
 * - Tags only load when an ID is configured (VITE_META_PIXEL_ID /
 *   VITE_GOOGLE_ADS_ID). Until the ad accounts are connected nothing loads,
 *   but sign-ups and bookings are still credited to their ad via
 *   leadAttribution (first-party, no third party involved).
 */
declare global {
  interface Window {
    fbq?: ((...args: unknown[]) => void) & {
      callMethod?: (...args: unknown[]) => void;
      queue?: unknown[];
      push?: unknown;
      loaded?: boolean;
      version?: string;
    };
    _fbq?: Window["fbq"];
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export const CONSENT_KEY = "matbex_ad_consent_v1";
export const CONSENT_NOTICE_VERSION = "2026-11-06";
export type ConsentChoice = "granted" | "denied";
export interface StoredConsent { choice: ConsentChoice; at: string; version: string; country: string | null }

const META_PIXEL_ID = import.meta.env.VITE_META_PIXEL_ID as string | undefined;
const GOOGLE_ADS_ID = import.meta.env.VITE_GOOGLE_ADS_ID as string | undefined;

export const CONSENT_COUNTRIES = new Set([
  "AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL",
  "PL","PT","RO","SK","SI","ES","SE","IS","LI","NO","GB","CH",
]);

let countryPromise: Promise<string | null> | null = null;
/** Country from same-origin /cdn-cgi/trace; null when unknown. */
export function detectCountry(): Promise<string | null> {
  if (countryPromise) return countryPromise;
  countryPromise = (async () => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2000);
      const res = await fetch("/cdn-cgi/trace", { signal: ctrl.signal, cache: "no-store" });
      clearTimeout(t);
      if (!res.ok) return null;
      const text = await res.text();
      const get = (k: string) => text.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim() ?? null;
      const host = get("h");
      if (host && host !== window.location.host) return null;
      const loc = get("loc");
      if (!loc || loc === "XX" || loc === "T1") return null;
      return loc.toUpperCase();
    } catch {
      return null;
    }
  })();
  return countryPromise;
}

/** True when the visitor must be asked (consent region or unknown country). */
export const needsBanner = (country: string | null) => country === null || CONSENT_COUNTRIES.has(country);

export function readConsent(): StoredConsent | null {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    return raw ? (JSON.parse(raw) as StoredConsent) : null;
  } catch {
    return null;
  }
}

export function gpcEnabled(): boolean {
  return Boolean((navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl);
}

/** Whether ad tags may run right now. Read fresh before every send. */
export function adsAllowed(country: string | null): boolean {
  if (gpcEnabled()) return false;
  const c = readConsent();
  if (c?.choice === "denied") return false;
  if (c?.choice === "granted") return true;
  return !needsBanner(country);
}

export function saveConsent(choice: ConsentChoice, country: string | null) {
  const rec: StoredConsent = { choice, at: new Date().toISOString(), version: CONSENT_NOTICE_VERSION, country };
  localStorage.setItem(CONSENT_KEY, JSON.stringify(rec));
  window.dispatchEvent(new CustomEvent("matbex:consent-changed"));
  if (choice === "granted") void enableAdTags();
  else revokeAdTags();
}

let metaLoaded = false;
let googleLoaded = false;

function loadMeta(id: string) {
  if (metaLoaded) {
    window.fbq?.("consent", "grant");
    return;
  }
  metaLoaded = true;
  /* Meta base snippet */
  const n = function (...args: unknown[]) {
    const f = n as unknown as NonNullable<Window["fbq"]>;
    if (f.callMethod) f.callMethod.apply(f, args);
    else (f.queue as unknown[]).push(args);
  } as unknown as NonNullable<Window["fbq"]>;
  if (!window.fbq) {
    window.fbq = n;
    if (!window._fbq) window._fbq = n;
    n.push = n;
    n.loaded = true;
    n.version = "2.0";
    n.queue = [];
    const s = document.createElement("script");
    s.async = true;
    s.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(s);
  }
  window.fbq!("consent", "grant");
  window.fbq!("init", id, {}, { agent: "lovable" });
  window.fbq!("track", "PageView");
}

function loadGoogle(id: string) {
  if (!googleLoaded) {
    googleLoaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function (...args: unknown[]) { window.dataLayer!.push(args); };
    window.gtag("consent", "default", { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "denied" });
    const s = document.createElement("script");
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
    document.head.appendChild(s);
    window.gtag("js", new Date());
    window.gtag("config", id);
  }
  window.gtag?.("consent", "update", { ad_storage: "granted", ad_user_data: "granted", ad_personalization: "granted" });
}

export async function enableAdTags() {
  const country = await detectCountry();
  if (!adsAllowed(country)) return;
  if (META_PIXEL_ID) loadMeta(META_PIXEL_ID);
  if (GOOGLE_ADS_ID) loadGoogle(GOOGLE_ADS_ID);
}

export function revokeAdTags() {
  window.fbq?.("consent", "revoke");
  window.gtag?.("consent", "update", { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
}

export type LeadEvent = "Lead" | "CompleteRegistration";

/** Report a lead to the ad platforms (only when allowed and configured). */
export async function trackAdLead(event: LeadEvent, eventId: string) {
  const country = await detectCountry();
  if (!adsAllowed(country)) return;
  if (META_PIXEL_ID && window.fbq) window.fbq("track", event, {}, { eventID: eventId });
  const label = event === "Lead"
    ? (import.meta.env.VITE_GOOGLE_ADS_DEMO_LABEL as string | undefined)
    : (import.meta.env.VITE_GOOGLE_ADS_SIGNUP_LABEL as string | undefined);
  if (GOOGLE_ADS_ID && label && window.gtag) {
    window.gtag("event", "conversion", { send_to: `${GOOGLE_ADS_ID}/${label}`, transaction_id: eventId });
  }
}

/** Short summary sent with a lead so each conversion records the consent state. */
export async function consentSnapshot(): Promise<{ ad_consent: string; country: string | null }> {
  const country = await detectCountry();
  const c = readConsent();
  const state = gpcEnabled() ? "gpc_refused" : c ? `${c.choice}@${c.version}` : needsBanner(country) ? "not_asked" : "not_required";
  return { ad_consent: state, country };
}

/** Attribution + consent state sent with every lead form. */
export async function leadAttributionPayload() {
  const { getAttribution } = await import("@/lib/leadAttribution");
  return { ...getAttribution(), ...(await consentSnapshot()) };
}
