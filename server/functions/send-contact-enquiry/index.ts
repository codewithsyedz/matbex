import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
import { corsHeaders } from '../_runtime/cors.ts'
import { createClient } from '@matbex/client'
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts'

// Public contact form endpoint: stores the enquiry, notifies the team inbox,
// and sends the visitor a confirmation. Input is validated and rate limited
// here because the caller is unauthenticated.

const MAX_PER_EMAIL_PER_WINDOW = 3
const WINDOW_MINUTES = 10

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  try {
    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Invalid JSON body' }, 400)
    }

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const message = typeof body.message === 'string' ? body.message.trim() : ''
    const kind = body.kind === 'demo' ? 'demo' : 'enquiry'

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
    if (!name || name.length > 100) {
      return json({ error: 'Please enter your name (under 100 characters).' }, 400)
    }
    if (!email || email.length > 255 || !emailPattern.test(email)) {
      return json({ error: 'Please enter a valid email address.' }, 400)
    }
    const minMessage = kind === 'demo' ? 0 : 10
    if (message.length < minMessage || message.length > 2000) {
      return json({ error: 'Your message must be between 10 and 2000 characters.' }, 400)
    }

    // Demo bookings carry a requested slot; validate it before storing.
    const rawDate = typeof body.preferredDate === 'string' ? body.preferredDate.trim() : ''
    let preferredDate: string | null = null
    if (kind === 'demo') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate) || Number.isNaN(Date.parse(rawDate))) {
        return json({ error: 'Please choose a valid date for your demo.' }, 400)
      }
      const today = new Date()
      today.setUTCHours(0, 0, 0, 0)
      if (Date.parse(rawDate) < today.getTime()) {
        return json({ error: 'Please choose a date in the future.' }, 400)
      }
      preferredDate = rawDate
    }


    const db = createClient(
      env("API_URL")!,
      env("SERVICE_ROLE_KEY")!,
    )

    const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString()
    const { count, error: countError } = await db
      .from('contact_messages')
      .select('id', { count: 'exact', head: true })
      .eq('email', email)
      .gte('created_at', since)

    if (countError) {
      console.error('Rate-limit check failed', countError)
    } else if ((count ?? 0) >= MAX_PER_EMAIL_PER_WINDOW) {
      return json(
        { error: "You've sent several messages already. Please try again in a few minutes." },
        429,
      )
    }

    const userAgent = (req.headers.get('user-agent') ?? '').slice(0, 500) || null
    const str = (v: unknown, max = 300) =>
      typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
    const device = /mobile|android|iphone|ipad/i.test(userAgent ?? '') ? 'mobile' : 'desktop'

    const company = str(body.company, 120)
    const phone = str(body.phone, 40)
    const branchCount = str(body.branchCount, 40)
    const preferredSlot = kind === 'demo' ? str(body.preferredSlot, 60) : null

    const { data: inserted, error: insertError } = await db
      .from('contact_messages')
      .insert({
        name,
        email,
        message,
        kind,
        company,
        phone,
        branch_count: branchCount,
        preferred_date: preferredDate,
        preferred_slot: preferredSlot,
        user_agent: userAgent,
        source_path: str(body.sourcePath, 200),
        referrer: str(body.referrer, 500),
        utm_source: str(body.utmSource, 100),
        utm_campaign: str(body.utmCampaign, 100),
        language: str(body.language, 20),
        device,
      })
      .select('id, created_at')
      .single()

    if (insertError || !inserted) {
      console.error('Failed to store enquiry', insertError)
      return json({ error: 'Could not send your message. Please try again.' }, 500)
    }

    // Credit the lead to the ad / link that brought the visitor.
    const a = (body.attribution && typeof body.attribution === 'object') ? body.attribution as Record<string, unknown> : {}
    const firstSeen = str(a.first_seen_at, 40)
    const { error: attrErr } = await db.from('lead_attributions').insert({
      lead_type: kind,
      lead_ref: inserted.id,
      email,
      utm_source: str(a.utm_source, 150) ?? str(body.utmSource, 100),
      utm_medium: str(a.utm_medium, 150),
      utm_campaign: str(a.utm_campaign, 150) ?? str(body.utmCampaign, 100),
      utm_content: str(a.utm_content, 150),
      utm_term: str(a.utm_term, 150),
      gclid: str(a.gclid, 300),
      fbclid: str(a.fbclid, 300),
      landing_path: str(a.landing_path, 200),
      referrer: str(a.referrer, 300) ?? str(body.referrer, 300),
      first_seen_at: firstSeen && !Number.isNaN(Date.parse(firstSeen)) ? firstSeen : null,
      ad_consent: str(a.ad_consent, 60),
      country: str(a.country, 4),
    })
    if (attrErr) console.error('Failed to store lead attribution', attrErr)

    const submittedAt = new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Riyadh',
    }).format(new Date(inserted.created_at as string))

    // Demo bookings are emailed with their slot and venue details on top of
    // whatever the visitor typed, so the team can confirm without opening the app.
    const emailMessage =
      kind === 'demo'
        ? [
            `Live demo request for ${preferredDate}${preferredSlot ? ` at ${preferredSlot}` : ''} (Riyadh time).`,
            company ? `Restaurant: ${company}` : null,
            branchCount ? `Branches: ${branchCount}` : null,
            phone ? `Phone: ${phone}` : null,
            message ? `\nNotes: ${message}` : null,
          ]
            .filter(Boolean)
            .join('\n')
        : message

    // Every send attempt is recorded so the admin email inbox can show, per
    // enquiry, whether the team notification and visitor confirmation left.
    const logSend = async (
      templateName: string,
      recipient: string,
      status: 'sent' | 'suppressed' | 'failed',
      errorMessage: string | null,
    ) => {
      const { error } = await db.from('email_send_log').insert({
        template_name: templateName,
        recipient_email: recipient,
        status,
        error_message: errorMessage,
        metadata: { contact_id: inserted.id, kind, name },
      })
      if (error) console.error('Failed to write email send log', error)
    }

    // The team notification is the part that must land; the visitor
    // confirmation is best effort.
    try {
      const result = await sendTemplateEmail('contact-enquiry-notification', '', {
        templateData: {
          name,
          email,
          message: emailMessage,
          submittedAt: `${submittedAt} (Riyadh)`,
        },
        idempotencyKey: `contact-enquiry-notification-${inserted.id}`,
        replyTo: email,
      })
      await logSend(
        'contact-enquiry-notification',
        'hello@matbex.com',
        result && (result as { sent?: boolean }).sent === false ? 'suppressed' : 'sent',
        null,
      )
    } catch (error) {
      console.error('Failed to notify team inbox', error)
      await logSend(
        'contact-enquiry-notification',
        'hello@matbex.com',
        'failed',
        error instanceof Error ? error.message : String(error),
      )
      return json({ error: 'Could not send your message. Please try again.' }, 502)
    }

    try {
      const result = await sendTemplateEmail('contact-enquiry-confirmation', email, {
        templateData: { name: name.split(' ')[0] || name, message: emailMessage },
        idempotencyKey: `contact-enquiry-confirmation-${inserted.id}`,
      })
      await logSend(
        'contact-enquiry-confirmation',
        email,
        result && (result as { sent?: boolean }).sent === false ? 'suppressed' : 'sent',
        null,
      )
    } catch (error) {
      console.error('Failed to send visitor confirmation', error)
      await logSend(
        'contact-enquiry-confirmation',
        email,
        'failed',
        error instanceof Error ? error.message : String(error),
      )
    }


    return json({ ok: true, id: inserted.id })
  } catch (error) {
    console.error('send-contact-enquiry failed', error)
    return json({ error: 'Could not send your message. Please try again.' }, 500)
  }
})
