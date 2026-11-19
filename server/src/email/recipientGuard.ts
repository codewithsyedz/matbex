/**
 * Staging safety net for outbound email.
 *
 * With EMAIL_ALLOWED_RECIPIENTS set (comma-separated: exact addresses and/or "@domain"
 * entries), every request to Resend's send API is filtered before it leaves the process:
 * recipients not on the list are removed from to/cc/bcc, and an email left with no
 * recipient is not sent at all (a fake success is returned so callers carry on). This
 * covers every sender at once, because all of them reach Resend through fetch: the
 * shared sender (src/email/send.ts), the auth emails, the Resend SDK in server functions
 * and the functions that call https://api.resend.com/emails directly.
 *
 * Unset (production): nothing is installed and email behaves normally.
 */
const RESEND_HOST = "api.resend.com";

type Recipients = string | string[] | undefined;

export function parseAllowList(raw: string | undefined): { exact: Set<string>; domains: string[] } | null {
  const items = (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!items.length) return null;
  return {
    exact: new Set(items.filter((i) => !i.startsWith("@"))),
    domains: items.filter((i) => i.startsWith("@")),
  };
}

/** Address part of "Name <addr@x>" or a bare address, lower-cased. */
function addressOf(r: string): string {
  const m = /<([^>]+)>/.exec(r);
  return (m ? m[1] : r).trim().toLowerCase();
}

export function filterRecipients(list: Recipients, allow: NonNullable<ReturnType<typeof parseAllowList>>): { kept: string[]; dropped: string[] } {
  const all = list === undefined ? [] : Array.isArray(list) ? list : [list];
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const r of all) {
    const a = addressOf(String(r));
    if (allow.exact.has(a) || allow.domains.some((d) => a.endsWith(d))) kept.push(r);
    else dropped.push(a);
  }
  return { kept, dropped };
}

/** Filters one Resend email payload in place; returns the dropped addresses and whether anything is left to send. */
export function filterEmailPayload(email: Record<string, unknown>, allow: NonNullable<ReturnType<typeof parseAllowList>>) {
  const dropped: string[] = [];
  const to = filterRecipients(email.to as Recipients, allow);
  dropped.push(...to.dropped);
  email.to = to.kept;
  for (const field of ["cc", "bcc"] as const) {
    if (email[field] === undefined) continue;
    const r = filterRecipients(email[field] as Recipients, allow);
    dropped.push(...r.dropped);
    if (r.kept.length) email[field] = r.kept;
    else delete email[field];
  }
  return { dropped, sendable: to.kept.length > 0 };
}

let installed = false;

export function installEmailRecipientGuard(log: (msg: string) => void = (m) => console.warn(m)): boolean {
  const allow = parseAllowList(process.env.EMAIL_ALLOWED_RECIPIENTS);
  if (!allow || installed) return installed;
  installed = true;
  const realFetch = globalThis.fetch;

  globalThis.fetch = async function guardedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (url.hostname !== RESEND_HOST || method !== "POST" || !/^\/emails(\/batch)?\/?$/.test(url.pathname)) {
      return realFetch(input, init);
    }
    const raw = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
    if (typeof raw !== "string") {
      log(`[email-guard] blocked a Resend call with an unreadable body (EMAIL_ALLOWED_RECIPIENTS is set)`);
      return Response.json({ id: `blocked-${crypto.randomUUID()}` });
    }
    const payload = JSON.parse(raw);
    const batch = url.pathname.startsWith("/emails/batch");
    const emails: Record<string, unknown>[] = batch ? payload : [payload];
    const keep: Record<string, unknown>[] = [];
    for (const e of emails) {
      const { dropped, sendable } = filterEmailPayload(e, allow);
      if (dropped.length) log(`[email-guard] not sending "${String(e.subject ?? "")}" to ${dropped.length} recipient(s) outside EMAIL_ALLOWED_RECIPIENTS`);
      if (sendable) keep.push(e);
    }
    if (!keep.length) {
      return batch ? Response.json({ data: [] }) : Response.json({ id: `blocked-${crypto.randomUUID()}` });
    }
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.delete("content-length");
    return realFetch(url, { ...init, method: "POST", headers, body: JSON.stringify(batch ? keep : keep[0]) });
  } as typeof fetch;

  log(`[email-guard] outbound email limited to EMAIL_ALLOWED_RECIPIENTS (${allow.exact.size} address(es), ${allow.domains.length} domain(s))`);
  return true;
}
