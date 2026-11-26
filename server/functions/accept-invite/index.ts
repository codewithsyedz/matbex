import { env } from "../_runtime/env.ts";
import { serve } from "../_runtime/serve.ts";
import { createClient } from "@matbex/client";

import { buildCorsHeaders } from "../_shared/cors.ts";
const API_URL = env("API_URL");
const SERVICE_ROLE_KEY = env("SERVICE_ROLE_KEY");

interface AcceptInviteRequest {
  invite_token: string;
}

const handler = async (req: Request): Promise<Response> => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const dbAdmin = createClient(API_URL!, SERVICE_ROLE_KEY!);
    
    // Verify the requesting user
    const dbUser = createClient(API_URL!, env("ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    
    const { data: { user }, error: authError } = await dbUser.auth.getUser();
    if (authError || !user) {
      throw new Error("Unauthorized");
    }

    const { invite_token }: AcceptInviteRequest = await req.json();

    if (!invite_token) {
      throw new Error("Missing invite token");
    }

    console.log("Processing invite acceptance for user:", user.id, "with token:", invite_token);

    // Find the invitation
    const { data: invitation, error: inviteError } = await dbAdmin
      .from("team_invitations")
      .select("*")
      .eq("invite_token", invite_token)
      .maybeSingle();

    if (inviteError || !invitation) {
      console.error("Invitation not found:", inviteError);
      throw new Error("Invalid invitation token");
    }

    // Check if invitation is still valid
    if (invitation.status !== "pending") {
      throw new Error(`Invitation has already been ${invitation.status}`);
    }

    if (new Date(invitation.expires_at) < new Date()) {
      // Update status to expired
      await dbAdmin
        .from("team_invitations")
        .update({ status: "expired" })
        .eq("id", invitation.id);
      throw new Error("Invitation has expired");
    }

    // Verify email matches
    if (invitation.email.toLowerCase() !== user.email?.toLowerCase()) {
      throw new Error("This invitation was sent to a different email address");
    }

    console.log("Invitation found:", invitation);

    // Create user_roles entry for the restaurant
    const { error: roleError } = await dbAdmin
      .from("user_roles")
      .upsert(
        {
          user_id: user.id,
          restaurant_id: invitation.restaurant_id,
          role: invitation.role,
        },
        {
          // Must match the table's UNIQUE(user_id, restaurant_id, role)
          onConflict: "user_id,restaurant_id,role",
        }
      );

    if (roleError) {
      console.error("Error creating user role:", roleError);
      throw new Error("Failed to assign role");
    }

    console.log("User role created for restaurant:", invitation.restaurant_id);

    // Create user_tenant_roles entry
    const { error: tenantRoleError } = await dbAdmin
      .from("user_tenant_roles")
      .upsert(
        {
          user_id: user.id,
          tenant_id: invitation.tenant_id,
          role: invitation.role,
        },
        {
          // Must match the table's UNIQUE(user_id, tenant_id, role)
          onConflict: "user_id,tenant_id,role",
        }
      );

    if (tenantRoleError) {
      console.error("Error creating tenant role:", tenantRoleError);
      throw new Error("Failed to assign tenant role");
    }

    // Ensure user profile exists and has tenant + restaurant
    const { error: profileError } = await dbAdmin
      .from("profiles")
      .upsert(
        {
          id: user.id,
          tenant_id: invitation.tenant_id,
          restaurant_id: invitation.restaurant_id,
          full_name: (user.user_metadata?.full_name as string | undefined) ?? null,
          avatar_url: (user.user_metadata?.avatar_url as string | undefined) ?? null,
        },
        {
          onConflict: "id",
        }
      );

    if (profileError) {
      console.error("Error upserting profile:", profileError);
      throw new Error("Failed to update profile");
    }

    console.log(
      "Profile upserted with tenant:",
      invitation.tenant_id,
      "restaurant:",
      invitation.restaurant_id
    );

    // Mark invitation as accepted
    const { error: updateError } = await dbAdmin
      .from("team_invitations")
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
        accepted_by_user_id: user.id,
      })
      .eq("id", invitation.id);

    if (updateError) {
      console.error("Error updating invitation status:", updateError);
    }

    console.log("Invitation accepted successfully");

    return new Response(JSON.stringify({ 
      success: true,
      restaurant_id: invitation.restaurant_id,
      tenant_id: invitation.tenant_id,
      role: invitation.role
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error in accept-invite function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: error.message === "Unauthorized" ? 401 : 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
