import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { db } from "@/integrations/db/client";
import { User } from "@matbex/client";
import { readSessionHydration, writeSessionHydration } from "@/lib/sessionHydration";

const SUPERADMIN_HYDRATION_KEY = "superadmin-context-hydration";

interface ImpersonatedTenant {
  id: string;
  name: string;
  status: string;
  plan_id: string | null;
}

interface SuperAdminContextType {
  isSuperAdmin: boolean;
  loading: boolean;
  impersonatedTenant: ImpersonatedTenant | null;
  startImpersonation: (tenantId: string) => Promise<void>;
  stopImpersonation: () => void;
  isImpersonating: boolean;
}

interface SuperAdminHydrationSnapshot {
  user: User | null;
  isSuperAdmin: boolean;
}

const SuperAdminContext = createContext<SuperAdminContextType | undefined>(undefined);

export function SuperAdminProvider({ children }: { children: ReactNode }) {
  const hydratedSnapshot = readSessionHydration<SuperAdminHydrationSnapshot>(SUPERADMIN_HYDRATION_KEY);
  const [user, setUser] = useState<User | null>(hydratedSnapshot?.user ?? null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(hydratedSnapshot?.isSuperAdmin ?? false);
  const [loading, setLoading] = useState(!hydratedSnapshot?.user);
  const [impersonatedTenant, setImpersonatedTenant] = useState<ImpersonatedTenant | null>(null);

  useEffect(() => {
    writeSessionHydration<SuperAdminHydrationSnapshot>(SUPERADMIN_HYDRATION_KEY, user
      ? { user, isSuperAdmin }
      : null);
  }, [user, isSuperAdmin]);

  // Get user directly from the API to avoid circular dependency with AuthContext
  useEffect(() => {
    // Only update `user` when the user id actually changes, otherwise
    // background TOKEN_REFRESHED events on tab focus create a new user
    // object reference and re-trigger the [user] effect below, causing
    // the full-screen "Initializing..." loader to flash.
    const { data: { subscription } } = db.auth.onAuthStateChange(
      (event, session) => {
        const nextUser = session?.user ?? null;
        setUser((prev) => (prev?.id === nextUser?.id ? prev : nextUser));
      }
    );

    db.auth.getSession().then(({ data: { session } }) => {
      const nextUser = session?.user ?? null;
      setUser((prev) => (prev?.id === nextUser?.id ? prev : nextUser));
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const checkSuperAdmin = async () => {
      const isSameHydratedUser = hydratedSnapshot?.user?.id === user?.id;

      if (!isSameHydratedUser) {
        setLoading(true);
      }
      
      if (!user) {
        setIsSuperAdmin(false);
        setLoading(false);
        return;
      }

      // Fast path: read the `is_superadmin` claim that our DB trigger writes
      // into auth.users.raw_app_meta_data - the API exposes it on the user
      // object as `app_metadata` and embeds it in every JWT.
      const claim = (user.app_metadata as Record<string, unknown> | undefined)?.is_superadmin;
      if (typeof claim === "boolean") {
        setIsSuperAdmin(claim);
        setLoading(false);
        if (!claim) return; // No need to double-check non-admins against the DB.
      }

      try {
        const { data, error } = await db
          .from("superadmin_users")
          .select("id")
          .eq("user_id", user.id)
          .maybeSingle();

        if (error) {
          console.error("Error checking superadmin status:", error);
          // Keep the JWT-claim value if we already had one; otherwise fail closed.
          if (typeof claim !== "boolean") setIsSuperAdmin(false);
        } else {
          setIsSuperAdmin(!!data);
        }
      } catch (err) {
        console.error("Error checking superadmin:", err);
        if (typeof claim !== "boolean") setIsSuperAdmin(false);
      } finally {
        setLoading(false);
      }
    };

    checkSuperAdmin();
  }, [user]);

  // Restore impersonation from sessionStorage
  useEffect(() => {
    const stored = sessionStorage.getItem("impersonatedTenant");
    if (stored && isSuperAdmin) {
      try {
        setImpersonatedTenant(JSON.parse(stored));
      } catch {
        sessionStorage.removeItem("impersonatedTenant");
      }
    }
  }, [isSuperAdmin]);

  const startImpersonation = async (tenantId: string) => {
    if (!isSuperAdmin) return;

    try {
      const { data, error } = await db
        .from("tenants")
        .select("id, name, status, plan_id")
        .eq("id", tenantId)
        .single();

      if (error) throw error;

      const tenantData: ImpersonatedTenant = {
        id: data.id,
        name: data.name,
        status: data.status,
        plan_id: data.plan_id,
      };

      setImpersonatedTenant(tenantData);
      sessionStorage.setItem("impersonatedTenant", JSON.stringify(tenantData));
      // Dispatch custom event so AuthContext updates without polling
      window.dispatchEvent(new Event("impersonation-changed"));
    } catch (err) {
      console.error("Error starting impersonation:", err);
    }
  };

  const stopImpersonation = () => {
    setImpersonatedTenant(null);
    sessionStorage.removeItem("impersonatedTenant");
    // Dispatch custom event so AuthContext updates without polling
    window.dispatchEvent(new Event("impersonation-changed"));
  };

  return (
    <SuperAdminContext.Provider
      value={{
        isSuperAdmin,
        loading,
        impersonatedTenant,
        startImpersonation,
        stopImpersonation,
        isImpersonating: !!impersonatedTenant,
      }}
    >
      {children}
    </SuperAdminContext.Provider>
  );
}

export function useSuperAdmin() {
  const context = useContext(SuperAdminContext);
  if (context === undefined) {
    // During HMR updates, the context module can be temporarily replaced
    // while consumers still reference the old context. Returning a safe
    // default avoids crashing the tree; a full reload restores the real
    // provider.
    if (import.meta.env.DEV) {
      console.warn("useSuperAdmin called outside SuperAdminProvider (likely HMR). Returning defaults.");
      return {
        isSuperAdmin: false,
        loading: false,
        impersonatedTenant: null,
        startImpersonation: async () => {},
        stopImpersonation: () => {},
        isImpersonating: false,
      } as SuperAdminContextType;
    }
    throw new Error("useSuperAdmin must be used within a SuperAdminProvider");
  }
  return context;
}
