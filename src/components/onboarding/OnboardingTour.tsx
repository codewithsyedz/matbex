import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ArrowRight, BookOpen, CheckCircle2, RotateCcw } from "lucide-react";
import { motion } from "framer-motion";
import { TOUR_STEPS, type TourStep } from "./tourSteps";
import { useOnboardingProgress } from "@/hooks/useOnboardingProgress";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OnboardingTour({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const { completed, toggle, reset } = useOnboardingProgress();
  const [activeId, setActiveId] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<TourStep["group"], TourStep[]>();
    for (const s of TOUR_STEPS) {
      if (!map.has(s.group)) map.set(s.group, []);
      map.get(s.group)!.push(s);
    }
    return Array.from(map.entries());
  }, []);

  const total = TOUR_STEPS.length;
  const done = TOUR_STEPS.filter((s) => completed.has(s.id)).length;
  const pct = Math.round((done / total) * 100);

  const goToStep = (step: TourStep) => {
    setActiveId(step.id);
    if (step.route.startsWith("/docs#")) {
      navigate(step.route);
    } else {
      navigate(step.route);
    }
    // Auto-mark when navigating, but keep checkbox source of truth
    toggle(step.id, true);
    onOpenChange(false);
  };

  const openDocsAnchor = (anchor: string) => {
    navigate(`/docs#${anchor}`);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border">
          <SheetTitle className="font-display text-xl font-semibold tracking-tight">Getting Started</SheetTitle>
          <SheetDescription className="text-sm">
            A guided walkthrough — each step links straight to the screen you need.
          </SheetDescription>
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{done} of {total} completed</span>
              <span className="tabular-nums">{pct}%</span>
            </div>
            <Progress value={pct} className="h-1.5" />
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="px-6 py-4 space-y-6">
            {grouped.map(([group, steps]) => (
              <section key={group}>
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
                  {group}
                </h3>
                <ul className="space-y-2">
                  {steps.map((step, idx) => {
                    const isDone = completed.has(step.id);
                    const isActive = activeId === step.id;
                    return (
                      <motion.li
                        key={step.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2, delay: idx * 0.02 }}
                        className={`group rounded-lg border bg-card p-3 transition-colors ${
                          isActive ? "border-primary/40" : "border-border hover:border-foreground/20"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <Checkbox
                            checked={isDone}
                            onCheckedChange={(v) => toggle(step.id, !!v)}
                            className="mt-0.5"
                            aria-label={`Mark ${step.title} complete`}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <h4 className={`text-sm font-medium ${isDone ? "line-through text-muted-foreground" : ""}`}>
                                {step.title}
                              </h4>
                              {isDone && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                              {step.description}
                            </p>
                            <div className="flex items-center gap-2 mt-2.5">
                              <Button
                                size="sm"
                                variant="default"
                                className="h-7 text-xs"
                                onClick={() => goToStep(step)}
                              >
                                {step.cta}
                                <ArrowRight className="ml-1 h-3 w-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs gap-1"
                                onClick={() => openDocsAnchor(step.anchor)}
                              >
                                <BookOpen className="h-3 w-3" />
                                Docs
                              </Button>
                            </div>
                          </div>
                        </div>
                      </motion.li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </ScrollArea>

        <Separator />
        <div className="px-6 py-3 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={reset} className="text-xs gap-1">
            <RotateCcw className="h-3 w-3" />
            Reset progress
          </Button>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="text-xs">
            Close
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}