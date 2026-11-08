import { CloudOff, Cloud, RefreshCw, AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { useOfflineStatus } from "@/hooks/useOfflineStatus";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface PendingSyncBadgeProps {
  className?: string;
  /** Compact pill (icon + count only) - use in tight POS headers. */
  compact?: boolean;
}

/**
 * Persistent connectivity + pending-sync indicator for POS surfaces.
 * - Green when online with no queue
 * - Amber when offline (shows pending count if any)
 * - Red when there are failed items needing attention
 * Click navigates to /offline-sync for queue inspection.
 */
export function PendingSyncBadge({ className, compact = false }: PendingSyncBadgeProps) {
  const { t } = useTranslation();
  const { status, pending, failed } = useOfflineStatus();
  const offline = status !== "online";

  const tone = failed > 0
    ? "border-destructive/40 bg-destructive/10 text-destructive"
    : offline || pending > 0
      ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";

  const Icon = failed > 0 ? AlertCircle : offline ? CloudOff : pending > 0 ? RefreshCw : Cloud;

  const label = (() => {
    if (failed > 0) return t("app.pos.sync.failed", { count: failed });
    if (pending > 0) return t("app.pos.sync.pending", { count: pending });
    return offline ? t("app.pos.mobile.offlineStatus") : t("app.pos.mobile.online");
  })();

  return (
    <Link
      to="/offline-sync"
      title={t("app.pos.sync.summary", { status: offline ? t("app.pos.mobile.offlineStatus") : t("app.pos.mobile.online"), pending, failed })}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors hover:opacity-90",
        tone,
        className,
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", pending > 0 && !offline && failed === 0 && "animate-spin")} />
      {!compact && <span className="tabular-nums">{label}</span>}
      {compact && (pending > 0 || failed > 0) && (
        <span className="tabular-nums">{failed > 0 ? failed : pending}</span>
      )}
    </Link>
  );
}

export default PendingSyncBadge;