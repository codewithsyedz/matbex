import { env } from "../_runtime/env.ts";
import { fromAddress } from "../_shared/sender.ts";
import { serve } from "../_runtime/serve.ts";
import { createClient } from "@matbex/client";

import { buildCorsHeaders } from "../_shared/cors.ts";
import { guardCronCaller } from "../_shared/cronGuard.ts";
const RESEND_API_KEY = env("RESEND_API_KEY");

interface ExpiringBatch {
  id: string;
  batch_number: string;
  expiry_date: string;
  quantity: number;
  inventory_items: { name: string; unit: string } | null;
  restaurants: { name: string; currency: string } | null;
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const unauthorized = await guardCronCaller(req, corsHeaders, { allowAnyUser: true });
  if (unauthorized) return unauthorized;

  try {
    const apiUrl = env("API_URL")!;
    const serviceRoleKey = env("SERVICE_ROLE_KEY")!;
    const db = createClient(apiUrl, serviceRoleKey);

    console.log("Starting expiry alert check...");

    // Get all restaurants with expiry alerts enabled
    const { data: settings, error: settingsError } = await db
      .from("inventory_settings")
      .select("*, restaurants(name, currency, status, suspended_at, paused_until)")
      .eq("expiry_alert_enabled", true);

    if (settingsError) {
      console.error("Error fetching settings:", settingsError);
      throw settingsError;
    }

    console.log(`Found ${settings?.length || 0} restaurants with expiry alerts enabled`);

    const results: { restaurant: string; batches: number; emailSent: boolean }[] = [];

    for (const setting of settings || []) {
      if (!setting.expiry_alert_email) {
        console.log(`Skipping restaurant ${setting.restaurant_id} - no alert email configured`);
        continue;
      }

      // Honour archived / suspended / temporarily-off branches.
      const r = (setting as any).restaurants;
      if (
        !r ||
        r.status !== "active" ||
        r.suspended_at ||
        (r.paused_until && new Date(r.paused_until).getTime() > Date.now())
      ) {
        console.log(`Skipping restaurant ${setting.restaurant_id} - branch not emailable`);
        continue;
      }

      const alertDays = setting.expiry_alert_days || 7;
      const alertDate = new Date();
      alertDate.setDate(alertDate.getDate() + alertDays);
      const alertDateStr = alertDate.toISOString().split("T")[0];

      // Get batches expiring within alert window that haven't been alerted yet
      const { data: batches, error: batchesError } = await db
        .from("inventory_batches")
        .select("*, inventory_items(name, unit), restaurants(name, currency)")
        .eq("restaurant_id", setting.restaurant_id)
        .eq("status", "active")
        .gt("quantity", 0)
        .lte("expiry_date", alertDateStr)
        .is("expiry_alert_sent_at", null);

      if (batchesError) {
        console.error(`Error fetching batches for ${setting.restaurant_id}:`, batchesError);
        continue;
      }

      if (!batches || batches.length === 0) {
        console.log(`No expiring batches found for restaurant ${setting.restaurant_id}`);
        results.push({ restaurant: setting.restaurant_id, batches: 0, emailSent: false });
        continue;
      }

      console.log(`Found ${batches.length} expiring batches for restaurant ${setting.restaurant_id}`);

      // Group by expiry status
      const today = new Date();
      const expired = batches.filter(b => new Date(b.expiry_date) < today);
      const expiringToday = batches.filter(b => {
        const expiry = new Date(b.expiry_date);
        return expiry.toDateString() === today.toDateString();
      });
      const expiringSoon = batches.filter(b => {
        const expiry = new Date(b.expiry_date);
        return expiry > today && expiry.toDateString() !== today.toDateString();
      });

      const restaurantName = (setting as any).restaurants?.name || "Your Restaurant";

      // Build email HTML
      const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f9fafb; padding: 40px 20px; }
    .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #dc2626 0%, #ef4444 100%); padding: 32px; text-align: center; }
    .header h1 { color: white; margin: 0; font-size: 24px; font-weight: 600; }
    .header p { color: rgba(255,255,255,0.9); margin: 8px 0 0; font-size: 14px; }
    .content { padding: 32px; }
    .section { margin-bottom: 24px; }
    .section-title { font-size: 14px; font-weight: 600; color: #374151; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
    .section-title.expired { color: #dc2626; }
    .section-title.today { color: #f59e0b; }
    .section-title.soon { color: #3b82f6; }
    .batch-list { background: #f9fafb; border-radius: 8px; padding: 16px; }
    .batch-item { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
    .batch-item:last-child { border-bottom: none; }
    .batch-name { font-weight: 500; color: #111827; }
    .batch-details { font-size: 13px; color: #6b7280; margin-top: 2px; }
    .batch-expiry { font-size: 13px; color: #6b7280; text-align: right; }
    .footer { text-align: center; padding: 24px; color: #9ca3af; font-size: 12px; border-top: 1px solid #e5e7eb; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>⚠️ Inventory Expiry Alert</h1>
      <p>${restaurantName} • ${batches.length} item(s) need attention</p>
    </div>
    <div class="content">
      ${expired.length > 0 ? `
        <div class="section">
          <div class="section-title expired">🔴 Expired Items (${expired.length})</div>
          <div class="batch-list">
            ${expired.map(b => `
              <div class="batch-item">
                <div>
                  <div class="batch-name">${b.inventory_items?.name}</div>
                  <div class="batch-details">Batch: ${b.batch_number} • Qty: ${b.quantity} ${b.inventory_items?.unit}</div>
                </div>
                <div class="batch-expiry">Expired ${b.expiry_date}</div>
              </div>
            `).join("")}
          </div>
        </div>
      ` : ""}
      ${expiringToday.length > 0 ? `
        <div class="section">
          <div class="section-title today">🟡 Expiring Today (${expiringToday.length})</div>
          <div class="batch-list">
            ${expiringToday.map(b => `
              <div class="batch-item">
                <div>
                  <div class="batch-name">${b.inventory_items?.name}</div>
                  <div class="batch-details">Batch: ${b.batch_number} • Qty: ${b.quantity} ${b.inventory_items?.unit}</div>
                </div>
                <div class="batch-expiry">Expires today</div>
              </div>
            `).join("")}
          </div>
        </div>
      ` : ""}
      ${expiringSoon.length > 0 ? `
        <div class="section">
          <div class="section-title soon">🔵 Expiring Soon (${expiringSoon.length})</div>
          <div class="batch-list">
            ${expiringSoon.map(b => {
              const days = Math.ceil((new Date(b.expiry_date).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
              return `
              <div class="batch-item">
                <div>
                  <div class="batch-name">${b.inventory_items?.name}</div>
                  <div class="batch-details">Batch: ${b.batch_number} • Qty: ${b.quantity} ${b.inventory_items?.unit}</div>
                </div>
                <div class="batch-expiry">${days} day(s) left</div>
              </div>
            `}).join("")}
          </div>
        </div>
      ` : ""}
      <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">
        Please review these items and take necessary action to minimize waste.
      </p>
    </div>
    <div class="footer">
      This is an automated alert from Matbex.
    </div>
  </div>
</body>
</html>`;

      // Send email via Resend REST API
      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: fromAddress("Matbex Alerts", "alerts"),
          to: [setting.expiry_alert_email],
          subject: `⚠️ ${batches.length} Inventory Item(s) Expiring Soon - ${restaurantName}`,
          html: emailHtml,
        }),
      });

      if (!emailRes.ok) {
        const emailError = await emailRes.text();
        console.error(`Error sending email for ${setting.restaurant_id}:`, emailError);
        results.push({ restaurant: setting.restaurant_id, batches: batches.length, emailSent: false });
        continue;
      }

      console.log(`Email sent successfully to ${setting.expiry_alert_email}`);

      // Mark batches as alerted
      const batchIds = batches.map(b => b.id);
      const { error: updateError } = await db
        .from("inventory_batches")
        .update({ expiry_alert_sent_at: new Date().toISOString() })
        .in("id", batchIds);

      if (updateError) {
        console.error(`Error updating batch alert status:`, updateError);
      }

      results.push({ restaurant: setting.restaurant_id, batches: batches.length, emailSent: true });
    }

    console.log("Expiry alert check completed", results);

    return new Response(JSON.stringify({ success: true, results }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error in send-expiry-alerts:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});
