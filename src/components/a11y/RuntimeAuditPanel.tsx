import { useEffect, useState, useSyncExternalStore } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Eraser, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  runtimeDialogAudit,
  type AuditFinding,
  type AuditStatus,
} from "@/lib/a11y/runtimeDialogAudit";

const STATUS_STYLES: Record<AuditStatus, { label: string; className: string; icon: typeof AlertCircle }> = {
  ok: {
    label: "OK",
    className: "bg-primary/10 text-primary border-primary/20",
    icon: CheckCircle2,
  },
  generic: {
    label: "Generic",
    className: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    icon: AlertCircle,
  },
  missing: {
    label: "Missing",
    className: "bg-destructive/10 text-destructive border-destructive/20",
    icon: AlertCircle,
  },
};

function formatTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

function FindingRow({ finding }: { finding: AuditFinding }) {
  const meta = STATUS_STYLES[finding.status];
  const Icon = meta.icon;
  return (
    <li className="border-b border-border last:border-b-0 px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <Badge variant="outline" className={cn("gap-1 font-medium", meta.className)}>
          <Icon className="h-3 w-3" aria-hidden="true" />
          {meta.label}
        </Badge>
        <span className="text-muted-foreground font-mono">{formatTime(finding.openedAt)}</span>
      </div>
      <p className="mt-1 font-medium text-foreground truncate" title={finding.title ?? "(untitled)"}>
        {finding.title ?? <span className="italic text-muted-foreground">(no aria-labelledby)</span>}
      </p>
      <p
        className={cn(
          "mt-0.5 truncate",
          finding.status === "ok" ? "text-muted-foreground" : "text-destructive",
        )}
        title={finding.descriptionText ?? "missing"}
      >
        {finding.status === "missing"
          ? "No aria-describedby"
          : finding.descriptionText}
      </p>
      <p className="mt-0.5 text-[10px] text-muted-foreground font-mono truncate">
        {finding.role} · {finding.route}
      </p>
    </li>
  );
}

export function RuntimeAuditPanel() {
  const state = useSyncExternalStore(
    (cb) => runtimeDialogAudit.subscribe(cb),
    () => runtimeDialogAudit.getState(),
    () => runtimeDialogAudit.getState(),
  );
  const [collapsed, setCollapsed] = useState(false);

  // Bootstrap from localStorage / URL param once on mount.
  useEffect(() => {
    runtimeDialogAudit.bootstrap();
  }, []);

  if (!state.enabled) return null;

  const counts = state.findings.reduce(
    (acc, f) => {
      acc[f.status] += 1;
      return acc;
    },
    { ok: 0, generic: 0, missing: 0 } as Record<AuditStatus, number>,
  );

  return (
    <aside
      aria-label="Accessibility audit panel"
      className="fixed bottom-4 right-4 z-[100] w-[min(360px,calc(100vw-2rem))] rounded-lg border border-border bg-background/95 backdrop-blur shadow-xl"
    >
      <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <span className="h-2 w-2 rounded-full bg-primary animate-pulse" aria-hidden="true" />
          <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
            A11y audit
          </span>
          <span className="text-xs text-muted-foreground truncate">
            {state.findings.length} observed · {counts.missing + counts.generic} issue
            {counts.missing + counts.generic === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => runtimeDialogAudit.clear()}
            aria-label="Clear audit findings"
            title="Clear findings"
          >
            <Eraser className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Expand audit panel" : "Collapse audit panel"}
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => runtimeDialogAudit.disable()}
            aria-label="Disable audit mode"
            title="Disable audit mode"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>
      {!collapsed && (
        <>
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border text-xs">
            <Badge variant="outline" className={STATUS_STYLES.ok.className}>OK {counts.ok}</Badge>
            <Badge variant="outline" className={STATUS_STYLES.generic.className}>Generic {counts.generic}</Badge>
            <Badge variant="outline" className={STATUS_STYLES.missing.className}>Missing {counts.missing}</Badge>
          </div>
          {state.findings.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              No dialogs observed yet. Open a dialog, sheet, or drawer to see it appear here.
            </p>
          ) : (
            <ScrollArea className="max-h-[40vh]">
              <ul className="divide-y divide-border">
                {state.findings.map((f) => (
                  <FindingRow key={f.id} finding={f} />
                ))}
              </ul>
            </ScrollArea>
          )}
        </>
      )}
    </aside>
  );
}