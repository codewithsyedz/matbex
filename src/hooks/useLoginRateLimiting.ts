import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface RateLimitResult {
  blocked: boolean;
  reason?: string;
  locked_until?: string;
  message?: string;
  remaining_attempts?: number;
}

export function useLoginRateLimiting() {
  const [isChecking, setIsChecking] = useState(false);

  const trackLoginAttempt = async (
    email: string,
    success: boolean,
    failureReason?: string
  ): Promise<RateLimitResult> => {
    setIsChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke("track-login-attempt", {
        body: {
          email,
          success,
          failure_reason: failureReason,
          user_agent: navigator.userAgent,
          ip_address: null, // IP is captured server-side if needed
        },
      });

      if (error) {
        console.error("Error tracking login attempt:", error);
        return { blocked: false };
      }

      return data as RateLimitResult;
    } catch (error) {
      console.error("Error in rate limiting:", error);
      return { blocked: false };
    } finally {
      setIsChecking(false);
    }
  };

  const checkAccountLock = async (email: string): Promise<RateLimitResult> => {
    setIsChecking(true);
    try {
      const { data, error } = await supabase
        .from("account_locks")
        .select("*")
        .eq("email", email.toLowerCase())
        .is("unlocked_at", null)
        .gt("locked_until", new Date().toISOString())
        .single();

      if (error && error.code !== "PGRST116") {
        console.error("Error checking account lock:", error);
      }

      if (data) {
        return {
          blocked: true,
          reason: "account_locked",
          locked_until: data.locked_until,
          message: `Account is locked until ${new Date(data.locked_until).toLocaleString()}`,
        };
      }

      return { blocked: false };
    } catch (error) {
      console.error("Error checking account lock:", error);
      return { blocked: false };
    } finally {
      setIsChecking(false);
    }
  };

  return {
    trackLoginAttempt,
    checkAccountLock,
    isChecking,
  };
}
