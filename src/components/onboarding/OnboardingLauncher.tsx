import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Compass } from "lucide-react";
import { OnboardingTour } from "./OnboardingTour";
import { useOnboardingProgress, useOnboardingLauncherDismissed } from "@/hooks/useOnboardingProgress";
import { TOUR_STEPS } from "./tourSteps";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function OnboardingLauncher() {
  const [open, setOpen] = useState(false);
  const { completed } = useOnboardingProgress();
  const { dismissed, dismiss } = useOnboardingLauncherDismissed();

  const total = TOUR_STEPS.length;
  const done = completed.size;
  const isComplete = done >= total;
  const showPulse = !dismissed && done === 0;

  const handleOpen = (v: boolean) => {
    setOpen(v);
    if (v && !dismissed) dismiss();
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleOpen(true)}
            className="relative h-9 gap-1.5"
            aria-label="Open guided tour"
          >
            <Compass className="h-4 w-4" />
            <span className="hidden md:inline text-xs">
              {isComplete ? "Tour" : `${done}/${total}`}
            </span>
            {showPulse && (
              <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {isComplete ? "Revisit the guided tour" : "Start the guided tour"}
        </TooltipContent>
      </Tooltip>
      <OnboardingTour open={open} onOpenChange={handleOpen} />
    </>
  );
}