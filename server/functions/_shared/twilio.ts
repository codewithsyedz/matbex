/**
 * Direct Twilio REST client (replaces the former third-party connector gateway).
 * Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN (or TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET).
 */
import { env } from "../_runtime/env.ts";

export function twilioConfigured(): boolean {
  return !!env("TWILIO_ACCOUNT_SID") && !!(env("TWILIO_AUTH_TOKEN") || (env("TWILIO_API_KEY_SID") && env("TWILIO_API_KEY_SECRET")));
}

/** fetch() against https://api.twilio.com/2010-04-01/Accounts/{SID}{path} with Basic auth. */
export async function twilioRequest(path: string, init: { method?: string; body?: URLSearchParams | string } = {}): Promise<Response> {
  const sid = env("TWILIO_ACCOUNT_SID");
  const user = env("TWILIO_API_KEY_SID") ?? sid;
  const pass = env("TWILIO_API_KEY_SECRET") ?? env("TWILIO_AUTH_TOKEN");
  if (!sid || !user || !pass) throw new Error("Twilio is not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)");
  const p = path.startsWith("/") ? path : `/${path}`;
  const url = p === "/" || p === "/.json" ? `https://api.twilio.com/2010-04-01/Accounts/${sid}.json` : `https://api.twilio.com/2010-04-01/Accounts/${sid}${p}`;
  return fetch(url, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`,
      ...(init.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: init.body ? init.body.toString() : undefined,
  });
}
