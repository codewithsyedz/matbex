import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bell, BellOff, Clock, Trash2, UserCog, Settings, Download, Shield, Loader2, Mail, Calendar, Smartphone, BellRing, Volume2, VolumeX, Play, AlertTriangle, Receipt } from "lucide-react";
import { isPushSupported, subscribeToPush, unsubscribeFromPush, checkPushPermission, requestPushPermission } from "@/lib/pushNotifications";
import { Slider } from "@/components/ui/slider";
import { type SoundTheme, previewSound } from "@/lib/notificationSounds";

interface NotificationPreference {
  id?: string;
  email_enabled: boolean;
  in_app_enabled: boolean;
  push_enabled: boolean;
  notification_mode: "instant" | "digest" | "in_app_only";
  digest_day: number;
  sound_enabled: boolean;
  sound_volume: number;
  sound_theme: SoundTheme;
  notify_shift_timestamp_override: boolean;
  notify_delete: boolean;
  notify_bulk_delete: boolean;
  notify_user_role_change: boolean;
  notify_settings_change: boolean;
  notify_data_export: boolean;
  notify_permission_change: boolean;
  notify_zatca_alerts: boolean;
  notify_sale_recorded: boolean;
  notify_expense_recorded: boolean;
}

const defaultPreferences: NotificationPreference = {
  email_enabled: true,
  in_app_enabled: true,
  push_enabled: false,
  notification_mode: "instant",
  digest_day: 1,
  sound_enabled: true,
  sound_volume: 50,
  sound_theme: "default",
  notify_shift_timestamp_override: true,
  notify_delete: true,
  notify_bulk_delete: true,
  notify_user_role_change: true,
  notify_settings_change: false,
  notify_data_export: true,
  notify_permission_change: true,
  notify_zatca_alerts: true,
  notify_sale_recorded: true,
  notify_expense_recorded: true,
};

const SOUND_THEMES: { value: SoundTheme; label: string; description: string }[] = [
  { value: "default", label: "Default", description: "Balanced notification tone" },
  { value: "subtle", label: "Subtle", description: "Soft, gentle notification" },
  { value: "urgent", label: "Urgent", description: "Attention-grabbing alert" },
  { value: "muted", label: "Muted", description: "Very quiet notification" },
];

const DAYS_OF_WEEK = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
];

const NOTIFICATION_OPTIONS = [
  {
    key: "notify_sale_recorded" as const,
    label: "Sale Recorded",
    description: "When a cashier records a new POS sale (owners & managers only)",
    icon: Receipt,
  },
  {
    key: "notify_expense_recorded" as const,
    label: "Expense Recorded",
    description: "When a new expense is recorded, including the branch it belongs to (owners & managers only)",
    icon: Receipt,
  },
  {
    key: "notify_shift_timestamp_override" as const,
    label: "Shift Timestamp Override",
    description: "When someone manually changes shift open/close times",
    icon: Clock,
  },
  {
    key: "notify_delete" as const,
    label: "Record Deletion",
    description: "When important records are deleted",
    icon: Trash2,
  },
  {
    key: "notify_bulk_delete" as const,
    label: "Bulk Deletion",
    description: "When multiple records are deleted at once",
    icon: Trash2,
  },
  {
    key: "notify_user_role_change" as const,
    label: "User Role Changes",
    description: "When a user's role is changed",
    icon: UserCog,
  },
  {
    key: "notify_settings_change" as const,
    label: "Settings Changes",
    description: "When system settings are modified",
    icon: Settings,
  },
  {
    key: "notify_data_export" as const,
    label: "Data Exports",
    description: "When data is exported from the system",
    icon: Download,
  },
  {
    key: "notify_permission_change" as const,
    label: "Permission Changes",
    description: "When user permissions are modified",
    icon: Shield,
  },
  {
    key: "notify_zatca_alerts" as const,
    label: "ZATCA Device & Clearance Alerts",
    description: "Failed clearances, stale invoices, downed devices, expiring CSIDs",
    icon: AlertTriangle,
  },
];

export function NotificationPreferences() {
  const { profile, tenant } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preferences, setPreferences] = useState<NotificationPreference>(defaultPreferences);
  const [pushSupported, setPushSupported] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission>("default");
  const [enablingPush, setEnablingPush] = useState(false);

  useEffect(() => {
    setPushSupported(isPushSupported());
    checkPushPermission().then(setPushPermission);
  }, []);

  useEffect(() => {
    if (profile?.id && tenant?.id) {
      fetchPreferences();
    }
  }, [profile?.id, tenant?.id]);

  const fetchPreferences = async () => {
    if (!profile?.id || !tenant?.id) return;

    try {
      const { data, error } = await supabase
        .from("notification_preferences")
        .select("*")
        .eq("user_id", profile.id)
        .eq("tenant_id", tenant.id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setPreferences({
          id: data.id,
          email_enabled: data.email_enabled,
          in_app_enabled: data.in_app_enabled,
          push_enabled: data.push_enabled,
          notification_mode: data.notification_mode as "instant" | "digest" | "in_app_only",
          digest_day: data.digest_day ?? 1,
          sound_enabled: data.sound_enabled ?? true,
          sound_volume: data.sound_volume ?? 50,
          sound_theme: (data.sound_theme as SoundTheme) ?? "default",
          notify_shift_timestamp_override: data.notify_shift_timestamp_override,
          notify_delete: data.notify_delete,
          notify_bulk_delete: data.notify_bulk_delete,
          notify_user_role_change: data.notify_user_role_change,
          notify_settings_change: data.notify_settings_change,
          notify_data_export: data.notify_data_export,
          notify_permission_change: data.notify_permission_change,
          notify_zatca_alerts: (data as { notify_zatca_alerts?: boolean }).notify_zatca_alerts ?? true,
          notify_sale_recorded: (data as { notify_sale_recorded?: boolean }).notify_sale_recorded ?? true,
          notify_expense_recorded:
            (data as { notify_expense_recorded?: boolean }).notify_expense_recorded ?? true,
        });
      }
    } catch (error) {
      console.error("Error fetching notification preferences:", error);
    } finally {
      setLoading(false);
    }
  };

  const savePreferences = async () => {
    if (!profile?.id || !tenant?.id) return;

    setSaving(true);
    try {
      const { id, ...prefsToSave } = preferences;

      if (id) {
        const { error } = await supabase
          .from("notification_preferences")
          .update(prefsToSave)
          .eq("id", id);

        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("notification_preferences")
          .insert({
            user_id: profile.id,
            tenant_id: tenant.id,
            ...prefsToSave,
          })
          .select()
          .single();

        if (error) throw error;
        setPreferences(prev => ({ ...prev, id: data.id }));
      }

      toast({
        title: "Preferences saved",
        description: "Your notification preferences have been updated.",
      });
    } catch (error) {
      console.error("Error saving notification preferences:", error);
      toast({
        title: "Error",
        description: "Failed to save notification preferences.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const togglePreference = (key: keyof NotificationPreference) => {
    setPreferences(prev => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const enableAll = () => {
    setPreferences(prev => ({
      ...prev,
      notify_shift_timestamp_override: true,
      notify_delete: true,
      notify_bulk_delete: true,
      notify_user_role_change: true,
      notify_settings_change: true,
      notify_data_export: true,
      notify_permission_change: true,
    }));
  };

  const disableAll = () => {
    setPreferences(prev => ({
      ...prev,
      notify_shift_timestamp_override: false,
      notify_delete: false,
      notify_bulk_delete: false,
      notify_user_role_change: false,
      notify_settings_change: false,
      notify_data_export: false,
      notify_permission_change: false,
    }));
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Notification Channels */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Notification Channels
          </CardTitle>
          <CardDescription>
            Choose how you want to receive audit event notifications.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* In-App Toggle */}
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="flex items-center gap-3">
              <Smartphone className="h-5 w-5 text-primary" />
              <div>
                <Label htmlFor="in-app-enabled" className="text-base font-medium">
                  In-App Notifications
                </Label>
                <p className="text-sm text-muted-foreground">
                  See alerts in the notification center (bell icon)
                </p>
              </div>
            </div>
            <Switch
              id="in-app-enabled"
              checked={preferences.in_app_enabled}
              onCheckedChange={() => togglePreference("in_app_enabled")}
            />
          </div>

          {/* Push Notifications */}
          {pushSupported && (
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="flex items-center gap-3">
                <BellRing className={`h-5 w-5 ${preferences.push_enabled ? "text-primary" : "text-muted-foreground"}`} />
                <div>
                  <Label htmlFor="push-enabled" className="text-base font-medium">
                    Push Notifications
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {pushPermission === "denied" 
                      ? "Push notifications are blocked in your browser"
                      : "Get alerts even when the app is closed"}
                  </p>
                </div>
              </div>
              {pushPermission === "denied" ? (
                <span className="text-xs text-muted-foreground">Blocked</span>
              ) : (
                <Switch
                  id="push-enabled"
                  checked={preferences.push_enabled}
                  disabled={enablingPush}
                  onCheckedChange={async (checked) => {
                    if (checked) {
                      setEnablingPush(true);
                      const permission = await requestPushPermission();
                      setPushPermission(permission);
                      
                      if (permission === "granted" && profile?.id && tenant?.id) {
                        const subscription = await subscribeToPush(profile.id, tenant.id);
                        if (subscription) {
                          setPreferences(prev => ({ ...prev, push_enabled: true }));
                          toast({ title: "Push notifications enabled" });
                        } else {
                          toast({ title: "Failed to enable push notifications", variant: "destructive" });
                        }
                      } else if (permission === "denied") {
                        toast({ 
                          title: "Permission denied", 
                          description: "Please enable notifications in your browser settings",
                          variant: "destructive" 
                        });
                      }
                      setEnablingPush(false);
                    } else {
                      if (profile?.id) {
                        await unsubscribeFromPush(profile.id);
                        setPreferences(prev => ({ ...prev, push_enabled: false }));
                        toast({ title: "Push notifications disabled" });
                      }
                    }
                  }}
                />
              )}
            </div>
          )}

          {/* Email Mode */}
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Mail className="h-5 w-5 text-primary" />
              <div>
                <Label className="text-base font-medium">Email Notifications</Label>
                <p className="text-sm text-muted-foreground">
                  Choose when to receive email alerts
                </p>
              </div>
            </div>

            <RadioGroup
              value={preferences.notification_mode}
              onValueChange={(value) =>
                setPreferences(prev => ({
                  ...prev,
                  notification_mode: value as "instant" | "digest" | "in_app_only",
                  email_enabled: value !== "in_app_only",
                }))
              }
              className="grid gap-3"
            >
              <div className="flex items-center space-x-3 rounded-lg border p-4">
                <RadioGroupItem value="instant" id="instant" />
                <div className="flex-1">
                  <Label htmlFor="instant" className="font-medium cursor-pointer">
                    Instant Alerts
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Get an email immediately when a critical event occurs
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-3 rounded-lg border p-4">
                <RadioGroupItem value="digest" id="digest" />
                <div className="flex-1">
                  <Label htmlFor="digest" className="font-medium cursor-pointer">
                    Weekly Digest
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Receive a weekly summary of all audit events
                  </p>
                </div>
                {preferences.notification_mode === "digest" && (
                  <Select
                    value={String(preferences.digest_day)}
                    onValueChange={(value) =>
                      setPreferences(prev => ({ ...prev, digest_day: parseInt(value) }))
                    }
                  >
                    <SelectTrigger className="w-[140px]">
                      <Calendar className="h-4 w-4 mr-2" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DAYS_OF_WEEK.map(day => (
                        <SelectItem key={day.value} value={day.value}>
                          {day.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="flex items-center space-x-3 rounded-lg border p-4">
                <RadioGroupItem value="in_app_only" id="in_app_only" />
                <div className="flex-1">
                  <Label htmlFor="in_app_only" className="font-medium cursor-pointer">
                    In-App Only
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    No email notifications, only in-app alerts
                  </p>
                </div>
              </div>
            </RadioGroup>
          </div>
        </CardContent>
      </Card>

      {/* Sound Settings */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            {preferences.sound_enabled ? (
              <Volume2 className="h-5 w-5" />
            ) : (
              <VolumeX className="h-5 w-5 text-muted-foreground" />
            )}
            Notification Sounds
          </CardTitle>
          <CardDescription>
            Customize how notification sounds play for in-app alerts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Sound Enable Toggle */}
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="flex items-center gap-3">
              <Volume2 className="h-5 w-5 text-primary" />
              <div>
                <Label htmlFor="sound-enabled" className="text-base font-medium">
                  Enable Sounds
                </Label>
                <p className="text-sm text-muted-foreground">
                  Play a sound when new notifications arrive
                </p>
              </div>
            </div>
            <Switch
              id="sound-enabled"
              checked={preferences.sound_enabled}
              onCheckedChange={() => togglePreference("sound_enabled")}
            />
          </div>

          {preferences.sound_enabled && (
            <>
              {/* Volume Slider */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Volume</Label>
                  <span className="text-sm text-muted-foreground">{preferences.sound_volume}%</span>
                </div>
                <div className="flex items-center gap-4">
                  <VolumeX className="h-4 w-4 text-muted-foreground" />
                  <Slider
                    value={[preferences.sound_volume]}
                    onValueChange={([value]) =>
                      setPreferences(prev => ({ ...prev, sound_volume: value }))
                    }
                    max={100}
                    step={5}
                    className="flex-1"
                  />
                  <Volume2 className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>

              {/* Sound Theme Selection */}
              <div className="space-y-3">
                <Label className="text-sm font-medium">Sound Theme</Label>
                <div className="grid gap-3">
                  {SOUND_THEMES.map((theme) => (
                    <div
                      key={theme.value}
                      className={`flex items-center justify-between rounded-lg border p-4 cursor-pointer transition-colors ${
                        preferences.sound_theme === theme.value
                          ? "border-primary bg-primary/5"
                          : "hover:bg-muted/50"
                      }`}
                      onClick={() => setPreferences(prev => ({ ...prev, sound_theme: theme.value }))}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="radio"
                          name="sound_theme"
                          value={theme.value}
                          checked={preferences.sound_theme === theme.value}
                          onChange={() => setPreferences(prev => ({ ...prev, sound_theme: theme.value }))}
                          className="h-4 w-4 accent-primary"
                        />
                        <div>
                          <Label className="font-medium cursor-pointer">{theme.label}</Label>
                          <p className="text-xs text-muted-foreground">{theme.description}</p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          previewSound(theme.value, preferences.sound_volume);
                        }}
                      >
                        <Play className="h-4 w-4 mr-1" />
                        Preview
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Event Types */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Event Types</CardTitle>
          <CardDescription>
            Select which critical security events you want to be notified about.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={enableAll}>
              Enable all
            </Button>
            <Button variant="ghost" size="sm" onClick={disableAll}>
              Disable all
            </Button>
          </div>

          <div className="space-y-3">
            {NOTIFICATION_OPTIONS.map((option) => {
              const Icon = option.icon;
              const isEnabled = preferences[option.key];

              return (
                <div
                  key={option.key}
                  className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
                >
                  <div className="flex items-center gap-3">
                    <Icon
                      className={`h-4 w-4 ${
                        isEnabled ? "text-primary" : "text-muted-foreground"
                      }`}
                    />
                    <div>
                      <Label
                        htmlFor={option.key}
                        className="text-sm font-medium cursor-pointer"
                      >
                        {option.label}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {option.description}
                      </p>
                    </div>
                  </div>
                  <Switch
                    id={option.key}
                    checked={isEnabled}
                    onCheckedChange={() => togglePreference(option.key)}
                  />
                </div>
              );
            })}
          </div>

          <Separator />

          <div className="flex justify-end">
            <Button onClick={savePreferences} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Preferences
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
