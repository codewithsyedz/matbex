import { env } from "../_runtime/env.ts";
import { serve } from "../_runtime/serve.ts";
import { createClient } from "@matbex/client";
import { requireSuperAdminOrCron } from "../_shared/superadmin.ts";

import { buildCorsHeaders } from "../_shared/cors.ts";
const RESEND_API_KEY = env("RESEND_API_KEY");

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Reject anyone who is not the cron job or a SuperAdmin.
    await requireSuperAdminOrCron(req);

    const apiUrl = env("API_URL")!;
    const serviceRoleKey = env("SERVICE_ROLE_KEY")!;
    const db = createClient(apiUrl, serviceRoleKey);

    console.log("Processing export requests...");

    // 1. Expire pending requests older than 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const { data: expiredRequests, error: expireError } = await db
      .from("export_requests")
      .update({ status: "expired" })
      .eq("status", "pending")
      .lt("requested_at", twentyFourHoursAgo)
      .select();

    if (expireError) {
      console.error("Error expiring requests:", expireError);
    } else {
      console.log(`Expired ${expiredRequests?.length || 0} pending export requests`);
    }

    // 2. Find recently approved requests that need notification
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    
    const { data: approvedRequests, error: approvedError } = await db
      .from("export_requests")
      .select(`
        id,
        export_type,
        requested_by,
        tenant_id,
        reviewed_at
      `)
      .eq("status", "approved")
      .gte("reviewed_at", oneHourAgo);

    if (approvedError) {
      console.error("Error fetching approved requests:", approvedError);
    }

    // Send email notifications for approved requests
    if (approvedRequests && approvedRequests.length > 0 && RESEND_API_KEY) {
      for (const request of approvedRequests) {
        // Get requester email
        const { data: userData } = await db.auth.admin.getUserById(request.requested_by);
        
        if (userData?.user?.email) {
          await sendApprovalEmail(userData.user.email, request.export_type);
          console.log(`Sent approval notification to ${userData.user.email}`);
        }
      }
    }

    // 3. Find recently rejected requests that need notification
    const { data: rejectedRequests, error: rejectedError } = await db
      .from("export_requests")
      .select(`
        id,
        export_type,
        requested_by,
        rejection_reason,
        reviewed_at
      `)
      .eq("status", "rejected")
      .gte("reviewed_at", oneHourAgo);

    if (rejectedError) {
      console.error("Error fetching rejected requests:", rejectedError);
    }

    // Send email notifications for rejected requests
    if (rejectedRequests && rejectedRequests.length > 0 && RESEND_API_KEY) {
      for (const request of rejectedRequests) {
        const { data: userData } = await db.auth.admin.getUserById(request.requested_by);
        
        if (userData?.user?.email) {
          await sendRejectionEmail(userData.user.email, request.export_type, request.rejection_reason);
          console.log(`Sent rejection notification to ${userData.user.email}`);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        expired: expiredRequests?.length || 0,
        approved_notifications: approvedRequests?.length || 0,
        rejected_notifications: rejectedRequests?.length || 0,
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
    console.error("Error processing export requests:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function sendApprovalEmail(email: string, exportType: string) {
  if (!RESEND_API_KEY) return;

  const exportTypeLabels: Record<string, string> = {
    sales: "Sales Transactions",
    expenses: "Expenses",
    shifts: "Shifts",
    inventory: "Inventory",
    full_backup: "Full Backup",
  };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: "Matbex Exports <exports@matbex.com>",
      to: [email],
      subject: "Your Data Export Request Has Been Approved",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #22c55e;">Export Request Approved ✓</h2>
          <p>Your data export request for <strong>${exportTypeLabels[exportType] || exportType}</strong> has been approved.</p>
          <p>You can now download your export from the Settings page in the application.</p>
          <p style="margin-top: 30px; color: #666; font-size: 12px;">
            This is an automated message. Please do not reply to this email.
          </p>
        </div>
      `,
    }),
  });

  if (!res.ok) {
    console.error("Failed to send approval email:", await res.text());
  }
}

async function sendRejectionEmail(email: string, exportType: string, reason: string | null) {
  if (!RESEND_API_KEY) return;

  const exportTypeLabels: Record<string, string> = {
    sales: "Sales Transactions",
    expenses: "Expenses",
    shifts: "Shifts",
    inventory: "Inventory",
    full_backup: "Full Backup",
  };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: "Matbex Exports <exports@matbex.com>",
      to: [email],
      subject: "Your Data Export Request Has Been Declined",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #ef4444;">Export Request Declined</h2>
          <p>Your data export request for <strong>${exportTypeLabels[exportType] || exportType}</strong> has been declined.</p>
          ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ""}
          <p>If you have questions, please contact your organization owner.</p>
          <p style="margin-top: 30px; color: #666; font-size: 12px;">
            This is an automated message. Please do not reply to this email.
          </p>
        </div>
      `,
    }),
  });

  if (!res.ok) {
    console.error("Failed to send rejection email:", await res.text());
  }
}