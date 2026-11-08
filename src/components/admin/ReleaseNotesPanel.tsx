import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Server, Smartphone, MonitorSmartphone } from "lucide-react";
import { RELEASE_NOTES, IMPACT_META, type ReleaseImpact } from "@/data/releaseNotes";

const IMPACT_STYLES: Record<ReleaseImpact, string> = {
  "backend-only": "border-primary/30 bg-primary/10 text-primary",
  "terminal-update": "border-destructive/30 bg-destructive/10 text-destructive",
  "web-app": "border-border bg-muted text-muted-foreground",
};

const IMPACT_ICONS: Record<ReleaseImpact, typeof Server> = {
  "backend-only": Server,
  "terminal-update": Smartphone,
  "web-app": MonitorSmartphone,
};

const FILTERS: Array<{ value: ReleaseImpact | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "backend-only", label: "Backend only" },
  { value: "terminal-update", label: "Terminal update" },
  { value: "web-app", label: "Web app" },
];

interface ReleaseNotesPanelProps {
  /** Show only the most recent release (used on the overview dashboard). */
  compact?: boolean;
}

export function ReleaseNotesPanel({ compact = false }: ReleaseNotesPanelProps) {
  const [filter, setFilter] = useState<ReleaseImpact | "all">("all");

  const releases = useMemo(() => {
    const base = compact ? RELEASE_NOTES.slice(0, 1) : RELEASE_NOTES;
    if (filter === "all") return base;
    return base
      .map((r) => ({ ...r, items: r.items.filter((i) => i.impact === filter) }))
      .filter((r) => r.items.length > 0);
  }, [compact, filter]);

  const terminalCount = useMemo(
    () =>
      (compact ? RELEASE_NOTES.slice(0, 1) : RELEASE_NOTES).reduce(
        (sum, r) => sum + r.items.filter((i) => i.impact === "terminal-update").length,
        0,
      ),
    [compact],
  );

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base font-medium">Release Notes</CardTitle>
            <CardDescription>
              {terminalCount === 0
                ? "No terminal updates required in this scope — changes apply automatically."
                : `${terminalCount} change${terminalCount > 1 ? "s" : ""} require an Android terminal update.`}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <Button
                key={f.value}
                size="sm"
                variant={filter === f.value ? "secondary" : "ghost"}
                onClick={() => setFilter(f.value)}
              >
                {f.label}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {releases.length === 0 && (
          <p className="text-sm text-muted-foreground">No changes match this filter.</p>
        )}
        {releases.map((release, idx) => (
          <div key={release.version} className="space-y-3">
            {idx > 0 && <Separator />}
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-sm font-semibold text-foreground">v{release.version}</span>
              <span className="text-xs text-muted-foreground">{release.date}</span>
              <span className="text-xs text-muted-foreground">— {release.summary}</span>
            </div>
            <ul className="space-y-3">
              {release.items.map((item) => {
                const Icon = IMPACT_ICONS[item.impact];
                return (
                  <li
                    key={item.title}
                    className="rounded-lg border border-border/40 p-3 transition-colors hover:bg-muted/40"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={IMPACT_STYLES[item.impact]}>
                        <Icon className="mr-1 h-3 w-3" />
                        {IMPACT_META[item.impact].label}
                      </Badge>
                      {item.area && (
                        <span className="text-xs text-muted-foreground">{item.area}</span>
                      )}
                    </div>
                    <p className="mt-2 text-sm font-medium text-foreground">{item.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
                    <p className="mt-1 text-xs text-muted-foreground/80">
                      {IMPACT_META[item.impact].hint}
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default ReleaseNotesPanel;
