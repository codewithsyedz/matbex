import { env } from "../_runtime/env.ts";
import { fromAddress } from "../_shared/sender.ts";
import { serve } from "../_runtime/serve.ts";
import { createClient } from "@matbex/client";

import { buildCorsHeaders } from "../_shared/cors.ts";
import { guardCronCaller } from "../_shared/cronGuard.ts";
const RESEND_API_KEY = env("RESEND_API_KEY");

const apiUrl = env("API_URL")!;
const serviceRoleKey = env("SERVICE_ROLE_KEY")!;

interface ReportSchedule {
  id: string;
  restaurant_id: string;
  user_id: string;
  report_type: string;
  frequency: string;
  email: string;
  day_of_week: number | null;
  day_of_month: number | null;
  is_active: boolean;
  last_sent_at: string | null;
}

async function generateReportHTML(
  db: any,
  restaurantId: string,
  reportType: string,
  startDate: Date,
  endDate: Date
): Promise<string> {
  console.log(`Generating ${reportType} report for restaurant ${restaurantId}`);
  
  let salesTotal = 0;
  let expensesTotal = 0;
  let shiftsCount = 0;
  let salesData: any[] = [];
  let expensesData: any[] = [];
  let shiftsData: any[] = [];

  // Fetch restaurant info
  const { data: restaurant } = await db
    .from("restaurants")
    .select("name, currency")
    .eq("id", restaurantId)
    .single();

  const restaurantName = restaurant?.name || "Restaurant";
  const currency = restaurant?.currency || "SAR";

  if (reportType === "sales" || reportType === "full") {
    const { data } = await db
      .from("sales_transactions")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .gte("created_at", startDate.toISOString())
      .lte("created_at", endDate.toISOString());
    salesData = data || [];
    salesTotal = salesData.reduce((sum: number, s: any) => sum + Number(s.total), 0);
  }

  if (reportType === "expenses" || reportType === "full") {
    const { data } = await db
      .from("expenses")
      .select("*, expense_categories(name)")
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null)
      .gte("expense_date", startDate.toISOString().split("T")[0])
      .lte("expense_date", endDate.toISOString().split("T")[0]);
    expensesData = data || [];
    expensesTotal = expensesData.reduce((sum: number, e: any) => sum + Number(e.amount), 0);
  }

  if (reportType === "shifts" || reportType === "full") {
    const { data } = await db
      .from("shifts")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .gte("opened_at", startDate.toISOString())
      .lte("opened_at", endDate.toISOString());
    shiftsData = data || [];
    shiftsCount = shiftsData.length;
  }

  const formatDate = (date: Date) =>
    date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const netProfit = salesTotal - expensesTotal;
  const profitColor = netProfit >= 0 ? "#22c55e" : "#ef4444";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${reportType.charAt(0).toUpperCase() + reportType.slice(1)} Report - ${restaurantName}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #1e293b 0%, #334155 100%); color: white; padding: 30px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 600; }
    .header p { margin: 8px 0 0; opacity: 0.8; font-size: 14px; }
    .content { padding: 30px; }
    .kpi-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-bottom: 30px; }
    .kpi-card { background: #f8fafc; border-radius: 8px; padding: 20px; text-align: center; }
    .kpi-card h3 { margin: 0; font-size: 12px; text-transform: uppercase; color: #64748b; letter-spacing: 0.5px; }
    .kpi-card .value { font-size: 28px; font-weight: 700; color: #1e293b; margin-top: 8px; }
    .section { margin-bottom: 24px; }
    .section h2 { font-size: 14px; text-transform: uppercase; color: #64748b; margin: 0 0 12px; letter-spacing: 0.5px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 10px 8px; background: #f1f5f9; color: #475569; font-weight: 600; }
    td { padding: 10px 8px; border-bottom: 1px solid #e2e8f0; color: #334155; }
    .footer { text-align: center; padding: 20px; color: #94a3b8; font-size: 12px; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${restaurantName}</h1>
      <p>${reportType.charAt(0).toUpperCase() + reportType.slice(1)} Report: ${formatDate(startDate)} - ${formatDate(endDate)}</p>
    </div>
    <div class="content">
      <div class="kpi-grid">
        ${reportType === "sales" || reportType === "full" ? `
        <div class="kpi-card">
          <h3>Total Sales</h3>
          <div class="value">${salesTotal.toFixed(2)} ${currency}</div>
        </div>` : ""}
        ${reportType === "expenses" || reportType === "full" ? `
        <div class="kpi-card">
          <h3>Total Expenses</h3>
          <div class="value">${expensesTotal.toFixed(2)} ${currency}</div>
        </div>` : ""}
        ${reportType === "full" ? `
        <div class="kpi-card">
          <h3>Net Profit</h3>
          <div class="value" style="color: ${profitColor}">${netProfit.toFixed(2)} ${currency}</div>
        </div>` : ""}
        ${reportType === "shifts" || reportType === "full" ? `
        <div class="kpi-card">
          <h3>Total Shifts</h3>
          <div class="value">${shiftsCount}</div>
        </div>` : ""}
      </div>
      
      ${(reportType === "sales" || reportType === "full") && salesData.length > 0 ? `
      <div class="section">
        <h2>Recent Sales</h2>
        <table>
          <tr><th>Date</th><th>Payment</th><th>Amount</th></tr>
          ${salesData.slice(0, 10).map((s: any) => `
          <tr>
            <td>${new Date(s.created_at).toLocaleDateString()}</td>
            <td>${s.payment_method}</td>
            <td>${Number(s.total).toFixed(2)} ${currency}</td>
          </tr>`).join("")}
        </table>
      </div>` : ""}
      
      ${(reportType === "expenses" || reportType === "full") && expensesData.length > 0 ? `
      <div class="section">
        <h2>Recent Expenses</h2>
        <table>
          <tr><th>Date</th><th>Category</th><th>Amount</th></tr>
          ${expensesData.slice(0, 10).map((e: any) => `
          <tr>
            <td>${e.expense_date}</td>
            <td>${e.expense_categories?.name || "Uncategorized"}</td>
            <td>${Number(e.amount).toFixed(2)} ${currency}</td>
          </tr>`).join("")}
        </table>
      </div>` : ""}
    </div>
    <div class="footer">
      <p>This is an automated report from your restaurant management system.</p>
      <p>Generated on ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
    </div>
  </div>
</body>
</html>`;
}

function shouldSendReport(schedule: ReportSchedule, now: Date): boolean {
  const currentDay = now.getDay();
  const currentDate = now.getDate();
  
  switch (schedule.frequency) {
    case "daily":
      return true;
    case "weekly":
      return schedule.day_of_week === currentDay;
    case "monthly":
      return schedule.day_of_month === currentDate;
    default:
      return false;
  }
}

function getDateRange(frequency: string): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date();
  
  switch (frequency) {
    case "daily":
      start.setDate(start.getDate() - 1);
      break;
    case "weekly":
      start.setDate(start.getDate() - 7);
      break;
    case "monthly":
      start.setMonth(start.getMonth() - 1);
      break;
  }
  
  return { start, end };
}

const handler = async (req: Request): Promise<Response> => {
  const corsHeaders = buildCorsHeaders(req);
  console.log("send-scheduled-reports function invoked");
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const unauthorized = await guardCronCaller(req, corsHeaders);
  if (unauthorized) return unauthorized;

  try {
    const db = createClient(apiUrl, serviceRoleKey);
    const now = new Date();

    // Check if this is a daily profit summary cron trigger
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      // No body provided
    }

    if (body?.type === "daily_profit_summary") {
      console.log("Processing daily profit summary cron job");
      
      // Fetch all active daily profit schedules from profit_targets with alert_enabled
      const { data: restaurants, error: restError } = await db
        .from("restaurants")
        .select("id, name, status, suspended_at, paused_until")
        .eq("status", "active")
        .is("suspended_at", null);

      if (restError) {
        console.error("Error fetching restaurants:", restError);
        throw restError;
      }

      let sentCount = 0;
      
      for (const restaurant of restaurants || []) {
        // Skip branches that are temporarily off.
        if (restaurant.paused_until && new Date(restaurant.paused_until).getTime() > Date.now()) {
          console.log(`Skipping ${restaurant.name} - paused until ${restaurant.paused_until}`);
          continue;
        }

        // Get owner's email for this restaurant
        const { data: ownerRole } = await db
          .from("user_roles")
          .select("user_id")
          .eq("restaurant_id", restaurant.id)
          .eq("role", "owner")
          .single();

        if (!ownerRole) continue;

        // Get user email from auth
        const { data: profile } = await db
          .from("profiles")
          .select("id")
          .eq("id", ownerRole.user_id)
          .single();

        if (!profile) continue;

        // Get user email via service role
        const { data: userData } = await db.auth.admin.getUserById(ownerRole.user_id);
        const email = userData?.user?.email;

        if (!email) continue;

        // Call the send-daily-profit-summary function
        const today = new Date().toISOString().split("T")[0];
        
        try {
          const response = await fetch(`${apiUrl}/functions/v1/send-daily-profit-summary`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify({
              restaurant_id: restaurant.id,
              email,
              date: today,
            }),
          });

          if (response.ok) {
            sentCount++;
            console.log(`Sent daily profit summary to ${email} for ${restaurant.name}`);
          }
        } catch (err) {
          console.error(`Failed to send summary for ${restaurant.name}:`, err);
        }
      }

      return new Response(JSON.stringify({ success: true, sent: sentCount }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Regular scheduled reports processing
    const { data: schedules, error: schedulesError } = await db
      .from("report_schedules")
      .select("*")
      .eq("is_active", true);

    if (schedulesError) {
      console.error("Error fetching schedules:", schedulesError);
      throw schedulesError;
    }

    console.log(`Found ${schedules?.length || 0} active schedules`);

    const results: { success: number; failed: number; skipped: number } = {
      success: 0,
      failed: 0,
      skipped: 0,
    };

    for (const schedule of schedules || []) {
      try {
        if (!shouldSendReport(schedule, now)) {
          console.log(`Skipping schedule ${schedule.id} - not due yet`);
          results.skipped++;
          continue;
        }

        // Check if already sent today
        if (schedule.last_sent_at) {
          const lastSent = new Date(schedule.last_sent_at);
          const hoursSinceLastSent = (now.getTime() - lastSent.getTime()) / (1000 * 60 * 60);
          
          if (schedule.frequency === "daily" && hoursSinceLastSent < 20) {
            console.log(`Skipping schedule ${schedule.id} - already sent today`);
            results.skipped++;
            continue;
          }
        }

        const { start, end } = getDateRange(schedule.frequency);
        
        const html = await generateReportHTML(
          db,
          schedule.restaurant_id,
          schedule.report_type,
          start,
          end
        );

        const reportTypeTitle = schedule.report_type.charAt(0).toUpperCase() + schedule.report_type.slice(1);
        const frequencyTitle = schedule.frequency.charAt(0).toUpperCase() + schedule.frequency.slice(1);

        console.log(`Sending ${reportTypeTitle} report to ${schedule.email}`);

        const emailResponse = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from: fromAddress("Matbex Reports", "reports"),
            to: [schedule.email],
            subject: `${frequencyTitle} ${reportTypeTitle} Report`,
            html,
          }),
        });

        const emailResult = await emailResponse.json();

        if (!emailResponse.ok) {
          console.error(`Error sending email for schedule ${schedule.id}:`, emailResult);
          results.failed++;
        } else {
          console.log(`Email sent successfully for schedule ${schedule.id}`);
          
          // Update last_sent_at
          await db
            .from("report_schedules")
            .update({ last_sent_at: now.toISOString() })
            .eq("id", schedule.id);
          
          results.success++;
        }
      } catch (err) {
        console.error(`Error processing schedule ${schedule.id}:`, err);
        results.failed++;
      }
    }

    console.log("Report sending complete:", results);

    return new Response(JSON.stringify({ success: true, results }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error in send-scheduled-reports:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);
