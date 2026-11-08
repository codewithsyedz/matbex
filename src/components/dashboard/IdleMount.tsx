import { ReactNode, useEffect, useState } from "react";

interface IdleMountProps {
  children: ReactNode;
  fallback?: ReactNode;
  /** Skip the idle delay (desktop default). */
  eager?: boolean;
  /** Max wait before forcing mount (ms). */
  timeout?: number;
}

/**
 * Defers mounting children until the browser is idle. Keeps the menu/header
 * responsive on Android APK & mobile by letting React paint the shell first
 * and only then kicking off heavy data hooks / lazy chunks.
 */
export function IdleMount({ children, fallback = null, eager = false, timeout = 1500 }: IdleMountProps) {
  const [ready, setReady] = useState(eager);

  useEffect(() => {
    if (eager || ready) return;
    let cancelled = false;
    const win = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof win.requestIdleCallback === "function") {
      const id = win.requestIdleCallback(() => {
        if (!cancelled) setReady(true);
      }, { timeout });
      return () => {
        cancelled = true;
        win.cancelIdleCallback?.(id);
      };
    }
    const t = window.setTimeout(() => {
      if (!cancelled) setReady(true);
    }, 50);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [eager, ready, timeout]);

  return <>{ready ? children : fallback}</>;
}
