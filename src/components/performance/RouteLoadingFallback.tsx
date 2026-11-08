import { MatbexLogo } from "@/components/brand/MatbexLogo";

/**
 * Inline route loading fallback. Renders a thin indeterminate progress
 * bar pinned to the top of the current container - no fullscreen logo
 * flash on every navigation. Used inside the persistent AppLayout, so
 * the sidebar and header stay mounted while the next chunk loads.
 */
export function RouteLoadingFallback() {
  return (
    <div className="relative w-full">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[2px] overflow-hidden bg-primary/10"
        role="progressbar"
        aria-label="Loading page"
      >
        <div className="h-full w-1/3 animate-route-progress bg-primary/80" />
      </div>
    </div>
  );
}

/**
 * Fullscreen variant - only for top-level shells where no AppLayout is
 * mounted yet (e.g. initial auth bootstrap).
 */
export function FullscreenRouteFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-3">
        <div className="opacity-90">
          <MatbexLogo size="lg" showWordmark={false} animate={false} />
        </div>
        <div className="h-0.5 bg-primary/30 rounded-full max-w-[60px] mx-auto" />
      </div>
    </div>
  );
}
