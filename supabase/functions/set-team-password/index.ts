import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

import { buildCorsHeaders } from "../_shared/cors.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

interface SetPasswordRequest {
  user_id: string;
  new_password: string;
  restaurant_id: string;
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

    const supabaseAdmin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Verify the requesting user. Pass the JWT explicitly - the global
    // Authorization header pattern fails with asymmetric signing keys.
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const supabaseClient = createClient(SUPABASE_URL!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user: requestingUser }, error: authError } = await supabaseClient.auth.getUser(token);
    if (authError || !requestingUser) {
      throw new Error("Unauthorized");
    }

    const { user_id, new_password, restaurant_id }: SetPasswordRequest = await req.json();

    if (!user_id || !new_password || !restaurant_id) {
      throw new Error("Missing required fields");
    }

    if (new_password.length < 6) {
      throw new Error("Password must be at least 6 characters");
    }

    // Check if requesting user is owner of the restaurant
    const { data: ownerRole, error: roleError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", requestingUser.id)
      .eq("restaurant_id", restaurant_id)
      .eq("role", "owner")
      .maybeSingle();

    if (roleError || !ownerRole) {
      throw new Error("Only restaurant owners can set passwords for team members");
    }

    // Check if target user belongs to the same restaurant
    const { data: targetRole, error: targetError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user_id)
      .eq("restaurant_id", restaurant_id)
      .maybeSingle();

    if (targetError || !targetRole) {
      throw new Error("User is not a member of this restaurant");
    }

    // Cannot change owner's password
    if (targetRole.role === "owner") {
      throw new Error("Cannot change owner's password");
    }

    // Update the user's password
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user_id, {
      password: new_password,
    });

    if (updateError) {
      console.error("Error updating password:", updateError);
      throw new Error("Failed to update password");
    }

    console.log("Password updated for user:", user_id);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error in set-team-password function:", error);
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
