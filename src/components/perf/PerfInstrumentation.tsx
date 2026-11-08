import { lazy, Suspense, useEffect, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { perfProfiler } from "@/lib/perf/perfProfiler";

const PerfPanel = lazy(() => import("./PerfPanel").then((m) => ({ default: m.PerfPanel })));

function formatKey(key: unknown): string {
  if (!Array.isArray(key)) return String(key);
  return key
    .map((part) =>
      part === null || part === undefined
        ? "-"
        : typeof part === "object"
          ? JSON.stringify(part)
          : String(part),
    )
    .join(" · ")
    .slice(0, 90);
}

/**
 * Installs query-level instrumentation (fetch durations + why each fetch ran)
 * and mounts the floating profiler panel. Enabled with `?perf=1`.
 */
export function PerfInstrumentation() {
  const queryClient = useQueryClient();
  const enabled = useSyncExternalStore(
    (cb) => perfProfiler.subscribe(cb),
    () => perfProfiler.getState().enabled,
    () => false,
  );

  useEffect(() => {
    perfProfiler.bootstrap();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const cache = queryClient.getQueryCache();
    const startedAt = new Map<string, number>();

    const unsubscribe = cache.subscribe((event) => {
      const query = event.query;
      if (!query) return;

      if (event.type === "updated" && (event as any).action?.type === "fetch") {
        startedAt.set(query.queryHash, performance.now());
        return;
      }

      if (event.type === "updated") {
        const action = (event as any).action;
        if (action?.type !== "success" && action?.type !== "error") return;
        const start = startedAt.get(query.queryHash);
        if (start === undefined) return;
        startedAt.delete(query.queryHash);

        const observers = query.getObserversCount();
        perfProfiler.record({
          kind: "query",
          label: formatKey(query.queryKey),
          duration: Math.round(performance.now() - start),
          reason:
            action.type === "error"
              ? "fetch failed"
              : query.state.dataUpdateCount <= 1
                ? "initial fetch"
                : "refetch (stale)",
          detail: `${observers} observer${observers === 1 ? "" : "s"}${
            action.type === "error" ? " · error" : ""
          }`,
        });
      }
    });

    return unsubscribe;
  }, [enabled, queryClient]);

  if (!enabled) return null;

  return (
    <Suspense fallback={null}>
      <PerfPanel />
    </Suspense>
  );
}
