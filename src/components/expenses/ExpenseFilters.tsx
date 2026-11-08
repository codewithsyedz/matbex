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
  CheckCircle2,
  Clock
} from "lucide-react";
import { format, subDays, startOfYear } from "date-fns";
import { cn } from "@/lib/utils";
import { getFiscalMonthRange, getPreviousFiscalMonthRange } from "@/hooks/useFiscalSettings";
import { BranchBadge } from "@/components/branch/BranchBadge";
import { useTranslation } from "react-i18next";
import { ar as arLocale } from "date-fns/locale";

interface ExpenseCategory {
  id: string;
  name: string;
  color: string | null;
}

export interface ExpenseFiltersState {
  search: string;
  categoryId: string;
  branchId: string;
  supplierId: string;
  dateFrom: string;
  dateTo: string;
  amountMin: string;
  amountMax: string;
  status: string;
  sortBy: string;
  sortOrder: "asc" | "desc";
}

interface ExpenseFiltersProps {
  filters: ExpenseFiltersState;
  onFiltersChange: (filters: ExpenseFiltersState) => void;
  categories: ExpenseCategory[];
  branches?: { id: string; name: string }[];
  suppliers?: { id: string; name: string }[];
  totalFiltered: number;
  totalCount: number;
  monthStartDay?: number;
}

const getDatePresets = (monthStartDay: number, t: (key: string) => string) => {
  const today = new Date();
  const fiscalMonth = getFiscalMonthRange(today, monthStartDay);
  const prevFiscalMonth = getPreviousFiscalMonthRange(today, monthStartDay);
  
  return [
    { label: t("app.expenses.filters.today"), getValue: () => ({ from: new Date(), to: new Date() }) },
    { label: t("app.expenses.filters.last7"), getValue: () => ({ from: subDays(new Date(), 7), to: new Date() }) },
    { label: t("app.expenses.filters.last30"), getValue: () => ({ from: subDays(new Date(), 30), to: new Date() }) },
    { label: t("app.expenses.filters.thisMonth"), getValue: () => ({ from: fiscalMonth.start, to: fiscalMonth.end }) },
    { label: t("app.expenses.filters.lastMonth"), getValue: () => ({ from: prevFiscalMonth.start, to: prevFiscalMonth.end }) },
    { label: t("app.expenses.filters.thisYear"), getValue: () => ({ from: startOfYear(new Date()), to: new Date() }) },
  ];
};

export function ExpenseFilters({ 
  filters, 
  onFiltersChange, 
  categories,
  branches = [],
  suppliers = [],
  totalFiltered,
  totalCount,
  monthStartDay = 1,
}: ExpenseFiltersProps) {
  const { t, i18n } = useTranslation();
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [datePickerMode, setDatePickerMode] = useState<"from" | "to">("from");
  
  const datePresets = getDatePresets(monthStartDay, t);
  const dateLocale = i18n.language === "ar" ? arLocale : undefined;

  const activeFiltersCount = [
    filters.search,
    filters.categoryId,
    filters.branchId && filters.branchId !== "all" ? filters.branchId : "",
    filters.supplierId && filters.supplierId !== "all" ? filters.supplierId : "",
    filters.dateFrom,
    filters.dateTo,
    filters.amountMin,
    filters.amountMax,
    filters.status,
  ].filter(Boolean).length;

  const updateFilter = (key: keyof ExpenseFiltersState, value: string) => {
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
    onFiltersChange({
      search: "",
      categoryId: "",
      branchId: "",
      supplierId: "",
      dateFrom: "",
      dateTo: "",
      amountMin: "",
      amountMax: "",
      status: "",
      sortBy: "expense_date",
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
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("app.expenses.filters.search")}
            value={filters.search}
            onChange={(e) => updateFilter("search", e.target.value)}
            className="ps-9"
          />
        </div>

        {/* Category filter */}
        <Select value={filters.categoryId} onValueChange={(v) => updateFilter("categoryId", v)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t("app.expenses.filters.allCategories")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("app.expenses.filters.allCategories")}</SelectItem>
            <SelectItem value="uncategorized">{t("app.expenses.filters.uncategorized")}</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat.id} value={cat.id}>
                <span className="flex items-center gap-2">
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: cat.color || "#888" }}
                  />
                  {cat.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Status filter */}
        {branches.length > 0 && (
          <Select
            value={filters.branchId || "all"}
            onValueChange={(v) => updateFilter("branchId", v === "all" ? "" : v)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={t("app.expenses.filters.allBranches")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("app.expenses.filters.allBranches")}</SelectItem>
              <SelectItem value="unassigned">{t("app.expenses.filters.unassigned")}</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Supplier filter */}
        {suppliers.length > 0 && (
          <Select
            value={filters.supplierId || "all"}
            onValueChange={(v) => updateFilter("supplierId", v === "all" ? "" : v)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={t("app.expenses.filters.allSuppliers")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("app.expenses.filters.allSuppliers")}</SelectItem>
              <SelectItem value="none">{t("app.expenses.filters.noSupplier")}</SelectItem>
              {suppliers.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Select value={filters.status || "all"} onValueChange={(v) => updateFilter("status", v === "all" ? "" : v)}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder={t("app.expenses.filters.allStatus")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("app.expenses.filters.allStatus")}</SelectItem>
            <SelectItem value="paid">
              <span className="flex items-center gap-2">
                <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                {t("app.expenses.filters.paid")}
              </span>
            </SelectItem>
            <SelectItem value="unpaid">
              <span className="flex items-center gap-2">
                <Clock className="h-3 w-3 text-amber-600" />
                {t("app.expenses.filters.unpaid")}
              </span>
            </SelectItem>
          </SelectContent>
        </Select>

        {/* Date range */}
        <Popover open={isDatePickerOpen} onOpenChange={setIsDatePickerOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="min-w-[200px] justify-start">
               <CalendarIcon className="h-4 w-4 me-2" />
              {filters.dateFrom || filters.dateTo ? (
                <span>
                   {filters.dateFrom ? format(new Date(filters.dateFrom), "MMM d", { locale: dateLocale }) : t("app.expenses.filters.start")}
                  {" - "}
                   {filters.dateTo ? format(new Date(filters.dateTo), "MMM d", { locale: dateLocale }) : t("app.expenses.filters.end")}
                </span>
              ) : (
                 <span>{t("app.expenses.filters.dateRange")}</span>
              )}
               <ChevronDown className="ms-auto h-4 w-4 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <div className="flex">
               <div className="border-e p-2 space-y-1">
                 <p className="text-xs font-medium text-muted-foreground px-2 py-1">{t("app.expenses.filters.quickSelect")}</p>
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
                   {t("app.expenses.filters.clearDates")}
                </Button>
              </div>
              <div className="p-2">
                <p className="text-xs font-medium text-muted-foreground px-2 py-1">
                   {datePickerMode === "from" ? t("app.expenses.filters.selectStart") : t("app.expenses.filters.selectEnd")}
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
                />
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* Amount range */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="min-w-[140px]">
               <Filter className="h-4 w-4 me-2" />
              {filters.amountMin || filters.amountMax ? (
                <span>
                  {filters.amountMin || "0"} - {filters.amountMax || "∞"}
                </span>
              ) : (
                 <span>{t("app.expenses.filters.amount")}</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64" align="start">
            <div className="space-y-4">
               <p className="text-sm font-medium">{t("app.expenses.filters.amountRange")}</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                   <Label className="text-xs">{t("app.expenses.filters.min")}</Label>
                  <Input
                    type="number"
                    placeholder="0"
                    value={filters.amountMin}
                    onChange={(e) => updateFilter("amountMin", e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                   <Label className="text-xs">{t("app.expenses.filters.max")}</Label>
                  <Input
                    type="number"
                     placeholder={t("app.expenses.filters.noLimit")}
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
             <SelectValue placeholder={t("app.expenses.filters.sortBy")} />
          </SelectTrigger>
          <SelectContent>
             <SelectItem value="expense_date-desc">{t("app.expenses.filters.dateNewest")}</SelectItem>
             <SelectItem value="expense_date-asc">{t("app.expenses.filters.dateOldest")}</SelectItem>
             <SelectItem value="amount-desc">{t("app.expenses.filters.amountHigh")}</SelectItem>
             <SelectItem value="amount-asc">{t("app.expenses.filters.amountLow")}</SelectItem>
             <SelectItem value="created_at-desc">{t("app.expenses.filters.addedRecent")}</SelectItem>
          </SelectContent>
        </Select>

        {/* Clear filters */}
        {activeFiltersCount > 0 && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
             <X className="h-4 w-4 me-1" />
             {t("app.expenses.filters.clear", { count: activeFiltersCount })}
          </Button>
        )}
      </div>

      {/* Active filters summary */}
      {activeFiltersCount > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">
             {t("app.expenses.filters.showing", { filtered: totalFiltered, total: totalCount })}
          </span>
          <div className="flex gap-1 flex-wrap">
            {filters.search && (
              <Badge variant="secondary" className="gap-1">
                 {t("app.expenses.filters.searchBadge")}: "{filters.search}"
                <X 
                  className="h-3 w-3 cursor-pointer" 
                  onClick={() => updateFilter("search", "")} 
                />
              </Badge>
            )}
            {filters.categoryId && filters.categoryId !== "all" && (
              <Badge variant="secondary" className="gap-1">
                {filters.categoryId === "uncategorized" 
                   ? t("app.expenses.filters.uncategorized") 
                  : categories.find(c => c.id === filters.categoryId)?.name
                }
                <X 
                  className="h-3 w-3 cursor-pointer" 
                  onClick={() => updateFilter("categoryId", "")} 
                />
              </Badge>
            )}
            {filters.branchId && filters.branchId !== "all" && (
              <Badge variant="secondary" className="gap-1">
                {filters.branchId === "unassigned" ? (
                   <span>{t("app.expenses.filters.unassigned")}</span>
                ) : (
                  <BranchBadge
                    name={branches.find((b) => b.id === filters.branchId)?.name ?? "Branch"}
                    branchId={filters.branchId}
                  />
                )}
                <X
                  className="h-3 w-3 cursor-pointer"
                  onClick={() => updateFilter("branchId", "")}
                />
              </Badge>
            )}
            {filters.supplierId && filters.supplierId !== "all" && (
              <Badge variant="secondary" className="gap-1">
                {filters.supplierId === "none"
                   ? t("app.expenses.filters.noSupplier")
                   : suppliers.find((s) => s.id === filters.supplierId)?.name ?? t("app.expenses.filters.supplier")}
                <X
                  className="h-3 w-3 cursor-pointer"
                  onClick={() => updateFilter("supplierId", "")}
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
            {(filters.amountMin || filters.amountMax) && (
              <Badge variant="secondary" className="gap-1">
                {filters.amountMin || "0"} - {filters.amountMax || "∞"} SAR
                <X 
                  className="h-3 w-3 cursor-pointer" 
                  onClick={() => {
                    updateFilter("amountMin", "");
                    updateFilter("amountMax", "");
                  }} 
                />
              </Badge>
            )}
            {filters.status && (
              <Badge variant="secondary" className="gap-1">
                {filters.status === "paid" ? (
                   <><CheckCircle2 className="h-3 w-3 text-emerald-600" /> {t("app.expenses.filters.paid")}</>
                ) : (
                   <><Clock className="h-3 w-3 text-amber-600" /> {t("app.expenses.filters.unpaid")}</>
                )}
                <X 
                  className="h-3 w-3 cursor-pointer" 
                  onClick={() => updateFilter("status", "")} 
                />
              </Badge>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
