import { ReactNode, useRef } from "react";
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from "framer-motion";

/**
 * Depth layer. Moves at a fraction of scroll speed while it is on screen.
 *
 * `speed` is the offset in px across the element's full scroll pass:
 * negative rises (foreground), positive lags (background).
 * Transform only — never top/margin — so it stays off the layout path.
 */
export const Parallax = ({
  children,
  speed = -40,
  className,
  damping = true,
}: {
  children: ReactNode;
  speed?: number;
  className?: string;
  damping?: boolean;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const raw = useTransform(scrollYProgress, [0, 1], [-speed / 2, speed / 2]);
  const smooth = useSpring(raw, { stiffness: 140, damping: 26, mass: 0.4 });

  return (
    <div ref={ref} className={className}>
      <motion.div
        style={reduce ? undefined : { y: damping ? smooth : raw, willChange: "transform" }}
      >
        {children}
      </motion.div>
    </div>
  );
};

/**
 * Scale-on-approach for imagery: the picture is slightly over-scaled and
 * eases back to 1 as the frame reaches the viewport centre. The container
 * clips, so the image reads as settling into its frame.
 */
export const ParallaxImage = ({
  src,
  alt,
  className,
  imgClassName,
  loading = "lazy",
}: {
  src: string;
  alt: string;
  className?: string;
  imgClassName?: string;
  loading?: "lazy" | "eager";
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "center center"] });
  const scale = useTransform(scrollYProgress, [0, 1], [1.12, 1]);
  const opacity = useTransform(scrollYProgress, [0, 0.45], [0.55, 1]);

  return (
    <div ref={ref} className={`overflow-hidden ${className ?? ""}`}>
      <motion.img
        src={src}
        alt={alt}
        loading={loading}
        decoding="async"
        className={imgClassName}
        style={reduce ? undefined : { scale, opacity, willChange: "transform, opacity" }}
      />
    </div>
  );
};
