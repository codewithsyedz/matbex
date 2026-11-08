/**
 * The app's single API client (auth, data, rpc, storage, functions, realtime).
 *
 *   import { db } from "@/integrations/db/client";
 *
 * VITE_API_URL  — base URL of the Matbex API, e.g. https://api.matbex.com
 * VITE_API_KEY  — the public anon key (role "anon"; safe to ship to browsers)
 */
import { createClient } from "@matbex/client";
import type { Database } from "./types";
import { API_KEY, API_URL } from "./config";

export const db = createClient<Database>(API_URL, API_KEY, {
  auth: {
    storageKey: "matbex-auth",
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export type { Database } from "./types";
