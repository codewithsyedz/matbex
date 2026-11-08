import { useMemo } from "react";
import { Check, ChevronsUpDown, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

interface BranchOption {
  id: string;
  name: string;
  is_active?: boolean | null;
}

interface Props {
  branches: BranchOption[];
  /** Empty array = all branches. */
  value: string[];
  onChange: (next: string[]) => void;
  className?: string;
}

/**
 * Compact multi-select for scoping dashboard cards to specific branches.
 * An empty selection means "All branches".
 */
export function BranchMultiSelect({ branches, value, onChange, className }: Props) {
  const options = useMemo(
    () => branches.filter((b) => b.is_active !== false),
    [branches],
  );

  const label =
    value.length === 0
      ? "All branches"
      : value.length === 1
        ? options.find((b) => b.id === value[0])?.name ?? "1 branch"
        : `${value.length} branches`;

  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-label="Filter branches"
          className={cn("h-8 justify-between gap-2 text-xs font-normal", className)}
        >
          <span className="flex items-center gap-1.5 min-w-0">
            <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{label}</span>
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0" align="end">
        <Command>
          <CommandInput placeholder="Search branches…" className="h-8 text-xs" />
          <CommandList>
            <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">
              No branch found.
            </CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__all__"
                onSelect={() => onChange([])}
                className="text-xs"
              >
                <Check
                  className={cn(
                    "mr-2 h-3.5 w-3.5",
                    value.length === 0 ? "opacity-100" : "opacity-0",
                  )}
                />
                All branches
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              {options.map((b) => (
                <CommandItem
                  key={b.id}
                  value={b.name}
                  onSelect={() => toggle(b.id)}
                  className="text-xs"
                >
                  <Check
                    className={cn(
                      "mr-2 h-3.5 w-3.5",
                      value.includes(b.id) ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">{b.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
