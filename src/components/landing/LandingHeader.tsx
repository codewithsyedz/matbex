import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Menu, X } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { MatbexLogo } from "@/components/brand/MatbexLogo";
import { RegionSelector } from "./RegionSelector";
import { LanguageSelector } from "./LanguageSelector";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { useLanguage } from "@/hooks/useLanguage";
import { useTheme } from "next-themes";

interface LandingHeaderProps {
  /** Force the light/dark bar treatment when the page canvas differs from the route default. */
  overDark?: boolean;
}

export const LandingHeader = ({ overDark: overDarkOverride }: LandingHeaderProps = {}) => {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const homePath = language === "ar" ? "/ar" : "/";
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [themeMounted, setThemeMounted] = useState(false);
  const { resolvedTheme } = useTheme();
  const { pathname } = useLocation();
  // The home hero is a dark "ink" field — the bar sits on it until you scroll.
  // The landing page and the CMS-driven marketing pages share that ink canvas
  // end to end, so the bar stays dark there — including once it frosts.
  const DARK_CANVAS_ROUTES = [
    "/", "/ar",
    "/about", "/careers", "/blog", "/press", "/stats",
    "/api", "/docs", "/help", "/community", "/integrations",
    "/status", "/investment-tiers",
    "/privacy", "/terms", "/security", "/cookies",
  ];
  const normalizedPath = pathname.replace(/\/+$/, "") || "/";
  // Long-form articles share the same ink canvas as the marketing pages.
  const isArticleRoute = /^\/(ar\/)?blog\//.test(normalizedPath);
  // Solution pages share the same ink canvas.
  const isSolutionRoute = /^\/(solutions|pricing|demo)(\/|$)/.test(normalizedPath);
  const isLandingRoute =
    DARK_CANVAS_ROUTES.includes(normalizedPath) || isArticleRoute || isSolutionRoute;
  useEffect(() => setThemeMounted(true), []);
  const darkCanvas = overDarkOverride ?? (isLandingRoute && themeMounted && resolvedTheme === "dark");
  const overDark = darkCanvas && !isMobileMenuOpen;



  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Hash links must point back at the home page when we are on another route.
  const resolveHref = (href: string) =>
    href.startsWith("#") ? `${homePath === "/" ? "" : homePath}/${href}`.replace("//", "/") : href;

  const navItems = [
    { label: t("landing.footer.features"), href: "#features" },
    { label: t("landing.pricing.title"), href: "/pricing" },
    { label: t("landing.faq.title"), href: "#faq" },
  ];

  return (
    <>
      <motion.header
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          isScrolled || isMobileMenuOpen
            ? "bg-background/95 supports-[backdrop-filter]:bg-background/90 backdrop-blur-xl border-b border-border"
            : "bg-background/0 border-b border-transparent"
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 lg:px-8">
          <div className="flex items-center justify-between h-16 lg:h-20">
            {/* Logo */}
            <Link to={homePath} className="flex-shrink-0">
              {/* Keep `animate` stable so header scroll state doesn't re-render the logo.
                  The logo internally guards against re-playing the entry animation. */}
              <MatbexLogo size="lg" variant={overDark ? "dark" : "default"} />
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden xl:flex items-center gap-6 mx-6">
              {navItems.map((item) => (
                <a
                  key={item.label}
                  href={resolveHref(item.href)}
                  className={`text-sm font-medium transition-colors whitespace-nowrap tracking-[-0.005em] ${
                    overDark ? "text-white/70 hover:text-white" : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  {item.label}
                </a>
              ))}
            </nav>

            {/* Desktop CTAs */}
            <div
              className={`hidden xl:flex items-center gap-2 flex-shrink-0 ${
                overDark
                  ? "[&_button]:text-white/70 hover:[&_button]:text-white [&_button]:bg-white/[0.06] [&_button]:border-white/15 hover:[&_button]:bg-white/[0.12]"
                  : ""
              }`}
            >
              {/* Language & Region Selectors */}
              <LanguageSelector />
              <RegionSelector />
              <ThemeToggle overDark={overDark} />

              <Button
                variant="ghost"
                className={`text-sm font-medium whitespace-nowrap ${
                  overDark
                    ? "text-white/70 hover:text-white hover:bg-white/10"
                    : "text-gray-600 hover:text-gray-900"
                }`}
                asChild
              >
                <Link to="/auth">{t("auth.signIn")}</Link>
              </Button>
              <Button
                className="bg-[#007a3d] hover:bg-[#006b33] text-white text-sm font-medium px-4 h-9 rounded-md whitespace-nowrap shadow-none"
                asChild
              >
                <Link to="/register">{t("landing.hero.primaryCta")}</Link>
              </Button>
            </div>

            {/* Mobile/Tablet Menu Toggle */}
            <div
              className={`flex xl:hidden items-center gap-1.5 ${
                overDark
                  ? "[&_button]:text-white/80 [&_button]:bg-white/[0.06] [&_button]:border-white/15"
                  : ""
              }`}
            >
              <LanguageSelector />
              <RegionSelector />
              <ThemeToggle overDark={overDark} />
              <button
                className={`inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg transition-colors ${
                  overDark ? "hover:bg-white/10" : "hover:bg-gray-100"
                }`}
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                aria-label={isMobileMenuOpen ? "Close menu" : "Open menu"}
                aria-expanded={isMobileMenuOpen}
                aria-controls="mobile-menu"
              >
                {isMobileMenuOpen ? (
                  <X className={`w-5 h-5 ${overDark ? "text-white" : "text-gray-900"}`} />
                ) : (
                  <Menu className={`w-5 h-5 ${overDark ? "text-white" : "text-gray-900"}`} />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile/Tablet Menu - Inside header with solid background */}
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="xl:hidden bg-background border-t border-border"
          >
            <div className="max-w-7xl mx-auto px-4 py-4">
              <nav className="flex flex-col gap-1">
                {navItems.map((item) => (
                  <a
                    key={item.label}
                    href={resolveHref(item.href)}
                    className="text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors py-3 px-3 rounded-md"
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    {item.label}
                  </a>
                ))}
                <div className="flex flex-col gap-2 pt-4 mt-2 border-t border-border">
                  <Button variant="ghost" className="justify-start h-11" asChild>
                    <Link to="/auth" onClick={() => setIsMobileMenuOpen(false)}>
                      {t("auth.signIn")}
                    </Link>
                  </Button>
                  <Button
                    className="bg-[#007a3d] hover:bg-[#006b33] text-white h-11 rounded-md shadow-none"
                    asChild
                  >
                    <Link to="/register" onClick={() => setIsMobileMenuOpen(false)}>
                      {t("landing.hero.primaryCta")}
                    </Link>
                  </Button>
                </div>
              </nav>
            </div>
          </motion.div>
        )}
      </motion.header>

      {/* Overlay when menu is open */}
      {isMobileMenuOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/20 z-40 xl:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}
    </>
  );
};
