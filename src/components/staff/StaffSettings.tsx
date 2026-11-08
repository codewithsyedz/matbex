import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, Bell, Loader2, DollarSign } from "lucide-react";
import { useTranslation } from "react-i18next";

interface StaffSettings {
  id: string;
  restaurant_id: string;
  salary_day: number;
  reminder_enabled: boolean;
  reminder_days_before: number;
  reminder_email: string | null;
  include_payroll_in_overhead: boolean;
}

export function StaffSettings() {
  const { restaurant, hasRole } = useAuth();
  const queryClient = useQueryClient();
  const isManager = hasRole("owner") || hasRole("manager");
  const { t, i18n } = useTranslation();

  const [formData, setFormData] = useState({
    salary_day: 1,
    reminder_enabled: false,
    reminder_days_before: 3,
    reminder_email: "",
    include_payroll_in_overhead: true,
  });

  const { data: settings, isLoading } = useQuery({
    queryKey: ["staff-settings", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return null;
      const { data, error } = await supabase
        .from("staff_settings")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .maybeSingle();

      if (error) throw error;
      return data as StaffSettings | null;
    },
    enabled: !!restaurant?.id,
  });

  useEffect(() => {
    if (settings) {
      setFormData({
        salary_day: settings.salary_day,
        reminder_enabled: settings.reminder_enabled,
        reminder_days_before: settings.reminder_days_before,
        reminder_email: settings.reminder_email || "",
        include_payroll_in_overhead: settings.include_payroll_in_overhead,
      });
    }
  }, [settings]);

  const upsertMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      if (!restaurant?.id) throw new Error("No restaurant");

      const payload = {
        restaurant_id: restaurant.id,
        salary_day: data.salary_day,
        reminder_enabled: data.reminder_enabled,
        reminder_days_before: data.reminder_days_before,
        reminder_email: data.reminder_email || null,
        include_payroll_in_overhead: data.include_payroll_in_overhead,
      };

      if (settings?.id) {
        const { error } = await supabase
          .from("staff_settings")
          .update(payload)
          .eq("id", settings.id);
        if (error) throw error;
      } else {
        // A row may already exist but not be visible in this query cache —
        // upsert on the unique restaurant_id avoids duplicate key errors.
        const { error } = await supabase
          .from("staff_settings")
          .upsert(payload, { onConflict: "restaurant_id" });
        if (error) throw error;
      }

    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-settings"] });
      toast.success(t("app.staff.settings.saved"));
    },
    onError: (error: any) => {
      toast.error(error?.message || t("app.staff.settings.saveFailed"));
      console.error(error);
    },

  });

  const handleSave = () => {
    if (formData.reminder_enabled && !formData.reminder_email) {
      toast.error(t("app.staff.settings.emailRequired"));
      return;
    }
    upsertMutation.mutate(formData);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          {t("app.staff.settings.title")}
        </CardTitle>
        <CardDescription>
          {t("app.staff.settings.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Salary Day */}
        <div className="space-y-2">
          <Label htmlFor="salary_day">{t("app.staff.settings.salaryDay")}</Label>
          <Select
            value={formData.salary_day.toString()}
            onValueChange={(v) => setFormData({ ...formData, salary_day: parseInt(v) })}
            disabled={!isManager}
          >
            <SelectTrigger className="w-full max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                <SelectItem key={day} value={day.toString()}>
                  {i18n.language === "ar" ? t("app.staff.settings.monthDay", { day }) : `${day}${day === 1 ? "st" : day === 2 ? "nd" : day === 3 ? "rd" : "th"} ${t("app.staff.settings.eachMonth")}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {t("app.staff.settings.salaryDayHelp")}
          </p>
        </div>

        {/* Include in Overhead */}
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
               <Label>{t("app.staff.settings.includeOverhead")}</Label>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("app.staff.settings.includeOverheadHelp")}
            </p>
          </div>
          <Switch
            checked={formData.include_payroll_in_overhead}
            onCheckedChange={(checked) =>
              setFormData({ ...formData, include_payroll_in_overhead: checked })
            }
            disabled={!isManager}
          />
        </div>

        {/* Email Reminders */}
        <div className="space-y-4 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-muted-foreground" />
                 <Label>{t("app.staff.settings.emailReminders")}</Label>
              </div>
              <p className="text-sm text-muted-foreground">
                {t("app.staff.settings.emailRemindersHelp")}
              </p>
            </div>
            <Switch
              checked={formData.reminder_enabled}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, reminder_enabled: checked })
              }
              disabled={!isManager}
            />
          </div>

          {formData.reminder_enabled && (
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="reminder_email">{t("app.staff.settings.reminderEmail")}</Label>
                <Input
                  id="reminder_email"
                  type="email"
                  placeholder="your@email.com"
                  value={formData.reminder_email}
                  onChange={(e) =>
                    setFormData({ ...formData, reminder_email: e.target.value })
                  }
                  disabled={!isManager}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reminder_days">{t("app.staff.settings.remindBefore")}</Label>
                <Select
                  value={formData.reminder_days_before.toString()}
                  onValueChange={(v) =>
                    setFormData({ ...formData, reminder_days_before: parseInt(v) })
                  }
                  disabled={!isManager}
                >
                  <SelectTrigger className="w-full max-w-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 6, 7].map((days) => (
                      <SelectItem key={days} value={days.toString()}>
                        {t("app.staff.settings.daysBefore", { count: days })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>

        {isManager && (
          <Button onClick={handleSave} disabled={upsertMutation.isPending}>
            {upsertMutation.isPending && (
              <Loader2 className="h-4 w-4 me-2 animate-spin" />
            )}
            {t("app.staff.settings.save")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
