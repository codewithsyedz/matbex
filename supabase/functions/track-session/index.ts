import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { buildCorsHeaders } from "../_shared/cors.ts";
serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { user_id, tenant_id, user_agent, ip_address } = body;

    if (!user_id) {
      return new Response(
        JSON.stringify({ error: "user_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate a unique session token
    const sessionToken = crypto.randomUUID();

    // Parse device info from user agent
    const deviceInfo = parseDeviceInfo(user_agent || "");

    // Create session record
    const { data, error } = await supabase
      .from("user_sessions")
      .insert({
        user_id,
        tenant_id,
        session_token: sessionToken,
        ip_address: ip_address || null,
        user_agent: user_agent || null,
        device_info: deviceInfo,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating session:", error);
      return new Response(
        JSON.stringify({ error: "Failed to create session" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Session created for user ${user_id}: ${data.id}`);

    return new Response(
      JSON.stringify({ success: true, session_id: data.id, session_token: sessionToken }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in track-session:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function parseDeviceInfo(userAgent: string): Record<string, string> {
  const info: Record<string, string> = {};

  // Detect browser
  if (userAgent.includes("Chrome")) info.browser = "Chrome";
  else if (userAgent.includes("Firefox")) info.browser = "Firefox";
  else if (userAgent.includes("Safari")) info.browser = "Safari";
  else if (userAgent.includes("Edge")) info.browser = "Edge";
  else info.browser = "Unknown";

  // Detect OS
  if (userAgent.includes("Windows")) info.os = "Windows";
  else if (userAgent.includes("Mac")) info.os = "macOS";
  else if (userAgent.includes("Linux")) info.os = "Linux";
  else if (userAgent.includes("Android")) info.os = "Android";
  else if (userAgent.includes("iPhone") || userAgent.includes("iPad")) info.os = "iOS";
  else info.os = "Unknown";

  // Detect device type
  if (userAgent.includes("Mobile") || userAgent.includes("Android") || userAgent.includes("iPhone")) {
    info.device_type = "Mobile";
  } else if (userAgent.includes("iPad") || userAgent.includes("Tablet")) {
    info.device_type = "Tablet";
  } else {
    info.device_type = "Desktop";
  }

  return info;
}