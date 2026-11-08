import { Link } from "react-router-dom";
import { ArrowRight, MonitorSmartphone, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TOUR_STEPS } from "./tourSteps";

interface ScreenshotCalloutProps {
  anchor: string;
  /** Optional explicit screenshot URL stored on the CMS block */
  screenshot?: string;
  /** Optional caption override */
  caption?: string;
}

/**
 * Visual "what you should see" callout rendered under every docs step.
 * Shows a Mac-style window chrome wrapping either a real screenshot (when
 * available) or a polished placeholder that links straight to the live screen.
 */
export function ScreenshotCallout({ anchor, screenshot, caption }: ScreenshotCalloutProps) {
  const step = TOUR_STEPS.find((s) => s.anchor === anchor);
  if (!step) return null;

  const isDocsAnchor = step.route.startsWith("/docs#");
  const routeLabel = isDocsAnchor ? step.route : step.route;

  return (
    <figure className="mt-10 mb-4 not-prose">
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        {/* Window chrome */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted/40">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          </div>
          <div className="flex-1 flex justify-center">
            <Badge variant="secondary" className="font-mono text-[11px] tracking-tight">
              matbex.com{routeLabel}
            </Badge>
          </div>
          <div className="w-12" />
        </div>

        {/* Body */}
        {screenshot ? (
          <img
            src={screenshot}
            alt={caption || `Screenshot of ${step.title}`}
            loading="lazy"
            className="w-full h-auto block bg-background"
          />
        ) : (
          <div className="relative bg-gradient-to-br from-muted/30 via-background to-muted/40 px-6 py-10 sm:py-14">
            <div className="max-w-xl mx-auto text-center space-y-4">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <MonitorSmartphone className="h-6 w-6" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-1.5">
                  What you should see
                </p>
                <h4 className="text-lg font-medium text-foreground">{step.title}</h4>
                <p className="text-sm text-muted-foreground mt-1.5 font-light">
                  {step.description}
                </p>
              </div>
              <div className="flex items-center justify-center gap-2 pt-1">
                {!isDocsAnchor && (
                  <Button asChild size="sm" variant="default" className="rounded-full">
                    <Link to={step.route}>
                      <Eye className="h-3.5 w-3.5 mr-1.5" />
                      Open this screen
                      <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                    </Link>
                  </Button>
                )}
              </div>
            </div>
            {/* subtle grid backdrop */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-[0.04]"
              style={{
                backgroundImage:
                  "linear-gradient(to right, hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--foreground)) 1px, transparent 1px)",
                backgroundSize: "24px 24px",
              }}
            />
          </div>
        )}
      </div>
      {caption && (
        <figcaption className="mt-2 text-xs text-muted-foreground text-center font-light">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}