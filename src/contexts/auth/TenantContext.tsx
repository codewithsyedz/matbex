/**
 * Tenant slice — selects tenant, restaurants, plan, feature flags from AuthCore.
 * See AuthFacade for the two-stage rollout rationale.
 */
import { useAuth } from "./AuthCore";

export interface TenantSlice {
  tenant: ReturnType<typeof useAuth>["tenant"];
  restaurant: ReturnType<typeof useAuth>["restaurant"];
  restaurants: ReturnType<typeof useAuth>["restaurants"];
  plan: ReturnType<typeof useAuth>["plan"];
  featureFlags: ReturnType<typeof useAuth>["featureFlags"];
  switchRestaurant: ReturnType<typeof useAuth>["switchRestaurant"];
  hasFeature: ReturnType<typeof useAuth>["hasFeature"];
}

export function useTenant(): TenantSlice {
  const {
    tenant,
    restaurant,
    restaurants,
    plan,
    featureFlags,
    switchRestaurant,
    hasFeature,
  } = useAuth();
  return {
    tenant,
    restaurant,
    restaurants,
    plan,
    featureFlags,
    switchRestaurant,
    hasFeature,
  };
}