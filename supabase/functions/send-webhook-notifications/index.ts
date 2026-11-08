import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireSuperAdminOrCron } from "../_shared/superadmin.ts";

import { buildCorsHeaders } from "../_shared/cors.ts";
interface WebhookConfig {
  id: string;
  name: string;
  url: string;
  events: string[];
  secret: string | null;
  is_active: boolean;
}

interface Tenant {
  id: string;
  name: string;
  status: string;
  trial_ends_at: string | null;
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Reject anyone who is not the cron job or a SuperAdmin.
    await requireSuperAdminOrCron(req);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check for trial expiration warnings (3 days and 1 day before)
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const oneDayFromNow = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);

    // Fetch tenants with trials expiring soon
    const { data: expiringTrials } = await supabase
      .from("tenants")
      .select("id, name, status, trial_ends_at")
      .eq("status", "trial")
      .not("trial_ends_at", "is", null)
      .lte("trial_ends_at", threeDaysFromNow.toISOString())
      .gte("trial_ends_at", now.toISOString());

    // Fetch active webhook configs
    const { data: webhookConfigs } = await supabase
      .from("webhook_configs")
      .select("*")
      .eq("is_active", true);

    if (!webhookConfigs || webhookConfigs.length === 0) {
      return new Response(
        JSON.stringify({ message: "No active webhook configurations" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const deliveries: Array<{
      webhook_config_id: string;
      event_type: string;
      payload: Record<string, unknown>;
      response_status: number;
      response_body: string;
      success: boolean;
    }> = [];

    // Send trial expiration warnings
    for (const tenant of (expiringTrials || []) as Tenant[]) {
      const trialEndDate = new Date(tenant.trial_ends_at!);
      const daysRemaining = Math.ceil((trialEndDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

      const eventType = daysRemaining <= 1 ? "trial.expiring_tomorrow" : "trial.expiring_soon";

      for (const config of webhookConfigs as WebhookConfig[]) {
        if (!config.events.includes(eventType) && !config.events.includes("trial.*")) {
          continue;
        }

        const payload = {
          event: eventType,
          timestamp: now.toISOString(),
          data: {
            tenant_id: tenant.id,
            tenant_name: tenant.name,
            trial_ends_at: tenant.trial_ends_at,
            days_remaining: daysRemaining,
          },
        };

        try {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };

          if (config.secret) {
            const encoder = new TextEncoder();
            const key = await crypto.subtle.importKey(
              "raw",
              encoder.encode(config.secret),
              { name: "HMAC", hash: "SHA-256" },
              false,
              ["sign"]
            );
            const signature = await crypto.subtle.sign(
              "HMAC",
              key,
              encoder.encode(JSON.stringify(payload))
            );
            headers["X-Webhook-Signature"] = Array.from(new Uint8Array(signature))
              .map((b) => b.toString(16).padStart(2, "0"))
              .join("");
          }

          const response = await fetch(config.url, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
          });

          const responseBody = await response.text();

          deliveries.push({
            webhook_config_id: config.id,
            event_type: eventType,
            payload,
            response_status: response.status,
            response_body: responseBody.substring(0, 1000),
            success: response.ok,
          });
        } catch (error) {
          deliveries.push({
            webhook_config_id: config.id,
            event_type: eventType,
            payload,
            response_status: 0,
            response_body: error instanceof Error ? error.message : String(error),
            success: false,
          });
        }
      }
    }

    // Log all deliveries
    if (deliveries.length > 0) {
      await supabase.from("webhook_deliveries").insert(deliveries);
    }

    return new Response(
      JSON.stringify({
        message: "Webhook notifications processed",
        deliveries_count: deliveries.length,
        trials_checked: expiringTrials?.length || 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    if (error instanceof Response) {
      const body = await error.text();
      return new Response(body, {
        status: error.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.error("Error processing webhooks:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
