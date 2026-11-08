import { ReactNode, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { DUR, EASE } from "@/lib/motion/tokens";

/**
 * Cursor gravity for primary calls to action.
 *
 * The element leans a few pixels toward the pointer while it is inside a
 * generous hit field, then springs home. Fine pointers only — touch and
 * reduced-motion users get a plain element, and the hit target never moves
 * for keyboard users because focus styling is unaffected.
 */
export const Magnetic = ({
  children,
  strength = 0.28,
  max = 10,
  className,
}: {
  children: ReactNode;
  strength?: number;
  max?: number;
  className?: string;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const fine =
    typeof window !== "undefined" && window.matchMedia?.("(pointer: fine)").matches;

  if (reduce || !fine) {
    return <div className={className}>{children}</div>;
  }

  const clamp = (v: number) => Math.max(-max, Math.min(max, v));

  return (
    <motion.div
      ref={ref}
      className={`inline-block ${className ?? ""}`}
      onMouseMove={(e) => {
        const rect = ref.current?.getBoundingClientRect();
        if (!rect) return;
        setPos({
          x: clamp((e.clientX - (rect.left + rect.width / 2)) * strength),
          y: clamp((e.clientY - (rect.top + rect.height / 2)) * strength),
        });
      }}
      onMouseLeave={() => setPos({ x: 0, y: 0 })}
      animate={pos}
      transition={{ type: "spring", stiffness: 260, damping: 22, mass: 0.5 }}
      style={{ willChange: "transform" }}
    >
      <motion.div
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        transition={{ duration: DUR.quick, ease: EASE.ui }}
      >
        {children}
      </motion.div>
    </motion.div>
  );
};
