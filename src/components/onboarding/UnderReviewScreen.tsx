import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { MatbexLogo } from "@/components/brand/MatbexLogo";
import { Clock, Mail, CheckCircle2 } from "lucide-react";
import { PageTransition } from "@/components/PageTransition";
import { OptimizedLottie } from "@/components/performance/OptimizedLottie";

interface UnderReviewScreenProps {
  email: string;
  applicationId?: string;
}

export function UnderReviewScreen({ email, applicationId }: UnderReviewScreenProps) {
  const { t } = useTranslation();
  const [isMounted, setIsMounted] = useState(false);

  // Avoid rendering the animation during the very first paint (minor main-thread win)
  useEffect(() => setIsMounted(true), []);

  return (
    <PageTransition className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-emerald-50/30 flex flex-col">
      {/* Header */}
      <header className="p-6">
        <MatbexLogo size="md" animate />
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-lg"
        >
          {/* Animated Logo/Icon */}
          <div className="relative mb-8">
            {/* Pulsing background */}
            <motion.div
              animate={{
                scale: [1, 1.2, 1],
                opacity: [0.3, 0.5, 0.3],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: "easeInOut",
              }}
              className="absolute inset-0 flex items-center justify-center"
            >
              <div className="w-48 h-48 rounded-full bg-emerald-100" />
            </motion.div>

            {/* Inner pulse */}
            <motion.div
              animate={{
                scale: [1, 1.1, 1],
                opacity: [0.5, 0.7, 0.5],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: "easeInOut",
                delay: 0.3,
              }}
              className="absolute inset-0 flex items-center justify-center"
            >
              <div className="w-36 h-36 rounded-full bg-emerald-200" />
            </motion.div>

            {/* Center animation */}
            <div className="relative flex items-center justify-center h-48">
              {isMounted ? (
                <div className="w-32 h-32" style={{ filter: 'hue-rotate(120deg) saturate(1.2)' }}>
                  <OptimizedLottie
                    src="https://assets5.lottiefiles.com/packages/lf20_vPnn3K.json"
                    loop
                    autoplay
                    className="w-full h-full"
                  />
                </div>
              ) : (
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
                  className="w-24 h-24 rounded-full border-4 border-emerald-500 border-t-transparent"
                />
              )}
            </div>
          </div>

          {/* Title */}
          <h1 className="text-3xl font-light tracking-tight text-gray-900 mb-3">
            {t("register.review.title")}
          </h1>

          {/* Description */}
          <p className="text-gray-500 font-light max-w-md mx-auto mb-8 leading-relaxed">
            {t("register.review.description")}
          </p>

          {/* Status Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-white border border-gray-100 rounded-xl p-4 text-left"
            >
              <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center mb-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              </div>
              <p className="text-xs font-medium text-gray-900">{t("register.review.received")}</p>
              <p className="text-xs text-muted-foreground">{t("register.review.justNow")}</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="bg-white border border-emerald-200 rounded-xl p-4 text-left ring-2 ring-emerald-100"
            >
              <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center mb-2">
                <Clock className="w-4 h-4 text-white animate-pulse" />
              </div>
              <p className="text-xs font-medium text-gray-900">{t("register.review.inReview")}</p>
              <p className="text-xs text-emerald-600">{t("register.review.inProgress")}</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="bg-gray-50 border border-gray-100 rounded-xl p-4 text-left opacity-50"
            >
              <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center mb-2">
                <Mail className="w-4 h-4 text-gray-400" />
              </div>
              <p className="text-xs font-medium text-gray-500">{t("register.review.credentialsDispatch")}</p>
              <p className="text-xs text-muted-foreground">{t("register.review.pending")}</p>
            </motion.div>
          </div>

          {/* Email Notice */}
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                <Mail className="w-5 h-5 text-gray-500" />
              </div>
              <div className="text-left">
                <p className="text-sm text-gray-700">
                  {t("register.review.credentialsSentTo")}
                </p>
                <p className="text-sm font-medium text-gray-900">{email}</p>
              </div>
            </div>
          </div>

          {/* Application ID */}
          {applicationId && (
            <p className="mt-6 text-xs text-muted-foreground">
              {t("register.review.applicationId")} <span className="font-mono">{applicationId.slice(0, 8)}</span>
            </p>
          )}
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="p-6 text-center">
        <p className="text-xs text-muted-foreground">
          © {new Date().getFullYear()} Matbex. {t("register.review.rightsReserved")}
        </p>
      </footer>
    </PageTransition>
  );
}
