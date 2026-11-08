import { useState } from "react";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { 
  Filter, 
  X, 
  Search, 
  CalendarIcon,
  ChevronDown,
  Clock
} from "lucide-react";
import { format, subDays, startOfYear } from "date-fns";
import { cn } from "@/lib/utils";
import { getFiscalMonthRange, getPreviousFiscalMonthRange } from "@/hooks/useFiscalSettings";
import { useTranslation } from "react-i18next";

export interface SalesFiltersState {
  search: string;
  paymentMethod: string;
  settlementStatus: string;
  dateFrom: string;
  dateTo: string;
  timeFrom: string;
  timeTo: string;
  amountMin: string;
  amountMax: string;
  sortBy: string;
  sortOrder: "asc" | "desc";
}

interface SalesFiltersProps {
  filters: SalesFiltersState;
  onFiltersChange: (filters: SalesFiltersState) => void;
  totalFiltered: number;
  totalCount: number;
  currency?: string;
  monthStartDay?: number;
}

const getDatePresets = (monthStartDay: number, t: (k: string) => string) => {
  const today = new Date();
  const fiscalMonth = getFiscalMonthRange(today, monthStartDay);
  const prevFiscalMonth = getPreviousFiscalMonthRange(today, monthStartDay);
  return [
    { label: t("app.salesFilters.presets.today"), getValue: () => ({ from: new Date(), to: new Date() }) },
    { label: t("app.salesFilters.presets.yesterday"), getValue: () => ({ from: subDays(new Date(), 1), to: subDays(new Date(), 1) }) },
    { label: t("app.salesFilters.presets.last7"), getValue: () => ({ from: subDays(new Date(), 7), to: new Date() }) },
    { label: t("app.salesFilters.presets.last30"), getValue: () => ({ from: subDays(new Date(), 30), to: new Date() }) },
    { label: t("app.salesFilters.presets.thisMonth"), getValue: () => ({ from: fiscalMonth.start, to: fiscalMonth.end }) },
    { label: t("app.salesFilters.presets.lastMonth"), getValue: () => ({ from: prevFiscalMonth.start, to: prevFiscalMonth.end }) },
    { label: t("app.salesFilters.presets.thisYear"), getValue: () => ({ from: startOfYear(new Date()), to: new Date() }) },
  ];
};

export function SalesFilters({ 
  filters, 
  onFiltersChange, 
  totalFiltered,
  totalCount,
  currency = "SAR",
  monthStartDay = 1,
}: SalesFiltersProps) {
  const { t } = useTranslation();
  const PAYMENT_METHODS = [
    { value: "cash", label: t("app.salesFilters.methods.cash") },
    { value: "card", label: t("app.salesFilters.methods.card") },
    { value: "other", label: t("app.salesFilters.methods.other") },
  ];
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [datePickerMode, setDatePickerMode] = useState<"from" | "to">("from");
  
  const datePresets = getDatePresets(monthStartDay, t);

  const activeFiltersCount = [
    filters.search,
    filters.paymentMethod,
    filters.settlementStatus && filters.settlementStatus !== "all" ? filters.settlementStatus : "",
    filters.dateFrom,
    filters.dateTo,
    filters.timeFrom,
    filters.timeTo,
    filters.amountMin,
    filters.amountMax,
  ].filter(Boolean).length;

  const updateFilter = (key: keyof SalesFiltersState, value: string) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const applyDatePreset = (preset: ReturnType<typeof getDatePresets>[0]) => {
    const { from, to } = preset.getValue();
    onFiltersChange({
      ...filters,
      dateFrom: format(from, "yyyy-MM-dd"),
      dateTo: format(to, "yyyy-MM-dd"),
    });
  };

  const clearFilters = () => {
    const fiscalMonth = getFiscalMonthRange(new Date(), monthStartDay);
    onFiltersChange({
      search: "",
      paymentMethod: "",
      settlementStatus: "all",
      dateFrom: format(fiscalMonth.start, "yyyy-MM-dd"),
      dateTo: format(fiscalMonth.end, "yyyy-MM-dd"),
      timeFrom: "",
      timeTo: "",
      amountMin: "",
      amountMax: "",
      sortBy: "created_at",
      sortOrder: "desc",
    });
  };

  const handleDateSelect = (date: Date | undefined) => {
    if (!date) return;
    if (datePickerMode === "from") {
      updateFilter("dateFrom", format(date, "yyyy-MM-dd"));
      setDatePickerMode("to");
    } else {
      updateFilter("dateTo", format(date, "yyyy-MM-dd"));
      setIsDatePickerOpen(false);
      setDatePickerMode("from");
    }
  };

  return (
    <div className="space-y-4">
      {/* Main filter bar */}
      <div className="flex flex-wrap gap-3 items-center">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("app.salesFilters.searchPlaceholder")}
            value={filters.search}
            onChange={(e) => updateFilter("search", e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Payment method filter */}
        <Select value={filters.paymentMethod} onValueChange={(v) => updateFilter("paymentMethod", v)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder={t("app.salesFilters.allPayments")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("app.salesFilters.allPayments")}</SelectItem>
            {PAYMENT_METHODS.map((method) => (
              <SelectItem key={method.value} value={method.value}>
                {method.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Settlement status filter (paid / unpaid) */}
        <Select
          value={filters.settlementStatus || "all"}
          onValueChange={(v) => updateFilter("settlementStatus", v)}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder={t("app.salesFilters.allStatuses")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("app.salesFilters.allStatuses")}</SelectItem>
            <SelectItem value="paid">{t("app.salesFilters.paid")}</SelectItem>
            <SelectItem value="unpaid">{t("app.salesFilters.unpaid")}</SelectItem>
          </SelectContent>
        </Select>

        {/* Date range */}
        <Popover open={isDatePickerOpen} onOpenChange={setIsDatePickerOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="min-w-[200px] justify-start">
              <CalendarIcon className="h-4 w-4 mr-2" />
              {filters.dateFrom || filters.dateTo ? (
                <span>
                  {filters.dateFrom ? format(new Date(filters.dateFrom), "MMM d") : t("app.salesFilters.start")}
                  {" - "}
                  {filters.dateTo ? format(new Date(filters.dateTo), "MMM d") : t("app.salesFilters.end")}
                </span>
              ) : (
                <span>{t("app.salesFilters.dateRange")}</span>
              )}
              <ChevronDown className="ml-auto h-4 w-4 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <div className="flex">
              <div className="border-r p-2 space-y-1">
                <p className="text-xs font-medium text-muted-foreground px-2 py-1">{t("app.salesFilters.quickSelect")}</p>
                {datePresets.map((preset) => (
                  <Button
                    key={preset.label}
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => {
                      applyDatePreset(preset);
                      setIsDatePickerOpen(false);
                    }}
                  >
                    {preset.label}
                  </Button>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-muted-foreground"
                  onClick={() => {
                    updateFilter("dateFrom", "");
                    updateFilter("dateTo", "");
                    setIsDatePickerOpen(false);
                  }}
                >
                  {t("app.salesFilters.clearDates")}
                </Button>
              </div>
              <div className="p-2">
                <p className="text-xs font-medium text-muted-foreground px-2 py-1">
                  {datePickerMode === "from" ? t("app.salesFilters.selectStart") : t("app.salesFilters.selectEnd")}
                </p>
                <Calendar
                  mode="single"
                  selected={
                    datePickerMode === "from" && filters.dateFrom
                      ? new Date(filters.dateFrom)
                      : datePickerMode === "to" && filters.dateTo
                      ? new Date(filters.dateTo)
                      : undefined
                  }
                  onSelect={handleDateSelect}
                  disabled={(date) => date > new Date()}
                  className={cn("p-3 pointer-events-auto")}
                />
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* Time of day */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="min-w-[160px] justify-start">
              <Clock className="h-4 w-4 mr-2" />
              {filters.timeFrom || filters.timeTo ? (
                <span>
                  {filters.timeFrom || "00:00"} - {filters.timeTo || "23:59"}
                </span>
              ) : (
                <span>{t("app.salesFilters.timeOfDay")}</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72" align="start">
            <div className="space-y-4">
              <p className="text-sm font-medium">{t("app.salesFilters.timeRange")}</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">{t("app.salesFilters.from")}</Label>
                  <Input
                    type="time"
                    value={filters.timeFrom}
                    onChange={(e) => updateFilter("timeFrom", e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("app.salesFilters.to")}</Label>
                  <Input
                    type="time"
                    value={filters.timeTo}
                    onChange={(e) => updateFilter("timeTo", e.target.value)}
                  />
                </div>
              </div>
              <div className="flex gap-1 flex-wrap">
                <Button variant="outline" size="sm" className="text-xs" onClick={() => { updateFilter("timeFrom", "06:00"); updateFilter("timeTo", "12:00"); }}>{t("app.salesFilters.morning")}</Button>
                <Button variant="outline" size="sm" className="text-xs" onClick={() => { updateFilter("timeFrom", "12:00"); updateFilter("timeTo", "17:00"); }}>{t("app.salesFilters.afternoon")}</Button>
                <Button variant="outline" size="sm" className="text-xs" onClick={() => { updateFilter("timeFrom", "17:00"); updateFilter("timeTo", "23:59"); }}>{t("app.salesFilters.evening")}</Button>
                <Button variant="ghost" size="sm" className="text-xs" onClick={() => { updateFilter("timeFrom", ""); updateFilter("timeTo", ""); }}>{t("app.salesFilters.clear")}</Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* Amount range */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="min-w-[140px]">
              <Filter className="h-4 w-4 mr-2" />
              {filters.amountMin || filters.amountMax ? (
                <span>
                  {filters.amountMin || "0"} - {filters.amountMax || "∞"}
                </span>
              ) : (
                <span>{t("app.salesFilters.amount")}</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64" align="start">
            <div className="space-y-4">
              <p className="text-sm font-medium">{t("app.salesFilters.amountRange", { currency })}</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">{t("app.salesFilters.min")}</Label>
                  <Input
                    type="number"
                    placeholder="0"
                    value={filters.amountMin}
                    onChange={(e) => updateFilter("amountMin", e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("app.salesFilters.max")}</Label>
                  <Input
                    type="number"
                    placeholder={t("app.salesFilters.noLimit")}
                    value={filters.amountMax}
                    onChange={(e) => updateFilter("amountMax", e.target.value)}
                  />
                </div>
              </div>
              <div className="flex gap-1 flex-wrap">
                {[100, 500, 1000, 5000].map((amt) => (
                  <Button
                    key={amt}
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => {
                      updateFilter("amountMin", "");
                      updateFilter("amountMax", amt.toString());
                    }}
                  >
                    &lt; {amt}
                  </Button>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* Sort */}
        <Select 
          value={`${filters.sortBy}-${filters.sortOrder}`} 
          onValueChange={(v) => {
            const [sortBy, sortOrder] = v.split("-");
            onFiltersChange({ ...filters, sortBy, sortOrder: sortOrder as "asc" | "desc" });
          }}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder={t("app.salesFilters.sortByPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="created_at-desc">{t("app.salesFilters.sortDateNewest")}</SelectItem>
            <SelectItem value="created_at-asc">{t("app.salesFilters.sortDateOldest")}</SelectItem>
            <SelectItem value="total-desc">{t("app.salesFilters.sortAmountHigh")}</SelectItem>
            <SelectItem value="total-asc">{t("app.salesFilters.sortAmountLow")}</SelectItem>
          </SelectContent>
        </Select>

        {/* Clear filters */}
        {activeFiltersCount > 0 && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="h-4 w-4 mr-1" />
            {t("app.salesFilters.clearCount", { count: activeFiltersCount })}
          </Button>
        )}
      </div>

      {/* Active filters summary */}
      {activeFiltersCount > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">
            {t("app.salesFilters.showing", { filtered: totalFiltered, total: totalCount })}
          </span>
          <div className="flex gap-1 flex-wrap">
            {filters.search && (
              <Badge variant="secondary" className="gap-1">
                {t("app.salesFilters.receiptBadge", { value: filters.search })}
                <X 
                  className="h-3 w-3 cursor-pointer" 
                  onClick={() => updateFilter("search", "")} 
                />
              </Badge>
            )}
            {filters.paymentMethod && filters.paymentMethod !== "all" && (
              <Badge variant="secondary" className="gap-1">
                {PAYMENT_METHODS.find(m => m.value === filters.paymentMethod)?.label}
                <X 
                  className="h-3 w-3 cursor-pointer" 
                  onClick={() => updateFilter("paymentMethod", "")} 
                />
              </Badge>
            )}
            {filters.settlementStatus && filters.settlementStatus !== "all" && (
              <Badge variant="secondary" className="gap-1 capitalize">
                {filters.settlementStatus}
                <X
                  className="h-3 w-3 cursor-pointer"
                  onClick={() => updateFilter("settlementStatus", "all")}
                />
              </Badge>
            )}
            {(filters.dateFrom || filters.dateTo) && (
              <Badge variant="secondary" className="gap-1">
                {filters.dateFrom && format(new Date(filters.dateFrom), "MMM d")}
                {filters.dateFrom && filters.dateTo && " - "}
                {filters.dateTo && format(new Date(filters.dateTo), "MMM d")}
                <X 
                  className="h-3 w-3 cursor-pointer" 
                  onClick={() => {
                    updateFilter("dateFrom", "");
                    updateFilter("dateTo", "");
                  }} 
                />
              </Badge>
            )}
            {(filters.timeFrom || filters.timeTo) && (
              <Badge variant="secondary" className="gap-1">
                <Clock className="h-3 w-3" />
                {filters.timeFrom || "00:00"} - {filters.timeTo || "23:59"}
                <X
                  className="h-3 w-3 cursor-pointer"
                  onClick={() => {
                    updateFilter("timeFrom", "");
                    updateFilter("timeTo", "");
                  }}
                />
              </Badge>
            )}
            {(filters.amountMin || filters.amountMax) && (
              <Badge variant="secondary" className="gap-1">
                {filters.amountMin || "0"} - {filters.amountMax || "∞"} {currency}
                <X 
                  className="h-3 w-3 cursor-pointer" 
                  onClick={() => {
                    updateFilter("amountMin", "");
                    updateFilter("amountMax", "");
                  }} 
                />
              </Badge>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
