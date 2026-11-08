// Region-aware Supabase client for data-residency tiers.
//
// Default usage stays on the global project via `supabase` (see ./client).
// When a customer is provisioned in a Saudi-region project, set:
//   VITE_SUPABASE_KSA_URL=https://<ksa-project>.supabase.co
//   VITE_SUPABASE_KSA_PUBLISHABLE_KEY=<ksa anon key>
// and the tenant's `data_region` value drives which client we use.
//
// Region is resolved once at bootstrap from:
//   1. ?region=ksa query param (preview / staff override)
//   2. localStorage('matbex-data-region')
//   3. hostname (sa.matbex.com / *.matbex.sa => ksa)
// Tenant-level enforcement happens server-side via the
// `guard_tenant_data_region` trigger; this picks the *endpoint* only.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { supabase as globalClient } from './client';

export type DataRegion = 'global' | 'ksa';

const REGION_STORAGE_KEY = 'matbex-data-region';

const KSA_URL = import.meta.env.VITE_SUPABASE_KSA_URL as string | undefined;
const KSA_KEY = import.meta.env.VITE_SUPABASE_KSA_PUBLISHABLE_KEY as string | undefined;

function detectRegion(): DataRegion {
  if (typeof window === 'undefined') return 'global';
  try {
    const url = new URL(window.location.href);
    const qp = url.searchParams.get('region');
    if (qp === 'ksa' || qp === 'global') {
      window.localStorage.setItem(REGION_STORAGE_KEY, qp);
      return qp;
    }
    const stored = window.localStorage.getItem(REGION_STORAGE_KEY);
    if (stored === 'ksa' || stored === 'global') return stored;
    const host = window.location.hostname;
    if (host.startsWith('sa.') || host.endsWith('.matbex.sa') || host === 'matbex.sa') {
      return 'ksa';
    }
  } catch {
    // ignore
  }
  return 'global';
}

let ksaClient: SupabaseClient<Database> | null = null;

function getKsaClient(): SupabaseClient<Database> {
  if (!KSA_URL || !KSA_KEY) {
    // KSA project not provisioned in this environment — fall back safely.
    if (typeof console !== 'undefined') {
      console.warn('[regionClient] KSA region requested but VITE_SUPABASE_KSA_URL not set; using global client.');
    }
    return globalClient;
  }
  if (!ksaClient) {
    ksaClient = createClient<Database>(KSA_URL, KSA_KEY, {
      auth: {
        storage: typeof localStorage !== 'undefined' ? localStorage : undefined,
        storageKey: 'sb-ksa-auth',
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  }
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

/**
 * Returns the Supabase client matching the active data-residency region.
 * Use this instead of the default `supabase` import when a feature must
 * follow the customer's residency (auth, data, storage).
 */
export function getRegionalSupabase(): SupabaseClient<Database> {
  return currentDataRegion === 'ksa' ? getKsaClient() : globalClient;
}

export const regionalSupabase = getRegionalSupabase();