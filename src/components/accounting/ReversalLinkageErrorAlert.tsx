import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { ReversalLinkageError } from "@/lib/reversalLinkageError";

interface Props {
  error: ReversalLinkageError | null;
  className?: string;
}

/** Explains why a reversal was rejected and how to fix the original-entry linkage. */
export function ReversalLinkageErrorAlert({ error, className }: Props) {
  if (!error) return null;

  return (
    <Alert variant="destructive" className={className}>
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>{error.title}</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>{error.description}</p>
        <div>
          <p className="font-medium">How to fix it</p>
          <ol className="ml-4 list-decimal space-y-0.5">
            {error.fixSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
        <details className="text-xs opacity-80">
          <summary className="cursor-pointer">Technical details</summary>
          <code className="mt-1 block whitespace-pre-wrap break-all">{error.raw}</code>
        </details>
      </AlertDescription>
    </Alert>
  );
}