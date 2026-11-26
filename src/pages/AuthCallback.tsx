import { useEffect, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { db } from "@/integrations/db/client";
import { Loader2, AlertCircle, RotateCcw, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

/**
 * Public route. Handles incoming the API magic-link redirects.
 *
 * the API client auto-detects the access/refresh tokens in the URL hash
 * (detectSessionInUrl=true by default) and emits SIGNED_IN. We just wait
 * for a session, then navigate to the `next` query param (default: /cockpit).
 */
export default function AuthCallback() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  const next = search.get("next") || "/cockpit";

  const attemptSession = useCallback(() => {
    let done = false;
    let cleanupSub: (() => void) | null = null;

    const go = () => {
      if (done) return;
      done = true;
      navigate(next, { replace: true });
    };

    // Listen first so we don't miss the SIGNED_IN event.
    const { data: { subscription } } = db.auth.onAuthStateChange((_, session) => {
      if (session) go();
    });
    cleanupSub = () => subscription.unsubscribe();

    // If session already exists (e.g. revisit), redirect immediately.
    db.auth.getSession().then(({ data }) => {
      if (data.session) go();
    });

    // Safety timeout - if no session arrives, show error screen instead of redirecting.
    const timer = window.setTimeout(() => {
      if (!done) {
        done = true;
        setTimedOut(true);
        setIsRetrying(false);
      }
    }, 6000);

    return () => {
      cleanupSub?.();
      window.clearTimeout(timer);
    };
  }, [navigate, next]);

  useEffect(() => {
    // If there's an OAuth/recovery error in the hash, surface it.
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const hashErr = hash.get("error_description") || hash.get("error");
    if (hashErr) {
      setError(decodeURIComponent(hashErr));
      return;
    }

    const cleanup = attemptSession();
    return cleanup;
  }, [attemptSession]);

  const handleRetry = () => {
    setTimedOut(false);
    setIsRetrying(true);
    const cleanup = attemptSession();
    // Re-run cleanup on unmount if component unmounts during retry
    return cleanup;
  };

  const handleGoToSignIn = () => {
    navigate(`/auth?next=${encodeURIComponent(next)}`, { replace: true });
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-background text-foreground p-6">
      {error ? (
        <div className="w-full max-w-sm flex flex-col gap-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Sign-in link error</AlertTitle>
            <AlertDescription className="mt-1">{error}</AlertDescription>
          </Alert>
          <Button variant="outline" className="w-full" onClick={handleGoToSignIn}>
            <LogIn className="mr-2 h-4 w-4" />
            Go to sign in
          </Button>
        </div>
      ) : timedOut ? (
        <div className="w-full max-w-sm flex flex-col items-center gap-5">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
            <AlertCircle className="h-7 w-7 text-destructive" />
          </div>
          <div className="text-center space-y-1">
            <h2 className="text-lg font-semibold tracking-tight">
              Couldn't sign you in
            </h2>
            <p className="text-sm text-muted-foreground">
              The magic link may have expired, already been used, or your device
              doesn't allow automatic login. You can retry or sign in with your
              password.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2">
            <Button className="w-full" onClick={handleRetry} disabled={isRetrying}>
              {isRetrying ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Retrying…
                </>
              ) : (
                <>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Try again
                </>
              )}
            </Button>
            <Button variant="outline" className="w-full" onClick={handleGoToSignIn}>
              <LogIn className="mr-2 h-4 w-4" />
              Sign in with password
            </Button>
          </div>
        </div>
      ) : (
        <>
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Signing you in…</p>
        </>
      )}
    </div>
  );
}
