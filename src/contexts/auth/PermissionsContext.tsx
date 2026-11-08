/**
 * Permissions slice — selects derived role/permission booleans from AuthCore.
 * See AuthFacade for the two-stage rollout rationale.
 *
 * Note: a top-level `src/contexts/PermissionsContext.tsx` already exists as
 * a back-compat facade and continues to work. New code should prefer
 * `import { usePermissions } from "@/contexts/auth/AuthFacade"`.
 */
import { useAuth } from "./AuthCore";

export interface PermissionsSlice {
  hasRole: ReturnType<typeof useAuth>["hasRole"];
  isOwner: boolean;
  isManager: boolean;
  isAccountant: boolean;
  canPostJournals: boolean;
}

export function usePermissions(): PermissionsSlice {
  const { hasRole, isOwner, isManager, isAccountant, canPostJournals } = useAuth();
  return { hasRole, isOwner, isManager, isAccountant, canPostJournals };
}