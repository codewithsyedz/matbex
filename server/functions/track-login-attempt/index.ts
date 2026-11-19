import { env } from "../_runtime/env.ts";
import { serve } from "../_runtime/serve.ts";
import { createClient } from "@matbex/client";

import { buildCorsHeaders } from "../_shared/cors.ts";
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 30;
const RATE_LIMIT_WINDOW_MINUTES = 15;

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiUrl = env("API_URL")!;
    const serviceRoleKey = env("SERVICE_ROLE_KEY")!;
    const db = createClient(apiUrl, serviceRoleKey);

    const body = await req.json();
    const { email, success, failure_reason, user_agent, ip_address } = body;

    if (!email) {
      return new Response(
        JSON.stringify({ error: "email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if account is currently locked
    const { data: existingLock } = await db
      .from("account_locks")
      .select("*")
      .eq("email", email.toLowerCase())
      .is("unlocked_at", null)
      .gt("locked_until", new Date().toISOString())
      .single();

    if (existingLock) {
      console.log(`Login attempt blocked - account locked: ${email}`);
      return new Response(
        JSON.stringify({ 
          blocked: true, 
          reason: "account_locked",
          locked_until: existingLock.locked_until,
          message: `Account is locked until ${new Date(existingLock.locked_until).toLocaleString()}`
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Record the login attempt
    const { error: insertError } = await db
      .from("login_attempts")
      .insert({
        email: email.toLowerCase(),
        success,
        failure_reason,
        user_agent: user_agent || null,
        ip_address: ip_address || null,
      });

    if (insertError) {
      console.error("Error recording login attempt:", insertError);
    }

    // If successful login, clear any existing locks
    if (success) {
      await db
        .from("account_locks")
        .update({ unlocked_at: new Date().toISOString() })
        .eq("email", email.toLowerCase())
        .is("unlocked_at", null);

      console.log(`Successful login recorded for: ${email}`);
      return new Response(
        JSON.stringify({ success: true, blocked: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check failed attempts in the rate limit window
    const windowStart = new Date();
    windowStart.setMinutes(windowStart.getMinutes() - RATE_LIMIT_WINDOW_MINUTES);

    const { data: recentAttempts, error: attemptsError } = await db
      .from("login_attempts")
      .select("id")
      .eq("email", email.toLowerCase())
      .eq("success", false)
      .gte("created_at", windowStart.toISOString());

    if (attemptsError) {
      console.error("Error checking recent attempts:", attemptsError);
    }

    const failedCount = recentAttempts?.length || 0;
    console.log(`Failed attempts for ${email} in last ${RATE_LIMIT_WINDOW_MINUTES} minutes: ${failedCount}`);

    // Lock account if too many failed attempts
    if (failedCount >= MAX_FAILED_ATTEMPTS) {
      const lockedUntil = new Date();
      lockedUntil.setMinutes(lockedUntil.getMinutes() + LOCKOUT_DURATION_MINUTES);

      // Upsert the lock record
      const { error: lockError } = await db
        .from("account_locks")
        .upsert({
          email: email.toLowerCase(),
          locked_until: lockedUntil.toISOString(),
          lock_reason: `${failedCount} failed login attempts in ${RATE_LIMIT_WINDOW_MINUTES} minutes`,
          failed_attempts: failedCount,
          unlocked_at: null,
        }, { onConflict: "email" });

      if (lockError) {
        console.error("Error creating account lock:", lockError);
      } else {
        console.log(`Account locked: ${email} until ${lockedUntil.toISOString()}`);
      }

      return new Response(
        JSON.stringify({ 
          blocked: true, 
          reason: "too_many_attempts",
          locked_until: lockedUntil.toISOString(),
          message: `Account locked for ${LOCKOUT_DURATION_MINUTES} minutes due to too many failed attempts`
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Return warning if approaching limit
    const remainingAttempts = MAX_FAILED_ATTEMPTS - failedCount;
    return new Response(
      JSON.stringify({ 
        success: false, 
        blocked: false,
        remaining_attempts: remainingAttempts,
        message: remainingAttempts <= 2 ? `Warning: ${remainingAttempts} attempts remaining before account lock` : null
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in track-login-attempt:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
