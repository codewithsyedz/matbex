import { useState } from "react";
import { useBranchResolution } from "@/hooks/useBranchResolution";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Check, CheckCircle2, Copy, HelpCircle, MinusCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";

/**
 * Troubleshooting panel explaining how the server picked the pricing branch
 * for the last /menu fetch: staff.assigned_branch_id → terminal pin → primary.
 */
export function BranchResolutionPanel() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [chainCopied, setChainCopied] = useState(false);
  const q = useBranchResolution();
  const d = q.data;

  const label = (id: string | null) =>
    id ? `${d?.names.get(id) ?? "Unknown branch"} · ${id.slice(0, 8)}…` : "not set";

  const copyFullChain = async () => {
    if (!d) return;
    const lines = [
      `Terminal: ${d.terminalId}${d.terminalName ? ` (${d.terminalName})` : ""}`,
      `Paired: ${d.paired ? "yes" : "no"}`,
      "",
      "Branch resolution chain:",
      `1. User login branch (staff.assigned_branch_id): ${label(d.staffBranch)}`,
      `2. Terminal pinned branch: ${label(d.terminalBranch)}`,
      `3. Primary branch fallback: ${label(d.primaryBranch)}`,
      "",
      `Resolved: ${d.resolved ? label(d.resolved) : "no branch (base prices)"}`,
      `Source: ${d.source}`,
    ];
    if (d.lastFetch) {
      lines.push(
        "",
        "Last menu fetch:",
        `Time: ${new Date(d.lastFetch.at).toISOString()}`,
        `HTTP status: ${d.lastFetch.status}`,
        `Request ID: ${d.lastFetch.requestId ?? "—"}`,
        `Cashier ID: ${d.lastFetch.cashierId ?? "—"}`,
        `Served branch: ${d.lastFetch.branchName ?? label(d.lastFetch.branchId)}`,
        `Served branch ID: ${d.lastFetch.branchId ?? "—"}`,
        `Served source: ${d.lastFetch.branchSource ?? "—"}`,
        `Served VAT rate: ${d.lastFetch.vatRate ?? "—"}%`,
        d.lastFetch.branchId && d.resolved && d.lastFetch.branchId !== d.resolved
          ? "⚠️ Served branch differs from current resolution"
          : "",
      );
    }
    try {
      await navigator.clipboard.writeText(lines.filter(Boolean).join("\n"));
      setChainCopied(true);
      setTimeout(() => setChainCopied(false), 1500);
      toast.success("Copied full resolution chain");
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  const Step = ({
    n,
    title,
    value,
    active,
  }: {
    n: number;
    title: string;
    value: string;
    active: boolean;
  }) => (
    <div className="flex items-start gap-3 rounded-lg border p-3">
      {active ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary shrink-0" />
      ) : (
        <MinusCircle className="mt-0.5 h-4 w-4 text-muted-foreground shrink-0" />
      )}
      <div className="min-w-0 space-y-0.5">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="text-muted-foreground tabular-nums">{n}.</span>
          {title}
          {active && <Badge variant="secondary">used</Badge>}
        </div>
        <p className="font-mono text-xs text-muted-foreground break-all">{value}</p>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs">
          <HelpCircle className="h-3.5 w-3.5" /> Why this branch?
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Branch resolution</DialogTitle>
          <DialogDescription>
            How the server picks the branch used for menu prices, VAT and sales tagging.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh] pr-3">
          {q.isLoading && <p className="text-sm text-muted-foreground">Checking…</p>}
          {q.isError && (
            <p className="text-sm text-destructive">Could not read resolution details.</p>
          )}
          {d && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                <div className="font-medium">
                  Resolved: {d.resolved ? label(d.resolved) : "no branch (base prices)"}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Source: <span className="font-mono">{d.source}</span> · Terminal{" "}
                  <span className="font-mono">{d.terminalId.slice(0, 8)}…</span>
                  {d.terminalName ? ` (${d.terminalName})` : d.paired ? "" : " (not paired)"}
                </p>
              </div>

              <div className="space-y-2">
                <Step
                  n={1}
                  title="Your login branch (staff.assigned_branch_id)"
                  value={label(d.staffBranch)}
                  active={d.source === "user"}
                />
                <Step
                  n={2}
                  title="Terminal pinned branch"
                  value={label(d.terminalBranch)}
                  active={d.source === "terminal"}
                />
                <Step
                  n={3}
                  title="Restaurant primary branch (fallback)"
                  value={label(d.primaryBranch)}
                  active={d.source === "primary"}
                />
              </div>

              <div className="space-y-1.5">
                <h4 className="text-sm font-medium">Last menu fetch</h4>
                {d.lastFetch ? (
                  <div className="rounded-lg border p-3 text-xs space-y-1">
                    <div className="text-muted-foreground">
                      {new Date(d.lastFetch.at).toLocaleString()} · HTTP {d.lastFetch.status}
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-muted-foreground">Request ID:</span>
                      <span className="font-mono break-all">
                        {d.lastFetch.requestId ?? "—"}
                      </span>
                      {d.lastFetch.requestId && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                          onClick={async () => {
                            await navigator.clipboard.writeText(
                              `Request ID: ${d.lastFetch!.requestId}\nTime: ${new Date(d.lastFetch!.at).toISOString()}\nTerminal: ${d.terminalId}`,
                            );
                            setCopied(true);
                            setTimeout(() => setCopied(false), 1500);
                            toast.success("Copied support reference");
                          }}
                        >
                          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                          copy for support
                        </button>
                      )}
                    </div>
                    <div>
                      Served branch:{" "}
                      <span className="font-medium">
                        {d.lastFetch.branchName ?? label(d.lastFetch.branchId)}
                      </span>
                    </div>
                    <div className="text-muted-foreground">
                      Source: <span className="font-mono">{d.lastFetch.branchSource ?? "—"}</span>
                      {d.lastFetch.vatRate != null && <> · VAT {d.lastFetch.vatRate}%</>}
                    </div>
                    {d.lastFetch.branchId && d.resolved && d.lastFetch.branchId !== d.resolved && (
                      <p className="text-destructive">
                        Served branch differs from the current resolution — reload the menu on the
                        terminal to pick up the change.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No menu fetch recorded for this device yet (this browser may not be a paired
                    terminal).
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => q.refetch()} className="gap-2">
                  <RefreshCw className="h-3.5 w-3.5" /> Re-check
                </Button>
                <Button variant="outline" size="sm" onClick={copyFullChain} className="gap-2">
                  {chainCopied ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  Copy full chain
                </Button>
              </div>
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
