import { motion } from "framer-motion";
import { memo, useState } from "react";
import { cn } from "@/lib/utils";

// Module-level flag: ensures the entry draw-in animation runs only once per session.
let hasLogoAnimatedThisSession = false;

interface MatbexLogoProps {
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
  showWordmark?: boolean;
  variant?: "default" | "dark" | "monochrome";
  animate?: boolean;
  className?: string;
}

/**
 * Matbex brand mark - a rounded green square containing a stylized white "M"
 * (two pillars meeting at a chevron), optionally followed by the "Matbex" wordmark.
 */
function MatbexLogoComponent({
  size = "md",
  showWordmark = true,
  variant = "default",
  animate = true,
  className,
}: MatbexLogoProps) {
  const [shouldAnimate] = useState(() => {
    if (!animate) return false;
    if (hasLogoAnimatedThisSession) return false;
    hasLogoAnimatedThisSession = true;
    return true;
  });

  const sizes = {
    // gap ≈ width of the wordmark "M" vertical stroke (~12.5% of icon size)
    sm: { icon: 28, wordmark: "text-base", gapPx: 4 },
    md: { icon: 36, wordmark: "text-xl", gapPx: 5 },
    lg: { icon: 48, wordmark: "text-2xl", gapPx: 6 },
    xl: { icon: 72, wordmark: "text-4xl", gapPx: 9 },
    "2xl": { icon: 96, wordmark: "text-5xl", gapPx: 12 },
  };

  const iconSize = sizes[size].icon;

  // Color variants - icon green darkened ~4% for stronger optical weight on bright POS screens
  const brandGreen = variant === "monochrome" ? "#1a1a1a" : "#166235";
  const markColor = "#FFFFFF";
  const wordmarkColor =
    variant === "dark" ? "#FFFFFF" : variant === "monochrome" ? "#0a0a0a" : "#0a0a0a";

  // Small-size rule: under 32px height, icon only - no wordmark, no outlines.
  const renderWordmark = showWordmark && iconSize >= 32;

  return (
    <div dir="ltr" className={cn("flex items-center", className)}>
      {/* Icon: rounded green square with white M mark */}
      <motion.svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        // Nudge icon up ~1.5% of its height to optically center against wordmark cap line
        style={{ transform: "translateY(-1.5%)" }}
        initial={shouldAnimate ? { scale: 0.85, opacity: 0 } : false}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
      >
        <rect x="0" y="0" width="64" height="64" rx="10" fill={brandGreen} />
        {/* Stylized "M": two tall pillars + chevron meeting in the middle */}
        <path
          d="M12 14 L20 14 L20 50 L12 50 Z
             M44 14 L52 14 L52 50 L44 50 Z
             M20 14 L32 30 L44 14 L44 24 L32 40 L20 24 Z"
          fill={markColor}
        />
      </motion.svg>

      {/* Wordmark */}
      {renderWordmark && (
        <motion.span
          className={cn(
            "leading-none",
            sizes[size].wordmark,
          )}
          style={{
            color: wordmarkColor,
            fontFamily: "Inter, system-ui, sans-serif",
            // Semibold bridge weight (Inter variable) - confident, SaaS-grade
            fontWeight: 580,
            // Tighten tracking ~ -1.5% - cohesion across round letters (a, b, e)
            letterSpacing: "-0.015em",
            marginLeft: sizes[size].gapPx,
            fontFeatureSettings: '"tnum", "ss01"',
          }}
          initial={shouldAnimate ? { opacity: 0, x: -4 } : false}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, delay: shouldAnimate ? 0.15 : 0 }}
        >
          Matbex
        </motion.span>
      )}
    </div>
  );
}

export const MatbexLogo = memo(MatbexLogoComponent);

// Animated loading version - pulses the brand mark
export function MatbexLogoLoader({ size = 64 }: { size?: number }) {
  return (
    <div className="flex flex-col items-center gap-4">
      <motion.svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        animate={{ scale: [1, 1.05, 1], opacity: [0.85, 1, 0.85] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      >
        <rect x="0" y="0" width="64" height="64" rx="10" fill="#166235" />
        <path
          d="M12 14 L20 14 L20 50 L12 50 Z
             M44 14 L52 14 L52 50 L44 50 Z
             M20 14 L32 30 L44 14 L44 24 L32 40 L20 24 Z"
          fill="#FFFFFF"
        />
      </motion.svg>
    </div>
  );
}

// Favicon-sized version
export function MatbexFavicon({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="0" y="0" width="64" height="64" rx="10" fill="#166235" />
      <path
        d="M12 14 L20 14 L20 50 L12 50 Z
           M44 14 L52 14 L52 50 L44 50 Z
           M20 14 L32 30 L44 14 L44 24 L32 40 L20 24 Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}
