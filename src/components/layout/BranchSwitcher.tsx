import { Building2, Check, ChevronsUpDown, Lock, Star } from "lucide-react";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

export function BranchSwitcher() {
  const { t } = useTranslation();
  const { branches, activeBranch, isAllBranches, setActiveBranchId, isLoading, canSwitchBranches, pinnedBranchId } =
    useBranch();
  const { hasRole } = useAuth();
  const [open, setOpen] = useState(false);

  // Hide entirely until branches load. Don't show a switcher for tenants
  // that only have the auto-created Main Branch - it would just clutter.
  if (isLoading || branches.length <= 1) return null;

  const canSeeAll = hasRole("owner") || hasRole("manager");

  const label = isAllBranches
    ? t("switchers.allBranches")
    : activeBranch?.name ?? t("switchers.selectBranch");

  // Pinned users: render a read-only chip with a lock icon.
  if (!canSwitchBranches) {
    const pinned = branches.find((b) => b.id === pinnedBranchId);
    return (
      <div
        className="inline-flex items-center gap-2 h-8 px-3 rounded-md border border-input bg-muted/40 text-sm max-w-[200px]"
        title={t("switchers.assignedBranch")}
      >
        <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="truncate">{pinned?.name ?? activeBranch?.name ?? t("switchers.branch")}</span>
        <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
      </div>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Safety net for the Radix pointer-events: none body lock.
        if (!next) {
          setTimeout(() => {
            if (document.body.style.pointerEvents === "none") {
              document.body.style.pointerEvents = "";
            }
          }, 150);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          className="h-8 gap-2 max-w-[200px]"
        >
          <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="truncate text-sm">{label}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
           <CommandInput placeholder={t("switchers.searchBranch")} />
          <CommandList>
             <CommandEmpty>{t("switchers.noBranch")}</CommandEmpty>
             <CommandGroup heading={t("switchers.branches")}>
              {branches.map((b) => (
                <CommandItem
                  key={b.id}
                  value={`${b.name} ${b.code ?? ""} ${b.city ?? ""} ${b.country ?? ""}`}
                  onSelect={() => {
                    setActiveBranchId(b.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                       "me-2 h-4 w-4",
                      activeBranch?.id === b.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm">{b.name}</span>
                      {b.is_primary && (
                        <Star className="h-3 w-3 text-primary shrink-0" />
                      )}
                    </div>
                    {(b.city || b.country) && (
                      <div className="text-[11px] text-muted-foreground truncate">
                        {[b.city, b.country].filter(Boolean).join(", ")}
                      </div>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
            {canSeeAll && (
              <>
                <CommandSeparator />
                 <CommandGroup heading={t("switchers.reports")}>
                  <CommandItem
                    value="all-branches"
                    onSelect={() => {
                      setActiveBranchId("all");
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                         "me-2 h-4 w-4",
                        isAllBranches ? "opacity-100" : "opacity-0",
                      )}
                    />
                     {t("switchers.allBranches")}
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}