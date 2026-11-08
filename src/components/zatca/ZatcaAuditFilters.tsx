import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Search, X } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { AuditFilters } from "@/hooks/useZatcaCompliance";

const ENTITY_TYPES = ["invoice", "credit_note", "device", "settings"] as const;
const ACTIONS = [
  "SUBMITTED", "CLEARED", "REPORTED", "CLEARED_SIM", "REJECTED",
  "SCHEMA_INVALID", "CREDIT_ISSUED", "DEVICE_ONBOARDED", "CSID_RENEWED",
] as const;

interface Props {
  value: AuditFilters;
  onChange: (next: AuditFilters) => void;
}

export function ZatcaAuditFilters({ value, onChange }: Props) {
  const [searchDraft, setSearchDraft] = useState(value.search ?? "");

  const toggle = <T extends string>(arr: T[] | undefined, item: T): T[] => {
    const set = new Set(arr ?? []);
    if (set.has(item)) set.delete(item); else set.add(item);
    return Array.from(set);
  };

  const fromDate = value.fromDate ? new Date(value.fromDate) : undefined;
  const toDate = value.toDate ? new Date(value.toDate) : undefined;

  const hasFilters =
    !!value.search ||
    !!value.fromDate ||
    !!value.toDate ||
    (value.entityTypes?.length ?? 0) > 0 ||
    (value.actions?.length ?? 0) > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            onBlur={() => onChange({ ...value, search: searchDraft || undefined })}
            onKeyDown={(e) => {
              if (e.key === "Enter") onChange({ ...value, search: searchDraft || undefined });
            }}
            placeholder="Search by hash or entity ID…"
            className="h-8 pl-8 text-xs"
          />
        </div>

        {/* From date */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn("h-8 text-xs gap-1.5", !fromDate && "text-muted-foreground")}
            >
              <CalendarIcon className="h-3.5 w-3.5" />
              {fromDate ? format(fromDate, "MMM d") : "From"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={fromDate}
              onSelect={(d) =>
                onChange({ ...value, fromDate: d ? d.toISOString() : undefined })
              }
              initialFocus
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>

        {/* To date */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn("h-8 text-xs gap-1.5", !toDate && "text-muted-foreground")}
            >
              <CalendarIcon className="h-3.5 w-3.5" />
              {toDate ? format(toDate, "MMM d") : "To"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={toDate}
              onSelect={(d) => {
                // make end-of-day so the chosen date is inclusive
                if (!d) {
                  onChange({ ...value, toDate: undefined });
                  return;
                }
                const eod = new Date(d);
                eod.setHours(23, 59, 59, 999);
                onChange({ ...value, toDate: eod.toISOString() });
              }}
              initialFocus
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => {
              setSearchDraft("");
              onChange({});
            }}
          >
            <X className="h-3.5 w-3.5" /> Clear
          </Button>
        )}
      </div>

      {/* Entity type chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground mr-1">Entity</span>
        {ENTITY_TYPES.map((t) => {
          const active = value.entityTypes?.includes(t);
          return (
            <Badge
              key={t}
              variant={active ? "default" : "outline"}
              className="cursor-pointer text-[10px] font-mono uppercase"
              onClick={() =>
                onChange({ ...value, entityTypes: toggle(value.entityTypes, t) })
              }
            >
              {t}
            </Badge>
          );
        })}
      </div>

      {/* Action chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground mr-1">Action</span>
        {ACTIONS.map((a) => {
          const active = value.actions?.includes(a);
          return (
            <Badge
              key={a}
              variant={active ? "default" : "outline"}
              className="cursor-pointer text-[10px] font-mono"
              onClick={() =>
                onChange({ ...value, actions: toggle(value.actions, a) })
              }
            >
              {a}
            </Badge>
          );
        })}
      </div>
    </div>
  );
}