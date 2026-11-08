import { ShieldCheck, ShieldAlert, RefreshCw, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAuthRedirectCheck, isRedirectConfigHealthy } from "@/hooks/useAuthRedirectCheck";

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Badge variant={ok ? "default" : "destructive"} className="font-mono text-[10px]">
      {ok ? "PASS" : "FAIL"} · {label}
    </Badge>
  );
}

/**
 * Validates the Supabase Auth redirectTo / domain allowlist that the
 * WhatsApp magic-link delivery relies on. Surfaces a clear warning if the
 * current browser origin or the function's APP_URL is not in the allowlist,
 * so we don't ship broken auto-login links.
 */
export function AuthRedirectAllowlistCheck() {
  const check = useAuthRedirectCheck();
  const data = check.data;
  const healthy = isRedirectConfigHealthy(data);
  const currentOrigin = typeof window !== "undefined" ? window.location.origin : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          {healthy ? (
            <ShieldCheck className="h-4 w-4 text-primary" />
          ) : (
            <ShieldAlert className="h-4 w-4 text-destructive" />
          )}
          Auth redirect allowlist check
        </CardTitle>
        <CardDescription>
          Validates that the redirect URL used by WhatsApp magic-links is
          registered in the Supabase Auth allowlist for both preview and
          production - run this before sending links.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => check.refetch()}
            disabled={check.isFetching}
          >
            {check.isFetching ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Re-run check
          </Button>
          {data && (
            <span className="text-xs text-muted-foreground">
              Last checked just now
            </span>
          )}
        </div>

        {check.isError && (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Check failed</AlertTitle>
            <AlertDescription>
              {(check.error as Error)?.message ?? "Unknown error"}
            </AlertDescription>
          </Alert>
        )}

        {data && !healthy && (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Allowlist mismatch detected</AlertTitle>
            <AlertDescription className="space-y-1">
              <p>
                Magic-links will be silently rewritten by Supabase to its
                default SITE_URL, breaking auto-login. Add the missing
                redirect URLs to the Supabase Auth allowlist before sending.
              </p>
              {data.effective_redirect && !data.matches_desired && (
                <p className="font-mono text-xs">
                  GoTrue rewrote {data.desired_redirect} → {data.effective_redirect}
                </p>
              )}
            </AlertDescription>
          </Alert>
        )}

        {data && healthy && (
          <Alert>
            <ShieldCheck className="h-4 w-4" />
            <AlertTitle>All checks passed</AlertTitle>
            <AlertDescription>
              Magic-links will resolve to <span className="font-mono">{data.whatsapp_app_url}</span> and
              auto-login should work on fresh devices.
            </AlertDescription>
          </Alert>
        )}

        {data && (
          <div className="grid gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge ok={data.desired_allowed} label="WhatsApp APP_URL in expected list" />
              <StatusBadge ok={data.matches_desired} label="Supabase honours redirect (not rewritten)" />
              <StatusBadge ok={data.effective_allowed} label="Effective redirect host allowed" />
              <StatusBadge
                ok={data.origin_allowed ?? true}
                label={`Current origin (${currentOrigin ?? "?"})`}
              />
            </div>

            <div className="rounded-md border bg-muted/30 p-3 space-y-1 font-mono text-[11px] leading-relaxed">
              <div>
                <span className="text-muted-foreground">Function APP_URL: </span>
                {data.whatsapp_app_url}
              </div>
              <div>
                <span className="text-muted-foreground">Desired redirect: </span>
                {data.desired_redirect}
              </div>
              <div>
                <span className="text-muted-foreground">Effective redirect: </span>
                {data.effective_redirect ?? "-"}
              </div>
              <div>
                <span className="text-muted-foreground">Browser origin: </span>
                {data.origin ?? currentOrigin ?? "-"}
              </div>
              {data.generate_error && (
                <div className="text-destructive">
                  generateLink error: {data.generate_error}
                </div>
              )}
            </div>

            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Expected allowlist:</p>
              <div className="flex flex-wrap gap-1">
                {data.expected_allowlist.map((u) => (
                  <code
                    key={u}
                    className="rounded bg-muted px-1.5 py-0.5 text-[10px]"
                  >
                    {u}
                  </code>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>

      <CardFooter className="text-xs text-muted-foreground flex items-center gap-1">
        <ExternalLink className="h-3 w-3" />
        Fix mismatches in Lovable Cloud → Auth → URL Configuration (Site URL + Redirect URLs).
      </CardFooter>
    </Card>
  );
}