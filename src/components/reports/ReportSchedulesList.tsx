import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/integrations/db/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Mail, Trash2, Clock, Calendar } from "lucide-react";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import { useTranslation } from "react-i18next";


interface ReportSchedule {
  id: string;
  report_type: string;
  frequency: string;
  email: string;
  day_of_week: number | null;
  day_of_month: number | null;
  is_active: boolean;
  last_sent_at: string | null;
  created_at: string;
}

export function ReportSchedulesList() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language.startsWith("ar") ? ar : enUS;

  const { data: schedules = [], isLoading } = useQuery({
    queryKey: ["report-schedules", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await db
        .from("report_schedules")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ReportSchedule[];
    },
    enabled: !!user?.id,
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await db
        .from("report_schedules")
        .update({ is_active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["report-schedules"] });
    },
    onError: (error: any) => {
      toast.error(error.message || t("reports.schedule.updateFailed"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db
        .from("report_schedules")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["report-schedules"] });
      toast.success(t("reports.schedule.deleted"));
    },
    onError: (error: any) => {
      toast.error(error.message || t("reports.schedule.deleteFailed"));
    },
  });

  const getFrequencyLabel = (schedule: ReportSchedule) => {
    switch (schedule.frequency) {
      case "daily":
        return t("reports.schedule.everyDay");
      case "weekly":
        return t("reports.schedule.everyWeek", { day: t(`reports.schedule.days.${schedule.day_of_week || 0}`) });
      case "monthly":
        return t("reports.schedule.everyMonth", { day: schedule.day_of_month || 1 });
      default:
        return schedule.frequency;
    }
  };



  const getReportTypeColor = (type: string) => {
    switch (type) {
      case "sales":
        return "bg-chart-1/10 text-chart-1 border-chart-1/20";
      case "expenses":
        return "bg-chart-5/10 text-chart-5 border-chart-5/20";
      case "shifts":
        return "bg-chart-3/10 text-chart-3 border-chart-3/20";
      default:
        return "bg-primary/10 text-primary border-primary/20";
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Mail className="h-4 w-4" />
            {t("reports.schedule.scheduled")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-16 rounded-lg skeleton-shimmer" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (schedules.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Mail className="h-4 w-4" />
            {t("reports.schedule.scheduled")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6 text-muted-foreground">
            <Mail className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">{t("reports.schedule.none")}</p>
            <p className="text-xs mt-1">{t("reports.schedule.noneHint")}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Mail className="h-4 w-4" />
          {t("reports.schedule.scheduled")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {schedules.map((schedule) => (
          <div
            key={schedule.id}
            className="p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Badge
                    variant="outline"
                    className={getReportTypeColor(schedule.report_type)}
                  >
                    {t(`reports.schedule.types.${schedule.report_type}`, { defaultValue: schedule.report_type })}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    <Clock className="h-3 w-3 me-1" />
                    {t(`reports.schedule.frequencies.${schedule.frequency}`, { defaultValue: schedule.frequency })}
                  </Badge>
                </div>
                <p className="text-sm text-foreground truncate">{schedule.email}</p>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {getFrequencyLabel(schedule)}
                  </span>
                  {schedule.last_sent_at && (
                    <span>
                      {t("reports.schedule.lastSent", { date: format(new Date(schedule.last_sent_at), "PP", { locale: dateLocale }) })}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={schedule.is_active}
                  onCheckedChange={(checked) =>
                    toggleMutation.mutate({ id: schedule.id, is_active: checked })
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => deleteMutation.mutate(schedule.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
