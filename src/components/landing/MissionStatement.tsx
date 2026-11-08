import { motion } from "framer-motion";
import { MatbexLogo } from "@/components/brand/MatbexLogo";
import { useLandingContent } from "@/hooks/useLandingContent";
import { Skeleton } from "@/components/ui/skeleton";
import { useRevealInView } from "@/hooks/useRevealInView";
import { useLocaleText } from "@/hooks/useLocaleText";

export const MissionStatement = () => {
  const { ref, isRevealed } = useRevealInView<HTMLElement>({ margin: "-100px" });
  const { mission } = useLandingContent();
  const tt = useLocaleText();
  const isLoading = mission === undefined;

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.12,
        delayChildren: 0.1,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.6,
        ease: [0.22, 1, 0.36, 1],
      },
    },
  };

  if (isLoading) {
    return (
      <section className="relative py-12 sm:py-16 lg:py-28 bg-[#F9FAFB] overflow-hidden">
        <div className="max-w-3xl mx-auto px-6 lg:px-8 space-y-8">
          <div className="flex justify-center mb-6 sm:mb-10 lg:mb-12">
            <Skeleton className="w-16 h-16 rounded-full" />
          </div>
          <Skeleton className="h-14 w-3/4 mx-auto" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-10 w-2/3 mx-auto" />
          <Skeleton className="h-20 w-full" />
        </div>
      </section>
    );
  }

  return (
    <section ref={ref} className="relative py-12 sm:py-16 lg:py-28 bg-white border-t border-gray-200">
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate={isRevealed ? "visible" : "hidden"}
        className="relative z-10 max-w-3xl mx-auto px-6 lg:px-8"
      >
        {/* Logo */}
        <motion.div
          variants={itemVariants}
          className="flex justify-center mb-10"
        >
          <MatbexLogo size="lg" showWordmark={false} animate={false} />
        </motion.div>

        {/* Headline */}
        <motion.h2
          variants={itemVariants}
          className="text-3xl md:text-4xl lg:text-[44px] font-semibold tracking-[-0.01em] text-center text-gray-900 leading-[1.15] mb-10"
        >
          {tt("landing.mission.headlinePrefix", mission?.headline_prefix || "Engineered vitality for the")}{" "}
          <span className="text-gray-500">
            {tt("landing.mission.headlineBold", mission?.headline_bold || "modern restaurateur.")}
          </span>
        </motion.h2>

        {/* Body Copy */}
        <div className="space-y-7">
          {/* Opening statement */}
          <motion.p
            variants={itemVariants}
            className="text-base md:text-lg text-gray-600 leading-[1.6] text-center"
          >
            {tt("landing.mission.opening", mission?.opening_paragraph)}
          </motion.p>

          {/* Core mission - highlighted */}
          <motion.p
            variants={itemVariants}
            className="text-xl md:text-2xl font-semibold tracking-[-0.01em] text-[#00713A] leading-snug text-center py-4"
          >
            {tt("landing.mission.coreMission", mission?.core_mission)}
          </motion.p>

          {/* Visual identity explanation */}
          <motion.p
            variants={itemVariants}
            className="text-base md:text-lg text-gray-600 leading-[1.6] text-center"
          >
            {tt("landing.mission.identity", mission?.identity_text)}
          </motion.p>

          {/* Symbolic statement */}
          <motion.p
            variants={itemVariants}
            className="text-sm md:text-base text-gray-500 text-center"
          >
            {tt("landing.mission.symbolic", mission?.symbolic_statement)}
          </motion.p>

          {/* Closing statement with emphasis */}
          <motion.p
            variants={itemVariants}
            className="text-base md:text-lg text-gray-600 leading-[1.6] text-center"
            dangerouslySetInnerHTML={{
              __html: (tt("landing.mission.closing", mission?.closing_text) as string)
                .replace(
                  new RegExp(tt("landing.mission.closingEmphasis", "central nervous system"), "g"),
                  `<span class="font-semibold text-gray-900">${tt("landing.mission.closingEmphasis", "central nervous system")}</span>`,
                ),
            }}
          />
        </div>

        {/* Hairline divider */}
        <motion.div
          variants={itemVariants}
          className="mt-14 flex items-center justify-center"
        >
          <div className="w-16 h-px bg-gray-200" />
        </motion.div>
      </motion.div>
    </section>
  );
};

