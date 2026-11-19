import { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Capacitor } from "@capacitor/core";
import { useTranslation } from "react-i18next";
import { RouteSeo } from "@/components/seo/RouteSeo";
import { DotLottiePlayer } from "@dotlottie/react-player";
import { useAuth } from "@/contexts/AuthContext";
import { useLoginRateLimiting } from "@/hooks/useLoginRateLimiting";
import { db } from "@/integrations/db/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { z } from "zod";
import { Loader2, ArrowRight, Eye, EyeOff, AlertTriangle, Mail, ChevronLeft, ChevronRight, Building2, KeyRound } from "lucide-react";
import { QrCode } from "lucide-react";
import { MatbexLogo } from "@/components/brand/MatbexLogo";
import { PageTransition } from "@/components/PageTransition";
import { LanguageSelector } from "@/components/landing/LanguageSelector";
import { RegionSelector } from "@/components/landing/RegionSelector";
import { QrScannerDialog } from "@/components/pos/QrScannerDialog";
import {
  getDeviceTenant,
  setDeviceTenant,
  clearDeviceTenant,
  resolveTenantCode,
  type DeviceTenant,
} from "@/lib/pos/deviceTenant";
const loginSchema = z.object({
  email: z.string().trim().email("Please enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const signupSchema = loginSchema.extend({
  fullName: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
});

// Feature slides for the carousel
const featureSlideRefs = [
  { id: 1, lottieUrl: "https://assets2.lottiefiles.com/packages/lf20_tll0j4bb.json", titleKey: "app.carousel.slide1Title", subtitleKey: "app.carousel.slide1Subtitle" },
  { id: 2, lottieUrl: "https://assets5.lottiefiles.com/packages/lf20_tljjahng.json", titleKey: "app.carousel.slide2Title", subtitleKey: "app.carousel.slide2Subtitle" },
  { id: 3, lottieUrl: "https://assets9.lottiefiles.com/packages/lf20_uu0x8lqv.json", titleKey: "app.carousel.slide3Title", subtitleKey: "app.carousel.slide3Subtitle" },
];

// Animation variants
const cardVariants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
  },
};

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 100 : -100,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
  },
  exit: (direction: number) => ({
    x: direction < 0 ? 100 : -100,
    opacity: 0,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
  }),
};

export default function Auth() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [isLogin, setIsLogin] = useState(true);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lockWarning, setLockWarning] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(1);
  const [resendLoading, setResendLoading] = useState(false);
 
  // Native APK: tenant-code pairing
  const isNative = Capacitor.isNativePlatform();
  const [deviceTenant, setDeviceTenantState] = useState<DeviceTenant | null>(
    isNative ? getDeviceTenant() : null,
  );
  const [tenantCode, setTenantCode] = useState("");
  const [resolvingTenant, setResolvingTenant] = useState(false);
  const [tenantError, setTenantError] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  
  // Carousel state
  const [currentSlide, setCurrentSlide] = useState(0);
  const [slideDirection, setSlideDirection] = useState(0);
  
  // Invitation params
  const inviteToken = searchParams.get("invite");
  const inviteEmail = searchParams.get("email");
  const inviteRole = searchParams.get("role");
  const isInvite = !!inviteToken && !!inviteEmail;

  // Demo / signup intent from landing page (?signup=1&trial=1)
  const wantsSignup = searchParams.get("signup") === "1";
  const wantsTrial = searchParams.get("trial") === "1";

  const { signIn, signUp, user } = useAuth();
  const { trackLoginAttempt, checkAccountLock } = useLoginRateLimiting();
  const navigate = useNavigate();

  // Post-login return path (used by the MCP OAuth consent screen).
  // Only same-origin relative paths are honoured.
  const nextParam = searchParams.get("next");
  const safeNext =
    nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : null;

  // Auto-advance carousel
  useEffect(() => {
    const timer = setInterval(() => {
      setSlideDirection(1);
      setCurrentSlide((prev) => (prev + 1) % featureSlideRefs.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Pre-fill email from invite and switch to signup mode
  useEffect(() => {
    if (isInvite && inviteEmail) {
      setEmail(decodeURIComponent(inviteEmail));
      setIsLogin(false);
    }
  }, [isInvite, inviteEmail]);

  // Honour signup/trial intent from the landing page CTAs.
  useEffect(() => {
    if (wantsSignup || wantsTrial) setIsLogin(false);
    const plan = searchParams.get("plan");
    if (plan === "starter" || plan === "growth" || plan === "enterprise") {
      try { localStorage.setItem("matbex_trial_plan", plan); } catch { /* ignore */ }
    }
  }, [wantsSignup, wantsTrial, searchParams]);

  useEffect(() => {
    if (user) {
      if (safeNext) {
        window.location.replace(safeNext);
        return;
      }
      // Native: send cashier-only users to POS, owners/managers to dashboard.
      navigate("/dashboard");
    }
  }, [user, navigate, safeNext]);

  const nextSlide = () => {
    setSlideDirection(1);
    setCurrentSlide((prev) => (prev + 1) % featureSlideRefs.length);
  };

  const prevSlide = () => {
    setSlideDirection(-1);
    setCurrentSlide((prev) => (prev - 1 + featureSlideRefs.length) % featureSlideRefs.length);
  };

  const validateForm = () => {
    const schema = isLogin ? loginSchema : signupSchema;
    const data = isLogin ? { email, password } : { email, password, fullName };

    const result = schema.safeParse(data);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.errors.forEach((err) => {
        if (err.path[0]) {
          fieldErrors[err.path[0] as string] = err.message;
        }
      });
      setErrors(fieldErrors);
      return false;
    }
    setErrors({});
    return true;
  };

  const acceptInviteIfNeeded = async () => {
    if (!isInvite || !inviteToken) return false;

    const { error } = await db.functions.invoke("accept-invite", {
      body: { invite_token: inviteToken },
    });

    if (error) throw error;
    return true;
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const emailValidation = z.string().trim().email("Please enter a valid email").safeParse(email);
    if (!emailValidation.success) {
      setErrors({ email: emailValidation.error.errors[0].message });
      return;
    }
    setErrors({});
    setLoading(true);

    try {
      const { error } = await db.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) {
        toast.error(error.message);
      } else {
        setResetEmailSent(true);
        toast.success(t("auth.resetDispatched"));
      }
    } catch (err: any) {
      toast.error(t("auth.resetFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleResendReset = async () => {
    if (resendCooldown > 1 || resendLoading || !email) return;
    setResendLoading(true);
    try {
      const { error } = await db.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) {
        toast.error(error.message);
      } else {
        setResendCooldown(60);
        toast.success(t("auth.resetResent"));
      }
    } catch {
      toast.error(t("auth.resendFailed"));
    } finally {
      setResendLoading(false);
    }
  };

  const resolveAndPair = async (code: string) => {
    setTenantError(null);
    setResolvingTenant(true);
    try {
      const tenant = await resolveTenantCode(code);
      setDeviceTenant(tenant);
      setDeviceTenantState(tenant);
      setTenantCode("");
      toast.success(t("auth.pairedWith", { name: tenant.name }));
    } catch (err: any) {
      setTenantError(err?.message ?? t("auth.tenantNotFound"));
    } finally {
      setResolvingTenant(false);
    }
  };

  const handleResolveTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    await resolveAndPair(tenantCode);
  };

  const handleQrScanned = (raw: string) => {
    // QR may contain a bare slug or a URL that includes the slug.
    let code = raw.trim();
    try {
      const url = new URL(code);
      const qp = url.searchParams.get("code") || url.searchParams.get("tenant");
      if (qp) {
        code = qp;
      } else {
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts.length) code = parts[parts.length - 1];
      }
    } catch {
      /* not a URL — use raw */
    }
    code = code.toLowerCase();
    setTenantCode(code);
    void resolveAndPair(code);
  };

  const handleUnpairDevice = () => {
    clearDeviceTenant();
    setDeviceTenantState(null);
    toast.success(t("auth.deviceUnpaired"));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) return;

    setLoading(true);
    setLockWarning(null);

    try {
      if (isLogin) {
        const lockCheck = await checkAccountLock(email);
        if (lockCheck.blocked) {
          setIsLocked(true);
          setLockWarning(lockCheck.message || t("auth.accountLocked"));
          setLoading(false);
          return;
        }

        const { error } = await signIn(email, password);

        if (error) {
          const result = await trackLoginAttempt(email, false, error.message);

          if (result.blocked) {
            setIsLocked(true);
            setLockWarning(result.message || t("auth.lockedExcessive"));
          } else if (result.remaining_attempts !== undefined && result.remaining_attempts <= 2) {
            setLockWarning(t("auth.attemptsRemaining", { count: result.remaining_attempts }));
          }

          if (error.message.includes("Invalid login")) {
            toast.error(t("auth.invalidLogin"));
          } else {
            toast.error(error.message);
          }
        } else {
          await trackLoginAttempt(email, true);
          setIsLocked(false);
          setLockWarning(null);

          // Native APK: enforce device-tenant binding before letting the user in.
          if (isNative && deviceTenant) {
            const { data: { user: justLoggedIn } } = await db.auth.getUser();
            if (justLoggedIn) {
              const { data: membership } = await db
                .from("user_tenant_roles")
                .select("role")
                .eq("user_id", justLoggedIn.id)
                .eq("tenant_id", deviceTenant.id)
                .maybeSingle();

              if (!membership) {
                await db.auth.signOut();
                setLockWarning(
                  t("auth.notMemberMsg", { name: deviceTenant.name }),
                );
                toast.error(t("auth.accountNotInWorkspace"));
                setLoading(false);
                return;
              }
            }
          }

          toast.success(t("auth.sessionInit"));

          if (safeNext) {
            window.location.replace(safeNext);
            return;
          }

          if (isInvite) {
            try {
              await acceptInviteIfNeeded();
              toast.success(t("auth.teamActivated"));
              window.location.replace("/");
              return;
            } catch (err: any) {
              console.error("Error accepting invitation after login:", err);
              toast.error(t("auth.enrollFailed"));
            }
          }

          const { data: { user: loggedInUser } } = await db.auth.getUser();
          if (loggedInUser) {
            const { data: superAdminData } = await db
              .from("superadmin_users")
              .select("id")
              .eq("user_id", loggedInUser.id)
              .maybeSingle();

            if (superAdminData) {
              navigate("/admin");
            } else {
              const { data: userRoles } = await db
                .from("user_roles")
                .select("role")
                .eq("user_id", loggedInUser.id);
              
              const roles = userRoles?.map(r => r.role) || [];
              const isCashierOnly = roles.includes("cashier") && 
                !roles.includes("manager") && 
                !roles.includes("owner");
              
              if (isCashierOnly) {
                navigate("/record-sale");
              } else if (Capacitor.isNativePlatform()) {
                // Owners/managers on the APK land on the dashboard.
                navigate("/dashboard");
              } else {
                navigate("/dashboard");
              }
            }
          } else {
            navigate("/dashboard");
          }
        }
      } else {
        const { error } = await signUp(email, password, fullName);
        if (error) {
          if (error.message.includes("already registered")) {
            toast.error(t("auth.accountExists"));
            setIsLogin(true);
          } else {
            toast.error(error.message);
          }
        } else {
          if (isInvite) {
            try {
              await acceptInviteIfNeeded();
              toast.success(t("auth.residencyEstablished"));
              window.location.replace("/");
              return;
            } catch (err: any) {
              console.error("Error accepting invitation after signup:", err);
              toast.error(t("auth.accountCreatedAuth"));
              setIsLogin(true);
              return;
            }
          }

          // Demo trial signup → provision a DEMO_ENTERPRISE tenant on the spot.
          if (wantsTrial) {
            try {
              const { error: provErr } = await db.functions.invoke(
                "provision-demo-tenant",
                {},
              );
              if (provErr) throw provErr;
              toast.success(t("auth.demoWelcome"));
              window.location.replace("/dashboard");
              return;
            } catch (err: any) {
              console.error("Demo provisioning failed:", err);
              toast.error(t("auth.demoSeedFailed"));
              navigate("/onboarding");
              return;
            }
          }

          toast.success(t("auth.residencyEstablished"));
          navigate("/onboarding");
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageTransition className="min-h-screen bg-[#F0F2F5] flex flex-col">
      <RouteSeo
        title={t("auth.seoTitle")}
        description={t("auth.seoDescription")}
        noindex
      />
      {/* Common Header (hidden on native APK for minimal welcome) */}
      {!isNative && (
      <header className="w-full bg-white/80 backdrop-blur-sm border-b border-gray-200/50 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link to="/">
              <MatbexLogo size="md" animate={false} />
            </Link>
            <div className="h-6 w-px bg-gray-200" />
            <span className="text-sm font-medium text-gray-700">{t("auth.headerLabel")}</span>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSelector />
            <RegionSelector />
          </div>
        </div>
      </header>
      )}

      {/* Native APK: compact welcome strip in place of the carousel */}
      {isNative && (
        <div className="w-full flex flex-col items-center pt-10 pb-6 px-6 text-center">
          <MatbexLogo size="md" animate={false} />
          <p className="mt-3 text-sm text-gray-500 font-light max-w-xs">
            {t("auth.welcomeNative")}
          </p>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center p-4 md:p-8">
        <div className="w-full max-w-6xl flex flex-col lg:flex-row gap-6 lg:gap-8">
          
          {/* Left Card - Feature Carousel (hidden on native APK) */}
          {!isNative && (
          <motion.div
            variants={cardVariants}
            initial="hidden"
            animate="visible"
            className="hidden lg:flex lg:w-1/2 bg-white rounded-3xl shadow-sm border border-gray-100 p-8 flex-col"
          >
            {/* Lottie Animation Area */}
            <div className="flex-1 flex flex-col items-center justify-center">
              <div className="relative w-full max-w-sm aspect-square">
                <AnimatePresence mode="wait" custom={slideDirection}>
                  <motion.div
                    key={currentSlide}
                    custom={slideDirection}
                    variants={slideVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    className="absolute inset-0 flex items-center justify-center"
                  >
                    <div 
                      className="w-full h-full max-w-[280px] max-h-[280px]"
                      style={{ 
                        filter: 'hue-rotate(185deg) saturate(1.3)',
                      }}
                    >
                      <DotLottiePlayer
                        src={featureSlideRefs[currentSlide].lottieUrl}
                        loop
                        autoplay
                        className="w-full h-full"
                      />
                    </div>
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* Text content */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentSlide}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                  className="text-center mt-8 space-y-3"
                >
                  <h2 className="text-2xl font-medium tracking-tight text-gray-900">
                    {t(featureSlideRefs[currentSlide].titleKey)}
                  </h2>
                  <p className="text-gray-500 font-light max-w-sm mx-auto leading-relaxed">
                    {t(featureSlideRefs[currentSlide].subtitleKey)}
                  </p>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between pt-8 border-t border-gray-100 mt-8">
              <button
                onClick={prevSlide}
                className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 transition-colors font-light"
              >
                <ChevronLeft className="w-4 h-4" />
                {t("app.carousel.previous")}
              </button>
              
              {/* Dots */}
              <div className="flex items-center gap-2">
                {featureSlideRefs.map((_, index) => (
                  <button
                    key={index}
                    onClick={() => {
                      setSlideDirection(index > currentSlide ? 1 : -1);
                      setCurrentSlide(index);
                    }}
                    className={`w-2 h-2 rounded-full transition-all duration-300 ${
                      index === currentSlide
                        ? "w-6 bg-[#00A859]"
                        : "bg-gray-200 hover:bg-gray-300"
                    }`}
                  />
                ))}
              </div>

              <button
                onClick={nextSlide}
                className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 transition-colors font-light"
              >
                {t("app.carousel.next")}
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
          )}

          {/* Right Card - Auth Form */}
          <motion.div
            variants={cardVariants}
            initial="hidden"
            animate="visible"
            transition={{ delay: 0.1 }}
            className={`flex-1 bg-white rounded-3xl shadow-sm border border-gray-100 p-8 lg:p-12 ${isNative ? "max-w-md mx-auto w-full" : "lg:w-1/2"}`}
          >
            {/* Form Content */}
          <div className="space-y-6">
            {isNative && !deviceTenant ? (
              <div className="space-y-2">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-[#00A859]/10 flex items-center justify-center">
                    <KeyRound className="h-5 w-5 text-[#00A859]" />
                  </div>
                </div>
                <h1 className="text-2xl font-medium tracking-tight text-gray-900">
                  {t("auth.pairDevice")}
                </h1>
                <p className="text-gray-500 font-light">
                  {t("auth.pairDeviceSubtitle")}
                </p>
              </div>
            ) : isInvite ? (
              <div className="space-y-2">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-[#00A859]/10 flex items-center justify-center">
                    <Mail className="h-5 w-5 text-[#00A859]" />
                  </div>
                </div>
                <h1 className="text-2xl font-medium tracking-tight text-gray-900">
                  {t("auth.teamInvitation")}
                </h1>
                <p className="text-gray-500 font-light">
                  {t("auth.inviteSubtitle", { role: inviteRole })}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h1 className="text-2xl font-medium tracking-tight text-gray-900">
                    {isForgotPassword 
                      ? t("auth.resetTitle")
                      : isLogin 
                        ? t("auth.welcomeTitle")
                        : t("auth.beginResidency")}
                  </h1>
                  {!isForgotPassword && (
                    <Link
                      to="/register"
                      className="text-sm text-[#00A859] hover:text-[#008a4a] transition-colors font-medium"
                    >
                      {t("auth.startNewBusiness")}
                    </Link>
                  )}
                </div>
                <p className="text-gray-500 font-light">
                  {isForgotPassword
                    ? t("auth.resetSubtitle")
                    : isLogin
                      ? t("auth.loginSubtitle")
                      : t("auth.signupSubtitle")}
                </p>
              </div>
            )}

            {isNative && deviceTenant && (
              <div className="flex items-center justify-between rounded-xl border border-[#00A859]/20 bg-[#00A859]/5 px-4 py-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Building2 className="h-4 w-4 text-[#00A859] shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500 font-light leading-tight">{t("auth.workspace")}</p>
                    <p className="text-sm font-medium text-gray-900 truncate">{deviceTenant.name}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleUnpairDevice}
                  className="text-xs text-[#00A859] hover:text-[#008a4a] font-medium shrink-0"
                >
                  {t("auth.change")}
                </button>
              </div>
            )}

            {lockWarning && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
              >
                <Alert variant={isLocked ? "destructive" : "default"}>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription className="font-light">{lockWarning}</AlertDescription>
                </Alert>
              </motion.div>
            )}

            {isNative && !deviceTenant ? (
              <motion.form
                onSubmit={handleResolveTenant}
                className="space-y-5"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div className="space-y-2">
                  <Label htmlFor="tenant-code" className="text-gray-700 font-normal">{t("auth.tenantCode")}</Label>
                  <Input
                    id="tenant-code"
                    type="text"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder={t("auth.tenantCodePlaceholder")}
                    value={tenantCode}
                    onChange={(e) => setTenantCode(e.target.value)}
                    className={`h-12 bg-gray-50 border-gray-200 rounded-xl focus:border-[#00A859] focus:ring-[#00A859]/20 ${tenantError ? "border-red-400" : ""}`}
                    disabled={resolvingTenant}
                  />
                  {tenantError && (
                    <p className="text-xs text-red-500 font-light">{tenantError}</p>
                  )}
                  <p className="text-xs text-gray-400 font-light">
                    {t("auth.tenantCodeHint")}
                  </p>
                </div>
                <Button
                  type="submit"
                  className="w-full h-12 bg-[#00A859] hover:bg-[#008a4a] text-white font-normal rounded-xl group"
                  disabled={resolvingTenant || !tenantCode.trim()}
                >
                  {resolvingTenant ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      {t("auth.pairButton")}
                      <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </>
                  )}
                </Button>
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-gray-200" />
                  <span className="text-xs text-gray-400 font-light uppercase tracking-wider">
                    {t("common.or", "or")}
                  </span>
                  <div className="h-px flex-1 bg-gray-200" />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setScannerOpen(true)}
                  disabled={resolvingTenant}
                  className="w-full h-12 rounded-xl border-gray-200 font-normal"
                >
                  <QrCode className="mr-2 h-4 w-4" />
                  {t("auth.scanQr", "Scan Workspace QR")}
                </Button>
                <QrScannerDialog
                  open={scannerOpen}
                  onOpenChange={setScannerOpen}
                  onScan={handleQrScanned}
                />
              </motion.form>
            ) : isForgotPassword ? (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-5"
              >
                {resetEmailSent ? (
                  <div className="space-y-6 text-center py-8">
                    <div className="w-16 h-16 rounded-full bg-[#00A859]/10 flex items-center justify-center mx-auto">
                      <Mail className="h-8 w-8 text-[#00A859]" />
                    </div>
                    <div className="space-y-2">
                      <h3 className="font-medium text-gray-900">{t("auth.resetSent")}</h3>
                      <p className="text-sm text-gray-500 font-light">
                        {t("auth.resetSentTo", { email })}
                      </p>
                    </div>
                    <div className="space-y-3">
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full h-12 font-normal rounded-xl"
                        disabled={resendLoading || resendCooldown > 1}
                        onClick={handleResendReset}
                      >
                        {resendLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : resendCooldown > 1 ? (
                          <span className="text-gray-400">{t("auth.resendIn", { seconds: resendCooldown })}</span>
                        ) : (
                          t("auth.resendReset")
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        className="w-full font-normal text-gray-500"
                        onClick={() => {
                          setIsForgotPassword(false);
                          setResetEmailSent(false);
                          setResendCooldown(1);
                        }}
                      >
                        {t("auth.returnToAuth")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleForgotPassword} className="space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="reset-email" className="text-gray-700 font-normal">{t("auth.email")}</Label>
                      <Input
                        id="reset-email"
                        type="email"
                        placeholder={t("auth.emailPlaceholder")}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className={`h-12 bg-gray-50 border-gray-200 rounded-xl focus:border-[#00A859] focus:ring-[#00A859]/20 ${errors.email ? "border-red-400" : ""}`}
                        disabled={loading}
                      />
                      {errors.email && (
                        <p className="text-xs text-red-500 font-light">{errors.email}</p>
                      )}
                    </div>
                    <Button 
                      type="submit" 
                      className="w-full h-12 bg-[#00A859] hover:bg-[#008a4a] text-white font-normal rounded-xl" 
                      disabled={loading}
                    >
                      {loading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        t("auth.dispatchReset")
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="w-full font-normal text-gray-500"
                      onClick={() => {
                        setIsForgotPassword(false);
                        setErrors({});
                      }}
                    >
                      {t("auth.returnToAuth")}
                    </Button>
                  </form>
                )}
              </motion.div>
            ) : (
              <motion.form 
                onSubmit={handleSubmit} 
                className="space-y-5"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                {!isLogin && (
                  <div className="space-y-2">
                    <Label htmlFor="fullName" className="text-gray-700 font-normal">{t("auth.fullName")}</Label>
                    <Input
                      id="fullName"
                      type="text"
                      placeholder={t("auth.fullNamePlaceholder")}
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className={`h-12 bg-gray-50 border-gray-200 rounded-xl focus:border-[#00A859] focus:ring-[#00A859]/20 ${errors.fullName ? "border-red-400" : ""}`}
                      disabled={loading}
                    />
                    {errors.fullName && (
                      <p className="text-xs text-red-500 font-light">{errors.fullName}</p>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="email" className="text-gray-700 font-normal">{t("auth.email")}</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder={t("auth.emailPlaceholder")}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={`h-12 bg-gray-50 border-gray-200 rounded-xl focus:border-[#00A859] focus:ring-[#00A859]/20 ${errors.email ? "border-red-400" : ""}`}
                    disabled={loading}
                  />
                  {errors.email && (
                    <p className="text-xs text-red-500 font-light">{errors.email}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password" className="text-gray-700 font-normal">{t("auth.password")}</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder={t("auth.passwordPlaceholder")}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={`h-12 bg-gray-50 border-gray-200 rounded-xl focus:border-[#00A859] focus:ring-[#00A859]/20 pr-10 ${errors.password ? "border-red-400" : ""}`}
                      disabled={loading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  {errors.password && (
                    <p className="text-xs text-red-500 font-light">{errors.password}</p>
                  )}
                  {isLogin && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          setIsForgotPassword(true);
                          setErrors({});
                          setResetEmailSent(false);
                        }}
                        className="text-sm text-[#00A859] hover:text-[#008a4a] transition-colors font-medium"
                      >
                        {t("auth.resetCredentials")}
                      </button>
                    </div>
                  )}
                </div>

                <Button
                  type="submit"
                  className="w-full h-12 bg-[#00A859] hover:bg-[#008a4a] text-white font-normal rounded-xl group"
                  disabled={loading}
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      {isLogin ? t("auth.authenticate") : t("auth.initResidency")}
                      <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </>
                  )}
                </Button>
              </motion.form>
            )}

            {/* Mobile toggle */}
            {!isForgotPassword && (
              <div className="text-center pt-4 lg:hidden">
                <button
                  type="button"
                  onClick={() => {
                    setIsLogin(!isLogin);
                    setErrors({});
                  }}
                  className="text-sm text-gray-400 hover:text-gray-600 transition-colors font-light"
                >
                  {isLogin
                    ? t("auth.mobileToSignup")
                    : t("auth.mobileToLogin")}
                </button>
              </div>
            )}

            {/* Trust badge */}
            <div className="pt-8 border-t border-gray-100 mt-8">
              <p className="text-xs text-gray-400 font-light text-center">
                {t("auth.trustBadge")}
              </p>
            </div>
          </div>
        </motion.div>
        </div>
      </div>
    </PageTransition>
  );
}
