import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { MarketingReveal } from "./MarketingPageHero";

interface MarketingCtaBandProps {
  title?: string;
  body?: string;
  primaryLabel?: string;
  primaryTo?: string;
  secondaryLabel?: string;
  secondaryTo?: string;
}

/**
 * The closing ask. Identical on every marketing page so the site ends the
 * same way the home page does.
 */
export function MarketingCtaBand({
  title = "See Matbex on your own numbers",
  body = "A 30-minute walkthrough using your menu, your costs and your branches. No install, no commitment.",
  primaryLabel = "Start your residency",
  primaryTo = "/auth?mode=signup",
  secondaryLabel = "Book a live demo",
  secondaryTo = "/demo",
}: MarketingCtaBandProps) {
  return (
    <section className="relative overflow-hidden border-t border-white/10">
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 bottom-0 h-[420px] w-[860px] max-w-[150vw] -translate-x-1/2 translate-y-1/3 rounded-full bg-[radial-gradient(circle,rgba(0,168,89,0.18),transparent_70%)] blur-2xl"
      />
      <div className="relative max-w-5xl mx-auto px-6 py-16 sm:py-20 text-center">
        <MarketingReveal>
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-light tracking-tight text-white">
            {title}
          </h2>
          <p className="mt-4 mx-auto max-w-xl text-base font-light leading-relaxed text-white/60">
            {body}
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              to={primaryTo}
              className="inline-flex items-center justify-center gap-2 min-h-11 h-11 px-6 rounded-lg bg-[#00A859] text-white text-sm font-medium hover:bg-[#00A859]/90 transition-colors w-full sm:w-auto"
            >
              {primaryLabel}
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              to={secondaryTo}
              className="inline-flex items-center justify-center min-h-11 h-11 px-6 rounded-lg border border-white/15 text-white/80 text-sm font-medium hover:bg-white/[0.06] hover:text-white transition-colors w-full sm:w-auto"
            >
              {secondaryLabel}
            </Link>
          </div>
        </MarketingReveal>
      </div>
    </section>
  );
}

export default MarketingCtaBand;
