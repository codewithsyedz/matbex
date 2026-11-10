import { env } from "../_runtime/env.ts";
import { fromAddress } from "../_shared/sender.ts";
import { serve } from "../_runtime/serve.ts";
import Stripe from "stripe";
import { createClient } from "@matbex/client";
import { Resend } from "resend";

import { buildCorsHeaders } from "../_shared/cors.ts";
const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[COMPLETE-REGISTRATION-PAYMENT] ${step}${detailsStr}`);
};

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const { session_id } = await req.json();
    
    if (!session_id) {
      throw new Error("Missing session_id");
    }

    logStep("Verifying session", { session_id });

    const stripeKey = env("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const dbAdmin = createClient(
      env("API_URL") ?? "",
      env("SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Retrieve the checkout session
    const session = await stripe.checkout.sessions.retrieve(session_id);
    logStep("Session retrieved", { 
      status: session.status, 
      payment_status: session.payment_status,
      application_id: session.metadata?.application_id 
    });

    if (session.status !== "complete" || session.payment_status !== "paid") {
      return new Response(JSON.stringify({ 
        success: false, 
        error: "Payment not completed",
        status: session.status,
        payment_status: session.payment_status,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const applicationId = session.metadata?.application_id;
    if (!applicationId) {
      throw new Error("Application ID not found in session metadata");
    }

    // Fetch the application
    const { data: application, error: appError } = await dbAdmin
      .from("tenant_applications")
      .select("*")
      .eq("id", applicationId)
      .single();

    if (appError || !application) {
      throw new Error("Application not found");
    }

    // Check if already processed
    if (application.status === "approved" && application.user_id) {
      logStep("Application already processed", { applicationId });
      return new Response(JSON.stringify({ 
        success: true, 
        already_processed: true,
        message: "Account already created. Check your email for credentials."
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    logStep("Creating tenant and user", { applicationId, email: application.email });

    // Generate secure temporary password
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
    let tempPassword = "";
    for (let i = 0; i < 16; i++) {
      tempPassword += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    // Create tenant
    const { data: tenant, error: tenantError } = await dbAdmin
      .from('tenants')
      .insert({
        name: application.company_name,
        slug: application.company_name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
        status: 'active',
        plan_id: application.plan_id,
      })
      .select()
      .single();

    if (tenantError) throw new Error(`Failed to create tenant: ${tenantError.message}`);
    logStep("Tenant created", { tenantId: tenant.id });

    // Create restaurant
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
    logStep("Restaurant created", { restaurantId: restaurant.id });

    // Create user account
    const { data: authData, error: createUserError } = await dbAdmin.auth.admin.createUser({
      email: application.email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        full_name: application.full_name,
      },
    });

    if (createUserError) throw new Error(`Failed to create user: ${createUserError.message}`);
    const userId = authData.user?.id;
    logStep("User created", { userId });

    if (userId) {
      // on_auth_user_created already inserted a bare profile row; fill in tenant + restaurant.
      const { error: profileError } = await dbAdmin.from('profiles').upsert({
        id: userId,
        full_name: application.full_name,
        tenant_id: tenant.id,
        restaurant_id: restaurant.id,
      }, { onConflict: 'id' });
      if (profileError) throw new Error(`Failed to set up profile: ${profileError.message}`);

      // Assign owner role in user_tenant_roles
      await dbAdmin.from('user_tenant_roles').insert({
        user_id: userId,
        tenant_id: tenant.id,
        role: 'owner',
      });

      // Assign owner role in user_roles (legacy)
      await dbAdmin.from('user_roles').insert({
        user_id: userId,
        restaurant_id: restaurant.id,
        role: 'owner',
      });

      logStep("Roles assigned");
    }

    // Update application. temporary_password was dropped (20260524101720: no plaintext
    // passwords at rest); the password only goes out in the welcome email below.
    const { error: appUpdateError } = await dbAdmin
      .from('tenant_applications')
      .update({
        status: 'approved',
        payment_status: 'paid',
        paid_at: new Date().toISOString(),
        tenant_id: tenant.id,
        user_id: userId,
      })
      .eq('id', applicationId);
    if (appUpdateError) throw new Error(`Tenant provisioned but application not marked approved: ${appUpdateError.message}`);

    logStep("Application updated to approved");

    // Send welcome credentials email
    const resend = new Resend(env("RESEND_API_KEY"));
    const siteUrl = env('SITE_URL') || 'https://matbex.com';

    await resend.emails.send({
      from: fromAddress("Matbex", "onboarding"),
      to: [application.email],
      subject: `🚀 Welcome to Matbex, ${application.full_name}! Your credentials are ready`,
      html: generateWelcomeEmail(
        application.full_name, 
        application.email, 
        application.company_name, 
        tempPassword, 
        siteUrl
      ),
    });

    // Update credentials_sent_at
    await dbAdmin
      .from('tenant_applications')
      .update({ credentials_sent_at: new Date().toISOString() })
      .eq('id', applicationId);

    logStep("Welcome email sent with credentials");

    return new Response(JSON.stringify({ 
      success: true,
      message: "Account created successfully! Check your email for login credentials.",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage, success: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

function generateWelcomeEmail(
  fullName: string, 
  email: string, 
  companyName: string, 
  tempPassword: string, 
  siteUrl: string
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
    .credentials-box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; margin-bottom: 32px; }
    .credential-row { padding: 12px 0; border-bottom: 1px solid #e5e7eb; }
    .credential-row:last-child { border-bottom: none; }
    .credential-label { color: #6b7280; font-size: 14px; font-weight: 500; margin-bottom: 4px; }
    .credential-value { color: #1f2937; font-size: 14px; font-weight: 600; font-family: ui-monospace, monospace; }
    .password-box { background: #fef3c7; border: 1px solid #fbbf24; border-radius: 8px; padding: 16px; margin-top: 16px; }
    .password-label { color: #92400e; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
    .password-value { color: #1f2937; font-size: 20px; font-weight: 700; font-family: ui-monospace, monospace; letter-spacing: 2px; }
    .button-wrapper { text-align: center; margin: 32px 0; }
    .button { display: inline-block; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #ffffff !important; font-size: 16px; font-weight: 600; text-decoration: none; padding: 14px 40px; border-radius: 8px; }
    .security-notice { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 24px; }
    .security-notice p { color: #991b1b; font-size: 14px; margin: 0; }
    .next-steps { background: #ecfdf5; border-radius: 12px; padding: 24px; margin-top: 24px; }
    .next-steps h3 { color: #065f46; font-size: 16px; margin: 0 0 16px 0; }
    .next-steps ol { color: #047857; font-size: 14px; margin: 0; padding-left: 20px; }
    .next-steps li { margin-bottom: 8px; }
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
      <h1>Welcome to the Pulse! 🚀</h1>
      <p class="subtitle">Your account for <strong>${companyName}</strong> is ready.</p>
      
      <div class="credentials-box">
        <p style="color: #1f2937; font-weight: 600; margin: 0 0 16px 0;">Your Login Credentials</p>
        
        <div class="credential-row">
          <p class="credential-label">Email</p>
          <p class="credential-value">${email}</p>
        </div>
        
        <div class="password-box">
          <p class="password-label">Temporary Password</p>
          <p class="password-value">${tempPassword}</p>
        </div>
      </div>
      
      <div class="security-notice">
        <p>⚠️ For security, you must change your password upon first login.</p>
      </div>
      
      <div class="button-wrapper">
        <a href="${siteUrl}/auth" class="button">Access Your Dashboard</a>
      </div>
      
      <div class="next-steps">
        <h3>📋 Next Steps: The First Shift</h3>
        <ol>
          <li>Log in with your temporary password</li>
          <li>Set a new secure password</li>
          <li>Configure your shift templates</li>
          <li>Invite your team members</li>
          <li>Start recording your first shift!</li>
        </ol>
      </div>
      
      <hr>
      
      <p style="color: #6b7280; font-size: 14px; text-align: center;">
        Questions? Reply to this email or visit our help center.
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
