import { ReactNode, useEffect, useRef, useState } from "react";

interface DeferUntilVisibleProps {
  children: ReactNode;
  /** Placeholder shown until the section scrolls near viewport. */
  placeholder?: ReactNode;
  /** Pre-load margin (CSS length). Default 400px so it warms just before reach. */
  rootMargin?: string;
  /** Optional min-height to prevent layout shift while deferred. */
  minHeight?: number | string;
  /** Force-mount immediately (skip deferring). */
  eager?: boolean;
}

/**
 * Defers mounting children until the slot is near the viewport.
 * Massive win on mobile/tablet where most dashboard sections are below
 * the fold - their data fetches and JS chunks only run when needed.
 */
export function DeferUntilVisible({
  children,
  placeholder,
  rootMargin = "400px",
  minHeight,
  eager = false,
}: DeferUntilVisibleProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(eager);

  useEffect(() => {
    if (eager || visible) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [eager, visible, rootMargin]);

  return (
    <div ref={ref} style={minHeight ? { minHeight } : undefined}>
      {visible ? children : placeholder ?? null}
    </div>
  );
}