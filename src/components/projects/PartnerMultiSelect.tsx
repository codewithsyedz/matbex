import { Check, ChevronsUpDown, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export interface PartnerOption {
  id: string;
  partner_name: string;
}

export function PartnerMultiSelect({
  partners,
  value,
  onChange,
  disabled,
  placeholder = "Select partner(s)",
}: {
  partners: PartnerOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const selected = partners.filter((p) => value.includes(p.id));

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "h-10 w-full justify-between font-normal",
            selected.length === 0 && "text-muted-foreground",
          )}
        >
          <span className="flex flex-wrap items-center gap-1 overflow-hidden">
            {selected.length === 0 ? (
              placeholder
            ) : selected.length <= 2 ? (
              selected.map((p) => (
                <Badge key={p.id} variant="secondary" className="gap-1">
                  {p.partner_name}
                  <X
                    className="h-3 w-3 cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(p.id);
                    }}
                  />
                </Badge>
              ))
            ) : (
              <span>{selected.length} partners selected</span>
            )}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <ScrollArea className="max-h-64">
          <div className="p-1">
            {partners.length === 0 && (
              <p className="px-2 py-3 text-sm text-muted-foreground">No partners on this project yet.</p>
            )}
            {partners.map((p) => {
              const checked = value.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggle(p.id)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent"
                >
                  <Checkbox checked={checked} className="pointer-events-none" />
                  <span className="flex-1">{p.partner_name}</span>
                  {checked && <Check className="h-4 w-4 text-primary" />}
                </button>
              );
            })}
          </div>
        </ScrollArea>
        {value.length > 0 && (
          <div className="border-t p-1">
            <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => onChange([])}>
              Clear selection
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
