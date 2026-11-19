import { env } from "../_runtime/env.ts";

/**
 * Sender address on the verified sending domain (EMAIL_FROM_DOMAIN, e.g. notify.matbex.com).
 * Functions used to hard-code "<box>@matbex.com", a domain the email provider has not
 * verified, so those emails could not be sent from the self-hosted stack.
 *   fromAddress("Matbex Reports", "reports") → "Matbex Reports <reports@notify.matbex.com>"
 */
export function fromAddress(name: string, mailbox: string): string {
  const domain = (env("EMAIL_FROM_DOMAIN") || "notify.matbex.com").trim();
  return `${name} <${mailbox}@${domain}>`;
}
