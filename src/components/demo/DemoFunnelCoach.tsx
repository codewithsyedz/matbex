import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight,
  BarChart3,
  Building2,
  CheckCircle2,
  FileSpreadsheet,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import { useDemoTrial } from "@/hooks/useDemoTrial";
import { ActivationUpgradeDialog } from "@/components/demo/ActivationUpgradeDialog";
import { useFunnelTracker } from "@/hooks/useFunnelTracker";

type Bucket = "activation" | "engagement" | "evaluation" | "conversion";

function bucketFor(daysLeft: number | null): Bucket | null {
  if (daysLeft === null) return null;
  const dayInTrial = 14 - daysLeft; // Day 0 = just started
  if (dayInTrial <= 1) return "activation";
  if (dayInTrial <= 6) return "engagement";
  if (dayInTrial <= 10) return "evaluation";
  return "conversion";
}

const COPY: Record<Bucket, { tag: string; title: string; body: string; cta: string; icon: any }> = {
  activation: {
    tag: "Day 0–1 · Live Demo",
    title: "Run your restaurant like a business, not a guess.",
    body: "Place a real order, then open Reports - every action you take here behaves exactly like production Matbex.",
    cta: "See what's inside",
    icon: Sparkles,
  },
  engagement: {
    tag: "Day 2–6 · Explore",
    title: "Make Matbex feel like your operating system.",
    body: "Open the VAT-ready sales summary, compare daily vs weekly performance, and try adding a second branch.",
    cta: "Tour key features",
    icon: Target,
  },
  evaluation: {
    tag: "Day 7–10 · Decide",
    title: "Most Matbex customers activate between days 7–10.",
    body: "ZATCA compliance, live payments and full exports unlock the moment you activate. No reset, no reconfiguration.",
    cta: "See what unlocks",
    icon: ShieldCheck,
  },
  conversion: {
    tag: "Day 11–14 · Activate",
    title: "Activate Matbex. Go live today.",
    body: "Your data, users and configuration carry over instantly. HyperPay, Mada and unlimited branches turn on the moment you upgrade.",
    cta: "Activate Matbex",
    icon: CheckCircle2,
  },
};

/**
 * Day-aware conversion coach shown on the dashboard for DEMO_ENTERPRISE
 * tenants. Drives the user from activation → engagement → evaluation →
 * conversion per the Matbex funnel PRD.
 */
export function DemoFunnelCoach() {
  const { isDemo, isTrial, daysLeft, isExpired } = useDemoTrial();
  const { track } = useFunnelTracker();
  const [open, setOpen] = useState(false);

  const bucket = useMemo(() => bucketFor(daysLeft), [daysLeft]);

  if (!isDemo || !isTrial || isExpired || !bucket) return null;

  const copy = COPY[bucket];
  const Icon = copy.icon;

  return (
    <>
      <Card className="border-warning/35 bg-gradient-to-br from-warning/10 via-card to-card shadow-sm">
        <CardContent className="pt-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning">
              <Icon className="h-5 w-5" />
            </div>
            <div className="space-y-1.5">
              <Badge variant="outline" className="border-warning/35 bg-warning/10 text-warning">
                {copy.tag}
              </Badge>
              <h3 className="text-base font-semibold tracking-tight text-foreground">{copy.title}</h3>
              <p className="max-w-2xl text-sm text-muted-foreground">{copy.body}</p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1"><BarChart3 className="h-3.5 w-3.5" /> Reports</span>
                <span className="inline-flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> Multi-branch</span>
                <span className="inline-flex items-center gap-1"><FileSpreadsheet className="h-3.5 w-3.5" /> ZATCA & exports</span>
              </div>
            </div>
          </div>
          <Button
            className="shrink-0"
            variant={bucket === "conversion" ? "default" : "outline"}
            onClick={() => {
              setOpen(true);
              track("activation_dialog_opened", { bucket });
            }}
          >
            {copy.cta}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </CardContent>
      </Card>
      <ActivationUpgradeDialog open={open} onOpenChange={setOpen} />
    </>
  );
}