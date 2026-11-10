import { env } from "../_runtime/env.ts";
import { fromAddress } from "../_shared/sender.ts";
import { serve } from "../_runtime/serve.ts";
import { createClient } from "@matbex/client";

import { buildCorsHeaders } from "../_shared/cors.ts";
import { guardCronCaller } from "../_shared/cronGuard.ts";
const Resend = (await import("resend")).Resend;
const resend = new Resend(env("RESEND_API_KEY"));

interface StaffSettings {
  id: string;
  restaurant_id: string;
  salary_day: number;
  reminder_enabled: boolean;
  reminder_days_before: number;
  reminder_email: string | null;
}

interface Restaurant {
  id: string;
  name: string;
  currency: string;
}

interface Staff {
  id: string;
  name: string;
  role: string;
  payment_type: string;
  hourly_rate: number;
  monthly_salary: number | null;
  is_active: boolean;
}

const handler = async (req: Request): Promise<Response> => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const unauthorized = await guardCronCaller(req, corsHeaders);
  if (unauthorized) return unauthorized;

  try {
    const apiUrl = env("API_URL")!;
    const serviceRoleKey = env("SERVICE_ROLE_KEY")!;
    const db = createClient(apiUrl, serviceRoleKey);

    const today = new Date();
    const currentDay = today.getDate();

    // Fetch all staff settings with reminders enabled
    const { data: settingsList, error: settingsError } = await db
      .from("staff_settings")
      .select("*")
      .eq("reminder_enabled", true)
      .not("reminder_email", "is", null);

    if (settingsError) throw settingsError;

    const emailsSent: string[] = [];

    for (const settings of settingsList as StaffSettings[]) {
      // Calculate the reminder day
      let reminderDay = settings.salary_day - settings.reminder_days_before;
      if (reminderDay <= 0) {
        // Handle month wrap-around (e.g., salary day 3, reminder 5 days before = day 28/29 of previous month)
        reminderDay = 28 + reminderDay; // Simplified - assumes 28 day month for consistency
      }

      // Check if today is the reminder day
      if (currentDay !== reminderDay) {
        continue;
      }

      // Fetch restaurant info
      const { data: restaurant, error: restaurantError } = await db
        .from("restaurants")
        .select("id, name, currency")
        .eq("id", settings.restaurant_id)
        .single();

      if (restaurantError || !restaurant) continue;

      // Fetch active staff for this restaurant
      const { data: staffList, error: staffError } = await db
        .from("staff")
        .select("*")
        .eq("restaurant_id", settings.restaurant_id)
        .eq("is_active", true);

      if (staffError || !staffList || staffList.length === 0) continue;

      // Calculate total salary
      const totalSalary = (staffList as Staff[]).reduce((sum, s) => {
        if (s.payment_type === "monthly" && s.monthly_salary) {
          return sum + s.monthly_salary;
        }
        return sum;
      }, 0);

      const staffSummary = (staffList as Staff[])
        .filter(s => s.payment_type === "monthly" && s.monthly_salary)
        .map(s => `<tr><td style="padding: 8px; border-bottom: 1px solid #eee;">${s.name}</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${s.role}</td><td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">${restaurant.currency} ${s.monthly_salary?.toLocaleString()}</td></tr>`)
        .join("");

      // Send reminder email
      const emailResponse = await resend.emails.send({
        from: fromAddress("Matbex Payroll", "payroll"),
        to: [settings.reminder_email!],
        subject: `Salary Reminder - ${restaurant.name} (Due: Day ${settings.salary_day})`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Salary Payment Reminder</h2>
            <p>This is a reminder that salaries for <strong>${restaurant.name}</strong> are due on <strong>day ${settings.salary_day}</strong> of this month.</p>
            
            <h3 style="color: #666; margin-top: 24px;">Staff Salary Summary</h3>
            <table style="width: 100%; border-collapse: collapse; margin-top: 12px;">
              <thead>
                <tr style="background: #f5f5f5;">
                  <th style="padding: 12px 8px; text-align: left; border-bottom: 2px solid #ddd;">Name</th>
                  <th style="padding: 12px 8px; text-align: left; border-bottom: 2px solid #ddd;">Role</th>
                  <th style="padding: 12px 8px; text-align: right; border-bottom: 2px solid #ddd;">Salary</th>
                </tr>
              </thead>
              <tbody>
                ${staffSummary}
              </tbody>
              <tfoot>
                <tr style="background: #f5f5f5; font-weight: bold;">
                  <td colspan="2" style="padding: 12px 8px;">Total</td>
                  <td style="padding: 12px 8px; text-align: right;">${restaurant.currency} ${totalSalary.toLocaleString()}</td>
                </tr>
              </tfoot>
            </table>
            
            <p style="margin-top: 24px; color: #666; font-size: 14px;">
              This reminder was sent ${settings.reminder_days_before} days before the salary date.
            </p>
            
            <hr style="margin: 24px 0; border: none; border-top: 1px solid #eee;">
            <p style="color: #999; font-size: 12px;">Sent from Matbex</p>
          </div>
        `,
      });

      console.log(`Email sent to ${settings.reminder_email}:`, emailResponse);
      emailsSent.push(settings.reminder_email!);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Sent ${emailsSent.length} reminder(s)`,
        emails: emailsSent 
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("Error in send-salary-reminder function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
