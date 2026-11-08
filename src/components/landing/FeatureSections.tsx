import { motion } from "framer-motion";
import { 
  TrendingUp, 
  AlertTriangle, 
  FileText, 
  Users, 
  Clock, 
  DollarSign,
  Fingerprint,
  CheckCircle2
} from "lucide-react";
import { useRevealInView } from "@/hooks/useRevealInView";
import { useTranslation } from "react-i18next";

export const FeatureSections = () => {
  return (
    <div className="bg-white">
      {/* Section A: The Profit Guard */}
      <ProfitGuardSection />
      
      {/* Section B: The Human Element */}
      <HumanElementSection />
    </div>
  );
};

const ProfitGuardSection = () => {
  const { ref, isRevealed } = useRevealInView<HTMLElement>({ margin: "-100px" });
  const { t } = useTranslation();

  return (
    <section ref={ref} className="py-12 sm:py-16 lg:py-24">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-8 sm:gap-12 lg:gap-24 items-center">
          {/* Left: Text Content */}
          <motion.div
            initial={{ opacity: 0, x: -40 }}
              animate={isRevealed ? { opacity: 1, x: 0 } : { opacity: 0, x: -40 }}
            transition={{ duration: 0.8 }}
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-gray-200 bg-white mb-6">
              <span className="text-xs font-medium text-gray-600 uppercase tracking-wider">
                {t("landing.featureA.eyebrow")}
              </span>
            </div>
            
            <h2 className="text-3xl md:text-[2.625rem] font-light tracking-[-0.02em] text-gray-900 mb-6 leading-[1.15]">
              {t("landing.featureA.title")}
            </h2>
            
            <p className="text-[1.0625rem] md:text-lg text-gray-600 font-light leading-[1.7] mb-10 max-w-xl">
              {t("landing.featureA.lead")}
              <span className="text-gray-900 font-normal">{t("landing.featureA.leadEmphasis")}</span>.
            </p>

            <div className="space-y-7">
              <div className="flex items-start gap-4">
                <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                  <TrendingUp className="w-4 h-4 text-gray-700" strokeWidth={1.5} />
                </div>
                <div>
                  <h3 className="text-[0.9375rem] font-medium text-gray-900 mb-1.5 leading-snug">
                    {t("landing.featureA.i1Title")}
                  </h3>
                  <p className="text-[0.9375rem] text-gray-600 font-light leading-[1.65]">
                    {t("landing.featureA.i1Body")}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-4 h-4 text-gray-700" strokeWidth={1.5} />
                </div>
                <div>
                  <h3 className="text-[0.9375rem] font-medium text-gray-900 mb-1.5 leading-snug">
                    {t("landing.featureA.i2Title")}
                  </h3>
                  <p className="text-[0.9375rem] text-gray-600 font-light leading-[1.65]">
                    {t("landing.featureA.i2Body")}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                  <FileText className="w-4 h-4 text-gray-700" strokeWidth={1.5} />
                </div>
                <div>
                  <h3 className="text-[0.9375rem] font-medium text-gray-900 mb-1.5 leading-snug">
                    {t("landing.featureA.i3Title")}
                  </h3>
                  <p className="text-[0.9375rem] text-gray-600 font-light leading-[1.65]">
                    {t("landing.featureA.i3Body")}
                  </p>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Right: Interactive UI Mockup */}
          <motion.div
            initial={{ opacity: 0, x: 40 }}
              animate={isRevealed ? { opacity: 1, x: 0 } : { opacity: 0, x: 40 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="relative hidden sm:block"
          >
            <div className="bg-gray-50 rounded-2xl p-5 sm:p-6 lg:p-8 border border-gray-200">
              {/* Main Card */}
              <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-100 mb-4">
                <div className="flex items-center justify-between mb-6">
                  <p className="text-lg font-medium text-gray-900">{t("landing.featureA.cardTitle")}</p>
                  <span className="text-sm text-gray-500">{t("landing.featureA.today")}</span>
                </div>

                {/* Variance Bars */}
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-600">{t("landing.featureA.theoretical")}</span>
                      <span className="text-sm font-medium text-gray-900">$1,247</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={isRevealed ? { width: "70%" } : { width: 0 }}
                        transition={{ duration: 1, delay: 0.5 }}
                        className="h-full bg-gray-900 rounded-full"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-600">{t("landing.featureA.actual")}</span>
                      <span className="text-sm font-medium text-gray-900">$1,312</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={isRevealed ? { width: "74%" } : { width: 0 }}
                        transition={{ duration: 1, delay: 0.7 }}
                        className="h-full bg-gray-400 rounded-full"
                      />
                    </div>
                  </div>
                </div>

                {/* Variance Alert */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={isRevealed ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
                  transition={{ delay: 1.2 }}
                  className="mt-6 p-4 bg-gray-50 rounded-xl border border-gray-200"
                >
                  <div className="flex items-center gap-3">
                    <AlertTriangle className="w-5 h-5 text-gray-700" strokeWidth={1.5} />
                    <div>
                      <p className="text-sm font-medium text-gray-900">{t("landing.featureA.varianceAlert")}</p>
                      <p className="text-xs text-gray-600">{t("landing.featureA.varianceDetail")}</p>
                    </div>
                  </div>
                </motion.div>
              </div>

              {/* Auto-Generated PO */}
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={isRevealed ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.95 }}
                transition={{ delay: 1.5 }}
                className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gray-900 flex items-center justify-center">
                    <CheckCircle2 className="w-5 h-5 text-white" strokeWidth={1.5} />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">{t("landing.featureA.poGenerated")}</p>
                    <p className="text-xs text-gray-500">{t("landing.featureA.poRef")}</p>
                  </div>
                  <span className="text-lg font-light text-gray-900">$847</span>
                </div>
              </motion.div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};

const HumanElementSection = () => {
  const { ref, isRevealed } = useRevealInView<HTMLElement>({ margin: "-100px" });
  const { t } = useTranslation();

  return (
    <section ref={ref} className="py-12 sm:py-16 lg:py-24 bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-8 sm:gap-12 lg:gap-24 items-center">
          {/* Left: Interactive UI Mockup */}
          <motion.div
            initial={{ opacity: 0, x: -40 }}
            animate={isRevealed ? { opacity: 1, x: 0 } : { opacity: 0, x: -40 }}
            transition={{ duration: 0.8 }}
            className="relative order-2 lg:order-1 hidden sm:block"
          >
            <div className="bg-gray-50 rounded-2xl p-5 sm:p-6 lg:p-8 border border-gray-200">
              {/* Clock-in Animation */}
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={isRevealed ? { opacity: 1, y: 0 } : { opacity: 0, y: -20 }}
                transition={{ delay: 0.5 }}
                className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 mb-4"
              >
                <div className="flex items-center gap-4">
                  <motion.div
                    animate={isRevealed ? { scale: [1, 1.1, 1] } : {}}
                    transition={{ duration: 0.5, delay: 0.8 }}
                    className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center"
                  >
                    <Fingerprint className="w-6 h-6 text-gray-700" strokeWidth={1.5} />
                  </motion.div>
                  <div className="flex-1">
                    <p className="text-base font-medium text-gray-900">{t("landing.featureB.clockedIn")}</p>
                    <p className="text-sm text-gray-500">{t("landing.featureB.role")}</p>
                  </div>
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={isRevealed ? { scale: 1 } : { scale: 0 }}
                    transition={{ delay: 1, type: "spring" }}
                    className="w-7 h-7 rounded-full bg-gray-900 flex items-center justify-center"
                  >
                    <CheckCircle2 className="w-4 h-4 text-white" strokeWidth={1.5} />
                  </motion.div>
                </div>
              </motion.div>

              {/* Labor Cost Dashboard */}
              <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
                <div className="flex items-center justify-between mb-6">
                  <p className="text-lg font-medium text-gray-900">{t("landing.featureB.laborCostTitle")}</p>
                  <span className="text-sm text-gray-500">{t("landing.featureB.live")}</span>
                </div>

                <div className="flex items-end gap-4 mb-6">
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={isRevealed ? { opacity: 1 } : { opacity: 0 }}
                    transition={{ delay: 0.8 }}
                    className="text-5xl font-light tracking-[-0.02em] text-gray-900"
                  >
                    24.8
                  </motion.span>
                  <span className="text-2xl text-gray-400 mb-2">%</span>
                  <motion.div
                    initial={{ opacity: 0, x: -10 }}
                    animate={isRevealed ? { opacity: 1, x: 0 } : { opacity: 0, x: -10 }}
                    transition={{ delay: 1.2 }}
                    className="flex items-center gap-1 text-gray-600 mb-2"
                  >
                    <TrendingUp className="w-4 h-4" />
                    <span className="text-sm font-medium">-0.3%</span>
                  </motion.div>
                </div>

                {/* Staff on Shift */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-gray-50 rounded-xl">
                    <div className="flex items-center gap-2 mb-2">
                      <Users className="w-4 h-4 text-gray-500" />
                      <span className="text-xs text-gray-500">{t("landing.featureB.foh")}</span>
                    </div>
                    <p className="text-2xl font-light text-gray-900">6</p>
                  </div>
                  <div className="p-4 bg-gray-50 rounded-xl">
                    <div className="flex items-center gap-2 mb-2">
                      <Users className="w-4 h-4 text-gray-500" />
                      <span className="text-xs text-gray-500">{t("landing.featureB.boh")}</span>
                    </div>
                    <p className="text-2xl font-light text-gray-900">4</p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Right: Text Content */}
          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={isRevealed ? { opacity: 1, x: 0 } : { opacity: 0, x: 40 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="order-1 lg:order-2"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-gray-200 bg-white mb-6">
              <span className="text-xs font-medium text-gray-600 uppercase tracking-wider">
                {t("landing.featureB.eyebrow")}
              </span>
            </div>
            
            <h2 className="text-3xl md:text-[2.625rem] font-light tracking-[-0.02em] text-gray-900 mb-6 leading-[1.15]">
              {t("landing.featureB.title")}
            </h2>
            
            <p className="text-[1.0625rem] md:text-lg text-gray-600 font-light leading-[1.7] mb-10 max-w-xl">
              {t("landing.featureB.lead")}
              <span className="text-gray-900 font-normal">{t("landing.featureB.leadEmphasis")}</span>.
            </p>

            <div className="space-y-7">
              <div className="flex items-start gap-4">
                <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                  <Clock className="w-4 h-4 text-gray-700" strokeWidth={1.5} />
                </div>
                <div>
                  <h3 className="text-[0.9375rem] font-medium text-gray-900 mb-1.5 leading-snug">
                    {t("landing.featureB.i1Title")}
                  </h3>
                  <p className="text-[0.9375rem] text-gray-600 font-light leading-[1.65]">
                    {t("landing.featureB.i1Body")}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                  <DollarSign className="w-4 h-4 text-gray-700" strokeWidth={1.5} />
                </div>
                <div>
                  <h3 className="text-[0.9375rem] font-medium text-gray-900 mb-1.5 leading-snug">
                    {t("landing.featureB.i2Title")}
                  </h3>
                  <p className="text-[0.9375rem] text-gray-600 font-light leading-[1.65]">
                    {t("landing.featureB.i2Body")}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                  <Users className="w-4 h-4 text-gray-700" strokeWidth={1.5} />
                </div>
                <div>
                  <h3 className="text-[0.9375rem] font-medium text-gray-900 mb-1.5 leading-snug">
                    {t("landing.featureB.i3Title")}
                  </h3>
                  <p className="text-[0.9375rem] text-gray-600 font-light leading-[1.65]">
                    {t("landing.featureB.i3Body")}
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};
