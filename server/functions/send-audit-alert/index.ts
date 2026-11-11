import { env } from "../_runtime/env.ts";
import { fromAddress } from "../_shared/sender.ts";
import { serve } from "../_runtime/serve.ts";
import { createClient } from "@matbex/client";

import { buildCorsHeaders } from "../_shared/cors.ts";
const Resend = (await import("resend")).Resend;

// Web Push library for sending push notifications
// @ts-ignore - Deno import
import webpush from "web-push";

// Critical actions that can trigger alerts
const CRITICAL_ACTIONS = [
  "SHIFT_TIMESTAMP_OVERRIDE",
  "DELETE",
  "BULK_DELETE",
  "USER_ROLE_CHANGE",
  "SETTINGS_CHANGE",
  "DATA_EXPORT",
  "PERMISSION_CHANGE",
];

// Map actions to preference column names
const ACTION_TO_PREFERENCE: Record<string, string> = {
  "SHIFT_TIMESTAMP_OVERRIDE": "notify_shift_timestamp_override",
  "DELETE": "notify_delete",
  "BULK_DELETE": "notify_bulk_delete",
  "USER_ROLE_CHANGE": "notify_user_role_change",
  "SETTINGS_CHANGE": "notify_settings_change",
  "DATA_EXPORT": "notify_data_export",
  "PERMISSION_CHANGE": "notify_permission_change",
};

interface AuditAlertRequest {
  audit_log_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  user_id: string;
  tenant_id: string;
  old_data?: Record<string, unknown>;
  new_data?: Record<string, unknown>;
}

const formatAction = (action: string): string => {
  return action.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
};

const handler = async (req: Request): Promise<Response> => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const resendApiKey = env("RESEND_API_KEY");
    if (!resendApiKey) {
      throw new Error("RESEND_API_KEY not configured");
    }

    const resend = new Resend(resendApiKey);
    const apiUrl = env("API_URL")!;
    const apiKey = env("SERVICE_ROLE_KEY")!;
    const db = createClient(apiUrl, apiKey);

    const payload: AuditAlertRequest = await req.json();
    const { audit_log_id, action, entity_type, entity_id, user_id, tenant_id, old_data, new_data } = payload;

    console.log(`Processing audit alert for action: ${action}, entity: ${entity_type}`);

    if (!CRITICAL_ACTIONS.includes(action)) {
      return new Response(
        JSON.stringify({ success: true, message: "Non-critical action" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get actor info
    const { data: actorProfile } = await db
      .from("profiles")
      .select("full_name, email")
      .eq("id", user_id)
      .single();

    const actorName = actorProfile?.full_name || actorProfile?.email || "Unknown user";

    // Get tenant name
    const { data: tenant } = await db
      .from("tenants")
      .select("name")
      .eq("id", tenant_id)
      .single();

    const tenantName = tenant?.name || "Your organization";

    // Get owner IDs
    const { data: ownerRoles } = await db
      .from("user_tenant_roles")
      .select("user_id")
      .eq("tenant_id", tenant_id)
      .eq("role", "owner");

    if (!ownerRoles || ownerRoles.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No owners to notify" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ownerIds = ownerRoles.map(r => r.user_id);

    // Get notification preferences for each owner
    const { data: preferences } = await db
      .from("notification_preferences")
      .select("*")
      .eq("tenant_id", tenant_id)
      .in("user_id", ownerIds);

    const preferencesMap = new Map<string, Record<string, any>>((preferences || []).map((p: Record<string, any>) => [p.user_id, p]));
    const preferenceColumn = ACTION_TO_PREFERENCE[action];

    // Process each owner
    const instantEmailRecipients: string[] = [];
    const digestOwners: string[] = [];
    const inAppOnlyOwners: string[] = [];

    for (const ownerId of ownerIds) {
      if (ownerId === user_id) continue; // Skip actor

      const prefs = preferencesMap.get(ownerId);
      
      // Check if this action is enabled for this user
      if (prefs && preferenceColumn && prefs[preferenceColumn] === false) {
        continue;
      }

      // Determine notification mode
      const mode = prefs?.notification_mode || "instant";
      const inAppEnabled = prefs?.in_app_enabled !== false;

      // Create in-app notification if enabled
      if (inAppEnabled) {
        await db.from("in_app_notifications").insert({
          user_id: ownerId,
          tenant_id,
          title: `${formatAction(action)}`,
          message: `${actorName} performed ${formatAction(action).toLowerCase()} on ${entity_type}`,
          action_type: action,
          entity_type,
          entity_id,
          metadata: { actor_name: actorName, old_data, new_data },
        });
      }

      // Handle based on notification mode
      if (mode === "instant" && prefs?.email_enabled !== false) {
        const { data: profile } = await db
          .from("profiles")
          .select("email")
          .eq("id", ownerId)
          .single();
        
        if (profile?.email) {
          instantEmailRecipients.push(profile.email);
        }
      } else if (mode === "digest") {
        // Store for weekly digest
        await db.from("pending_digest_notifications").insert({
          user_id: ownerId,
          tenant_id,
          audit_log_id,
          action,
          entity_type,
          entity_id,
          actor_name: actorName,
          old_data,
          new_data,
        });
        digestOwners.push(ownerId);
      }
    }

    // Send instant emails if any
    if (instantEmailRecipients.length > 0) {
      const formatChanges = (oldData: Record<string, unknown> | undefined, newData: Record<string, unknown> | undefined): string => {
        if (!oldData && !newData) return "<p>No details available</p>";

        let html = "<table style='width: 100%; border-collapse: collapse; margin-top: 10px;'>";
        html += "<tr><th style='text-align: left; padding: 8px; border-bottom: 1px solid #e5e7eb; color: #6b7280;'>Field</th>";
        html += "<th style='text-align: left; padding: 8px; border-bottom: 1px solid #e5e7eb; color: #6b7280;'>Before</th>";
        html += "<th style='text-align: left; padding: 8px; border-bottom: 1px solid #e5e7eb; color: #6b7280;'>After</th></tr>";

        const allKeys = new Set([...Object.keys(oldData || {}), ...Object.keys(newData || {})]);

        for (const key of allKeys) {
          const oldVal = oldData?.[key];
          const newVal = newData?.[key];
          if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
            html += `<tr>`;
            html += `<td style='padding: 8px; border-bottom: 1px solid #f3f4f6;'>${key.replace(/_/g, " ")}</td>`;
            html += `<td style='padding: 8px; border-bottom: 1px solid #f3f4f6; color: #ef4444;'>${oldVal !== undefined ? String(oldVal) : "-"}</td>`;
            html += `<td style='padding: 8px; border-bottom: 1px solid #f3f4f6; color: #22c55e;'>${newVal !== undefined ? String(newVal) : "-"}</td>`;
            html += `</tr>`;
          }
        }
        html += "</table>";
        return html;
      };

      const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px; }
            .container { max-width: 600px; margin: 0 auto; background-color: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
            .header { background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); color: white; padding: 24px 30px; }
            .header h1 { margin: 0; font-size: 20px; font-weight: 600; }
            .header p { margin: 8px 0 0; opacity: 0.9; font-size: 14px; }
            .alert-badge { display: inline-block; background: rgba(255,255,255,0.2); padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 500; margin-top: 12px; }
            .content { padding: 30px; }
            .info-row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f3f4f6; }
            .info-label { color: #6b7280; font-size: 14px; }
            .info-value { color: #1f2937; font-size: 14px; font-weight: 500; }
            .section { margin-top: 24px; }
            .section-title { font-size: 14px; font-weight: 600; color: #1f2937; margin-bottom: 12px; }
            .changes-box { background: #f8fafc; border-radius: 8px; padding: 16px; }
            .footer { padding: 20px 30px; background: #f8fafc; text-align: center; font-size: 12px; color: #6b7280; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>⚠️ Critical Audit Event</h1>
              <p>A security-sensitive action was performed in ${tenantName}</p>
              <span class="alert-badge">${formatAction(action)}</span>
            </div>
            <div class="content">
              <div class="info-row">
                <span class="info-label">Performed by</span>
                <span class="info-value">${actorName}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Action</span>
                <span class="info-value">${formatAction(action)}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Entity Type</span>
                <span class="info-value">${entity_type}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Timestamp</span>
                <span class="info-value">${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</span>
              </div>
              <div class="section">
                <div class="section-title">📋 Changes Made</div>
                <div class="changes-box">${formatChanges(old_data, new_data)}</div>
              </div>
            </div>
            <div class="footer">
              <p>This is an automated security alert from Matbex.</p>
              <p>Manage preferences in Settings → Notifications.</p>
            </div>
          </div>
        </body>
        </html>
      `;

      await resend.emails.send({
        from: fromAddress("Matbex Alerts", "alerts"),
        to: instantEmailRecipients,
        subject: `⚠️ Security Alert: ${formatAction(action)} on ${entity_type} | ${tenantName}`,
        html: emailHtml,
      });

      console.log(`Instant email sent to: ${instantEmailRecipients.join(", ")}`);
    }

    // Send push notifications
    const vapidPublicKey = env("VAPID_PUBLIC_KEY");
    const vapidPrivateKey = env("VAPID_PRIVATE_KEY");
    
    if (vapidPublicKey && vapidPrivateKey) {
      webpush.setVapidDetails(
        "mailto:alerts@matbex.app",
        vapidPublicKey,
        vapidPrivateKey
      );

      // Get push subscriptions for owners who have push enabled
      const { data: pushSubs } = await db
        .from("push_subscriptions")
        .select("endpoint, p256dh_key, auth_key, user_id")
        .in("user_id", ownerIds.filter(id => id !== user_id))
        .eq("is_active", true);

      if (pushSubs && pushSubs.length > 0) {
        // Check which users have push enabled in their preferences
        const usersWithPush = new Set(
          (preferences || [])
            .filter(p => p.push_enabled)
            .map(p => p.user_id)
        );

        for (const sub of pushSubs) {
          if (!usersWithPush.has(sub.user_id)) continue;

          try {
            await webpush.sendNotification(
              {
                endpoint: sub.endpoint,
                keys: {
                  p256dh: sub.p256dh_key,
                  auth: sub.auth_key,
                },
              },
              JSON.stringify({
                title: `⚠️ ${formatAction(action)}`,
                body: `${actorName} performed ${formatAction(action).toLowerCase()} on ${entity_type}`,
                icon: "/favicon.png",
                badge: "/favicon.png",
                data: { url: "/audit-logs", action, entity_type, entity_id },
              })
            );
            console.log(`Push notification sent to user ${sub.user_id}`);
          } catch (pushError) {
            console.error(`Failed to send push to ${sub.user_id}:`, pushError);
            
            // If subscription is invalid, mark as inactive
            if ((pushError as { statusCode?: number }).statusCode === 410) {
              await db
                .from("push_subscriptions")
                .update({ is_active: false })
                .eq("endpoint", sub.endpoint);
            }
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        instant_emails: instantEmailRecipients.length,
        digest_queued: digestOwners.length,
      }),
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
