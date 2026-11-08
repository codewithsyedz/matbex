import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import type { ReversalStatus } from "@/lib/reversalGuard";

/**
 * Shows the current reversal status of an original posting. Rendered inside
 * reversal dialogs so a blocked save explains itself before the user clicks.
 */
export function ReversalStatusNotice({ status }: { status: ReversalStatus | null }) {
  if (!status || status.allowed) return null;

  const Icon = status.statusTone === "reversed" ? CheckCircle2 : status.statusTone === "unposted" ? Info : AlertTriangle;

  return (
    <Alert variant={status.statusTone === "reversed" ? "default" : "destructive"}>
      <Icon className="h-4 w-4" />
      <AlertTitle className="flex items-center gap-2">
        {status.title}
        <Badge variant="secondary" className="font-normal">
          {status.statusLabel}
        </Badge>
      </AlertTitle>
      <AlertDescription className="space-y-2">
        <p>{status.description}</p>
        {status.hints && status.hints.length > 0 && (
          <ul className="list-disc pl-4 space-y-0.5 text-xs">
            {status.hints.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        )}
      </AlertDescription>
    </Alert>
  );
}
