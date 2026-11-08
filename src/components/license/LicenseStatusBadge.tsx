import { Badge } from "@/components/ui/badge";
import { useContext } from "react";
import { LicenseContext } from "@/contexts/LicenseContext";
import { ShieldAlert, ShieldCheck, ShieldX, Wifi } from "lucide-react";
import { useTranslation } from "react-i18next";

export function LicenseStatusBadge() {
  const { t } = useTranslation();
  const ctx = useContext(LicenseContext);
  if (!ctx) return null;
  const { mode, graceEndsAt } = ctx;

  if (mode === "loading" || mode === "active") return null;

  if (mode === "grace") {
    const days = graceEndsAt
      ? Math.max(0, Math.ceil((new Date(graceEndsAt).getTime() - Date.now()) / 86400000))
      : 0;
    return (
      <Badge variant="outline" className="border-amber-500 text-amber-600 gap-1">
        <ShieldAlert className="h-3 w-3" />
        {t("license.grace", { days })}
      </Badge>
    );
  }

  if (mode === "limited" || mode === "offline_stale") {
    return (
      <Badge variant="destructive" className="gap-1">
        <ShieldX className="h-3 w-3" />
        {mode === "offline_stale" ? t("license.offlineRevalidate") : t("license.closeOutOnly")}
      </Badge>
    );
  }

  if (mode === "locked") {
    return (
      <Badge variant="destructive" className="gap-1">
        <ShieldX className="h-3 w-3" />
        {t("license.locked")}
      </Badge>
    );
  }

  if (mode === "no_seat") {
    return (
      <Badge variant="destructive" className="gap-1">
        <Wifi className="h-3 w-3" />
        {t("license.deviceBlocked")}
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="gap-1">
      <ShieldCheck className="h-3 w-3" />
      {t("license.licensed")}
    </Badge>
  );
}