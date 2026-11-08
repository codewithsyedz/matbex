import { ElementType } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { DUR, EASE, STAGGER, VIEWPORT } from "@/lib/motion/tokens";

/**
 * Masked line reveal. Each line rises out of its own clip box, so the text
 * appears to be lifted into the light rather than faded in.
 *
 * Lines are authored, not measured — pass an array of strings so the effect
 * stays deterministic and never reflows during animation.
 */
export const TextReveal = ({
  lines,
  as = "h2",
  className,
  lineClassName,
  delay = 0,
  stagger = STAGGER.base,
  immediate = false,
}: {
  lines: string[];
  as?: ElementType;
  className?: string;
  lineClassName?: string;
  delay?: number;
  stagger?: number;
  immediate?: boolean;
}) => {
  const reduce = useReducedMotion();
  const Tag = as as ElementType;

  if (reduce) {
    return (
      <Tag className={className}>
        {lines.map((line, i) => (
          <span key={i} className={`block ${lineClassName ?? ""}`}>
            {line}
          </span>
        ))}
      </Tag>
    );
  }

  return (
    <Tag className={className}>
      {lines.map((line, i) => (
        <span key={i} className="block overflow-hidden pb-[0.08em]">
          <motion.span
            className={`block ${lineClassName ?? ""}`}
            initial={{ y: "108%" }}
            {...(immediate
              ? { animate: { y: "0%" } }
              : { whileInView: { y: "0%" }, viewport: VIEWPORT })}
            transition={{
              duration: DUR.scene,
              delay: delay + i * stagger,
              ease: EASE.entrance,
            }}
            style={{ willChange: "transform" }}
          >
            {line}
          </motion.span>
        </span>
      ))}
    </Tag>
  );
};
