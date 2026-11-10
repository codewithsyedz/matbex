import { env } from "../../_runtime/env.ts";
import * as React from 'react'
import { renderAsync } from '@react-email/components'
import { sendEmail } from '../../../src/email/send.ts'
import { TEMPLATES } from './registry.ts'

// Server-only. Sends through the API's email module (Resend; see server/src/email/send.ts).
const SITE_NAME = "Matbex"
const FROM_DOMAIN = env('EMAIL_FROM_DOMAIN') || "notify.matbex.com"

export type SendTemplateEmailResult =
  | { sent: true }
  | { sent: false; reason: 'recipient_suppressed' }

export interface SendTemplateEmailOptions {
  templateData?: Record<string, any>
  /** Dedupes retries of the same logical send; defaults to a random UUID (no dedupe). */
  idempotencyKey?: string
  replyTo?: string
}

/**
 * Renders a registered template and sends it via Resend. Suppression is
 * enforced against public.suppressed_emails. A suppressed recipient is an expected outcome
 * ({ sent: false }); any other failure throws.
 */
export async function sendTemplateEmail(
  templateName: string,
  to: string,
  options: SendTemplateEmailOptions = {}
): Promise<SendTemplateEmailResult> {
  const template = TEMPLATES[templateName]
  if (!template) {
    throw new Error(
      `Template '${templateName}' not found. Available: ${Object.keys(TEMPLATES).join(', ')}`
    )
  }

  // Template-level `to` takes precedence — notification templates always
  // send to their fixed address.
  const recipient = template.to || to
  if (!recipient) {
    throw new Error('Recipient is required (the template defines no fixed recipient)')
  }

  const templateData = options.templateData ?? {}
  const element = React.createElement(template.component, templateData)
  const html = await renderAsync(element)
  const text = await renderAsync(element, { plainText: true })
  const subject =
    typeof template.subject === 'function'
      ? template.subject(templateData)
      : template.subject

  const result = await sendEmail({
    to: recipient,
    from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
    subject,
    html,
    text,
    template: templateName,
    idempotencyKey: options.idempotencyKey,
    replyTo: options.replyTo,
  })
  if (!result.sent && (result as { reason?: string }).reason === 'recipient_suppressed') {
    return { sent: false, reason: 'recipient_suppressed' }
  }
  if (!result.sent) throw new Error('Email delivery is not configured (RESEND_API_KEY)')

  return { sent: true }
}
