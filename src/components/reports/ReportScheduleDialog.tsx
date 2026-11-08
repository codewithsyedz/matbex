import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Mail, Calendar, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ReportScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScheduleCreated: () => void;
}

const DAYS_OF_WEEK = ["0", "1", "2", "3", "4", "5", "6"] as const;

export function ReportScheduleDialog({
  open,
  onOpenChange,
  onScheduleCreated,
}: ReportScheduleDialogProps) {
  const { user, restaurant } = useAuth();
  const { t } = useTranslation();
  const [reportType, setReportType] = useState("full");
  const [frequency, setFrequency] = useState("daily");
  const [email, setEmail] = useState(user?.email || "");
  const [dayOfWeek, setDayOfWeek] = useState("1");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user?.id || !restaurant?.id) {
      toast.error(t("reports.schedule.authRequired"));
      return;
    }

    if (!email) {
      toast.error(t("reports.schedule.emailRequired"));
      return;
    }

    setIsSubmitting(true);

    try {
      const scheduleData: any = {
        user_id: user.id,
        restaurant_id: restaurant.id,
        report_type: reportType,
        frequency,
        email,
        is_active: true,
      };

      if (frequency === "weekly") {
        scheduleData.day_of_week = parseInt(dayOfWeek);
      } else if (frequency === "monthly") {
        scheduleData.day_of_month = parseInt(dayOfMonth);
      }

      const { error } = await supabase
        .from("report_schedules")
        .insert(scheduleData);

      if (error) throw error;

      toast.success(t("reports.schedule.created"));
      onOpenChange(false);
      onScheduleCreated();
      
      // Reset form
      setReportType("full");
      setFrequency("daily");
      setDayOfWeek("1");
      setDayOfMonth("1");
    } catch (error: any) {
      console.error("Error creating schedule:", error);
      toast.error(error.message || t("reports.schedule.createFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            {t("reports.schedule.title")}
          </DialogTitle>
          <DialogDescription>
            {t("reports.schedule.description")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-2 grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="email">{t("reports.schedule.email")}</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("reports.schedule.emailPlaceholder")}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t("reports.schedule.reportType")}</Label>
            <Select value={reportType} onValueChange={setReportType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full">{t("reports.schedule.types.full")}</SelectItem>
                <SelectItem value="sales">{t("reports.schedule.types.sales")}</SelectItem>
                <SelectItem value="expenses">{t("reports.schedule.types.expenses")}</SelectItem>
                <SelectItem value="shifts">{t("reports.schedule.types.shifts")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              {t("reports.schedule.frequency")}
            </Label>
            <Select value={frequency} onValueChange={setFrequency}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">{t("reports.schedule.frequencies.daily")}</SelectItem>
                <SelectItem value="weekly">{t("reports.schedule.frequencies.weekly")}</SelectItem>
                <SelectItem value="monthly">{t("reports.schedule.frequencies.monthly")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {frequency === "weekly" && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                {t("reports.schedule.dayOfWeek")}
              </Label>
              <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAYS_OF_WEEK.map((day) => (
                    <SelectItem key={day} value={day}>
                      {t(`reports.schedule.days.${day}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {frequency === "monthly" && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                {t("reports.schedule.dayOfMonth")}
              </Label>
              <Select value={dayOfMonth} onValueChange={setDayOfMonth}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                    <SelectItem key={day} value={day.toString()}>
                      {day}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("reports.schedule.monthHint")}
              </p>
            </div>
          )}

          <div className="flex justify-end rtl:justify-start gap-2 border-t border-border/70 pt-4 sm:col-span-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("reports.schedule.cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t("reports.schedule.creating") : t("reports.schedule.create")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
