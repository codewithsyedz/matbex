import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts'

// Sends the loyalty "we miss you" email for a single customer.
// The recipient is derived from the customer row the caller is allowed to read
// (RLS scopes it to their restaurant) — never from the request body.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ error: 'Unauthorized' }, 401)
    }

    let body: { customerId?: unknown }
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Invalid JSON body' }, 400)
    }

    const customerId = body.customerId
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (typeof customerId !== 'string' || !uuidPattern.test(customerId)) {
      return json({ error: 'customerId must be a valid id' }, 400)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: user } = await supabase.auth.getUser()
    if (!user?.user) {
      return json({ error: 'Unauthorized' }, 401)
    }

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id, name, email, points_balance, restaurant_id')
      .eq('id', customerId)
      .maybeSingle()

    if (customerError) {
      console.error('Failed to load customer', customerError)
      return json({ error: 'Failed to load customer' }, 500)
    }
    if (!customer) {
      return json({ error: 'Customer not found' }, 404)
    }
    if (!customer.email) {
      return json({ error: 'Customer has no email' }, 400)
    }

    let restaurantName = 'our restaurant'
    if (customer.restaurant_id) {
      const { data: restaurant } = await supabase
        .from('restaurants')
        .select('name')
        .eq('id', customer.restaurant_id)
        .maybeSingle()
      if (restaurant?.name) restaurantName = restaurant.name
    }

    // Send-attempt history stays in the app's own log table.
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    const logAttempt = async (
      status: 'sent' | 'suppressed' | 'failed',
      errorMessage?: string
    ) => {
      const { error } = await admin.from('email_send_log').insert({
        message_id: null,
        template_name: 'loyalty-reengagement',
        recipient_email: customer.email,
        status,
        error_message: errorMessage?.slice(0, 1000) ?? null,
      })
      if (error) {
        console.error('Failed to write email send log', error)
      }
    }

    // One send per customer per day — retries of the same click dedupe.
    const day = new Date().toISOString().slice(0, 10)
    let result
    try {
      result = await sendTemplateEmail('loyalty-reengagement', customer.email, {
        templateData: {
          name: customer.name ?? 'there',
          restaurantName,
          points: Number(customer.points_balance ?? 0).toFixed(0),
        },
        idempotencyKey: `loyalty-reengagement-${customer.id}-${day}`,
      })
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : String(sendError)
      await logAttempt('failed', message)
      throw sendError
    }

    if (!result.sent) {
      await logAttempt('suppressed')
      return json({ sent: false, reason: result.reason })
    }

    await logAttempt('sent')
    return json({ sent: true })

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('send-loyalty-reengagement failed', message)
    return json({ error: message }, 500)
  }
})
