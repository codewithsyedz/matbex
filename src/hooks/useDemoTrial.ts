import { useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

/**
 * Computes demo / trial state from the current tenant.
 * Also fires Day 7 / 11 / 13 warning toasts (idempotent per day via localStorage).
 */
export function useDemoTrial() {
  const { tenant } = useAuth();
  const t = tenant as any;

  const state = useMemo(() => {
    if (!t) {
      return {
        isDemo: false,
        isTrial: false,
        trialEndsAt: null as Date | null,
        daysLeft: null as number | null,
        isExpired: false,
        allowRealPayments: true,
        allowExports: true,
        maxBranches: null as number | null,
        tenantType: "PRODUCTION" as "PRODUCTION" | "DEMO_ENTERPRISE",
      };
    }
    const trialEndsAt = t.trial_ends_at ? new Date(t.trial_ends_at) : null;
    const now = Date.now();
    const daysLeft = trialEndsAt
      ? Math.ceil((trialEndsAt.getTime() - now) / (24 * 60 * 60 * 1000))
      : null;
    return {
      isDemo: t.tenant_type === "DEMO_ENTERPRISE",
      isTrial: t.status === "trial",
      trialEndsAt,
      daysLeft,
      isExpired:
        t.status === "expired" || (daysLeft !== null && daysLeft < 0),
      allowRealPayments: t.allow_real_payments !== false,
      allowExports: t.allow_exports !== false,
      maxBranches: t.max_branches ?? null,
      tenantType: (t.tenant_type as "PRODUCTION" | "DEMO_ENTERPRISE") || "PRODUCTION",
    };
  }, [t]);

  // Day-of warning toasts (Day 13 = 1 day left, Day 11 = 3 left, Day 7 = 7 left)
  useEffect(() => {
    if (!state.isDemo || !state.isTrial || state.daysLeft === null) return;
    const milestones: Record<number, string> = {
      7: "7 days left in your Matbex trial. Activate to keep your data.",
      3: "Only 3 days left in your Matbex trial.",
      1: "Last day of your Matbex trial - activate now to avoid lockdown.",
    };
    const msg = milestones[state.daysLeft];
    if (!msg || !tenant?.id) return;
    const today = new Date().toISOString().slice(0, 10);
    const key = `matbex.trial.warn.${tenant.id}.${state.daysLeft}.${today}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
    toast.warning(msg, { duration: 7000 });
  }, [state.isDemo, state.isTrial, state.daysLeft, tenant?.id]);

  return state;
}