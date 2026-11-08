import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Bug, Copy, Download, Trash2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toast } from "sonner";
import {
  type RevokeDiagnosticEntry,
  clearRevokeDiagnostics,
  readRevokeDiagnostics,
} from "@/lib/offline/revokeDiagnosticsLog";

export function RevokeDiagnosticsPanel() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<RevokeDiagnosticEntry[]>([]);

  const refresh = () => setEntries(readRevokeDiagnostics());

  useEffect(() => {
    refresh();
    const onStorage = () => refresh();
    window.addEventListener("storage", onStorage);
    const t = window.setInterval(refresh, 3000);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.clearInterval(t);
    };
  }, []);

  const failures = entries.filter((e) => !e.ok).length;
  const latest = entries[0];

  const copyJson = async (payload: unknown, label: string) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      toast.success(`${label} copied`);
    } catch {
      toast.error("Copy failed");
    }
  };

  const downloadAll = () => {
    const blob = new Blob([JSON.stringify(entries, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `revoke-diagnostics-${format(new Date(), "yyyyMMdd-HHmmss")}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <Card className="border-dashed">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors pb-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Bug className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base font-medium">
                  Revoke diagnostics
                </CardTitle>
                {latest && (
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${
                      latest.ok
                        ? "bg-emerald-500/10 text-emerald-600"
                        : "bg-rose-500/10 text-rose-600"
                    }`}
                  >
                    Last: {latest.ok ? "OK" : "Failed"}
                  </Badge>
                )}
                {failures > 0 && (
                  <Badge variant="outline" className="text-[10px] bg-rose-500/10 text-rose-600">
                    {failures} failure{failures !== 1 && "s"}
                  </Badge>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {open ? "Hide" : "Show"}
              </span>
            </div>
            <CardDescription className="text-xs">
              Captures the request payload, HTTP status, response body, and error
              context for each Revoke attempt so you can share it with support.
            </CardDescription>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium">
                {entries.length} recent attempt{entries.length !== 1 && "s"}
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={entries.length === 0}
                  onClick={downloadAll}
                >
                  <Download className="h-3.5 w-3.5 mr-1" />
                  Download JSON
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={entries.length === 0}
                  onClick={() => copyJson(entries, "All entries")}
                >
                  <Copy className="h-3.5 w-3.5 mr-1" />
                  Copy all
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={entries.length === 0}
                  onClick={() => {
                    clearRevokeDiagnostics();
                    refresh();
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Clear
                </Button>
              </div>
            </div>

            {entries.length === 0 ? (
              <p className="text-xs text-muted-foreground py-6 text-center">
                No revoke attempts recorded yet. Try revoking a device to capture
                a diagnostic entry.
              </p>
            ) : (
              <ScrollArea className="h-[360px] rounded-md border border-border/50">
                <ul className="divide-y divide-border/50">
                  {entries.map((e, i) => (
                    <li key={i} className="p-3 text-xs space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {e.ok ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                          ) : (
                            <XCircle className="h-3.5 w-3.5 text-rose-600" />
                          )}
                          <span className="font-medium">
                            {e.ok ? "Success" : "Failed"}
                          </span>
                          {e.response.status != null && (
                            <Badge variant="outline" className="text-[10px]">
                              HTTP {e.response.status}
                            </Badge>
                          )}
                          {!e.request.online && (
                            <Badge
                              variant="outline"
                              className="text-[10px] bg-amber-500/10 text-amber-600"
                            >
                              Offline
                            </Badge>
                          )}
                        </div>
                        <span className="text-muted-foreground tabular-nums">
                          {format(new Date(e.ts), "MMM d HH:mm:ss")} · {e.durationMs}ms
                        </span>
                      </div>

                      <div className="font-mono text-[10px] text-muted-foreground/80">
                        device_id={e.deviceId}
                      </div>

                      {e.response.error && (
                        <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2 text-[11px] space-y-1">
                          <div className="font-medium text-rose-600">
                            {e.response.error.name || "Error"}: {e.response.error.message}
                          </div>
                          {e.response.error.context != null && (
                            <pre className="whitespace-pre-wrap break-all text-muted-foreground text-[10px] max-h-32 overflow-auto">
                              {typeof e.response.error.context === "string"
                                ? e.response.error.context
                                : JSON.stringify(e.response.error.context, null, 2)}
                            </pre>
                          )}
                        </div>
                      )}

                      {e.response.data != null && (
                        <pre className="rounded-md bg-muted/40 p-2 text-[10px] whitespace-pre-wrap break-all max-h-32 overflow-auto">
                          {JSON.stringify(e.response.data, null, 2)}
                        </pre>
                      )}

                      <div className="flex gap-1 pt-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[10px]"
                          onClick={() => copyJson(e, `Entry ${i + 1}`)}
                        >
                          <Copy className="h-3 w-3 mr-1" />
                          Copy entry
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}