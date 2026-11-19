// Region-aware API client for data-residency tiers.
//
// Default usage stays on the global deployment via `db` (see ./client).
// When a customer is provisioned on the Saudi-region deployment, set:
//   VITE_API_URL_KSA=https://api.sa.matbex.com
//   VITE_API_KEY_KSA=<anon key of that deployment>
// and the tenant's `data_region` value drives which client we use.
//
// Region is resolved once at bootstrap from:
//   1. ?region=ksa query param (preview / staff override)
//   2. localStorage('matbex-data-region')
//   3. hostname (sa.matbex.com / *.matbex.sa => ksa)
// Tenant-level enforcement happens server-side via the
// `guard_tenant_data_region` trigger; this picks the *endpoint* only.
import { createClient, type MatbexClient } from "@matbex/client";
import type { Database } from "./types";
import { db as globalClient } from "./client";

export type DataRegion = "global" | "ksa";

const REGION_STORAGE_KEY = "matbex-data-region";
const KSA_URL = import.meta.env.VITE_API_URL_KSA as string | undefined;
const KSA_KEY = import.meta.env.VITE_API_KEY_KSA as string | undefined;

function detectRegion(): DataRegion {
  if (typeof window === "undefined") return "global";
  try {
    const url = new URL(window.location.href);
    const qp = url.searchParams.get("region");
    if (qp === "ksa" || qp === "global") {
      window.localStorage.setItem(REGION_STORAGE_KEY, qp);
      return qp;
    }
    const stored = window.localStorage.getItem(REGION_STORAGE_KEY);
    if (stored === "ksa" || stored === "global") return stored;
    const host = window.location.hostname;
    if (host.startsWith("sa.") || host.endsWith(".matbex.sa") || host === "matbex.sa") return "ksa";
  } catch {
    // ignore
  }
  return "global";
}

let ksaClient: MatbexClient<Database> | null = null;

function getKsaClient(): MatbexClient<Database> {
  if (!KSA_URL) {
    console.warn("[regionClient] KSA region requested but VITE_API_URL_KSA not set; using global client.");
    return globalClient;
  }
  ksaClient ??= createClient<Database>(KSA_URL, KSA_KEY, { auth: { storageKey: "matbex-ksa-auth" } });
  return ksaClient;
}

export const currentDataRegion: DataRegion = detectRegion();

export function setDataRegion(region: DataRegion) {
  try {
    window.localStorage.setItem(REGION_STORAGE_KEY, region);
  } catch {
    // ignore
  }
}

/** Client matching the active data-residency region (auth, data, storage). */
export function getRegionalDb(): MatbexClient<Database> {
  return currentDataRegion === "ksa" ? getKsaClient() : globalClient;
}
