import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpCircle } from "lucide-react";

export function FeatureLegend() {
  const states = [
    {
      label: "Enabled",
      color: "bg-emerald-500",
      desc: "Fully live and visible to all users",
    },
    {
      label: "Preview",
      color: "bg-amber-500",
      desc: "Available in plan but toggled off remotely - internal testing only",
    },
    {
      label: "Locked",
      color: "bg-muted-foreground/50",
      desc: "Not included in current plan - requires upgrade",
    },
  ];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors w-full">
          <HelpCircle className="h-3 w-3" />
          <span>Feature States</span>
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="right"
        className="w-56 p-3 space-y-2"
        sideOffset={8}
      >
        <p className="text-xs font-semibold text-foreground">Feature Readiness</p>
        {states.map((s) => (
          <div key={s.label} className="flex items-start gap-2">
            <span className={cn("mt-0.5 h-2 w-2 rounded-full flex-shrink-0", s.color)} />
            <div>
              <span className="text-xs font-medium text-foreground">{s.label}</span>
              <p className="text-[10px] text-muted-foreground leading-tight">{s.desc}</p>
            </div>
          </div>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}
