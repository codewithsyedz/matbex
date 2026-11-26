import { env } from "../_runtime/env.ts";
import { serve } from "../_runtime/serve.ts";
import { createClient } from "@matbex/client";

import { buildCorsHeaders } from "../_shared/cors.ts";
const API_URL = env("API_URL");
const SERVICE_ROLE_KEY = env("SERVICE_ROLE_KEY");

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

    const dbAdmin = createClient(API_URL!, SERVICE_ROLE_KEY!);

    // Verify the requesting user. Pass the JWT explicitly - the global
    // Authorization header pattern fails with asymmetric signing keys.
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const dbUser = createClient(API_URL!, env("ANON_KEY")!);
    const { data: { user: requestingUser }, error: authError } = await dbUser.auth.getUser(token);
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
    const { data: ownerRole, error: roleError } = await dbAdmin
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
    const { data: targetRole, error: targetError } = await dbAdmin
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
    const { error: updateError } = await dbAdmin.auth.admin.updateUserById(user_id, {
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
