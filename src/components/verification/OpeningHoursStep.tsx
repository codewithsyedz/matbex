import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

const DAYS = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
] as const;

type Day = typeof DAYS[number]["key"];
type DayValue = { open: boolean; from: string; to: string };

export type OpeningHoursValue = Record<Day, DayValue>;

const DEFAULT: OpeningHoursValue = DAYS.reduce((acc, d) => {
  acc[d.key] = { open: true, from: "10:00", to: "23:00" };
  return acc;
}, {} as OpeningHoursValue);

interface Props {
  initial?: Record<string, unknown> | null;
  saved?: boolean;
  onSave: (value: OpeningHoursValue) => Promise<void>;
}

export function OpeningHoursStep({ initial, saved, onSave }: Props) {
  const [value, setValue] = useState<OpeningHoursValue>(() => {
    if (initial && typeof initial === "object") {
      return { ...DEFAULT, ...(initial as OpeningHoursValue) };
    }
    return DEFAULT;
  });
  const [busy, setBusy] = useState(false);

  const update = (day: Day, patch: Partial<DayValue>) => {
    setValue((v) => ({ ...v, [day]: { ...v[day], ...patch } }));
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[28px] font-semibold tracking-[-0.02em] text-foreground leading-[1.2]">
          Opening Hours
        </h1>
        <p className="text-[15px] text-muted-foreground leading-[1.6] mt-2">
          Tell us when your restaurant is open. You can edit this later.
        </p>
      </div>

      <Card className="divide-y">
        {DAYS.map((d) => {
          const v = value[d.key];
          return (
            <div key={d.key} className="flex items-center gap-4 px-5 py-4">
              <span className="w-28 text-[14px] font-medium text-foreground">{d.label}</span>
              <Switch checked={v.open} onCheckedChange={(open) => update(d.key, { open })} />
              <span className="text-[13px] text-muted-foreground w-14">{v.open ? "Open" : "Closed"}</span>
              <Input
                type="time"
                value={v.from}
                onChange={(e) => update(d.key, { from: e.target.value })}
                disabled={!v.open}
                className="w-32"
              />
              <span className="text-muted-foreground">–</span>
              <Input
                type="time"
                value={v.to}
                onChange={(e) => update(d.key, { to: e.target.value })}
                disabled={!v.open}
                className="w-32"
              />
            </div>
          );
        })}
      </Card>

      <Button
        onClick={async () => {
          setBusy(true);
          try { await onSave(value); } finally { setBusy(false); }
        }}
        disabled={busy}
        className="bg-primary"
      >
        {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        {saved ? "Update hours" : "Save hours"}
      </Button>
    </div>
  );
}