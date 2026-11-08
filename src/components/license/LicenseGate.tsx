import { ReactNode } from "react";
import { useLicense } from "@/contexts/LicenseContext";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ShieldAlert, ShieldX, Lock } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTranslation } from "react-i18next";

interface Props {
  children: ReactNode;
  /** When true, the limited mode renders children with a banner. When false, hard-blocks on limited. */
  allowCloseOut?: boolean;
}

export function LicenseGate({ children, allowCloseOut = true }: Props) {
  const { t, i18n } = useTranslation();
  const { mode, graceEndsAt, activeDevices, seatCap, revokeDevice } = useLicense();
  const { isManager } = useAuth();

  if (mode === "loading" || mode === "active") return <>{children}</>;

  if (mode === "grace") {
    const days = graceEndsAt
      ? Math.max(0, Math.ceil((new Date(graceEndsAt).getTime() - Date.now()) / 86400000))
      : 0;
    return (
      <div className="space-y-3">
        <Alert className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/30">
          <ShieldAlert className="h-4 w-4 text-amber-600" />
          <AlertTitle>Subscription needs attention</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>POS will switch to close-out mode in {days} day{days === 1 ? "" : "s"}. Update billing to keep accepting new orders.</span>
            <Button asChild size="sm" variant="outline"><Link to="/billing">Update billing</Link></Button>
          </AlertDescription>
        </Alert>
        {children}
      </div>
    );
  }

  if (mode === "limited" || mode === "offline_stale") {
    if (!allowCloseOut) {
      return <LockedScreen mode={mode} />;
    }
    return (
      <div className="space-y-3">
        <Alert variant="destructive">
          <ShieldX className="h-4 w-4" />
          <AlertTitle>{mode === "offline_stale" ? "License needs re-validation" : "POS is in close-out mode"}</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>
              {mode === "offline_stale"
                ? "Reconnect this device to the internet to restore full POS access."
                : "New sales are disabled. You can still close shifts, settle open tabs, print, and view reports."}
            </span>
            <Button asChild size="sm" variant="outline"><Link to="/billing">Manage billing</Link></Button>
          </AlertDescription>
        </Alert>
        {children}
      </div>
    );
  }

  if (mode === "locked") return <LockedScreen mode="locked" />;

  if (mode === "no_seat") {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="max-w-lg w-full space-y-4 border rounded-xl p-6 bg-card">
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-destructive" />
            <h2 className="text-lg font-medium">{t("app.pos.license.deviceLimit")}</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            {t("app.pos.license.seatsInUse", { count: seatCap ?? 1 })}
            {isManager
              ? ` ${t("app.pos.license.managerHelp")}`
              : ` ${t("app.pos.license.staffHelp")}`}
          </p>
          {isManager && activeDevices && activeDevices.length > 0 && (
            <ul className="divide-y rounded-md border">
              {activeDevices.map((d) => (
                <li key={d.id} className="flex items-center justify-between p-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{d.device_label ?? t("app.pos.license.unnamed")}</div>
                    <div className="text-xs text-muted-foreground">
                      {d.platform ?? "web"} · {t("app.pos.license.lastSeen")} {new Date(d.last_seen_at).toLocaleString(i18n.language.startsWith("ar") ? "ar-SA" : "en-US")}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await revokeDevice(d.id);
                    }}
                  >
                    {t("app.pos.license.revoke")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

function LockedScreen({ mode }: { mode: string }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-4 border rounded-xl p-8 bg-card">
        <div className="flex justify-center"><Lock className="h-10 w-10 text-destructive" /></div>
        <h2 className="text-xl font-medium">POS Locked</h2>
        <p className="text-sm text-muted-foreground">
          {mode === "locked"
            ? "Your subscription has lapsed and the grace period has ended. Restore billing to resume POS."
            : "POS access is currently restricted on this device."}
        </p>
        <Button asChild><Link to="/billing">Go to Billing</Link></Button>
      </div>
    </div>
  );
}