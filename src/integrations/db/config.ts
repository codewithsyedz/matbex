/** Runtime endpoints for the Matbex API (set at build time via Vite env). */
export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") ?? "";
export const API_KEY = (import.meta.env.VITE_API_KEY as string | undefined) ?? "";

/** Build a URL under the API, e.g. apiUrl("/functions/v1/pos-sync"). */
export const apiUrl = (path: string) => `${API_URL}${path.startsWith("/") ? path : `/${path}`}`;
