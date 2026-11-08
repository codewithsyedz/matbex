import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";

interface SaudiMadeBadgeProps {
  variant?: "compact" | "full";
  className?: string;
}

/**
 * Saudi Made (صُنع في السعودية) badge - proudly signals that Matbex
 * is built and operated entirely from the Kingdom.
 *
 * Uses the official Saudi Made logo from:
 * https://upload.wikimedia.org/wikipedia/commons/9/9c/SAUDI_MADE.svg
 */
export function SaudiMadeBadge({
  variant = "full",
  className = "",
}: SaudiMadeBadgeProps) {
  const { t } = useTranslation();
  const height = variant === "compact" ? 32 : 48;
  // SVG intrinsic aspect ratio ~ 3.6:1 (width:height) - keep both dimensions
  // explicit so the browser reserves layout space and avoids CLS.
  const width = Math.round(height * 3.6);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4 }}
      className={`inline-flex items-center ${className}`}
    >
      <img
        src="/saudi-made-logo.svg"
        alt={t("landing.saudiMadeAlt")}
        width={width}
        height={height}
        className="w-auto"
        style={{ height }}
        loading="lazy"
        decoding="async"
      />
    </motion.div>
  );
}
