import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

import { buildCorsHeaders } from "../_shared/cors.ts";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

interface InviteRequest {
  email: string;
  role: "owner" | "manager" | "cashier" | "accountant";
  restaurant_id?: string;
  restaurant_name?: string;
  tenant_id?: string;
  full_name?: string;
  invited_by?: string;
  invited_by_user_id?: string;
  invited_by_superadmin?: boolean;
}

// Generate a random password
function generateRandomPassword(length = 12): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
  let password = '';
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < length; i++) {
    password += chars[randomValues[i] % chars.length];
  }
  return password;
}

const handler = async (req: Request): Promise<Response> => {
  const corsHeaders = buildCorsHeaders(req);
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ============================================
    // AUTHENTICATION: Verify caller identity
    // ============================================
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Verify the caller's JWT by passing the token explicitly to getUser.
    // The older SDK pattern of relying on the global Authorization header
    // does not work reliably with asymmetric (kid) signing keys.
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const supabaseClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);
    const { data: { user: caller }, error: authError } = await supabaseClient.auth.getUser(token);
    if (authError || !caller) {
      return new Response(
        JSON.stringify({ error: "Invalid authentication token" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log("Authenticated caller:", caller.email);

    // Create admin client for privileged operations
    const supabaseAdmin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Parse request body
    const { 
      email, 
      role, 
      restaurant_id, 
      restaurant_name, 
      tenant_id,
      full_name,
      invited_by,
      invited_by_user_id,
      invited_by_superadmin 
    }: InviteRequest = await req.json();

    console.log("Sending invite email to:", email, "for role:", role);

    // ============================================
    // AUTHORIZATION: Verify caller permissions
    // ============================================
    
    // Check if caller is SuperAdmin
    const { data: isSuperAdmin } = await supabaseAdmin.rpc('is_superadmin', { 
      _user_id: caller.id 
    });

    if (invited_by_superadmin) {
      // SuperAdmin invite requires SuperAdmin role
      if (!isSuperAdmin) {
        return new Response(
          JSON.stringify({ error: "Only SuperAdmins can send SuperAdmin-level invites" }),
          { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    } else if (restaurant_id) {
      // Restaurant invite requires owner/manager role in that restaurant
      const { data: callerRole } = await supabaseAdmin
        .from('user_roles')
        .select('role')
        .eq('user_id', caller.id)
        .eq('restaurant_id', restaurant_id)
        .in('role', ['owner', 'manager'])
        .maybeSingle();
      
      if (!callerRole && !isSuperAdmin) {
        return new Response(
          JSON.stringify({ error: "Only restaurant owners/managers can invite users" }),
          { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      // Managers cannot invite owners
      if (callerRole?.role === 'manager' && role === 'owner') {
        return new Response(
          JSON.stringify({ error: "Managers cannot invite owners" }),
          { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    } else if (tenant_id && !restaurant_id) {
      // Tenant-level invite without restaurant requires SuperAdmin or tenant owner
      const { data: isTenantOwner } = await supabaseAdmin.rpc('has_tenant_role', {
        _user_id: caller.id,
        _tenant_id: tenant_id,
        _role: 'owner'
      });

      if (!isSuperAdmin && !isTenantOwner) {
        return new Response(
          JSON.stringify({ error: "Only SuperAdmins or tenant owners can send tenant-level invites" }),
          { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    } else {
      return new Response(
        JSON.stringify({ error: "Must specify restaurant_id or tenant_id" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log("Authorization verified for caller:", caller.email);

    // ============================================
    // INVITE LOGIC (same as before)
    // ============================================
    // Track these so we can write an activity-log entry after the email send.
    let invitationId: string | null = null;
    let isResend = false;
    
    // Generate random password for the new user
    const generatedPassword = generateRandomPassword();
    
    // Check if user already exists
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());
    
    let userId: string;
    let isNewUser = false;
    
    if (existingUser) {
      userId = existingUser.id;
      console.log("User already exists:", userId);
      // Update password for existing user
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        password: generatedPassword,
      });
      if (updateError) {
        console.error("Error updating user password:", updateError);
      }
    } else {
      // Create new user with generated password
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: email.toLowerCase(),
        password: generatedPassword,
        email_confirm: true,
        user_metadata: { full_name: full_name || email.split('@')[0] },
      });
      
      if (createError) {
        console.error("Error creating user:", createError);
        throw new Error(`Failed to create user: ${createError.message}`);
      }
      
      userId = newUser.user.id;
      isNewUser = true;
      console.log("Created new user:", userId);
    }

    let tenantName = "";
    let effectiveRestaurantId = restaurant_id;
    let effectiveRestaurantName = restaurant_name;
    let effectiveTenantId = tenant_id;

    // If SuperAdmin invite, get tenant info
    if (invited_by_superadmin && tenant_id) {
      const { data: tenantData } = await supabaseAdmin
        .from("tenants")
        .select("name")
        .eq("id", tenant_id)
        .single();
      
      tenantName = tenantData?.name || "the organization";

      // Get primary restaurant for tenant if not specified
      if (!restaurant_id) {
        const { data: primaryRestaurant } = await supabaseAdmin
          .from("restaurants")
          .select("id, name")
          .eq("tenant_id", tenant_id)
          .eq("is_primary", true)
          .single();
        
        if (primaryRestaurant) {
          effectiveRestaurantId = primaryRestaurant.id;
          effectiveRestaurantName = primaryRestaurant.name;
        }
      }
    } else if (restaurant_id) {
      // Get tenant_id from restaurant if not provided
      const { data: restaurant } = await supabaseAdmin
        .from("restaurants")
        .select("tenant_id, name")
        .eq("id", restaurant_id)
        .single();
      
      if (restaurant) {
        effectiveTenantId = restaurant.tenant_id;
        effectiveRestaurantName = effectiveRestaurantName || restaurant.name;
      }
    }

    // Generate a simple invite token
    const inviteToken = crypto.randomUUID();
    
    // Save invitation to database and set up user roles
    if (effectiveRestaurantId && effectiveTenantId) {
      // Set up user roles immediately (critical so the invited user can access tenant data and skip onboarding)
      // Ensure a single role per restaurant/tenant by clearing any existing assignments first.

      // user_roles (restaurant-scoped)
      const { error: clearRestaurantRolesError } = await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", userId)
        .eq("restaurant_id", effectiveRestaurantId);

      if (clearRestaurantRolesError) {
        console.error("Error clearing existing user_roles:", clearRestaurantRolesError);
      }

      const { error: roleError } = await supabaseAdmin
        .from("user_roles")
        .insert({
          user_id: userId,
          restaurant_id: effectiveRestaurantId,
          role,
        });

      if (roleError) {
        console.error("Error creating user_role:", roleError);
        throw new Error("Failed to assign restaurant role");
      }

      // user_tenant_roles (tenant-scoped)
      const { error: clearTenantRolesError } = await supabaseAdmin
        .from("user_tenant_roles")
        .delete()
        .eq("user_id", userId)
        .eq("tenant_id", effectiveTenantId);

      if (clearTenantRolesError) {
        console.error("Error clearing existing user_tenant_roles:", clearTenantRolesError);
      }

      const { error: tenantRoleError } = await supabaseAdmin
        .from("user_tenant_roles")
        .insert({
          user_id: userId,
          tenant_id: effectiveTenantId,
          role,
        });

      if (tenantRoleError) {
        console.error("Error creating user_tenant_role:", tenantRoleError);
        throw new Error("Failed to assign tenant role");
      }

      // Ensure profile has tenant + restaurant
      const { error: profileError } = await supabaseAdmin
        .from("profiles")
        .upsert(
          {
            id: userId,
            full_name: full_name || email.split("@")[0],
            tenant_id: effectiveTenantId,
            restaurant_id: effectiveRestaurantId,
          },
          { onConflict: "id" }
        );

      if (profileError) {
        console.error("Error updating profile:", profileError);
        throw new Error("Failed to update user profile");
      }

      // Check if there's already a pending invitation for this email
      const { data: existingInvite } = await supabaseAdmin
        .from("team_invitations")
        .select("id")
        .eq("email", email.toLowerCase())
        .eq("restaurant_id", effectiveRestaurantId)
        .eq("status", "pending")
        .maybeSingle();

      if (existingInvite) {
        // Update existing invitation to accepted
        const { error: updateError } = await supabaseAdmin
          .from("team_invitations")
          .update({
            invite_token: inviteToken,
            role: role,
            status: "accepted",
            accepted_at: new Date().toISOString(),
            invited_at: new Date().toISOString(),
            invited_by: invited_by_user_id || caller.id,
          })
          .eq("id", existingInvite.id);

        if (updateError) {
          console.error("Error updating invitation:", updateError);
        } else {
          console.log("Updated existing invitation for:", email);
        }
        invitationId = existingInvite.id;
        isResend = true;
      } else {
        // Create new invitation as accepted
        const { data: insertedInvite, error: insertError } = await supabaseAdmin
          .from("team_invitations")
          .insert({
            email: email.toLowerCase(),
            role: role,
            restaurant_id: effectiveRestaurantId,
            tenant_id: effectiveTenantId,
            invite_token: inviteToken,
            invited_by: invited_by_user_id || caller.id,
            status: "accepted",
            accepted_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          })
          .select("id")
          .single();

        if (insertError) {
          console.error("Error saving invitation:", insertError);
        } else {
          console.log("Saved new invitation for:", email);
          invitationId = insertedInvite?.id ?? null;
        }
      }
    }
    
    // Get the app URL
    const appUrl = "https://matbex.com";
    const loginLink = `${appUrl}/auth`;

    // Determine email content based on invite type
    const inviterText = invited_by_superadmin 
      ? "The platform administrator"
      : (invited_by || caller.email || "A team member");
    
    const orgText = invited_by_superadmin 
      ? tenantName
      : (effectiveRestaurantName || "the restaurant");

    // Send email using Resend REST API
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Matbex <noreply@matbex.com>",
        to: [email],
        subject: `You're invited to join ${orgText} on Matbex`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 40px 20px; background-color: #f0f9f8;">
            <div style="max-width: 600px; margin: 0 auto;">
              <!-- Header Section -->
              <div style="background-color: #5BBDB5; padding: 48px 32px; text-align: center; border-radius: 0;">
                <!-- Envelope Icon -->
                <div style="margin-bottom: 24px;">
                  <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: inline-block;">
                    <rect x="8" y="16" width="48" height="36" rx="2" fill="#4A9E97" stroke="#fff" stroke-width="2"/>
                    <path d="M8 20L32 36L56 20" stroke="#fff" stroke-width="2" fill="none"/>
                    <rect x="20" y="8" width="24" height="20" rx="1" fill="#fff"/>
                    <line x1="24" y1="14" x2="40" y2="14" stroke="#5BBDB5" stroke-width="2"/>
                    <line x1="24" y1="20" x2="36" y2="20" stroke="#5BBDB5" stroke-width="2"/>
                  </svg>
                </div>
                <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 500;">Welcome to ${orgText}!</h1>
              </div>
              
              <!-- Main Content Card -->
              <div style="background: #ffffff; padding: 40px 32px; text-align: center;">
                <p style="margin: 0 0 24px 0; color: #64748b; font-size: 16px;">
                  ${inviterText} has invited you to the <strong style="color: #334155;">${orgText}</strong> account as a <strong style="color: #334155;">${role}</strong>.
                </p>
                
                <!-- Login Credentials Box -->
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px; margin: 24px 0; text-align: left;">
                  <h3 style="color: #334155; font-size: 14px; font-weight: 600; margin: 0 0 16px 0;">Your Login Credentials</h3>
                  <div style="margin-bottom: 12px;">
                    <span style="color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Email</span>
                    <p style="color: #334155; font-size: 14px; margin: 4px 0 0 0; font-family: monospace; background: #fff; padding: 8px 12px; border-radius: 4px; border: 1px solid #e2e8f0;">${email}</p>
                  </div>
                  <div>
                    <span style="color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Password</span>
                    <p style="color: #334155; font-size: 14px; margin: 4px 0 0 0; font-family: monospace; background: #fff; padding: 8px 12px; border-radius: 4px; border: 1px solid #e2e8f0;">${generatedPassword}</p>
                  </div>
                </div>
                
                <a href="${loginLink}" style="display: inline-block; background-color: #5BBDB5; color: #ffffff; padding: 14px 28px; border-radius: 4px; text-decoration: none; font-weight: 500; font-size: 14px;">
                  Login to Matbex
                </a>
                
                <p style="color: #94a3b8; font-size: 12px; margin: 16px 0 0 0;">
                  We recommend changing your password after your first login.
                </p>
              </div>
              
              <!-- Features Section -->
              <div style="background: #ffffff; padding: 32px; border-top: 1px solid #e2e8f0;">
                <p style="color: #94a3b8; font-size: 13px; margin: 0 0 24px 0;">Things that you can do with Matbex</p>
                
                <div style="text-align: left; margin-bottom: 24px;">
                  <h3 style="color: #334155; font-size: 13px; font-weight: 700; margin: 0 0 8px 0; letter-spacing: 0.5px;">TRACK SHIFTS</h3>
                  <p style="color: #64748b; font-size: 14px; margin: 0; line-height: 1.5;">
                    Monitor cash drawers, record sales by payment method, and close shifts with precision variance tracking.
                  </p>
                </div>
                
                <div style="text-align: left; margin-bottom: 24px;">
                  <h3 style="color: #334155; font-size: 13px; font-weight: 700; margin: 0 0 8px 0; letter-spacing: 0.5px;">MANAGE COSTS</h3>
                  <p style="color: #64748b; font-size: 14px; margin: 0; line-height: 1.5;">
                    Track food costs, labor expenses, and daily COGS to keep your prime cost under control and margins healthy.
                  </p>
                </div>
                
                <div style="text-align: left;">
                  <h3 style="color: #334155; font-size: 13px; font-weight: 700; margin: 0 0 8px 0; letter-spacing: 0.5px;">VIEW REPORTS</h3>
                  <p style="color: #64748b; font-size: 14px; margin: 0; line-height: 1.5;">
                    Access real-time dashboards and detailed reports to understand your restaurant's performance at a glance.
                  </p>
                </div>
              </div>
              
              <!-- Footer -->
              <div style="padding: 24px 32px; text-align: center;">
                <p style="color: #94a3b8; font-size: 12px; margin: 0;">
                  Login at: <a href="${loginLink}" style="color: #5BBDB5; text-decoration: underline;">${loginLink}</a>
                </p>
              </div>
            </div>
          </body>
          </html>
        `,
      }),
    });

    const responseData = await emailResponse.json();
    console.log("Email response:", responseData);

    if (!emailResponse.ok) {
      // Log a failed delivery event before throwing so the audit log captures it.
      if (invitationId && effectiveRestaurantId && effectiveTenantId) {
        await supabaseAdmin.from("team_invitation_events").insert({
          invitation_id: invitationId,
          restaurant_id: effectiveRestaurantId,
          tenant_id: effectiveTenantId,
          email: email.toLowerCase(),
          event_type: "failed",
          actor_user_id: caller.id,
          actor_email: caller.email,
          message: isResend ? "Resend failed at email provider" : "Invitation failed at email provider",
          error_detail: responseData?.message || "Email provider rejected the request",
          metadata: { provider: "resend", provider_response: responseData },
        });
      }
      throw new Error(responseData.message || "Failed to send email");
    }

    // Log a successful send/resend event for the audit log.
    if (invitationId && effectiveRestaurantId && effectiveTenantId) {
      await supabaseAdmin.from("team_invitation_events").insert({
        invitation_id: invitationId,
        restaurant_id: effectiveRestaurantId,
        tenant_id: effectiveTenantId,
        email: email.toLowerCase(),
        event_type: isResend ? "resent" : "sent",
        actor_user_id: caller.id,
        actor_email: caller.email,
        message: isResend
          ? `Invitation re-sent to ${email}`
          : `Invitation sent to ${email} as ${role}`,
        metadata: { provider: "resend", provider_id: responseData?.id, role },
      });
    }

    return new Response(JSON.stringify({ success: true, data: responseData }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (error: any) {
    console.error("Error in send-invite function:", error);
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
