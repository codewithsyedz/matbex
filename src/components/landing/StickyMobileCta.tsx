import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

/**
 * Phone-only sticky call to action. Appears once the hero is scrolled past so
 * the primary action is always one tap away, and steps aside while the footer
 * (which carries its own actions) is on screen.
 */
export const StickyMobileCta = () => {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      const nearBottom =
        y + window.innerHeight > document.documentElement.scrollHeight - 320;
      setVisible(y > window.innerHeight * 0.7 && !nearBottom);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-x-0 bottom-0 z-40 xl:hidden px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 bg-[#07100C]/90 supports-[backdrop-filter]:bg-[#07100C]/75 backdrop-blur-xl border-t border-white/10"
        >
          <div className="flex items-center gap-3">
            <Link
              to="/register"
              className="flex-1 inline-flex items-center justify-center min-h-12 rounded-lg bg-[#00A859] px-5 text-sm font-medium text-white transition-colors hover:bg-[#00954e]"
            >
              {t("landing.hero.primaryCta")}
            </Link>
            <a
              href="#pricing"
              className="inline-flex items-center justify-center min-h-12 min-w-24 rounded-lg border border-white/20 px-4 text-sm font-medium text-white/85 transition-colors hover:bg-white/10"
            >
              {t("landing.pricing.title")}
            </a>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
