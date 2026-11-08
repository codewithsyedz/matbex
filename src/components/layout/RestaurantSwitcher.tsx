import { useAuth } from "@/contexts/AuthContext";
import { Check, ChevronsUpDown, Star, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export function RestaurantSwitcher() {
  const { t } = useTranslation();
  const { restaurant, restaurants, switchRestaurant } = useAuth();
  const [open, setOpen] = useState(false);

  // Only show operational locations in the switcher. Hide inactive and
  // archived ones — they can still be re-activated from Settings → Locations.
  const visibleRestaurants = restaurants.filter((r) => {
    const status = (r as { status?: string | null }).status;
    return status !== "inactive" && status !== "archived";
  });

  // Hide entirely only when the tenant truly has a single location.
  if (restaurants.length <= 1) {
    return null;
  }

  // If filtering left only one active location, show a read-only chip
  // so the user still sees which location they're viewing.
  if (visibleRestaurants.length <= 1) {
    return (
      <div
        className="inline-flex items-center gap-2 h-9 px-3 rounded-md border border-input bg-muted/40 text-sm max-w-[200px]"
        title={t("switchers.onlyActiveLocation")}
      >
        <Store className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="truncate">{restaurant?.name ?? t("switchers.location")}</span>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-[200px] justify-between text-sm font-normal"
        >
          <div className="flex items-center gap-2 truncate">
            <Store className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
             <span className="truncate">{restaurant?.name || t("switchers.selectLocation")}</span>
          </div>
           <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-0">
        <Command>
           <CommandInput placeholder={t("switchers.searchLocation")} />
          <CommandList>
             <CommandEmpty>{t("switchers.noLocation")}</CommandEmpty>
             <CommandGroup heading={t("switchers.locations")}>
              {visibleRestaurants.map((r) => (
                <CommandItem
                  key={r.id}
                  value={r.name}
                  onSelect={() => {
                    switchRestaurant(r.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                       "me-2 h-4 w-4",
                      restaurant?.id === r.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm">{r.name}</span>
                      {r.is_primary && (
                        <Star className="h-3 w-3 text-primary shrink-0" />
                      )}
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
