import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Calendar, Loader2 } from "lucide-react";
import { useFiscalSettings, getFiscalMonthRange, type FineAllocationMode } from "@/hooks/useFiscalSettings";
import { toast } from "sonner";
import { format } from "date-fns";
import { resolvePayrollPeriod, describePayrollPeriod } from "@/lib/payrollCutoff";

export function FiscalMonthSettings() {
  const {
    monthStartDay,
    payrollCutoffDay,
    payrollPeriodOffset,
    fineAllocationMode,
    isLoading,
    updateMonthStartDay,
    isUpdating,
    updatePayrollRules,
    isUpdatingPayrollRules,
  } = useFiscalSettings();
  const [selectedDay, setSelectedDay] = useState<number>(monthStartDay);
  const [cutoffDay, setCutoffDay] = useState<number>(payrollCutoffDay);
  const [periodOffset, setPeriodOffset] = useState<number>(payrollPeriodOffset);
  const [fineMode, setFineMode] = useState<FineAllocationMode>(fineAllocationMode);

  useEffect(() => {
    setSelectedDay(monthStartDay);
  }, [monthStartDay]);

  useEffect(() => {
    setCutoffDay(payrollCutoffDay);
  }, [payrollCutoffDay]);

  useEffect(() => {
    setPeriodOffset(payrollPeriodOffset);
  }, [payrollPeriodOffset]);

  useEffect(() => {
    setFineMode(fineAllocationMode);
  }, [fineAllocationMode]);

  const handleSave = () => {
    updateMonthStartDay(selectedDay, {
      onSuccess: () => {
        toast.success("Fiscal month settings updated");
      },
      onError: () => {
        toast.error("Failed to update fiscal month settings");
      },
    });
  };

  const handleSavePayrollRules = () => {
    updatePayrollRules(
      {
        payrollCutoffDay: cutoffDay,
        payrollPeriodOffset: periodOffset,
        fineAllocationMode: fineMode,
      },
      {
        onSuccess: () => toast.success("Payroll cut-off rules updated"),
        onError: () => toast.error("Failed to update payroll cut-off rules"),
      }
    );
  };

  const hasChanges = selectedDay !== monthStartDay;
  const hasPayrollChanges =
    cutoffDay !== payrollCutoffDay ||
    periodOffset !== payrollPeriodOffset ||
    fineMode !== fineAllocationMode;

  const payrollPreview = resolvePayrollPeriod(new Date(), {
    monthStartDay: selectedDay,
    payrollCutoffDay: cutoffDay,
    payrollPeriodOffset: periodOffset,
  });

  // Show preview of current fiscal month with selected day
  const previewRange = getFiscalMonthRange(new Date(), selectedDay);
  const previewText = `${format(previewRange.start, "MMM d")} → ${format(previewRange.end, "MMM d")}`;

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Fiscal Month
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Fiscal Month
        </CardTitle>
        <CardDescription>
          Configure when your accounting month starts. All monthly reports and calculations will use this setting.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="month-start-day">Month Starts On</Label>
          <Select
            value={selectedDay.toString()}
            onValueChange={(value) => setSelectedDay(parseInt(value))}
          >
            <SelectTrigger id="month-start-day" className="w-full">
              <SelectValue placeholder="Select day" />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                <SelectItem key={day} value={day.toString()}>
                  {day === 1 ? "1st (Calendar month)" : `${day}${getOrdinalSuffix(day)} of each month`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Example: If set to 11, your month runs from the 11th to the 10th of next month.
          </p>
        </div>

        {/* Preview */}
        <div className="p-3 rounded-lg bg-muted/50 border">
          <p className="text-sm font-medium">Current Fiscal Month Preview</p>
          <p className="text-lg font-semibold text-primary mt-1">{previewText}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Based on selected start day of {selectedDay}
          </p>
        </div>

        {hasChanges && (
          <Button 
            onClick={handleSave} 
            disabled={isUpdating}
            className="w-full"
          >
            {isUpdating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Changes"
            )}
          </Button>
        )}

        <div className="pt-4 border-t space-y-4">
          <div>
            <p className="text-sm font-medium">Payroll cut-off rules</p>
            <p className="text-xs text-muted-foreground">
              Controls which fiscal cycle the payable breakdown generates salaries for.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="payroll-period-offset">Pay period</Label>
            <Select
              value={periodOffset.toString()}
              onValueChange={(value) => setPeriodOffset(parseInt(value))}
            >
              <SelectTrigger id="payroll-period-offset" className="w-full">
                <SelectValue placeholder="Select period" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Current running cycle</SelectItem>
                <SelectItem value="1">Last completed cycle (recommended)</SelectItem>
                <SelectItem value="2">Two cycles back</SelectItem>
                <SelectItem value="3">Three cycles back</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="payroll-cutoff-day">Cut-off day</Label>
            <Select
              value={cutoffDay.toString()}
              onValueChange={(value) => setCutoffDay(parseInt(value))}
              disabled={periodOffset === 0}
            >
              <SelectTrigger id="payroll-cutoff-day" className="w-full">
                <SelectValue placeholder="Select day" />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                  <SelectItem key={day} value={day.toString()}>
                    {`${day}${getOrdinalSuffix(day)} of the month`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Before this day, the breakdown keeps showing the previous cycle so payroll isn't
              released early.
            </p>
          </div>

          <div className="p-3 rounded-lg bg-muted/50 border">
            <p className="text-sm font-medium">Payroll period preview</p>
            <p className="text-lg font-semibold text-primary mt-1">
              {format(payrollPreview.start, "MMM d")} → {format(payrollPreview.end, "MMM d, yyyy")}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {describePayrollPeriod(payrollPreview)}
              {payrollPreview.cutoffPending
                ? ` — cut-off reached on ${format(payrollPreview.cutoffDate, "MMM d")}`
                : ""}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="fine-allocation-mode">Fine deduction basis</Label>
            <Select
              value={fineMode}
              onValueChange={(value) => setFineMode(value as FineAllocationMode)}
            >
              <SelectTrigger id="fine-allocation-mode" className="w-full">
                <SelectValue placeholder="Select basis" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="installment_date">
                  By installment date (recommended)
                </SelectItem>
                <SelectItem value="created_date">By date the fine was created</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {fineMode === "installment_date"
                ? "Each payroll month deducts only the installment scheduled for that month, plus any unrecovered carry-over."
                : "Fines are deducted in the payroll cycle they were created in, regardless of the installment schedule."}
            </p>
          </div>

          {hasPayrollChanges && (
            <Button
              onClick={handleSavePayrollRules}
              disabled={isUpdatingPayrollRules}
              className="w-full"
            >
              {isUpdatingPayrollRules ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Payroll Rules"
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function getOrdinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return "th";
  switch (day % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}
