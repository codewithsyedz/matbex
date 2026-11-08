import { createContext, useContext, useEffect, useState, ReactNode, useCallback, useRef } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Json } from "@/integrations/supabase/types";
import { readSessionHydration, writeSessionHydration } from "@/lib/sessionHydration";
import {
  selectEffectivePermissions,
  type ImpersonatableRole as SelectorImpersonatableRole,
} from "@/lib/permissions";
import { isFeatureFlagEnabled, setFeatureFlagsTenant } from "@/hooks/useFeatureFlags";
import { setImpersonationActive } from "@/lib/impersonationFetchGuard";

const AUTH_HYDRATION_KEY = "auth-context-hydration";
interface Profile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  restaurant_id: string | null;
  tenant_id: string | null;
}

interface UserTenantRole {
  id: string;
  user_id: string;
  tenant_id: string;
  role: "owner" | "manager" | "cashier" | "accountant" | "superadmin";
}

export type ImpersonatableRole = SelectorImpersonatableRole;

interface Tenant {
  id: string;
  name: string;
  slug: string | null;
  status: string;
  plan_id: string | null;
  settings: Json;
  accountant_can_post_journals?: boolean | null;
}

interface Restaurant {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  tenant_id: string;
  is_primary: boolean;
  toast_position?: string;
}

interface Plan {
  id: string;
  name: string;
  default_feature_flags: Json;
  quota_limits: Json;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  roles: UserTenantRole[];
  tenant: Tenant | null;
  restaurant: Restaurant | null;
  restaurants: Restaurant[];
  plan: Plan | null;
  featureFlags: Record<string, boolean>;
  loading: boolean;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  switchRestaurant: (restaurantId: string) => void;
  hasRole: (role: "owner" | "manager" | "cashier" | "accountant") => boolean;
  hasFeature: (featureKey: string) => boolean;
  isManager: boolean;
  isOwner: boolean;
  isAccountant: boolean;
  /**
   * True if the current user is allowed to post journal entries / ledger
   * transactions. Owners and managers always qualify. Accountants only
   * qualify when the tenant has explicitly enabled
   * `accountant_can_post_journals`.
   */
  canPostJournals: boolean;
  // Impersonation support
  isImpersonating: boolean;
  impersonatedTenantId: string | null;
  // Owner-only "Test as…" role impersonation
  impersonatedRole: ImpersonatableRole | null;
  isRoleImpersonating: boolean;
  canImpersonateRoles: boolean;
  impersonationExpiresAt: string | null;
  startRoleImpersonation: (role: ImpersonatableRole) => Promise<{ error: Error | null }>;
  stopRoleImpersonation: () => Promise<void>;
}

interface AuthHydrationSnapshot {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  roles: UserTenantRole[];
  tenant: Tenant | null;
  restaurant: Restaurant | null;
  restaurants: Restaurant[];
  plan: Plan | null;
  featureFlags: Record<string, boolean>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const hydratedSnapshot = readSessionHydration<AuthHydrationSnapshot>(AUTH_HYDRATION_KEY);
  const [user, setUser] = useState<User | null>(hydratedSnapshot?.user ?? null);
  const [session, setSession] = useState<Session | null>(hydratedSnapshot?.session ?? null);
  const [profile, setProfile] = useState<Profile | null>(hydratedSnapshot?.profile ?? null);
  const [roles, setRoles] = useState<UserTenantRole[]>(hydratedSnapshot?.roles ?? []);
  const [tenant, setTenant] = useState<Tenant | null>(hydratedSnapshot?.tenant ?? null);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(hydratedSnapshot?.restaurant ?? null);
  const [restaurants, setRestaurants] = useState<Restaurant[]>(hydratedSnapshot?.restaurants ?? []);
  const [plan, setPlan] = useState<Plan | null>(hydratedSnapshot?.plan ?? null);
  const [featureFlags, setFeatureFlags] = useState<Record<string, boolean>>(hydratedSnapshot?.featureFlags ?? {});
  const [loading, setLoading] = useState(!hydratedSnapshot?.session?.user);
  const [impersonatedTenantId, setImpersonatedTenantId] = useState<string | null>(null);
  const [impersonatedRole, setImpersonatedRole] = useState<ImpersonatableRole | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = sessionStorage.getItem("impersonatedRole");
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { role?: ImpersonatableRole };
      const r = parsed?.role;
      return r === "manager" || r === "accountant" || r === "cashier" ? r : null;
    } catch {
      return null;
    }
  });
  const [impersonationLogId, setImpersonationLogId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = sessionStorage.getItem("impersonatedRole");
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { logId?: string };
      return parsed?.logId ?? null;
    } catch {
      return null;
    }
  });
  const [impersonationExpiresAt, setImpersonationExpiresAt] = useState<string | null>(null);

  // Prevent repeated membership bootstrap attempts per session
  const membershipSyncAttemptedRef = useRef(false);
  const sessionRef = useRef<Session | null>(null);
  const hasInitializedRef = useRef(false);

  useEffect(() => {
    writeSessionHydration<AuthHydrationSnapshot>(AUTH_HYDRATION_KEY, user
      ? {
          user,
          session,
          profile,
          roles,
          tenant,
          restaurant,
          restaurants,
          plan,
          featureFlags,
        }
      : null);
  }, [user, session, profile, roles, tenant, restaurant, restaurants, plan, featureFlags]);

  // Check for impersonation on mount and when storage changes
  useEffect(() => {
    const checkImpersonation = () => {
      const stored = sessionStorage.getItem("impersonatedTenant");
      let newId: string | null = null;
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          newId = parsed.id || null;
        } catch {
          newId = null;
        }
      }
      // Only update state if the value actually changed
      setImpersonatedTenantId(prev => prev === newId ? prev : newId);
    };

    checkImpersonation();
    
    // Listen for storage changes (when impersonation starts/stops in other tabs)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "impersonatedTenant" || e.key === null) {
        checkImpersonation();
      }
    };
    window.addEventListener("storage", handleStorageChange);
    
    // For same-window changes, use a custom event instead of polling
    const handleImpersonationChange = () => checkImpersonation();
    window.addEventListener("impersonation-changed", handleImpersonationChange);
    
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("impersonation-changed", handleImpersonationChange);
    };
  }, []);

  const fetchTenantData = useCallback(async (tenantId: string) => {
    const { data: tenantData } = await supabase
      .from("tenants")
      .select("*")
      .eq("id", tenantId)
      .maybeSingle();

    setTenant(tenantData);

    // Fetch all restaurants for this tenant
    const { data: restaurantsData } = await supabase
      .from("restaurants")
      .select("*")
      .eq("tenant_id", tenantId);

    setRestaurants(restaurantsData || []);

    // Set current restaurant (primary or first one)
    if (restaurantsData && restaurantsData.length > 0) {
      const primaryRestaurant = restaurantsData.find(r => r.is_primary) || restaurantsData[0];
      setRestaurant(primaryRestaurant);
    } else {
      setRestaurant(null);
    }

    // Fetch plan and feature flags
    if (tenantData?.plan_id) {
      const { data: planData } = await supabase
        .from("plans")
        .select("*")
        .eq("id", tenantData.plan_id)
        .maybeSingle();

      setPlan(planData);

      // Get tenant-specific feature overrides
      const { data: tenantFeatures } = await supabase
        .from("tenant_features")
        .select("*")
        .eq("tenant_id", tenantId);

      // Merge plan defaults with tenant overrides
      const planFlags = (planData?.default_feature_flags && typeof planData.default_feature_flags === 'object' && !Array.isArray(planData.default_feature_flags))
        ? planData.default_feature_flags as Record<string, boolean>
        : {};
      const flags: Record<string, boolean> = { ...planFlags };
      tenantFeatures?.forEach((tf: { feature_key: string; enabled: boolean }) => {
        flags[tf.feature_key] = tf.enabled;
      });

      // Merge in features unlocked by active addons
      const { data: activeAddons } = await supabase
        .from("tenant_addons" as any)
        .select("addon:addons(included_features)")
        .eq("tenant_id", tenantId)
        .eq("status", "active");
      activeAddons?.forEach((row: any) => {
        const feats = row?.addon?.included_features;
        if (Array.isArray(feats)) {
          feats.forEach((key: string) => {
            if (typeof key === "string") flags[key] = true;
          });
        }
      });

      setFeatureFlags(flags);
    } else {
      setPlan(null);
      setFeatureFlags({});
    }
  }, []);

  const fetchUserData = useCallback(async (userId: string) => {
    try {
      // Fetch profile
      const { data: profileData } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();

      // Fetch tenant roles
      const { data: rolesDataRaw } = await supabase
        .from("user_tenant_roles")
        .select("*")
        .eq("user_id", userId);

      let rolesData = (rolesDataRaw as UserTenantRole[]) || [];
      let effectiveProfile = profileData;

      // If a user was provisioned via email invite (password flow) but is missing roles,
      // auto-bootstrap their membership from the invitation record.
      if (!membershipSyncAttemptedRef.current && user?.email) {
        const missingTenant = !effectiveProfile?.tenant_id;
        const missingRoles = rolesData.length === 0;

        if (missingTenant || missingRoles) {
          membershipSyncAttemptedRef.current = true;

          const token = sessionRef.current?.access_token;
          const { error: syncError } = await supabase.functions.invoke(
            "sync-membership",
            token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
          );

          if (syncError) {
            console.warn("Membership sync failed:", syncError);
          } else {
            // Re-fetch now that roles/profile may have been repaired
            const { data: profileAfter } = await supabase
              .from("profiles")
              .select("*")
              .eq("id", userId)
              .maybeSingle();

            const { data: rolesAfter } = await supabase
              .from("user_tenant_roles")
              .select("*")
              .eq("user_id", userId);

            effectiveProfile = profileAfter;
            rolesData = (rolesAfter as UserTenantRole[]) || [];
          }
        }
      }

      setProfile(effectiveProfile);
      setRoles(rolesData);

      // Check for impersonation first - but only if user is a SuperAdmin
      const storedImpersonation = sessionStorage.getItem("impersonatedTenant");
      if (storedImpersonation) {
        try {
          // First verify this user is actually a SuperAdmin before using impersonation
          const { data: superadminCheck } = await supabase
            .from("superadmin_users")
            .select("id")
            .eq("user_id", userId)
            .maybeSingle();

          if (superadminCheck) {
            const impersonated = JSON.parse(storedImpersonation);
            if (impersonated.id) {
              // Use impersonated tenant data only for SuperAdmins
              await fetchTenantData(impersonated.id);
              return;
            }
          } else {
            // Not a SuperAdmin - clear any stale impersonation data
            sessionStorage.removeItem("impersonatedTenant");
          }
        } catch {
          // Fall through to normal flow
          sessionStorage.removeItem("impersonatedTenant");
        }
      }

      // Fetch tenant if user has one (normal flow)
      if (effectiveProfile?.tenant_id) {
        await fetchTenantData(effectiveProfile.tenant_id);
      } else {
        setTenant(null);
        setRestaurant(null);
        setRestaurants([]);
        setPlan(null);
        setFeatureFlags({});
      }
    } catch (error) {
      console.error("Error fetching user data:", error);
    }
  }, [fetchTenantData, user?.email]);

  // Refetch data when impersonation changes
  useEffect(() => {
    if (user && impersonatedTenantId !== undefined) {
      fetchUserData(user.id);
    }
  }, [impersonatedTenantId, user, fetchUserData]);

  useEffect(() => {
    let isMounted = true;

    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!isMounted) return;

        const previousSession = sessionRef.current;
        const previousUserId = previousSession?.user?.id ?? null;
        const nextUserId = session?.user?.id ?? null;
        const previousAccessToken = previousSession?.access_token ?? null;
        const nextAccessToken = session?.access_token ?? null;
        const userChanged = previousUserId !== nextUserId;
        const tokenChanged = previousAccessToken !== nextAccessToken;

        sessionRef.current = session ?? null;

        // Let the initial getSession() hydration own first-load UX.
        // Supabase can emit INITIAL_SESSION before/around that call.
        if (event === "INITIAL_SESSION" && !hasInitializedRef.current) {
          return;
        }

        setSession((prev) => {
          const prevUserId = prev?.user?.id ?? null;
          const prevAccessToken = prev?.access_token ?? null;
          if (prevUserId === nextUserId && prevAccessToken === nextAccessToken) {
            return prev;
          }
          return session ?? null;
        });

        setUser((prev) => {
          if (prev?.id === nextUserId) {
            return prev;
          }
          return session?.user ?? null;
        });

        if (session?.user) {
          const isRealSignIn = event === "SIGNED_IN" && userChanged;
          const shouldRefetch = userChanged || event === "USER_UPDATED";
          const shouldBlockUI = isRealSignIn || (!hasInitializedRef.current && !hydratedSnapshot?.session?.user);

          if (shouldBlockUI) {
            membershipSyncAttemptedRef.current = false;
            setLoading(true);
          }

          if (shouldRefetch) {
            setTimeout(async () => {
              if (!isMounted) return;
              await fetchUserData(session.user.id);
              if (isMounted && shouldBlockUI) setLoading(false);
            }, 0);
          } else if (shouldBlockUI) {
            setLoading(false);
          }
        } else {
          setProfile(null);
          setRoles([]);
          setTenant(null);
          setRestaurant(null);
          setRestaurants([]);
          setPlan(null);
          setFeatureFlags({});
          setLoading(false);
        }
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!isMounted) return;
      hasInitializedRef.current = true;
      
      sessionRef.current = session ?? null;
      setSession(session ?? null);
      setUser(session?.user ?? null);
      
      if (session?.user) {
        const isSameHydratedUser = hydratedSnapshot?.user?.id === session.user.id;
        // Allow membership bootstrap for each fresh session
        membershipSyncAttemptedRef.current = false;

        if (!isSameHydratedUser) {
          setLoading(true);
        }

        await fetchUserData(session.user.id);
      }
      
      if (isMounted) setLoading(false);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signUp = async (email: string, password: string, fullName: string) => {
    const redirectUrl = `${window.location.origin}/`;
    
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          full_name: fullName,
        },
      },
    });
    return { error };
  };

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    // Track session on successful login
    if (!error && data.user) {
      trackSession(data.user.id);
    }

    return { error };
  };

  const trackSession = async (userId: string) => {
    try {
      // Get user's tenant_id from profile
      const { data: profileData } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("id", userId)
        .maybeSingle();

      // Call session tracking edge function
      await supabase.functions.invoke("track-session", {
        body: {
          user_id: userId,
          tenant_id: profileData?.tenant_id,
          user_agent: navigator.userAgent,
          ip_address: null, // IP is captured server-side if needed
        },
      });
    } catch (error) {
      console.error("Error tracking session:", error);
      // Don't block login on session tracking failure
    }
  };

  const signOut = async () => {
    // Gap #3: ensure any active impersonation session is closed with reason
    // before the user signs out (otherwise ended_at stays NULL forever).
    const activeLogId = impersonationLogId;
    if (activeLogId) {
      try {
        await supabase
          .from("role_impersonation_logs")
          .update({ ended_at: new Date().toISOString(), end_reason: "signout" })
          .eq("id", activeLogId);
      } catch (e) {
        console.warn("Failed to close impersonation log on signout:", e);
      }
      sessionStorage.removeItem("impersonatedRole");
      setImpersonatedRole(null);
      setImpersonationLogId(null);
      setImpersonationExpiresAt(null);
    }
    await supabase.auth.signOut();
    setUser(null);
    sessionRef.current = null;
    setSession(null);
    setProfile(null);
    setRoles([]);
    setTenant(null);
    setRestaurant(null);
    setRestaurants([]);
    setPlan(null);
    setFeatureFlags({});
  };

  const refreshProfile = async () => {
    if (user) {
      await fetchUserData(user.id);
    }
  };

  const switchRestaurant = (restaurantId: string) => {
    const newRestaurant = restaurants.find(r => r.id === restaurantId);
    if (newRestaurant) {
      setRestaurant(newRestaurant);
    }
  };

  const hasFeature = (featureKey: string) => {
    return featureFlags[featureKey] === true;
  };

  // All role / impersonation derivations come from one pure selector so
  // there is a single source of truth (see src/lib/permissions.ts + tests).
  const perms = selectEffectivePermissions({
    roles,
    impersonatedRole,
    tenant: tenant
      ? { accountant_can_post_journals: tenant.accountant_can_post_journals }
      : null,
  });
  const isImpersonating = !!impersonatedTenantId;
  const { realIsOwner, canImpersonateRoles } = perms;
  const isSuperAdmin = roles.some((r) => r.role === "superadmin");

  // Mirror role-impersonation state into the global fetch-level write guard
  // so every mutating Supabase call refuses to fire while "Test as…" is on,
  // regardless of whether the call site remembered useImpersonationGuard.
  useEffect(() => {
    setImpersonationActive(perms.isRoleImpersonating);
  }, [perms.isRoleImpersonating]);

  // Prime the per-tenant feature-flag cache so non-SuperAdmin sessions can
  // resolve flags via the RPC fallback (direct table SELECT is SuperAdmin-only).
  useEffect(() => {
    setFeatureFlagsTenant(tenant?.id ?? null);
  }, [tenant?.id]);

  const startRoleImpersonation = async (role: ImpersonatableRole) => {
    if (!realIsOwner || isSuperAdmin || !user || !tenant?.id) {
      return { error: new Error("Only restaurant owners can use Test as…") };
    }
    // Phase 1: Kill-switch. Platform admins can disable impersonation globally
    // or per tenant via the `impersonation_enabled` feature flag without a
    // redeploy. Defaults to enabled if the flag hasn't loaded yet.
    if (!isFeatureFlagEnabled("impersonation_enabled", tenant.id, true)) {
      return {
        error: new Error(
          "Test as… is temporarily disabled by the platform administrator."
        ),
      };
    }
    try {
      const { data, error } = await supabase
        .from("role_impersonation_logs")
        .insert({
          tenant_id: tenant.id,
          owner_user_id: user.id,
          impersonated_role: role,
          user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
        })
        .select("id, expires_at")
        .maybeSingle();
      if (error) return { error };
      sessionStorage.setItem(
        "impersonatedRole",
        JSON.stringify({
          role,
          logId: data?.id ?? null,
          startedAt: new Date().toISOString(),
          expiresAt: data?.expires_at ?? null,
        })
      );
      setImpersonatedRole(role);
      setImpersonationLogId(data?.id ?? null);
      setImpersonationExpiresAt(data?.expires_at ?? null);
      return { error: null };
    } catch (e: any) {
      return { error: e instanceof Error ? e : new Error(String(e)) };
    }
  };

  const stopRoleImpersonation = async (reason: "manual" | "timeout" | "invalidated" = "manual") => {
    const logId = impersonationLogId;
    sessionStorage.removeItem("impersonatedRole");
    setImpersonatedRole(null);
    setImpersonationLogId(null);
    setImpersonationExpiresAt(null);
    if (logId) {
      try {
        await supabase
          .from("role_impersonation_logs")
          .update({ ended_at: new Date().toISOString(), end_reason: reason })
          .eq("id", logId);
      } catch (e) {
        console.warn("Failed to close impersonation log:", e);
      }
    }
  };

  // Gap #2: server-side validation of the stored impersonation session on
  // every auth change. Tampered sessionStorage entries (fake logId, bumped
  // expiry, replayed after end) are scrubbed because validate_active_impersonation
  // returns no rows.
  // Gap #3: hard 60-minute timeout — once expires_at passes the session is
  // auto-closed and the banner / read-only state disappears.
  useEffect(() => {
    if (!impersonatedRole || !impersonationLogId || !user) return;
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .rpc("validate_active_impersonation", { _log_id: impersonationLogId });
      if (cancelled) return;
      const row = Array.isArray(data) ? data[0] : null;
      if (error || !row) {
        // Invalid / expired / closed → wipe local state without writing back.
        sessionStorage.removeItem("impersonatedRole");
        setImpersonatedRole(null);
        setImpersonationLogId(null);
        setImpersonationExpiresAt(null);
        return;
      }
      if (row.expires_at && row.expires_at !== impersonationExpiresAt) {
        setImpersonationExpiresAt(row.expires_at as string);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [impersonatedRole, impersonationLogId, user?.id]);

  // Auto-stop on expiry.
  useEffect(() => {
    if (!impersonatedRole || !impersonationExpiresAt) return;
    const ms = new Date(impersonationExpiresAt).getTime() - Date.now();
    if (ms <= 0) {
      stopRoleImpersonation("timeout");
      return;
    }
    const t = window.setTimeout(() => stopRoleImpersonation("timeout"), ms);
    return () => window.clearTimeout(t);
  }, [impersonatedRole, impersonationExpiresAt]);

  // Gap #11: heartbeat every 30s + tab-close handler so we never leak an
  // open session when a tab is closed without clicking Exit. The server-side
  // sweeper (pg_cron, every minute) closes anything whose heartbeat is
  // >90s stale even if no client ever calls heartbeat_impersonation again.
  //
  // Performance: gated on document.visibilityState === "visible" AND on the
  // tab actually having an active impersonation session. Background tabs
  // stop beating immediately; cron is authoritative for cleanup. This keeps
  // RPC load at ~2/min per active visible owner-tab instead of N×120/hour
  // across every authenticated tab.
  useEffect(() => {
    if (!impersonatedRole || !impersonationLogId) return;

    let cancelled = false;
    let interval: number | null = null;

    const beat = () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      // Phase 1 kill-switch: if a platform admin disables impersonation mid-session,
      // exit cleanly on the next heartbeat tick instead of waiting for the sweeper.
      if (!isFeatureFlagEnabled("impersonation_enabled", tenant?.id, true)) {
        stopRoleImpersonation("invalidated");
        return;
      }
      supabase
        .rpc("heartbeat_impersonation", { _log_id: impersonationLogId })
        .then(({ data }) => {
          // Server returned false → row was already closed (swept or timed out).
          if (!cancelled && data === false) {
            stopRoleImpersonation("invalidated");
          }
        });
    };

    const startInterval = () => {
      if (interval !== null) return;
      beat();
      interval = window.setInterval(beat, 30_000);
    };
    const stopInterval = () => {
      if (interval !== null) {
        window.clearInterval(interval);
        interval = null;
      }
    };

    if (typeof document === "undefined" || document.visibilityState === "visible") {
      startInterval();
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        startInterval();
      } else {
        stopInterval();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    const closeOnUnload = () => {
      // Best-effort: fire-and-forget keepalive PATCH to PostgREST so the
      // request survives the tab teardown.
      try {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/role_impersonation_logs?id=eq.${impersonationLogId}`;
        const token = sessionRef.current?.access_token;
        fetch(url, {
          method: "PATCH",
          keepalive: true,
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
            Authorization: token ? `Bearer ${token}` : "",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            ended_at: new Date().toISOString(),
            end_reason: "tab_close",
          }),
        }).catch(() => {});
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("pagehide", closeOnUnload);
    window.addEventListener("beforeunload", closeOnUnload);

    return () => {
      cancelled = true;
      stopInterval();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", closeOnUnload);
      window.removeEventListener("beforeunload", closeOnUnload);
    };
  }, [impersonatedRole, impersonationLogId]);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        roles,
        tenant,
        restaurant,
        restaurants,
        plan,
        featureFlags,
        loading,
        signUp,
        signIn,
        signOut,
        refreshProfile,
        switchRestaurant,
        hasRole: perms.hasRole,
        hasFeature,
        isManager: perms.isManager,
        isOwner: perms.isOwner,
        isAccountant: perms.isAccountant,
        canPostJournals: perms.canPostJournals,
        isImpersonating,
        impersonatedTenantId,
        impersonatedRole,
        isRoleImpersonating: perms.isRoleImpersonating,
        canImpersonateRoles,
        impersonationExpiresAt,
        startRoleImpersonation,
        stopRoleImpersonation,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
