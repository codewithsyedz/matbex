import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.87.1";

import { buildCorsHeaders } from "../_shared/cors.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const handler = async (req: Request): Promise<Response> => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";

    // Be tolerant here to avoid client-side hard failures during boot.
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ success: false, reason: "unauthorized" }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const token = authHeader.replace("Bearer ", "");

    const supabaseClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: authHeader } },
    });

    // Validate the JWT using signing-keys compatible verification.
    const { data: claimsData, error: claimsError } = await supabaseClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ success: false, reason: "unauthorized" }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const userId = claimsData.claims.sub as string;
    const emailFromClaims = (claimsData.claims.email as string | undefined)?.toLowerCase();

    // Best-effort fetch of user (for metadata). If it fails, we can still proceed.
    const { data: userResult } = await supabaseClient.auth.getUser();
    const user = userResult?.user ?? null;

    const email = (emailFromClaims ?? user?.email?.toLowerCase()) || null;
    if (!email) {
      return new Response(JSON.stringify({ success: false, reason: "missing_email" }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const supabaseAdmin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Find the most recent invitation for this email (accepted or pending)
    const { data: invitation, error: inviteError } = await supabaseAdmin
      .from("team_invitations")
      .select("*")
      .eq("email", email)
      .in("status", ["accepted", "pending"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (inviteError) {
      console.error("sync-membership: invite lookup error", inviteError);
      throw new Error("Failed to look up invitation");
    }

    if (!invitation) {
      return new Response(JSON.stringify({ success: false, reason: "no_invitation" }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (!invitation.tenant_id || !invitation.restaurant_id) {
      return new Response(
        JSON.stringify({ success: false, reason: "invitation_missing_scope" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    // Ensure restaurant role
    const { error: restaurantRoleError } = await supabaseAdmin
      .from("user_roles")
      .upsert(
        {
          user_id: userId,
          restaurant_id: invitation.restaurant_id,
          role: invitation.role,
        },
        { onConflict: "user_id,restaurant_id,role" }
      );

    if (restaurantRoleError) {
      console.error("sync-membership: user_roles upsert error", restaurantRoleError);
      throw new Error("Failed to ensure restaurant role");
    }

    // Ensure tenant role
    const { error: tenantRoleError } = await supabaseAdmin
      .from("user_tenant_roles")
      .upsert(
        {
          user_id: userId,
          tenant_id: invitation.tenant_id,
          role: invitation.role,
        },
        { onConflict: "user_id,tenant_id,role" }
      );

    if (tenantRoleError) {
      console.error("sync-membership: user_tenant_roles upsert error", tenantRoleError);
      throw new Error("Failed to ensure tenant role");
    }

    // Ensure profile links
    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .upsert(
        {
          id: userId,
          tenant_id: invitation.tenant_id,
          restaurant_id: invitation.restaurant_id,
          full_name: (user?.user_metadata?.full_name as string | undefined) ?? null,
          avatar_url: (user?.user_metadata?.avatar_url as string | undefined) ?? null,
        },
        { onConflict: "id" }
      );

    if (profileError) {
      console.error("sync-membership: profiles upsert error", profileError);
      throw new Error("Failed to ensure profile");
    }

    // If it was pending, mark as accepted now that the user logged in
    if (invitation.status === "pending") {
      const { error: acceptError } = await supabaseAdmin
        .from("team_invitations")
        .update({
          status: "accepted",
          accepted_at: new Date().toISOString(),
          accepted_by_user_id: userId,
        })
        .eq("id", invitation.id);

      if (acceptError) {
        console.error("sync-membership: invitation accept update error", acceptError);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        tenant_id: invitation.tenant_id,
        restaurant_id: invitation.restaurant_id,
        role: invitation.role,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("Error in sync-membership function:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);
