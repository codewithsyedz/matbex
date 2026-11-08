import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Enables click/touch-drag horizontal scrolling on a scrollable container.
 * Touch devices keep native momentum scrolling; pointer drag is used for
 * mouse/pen so wide tables can be panned without a visible scrollbar.
 */
export function useDragScroll<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const state = useRef({ startX: 0, startScroll: 0, active: false });

  const onPointerDown = useCallback((e: React.PointerEvent<T>) => {
    const el = ref.current;
    if (!el) return;
    // Native touch scrolling is better than emulated drag.
    if (e.pointerType === "touch") return;
    // Ignore drags starting on interactive elements.
    if ((e.target as HTMLElement).closest("button, a, input, select, textarea, [role='button']")) return;
    if (el.scrollWidth <= el.clientWidth) return;

    state.current = { startX: e.clientX, startScroll: el.scrollLeft, active: true };
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    const handleMove = (e: PointerEvent) => {
      const el = ref.current;
      if (!el || !state.current.active) return;
      el.scrollLeft = state.current.startScroll - (e.clientX - state.current.startX);
    };
    const stop = () => {
      state.current.active = false;
      setIsDragging(false);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [isDragging]);

  return { ref, isDragging, dragHandlers: { onPointerDown } };
}
