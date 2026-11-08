import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

import { buildCorsHeaders } from "../_shared/cors.ts";
import { guardCronCaller } from "../_shared/cronGuard.ts";
const Resend = (await import("https://esm.sh/resend@2.0.0")).Resend;

const formatAction = (action: string): string => {
  return action.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
};

const handler = async (req: Request): Promise<Response> => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const unauthorized = await guardCronCaller(req, corsHeaders);
  if (unauthorized) return unauthorized;

  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      throw new Error("RESEND_API_KEY not configured");
    }

    const resend = new Resend(resendApiKey);
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get current day of week (0 = Sunday, 1 = Monday, etc.)
    const today = new Date().getDay();

    // Find users who want digest on this day
    const { data: digestPrefs, error: prefsError } = await supabase
      .from("notification_preferences")
      .select("user_id, tenant_id")
      .eq("notification_mode", "digest")
      .eq("digest_day", today)
      .eq("email_enabled", true);

    if (prefsError) {
      console.error("Error fetching digest preferences:", prefsError);
      throw prefsError;
    }

    if (!digestPrefs || digestPrefs.length === 0) {
      console.log("No users scheduled for digest today");
      return new Response(
        JSON.stringify({ success: true, message: "No digests to send today" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing ${digestPrefs.length} digest(s)`);

    let emailsSent = 0;

    for (const pref of digestPrefs) {
      // Get pending notifications for this user
      const { data: pendingItems, error: itemsError } = await supabase
        .from("pending_digest_notifications")
        .select("*")
        .eq("user_id", pref.user_id)
        .eq("included_in_digest", false)
        .order("created_at", { ascending: false });

      if (itemsError) {
        console.error(`Error fetching pending items for ${pref.user_id}:`, itemsError);
        continue;
      }

      if (!pendingItems || pendingItems.length === 0) {
        console.log(`No pending items for user ${pref.user_id}`);
        continue;
      }

      // Get user email
      const { data: profile } = await supabase
        .from("profiles")
        .select("email, full_name")
        .eq("id", pref.user_id)
        .single();

      if (!profile?.email) {
        console.log(`No email for user ${pref.user_id}`);
        continue;
      }

      // Get tenant name
      const { data: tenant } = await supabase
        .from("tenants")
        .select("name")
        .eq("id", pref.tenant_id)
        .single();

      const tenantName = tenant?.name || "Your organization";

      // Group items by action type
      const groupedItems: Record<string, typeof pendingItems> = {};
      for (const item of pendingItems) {
        if (!groupedItems[item.action]) {
          groupedItems[item.action] = [];
        }
        groupedItems[item.action].push(item);
      }

      // Build digest email
      const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px; }
            .container { max-width: 600px; margin: 0 auto; background-color: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
            .header { background: linear-gradient(135deg, #1a1a1a 0%, #333 100%); color: white; padding: 24px 30px; }
            .header h1 { margin: 0; font-size: 20px; font-weight: 600; }
            .header p { margin: 8px 0 0; opacity: 0.9; font-size: 14px; }
            .summary-badge { display: inline-block; background: rgba(255,255,255,0.2); padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 500; margin-top: 12px; }
            .content { padding: 30px; }
            .section { margin-bottom: 24px; }
            .section-title { font-size: 14px; font-weight: 600; color: #1f2937; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
            .section-count { background: #f3f4f6; padding: 2px 8px; border-radius: 10px; font-size: 12px; color: #6b7280; }
            .event-list { background: #f8fafc; border-radius: 8px; padding: 12px; }
            .event-item { padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
            .event-item:last-child { border-bottom: none; }
            .event-actor { font-weight: 500; color: #1f2937; }
            .event-entity { color: #6b7280; font-size: 13px; }
            .event-time { color: #9ca3af; font-size: 12px; margin-top: 4px; }
            .footer { padding: 20px 30px; background: #f8fafc; text-align: center; font-size: 12px; color: #6b7280; }
            .stats { display: flex; gap: 20px; margin-bottom: 20px; }
            .stat { flex: 1; background: #f8fafc; border-radius: 8px; padding: 16px; text-align: center; }
            .stat-value { font-size: 24px; font-weight: 600; color: #1f2937; }
            .stat-label { font-size: 12px; color: #6b7280; margin-top: 4px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📊 Weekly Security Digest</h1>
              <p>${tenantName}</p>
              <span class="summary-badge">${pendingItems.length} event${pendingItems.length !== 1 ? 's' : ''} this week</span>
            </div>
            
            <div class="content">
              <div class="stats">
                <div class="stat">
                  <div class="stat-value">${pendingItems.length}</div>
                  <div class="stat-label">Total Events</div>
                </div>
                <div class="stat">
                  <div class="stat-value">${Object.keys(groupedItems).length}</div>
                  <div class="stat-label">Event Types</div>
                </div>
              </div>

              ${Object.entries(groupedItems).map(([action, items]) => `
                <div class="section">
                  <div class="section-title">
                    ${formatAction(action)}
                    <span class="section-count">${items.length}</span>
                  </div>
                  <div class="event-list">
                    ${items.slice(0, 5).map(item => `
                      <div class="event-item">
                        <div class="event-actor">${item.actor_name || 'Unknown'}</div>
                        <div class="event-entity">${item.entity_type}${item.entity_id ? ` • ${item.entity_id.slice(0, 8)}...` : ''}</div>
                        <div class="event-time">${new Date(item.created_at).toLocaleString()}</div>
                      </div>
                    `).join('')}
                    ${items.length > 5 ? `<div class="event-item" style="color: #6b7280; font-size: 13px;">...and ${items.length - 5} more</div>` : ''}
                  </div>
                </div>
              `).join('')}
            </div>

            <div class="footer">
              <p>This is your weekly security digest from Matbex.</p>
              <p>View full details in your Audit Logs.</p>
            </div>
          </div>
        </body>
        </html>
      `;

      // Send digest email
      const { error: emailError } = await resend.emails.send({
        from: "Matbex Digest <reports@matbex.com>",
        to: [profile.email],
        subject: `📊 Weekly Security Digest: ${pendingItems.length} event${pendingItems.length !== 1 ? 's' : ''} | ${tenantName}`,
        html: emailHtml,
      });

      if (emailError) {
        console.error(`Error sending digest to ${profile.email}:`, emailError);
        continue;
      }

      // Mark items as included in digest
      const itemIds = pendingItems.map(i => i.id);
      await supabase
        .from("pending_digest_notifications")
        .update({ included_in_digest: true })
        .in("id", itemIds);

      emailsSent++;
      console.log(`Digest sent to ${profile.email} with ${pendingItems.length} items`);
    }

    return new Response(
      JSON.stringify({ success: true, emails_sent: emailsSent }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
