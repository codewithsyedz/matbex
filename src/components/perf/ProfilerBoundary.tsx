import { Profiler, ProfilerOnRenderCallback, ReactNode, useCallback } from "react";
import { perfProfiler } from "@/lib/perf/perfProfiler";

interface ProfilerBoundaryProps {
  id: string;
  children: ReactNode;
  /** Ignore commits faster than this (ms) to keep the log readable. */
  threshold?: number;
}

/**
 * Wraps a subtree in React's <Profiler> and forwards commit timings to the
 * perf profiler. Renders children untouched when profiling is disabled.
 */
export function ProfilerBoundary({ id, children, threshold = 8 }: ProfilerBoundaryProps) {
  const onRender = useCallback<ProfilerOnRenderCallback>(
    (profilerId, phase, actualDuration, baseDuration) => {
      if (actualDuration < threshold) return;
      perfProfiler.record({
        kind: "render",
        label: profilerId,
        duration: Math.round(actualDuration),
        reason: phase === "mount" ? "mount" : phase === "nested-update" ? "nested update" : "re-render",
        detail: `base ${Math.round(baseDuration)}ms`,
      });
    },
    [threshold],
  );

  if (!perfProfiler.isEnabled()) return <>{children}</>;

  return (
    <Profiler id={id} onRender={onRender}>
      {children}
    </Profiler>
  );
}
