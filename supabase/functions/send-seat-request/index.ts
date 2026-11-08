import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

import { buildCorsHeaders } from "../_shared/cors.ts";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

interface SeatRequestBody {
  tenant_id: string;
  restaurant_id?: string;
  restaurant_name?: string;
  quota_type: string;
  current_usage: number;
  quota_limit: number;
  requested_role?: string;
  requester_email?: string;
  requester_name?: string;
}

const handler = async (req: Request): Promise<Response> => {
  const corsHeaders = buildCorsHeaders(req);
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate the caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const token = authHeader.replace(/^Bearer\s+/i, "");
    const supabaseClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);
    const { data: { user: caller }, error: authError } = await supabaseClient.auth.getUser(token);
    if (authError || !caller) {
      return new Response(
        JSON.stringify({ error: "Invalid authentication token" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Create admin client for privileged operations
    const supabaseAdmin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Parse request body
    const {
      tenant_id,
      restaurant_id,
      restaurant_name,
      quota_type,
      current_usage,
      quota_limit,
      requested_role,
      requester_email,
      requester_name,
    }: SeatRequestBody = await req.json();

    if (!tenant_id || !quota_type) {
      return new Response(
        JSON.stringify({ error: "tenant_id and quota_type are required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Fetch tenant owners
    const { data: ownerData, error: ownerError } = await supabaseAdmin.rpc(
      "get_tenant_owner_emails",
      { p_tenant_id: tenant_id }
    );

    if (ownerError) {
      console.error("Error fetching owners:", ownerError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch tenant owners" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const ownerEmails = (ownerData || [])
      .map((row: any) => row.email)
      .filter(Boolean);

    if (ownerEmails.length === 0) {
      return new Response(
        JSON.stringify({ error: "No tenant owners found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Build email content
    const quotaLabel = quota_type === "users" ? "Team Seats" : quota_type;
    const usagePercent = quota_limit > 0 
      ? Math.round((current_usage / quota_limit) * 100) 
      : 0;
    
    const requester = requester_name || requester_email || caller.email || "A team member";
    const restaurant = restaurant_name || "your restaurant";

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; margin: 0; padding: 40px 20px; }
          .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
          .header { background: linear-gradient(135deg, #00A859 0%, #008f4c 100%); color: white; padding: 32px; text-align: center; }
          .header h1 { margin: 0; font-size: 22px; font-weight: 600; }
          .header p { margin: 8px 0 0; opacity: 0.9; font-size: 14px; }
          .content { padding: 32px; }
          .alert { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin: 20px 0; }
          .alert-title { color: #dc2626; font-weight: 600; font-size: 14px; margin: 0 0 8px; }
          .alert-text { color: #7f1d1d; font-size: 14px; margin: 0; }
          .details { background: #f8fafc; border-radius: 8px; padding: 20px; margin: 20px 0; }
          .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
          .detail-row:last-child { border-bottom: none; }
          .detail-label { color: #64748b; font-size: 14px; }
          .detail-value { color: #0f172a; font-weight: 500; font-size: 14px; }
          .cta { text-align: center; margin: 24px 0; }
          .cta-button { display: inline-block; background: #00A859; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 500; font-size: 14px; }
          .footer { padding: 20px 32px; background: #f8fafc; text-align: center; font-size: 12px; color: #94a3b8; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Seat Limit Reached</h1>
            <p>A team member is requesting additional capacity</p>
          </div>
          
          <div class="content">
            <p style="color: #334155; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
              <strong>${requester}</strong> tried to invite a new team member to <strong>${restaurant}</strong> but the quota has been reached.
            </p>
            
            <div class="alert">
              <p class="alert-title">Quota Exceeded</p>
              <p class="alert-text">
                ${quotaLabel}: ${current_usage} / ${quota_limit} seats used (${usagePercent}% capacity)
                ${requested_role ? `<br>Requested role: ${requested_role}` : ""}
              </p>
            </div>
            
            <div class="details">
              <div class="detail-row">
                <span class="detail-label">Quota Type</span>
                <span class="detail-value">${quotaLabel}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Current Usage</span>
                <span class="detail-value">${current_usage} seats</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Limit</span>
                <span class="detail-value">${quota_limit} seats</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Utilization</span>
                <span class="detail-value" style="color: ${usagePercent >= 100 ? '#dc2626' : '#00A859'};">${usagePercent}%</span>
              </div>
              ${requested_role ? `
              <div class="detail-row">
                <span class="detail-label">Requested Role</span>
                <span class="detail-value">${requested_role}</span>
              </div>
              ` : ""}
            </div>
            
            <div class="cta">
              <a href="https://matbex.com/billing" class="cta-button">Review Billing Plan</a>
            </div>
            
            <p style="color: #64748b; font-size: 14px; line-height: 1.6; margin: 20px 0 0;">
              To resolve this, you can either upgrade your plan for more seats or remove inactive team members from the <a href="https://matbex.com/team" style="color: #00A859;">Team page</a>.
            </p>
          </div>
          
          <div class="footer">
            This request was automatically generated by Matbex.
          </div>
        </div>
      </body>
      </html>
    `;

    // Send email via Resend
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Matbex <noreply@matbex.com>",
        to: ownerEmails,
        subject: `Seat limit reached: ${current_usage}/${quota_limit} ${quotaLabel} used - action needed`,
        html: emailHtml,
      }),
    });

    if (!emailResponse.ok) {
      const errorData = await emailResponse.json().catch(() => ({}));
      console.error("Resend error:", errorData);
      return new Response(
        JSON.stringify({ error: "Failed to send email" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Log the request
    await supabaseAdmin.from("seat_requests").insert({
      tenant_id,
      restaurant_id: restaurant_id || null,
      requested_by: caller.id,
      requester_email: requester_email || caller.email,
      quota_type,
      current_usage,
      quota_limit,
      requested_role: requested_role || null,
      owner_emails: ownerEmails,
      status: "sent",
      sent_at: new Date().toISOString(),
    });

    return new Response(
      JSON.stringify({ success: true, message: "Request sent to admins" }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in send-seat-request:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
