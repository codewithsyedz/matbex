import { useInView, useReducedMotion } from "framer-motion";
import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";

type MarginValue = `${number}${"px" | "%"}`;
type MarginType =
  | MarginValue
  | `${MarginValue} ${MarginValue}`
  | `${MarginValue} ${MarginValue} ${MarginValue}`
  | `${MarginValue} ${MarginValue} ${MarginValue} ${MarginValue}`;

type InViewOptions = {
  root?: RefObject<Element | null>;
  margin?: MarginType;
  amount?: "some" | "all" | number;
  once?: boolean;
};

/**
 * Reliable reveal flag for scroll-triggered animations.
 *
 * If IntersectionObserver / in-view detection fails for any reason,
 * we fall back to revealing content after a short delay so sections
 * never get stuck invisible.
 */
export function useRevealInView<T extends Element>(
  options: InViewOptions & { fallbackMs?: number } = {}
) {
  const { fallbackMs = 1200, ...inViewOptions } = options;
  const ref = useRef<T | null>(null);
  const prefersReducedMotion = useReducedMotion();

  const inView = useInView(ref, {
    once: true,
    ...inViewOptions,
  });

  const [fallbackVisible, setFallbackVisible] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion || inView) return;

    const t = window.setTimeout(() => setFallbackVisible(true), fallbackMs);
    return () => window.clearTimeout(t);
  }, [fallbackMs, inView, prefersReducedMotion]);

  return {
    ref,
    isRevealed: prefersReducedMotion || inView || fallbackVisible,
  };
}
