import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface CardTooltipProps {
  label: string;
  children: React.ReactNode;
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
}

/**
 * Small info icon tooltip for card headers. Use it to explain exactly what a
 * totals card includes (closed days only, month-to-date, open-day included, etc.)
 * so users never have to guess why two cards show different numbers.
 */
export function CardTooltip({
  label,
  children,
  className,
  side = "top",
  align = "start",
}: CardTooltipProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`How ${label} is calculated`}
            className={cn(
              "ml-1 inline-flex shrink-0 text-muted-foreground/70 hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded",
              className
            )}
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side={side} align={align} className="max-w-xs text-xs leading-relaxed">
          <p className="font-medium text-foreground mb-1">{label}</p>
          <div className="text-muted-foreground space-y-1">{children}</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
