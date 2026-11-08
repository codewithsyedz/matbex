/**
 * Impersonation slice — selects tenant + role impersonation surface from
 * AuthCore. See AuthFacade for the two-stage rollout rationale.
 */
import { useAuth } from "./AuthCore";

export interface ImpersonationSlice {
  isImpersonating: boolean;
  impersonatedTenantId: string | null;
  impersonatedRole: ReturnType<typeof useAuth>["impersonatedRole"];
  isRoleImpersonating: boolean;
  canImpersonateRoles: boolean;
  impersonationExpiresAt: string | null;
  startRoleImpersonation: ReturnType<typeof useAuth>["startRoleImpersonation"];
  stopRoleImpersonation: ReturnType<typeof useAuth>["stopRoleImpersonation"];
}

export function useImpersonation(): ImpersonationSlice {
  const {
    isImpersonating,
    impersonatedTenantId,
    impersonatedRole,
    isRoleImpersonating,
    canImpersonateRoles,
    impersonationExpiresAt,
    startRoleImpersonation,
    stopRoleImpersonation,
  } = useAuth();
  return {
    isImpersonating,
    impersonatedTenantId,
    impersonatedRole,
    isRoleImpersonating,
    canImpersonateRoles,
    impersonationExpiresAt,
    startRoleImpersonation,
    stopRoleImpersonation,
  };
}