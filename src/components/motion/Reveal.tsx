import { ElementType, ReactNode } from "react";
import { motion, useReducedMotion, Variants } from "framer-motion";
import { DUR, EASE, STAGGER, TRAVEL, VIEWPORT } from "@/lib/motion/tokens";

type Direction = "up" | "down" | "left" | "right" | "none";

interface RevealProps {
  children: ReactNode;
  /** Which way the element arrives from. Default: up. */
  from?: Direction;
  /** Travel distance token. Default: md. */
  distance?: keyof typeof TRAVEL;
  delay?: number;
  duration?: number;
  className?: string;
  as?: ElementType;
  /** Reveal on mount instead of on scroll (above-the-fold content). */
  immediate?: boolean;
}

function offset(from: Direction, d: number) {
  switch (from) {
    case "up":
      return { y: d };
    case "down":
      return { y: -d };
    case "left":
      return { x: d };
    case "right":
      return { x: -d };
    default:
      return {};
  }
}

/**
 * The single scroll-entrance primitive. Opacity + one small translate,
 * once per element, never replayed. Reduced motion renders the final frame.
 */
export const Reveal = ({
  children,
  from = "up",
  distance = "md",
  delay = 0,
  duration = DUR.scene,
  className,
  as = "div",
  immediate = false,
}: RevealProps) => {
  const reduce = useReducedMotion();
  const MotionTag = motion[as as "div"] ?? motion.div;

  if (reduce) {
    const Tag = as as ElementType;
    return <Tag className={className}>{children}</Tag>;
  }

  const hidden = { opacity: 0, ...offset(from, TRAVEL[distance]) };
  const shown = { opacity: 1, x: 0, y: 0 };

  return (
    <MotionTag
      className={className}
      initial={hidden}
      {...(immediate
        ? { animate: shown }
        : { whileInView: shown, viewport: VIEWPORT })}
      transition={{ duration, delay, ease: EASE.entrance }}
      style={{ willChange: "transform, opacity" }}
    >
      {children}
    </MotionTag>
  );
};

/** Parent for staggered groups — pair with <RevealItem>. */
export const RevealGroup = ({
  children,
  className,
  stagger = STAGGER.base,
  delay = 0,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  stagger?: number;
  delay?: number;
  as?: ElementType;
}) => {
  const reduce = useReducedMotion();
  const MotionTag = motion[as as "div"] ?? motion.div;

  if (reduce) {
    const Tag = as as ElementType;
    return <Tag className={className}>{children}</Tag>;
  }

  const variants: Variants = {
    hidden: {},
    shown: { transition: { staggerChildren: stagger, delayChildren: delay } },
  };

  return (
    <MotionTag
      className={className}
      variants={variants}
      initial="hidden"
      whileInView="shown"
      viewport={VIEWPORT}
    >
      {children}
    </MotionTag>
  );
};

export const RevealItem = ({
  children,
  className,
  from = "up",
  distance = "sm",
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  from?: Direction;
  distance?: keyof typeof TRAVEL;
  as?: ElementType;
}) => {
  const reduce = useReducedMotion();
  const MotionTag = motion[as as "div"] ?? motion.div;

  if (reduce) {
    const Tag = as as ElementType;
    return <Tag className={className}>{children}</Tag>;
  }

  const variants: Variants = {
    hidden: { opacity: 0, ...offset(from, TRAVEL[distance]) },
    shown: {
      opacity: 1,
      x: 0,
      y: 0,
      transition: { duration: DUR.base, ease: EASE.entrance },
    },
  };

  return (
    <MotionTag className={className} variants={variants}>
      {children}
    </MotionTag>
  );
};
