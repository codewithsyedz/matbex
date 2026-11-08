import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  Play,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Users,
  BarChart3,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useLandingContent } from "@/hooks/useLandingContent";
import { Skeleton } from "@/components/ui/skeleton";
import { VideoDemoModal } from "./VideoDemoModal";
import { useLocaleText } from "@/hooks/useLocaleText";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * "Service Line" hero.
 * Ink field, single emerald key light, product rendered as a lit glass slab.
 * Motion is transform/opacity only and fully disabled under prefers-reduced-motion.
 */
export const HeroSection = () => {
  const { hero, isLoading } = useLandingContent();
  const tt = useLocaleText();
  const reduce = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });
  const slabY = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : -40]);
  const copyY = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : 24]);
  const fieldOpacity = useTransform(scrollYProgress, [0, 1], [1, reduce ? 1 : 0.45]);

  // Cursor spotlight — fine pointers only.
  const [spot, setSpot] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (reduce) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    const el = sectionRef.current;
    if (!el) return;
    let frame = 0;
    const onMove = (e: MouseEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const rect = el.getBoundingClientRect();
        setSpot({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      });
    };
    const onLeave = () => setSpot(null);
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, [reduce]);

  const headlineLeft = tt(
    "landing.hero.headlineDefaultLeft",
    hero?.headline?.split(",")[0] || "Your entire restaurant",
  );
  const headlineRight = tt(
    "landing.hero.headlineDefaultRight",
    hero?.headline?.split(",")[1]?.trim() || "synchronized.",
  );

  const rise = (delay: number) =>
    reduce
      ? { initial: { opacity: 1, y: 0 }, animate: { opacity: 1, y: 0 } }
      : {
          initial: { opacity: 0, y: 18 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.65, delay, ease: EASE },
        };

  return (
    <section
      ref={sectionRef}
      className="lux-hero relative isolate overflow-hidden flex items-center justify-center"
    >
      {/* ---- Field: key light, lattice, grain, dawn falloff ---- */}
      <motion.div style={{ opacity: fieldOpacity }} aria-hidden className="absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_78%_-10%,#0F3F2A_0%,#0A1712_45%,#050D0A_78%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(70%_60%_at_0%_100%,rgba(120,180,255,0.07),transparent_60%)]" />
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              "radial-gradient(rgba(255,255,255,0.10) 1px, transparent 1px)",
            backgroundSize: "26px 26px",
            maskImage:
              "radial-gradient(80% 70% at 60% 20%, black 0%, transparent 75%)",
            WebkitMaskImage:
              "radial-gradient(80% 70% at 60% 20%, black 0%, transparent 75%)",
          }}
        />
        {spot && (
          <div
            className="absolute h-[520px] w-[520px] rounded-full pointer-events-none transition-opacity duration-300"
            style={{
              left: spot.x - 260,
              top: spot.y - 260,
              background:
                "radial-gradient(circle, rgba(0,168,89,0.16) 0%, rgba(0,168,89,0.06) 40%, transparent 68%)",
            }}
          />
        )}
        {/* film grain */}
        <div
          className="absolute inset-0 opacity-[0.05] mix-blend-overlay"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/></filter><rect width='120' height='120' filter='url(%23n)' opacity='0.6'/></svg>\")",
          }}
        />
        {/* dissolve into the page below */}
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-[#07100C]" />
      </motion.div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 lg:px-8 pt-32 pb-28 lg:pt-40 lg:pb-36 w-full">
        <div className="grid lg:grid-cols-[1.05fr_1fr] gap-14 lg:gap-16 items-center">
          {/* ---- Left: copy ---- */}
          <motion.div style={{ y: copyY }} className="lux-hero-copy text-left">
            <motion.div
              {...rise(0)}
              className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-white/[0.06] border border-white/10 backdrop-blur-sm mb-8"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#00A859] shadow-[0_0_10px_2px_rgba(0,168,89,0.6)]" />
              {isLoading ? (
                <Skeleton className="h-3 w-44 bg-white/10" />
              ) : (
                <span className="text-[11px] font-medium text-white/70 uppercase tracking-[0.16em]">
                  {tt(
                    "landing.hero.eyebrow",
                    hero?.eyebrow ||
                      tt("landing.hero.eyebrowDefault", "Operating system for restaurants"),
                  )}
                </span>
              )}
            </motion.div>

            <h1 className="text-[40px] md:text-6xl lg:text-[68px] font-light tracking-[-0.035em] text-white leading-[1.03] mb-7">
              <motion.span {...rise(0.06)} className="block">
                {headlineLeft},
              </motion.span>
              <motion.span {...rise(0.15)} className="block text-white/45">
                {headlineRight}
              </motion.span>
            </h1>

            <motion.p
              {...rise(0.24)}
              className="text-[17px] md:text-[19px] text-white/60 leading-[1.7] mb-10 max-w-[58ch] font-light"
            >
              {isLoading ? (
                <>
                  <Skeleton className="h-5 w-full mb-2 bg-white/10" />
                  <Skeleton className="h-5 w-4/5 bg-white/10" />
                </>
              ) : (
                tt(
                  "landing.hero.subheadline",
                  hero?.subheadline ||
                    tt(
                      "landing.hero.subheadlineDefault",
                      "Real-time COGS, automated payroll, inventory sync, and live profit - one operational system for the entire kitchen.",
                    ),
                )
              )}
            </motion.p>

            <motion.div {...rise(0.32)} className="flex flex-wrap gap-3">
              <Button
                size="lg"
                className="bg-[#00A859] hover:bg-[#00c268] text-[#04140C] text-sm font-semibold px-6 h-12 rounded-md shadow-[0_10px_40px_-12px_rgba(0,168,89,0.8)] group"
                asChild
              >
                <Link to="/auth?signup=1&trial=1">
                  {tt("landing.hero.ctaDefault", hero?.primary_cta_text || "Start 14-day free trial")}
                  <ArrowRight className="ltr:ml-2 rtl:mr-2 rtl:rotate-180 w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                </Link>
              </Button>
              <VideoDemoModal
                trigger={
                  <Button
                    size="lg"
                    variant="outline"
                    className="border-white/20 bg-white/[0.04] text-white text-sm font-medium px-5 h-12 rounded-md hover:bg-white/10 hover:text-white shadow-none backdrop-blur-sm"
                  >
                    <Play className="ltr:mr-2 rtl:ml-2 w-3.5 h-3.5" />
                    {tt("landing.hero.watchDemo", "Watch demo")}
                  </Button>
                }
              />
            </motion.div>

            <motion.p
              {...rise(0.4)}
              className="mt-9 text-sm text-white/40 tracking-[-0.005em] leading-relaxed"
            >
              {tt("landing.hero.trustLine", "ZATCA-ready · Multi-tenant · Built for high-volume operators")}
            </motion.p>
          </motion.div>

          {/* ---- Right: lit glass slab ---- */}
          <motion.div
            style={{ y: slabY }}
            initial={reduce ? undefined : { opacity: 0, y: 28 }}
            animate={reduce ? undefined : { opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2, ease: EASE }}
            className="lux-hero-slab relative"
          >
            {/* bloom under the slab */}
            <div
              aria-hidden
              className="absolute -inset-8 rounded-[28px] bg-[radial-gradient(60%_60%_at_60%_40%,rgba(0,168,89,0.22),transparent_70%)] blur-2xl"
            />

            <div className="lux-hero-panel relative rounded-xl border border-white/12 bg-white/[0.045] backdrop-blur-xl p-6 lg:p-7 lg:mt-8 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)]">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent"
              />

              {/* Panel header */}
              <div className="flex items-center justify-between pb-5 mb-5 border-b border-white/10">
                <div>
                  <p className="text-[10px] font-medium text-white/40 uppercase tracking-[0.16em]">
                    {tt("landing.hero.today", "Today")}
                  </p>
                  <p className="text-lg font-light tracking-[-0.02em] text-white mt-1">
                    {tt("landing.hero.restaurantName", "The Gilded Fig")}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 px-2 py-1 rounded border border-white/15 bg-white/[0.04]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#00A859] shadow-[0_0_8px_2px_rgba(0,168,89,0.6)]" />
                  <span className="text-[10px] font-medium text-white/70 uppercase tracking-[0.12em]">
                    {tt("landing.hero.live", "Live")}
                  </span>
                </div>
              </div>

              {/* KPI grid */}
              <div className="grid grid-cols-2 gap-px bg-white/10 border border-white/10 rounded-md overflow-hidden mb-5">
                <KpiCell
                  label={tt("landing.hero.kpiRevenue", "Revenue")}
                  value="﷼12,847"
                  delta="+12.4%"
                  trend="up"
                  icon={<DollarSign className="w-3.5 h-3.5 text-white/35" />}
                />
                <KpiCell
                  label={tt("landing.hero.kpiCogs", "COGS")}
                  value="28.4%"
                  delta="−2.1%"
                  trend="up"
                  icon={<BarChart3 className="w-3.5 h-3.5 text-white/35" />}
                />
                <KpiCell
                  label={tt("landing.hero.kpiLabor", "Labor")}
                  value="24.8%"
                  delta={tt("landing.hero.kpiLaborTarget", "Target 25%")}
                  trend="neutral"
                  icon={<Users className="w-3.5 h-3.5 text-white/35" />}
                />
                <KpiCell
                  label={tt("landing.hero.kpiNetProfit", "Net profit")}
                  value="﷼2,456"
                  delta="+18.2%"
                  trend="up"
                  icon={<TrendingUp className="w-3.5 h-3.5 text-[#3ADf8F]" />}
                />
              </div>

              {/* Live order row */}
              <div className="rounded-md p-3 border border-white/10 bg-white/[0.04]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-md border border-white/15 bg-white/[0.06] flex items-center justify-center">
                      <span className="text-[11px] font-medium text-white/80 tabular-nums">47</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white tracking-[-0.005em]">
                        {tt("landing.hero.orderTitle", "Order 1847 · Truffle Pasta")}
                      </p>
                      <p className="text-xs text-white/45">
                        {tt("landing.hero.orderSubtitle", "Sale → Inventory → Ledger")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#00A859]" />
                    <span className="text-xs font-medium text-[#3ADf8F]">
                      {tt("landing.hero.orderPosted", "Posted")}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Floating status cards — depth, never covering the slab's content */}
            <motion.div
              initial={reduce ? undefined : { opacity: 0, x: -14 }}
              animate={reduce ? undefined : { opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.75, ease: EASE }}
              aria-hidden
              className="lux-hero-float pointer-events-none hidden xl:flex absolute -left-36 top-1/3 -translate-y-1/2 rounded-md p-3 border border-white/12 bg-[#0A1712]/80 backdrop-blur-xl shadow-[0_20px_50px_-24px_rgba(0,0,0,0.9)] items-center gap-3"
            >
              <AlertCircle className="w-4 h-4 text-amber-300/80" />
              <div>
                <p className="text-sm font-medium text-white tracking-[-0.005em]">
                  {tt("landing.hero.lowStockTitle", "Low stock")}
                </p>
                <p className="text-xs text-white/45 tabular-nums">
                  {tt("landing.hero.lowStockSubtitle", "Olive oil · 2 left")}
                </p>
              </div>
            </motion.div>

            <motion.div
              initial={reduce ? undefined : { opacity: 0, x: 14 }}
              animate={reduce ? undefined : { opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.85, ease: EASE }}
              aria-hidden
              className="lux-hero-float pointer-events-none hidden xl:flex absolute -right-16 -bottom-10 rounded-md p-3 border border-white/12 bg-[#0A1712]/80 backdrop-blur-xl shadow-[0_20px_50px_-24px_rgba(0,0,0,0.9)] items-center gap-3"
            >
              <CheckCircle2 className="w-4 h-4 text-[#3ADf8F]" />
              <div>
                <p className="text-sm font-medium text-white tracking-[-0.005em]">
                  {tt("landing.hero.poTitle", "PO generated")}
                </p>
                <p className="text-xs text-white/45 tabular-nums">
                  {tt("landing.hero.poSubtitle", "Sysco Foods · ﷼1,247")}
                </p>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};

function KpiCell({
  label,
  value,
  delta,
  trend,
  icon,
}: {
  label: string;
  value: string;
  delta: string;
  trend: "up" | "down" | "neutral";
  icon: React.ReactNode;
}) {
  const deltaColor =
    trend === "up" ? "text-[#3ADf8F]" : trend === "down" ? "text-white/70" : "text-white/40";
  const DeltaIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : null;
  return (
    <div className="bg-white/[0.03] p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-medium text-white/40 uppercase tracking-[0.14em]">
          {label}
        </span>
        {icon}
      </div>
      <p className="text-xl font-light tracking-[-0.02em] text-white tabular-nums">{value}</p>
      <div className={`flex items-center gap-1 mt-1 ${deltaColor}`}>
        {DeltaIcon && <DeltaIcon className="w-3 h-3" />}
        <span className="text-xs font-medium tabular-nums">{delta}</span>
      </div>
    </div>
  );
}
