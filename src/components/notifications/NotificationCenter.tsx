import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { toast as sonnerToast } from "sonner";
import { useToastSettings } from "@/hooks/useToastSettings";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Bell, 
  Check, 
  CheckCheck, 
  Clock, 
  Trash2, 
  UserCog, 
  Settings, 
  Download, 
  Shield,
  AlertTriangle,
  Loader2,
  Filter,
  X,
  Calendar,
  ClipboardCheck,
  FileText,
  CheckCircle2,
  XCircle,
  Receipt,
  Banknote,
  ExternalLink,
} from "lucide-react";
import { formatDistanceToNow, isAfter, isBefore, parseISO, startOfDay, endOfDay } from "date-fns";
import { useNavigate, useLocation } from "react-router-dom";
import { playNotificationSound, getSoundThemeForAction, type SoundTheme } from "@/lib/notificationSounds";
import {
  buildNotificationDeepLink,
  OPEN_NOTIFICATION_CENTER_EVENT,
} from "@/lib/notificationDeepLink";

interface Notification {
  id: string;
  title: string;
  message: string;
  action_type: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: unknown;
  is_read: boolean;
  created_at: string;
}

const ACTION_ICONS: Record<string, typeof Clock> = {
  SHIFT_TIMESTAMP_OVERRIDE: Clock,
  DELETE: Trash2,
  BULK_DELETE: Trash2,
  USER_ROLE_CHANGE: UserCog,
  SETTINGS_CHANGE: Settings,
  DATA_EXPORT: Download,
  PERMISSION_CHANGE: Shield,
  cogs_reminder: ClipboardCheck,
  journal_entry_pending: FileText,
  journal_entry_approved: CheckCircle2,
  journal_entry_rejected: XCircle,
  sale_recorded: Receipt,
  expense_recorded: Banknote,
  daily_overhead_posted: CheckCircle2,
  daily_overhead_posting_failed: XCircle,
};

function buildExpenseLink(notification: Notification): string | null {
  const expenseId = notification.entity_id;
  const isExpense =
    notification.action_type === "expense_recorded" || notification.entity_type === "expense";
  if (!expenseId || !isExpense) return null;
  const branchId =
    (notification.metadata as { branch_id?: string | null } | null)?.branch_id ?? null;
  const params = new URLSearchParams({ expense: expenseId });
  if (branchId) params.set("branch", branchId);
  return `/expenses?${params.toString()}`;
}

function buildOverheadLink(notification: Notification): string | null {
  if (
    notification.action_type !== "daily_overhead_posted" &&
    notification.action_type !== "daily_overhead_posting_failed"
  ) {
    return null;
  }
  const meta = (notification.metadata ?? null) as
    | { link?: string | null; business_date?: string | null; branch_id?: string | null }
    | null;
  if (meta?.link) return meta.link;
  const params = new URLSearchParams();
  if (meta?.business_date) params.set("date", String(meta.business_date));
  if (meta?.branch_id) params.set("branch", String(meta.branch_id));
  const qs = params.toString();
  return `/accounting/daily-overhead${qs ? `?${qs}` : ""}`;
}

interface NotificationAction {
  label: string;
  href: string;
  /** primary = main navigation target, secondary = supporting detail view */
  kind: "primary" | "secondary";
}

function notificationMeta(notification: Notification) {
  return (notification.metadata ?? null) as
    | {
        branch_id?: string | null;
        branch_name?: string | null;
        business_date?: string | null;
        supplier_id?: string | null;
        gl_reference?: string | null;
        batch_id?: string | null;
      }
    | null;
}

function buildNotificationActions(notification: Notification): NotificationAction[] {
  const meta = notificationMeta(notification);
  const branchId = meta?.branch_id ?? null;
  const actions: NotificationAction[] = [];
  const push = (label: string, href: string, kind: NotificationAction["kind"] = "secondary") =>
    actions.push({ label, href, kind });

  const withBranch = (base: string) => {
    if (!branchId) return base;
    return `${base}${base.includes("?") ? "&" : "?"}branch=${branchId}`;
  };

  const expenseLink = buildExpenseLink(notification);
  if (expenseLink) {
    push("View expense", expenseLink, "primary");
    push("AP aging", withBranch("/reports/ap-aging"));
    push("Ledger mapping", withBranch("/reports/ledger-mapping"));
    return actions;
  }

  const overheadLink = buildOverheadLink(notification);
  if (overheadLink) {
    push(
      notification.action_type === "daily_overhead_posting_failed"
        ? "Review & retry"
        : "View entry",
      overheadLink,
      "primary"
    );
    push("Trial balance", withBranch("/reports/trial-balance"));
    push("Overhead audit", withBranch("/reports/overhead-audit"));
    return actions;
  }

  if (notification.action_type === "cogs_reminder") {
    push("Open stocktake", "/cockpit/stocktake", "primary");
    push("Inventory", withBranch("/inventory"));
    return actions;
  }

  if (
    notification.action_type === "journal_entry_pending" ||
    notification.action_type === "journal_entry_approved" ||
    notification.action_type === "journal_entry_rejected"
  ) {
    const batchId = notification.entity_id ?? meta?.batch_id ?? null;
    const params = new URLSearchParams();
    if (batchId) params.set("batch", batchId);
    if (branchId) params.set("branch", branchId);
    const qs = params.toString();
    push(
      notification.action_type === "journal_entry_pending" ? "Review entry" : "View entry",
      `/accounting${qs ? `?${qs}` : ""}`,
      "primary"
    );
    push("Trial balance", withBranch("/reports/trial-balance"));
    push("Posting rule audit", withBranch("/accounting/posting-rule-audit"));
    return actions;
  }

  if (notification.action_type === "sale_recorded") {
    push("View sales", withBranch("/sales"), "primary");
    push("Daily profit", withBranch("/daily-profit"));
    return actions;
  }

  return actions;
}

const ACTION_LABELS: Record<string, string> = {
  expense_recorded: "New Expense",
  SHIFT_TIMESTAMP_OVERRIDE: "Shift Override",
  DELETE: "Deletion",
  BULK_DELETE: "Bulk Delete",
  USER_ROLE_CHANGE: "Role Change",
  SETTINGS_CHANGE: "Settings",
  DATA_EXPORT: "Export",
  PERMISSION_CHANGE: "Permission",
  cogs_reminder: "COGS Reminder",
  journal_entry_pending: "Pending Approval",
  journal_entry_approved: "Entry Approved",
  journal_entry_rejected: "Entry Rejected",
  sale_recorded: "New Sale",
  daily_overhead_posted: "Overhead Posted",
  daily_overhead_posting_failed: "Overhead Failed",
};

export function NotificationCenter() {
  const { profile, tenant, isManager } = useAuth();
  const { toast } = useToast();
  const { toastPosition } = useToastSettings();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // Guard against repeated clicks on a notification action: a second navigate()
  // while the first is still resolving can make route guards bounce.
  const navigatingRef = useRef<string | null>(null);
  const [navigatingTo, setNavigatingTo] = useState<string | null>(null);

  const releaseNavigationLock = useCallback(() => {
    navigatingRef.current = null;
    setNavigatingTo(null);
  }, []);

  // Release once the route actually changed, with a safety timeout in case the
  // destination equals the current location (navigate() is then a no-op).
  useEffect(() => {
    if (!navigatingTo) return;
    releaseNavigationLock();
  }, [location.key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!navigatingTo) return;
    const timer = window.setTimeout(releaseNavigationLock, 1200);
    return () => window.clearTimeout(timer);
  }, [navigatingTo, releaseNavigationLock]);

  /** Single entry point for every notification action navigation. */
  const goToNotification = useCallback(
    (input: {
      href: string;
      notificationId: string;
      title: string;
      message?: string | null;
      actionLabel: string;
    }) => {
      if (navigatingRef.current) return;
      const target = buildNotificationDeepLink(input);
      navigatingRef.current = target;
      setNavigatingTo(target);
      setOpen(false);
      navigate(target);
    },
    [navigate],
  );

  // Allow any page (e.g. the notification return banner) to reopen this panel
  // and focus the notification the user came from.
  useEffect(() => {
    const handler = (event: Event) => {
      const id = (event as CustomEvent<{ notificationId?: string }>).detail?.notificationId ?? null;
      setFocusedId(id);
      setOpen(true);
    };
    window.addEventListener(OPEN_NOTIFICATION_CENTER_EVENT, handler);
    return () => window.removeEventListener(OPEN_NOTIFICATION_CENTER_EVENT, handler);
  }, []);
  
  // Filters
  const [showFilters, setShowFilters] = useState(false);
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  
  // Sound preferences
  const [soundPrefs, setSoundPrefs] = useState<{
    enabled: boolean;
    volume: number;
    theme: SoundTheme;
  }>({ enabled: true, volume: 50, theme: "default" });

  // Fetch sound preferences
  useEffect(() => {
    const fetchSoundPrefs = async () => {
      if (!profile?.id || !tenant?.id) return;
      
      const { data } = await supabase
        .from("notification_preferences")
        .select("sound_enabled, sound_volume, sound_theme")
        .eq("user_id", profile.id)
        .eq("tenant_id", tenant.id)
        .maybeSingle();
      
      if (data) {
        setSoundPrefs({
          enabled: data.sound_enabled ?? true,
          volume: data.sound_volume ?? 50,
          theme: (data.sound_theme as SoundTheme) ?? "default",
        });
      }
    };
    
    fetchSoundPrefs();
  }, [profile?.id, tenant?.id]);

  const playSound = useCallback((actionType: string) => {
    if (!soundPrefs.enabled || soundPrefs.volume === 0) return;
    
    // Use action-specific sound or fall back to user's preferred theme
    const soundTheme = getSoundThemeForAction(actionType) || soundPrefs.theme;
    playNotificationSound(soundTheme, soundPrefs.volume);
  }, [soundPrefs]);

  useEffect(() => {
    if (profile?.id && tenant?.id) {
      fetchNotifications();
      const cleanup = subscribeToNotifications();
      return cleanup;
    }
  }, [profile?.id, tenant?.id]);

  const fetchNotifications = async () => {
    if (!profile?.id) return;

    try {
      const { data, error } = await supabase
        .from("in_app_notifications")
        .select("*")
        .eq("user_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;

      setNotifications(data || []);
      setUnreadCount(data?.filter(n => !n.is_read).length || 0);
    } catch (error) {
      console.error("Error fetching notifications:", error);
    } finally {
      setLoading(false);
    }
  };

  const subscribeToNotifications = () => {
    if (!profile?.id) return () => {};

    const channel = supabase
      .channel("notifications-realtime")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "in_app_notifications",
          filter: `user_id=eq.${profile.id}`,
        },
        (payload) => {
          const newNotification = payload.new as Notification;
          setNotifications(prev => [newNotification, ...prev]);
          setUnreadCount(prev => prev + 1);
          
          // Play notification sound
          playSound(newNotification.action_type);
          
          const branchName =
            (newNotification as { metadata?: { branch_name?: string | null; branch_code?: string | null } })
              .metadata?.branch_name ?? null;
          const branchCode =
            (newNotification as { metadata?: { branch_code?: string | null } }).metadata?.branch_code ?? null;
          const branchLine = branchName
            ? `Branch: ${branchName}${branchCode ? ` (${branchCode})` : ""}`
            : null;

          const actions = buildNotificationActions(newNotification);

          if (actions.length === 0) {
            sonnerToast(newNotification.title, {
              description: branchLine
                ? `${newNotification.message}\n${branchLine}`
                : newNotification.message,
              position: toastPosition,
            });
          } else {
            sonnerToast.custom(
              (id) => (
                <div className="w-[356px] rounded-lg border bg-background p-4 shadow-lg">
                  <p className="text-sm font-medium leading-tight">{newNotification.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {newNotification.message}
                  </p>
                  {branchLine && (
                    <p className="mt-1 text-xs text-muted-foreground">{branchLine}</p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {actions.map((action) => (
                      <Button
                        key={`${action.kind}-${action.href}`}
                        size="sm"
                        variant={action.kind === "primary" ? "default" : "outline"}
                        className="h-7 px-2 text-xs"
                        disabled={!!navigatingRef.current}
                        onClick={() => {
                          markAsRead(newNotification.id);
                          sonnerToast.dismiss(id);
                          goToNotification({
                            href: action.href,
                            notificationId: newNotification.id,
                            title: newNotification.title,
                            message: newNotification.message,
                            actionLabel: action.label,
                          });
                        }}
                      >
                        {action.label}
                      </Button>
                    ))}
                  </div>
                </div>
              ),
              { position: toastPosition }
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  // Filtered notifications
  const filteredNotifications = useMemo(() => {
    return notifications.filter(notification => {
      // Action type filter
      if (actionFilter !== "all" && notification.action_type !== actionFilter) {
        return false;
      }

      // Date from filter
      if (dateFrom) {
        const notifDate = parseISO(notification.created_at);
        const fromDate = startOfDay(parseISO(dateFrom));
        if (isBefore(notifDate, fromDate)) {
          return false;
        }
      }

      // Date to filter
      if (dateTo) {
        const notifDate = parseISO(notification.created_at);
        const toDate = endOfDay(parseISO(dateTo));
        if (isAfter(notifDate, toDate)) {
          return false;
        }
      }

      return true;
    });
  }, [notifications, actionFilter, dateFrom, dateTo]);

  const hasActiveFilters = actionFilter !== "all" || dateFrom || dateTo;

  const clearFilters = () => {
    setActionFilter("all");
    setDateFrom("");
    setDateTo("");
  };

  const markAsRead = async (notificationId: string) => {
    try {
      const { error } = await supabase
        .from("in_app_notifications")
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq("id", notificationId);

      if (error) throw error;

      setNotifications(prev =>
        prev.map(n =>
          n.id === notificationId ? { ...n, is_read: true } : n
        )
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (error) {
      console.error("Error marking notification as read:", error);
    }
  };

  const markAllAsRead = async () => {
    if (!profile?.id) return;

    try {
      const { error } = await supabase
        .from("in_app_notifications")
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq("user_id", profile.id)
        .eq("is_read", false);

      if (error) throw error;

      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnreadCount(0);
      
      toast({ title: "All notifications marked as read" });
    } catch (error) {
      console.error("Error marking all as read:", error);
    }
  };

  const getActionIcon = (actionType: string) => {
    return ACTION_ICONS[actionType] || AlertTriangle;
  };

  const handleApprove = async (notification: Notification) => {
    const batchId = (notification.entity_id ?? null) as string | null;
    if (!batchId) return;
    setDecidingId(notification.id);
    try {
      const { error } = await supabase.rpc("approve_journal_entry", {
        p_batch_id: batchId,
      });
      if (error) throw error;
      toast({ title: "Journal entry approved and posted to the ledger." });
      await markAsRead(notification.id);
    } catch (err: any) {
      toast({
        title: "Could not approve entry",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDecidingId(null);
    }
  };

  const handleReject = async (notification: Notification) => {
    const batchId = (notification.entity_id ?? null) as string | null;
    if (!batchId) return;
    const reason = window.prompt("Reason for rejecting this journal entry?");
    if (!reason || !reason.trim()) return;
    setDecidingId(notification.id);
    try {
      const { error } = await supabase.rpc("reject_journal_entry", {
        p_batch_id: batchId,
        p_reason: reason.trim(),
      });
      if (error) throw error;
      toast({ title: "Journal entry rejected." });
      await markAsRead(notification.id);
    } catch (err: any) {
      toast({
        title: "Could not reject entry",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDecidingId(null);
    }
  };

  const uniqueActionTypes = useMemo(() => {
    const types = new Set(notifications.map(n => n.action_type));
    return Array.from(types);
  }, [notifications]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge 
              variant="destructive" 
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h4 className="font-semibold">Notifications</h4>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter className={`h-4 w-4 ${hasActiveFilters ? "text-primary" : ""}`} />
            </Button>
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={markAllAsRead}
                className="text-xs h-8"
              >
                <CheckCheck className="h-3 w-3 mr-1" />
                Mark all
              </Button>
            )}
          </div>
        </div>

        {/* Filters */}
        {showFilters && (
          <div className="p-3 border-b bg-muted/30 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Filters</span>
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={clearFilters}>
                  <X className="h-3 w-3 mr-1" />
                  Clear
                </Button>
              )}
            </div>
            
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="All event types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All event types</SelectItem>
                {uniqueActionTypes.map(type => (
                  <SelectItem key={type} value={type}>
                    {ACTION_LABELS[type] || type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground mb-1 block">From</label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs text-muted-foreground mb-1 block">To</label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>

            {hasActiveFilters && (
              <p className="text-xs text-muted-foreground">
                Showing {filteredNotifications.length} of {notifications.length} notifications
              </p>
            )}
          </div>
        )}

        {/* Notification List */}
        <ScrollArea className="h-[350px]">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center px-4">
              <Bell className="h-10 w-10 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                {hasActiveFilters ? "No matching notifications" : "No notifications yet"}
              </p>
              {hasActiveFilters && (
                <Button variant="link" size="sm" onClick={clearFilters} className="mt-1">
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            <div className="divide-y">
              {filteredNotifications.map((notification) => {
                const Icon = getActionIcon(notification.action_type);
                const rowActions = buildNotificationActions(notification);
                const primaryAction = rowActions.find((a) => a.kind === "primary");

                return (
                  <div
                    key={notification.id}
                    className={`p-4 hover:bg-muted/50 transition-colors cursor-pointer ${
                      !notification.is_read ? "bg-accent/30" : ""
                    } ${
                      focusedId === notification.id
                        ? "ring-2 ring-inset ring-primary/60 bg-primary/5"
                        : ""
                    }`}
                    onClick={() => {
                      if (!notification.is_read) markAsRead(notification.id);
                      if (primaryAction) {
                        goToNotification({
                          href: primaryAction.href,
                          notificationId: notification.id,
                          title: notification.title,
                          message: notification.message,
                          actionLabel: primaryAction.label,
                        });
                      }
                    }}
                  >
                    <div className="flex gap-3">
                      <div className={`p-2 rounded-full shrink-0 ${
                        !notification.is_read 
                          ? "bg-destructive/10 text-destructive" 
                          : "bg-muted text-muted-foreground"
                      }`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-sm font-medium leading-tight ${
                            !notification.is_read ? "text-foreground" : "text-muted-foreground"
                          }`}>
                            {notification.title}
                          </p>
                          {!notification.is_read && (
                            <div className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1" />
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {notification.message}
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                          <Badge variant="outline" className="text-[10px] h-5">
                            {ACTION_LABELS[notification.action_type] || notification.action_type}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                          </span>
                        </div>
                        {rowActions.length > 0 && (
                          <div
                            className="mt-2 flex flex-wrap items-center gap-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {rowActions.map((action) => (
                              <Button
                                key={`${action.kind}-${action.href}`}
                                size="sm"
                                variant={action.kind === "primary" ? "secondary" : "ghost"}
                                className="h-7 px-2 text-xs"
                                disabled={!!navigatingTo}
                                onClick={() => {
                                  if (!notification.is_read) markAsRead(notification.id);
                                  goToNotification({
                                    href: action.href,
                                    notificationId: notification.id,
                                    title: notification.title,
                                    message: notification.message,
                                    actionLabel: action.label,
                                  });
                                }}
                              >
                                {action.label}
                                {action.kind === "primary" &&
                                (notification.metadata as { branch_name?: string | null } | null)
                                  ?.branch_name
                                  ? ` · ${(notification.metadata as { branch_name?: string }).branch_name}`
                                  : ""}
                                <ExternalLink className="h-3 w-3 ml-1" />
                              </Button>
                            ))}
                          </div>
                        )}
                        {notification.action_type === "journal_entry_pending" && isManager && (
                          <div
                            className="flex items-center gap-2 mt-3"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Button
                              size="sm"
                              className="h-7 px-2 text-xs"
                              disabled={decidingId === notification.id}
                              onClick={() => handleApprove(notification)}
                            >
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-7 px-2 text-xs"
                              disabled={decidingId === notification.id}
                              onClick={() => handleReject(notification)}
                            >
                              <XCircle className="h-3 w-3 mr-1" />
                              Reject
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        {notifications.length > 0 && (
          <>
            <Separator />
            <div className="p-2">
              <Button
                variant="ghost"
                className="w-full text-sm"
                onClick={() => {
                  setOpen(false);
                  navigate("/audit-logs");
                }}
              >
                View all in Audit Logs
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
