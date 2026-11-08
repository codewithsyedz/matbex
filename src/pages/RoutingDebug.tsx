import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, Download, Trash2 } from "lucide-react";
import {
  clearRouteGuardLog,
  detectRedirectLoops,
  getRouteGuardLog,
  isRouteDebugEnabled,
  setRouteDebugEnabled,
  subscribeRouteGuardLog,
  type RouteGuardLogEntry,
} from "@/lib/routeGuardLog";

const decisionVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  allow: "secondary",
  redirect: "destructive",
  wait: "outline",
  block: "destructive",
  nav: "default",
};

export default function RoutingDebug() {
  const location = useLocation();
  const [entries, setEntries] = useState<RouteGuardLogEntry[]>(getRouteGuardLog());
  const [verbose, setVerbose] = useState(isRouteDebugEnabled());

  useEffect(() => subscribeRouteGuardLog(setEntries), []);

  const loops = useMemo(() => detectRedirectLoops(entries), [entries]);
  const ordered = useMemo(() => [...entries].reverse(), [entries]);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `route-guard-log-${new Date().toISOString().slice(0, 19)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">Routing Diagnostics</h1>
          <p className="text-sm text-muted-foreground font-light">
            Temporary instrumentation of route-guard decisions. Current path: {location.pathname}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              id="verbose"
              checked={verbose}
              onCheckedChange={v => {
                setVerbose(v);
                setRouteDebugEnabled(v);
              }}
            />
            <Label htmlFor="verbose" className="text-sm font-light">Console logging</Label>
          </div>
          <Button variant="outline" size="sm" onClick={exportJson} disabled={!entries.length}>
            <Download className="h-4 w-4 mr-2" /> Export
          </Button>
          <Button variant="outline" size="sm" onClick={clearRouteGuardLog} disabled={!entries.length}>
            <Trash2 className="h-4 w-4 mr-2" /> Clear
          </Button>
        </div>
      </div>

      {loops.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Possible redirect loop detected</AlertTitle>
          <AlertDescription>
            <ul className="mt-2 space-y-1 text-sm">
              {loops.map(l => (
                <li key={l.pair}>
                  <span className="font-mono">{l.pair}</span> — {l.count}x ({l.reasons.join(", ")})
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-normal">
            Guard decisions ({entries.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {ordered.length === 0 ? (
            <p className="text-sm text-muted-foreground font-light">
              No entries yet. Navigate around the app (or reproduce the bounce) and come back.
            </p>
          ) : (
            <ScrollArea className="h-[520px] pr-3">
              <div className="space-y-2">
                {ordered.map(e => (
                  <div key={e.id} className="rounded-md border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={decisionVariant[e.decision] ?? "outline"}>{e.decision}</Badge>
                      <span className="font-mono text-xs break-all">
                        {e.pathname}
                        {e.search}
                        {e.to ? ` → ${e.to}` : ""}
                      </span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {new Date(e.ts).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground font-light">reason: {e.reason}</p>
                    {e.context && (
                      <pre className="mt-2 overflow-x-auto rounded bg-muted/50 p-2 text-[11px] leading-relaxed">
                        {JSON.stringify(e.context)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
