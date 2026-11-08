import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { requireSuperAdmin } from "../_shared/superadmin.ts";

import { buildCorsHeaders } from "../_shared/cors.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const handler = async (req: Request): Promise<Response> => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify SuperAdmin via JWT claim (fast path) with DB re-check for revocations.
    const caller = await requireSuperAdmin(req);
    const supabaseAdmin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // 4. Now process the password reset request
    const { email, user_id, new_password } = await req.json();

    if (!new_password) {
      throw new Error("Missing new_password");
    }

    if (!email && !user_id) {
      throw new Error("Missing email or user_id");
    }

    let targetUserId = user_id;

    // If email provided, look up user_id
    if (email && !user_id) {
      const { data: userData, error: userError } = await supabaseAdmin.auth.admin.listUsers();
      
      if (userError) {
        throw new Error(`Failed to list users: ${userError.message}`);
      }

      const user = userData.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
      
      if (!user) {
        throw new Error(`User not found with email: ${email}`);
      }

      targetUserId = user.id;
    }

    // Update password
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(targetUserId, {
      password: new_password,
    });

    if (updateError) {
      throw new Error(`Failed to update password: ${updateError.message}`);
    }

    console.log(`Password reset successfully by SuperAdmin ${caller.email} for user: ${email || targetUserId}`);

    return new Response(JSON.stringify({ success: true, message: `Password reset for ${email || targetUserId}` }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    // Allow helper-thrown Response objects (401/403) to flow through with their status.
    if (error instanceof Response) {
      const body = await error.text();
      return new Response(body, {
        status: error.status,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    console.error("Error in admin-reset-password:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);
