import { motion, useReducedMotion } from "framer-motion";
import { Link } from "react-router-dom";
import { DUR, EASE, STAGGER, TRAVEL, VIEWPORT } from "@/lib/motion/tokens";

export interface Crumb {
  label: string;
  to?: string;
}

interface MarketingPageHeroProps {
  eyebrow?: string;
  title: string;
  summary?: string;
  /** Breadcrumb trail; the last item renders as plain text. */
  crumbs?: Crumb[];
  /** Buttons / links rendered under the summary. */
  actions?: React.ReactNode;
  /** Small print under the actions (e.g. "Updated quarterly"). */
  note?: React.ReactNode;
}

/**
 * The single opening block every public marketing page uses — company,
 * resources and solutions alike. Same ink field, same emerald pool, same
 * rhythm and same entrance choreography as the home page chapters.
 */
export function MarketingPageHero({
  eyebrow,
  title,
  summary,
  crumbs,
  actions,
  note,
}: MarketingPageHeroProps) {
  const reduce = useReducedMotion();

  const container = {
    hidden: {},
    show: { transition: { staggerChildren: reduce ? 0 : STAGGER.base } },
  };
  const item = {
    hidden: { opacity: 0, y: reduce ? 0 : TRAVEL.md },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: reduce ? 0 : DUR.scene, ease: EASE.entrance },
    },
  };

  return (
    <section className="relative overflow-hidden border-b border-white/10">
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-[520px] w-[900px] max-w-[150vw] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(0,168,89,0.16),transparent_70%)] blur-2xl"
      />
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="relative max-w-5xl mx-auto px-6 pt-24 pb-12 sm:pt-28 sm:pb-14 md:pt-32 md:pb-16"
      >
        {crumbs && crumbs.length > 0 && (
          <motion.nav
            variants={item}
            aria-label="Breadcrumb"
            className="mb-5 text-xs text-white/45"
          >
            <ol className="flex flex-wrap items-center gap-1.5">
              {crumbs.map((c, i) => (
                <li key={`${c.label}-${i}`} className="flex items-center gap-1.5">
                  {c.to ? (
                    <Link to={c.to} className="hover:text-white/80 transition-colors">
                      {c.label}
                    </Link>
                  ) : (
                    <span className="text-white/70">{c.label}</span>
                  )}
                  {i < crumbs.length - 1 && <span aria-hidden>/</span>}
                </li>
              ))}
            </ol>
          </motion.nav>
        )}

        {eyebrow && (
          <motion.p
            variants={item}
            className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-[#4FD08A]"
          >
            {eyebrow}
          </motion.p>
        )}

        <motion.h1
          variants={item}
          className="text-3xl sm:text-4xl md:text-5xl font-light tracking-tight text-white max-w-3xl"
        >
          {title}
        </motion.h1>

        {summary && (
          <motion.p
            variants={item}
            className="mt-4 max-w-2xl text-base md:text-lg font-light leading-relaxed text-white/60"
          >
            {summary}
          </motion.p>
        )}

        {actions && (
          <motion.div variants={item} className="mt-7 flex flex-wrap gap-3">
            {actions}
          </motion.div>
        )}

        {note && (
          <motion.p variants={item} className="mt-5 text-xs text-white/40 max-w-2xl">
            {note}
          </motion.p>
        )}
      </motion.div>
    </section>
  );
}

/** Scroll-revealed wrapper matching the hero's timing. Used for page sections. */
export function MarketingReveal({
  children,
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, y: reduce ? 0 : TRAVEL.md }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={VIEWPORT}
      transition={{ duration: reduce ? 0 : DUR.scene, ease: EASE.entrance, delay: reduce ? 0 : delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export default MarketingPageHero;
