import { env } from "../_runtime/env.ts";
import { serve } from "../_runtime/serve.ts";

import { buildCorsHeaders } from "../_shared/cors.ts";
const Resend = (await import("resend")).Resend;
const resend = new Resend(env("RESEND_API_KEY"));

interface AuthEmailRequest {
  user: { email: string };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: string;
    site_url: string;
  };
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const emailData: AuthEmailRequest = await req.json();

    const {
      user,
      email_data: { token, token_hash, redirect_to, email_action_type },
    } = emailData;

    console.log(`Processing ${email_action_type} email for ${user.email}`);

    const apiUrl = env("API_URL") ?? '';
    const verifyUrl = `${apiUrl}/auth/v1/verify?token=${token_hash}&type=${email_action_type}&redirect_to=${redirect_to}`;

    // Get subject and content based on action type
    const getEmailContent = () => {
      switch (email_action_type) {
        case 'signup':
        case 'email':
          return {
            subject: 'Verify your email - Matbex',
            title: 'Welcome to Matbex!',
            description: 'Thank you for signing up for Matbex. Please verify your email address to get started with managing your restaurant operations.',
            actionText: 'Verify Email',
          };
        case 'recovery':
          return {
            subject: 'Reset your password - Matbex',
            title: 'Reset Your Password',
            description: 'We received a request to reset your password. Click the button below to create a new password.',
            actionText: 'Reset Password',
          };
        case 'email_change':
          return {
            subject: 'Confirm email change - Matbex',
            title: 'Confirm Your New Email',
            description: 'You requested to change your email address. Please confirm this change by clicking the button below.',
            actionText: 'Confirm Email Change',
          };
        case 'magiclink':
          return {
            subject: 'Your login link - Matbex',
            title: 'Sign In to Matbex',
            description: 'Click the button below to sign in to your Matbex account.',
            actionText: 'Sign In',
          };
        default:
          return {
            subject: 'Action required - Matbex',
            title: 'Action Required',
            description: 'Please click the button below to complete your action.',
            actionText: 'Confirm',
          };
      }
    };

    const { subject, title, description, actionText } = getEmailContent();

    // Build email HTML
    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f6f9fc; padding: 40px 20px; margin: 0; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; }
    .logo { text-align: center; padding: 32px 0; }
    .logo-text { font-size: 28px; font-weight: bold; color: #10b981; margin: 0; }
    .content { padding: 0 40px 40px; }
    h1 { color: #1f2937; font-size: 24px; font-weight: 600; text-align: center; margin-bottom: 24px; }
    p { color: #374151; font-size: 16px; line-height: 1.5; margin-bottom: 16px; }
    .button-wrapper { text-align: center; margin: 32px 0; }
    .button { display: inline-block; background: #10b981; color: #ffffff !important; font-size: 16px; font-weight: 600; text-decoration: none; padding: 12px 32px; border-radius: 6px; }
    .link-text { color: #6b7280; font-size: 14px; margin-bottom: 8px; }
    .link { color: #10b981; font-size: 12px; word-break: break-all; }
    .code-wrapper { text-align: center; margin: 24px 0; }
    .code { display: inline-block; background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px 32px; font-size: 24px; font-weight: bold; letter-spacing: 4px; color: #1f2937; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 32px 0; }
    .footer { color: #9ca3af; font-size: 12px; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <p class="logo-text">Matbex</p>
    </div>
    <div class="content">
      <h1>${title}</h1>
      <p>Hi${user.email ? ` ${user.email}` : ''},</p>
      <p>${description}</p>
      <div class="button-wrapper">
        <a href="${verifyUrl}" class="button">${actionText}</a>
      </div>
      <p class="link-text">Or copy and paste this link in your browser:</p>
      <p class="link">${verifyUrl}</p>
      ${token ? `
        <p class="link-text">Your verification code:</p>
        <div class="code-wrapper">
          <span class="code">${token}</span>
        </div>
      ` : ''}
      <hr>
      <p class="footer">If you didn't request this email, you can safely ignore it.</p>
      <p class="footer">© ${new Date().getFullYear()} Matbex. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;

    // Send email via Resend
    const emailResponse = await resend.emails.send({
      from: 'Matbex <noreply@matbex.com>',
      to: [user.email],
      subject,
      html: emailHtml,
    });

    console.log('Email sent successfully:', emailResponse);

    return new Response(JSON.stringify({ success: true, data: emailResponse }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (error: any) {
    console.error('Error in send-auth-email function:', error);
    return new Response(
      JSON.stringify({
        error: {
          http_code: error.code || 500,
          message: error.message,
        },
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  }
});
