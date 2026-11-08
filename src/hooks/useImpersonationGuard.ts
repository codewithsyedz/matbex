import { useCallback } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Gap #4 — Block destructive writes while an Owner is "Test as…"
 * impersonating another role.
 *
 * Rationale: writes performed during impersonation still attribute to the
 * real owner (because RLS enforces auth.uid()), so allowing them would
 * pollute sales/accounting/inventory analytics with fake data. The safest
 * default is to make impersonation a read-only "view through their eyes"
 * experience.
 *
 * Usage:
 *   const guard = useImpersonationGuard();
 *   const handleSubmit = () => {
 *     if (!guard("post journal entry")) return;
 *     // ...proceed
 *   };
 *
 * Returns a function `(action?) => boolean`. When impersonating, it shows a
 * toast and returns `false`; otherwise returns `true`.
 */
export function useImpersonationGuard() {
  const { isRoleImpersonating, impersonatedRole } = useAuth();

  return useCallback(
    (action?: string) => {
      if (!isRoleImpersonating) return true;
      const verb = action ? `to ${action}` : "destructive writes";
      toast.error("Test mode is read-only", {
        description: `Exit impersonation${impersonatedRole ? ` of ${impersonatedRole}` : ""} before attempting ${verb}.`,
      });
      return false;
    },
    [isRoleImpersonating, impersonatedRole],
  );
}

/** Convenience boolean for disabling submit buttons in JSX. */
export function useIsImpersonationReadOnly() {
  const { isRoleImpersonating } = useAuth();
  return isRoleImpersonating;
}