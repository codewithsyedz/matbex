/**
 * Minimal client for the typed /api/v1 endpoints (server/src/modules). Uses the signed-in
 * user's access token; errors carry the server's status and machine-readable code.
 */
import { db } from "@/integrations/db/client";
import { apiUrl } from "@/integrations/db/config";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<{ data: T; status: number; headers: Headers }> {
  const { data: { session } } = await db.auth.getSession();
  if (!session?.access_token) throw new ApiError(401, "Sign in required", "no_session");
  const res = await fetch(apiUrl(`/api/v1${path}`), {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: {
      authorization: `Bearer ${session.access_token}`,
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: init.signal,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, json?.message ?? res.statusText, json?.error_code ?? json?.code);
  return { data: json as T, status: res.status, headers: res.headers };
}
