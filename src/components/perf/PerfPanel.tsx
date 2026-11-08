import { useMemo, useState, useSyncExternalStore } from "react";
import { Activity, ChevronDown, ChevronUp, Eraser, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { perfProfiler, summarize, SLOW_MS, type PerfKind } from "@/lib/perf/perfProfiler";

const KIND_STYLES: Record<PerfKind, { label: string; className: string }> = {
  query: { label: "Query", className: "bg-primary/10 text-primary border-primary/20" },
  render: { label: "Render", className: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  task: { label: "Task", className: "bg-destructive/10 text-destructive border-destructive/20" },
};

type Tab = "timeline" | "hotspots";

export function PerfPanel() {
  const state = useSyncExternalStore(
    (cb) => perfProfiler.subscribe(cb),
    () => perfProfiler.getState(),
    () => perfProfiler.getState(),
  );
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState<Tab>("timeline");
  const [filter, setFilter] = useState<PerfKind | "all">("all");

  const events = useMemo(
    () => (filter === "all" ? state.events : state.events.filter((e) => e.kind === filter)),
    [state.events, filter],
  );
  const hotspots = useMemo(() => summarize(events).slice(0, 20), [events]);
  const blockers = state.events.filter((e) => e.duration >= SLOW_MS).length;

  return (
    <aside
      aria-label="Performance profiler"
      className="fixed bottom-4 left-4 z-[100] w-[min(420px,calc(100vw-2rem))] rounded-lg border border-border bg-background/95 backdrop-blur shadow-xl"
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          <span className="text-xs font-semibold uppercase tracking-wide">Perf profiler</span>
          <span className="truncate text-xs text-muted-foreground">
            {state.events.length} events · {blockers} slow
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => perfProfiler.clear()} aria-label="Clear events" title="Clear">
            <Eraser className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setCollapsed((v) => !v)} aria-label={collapsed ? "Expand profiler" : "Collapse profiler"}>
            {collapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => perfProfiler.disable()} aria-label="Disable profiler" title="Disable">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      {!collapsed && (
        <>
          <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2">
            {(["timeline", "hotspots"] as Tab[]).map((t) => (
              <Button key={t} size="sm" variant={tab === t ? "secondary" : "ghost"} className="h-6 px-2 text-[11px] capitalize" onClick={() => setTab(t)}>
                {t}
              </Button>
            ))}
            <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
            {(["all", "query", "render", "task"] as const).map((k) => (
              <Button key={k} size="sm" variant={filter === k ? "secondary" : "ghost"} className="h-6 px-2 text-[11px] capitalize" onClick={() => setFilter(k)}>
                {k}
              </Button>
            ))}
          </div>

          {events.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              No activity captured yet. Navigate or refresh the dashboard to record fetches, commits and long tasks.
            </p>
          ) : (
            <ScrollArea className="max-h-[45vh]">
              {tab === "timeline" ? (
                <ul className="divide-y divide-border">
                  {events.map((e) => (
                    <li key={e.id} className="px-3 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="outline" className={cn("font-medium", KIND_STYLES[e.kind].className)}>
                          {KIND_STYLES[e.kind].label}
                        </Badge>
                        <span className={cn("font-mono", e.duration >= SLOW_MS ? "font-semibold text-destructive" : "text-muted-foreground")}>
                          {e.duration} ms
                        </span>
                      </div>
                      <p className="mt-1 truncate font-medium text-foreground" title={e.label}>
                        {e.label}
                      </p>
                      <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                        {e.reason}
                        {e.detail ? ` · ${e.detail}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="divide-y divide-border">
                  {hotspots.map((h) => (
                    <li key={`${h.kind}-${h.label}`} className="px-3 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="outline" className={cn("font-medium", KIND_STYLES[h.kind].className)}>
                          {KIND_STYLES[h.kind].label}
                        </Badge>
                        <span className={cn("font-mono", h.total >= SLOW_MS ? "font-semibold text-destructive" : "text-muted-foreground")}>
                          {Math.round(h.total)} ms total
                        </span>
                      </div>
                      <p className="mt-1 truncate font-medium text-foreground" title={h.label}>
                        {h.label}
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {h.count}× · max {Math.round(h.max)} ms · avg {Math.round(h.total / h.count)} ms
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          )}
        </>
      )}
    </aside>
  );
}
