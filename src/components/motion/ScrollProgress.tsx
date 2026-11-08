import { motion, useReducedMotion, useScroll, useSpring } from "framer-motion";

/**
 * Hairline reading indicator pinned to the top of the viewport.
 * It is the only always-on motion on the page — 2px, brand emerald,
 * spring-damped so it trails the scroll like a physical needle.
 */
export const ScrollProgress = () => {
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 160, damping: 30, mass: 0.3 });

  if (reduce) return null;

  return (
    <motion.div
      aria-hidden
      className="fixed top-0 left-0 right-0 z-[60] h-[2px] origin-left bg-[#00A859]"
      style={{ scaleX, willChange: "transform" }}
    />
  );
};
