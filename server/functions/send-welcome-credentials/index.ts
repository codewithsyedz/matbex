import { env } from "../_runtime/env.ts";
import { fromAddress } from "../_shared/sender.ts";
import { serve } from "../_runtime/serve.ts";
import { createClient } from "@matbex/client";

import { buildCorsHeaders } from "../_shared/cors.ts";
const Resend = (await import("resend")).Resend;
const resend = new Resend(env("RESEND_API_KEY"));

interface WelcomeCredentialsRequest {
  email: string;
  full_name: string;
  company_name: string;
  temporary_password: string;
  login_url: string;
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const body: WelcomeCredentialsRequest = await req.json();
    const { email, full_name, company_name, temporary_password, login_url } = body;

    console.log(`Sending welcome credentials to ${email}`);

    // Build the email HTML
    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
      background: linear-gradient(135deg, #f0fdf4 0%, #f6f9fc 100%); 
      padding: 40px 20px; 
      margin: 0; 
    }
    .container { 
      max-width: 600px; 
      margin: 0 auto; 
      background: #ffffff; 
      border-radius: 16px; 
      overflow: hidden; 
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
    }
    .header { 
      background: linear-gradient(135deg, #10b981 0%, #059669 100%); 
      padding: 40px 32px; 
      text-align: center; 
    }
    .logo { 
      font-size: 32px; 
      font-weight: 300; 
      color: #ffffff; 
      margin: 0; 
      letter-spacing: -0.5px;
    }
    .logo strong { font-weight: 700; }
    .content { padding: 40px 32px; }
    h1 { 
      color: #1f2937; 
      font-size: 24px; 
      font-weight: 600; 
      text-align: center; 
      margin: 0 0 8px 0; 
    }
    .subtitle { 
      color: #6b7280; 
      text-align: center; 
      margin: 0 0 32px 0; 
      font-size: 16px;
    }
    .credentials-box { 
      background: #f9fafb; 
      border: 1px solid #e5e7eb; 
      border-radius: 12px; 
      padding: 24px; 
      margin-bottom: 32px;
    }
    .credential-row { 
      display: flex; 
      justify-content: space-between; 
      align-items: center; 
      padding: 12px 0; 
      border-bottom: 1px solid #e5e7eb; 
    }
    .credential-row:last-child { border-bottom: none; }
    .credential-label { 
      color: #6b7280; 
      font-size: 14px; 
      font-weight: 500; 
    }
    .credential-value { 
      color: #1f2937; 
      font-size: 14px; 
      font-weight: 600; 
      font-family: ui-monospace, monospace;
    }
    .password-box {
      background: #fef3c7;
      border: 1px solid #fbbf24;
      border-radius: 8px;
      padding: 16px;
      margin-top: 16px;
    }
    .password-label {
      color: #92400e;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }
    .password-value {
      color: #1f2937;
      font-size: 20px;
      font-weight: 700;
      font-family: ui-monospace, monospace;
      letter-spacing: 2px;
    }
    .button-wrapper { text-align: center; margin: 32px 0; }
    .button { 
      display: inline-block; 
      background: linear-gradient(135deg, #10b981 0%, #059669 100%); 
      color: #ffffff !important; 
      font-size: 16px; 
      font-weight: 600; 
      text-decoration: none; 
      padding: 14px 40px; 
      border-radius: 8px; 
    }
    .security-notice {
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 24px;
    }
    .security-notice p {
      color: #991b1b;
      font-size: 14px;
      margin: 0;
    }
    .next-steps { 
      background: #ecfdf5; 
      border-radius: 12px; 
      padding: 24px; 
      margin-top: 24px;
    }
    .next-steps h3 { 
      color: #065f46; 
      font-size: 16px; 
      margin: 0 0 16px 0; 
    }
    .next-steps ol { 
      color: #047857; 
      font-size: 14px; 
      margin: 0; 
      padding-left: 20px; 
    }
    .next-steps li { margin-bottom: 8px; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 32px 0; }
    .footer { 
      text-align: center; 
      padding: 24px 32px; 
      background: #f9fafb; 
    }
    .footer p { 
      color: #9ca3af; 
      font-size: 12px; 
      margin: 4px 0; 
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <p class="logo">Matbex<strong>OS</strong></p>
    </div>
    <div class="content">
      <h1>Welcome to the Pulse! 🎉</h1>
      <p class="subtitle">Your application for <strong>${company_name}</strong> has been approved.</p>
      
      <div class="credentials-box">
        <p style="color: #1f2937; font-weight: 600; margin: 0 0 16px 0;">Your Login Credentials</p>
        
        <div class="credential-row">
          <span class="credential-label">Email</span>
          <span class="credential-value">${email}</span>
        </div>
        
        <div class="password-box">
          <p class="password-label">Temporary Password</p>
          <p class="password-value">${temporary_password}</p>
        </div>
      </div>
      
      <div class="security-notice">
        <p>⚠️ For security, you must change your password upon first login.</p>
      </div>
      
      <div class="button-wrapper">
        <a href="${login_url}" class="button">Access Your Dashboard</a>
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

    // Send email via Resend
    const emailResponse = await resend.emails.send({
      from: fromAddress("Matbex", "welcome"),
      to: [email],
      subject: `🎉 Welcome to Matbex, ${full_name}! Your credentials are ready`,
      html: emailHtml,
    });

    console.log('Welcome email sent successfully:', emailResponse);

    return new Response(JSON.stringify({ success: true, data: emailResponse }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (error: any) {
    console.error('Error in send-welcome-credentials function:', error);
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
