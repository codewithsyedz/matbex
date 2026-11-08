/**
 * Profile slice — selects profile/roles + refreshProfile from AuthCore.
 * See AuthFacade for the two-stage rollout rationale.
 */
import { useAuth } from "./AuthCore";

export interface ProfileSlice {
  profile: ReturnType<typeof useAuth>["profile"];
  roles: ReturnType<typeof useAuth>["roles"];
  refreshProfile: ReturnType<typeof useAuth>["refreshProfile"];
}

export function useProfile(): ProfileSlice {
  const { profile, roles, refreshProfile } = useAuth();
  return { profile, roles, refreshProfile };
}