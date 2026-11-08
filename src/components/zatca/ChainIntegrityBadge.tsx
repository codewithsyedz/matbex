import { useState } from "react";
import { useZatcaChainIntegrity } from "@/hooks/useZatcaCompliance";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldCheck, ShieldAlert, RefreshCw, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { ChainTamperDialog } from "./ChainTamperDialog";

/**
 * Live integrity check for the ZATCA audit hash chain. Calls the
 * `verify_zatca_audit_chain` RPC server-side, which re-walks every row
 * and recomputes SHA-256 hashes. A green badge means every row chains
 * back to the genesis hash; a red badge points at the first tampered row.
 */
export function ChainIntegrityBadge() {
  const { data, isLoading, isFetching, refetch } = useZatcaChainIntegrity();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const intact = data?.intact ?? true;
  const total = data?.totalRows ?? 0;

  return (
    <div className="flex items-center gap-2">
      {isLoading ? (
        <Badge variant="outline" className="gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" /> Verifying chain…
        </Badge>
      ) : intact ? (
        <Badge
          variant="outline"
          className="gap-1.5 border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400"
        >
          <ShieldCheck className="h-3 w-3" />
          Chain intact · {total} {total === 1 ? "event" : "events"}
        </Badge>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
          aria-label="View tampered audit row details"
        >
          <Badge variant="destructive" className="gap-1.5 cursor-pointer hover:opacity-90">
            <ShieldAlert className="h-3 w-3" />
            Tampering detected at #{data?.brokenSeq} · view details
          </Badge>
        </button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => {
          qc.invalidateQueries({ queryKey: ["zatca", "chain-integrity"] });
          qc.invalidateQueries({ queryKey: ["zatca", "chain-break-detail"] });
          refetch();
        }}
        disabled={isFetching}
        aria-label="Re-verify chain"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
      </Button>
      <ChainTamperDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}