import { Component, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { reportClientError } from "@/lib/errorReporter";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

const RELOAD_FLAG = "lovable:chunk-reload-at";
const RELOAD_COOLDOWN_MS = 30_000; // never auto-reload more than once per 30s

function recentlyAutoReloaded(): boolean {
  try {
    const raw = sessionStorage.getItem(RELOAD_FLAG);
    if (!raw) return false;
    return Date.now() - Number(raw) < RELOAD_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function markAutoReloaded() {
  try {
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch {
    /* ignore */
  }
}

/**
 * Error boundary specifically for handling dynamic import failures.
 * These can occur when Vite's HMR cache becomes stale.
 */
export class LazyLoadErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    const isChunkError =
      error.message.includes("Failed to fetch dynamically imported module") ||
      error.message.includes("Loading chunk") ||
      error.message.includes("Loading CSS chunk");

    // Always report - sampling/throttling happens in the reporter. Boundary
    // catches are high-signal so we force-sample at 100%.
    void reportClientError(error, {
      severity: isChunkError ? "warning" : "fatal",
      sampleRate: 1,
      context: { source: "LazyLoadErrorBoundary", isChunkError },
    });

    if (!isChunkError) return;

    // Hard guard against the reload loop that re-triggers seat activation
    // every time the dashboard remounts. We only auto-reload once per
    // session window - after that the user must click "Retry Now" manually.
    if (recentlyAutoReloaded()) {
      console.warn(
        "Dynamic import failed but we already auto-reloaded recently; staying put to avoid a loop.",
        error,
      );
      return;
    }
    console.warn("Dynamic import failed, reloading page...", error);
    markAutoReloaded();
    setTimeout(() => {
      window.location.reload();
    }, 100);
  }

  handleRetry = () => {
    // User-initiated retries always clear the cooldown so a fresh failure
    // can still auto-recover later in the session.
    try {
      sessionStorage.removeItem(RELOAD_FLAG);
    } catch {
      /* ignore */
    }
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="text-center space-y-4 p-6">
            <p className="text-muted-foreground">
              Loading failed. Refreshing...
            </p>
            <Button onClick={this.handleRetry} variant="outline" size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry Now
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
