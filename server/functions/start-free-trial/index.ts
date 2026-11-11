import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
import { corsHeaders } from '../_runtime/cors.ts'
import { createClient } from '@matbex/client'
import { z } from 'zod'

// Starts a real Matbex account on a 14-day free trial (no card).
// Creates the company, its first restaurant and the owner role for the
// signed-in user, and credits the sign-up to the ad/link that brought them.

const TRIAL_DAYS = 14

const Body = z.object({
  restaurantName: z.string().trim().min(2).max(120),
  currency: z.string().trim().min(1).max(8).default('SAR'),
  timezone: z.string().trim().min(1).max(64).default('Asia/Riyadh'),
  plan: z.enum(['starter', 'growth', 'enterprise']).default('growth'),
  attribution: z.record(z.unknown()).optional(),
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Please sign in first.' }, 401)

    const url = env("API_URL")!
    const userClient = createClient(url, env("ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userData.user) return json({ error: 'Please sign in first.' }, 401)
    const user = userData.user

    let raw: unknown
    try { raw = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
    const parsed = Body.safeParse(raw)
    if (!parsed.success) return json({ error: 'Please enter your restaurant name.', details: parsed.error.flatten().fieldErrors }, 400)
    const { restaurantName, currency, timezone, plan, attribution } = parsed.data

    const admin = createClient(url, env("SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // One account per user: return the existing one instead of creating another.
    const { data: existing } = await admin.from('user_tenant_roles').select('tenant_id').eq('user_id', user.id).limit(1)
    if (existing && existing.length > 0) {
      const { data: rest } = await admin.from('restaurants').select('id').eq('tenant_id', existing[0].tenant_id).eq('is_primary', true).maybeSingle()
      return json({ ok: true, already_exists: true, tenant_id: existing[0].tenant_id, restaurant_id: rest?.id ?? null })
    }

    // Every trial runs on Growth ('pro'): Growth features, one branch (enforced by the database
    // while the tenant is on trial). The plan they picked is kept in settings.trial.chosen_plan
    // for checkout; Enterprise is set up with sales.
    const planName = 'pro'
    const { data: planRow } = await admin.from('plans').select('id').eq('name', planName).maybeSingle()
    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString()

    const { data: tenant, error: tErr } = await admin.from('tenants').insert({
      name: restaurantName,
      status: 'trial',
      tenant_type: 'PRODUCTION',
      trial_ends_at: trialEndsAt,
      plan_id: planRow?.id ?? null,
      settings: { trial: { chosen_plan: plan, started_at: new Date().toISOString(), days: TRIAL_DAYS } },
    }).select('id').single()
    if (tErr) throw tErr

    const { data: restaurant, error: rErr } = await admin.from('restaurants').insert({
      tenant_id: tenant.id, name: restaurantName, currency, timezone, is_primary: true,
    }).select('id').single()
    if (rErr) { await admin.from('tenants').delete().eq('id', tenant.id); throw rErr }

    const { error: roleErr } = await admin.from('user_tenant_roles').insert({ user_id: user.id, tenant_id: tenant.id, role: 'owner' })
    if (roleErr) throw roleErr
    const { error: legacyErr } = await admin.from('user_roles').insert({ user_id: user.id, restaurant_id: restaurant.id, role: 'owner' })
    if (legacyErr) console.warn('legacy role insert failed', legacyErr.message)
    const { error: profErr } = await admin.from('profiles').upsert({
      id: user.id,
      full_name: (user.user_metadata?.full_name as string) || null,
      tenant_id: tenant.id,
      restaurant_id: restaurant.id,
    })
    if (profErr) throw profErr

    const a = attribution ?? {}
    const s = (v: unknown, n = 150) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null)
    const firstSeen = s(a.first_seen_at, 40)
    const { error: attrErr } = await admin.from('lead_attributions').insert({
      lead_type: 'trial', lead_ref: tenant.id, email: user.email ?? null,
      utm_source: s(a.utm_source), utm_medium: s(a.utm_medium), utm_campaign: s(a.utm_campaign),
      utm_content: s(a.utm_content), utm_term: s(a.utm_term),
      gclid: s(a.gclid, 300), fbclid: s(a.fbclid, 300),
      landing_path: s(a.landing_path, 200), referrer: s(a.referrer, 300),
      first_seen_at: firstSeen && !Number.isNaN(Date.parse(firstSeen)) ? firstSeen : null,
      ad_consent: s(a.ad_consent, 60), country: s(a.country, 4),
    })
    if (attrErr) console.error('lead attribution insert failed', attrErr.message)

    return json({ ok: true, tenant_id: tenant.id, restaurant_id: restaurant.id, trial_ends_at: trialEndsAt, plan })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[start-free-trial]', msg)
    return json({ error: 'Could not start your trial. Please try again.' }, 500)
  }
})
