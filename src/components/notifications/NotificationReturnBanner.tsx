import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Bell, ArrowLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  clearNotificationContext,
  notificationIdFromSearch,
  openNotificationCenter,
  readNotificationContext,
  type NotificationDeepLinkContext,
} from "@/lib/notificationDeepLink";

/**
 * Shown when the current page was reached from a notification action.
 * Keeps the notification context visible and lets the user jump back to it,
 * even after a reload (context is persisted with a 24h TTL).
 */
export function NotificationReturnBanner() {
  const location = useLocation();
  const navigate = useNavigate();
  const [ctx, setCtx] = useState<NotificationDeepLinkContext | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const notifId = notificationIdFromSearch(location.search);

  useEffect(() => {
    setDismissed(false);
    if (!notifId) {
      setCtx(null);
      return;
    }
    const stored = readNotificationContext();
    setCtx(stored && stored.notificationId === notifId ? stored : null);
  }, [notifId, location.pathname]);

  if (!notifId || !ctx || dismissed) return null;

  return (
    <div className="mx-4 mt-4 mb-2 md:mx-6 flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
      <Bell className="h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{ctx.title}</p>
        {ctx.message && (
          <p className="truncate text-xs text-muted-foreground">{ctx.message}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          onClick={() => openNotificationCenter(ctx.notificationId)}
        >
          <Bell className="mr-1 h-3 w-3" />
          Back to notification
        </Button>
        {ctx.originPath && ctx.originPath !== `${location.pathname}${location.search}` && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => navigate(ctx.originPath)}
          >
            <ArrowLeft className="mr-1 h-3 w-3" />
            Back
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label="Dismiss notification context"
          onClick={() => {
            setDismissed(true);
            clearNotificationContext();
          }}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
