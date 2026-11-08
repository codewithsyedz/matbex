import { useEffect, useRef, useState } from "react";
import { ArrowUp, Clock } from "lucide-react";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { ScrollProgress } from "@/components/motion/ScrollProgress";
import { PageTransition } from "@/components/PageTransition";

interface ArticleLayoutProps {
  /** Small category line above the title. */
  eyebrow: string;
  title: string;
  /** Publication line, e.g. "Published May 30, 2026 · 14 min read". */
  meta?: string;
  /** Right-to-left article body (Arabic posts). */
  rtl?: boolean;
  children: React.ReactNode;
}

interface TocEntry {
  id: string;
  label: string;
}

const slugify = (text: string, index: number) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || `section-${index + 1}`;

/**
 * Shared canvas for every long-form article (English and Arabic).
 * Ink-and-emerald art direction, a hairline reading indicator, an
 * auto-built section jump list so readers can skip the long scroll,
 * and a back-to-top control once they are deep in the page.
 */
export function ArticleLayout({
  eyebrow,
  title,
  meta,
  rtl = false,
  children,
}: ArticleLayoutProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [showTop, setShowTop] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);

  // Headings live inside each post's markup, so the jump list is derived
  // from the rendered article rather than duplicated on every page.
  useEffect(() => {
    const headings = bodyRef.current?.querySelectorAll("h2") ?? [];
    const entries: TocEntry[] = [];
    headings.forEach((heading, index) => {
      const label = heading.textContent?.trim() ?? "";
      if (!label) return;
      if (!heading.id) heading.id = slugify(label, index);
      heading.classList.add("scroll-mt-28");
      entries.push({ id: heading.id, label });
    });
    setToc(entries);
  }, [children]);

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 1400);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <MarketingShell>
      <ScrollProgress />
      <LandingHeader />
      <PageTransition className="flex-1">
        <main className="max-w-3xl mx-auto px-6 pt-24 pb-12 sm:pt-28 sm:pb-16">
          <header className={rtl ? "text-right" : undefined}>
            <p className="text-[11px] font-semibold tracking-[0.18em] text-[#00A859] uppercase mb-3">
              {eyebrow}
            </p>
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-light tracking-tight text-[#EDEAE3] leading-tight mb-4">
              {title}
            </h1>
            {meta ? (
              <p className="flex items-center gap-2 text-sm text-[#EDEAE3]/50 mb-8">
                <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>{meta}</span>
              </p>
            ) : null}
          </header>

          {toc.length > 2 ? (
            <nav
              aria-label={rtl ? "محتويات المقال" : "In this article"}
              className="mb-10 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
            >
              <button
                type="button"
                onClick={() => setTocOpen((open) => !open)}
                aria-expanded={tocOpen}
                className="flex w-full min-h-11 items-center justify-between gap-3 text-sm font-medium text-[#EDEAE3] sm:cursor-default sm:pointer-events-none"
              >
                <span>{rtl ? "في هذا المقال" : "In this article"}</span>
                <span className="text-xs text-[#EDEAE3]/50 sm:hidden">
                  {tocOpen ? (rtl ? "إخفاء" : "Hide") : `${toc.length}`}
                </span>
              </button>
              <ol
                className={`${tocOpen ? "block" : "hidden"} mt-3 space-y-1 sm:block ${
                  rtl ? "text-right" : ""
                }`}
              >
                {toc.map((entry, index) => (
                  <li key={entry.id}>
                    <a
                      href={`#${entry.id}`}
                      className="flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm text-[#EDEAE3]/65 transition-colors hover:text-[#00A859] sm:min-h-0 sm:py-1.5"
                    >
                      <span className="text-[11px] tabular-nums text-[#EDEAE3]/30">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span>{entry.label}</span>
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}

          <div ref={bodyRef} className={`lux-article ${rtl ? "text-right" : ""}`}>
            {children}
          </div>
        </main>
      </PageTransition>
      <LandingFooter />

      <button
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        aria-label={rtl ? "العودة إلى الأعلى" : "Back to top"}
        className={`fixed bottom-5 z-50 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-[#0B1A13]/90 text-[#EDEAE3] backdrop-blur transition-opacity duration-200 hover:border-[#00A859]/50 ${
          rtl ? "left-5" : "right-5"
        } ${showTop ? "opacity-100" : "pointer-events-none opacity-0"}`}
      >
        <ArrowUp className="h-4 w-4" />
      </button>
    </MarketingShell>
  );
}

export default ArticleLayout;
