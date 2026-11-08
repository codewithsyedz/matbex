import { ReactNode, useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";

/**
 * Scene transition wrapper for full-page sections.
 *
 * Each section fades and lifts as it enters, then dims very slightly as it
 * leaves — the "hand-off" that makes a long page read as a sequence of shots
 * instead of one scrolling document. Effects are subtle by design: text never
 * drops below readable contrast while it is in the reading zone.
 */
export const Scene = ({
  children,
  className,
  /** Set false for dense/interactive sections such as pricing tables. */
  handoff = true,
}: {
  children: ReactNode;
  className?: string;
  handoff?: boolean;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });

  const opacity = useTransform(scrollYProgress, [0, 0.14, 0.88, 1], [0.72, 1, 1, 0.82]);
  const y = useTransform(scrollYProgress, [0, 0.16], [22, 0]);

  if (reduce || !handoff) {
    return (
      <div ref={ref} className={className}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      ref={ref}
      className={className}
      style={{ opacity, y, willChange: "transform, opacity" }}
    >
      {children}
    </motion.div>
  );
};
