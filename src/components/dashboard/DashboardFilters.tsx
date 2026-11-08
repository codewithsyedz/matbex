import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CalendarIcon, X } from "lucide-react";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, subDays, subWeeks, subYears, startOfDay } from "date-fns";
import { cn } from "@/lib/utils";
import { DateRange } from "react-day-picker";
import { getFiscalMonthRange, getPreviousFiscalMonthRange, useFiscalSettings } from "@/hooks/useFiscalSettings";
import { useTranslation } from "react-i18next";

export type DatePreset = 
  | "today" 
  | "yesterday"
  | "this_week" 
  | "last_week" 
  | "this_month" 
  | "last_month" 
  | "this_year" 
  | "last_year"
  | "last_7_days"
  | "last_30_days"
  | "last_90_days"
  | "custom";

export type ComparisonType = "none" | "previous_period" | "previous_year";

export interface DashboardFilterState {
  preset: DatePreset;
  dateRange: { from: Date; to: Date };
  comparison: ComparisonType;
}

interface DashboardFiltersProps {
  filters: DashboardFilterState;
  onFiltersChange: (filters: DashboardFilterState) => void;
}

const presetLabels: Record<DatePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  this_week: "This Week",
  last_week: "Last Week",
  this_month: "This Month",
  last_month: "Last Month",
  this_year: "This Year",
  last_year: "Last Year",
  last_7_days: "Last 7 Days",
  last_30_days: "Last 30 Days",
  last_90_days: "Last 90 Days",
  custom: "Custom Range",
};

export function getDateRangeFromPreset(preset: DatePreset, monthStartDay: number = 1): { from: Date; to: Date } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      const yesterday = subDays(today, 1);
      return { from: yesterday, to: yesterday };
    case "this_week":
      // Use startOfDay to normalize to midnight, ensuring timezone calculations work correctly
      return { from: startOfWeek(today, { weekStartsOn: 0 }), to: startOfDay(endOfWeek(today, { weekStartsOn: 0 })) };
    case "last_week":
      const lastWeekStart = startOfWeek(subWeeks(today, 1), { weekStartsOn: 0 });
      return { from: lastWeekStart, to: startOfDay(endOfWeek(lastWeekStart, { weekStartsOn: 0 })) };
    case "this_month":
      // Use fiscal month range
      const fiscalRange = getFiscalMonthRange(today, monthStartDay);
      return { from: fiscalRange.start, to: fiscalRange.end };
    case "last_month":
      // Use previous fiscal month range
      const prevFiscalRange = getPreviousFiscalMonthRange(today, monthStartDay);
      return { from: prevFiscalRange.start, to: prevFiscalRange.end };
    case "this_year":
      return { from: startOfYear(today), to: startOfDay(endOfYear(today)) };
    case "last_year":
      const lastYearStart = startOfYear(subYears(today, 1));
      return { from: lastYearStart, to: startOfDay(endOfYear(lastYearStart)) };
    case "last_7_days":
      return { from: subDays(today, 6), to: today };
    case "last_30_days":
      return { from: subDays(today, 29), to: today };
    case "last_90_days":
      return { from: subDays(today, 89), to: today };
    default:
      return { from: today, to: today };
  }
}

export function getComparisonDateRange(
  dateRange: { from: Date; to: Date },
  comparison: ComparisonType
): { from: Date; to: Date } | null {
  if (comparison === "none") return null;
  
  const daysDiff = Math.ceil((dateRange.to.getTime() - dateRange.from.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  
  if (comparison === "previous_period") {
    return {
      from: subDays(dateRange.from, daysDiff),
      to: subDays(dateRange.to, daysDiff),
    };
  }
  
  if (comparison === "previous_year") {
    return {
      from: subYears(dateRange.from, 1),
      to: subYears(dateRange.to, 1),
    };
  }
  
  return null;
}

export function DashboardFilters({ filters, onFiltersChange }: DashboardFiltersProps) {
  const { t } = useTranslation();
  const { monthStartDay } = useFiscalSettings();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: filters.dateRange.from,
    to: filters.dateRange.to,
  });

  const handlePresetChange = (preset: DatePreset) => {
    if (preset === "custom") {
      setCalendarOpen(true);
      onFiltersChange({ ...filters, preset });
    } else {
      const newDateRange = getDateRangeFromPreset(preset, monthStartDay);
      onFiltersChange({ ...filters, preset, dateRange: newDateRange });
    }
  };

  const handleDateRangeSelect = (range: DateRange | undefined) => {
    setDateRange(range);
    if (range?.from && range?.to) {
      onFiltersChange({
        ...filters,
        preset: "custom",
        dateRange: { from: range.from, to: range.to },
      });
    }
  };

  const handleComparisonChange = (comparison: ComparisonType) => {
    onFiltersChange({ ...filters, comparison });
  };

  const clearFilters = () => {
    const defaultRange = getDateRangeFromPreset("yesterday", monthStartDay);
    onFiltersChange({
      preset: "yesterday",
      dateRange: defaultRange,
      comparison: "none",
    });
  };

  const hasActiveFilters = filters.preset !== "yesterday" || filters.comparison !== "none";

  return (
    <div className="flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center gap-2 sm:gap-3">
      {/* Period Preset */}
      <Select value={filters.preset} onValueChange={(value) => handlePresetChange(value as DatePreset)}>
        <SelectTrigger className="w-full sm:w-[160px]">
          <SelectValue placeholder={t("app.dashboard.filters.selectPeriod")} />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(presetLabels) as DatePreset[]).map((preset) => (
            <SelectItem key={preset} value={preset}>{t(`app.dashboard.presets.${preset}`)}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Custom Date Range Picker */}
      {filters.preset === "custom" && (
        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="w-full sm:w-auto justify-start text-start font-normal">
              <CalendarIcon className="me-2 h-4 w-4" />
              {dateRange?.from ? (
                dateRange.to ? (
                  <>
                    {format(dateRange.from, "MMM d")} - {format(dateRange.to, "MMM d, yyyy")}
                  </>
                ) : (
                  format(dateRange.from, "MMM d, yyyy")
                )
              ) : (
                <span>{t("app.dashboard.filters.pickDates")}</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              initialFocus
              mode="range"
              defaultMonth={dateRange?.from}
              selected={dateRange}
              onSelect={handleDateRangeSelect}
              numberOfMonths={1}
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>
      )}

      {/* Comparison */}
      <Select value={filters.comparison} onValueChange={(value) => handleComparisonChange(value as ComparisonType)}>
        <SelectTrigger className="w-full sm:w-[180px]">
          <SelectValue placeholder={t("app.dashboard.filters.compareTo")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{t("app.dashboard.comparison.none", { defaultValue: "No Comparison" })}</SelectItem>
          <SelectItem value="previous_period">{t("app.dashboard.comparison.previousPeriod")}</SelectItem>
          <SelectItem value="previous_year">{t("app.dashboard.comparison.previousYear")}</SelectItem>
        </SelectContent>
      </Select>

      {/* Active Filter Badge */}
      {hasActiveFilters && (
        <Badge variant="secondary" className="flex items-center gap-1">
          {t(`app.dashboard.presets.${filters.preset}`)}
          {filters.comparison !== "none" && (
            <span className="text-muted-foreground">
              {filters.comparison === "previous_period"
                ? t("app.dashboard.comparison.previousPeriod")
                : t("app.dashboard.comparison.previousYear")}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-4 w-4 p-0 ms-1 hover:bg-transparent"
            onClick={clearFilters}
          >
            <X className="h-3 w-3" />
          </Button>
        </Badge>
      )}
    </div>
  );
}
