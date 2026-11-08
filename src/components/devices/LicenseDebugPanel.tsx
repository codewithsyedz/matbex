import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Bug, Copy, RefreshCw, Trash2 } from "lucide-react";
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
import { useLicense } from "@/contexts/LicenseContext";
import { getTerminalId } from "@/lib/offline/terminal";
import { getDeviceFingerprint } from "@/lib/offline/deviceFingerprint";
import {
  type LicenseDebugEntry,
  clearLicenseDebugLog,
  readLicenseDebugLog,
} from "@/lib/offline/licenseDebugLog";

const EVENT_LABEL: Record<LicenseDebugEntry["event"], { label: string; tone: string }> = {
  matched_terminal: { label: "Matched terminal id", tone: "bg-emerald-500/10 text-emerald-600" },
  rebound_by_fingerprint: {
    label: "Rebound by fingerprint",
    tone: "bg-amber-500/10 text-amber-600",
  },
  claimed: { label: "New seat claimed", tone: "bg-rose-500/10 text-rose-600" },
  recovered_from_unique: {
    label: "Recovered from race",
    tone: "bg-amber-500/10 text-amber-600",
  },
  no_seat: { label: "No seat", tone: "bg-rose-500/10 text-rose-600" },
  error: { label: "Error", tone: "bg-rose-500/10 text-rose-600" },
  offline_stale: { label: "Offline (skipped)", tone: "bg-muted text-muted-foreground" },
};

export function LicenseDebugPanel() {
  const license = useLicense();
  const [open, setOpen] = useState(false);
  const [terminalId, setTerminalId] = useState<string>("");
  const [fingerprint, setFingerprint] = useState<string>("");
  const [entries, setEntries] = useState<LicenseDebugEntry[]>([]);

  const refreshLog = () => setEntries(readLicenseDebugLog());

  useEffect(() => {
    getTerminalId().then(setTerminalId).catch(() => {});
    getDeviceFingerprint().then(setFingerprint).catch(() => {});
    refreshLog();
    const onStorage = () => refreshLog();
    window.addEventListener("storage", onStorage);
    const t = window.setInterval(refreshLog, 4000);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.clearInterval(t);
    };
  }, []);

  const latest = entries[0];

  const copy = async (val: string, label: string) => {
    try {
      await navigator.clipboard.writeText(val);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Copy failed");
    }
  };

  return (
    <Card className="border-dashed">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors pb-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Bug className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base font-medium">Licensing debug</CardTitle>
                {latest && (
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${EVENT_LABEL[latest.event].tone}`}
                  >
                    {EVENT_LABEL[latest.event].label}
                  </Badge>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {open ? "Hide" : "Show"}
              </span>
            </div>
            <CardDescription className="text-xs">
              Why this device was marked active, with the last {entries.length || 0} validate-license
              calls.
            </CardDescription>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <DebugRow label="Terminal id" value={terminalId} onCopy={() => copy(terminalId, "Terminal id")} />
              <DebugRow
                label="Device fingerprint"
                value={fingerprint}
                onCopy={() => copy(fingerprint, "Fingerprint")}
              />
              <DebugRow
                label="Current mode"
                value={license.mode}
                tone={license.mode === "active" ? "text-emerald-600" : "text-amber-600"}
              />
              <DebugRow
                label="Last seat id"
                value={latest?.seatId ?? "-"}
                onCopy={latest?.seatId ? () => copy(latest.seatId!, "Seat id") : undefined}
              />
              <DebugRow
                label="Last check"
                value={
                  latest ? format(new Date(latest.ts), "MMM d, HH:mm:ss") : "Never"
                }
              />
              <DebugRow
                label="Trigger"
                value={latest?.trigger ?? "-"}
              />
            </div>

            {latest?.detail && (
              <div className="rounded-md border border-border/50 bg-muted/30 p-3 text-xs">
                <div className="font-medium text-foreground mb-1">Why it activated</div>
                <div className="text-muted-foreground">{latest.detail}</div>
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium">Recent events</div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    license.refresh();
                    setTimeout(refreshLog, 600);
                  }}
                >
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />
                  Run check
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    clearLicenseDebugLog();
                    refreshLog();
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Clear log
                </Button>
              </div>
            </div>

            {entries.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3 text-center">
                No events recorded yet.
              </p>
            ) : (
              <ScrollArea className="h-[280px] rounded-md border border-border/50">
                <ul className="divide-y divide-border/50">
                  {entries.map((e, i) => (
                    <li key={i} className="p-3 text-xs space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${EVENT_LABEL[e.event].tone}`}
                        >
                          {EVENT_LABEL[e.event].label}
                        </Badge>
                        <span className="text-muted-foreground tabular-nums">
                          {format(new Date(e.ts), "MMM d HH:mm:ss")} · {e.trigger}
                        </span>
                      </div>
                      {e.detail && (
                        <div className="text-muted-foreground">{e.detail}</div>
                      )}
                      <div className="font-mono text-[10px] text-muted-foreground/80 truncate">
                        mode={e.mode} · seat={e.seatId?.slice(0, 8) ?? "-"} · fp={e.fingerprintShort}
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

function DebugRow({
  label,
  value,
  onCopy,
  tone,
}: {
  label: string;
  value: string;
  onCopy?: () => void;
  tone?: string;
}) {
  return (
    <div className="rounded-md border border-border/40 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {onCopy && (
          <button
            type="button"
            onClick={onCopy}
            className="text-muted-foreground hover:text-foreground"
            aria-label={`Copy ${label}`}
          >
            <Copy className="h-3 w-3" />
          </button>
        )}
      </div>
      <div className={`mt-1 font-mono text-xs truncate ${tone ?? "text-foreground"}`}>
        {value || "-"}
      </div>
    </div>
  );
}