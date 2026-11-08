import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { BlockContent } from "@/hooks/usePageBlocks";
import { Clock, Plus, Trash2 } from "lucide-react";

interface HoursBlockConfigProps {
  content: BlockContent;
  onUpdate: (key: keyof BlockContent, value: unknown) => void;
}

interface HourEntry {
  day: string;
  open: string;
  close: string;
  closed?: boolean;
}

const DEFAULT_HOURS: HourEntry[] = [
  { day: 'Monday', open: '11:00', close: '22:00' },
  { day: 'Tuesday', open: '11:00', close: '22:00' },
  { day: 'Wednesday', open: '11:00', close: '22:00' },
  { day: 'Thursday', open: '11:00', close: '22:00' },
  { day: 'Friday', open: '11:00', close: '23:00' },
  { day: 'Saturday', open: '10:00', close: '23:00' },
  { day: 'Sunday', open: '10:00', close: '21:00' },
];

export function HoursBlockConfig({ content, onUpdate }: HoursBlockConfigProps) {
  const hours: HourEntry[] = (content.hours as HourEntry[]) || DEFAULT_HOURS;

  const updateHour = (index: number, field: keyof HourEntry, value: string | boolean) => {
    const updated = [...hours];
    updated[index] = { ...updated[index], [field]: value };
    onUpdate('hours', updated);
  };

  const toggleClosed = (index: number) => {
    const updated = [...hours];
    updated[index] = { ...updated[index], closed: !updated[index].closed };
    onUpdate('hours', updated);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <Clock className="h-5 w-5 text-primary" />
        <Label className="text-base font-medium">Opening Hours</Label>
      </div>

      <div className="space-y-3">
        {hours.map((entry, index) => (
          <div
            key={entry.day}
            className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30"
          >
            <div className="w-24 font-medium text-sm">{entry.day}</div>
            
            {entry.closed ? (
              <div className="flex-1 text-center">
                <span className="text-sm text-muted-foreground italic">Closed</span>
              </div>
            ) : (
              <div className="flex-1 flex items-center gap-2">
                <Input
                  type="time"
                  value={entry.open}
                  onChange={(e) => updateHour(index, 'open', e.target.value)}
                  className="h-8 w-24 text-sm"
                />
                <span className="text-muted-foreground">to</span>
                <Input
                  type="time"
                  value={entry.close}
                  onChange={(e) => updateHour(index, 'close', e.target.value)}
                  className="h-8 w-24 text-sm"
                />
              </div>
            )}

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Closed</span>
              <Switch
                checked={entry.closed}
                onCheckedChange={() => toggleClosed(index)}
              />
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Hours are displayed in 24-hour format. Toggle "Closed" for days you don't operate.
      </p>
    </div>
  );
}
