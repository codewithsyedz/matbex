import { env } from "../_runtime/env.ts";
import { serve } from "../_runtime/serve.ts";
import { createClient } from "@matbex/client";
import Stripe from "stripe";
import { Resend } from "resend";
import { requireSuperAdmin } from "../_shared/superadmin.ts";

import { buildCorsHeaders } from "../_shared/cors.ts";
// Plan to Stripe price ID mapping
const PLAN_PRICES: Record<string, string> = {
  pro: "price_1SFOA52MlXQdnUvp6fvItZdK",
  enterprise: "price_1SFOAM2MlXQdnUvpxav6zSpe",
};

interface ApproveApplicationRequest {
  application_id: string;
  review_notes?: string;
}

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[APPROVE-APPLICATION] ${step}${detailsStr}`);
};

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    logStep("Function started");

    // Centralised SuperAdmin guard (JWT claim → DB re-check, throws Response on failure).
    const caller = await requireSuperAdmin(req);
    logStep("SuperAdmin verified", { userId: caller.userId, source: caller.source });

    // Create the API admin client for privileged work
    const apiUrl = env("API_URL")!;
    const serviceRoleKey = env("SERVICE_ROLE_KEY")!;
    const dbAdmin = createClient(apiUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const requester = { id: caller.userId };

    // Parse request body
    const body: ApproveApplicationRequest = await req.json();
    const { application_id, review_notes } = body;

    // Fetch the application with plan details
    const { data: application, error: appError } = await dbAdmin
      .from('tenant_applications')
      .select('*, plans(name, price)')
      .eq('id', application_id)
      .single();

    if (appError || !application) {
      return new Response(JSON.stringify({ error: 'Application not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    logStep("Application found", { 
      id: application.id, 
      email: application.email,
      status: application.status,
      plan: application.plans?.name 
    });

    if (application.status === 'approved') {
      return new Response(JSON.stringify({ error: 'Application already approved' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // Get plan name and validate it has a Stripe price
    const planName = application.plans?.name?.toLowerCase() || '';

    // === TRIAL PLAN: provision tenant directly, skip Stripe ===
    if (planName === 'trial') {
      logStep("Trial plan detected - provisioning tenant directly");

      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + 14);

      // Generate temp password
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
      let tempPassword = "";
      for (let i = 0; i < 16; i++) tempPassword += chars.charAt(Math.floor(Math.random() * chars.length));

      const { data: tenant, error: tenantError } = await dbAdmin
        .from('tenants')
        .insert({
          name: application.company_name,
          slug: application.company_name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
          status: 'trial',
          plan_id: application.plan_id,
          trial_ends_at: trialEndsAt.toISOString(),
        })
        .select()
        .single();
      if (tenantError) throw new Error(`Failed to create tenant: ${tenantError.message}`);

      const { data: restaurant, error: restaurantError } = await dbAdmin
        .from('restaurants')
        .insert({
          tenant_id: tenant.id,
          name: application.restaurant_name || application.company_name,
          is_primary: true,
          status: 'active',
          currency: 'SAR',
          timezone: 'Asia/Riyadh',
        })
        .select()
        .single();
      if (restaurantError) throw new Error(`Failed to create restaurant: ${restaurantError.message}`);

      const { data: authData, error: createUserError } = await dbAdmin.auth.admin.createUser({
        email: application.email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { full_name: application.full_name },
      });
      if (createUserError) throw new Error(`Failed to create user: ${createUserError.message}`);
      const userId = authData.user?.id;

      if (userId) {
        // on_auth_user_created already inserted a bare profile row; fill in tenant + restaurant.
        const { error: profileError } = await dbAdmin.from('profiles').upsert({
          id: userId,
          full_name: application.full_name,
          tenant_id: tenant.id,
          restaurant_id: restaurant.id,
        }, { onConflict: 'id' });
        if (profileError) throw new Error(`Failed to set up profile: ${profileError.message}`);
        await dbAdmin.from('user_tenant_roles').insert({
          user_id: userId,
          tenant_id: tenant.id,
          role: 'owner',
        });
        await dbAdmin.from('user_roles').insert({
          user_id: userId,
          restaurant_id: restaurant.id,
          role: 'owner',
        });
      }

      // temporary_password was dropped (20260524101720: no plaintext passwords at rest); the
      // password only goes out in the welcome email below.
      const { error: appUpdateError } = await dbAdmin
        .from('tenant_applications')
        .update({
          status: 'approved',
          payment_status: 'paid',
          paid_at: new Date().toISOString(),
          tenant_id: tenant.id,
          user_id: userId,
          reviewed_by: requester.id,
          reviewed_at: new Date().toISOString(),
          review_notes: review_notes || 'Trial plan - auto-provisioned',
        })
        .eq('id', application_id);
      if (appUpdateError) throw new Error(`Tenant provisioned but application not marked approved: ${appUpdateError.message}`);

      // Send welcome email with credentials
      try {
        const resend = new Resend(env("RESEND_API_KEY"));
        const siteUrl = env('SITE_URL') || 'https://matbex.com';
        await resend.emails.send({
          from: 'Matbex <onboarding@matbex.com>',
          to: [application.email],
          subject: `🎁 Your 14-day Matbex trial is ready, ${application.full_name}!`,
          html: `<p>Hi ${application.full_name},</p>
            <p>Your free 14-day trial of <strong>Matbex Pro</strong> is now active.</p>
            <p><strong>Login:</strong> <a href="${siteUrl}/auth">${siteUrl}/auth</a><br/>
            <strong>Email:</strong> ${application.email}<br/>
            <strong>Temporary password:</strong> <code>${tempPassword}</code></p>
            <p>Your trial ends on <strong>${trialEndsAt.toDateString()}</strong>. Upgrade anytime from Settings → Billing.</p>`,
        });
        await dbAdmin
          .from('tenant_applications')
          .update({ credentials_sent_at: new Date().toISOString() })
          .eq('id', application_id);
      } catch (e) {
        logStep("Trial welcome email failed", { error: String(e) });
      }

      logStep("Trial tenant provisioned", { tenantId: tenant.id, trialEndsAt: trialEndsAt.toISOString() });
      return new Response(JSON.stringify({
        success: true,
        trial: true,
        message: "Trial account provisioned. Credentials emailed to applicant.",
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const priceId = PLAN_PRICES[planName];

    if (!priceId) {
      return new Response(JSON.stringify({ 
        error: `Plan "${application.plans?.name}" does not have a Stripe price configured` 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // Initialize Stripe
    const stripeKey = env("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");
    
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Check if customer already exists or create new one
    const customers = await stripe.customers.list({ email: application.email, limit: 1 });
    let customerId: string;
    
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
      logStep("Found existing Stripe customer", { customerId });
    } else {
      const customer = await stripe.customers.create({
        email: application.email,
        name: application.full_name,
        metadata: {
          application_id: application.id,
          company_name: application.company_name,
        },
      });
      customerId = customer.id;
      logStep("Created new Stripe customer", { customerId });
    }

    const siteUrl = env('SITE_URL') || 'https://matbex.com';

    // Create Stripe Payment Link
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      success_url: `${siteUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/register?payment=canceled`,
      metadata: {
        application_id: application.id,
        plan_name: planName,
        type: "registration_approval",
      },
      subscription_data: {
        metadata: {
          application_id: application.id,
          plan_name: planName,
        },
      },
    });

    logStep("Stripe checkout session created", { sessionId: session.id, url: session.url });

    // Update application status to pending_payment
    await dbAdmin
      .from('tenant_applications')
      .update({
        status: 'pending_payment',
        reviewed_by: requester.id,
        reviewed_at: new Date().toISOString(),
        review_notes: review_notes || null,
        stripe_session_id: session.id,
        stripe_customer_id: customerId,
        payment_status: 'pending',
      })
      .eq('id', application_id);

    logStep("Application updated to pending_payment");

    // Send approval email with payment link
    const resend = new Resend(env("RESEND_API_KEY"));

    await resend.emails.send({
      from: 'Matbex <onboarding@matbex.com>',
      to: [application.email],
      subject: `🎉 Your Matbex Application is Approved, ${application.full_name}!`,
      html: generateApprovalEmail(
        application.full_name, 
        application.company_name, 
        application.plans?.name || 'Pro',
        application.plans?.price || 0,
        session.url!
      ),
    });

    logStep("Approval email sent with payment link");

    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Application approved. Payment link sent to customer.',
      payment_url: session.url,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (error: unknown) {
    if (error instanceof Response) {
      const body = await error.text();
      return new Response(body, {
        status: error.status,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  }
});

function generateApprovalEmail(
  fullName: string, 
  companyName: string, 
  planName: string, 
  planPrice: number,
  paymentUrl: string
): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #f0fdf4 0%, #f6f9fc 100%); padding: 40px 20px; margin: 0; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08); }
    .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px 32px; text-align: center; }
    .logo { font-size: 32px; font-weight: 300; color: #ffffff; margin: 0; letter-spacing: -0.5px; }
    .logo strong { font-weight: 700; }
    .content { padding: 40px 32px; }
    h1 { color: #1f2937; font-size: 24px; font-weight: 600; text-align: center; margin: 0 0 8px 0; }
    .subtitle { color: #6b7280; text-align: center; margin: 0 0 32px 0; font-size: 16px; }
    .plan-box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; margin-bottom: 32px; text-align: center; }
    .plan-name { color: #1f2937; font-size: 20px; font-weight: 600; margin-bottom: 8px; }
    .plan-price { color: #10b981; font-size: 32px; font-weight: 700; }
    .plan-price span { font-size: 16px; font-weight: 400; color: #6b7280; }
    .button-wrapper { text-align: center; margin: 32px 0; }
    .button { display: inline-block; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #ffffff !important; font-size: 16px; font-weight: 600; text-decoration: none; padding: 16px 48px; border-radius: 8px; }
    .notice { background: #fef3c7; border: 1px solid #fbbf24; border-radius: 8px; padding: 16px; margin-bottom: 24px; }
    .notice p { color: #92400e; font-size: 14px; margin: 0; }
    .steps { background: #ecfdf5; border-radius: 12px; padding: 24px; }
    .steps h3 { color: #065f46; font-size: 16px; margin: 0 0 16px 0; }
    .steps ol { color: #047857; font-size: 14px; margin: 0; padding-left: 20px; }
    .steps li { margin-bottom: 8px; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 32px 0; }
    .footer { text-align: center; padding: 24px 32px; background: #f9fafb; }
    .footer p { color: #9ca3af; font-size: 12px; margin: 4px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <p class="logo">Matbex<strong>OS</strong></p>
    </div>
    <div class="content">
      <h1>Application Approved! 🎉</h1>
      <p class="subtitle">Great news, ${fullName}! Your application for <strong>${companyName}</strong> has been approved.</p>
      
      <div class="plan-box">
        <p class="plan-name">${planName} Plan</p>
        <p class="plan-price">﷼${planPrice}<span>/month</span></p>
      </div>
      
      <div class="notice">
        <p>⚡ Complete your payment to activate your account and receive your login credentials.</p>
      </div>
      
      <div class="button-wrapper">
        <a href="${paymentUrl}" class="button">Complete Payment</a>
      </div>
      
      <div class="steps">
        <h3>📋 What Happens Next?</h3>
        <ol>
          <li>Click the button above to complete your subscription payment</li>
          <li>Once payment is confirmed, we'll create your account</li>
          <li>You'll receive another email with your login credentials</li>
          <li>Sign in and start managing your restaurant!</li>
        </ol>
      </div>
      
      <hr>
      
      <p style="color: #6b7280; font-size: 14px; text-align: center;">
        Questions? Reply to this email or contact our support team.
      </p>
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} Matbex. All rights reserved.</p>
      <p>Restaurant Operations, Simplified.</p>
    </div>
  </div>
</body>
</html>`;
}
