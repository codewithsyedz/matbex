// Origin-locked CORS for Matbex edge functions.
// Allows production domains, Lovable preview/sandbox, and localhost dev.
const ALLOWED_ORIGINS = new Set<string>([
  "https://matbex.com",
  "https://www.matbex.com",
  "https://matbex.lovable.app",
]);

// Matches Lovable preview subdomains and local dev.
const ALLOWED_PATTERNS: RegExp[] = [
  /^https:\/\/[a-z0-9-]+\.lovable\.app$/i,
  /^https:\/\/[a-z0-9-]+\.lovable\.dev$/i,
  /^https:\/\/[a-z0-9-]+\.sandbox\.lovable\.dev$/i,
  /^https:\/\/[a-z0-9-]+\.lovableproject\.com$/i,
  /^http:\/\/localhost(:\d+)?$/i,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/i,
  /^capacitor:\/\/localhost$/i,
  /^http:\/\/localhost$/i,
  /^https:\/\/localhost$/i,
  /^ionic:\/\/localhost$/i,
];

export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  return ALLOWED_PATTERNS.some((re) => re.test(origin));
}

export function buildCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin");
  const allowed = isOriginAllowed(origin) ? origin! : "https://matbex.com";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-cron-secret, x-terminal-id, x-branch-id, x-request-id, idempotency-key, x-device-id",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    // Lets the terminal/web client read the trace id off the response.
    "Access-Control-Expose-Headers": "x-request-id",
    "Vary": "Origin",
    "Access-Control-Max-Age": "86400",
  };
}

export function corsPreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: buildCorsHeaders(req) });
  }
  return null;
}