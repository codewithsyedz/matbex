import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Monitor, Plus, Copy, ExternalLink, Trash2, Check } from "lucide-react";
import { useCFDSessions } from "@/hooks/useCFD";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

/**
 * Customer-Facing Display (CFD) settings card.
 *
 * Two ways to use the CFD:
 *  1. Same-device mode — open a second monitor / external display on
 *     this cashier and load /cfd?local=1. Cart broadcasts via a
 *     BroadcastChannel. No pairing needed.
 *  2. Paired tablet — create a session below, then open /cfd on the
 *     customer-side tablet and enter the 6-char pair code. The tablet
 *     subscribes to live cart / payment / thank-you state in realtime.
 */
export function CFDDisplaySettings() {
  const { restaurant } = useAuth();
  const { sessions, create, remove, activeSessionId, setActive } = useCFDSessions();
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);

  const localUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/cfd?local=1`;
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const s = await create(label.trim());
      setLabel("");
      setActive(s.id);
      toast.success(`Pair code: ${s.pair_code}`);
    } catch (err) {
      toast.error("Could not create display session");
    } finally {
      setCreating(false);
    }
  };

  const copyCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    toast.success("Pair code copied");
  };

  const openLocal = () => {
    window.open(localUrl, "matbex-cfd", "noopener,noreferrer");
  };

  const pairUrl = (code: string) =>
    `${window.location.origin}/cfd?restaurant=${restaurant?.id ?? ""}&code=${code}`;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <Monitor className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <CardTitle className="text-base font-medium">Customer-Facing Display</CardTitle>
            <CardDescription>
              Show customers their order, total, and payment status on a second screen or paired tablet.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Same-device mode */}
        <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="font-medium">Second monitor on this device</div>
              <p className="text-sm text-muted-foreground">
                Best when the cashier PC has an HDMI display facing the customer. No pairing required.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={openLocal}>
              <ExternalLink className="h-4 w-4 mr-1.5" /> Open display
            </Button>
          </div>
        </div>

        {/* Paired tablets */}
        <div className="space-y-3">
          <div>
            <div className="font-medium">Paired customer tablets</div>
            <p className="text-sm text-muted-foreground">
              Create a session, then open <code className="px-1 py-0.5 rounded bg-muted">/cfd</code> on the customer tablet and enter the code.
            </p>
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor="cfd-label" className="text-xs">Display name (optional)</Label>
              <Input
                id="cfd-label"
                placeholder="Counter 1 display"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <Button onClick={handleCreate} disabled={creating}>
              <Plus className="h-4 w-4 mr-1.5" /> New
            </Button>
          </div>

          {sessions.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center border border-dashed rounded-lg">
              No paired displays yet.
            </div>
          ) : (
            <ul className="divide-y rounded-lg border">
              {sessions.map((s) => {
                const isActive = activeSessionId === s.id;
                return (
                  <li key={s.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{s.label || "Untitled display"}</span>
                        {isActive && (
                          <Badge variant="default" className="gap-1">
                            <Check className="h-3 w-3" /> Receiving cart
                          </Badge>
                        )}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground tracking-widest mt-0.5">
                        Code: <span className="text-foreground text-base tracking-[0.3em]">{s.pair_code}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={() => copyCode(s.pair_code)} title="Copy code">
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => window.open(pairUrl(s.pair_code), "_blank")} title="Open this display">
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                      <Button
                        variant={isActive ? "default" : "outline"}
                        size="sm"
                        onClick={() => setActive(isActive ? null : s.id)}
                      >
                        {isActive ? "Stop sending" : "Send cart to this"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={async () => {
                          if (!confirm("Unpair this display?")) return;
                          await remove(s.id);
                          if (isActive) setActive(null);
                        }}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}