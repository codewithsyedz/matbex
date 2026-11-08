import { AlertTriangle, ArrowRight, Lightbulb } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { RuleViolation } from "@/lib/accountPostingRules";

interface PostingRuleAlertProps {
  violation: RuleViolation;
  /** Called when the user navigates away to fix the problem. */
  onNavigate?: () => void;
  className?: string;
}

/**
 * Explains a posting-rule failure in plain language: what was rejected,
 * why the accounting rule exists, and the concrete ways to fix it.
 */
export function PostingRuleAlert({ violation, onNavigate, className }: PostingRuleAlertProps) {
  const navigate = useNavigate();

  return (
    <Alert variant="destructive" className={className}>
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>{violation.title}</AlertTitle>
      <AlertDescription className="space-y-3 text-sm">
        <p>{violation.why}</p>

        {violation.offending.length > 0 && (
          <div className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-2">
            <p className="text-xs font-medium uppercase tracking-wide opacity-80">
              What was rejected
            </p>
            {violation.offending.map((o) => (
              <div key={o.label} className="text-xs">
                <span className="font-medium">{o.label}</span>
                <span className="block opacity-90">{o.note}</span>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide opacity-80">
            <Lightbulb className="h-3.5 w-3.5" />
            How to fix it
          </p>
          <ol className="space-y-2">
            {violation.fixes.map((fix, i) => (
              <li key={fix.label} className="flex gap-2 text-xs">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-current text-[10px]">
                  {i + 1}
                </span>
                <span className="space-y-1">
                  <span className="block font-medium">{fix.label}</span>
                  <span className="block opacity-90">{fix.detail}</span>
                  {fix.route && (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs text-current underline"
                      onClick={() => {
                        onNavigate?.();
                        navigate(fix.route!);
                      }}
                    >
                      Open {fix.route}
                      <ArrowRight className="ml-1 h-3 w-3" />
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </AlertDescription>
    </Alert>
  );
}
