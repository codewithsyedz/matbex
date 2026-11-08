import { AlertTriangle, ExternalLink, Wrench } from "lucide-react";
import { Link } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ParsedLedgerValidationError } from "@/lib/ledgerValidationError";

interface LedgerValidationAlertProps {
  error: ParsedLedgerValidationError;
  onDismiss?: () => void;
}

/**
 * Surfaces the exact ledger validation rule that rejected a settlement so the
 * user can see which account/rule failed without digging through logs.
 */
export function LedgerValidationAlert({
  error,
  onDismiss,
}: LedgerValidationAlertProps) {
  return (
    <Alert variant="destructive" className="text-left">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle className="flex flex-wrap items-center gap-2">
        {error.title}
        <Badge variant="outline" className="font-mono text-[10px]">
          {error.code}
        </Badge>
      </AlertTitle>
      <AlertDescription className="space-y-3">
        {error.ruleName && (
          <div className="text-[11px]">
            <span className="font-medium uppercase tracking-wide opacity-80">
              Rule violated:{" "}
            </span>
            <span>{error.ruleName}</span>
          </div>
        )}

        {(error.accountCode || error.legSide) && (
          <div className="space-y-1.5 rounded-md border border-current/20 bg-background/40 p-2">
            <p className="text-[10px] font-medium uppercase tracking-wide opacity-80">
              Rejected ledger leg
            </p>
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              {error.legSide && (
                <Badge variant="destructive" className="uppercase">
                  {error.legSide === "debit" ? "DR" : "CR"}
                </Badge>
              )}
              {error.accountCode && (
                <Badge variant="secondary" className="font-mono">
                  {error.accountCode}
                  {error.accountName ? ` · ${error.accountName}` : ""}
                </Badge>
              )}
              {error.accountType && (
                <Badge variant="outline">type: {error.accountType}</Badge>
              )}
              {error.entryType && (
                <Badge variant="outline">entry: {error.entryType}</Badge>
              )}
            </div>
            {!!error.allowedRanges?.length && (
              <p className="text-[11px] opacity-90">
                Allowed account ranges for this leg:{" "}
                <span className="font-mono">{error.allowedRanges.join(", ")}</span>
              </p>
            )}
          </div>
        )}

        <p className="text-xs leading-relaxed">{error.detail}</p>

        <div className="flex items-start gap-2 rounded-md border border-current/20 bg-background/40 p-2 text-xs">
          <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error.fix}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="outline" className="h-7 text-xs">
            <Link to="/accounting">
              Open Chart of Accounts
              <ExternalLink className="ml-1 h-3 w-3" />
            </Link>
          </Button>
          <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
            <Link to="/reports/ledger-mapping">Ledger mapping</Link>
          </Button>
          {onDismiss && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={onDismiss}
            >
              Dismiss
            </Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}
