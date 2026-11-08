import { UserCog, X, Clock } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";

function formatRemaining(ms: number): string {
  if (ms <= 0) return "expired";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

/**
 * Sticky banner shown when an owner is testing the app under another role.
 * Owners can exit impersonation from here at any time.
 */
export function RoleImpersonationBanner() {
  const {
    isRoleImpersonating,
    impersonatedRole,
    stopRoleImpersonation,
    profile,
    impersonationExpiresAt,
  } = useAuth();
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isRoleImpersonating || !impersonationExpiresAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isRoleImpersonating, impersonationExpiresAt]);

  if (!isRoleImpersonating || !impersonatedRole) return null;

  const roleLabel =
    impersonatedRole === "manager"
      ? "Manager"
      : impersonatedRole === "accountant"
      ? "Accountant"
      : "Cashier";

  const remainingMs = impersonationExpiresAt
    ? new Date(impersonationExpiresAt).getTime() - now
    : null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="flex items-center justify-between gap-3 px-4 py-2 bg-primary/10 border-b border-primary/30 text-foreground text-sm"
      data-testid="impersonation-banner"
    >
      <div className="flex items-center gap-2 min-w-0">
        <UserCog className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
        <span className="truncate" key={impersonatedRole}>
          <span className="font-medium">{t("impersonation.testingAs", "Testing as")}: </span>
          <span className="font-semibold text-primary" data-testid="impersonation-role-pill">
            {roleLabel}
          </span>
          {profile?.full_name && (
            <span className="text-muted-foreground ml-2 hidden sm:inline">
              · {t("impersonation.realIdentity", "Real identity")}: {profile.full_name}
            </span>
          )}
          <span className="text-muted-foreground ml-2 hidden md:inline">
            · {t(
              "impersonation.uxPreviewNote",
              "UX preview only — your real owner permissions still apply server-side",
            )}
          </span>
          {remainingMs !== null && (
            <span className="text-muted-foreground ml-2 hidden lg:inline-flex items-center gap-1">
              · <Clock className="h-3 w-3" />
              {formatRemaining(remainingMs)}
            </span>
          )}
        </span>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 shrink-0"
        onClick={() => stopRoleImpersonation()}
      >
        <X className="h-3.5 w-3.5 mr-1" />
        {t("impersonation.exit", "Exit")}
      </Button>
    </div>
  );
}