import { Component, ReactNode, Suspense } from "react";
import { SkeletonCard } from "@/components/ui/skeleton-card";

interface BoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  name?: string;
}

interface BoundaryState {
  hasError: boolean;
  retryCount: number;
}

/**
 * Soft, section-local error boundary. A failure in one dashboard section
 * must never blank the page or block menu/navigation - we degrade to a
 * small inline notice and keep the rest of the dashboard interactive.
 */
class SectionErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { hasError: false, retryCount: 0 };
  private static MAX_RETRIES = 1;

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true, retryCount: 0 };
  }

  componentDidCatch(error: Error) {
    // Auto-recover on stale dynamic-import chunks (deploy mid-session),
    // but only ONCE per section - otherwise a chunk that genuinely cannot
    // be fetched will retry forever, which in turn causes the parent
    // LazyLoadErrorBoundary to reload the whole page in a loop and
    // re-trigger seat activation on every cycle.
    const isChunkError =
      error?.message?.includes("Failed to fetch dynamically imported module") ||
      error?.message?.includes("Loading chunk");
    if (isChunkError && this.state.retryCount < SectionErrorBoundary.MAX_RETRIES) {
      console.warn(`[dashboard:${this.props.name ?? "section"}] chunk reload`, error);
      this.setState((s) => ({ hasError: false, retryCount: s.retryCount + 1 }));
      return;
    }
    console.error(`[dashboard:${this.props.name ?? "section"}]`, error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 rounded-lg border border-dashed border-border bg-muted/20 text-xs text-muted-foreground">
          This section is temporarily unavailable. The rest of the dashboard is fine.
        </div>
      );
    }
    return this.props.children;
  }
}

interface DashboardSectionProps {
  children: ReactNode;
  /** Optional custom skeleton; defaults to a single SkeletonCard. */
  fallback?: ReactNode;
  /** Identifier used in dev logs to localize failures. */
  name?: string;
  /** Optional wrapper className applied to the Suspense fallback area. */
  className?: string;
}

/**
 * Wraps a dashboard section so it loads asynchronously with its own
 * Suspense + error boundary. Each section streams in independently and
 * cannot block the app shell, menu, or route navigation.
 */
export function DashboardSection({
  children,
  fallback,
  name,
  className,
}: DashboardSectionProps) {
  return (
    <SectionErrorBoundary name={name}>
      <Suspense
        fallback={
          <div className={className}>{fallback ?? <SkeletonCard />}</div>
        }
      >
        {children}
      </Suspense>
    </SectionErrorBoundary>
  );
}