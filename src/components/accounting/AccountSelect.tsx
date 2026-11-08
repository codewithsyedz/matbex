import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Info } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  ACCOUNT_TYPE_LABELS,
  useChartOfAccounts,
  type ChartOfAccount,
} from "@/hooks/useChartOfAccounts";

interface AccountSelectProps {
  value?: string;
  onValueChange: (accountId: string) => void;
  /** Restrict the list; defaults to every active account in the chart. */
  accounts?: ChartOfAccount[];
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** Show the metadata summary line underneath the trigger. */
  showDetail?: boolean;
}

function AccountBadges({ account }: { account: ChartOfAccount }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Badge variant="outline" className="text-[10px] font-normal">
        {ACCOUNT_TYPE_LABELS[account.account_type]}
      </Badge>
      {account.is_fixed_asset_account && (
        <Badge variant="secondary" className="text-[10px] font-normal">
          Fixed asset
        </Badge>
      )}
      {account.requires_cost_center && (
        <Badge variant="secondary" className="text-[10px] font-normal">
          Cost centre required
        </Badge>
      )}
      {account.vat_applicable && (
        <Badge variant="secondary" className="text-[10px] font-normal">
          VAT applies
        </Badge>
      )}
    </div>
  );
}

/**
 * Account picker that surfaces the accounting metadata a user needs to choose
 * correctly: number, name, type, whether it is capitalised, whether VAT applies
 * and whether a cost centre is mandatory.
 */
export function AccountSelect({
  value,
  onValueChange,
  accounts,
  disabled,
  placeholder = "Select account",
  className,
  showDetail = true,
}: AccountSelectProps) {
  const { accounts: all } = useChartOfAccounts();
  const [open, setOpen] = useState(false);

  const list = useMemo(
    () => (accounts ?? all).filter((a) => a.is_active),
    [accounts, all],
  );
  const selected = list.find((a) => a.id === value) ?? null;

  return (
    <div className={cn("space-y-1", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            <span className={cn("truncate", !selected && "text-muted-foreground")}>
              {selected
                ? `${selected.account_code} — ${selected.account_name}`
                : placeholder}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[420px] p-0" align="start">
          <Command
            filter={(itemValue, search) =>
              itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
            }
          >
            <CommandInput placeholder="Search by number or name…" />
            <CommandList className="max-h-[320px]">
              <CommandEmpty>No matching account.</CommandEmpty>
              <CommandGroup>
                {list.map((account) => (
                  <CommandItem
                    key={account.id}
                    value={`${account.account_code} ${account.account_name}`}
                    onSelect={() => {
                      onValueChange(account.id);
                      setOpen(false);
                    }}
                    className="items-start gap-2"
                  >
                    <Check
                      className={cn(
                        "mt-1 h-4 w-4 shrink-0",
                        account.id === value ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <div className="min-w-0 space-y-1">
                      <p className="truncate text-sm">
                        <span className="font-medium tabular-nums">{account.account_code}</span>{" "}
                        — {account.account_name}
                      </p>
                      <AccountBadges account={account} />
                      {(account.help_text || account.description) && (
                        <p className="text-[11px] leading-snug text-muted-foreground">
                          {account.help_text || account.description}
                        </p>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {showDetail && selected && (
        <div className="space-y-1 rounded-md border bg-muted/30 p-2">
          <AccountBadges account={selected} />
          {(selected.help_text || selected.description) && (
            <p className="flex items-start gap-1 text-[11px] leading-snug text-muted-foreground">
              <Info className="mt-[1px] h-3 w-3 shrink-0" />
              {selected.help_text || selected.description}
            </p>
          )}
        </div>
      )}
    </div>
  );
}