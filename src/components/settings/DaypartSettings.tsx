import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Sun, Sunrise, Sunset, Moon, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  useDaypartSettings,
  DEFAULT_DAYPARTS,
  formatHour12,
  type DaypartConfig,
} from "@/hooks/useDaypartSettings";

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function DaypartSettings() {
  const { config, isLoading, update, isUpdating } = useDaypartSettings();
  const [draft, setDraft] = useState<DaypartConfig>(config);

  useEffect(() => setDraft(config), [config]);

  const setField = (k: keyof DaypartConfig, v: number) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const isValid =
    draft.morning_start < draft.noon_start &&
    draft.noon_start < draft.evening_start &&
    draft.evening_start < draft.late_night_start;

  const hasChanges =
    draft.morning_start !== config.morning_start ||
    draft.noon_start !== config.noon_start ||
    draft.evening_start !== config.evening_start ||
    draft.late_night_start !== config.late_night_start;

  const handleSave = async () => {
    if (!isValid) {
      toast.error("Hours must be in ascending order: Morning < Noon < Evening < Late Night");
      return;
    }
    try {
      await update(draft);
      toast.success("Daypart schedule updated");
    } catch {
      toast.error("Failed to update daypart settings");
    }
  };

  const handleReset = () => setDraft(DEFAULT_DAYPARTS);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Sun className="h-5 w-5" /> Daypart Schedule
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const ranges = [
    { label: "Morning", from: draft.morning_start, to: draft.noon_start, icon: Sunrise },
    { label: "Noon", from: draft.noon_start, to: draft.evening_start, icon: Sun },
    { label: "Evening", from: draft.evening_start, to: draft.late_night_start, icon: Sunset },
    { label: "Late Night", from: draft.late_night_start, to: draft.morning_start, icon: Moon, wraps: true },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Sun className="h-5 w-5" /> Daypart Schedule
        </CardTitle>
        <CardDescription>
          Define when each daypart starts (24-hour clock). Used in Sales Analytics for Morning / Noon / Evening / Late Night breakdowns.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <DaypartHourField
            label="Morning starts at"
            icon={<Sunrise className="h-4 w-4" />}
            value={draft.morning_start}
            onChange={(v) => setField("morning_start", v)}
          />
          <DaypartHourField
            label="Noon starts at"
            icon={<Sun className="h-4 w-4" />}
            value={draft.noon_start}
            onChange={(v) => setField("noon_start", v)}
          />
          <DaypartHourField
            label="Evening starts at"
            icon={<Sunset className="h-4 w-4" />}
            value={draft.evening_start}
            onChange={(v) => setField("evening_start", v)}
          />
          <DaypartHourField
            label="Late Night starts at"
            icon={<Moon className="h-4 w-4" />}
            value={draft.late_night_start}
            onChange={(v) => setField("late_night_start", v)}
          />
        </div>

        {!isValid && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 text-destructive text-xs p-3">
            Hours must be in ascending order: Morning &lt; Noon &lt; Evening &lt; Late Night.
          </div>
        )}

        <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Preview</p>
          {ranges.map((r) => {
            const Icon = r.icon;
            return (
              <div key={r.label} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  {r.label}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {formatHour12(r.from)} – {formatHour12(r.to)}{r.wraps ? " (next day)" : ""}
                </span>
              </div>
            );
          })}
        </div>

        <div className="flex gap-2">
          <Button
            onClick={handleSave}
            disabled={!hasChanges || !isValid || isUpdating}
            className="flex-1"
          >
            {isUpdating ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…</>
            ) : (
              "Save Changes"
            )}
          </Button>
          <Button variant="outline" onClick={handleReset} disabled={isUpdating}>
            <RotateCcw className="h-4 w-4 mr-1" /> Defaults
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DaypartHourField({
  label, icon, value, onChange,
}: { label: string; icon: React.ReactNode; value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5 text-xs">{icon}{label}</Label>
      <Select value={String(value)} onValueChange={(v) => onChange(parseInt(v, 10))}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {HOURS.map((h) => (
            <SelectItem key={h} value={String(h)}>
              {String(h).padStart(2, "0")}:00 · {formatHour12(h)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
