/** Auth lifecycle emails (signup, recovery, invite, magic link, email change). */
import * as React from "react";
import { renderAsync } from "@react-email/components";
import { config } from "../config.js";
import { sendEmail } from "./send.js";
import { SignupEmail } from "../../functions/_shared/email-templates/signup.tsx";
import { InviteEmail } from "../../functions/_shared/email-templates/invite.tsx";
import { MagicLinkEmail } from "../../functions/_shared/email-templates/magic-link.tsx";
import { RecoveryEmail } from "../../functions/_shared/email-templates/recovery.tsx";
import { EmailChangeEmail } from "../../functions/_shared/email-templates/email-change.tsx";
import { ReauthenticationEmail } from "../../functions/_shared/email-templates/reauthentication.tsx";

const SITE_NAME = "Matbex";

export type AuthEmailType = "signup" | "invite" | "magiclink" | "recovery" | "email_change" | "reauthentication";

const SUBJECTS: Record<AuthEmailType, string> = {
  signup: "Confirm your email for Matbex",
  invite: "You've been invited to Matbex",
  magiclink: "Your Matbex sign-in link",
  recovery: "Reset your Matbex password",
  email_change: "Confirm your new email for Matbex",
  reauthentication: "Your Matbex verification code",
};

export async function sendAuthEmail(
  type: AuthEmailType,
  to: string,
  data: { url?: string; token?: string; oldEmail?: string; newEmail?: string },
) {
  const url = data.url ?? config.SITE_URL;
  let element: React.ReactElement;
  switch (type) {
    case "signup":
      element = React.createElement(SignupEmail, { siteName: SITE_NAME, siteUrl: config.SITE_URL, recipient: to, confirmationUrl: url });
      break;
    case "invite":
      element = React.createElement(InviteEmail, { siteName: SITE_NAME, siteUrl: config.SITE_URL, confirmationUrl: url });
      break;
    case "magiclink":
      element = React.createElement(MagicLinkEmail, { siteName: SITE_NAME, confirmationUrl: url });
      break;
    case "recovery":
      element = React.createElement(RecoveryEmail, { siteName: SITE_NAME, confirmationUrl: url });
      break;
    case "email_change":
      element = React.createElement(EmailChangeEmail, {
        siteName: SITE_NAME,
        oldEmail: data.oldEmail ?? to,
        email: to,
        newEmail: data.newEmail ?? to,
        confirmationUrl: url,
      });
      break;
    case "reauthentication":
      element = React.createElement(ReauthenticationEmail, { token: data.token ?? "" });
      break;
  }
  const html = await renderAsync(element);
  const text = await renderAsync(element, { plainText: true });
  return sendEmail({ to, subject: SUBJECTS[type], html, text, template: `auth.${type}` });
}
