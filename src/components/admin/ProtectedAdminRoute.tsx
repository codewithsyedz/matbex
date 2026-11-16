import { ReactNode, useEffect, useState } from "react";
import { db } from "@/integrations/db/client";
import { AdminMfaGate } from "./AdminMfaGate";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useSuperAdmin } from "@/contexts/SuperAdminContext";
import { AdminLayout } from "./AdminLayout";
import { MatbexLogoLoader } from "@/components/brand/MatbexLogo";
import { useLocation } from "react-router-dom";

interface ProtectedAdminRouteProps {
  children: ReactNode;
}

export function ProtectedAdminRoute({ children }: ProtectedAdminRouteProps) {
  const { user, loading: authLoading } = useAuth();
  const { isSuperAdmin, loading: adminLoading } = useSuperAdmin();
  const location = useLocation();
  // SuperAdmin rights need a session that passed two-factor (aal2); the database and the admin
  // functions refuse otherwise, so ask for the code here instead of showing empty pages.
  const [mfa, setMfa] = useState<"checking" | "ok" | "needed">("checking");
  const checkMfa = () => {
    if (!user) return;
    void (db.rpc as any)("superadmin_mfa_status").then(({ data }: { data: { is_superadmin_account?: boolean; aal?: string } | null }) => {
      setMfa(data?.is_superadmin_account && data.aal !== "aal2" ? "needed" : "ok");
    });
  };
  useEffect(checkMfa, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Only show the fullscreen verification loader on true cold start.
  // Once we have a user from hydration, subsequent admin route navigations
  // should rely on the route-level Suspense fallback instead of flashing
  // a second fullscreen loader.
  if ((authLoading || adminLoading) && !user) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <MatbexLogoLoader size={64} />
          <p className="text-sm text-muted-foreground font-light">Verifying access...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (!isSuperAdmin && location.pathname !== "/admin/seo") {
    return <Navigate to="/dashboard" replace />;
  }

  if (mfa === "needed") {
    return <AdminMfaGate onVerified={() => window.location.reload()} />;
  }

  return <AdminLayout>{children}</AdminLayout>;
}
