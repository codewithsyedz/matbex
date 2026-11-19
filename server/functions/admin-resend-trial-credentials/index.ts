import { env } from "../_runtime/env.ts";
import { serve } from "../_runtime/serve.ts";
import { createClient } from "@matbex/client";
import { requireSuperAdmin } from "../_shared/superadmin.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";

const API_URL = env("API_URL")!;
const SERVICE_ROLE_KEY = env("SERVICE_ROLE_KEY")!;

function generatePassword(length = 16): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
  // Use crypto for unbiased selection
  const buf = new Uint32Array(length);
  crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[buf[i] % chars.length];
  }
  return out;
}

serve(async (req: Request): Promise<Response> => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const caller = await requireSuperAdmin(req);
    const db = createClient(API_URL, SERVICE_ROLE_KEY);

    const body = await req.json().catch(() => ({}));
    const tenantId: string | undefined = body.tenant_id;
    const explicitUserId: string | undefined = body.user_id;
    const explicitEmail: string | undefined = body.email;

    if (!tenantId && !explicitUserId && !explicitEmail) {
      return new Response(
        JSON.stringify({ error: "tenant_id, user_id, or email is required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    // Resolve tenant + owner user id
    let tenantRow: { id: string; name: string } | null = null;
    let ownerUserId: string | undefined = explicitUserId;

    if (tenantId) {
      const { data: tRow, error: tErr } = await db
        .from("tenants")
        .select("id, name")
        .eq("id", tenantId)
        .maybeSingle();
      if (tErr || !tRow) throw new Error("Tenant not found");
      tenantRow = tRow as any;

      if (!ownerUserId) {
        const { data: ownerRole } = await db
          .from("user_tenant_roles")
          .select("user_id")
          .eq("tenant_id", tenantId)
          .eq("role", "owner")
          .limit(1)
          .maybeSingle();
        ownerUserId = ownerRole?.user_id;
      }
    }

    // Resolve target email/full_name via auth.users + profile
    let targetEmail = explicitEmail?.toLowerCase();
    let fullName = "there";

    if (ownerUserId) {
      const { data: u } = await db.auth.admin.getUserById(ownerUserId);
      if (u?.user?.email) targetEmail = u.user.email.toLowerCase();
      const { data: p } = await db
        .from("profiles")
        .select("full_name")
        .eq("id", ownerUserId)
        .maybeSingle();
      if (p?.full_name) fullName = p.full_name;
    } else if (targetEmail) {
      // Fall back to email-only lookup
      const { data: list, error: listErr } = await db.auth.admin.listUsers();
      if (listErr) throw new Error(listErr.message);
      const user = list.users.find(
        (u) => u.email?.toLowerCase() === targetEmail,
      );
      if (!user) throw new Error(`No user found for ${targetEmail}`);
      ownerUserId = user.id;
    }

    if (!ownerUserId || !targetEmail) {
      throw new Error("Could not resolve target user");
    }

    // Generate + apply new temporary password
    const tempPassword = generatePassword(16);
    const { error: updErr } = await db.auth.admin.updateUserById(ownerUserId, {
      password: tempPassword,
    });
    if (updErr) throw new Error(`Failed to update password: ${updErr.message}`);

    // Determine login URL — prefer request origin, fall back to canonical
    const origin =
      req.headers.get("origin") ||
      req.headers.get("referer") ||
      env("SITE_URL") ||
      "https://matbex.com";
    const loginUrl = `${origin.replace(/\/$/, "")}/auth`;

    // Fire-and-forward the email via the existing welcome-credentials function
    let emailDelivered = true;
    let emailError: string | null = null;
    try {
      const { error: emailErr } = await db.functions.invoke(
        "send-welcome-credentials",
        {
          body: {
            email: targetEmail,
            full_name: fullName,
            company_name: tenantRow?.name ?? "your workspace",
            temporary_password: tempPassword,
            login_url: loginUrl,
          },
        },
      );
      if (emailErr) {
        emailDelivered = false;
        emailError = emailErr.message ?? String(emailErr);
      }
    } catch (e) {
      emailDelivered = false;
      emailError = e instanceof Error ? e.message : String(e);
    }

    // Best-effort SuperAdmin audit
    try {
      await db.from("superadmin_audit_log").insert({
        actor_user_id: caller.userId,
        action_type: "TRIAL_CREDENTIALS_RESENT",
        target_type: tenantRow ? "tenant" : "user",
        target_identifier: tenantRow?.id ?? targetEmail,
        summary: `Resent trial credentials to ${targetEmail}`,
        context: {
          email_delivered: emailDelivered,
          email_error: emailError,
          tenant_id: tenantRow?.id ?? null,
        },
      });
    } catch (_) {
      // table name / shape may differ in some envs; never block the response
    }

    console.log(
      `[admin-resend-trial-credentials] caller=${caller.email} target=${targetEmail} emailed=${emailDelivered}`,
    );

    return new Response(
      JSON.stringify({
        success: true,
        email: targetEmail,
        email_delivered: emailDelivered,
        email_error: emailError,
        // Returned so the SuperAdmin can share it via a secure channel if
        // the automated email failed. Not logged anywhere.
        temporary_password: tempPassword,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  } catch (error: any) {
    if (error instanceof Response) {
      const txt = await error.text();
      return new Response(txt, {
        status: error.status,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    console.error("[admin-resend-trial-credentials] error", error);
    return new Response(JSON.stringify({ error: error?.message ?? String(error) }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});