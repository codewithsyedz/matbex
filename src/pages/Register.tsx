import { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { RouteSeo } from "@/components/seo/RouteSeo";
import { DotLottiePlayer } from "@dotlottie/react-player";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { z } from "zod";
import {
  PlanSelector,
  AddonsStep,
  ContactInfoStep,
  BusinessDetailsStep,
  UnderReviewScreen,
} from "@/components/onboarding";
import { MatbexLogo } from "@/components/brand/MatbexLogo";
import { ArrowLeft, ChevronLeft, ChevronRight, Check, Sparkles, Building2, Rocket, Crown } from "lucide-react";
import { PageTransition } from "@/components/PageTransition";
import { RegionProvider } from "@/contexts/RegionContext";
import { useRegion } from "@/hooks/useRegion";
import { RegionSelector } from "@/components/landing/RegionSelector";
import { LanguageSelector } from "@/components/landing/LanguageSelector";
// Validation schemas
const contactInfoSchema = z.object({
  fullName: z.string().min(2, "register.nameMin"),
  email: z.string().email("register.emailInvalid"),
  country: z.string().min(2, "register.countryRequired"),
});

const businessDetailsSchema = z.object({
  companyName: z.string().min(2, "register.companyRequired"),
  restaurantName: z.string().min(2, "register.restaurantRequired"),
});

type RegistrationStep = "plan" | "addons" | "contact" | "business" | "review";

// Feature slides for branding carousel
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

function RegisterContent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { region, formatPrice } = useRegion();
  const [searchParams] = useSearchParams();
  const [currentStep, setCurrentStep] = useState<RegistrationStep>("plan");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [applicationId, setApplicationId] = useState<string | null>(null);

  // Carousel state
  const [currentSlide, setCurrentSlide] = useState(0);
  const [slideDirection, setSlideDirection] = useState(0);

  // Plan selection state
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [selectedPlanPrice, setSelectedPlanPrice] = useState<number>(0);
  const [selectedPlanName, setSelectedPlanName] = useState<string>("");
  const [selectedPlanFeatures, setSelectedPlanFeatures] = useState<string[]>([]);
  const [billingInterval, setBillingInterval] = useState<"monthly" | "annual">("monthly");

  // Addon selections (Build your plan step)
  const [selectedAddonIds, setSelectedAddonIds] = useState<string[]>([]);

  // Contact info state
  const [contactInfo, setContactInfo] = useState({
    fullName: "",
    email: "",
    phone: "",
    country: "SA",
    referralCode: "",
  });

  // Business details state
  const [businessDetails, setBusinessDetails] = useState({
    companyName: "",
    crNumber: "",
    vatNumber: "",
    crDocumentUrl: "",
    restaurantName: "",
    restaurantType: "",
    estimatedMonthlyRevenue: "",
    locationCount: 1,
  });

  // Auto-advance carousel
  useEffect(() => {
    const timer = setInterval(() => {
      setSlideDirection(1);
      setCurrentSlide((prev) => (prev + 1) % featureSlideRefs.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // Check for existing pending application
  useEffect(() => {
    const checkExistingApplication = async () => {
      const email = searchParams.get("email");
      if (!email) return;

      const { data } = await supabase
        .from("tenant_applications")
        .select("*")
        .eq("email", email)
        .in("status", ["submitted", "pending_approval"])
        .maybeSingle();

      if (data) {
        // Resume document verification if not yet under formal review
        if (data.status === "submitted") {
          navigate(`/application/${data.id}?email=${encodeURIComponent(data.email)}`);
        } else {
          setApplicationId(data.id);
          setContactInfo((prev) => ({ ...prev, email: data.email }));
          setCurrentStep("review");
        }
      }
    };

    checkExistingApplication();
  }, [searchParams]);

  // Plan features mapping
  const planFeaturesMap: Record<string, string[]> = {
    trial: [t("register.featureTrial1"), t("register.featureTrial2"), t("register.featureTrial3"), t("register.featureTrial4")],
    free: ["1 Location", "Basic POS", "Daily Sales Tracking", "Email Support"],
    essentials: ["1 Location", "Full POS Suite", "Daily Profit Tracking", "Team Chat", "Priority Email Support"],
    pro: ["Up to 5 Locations", "Advanced Analytics", "COGS Tracking", "Payroll Module", "Priority Support", "Custom Reports"],
    enterprise: ["Unlimited Locations", "Custom Integrations", "API Access", "Dedicated Account Manager", "SLA Guarantee", "24/7 Phone Support"],
  };

  // Fetch plan details when selected
  useEffect(() => {
    const fetchPlanDetails = async () => {
      if (!selectedPlanId) {
        setSelectedPlanName("");
        setSelectedPlanPrice(0);
        setSelectedPlanFeatures([]);
        return;
      }

      const { data } = await supabase
        .from("plans")
        .select("price, name")
        .eq("id", selectedPlanId)
        .single();

      if (data) {
        setSelectedPlanPrice(data.price);
        setSelectedPlanName(data.name);
        setSelectedPlanFeatures(planFeaturesMap[data.name.toLowerCase()] || []);
      }
    };

    fetchPlanDetails();
  }, [selectedPlanId]);

  const nextSlide = () => {
    setSlideDirection(1);
    setCurrentSlide((prev) => (prev + 1) % featureSlideRefs.length);
  };

  const prevSlide = () => {
    setSlideDirection(-1);
    setCurrentSlide((prev) => (prev - 1 + featureSlideRefs.length) % featureSlideRefs.length);
  };

  const handleContactInfoChange = (field: string, value: string) => {
    setContactInfo((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: "" }));
  };

  const handleBusinessDetailsChange = (field: string, value: string | number) => {
    setBusinessDetails((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: "" }));
  };

  const handlePlanContinue = () => {
    if (!selectedPlanId) {
      toast.error(t("register.selectPlanError"));
      return;
    }
    setCurrentStep("addons");
  };

  const handleContactNext = async () => {
    const result = contactInfoSchema.safeParse(contactInfo);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.errors.forEach((err) => {
        if (err.path[0]) {
          fieldErrors[err.path[0] as string] = t(err.message);
        }
      });
      setErrors(fieldErrors);
      return;
    }

    const { data: existingApp } = await supabase
      .from("tenant_applications")
      .select("id, status")
      .eq("email", contactInfo.email)
      .maybeSingle();

    if (existingApp) {
      if (existingApp.status === "approved") {
        toast.error(t("register.emailApproved"));
        navigate("/auth");
        return;
      }
      if (existingApp.status === "submitted" || existingApp.status === "pending_approval") {
        if (existingApp.status === "submitted") {
          navigate(`/application/${existingApp.id}?email=${encodeURIComponent(contactInfo.email)}`);
          return;
        }
        setApplicationId(existingApp.id);
        setCurrentStep("review");
        return;
      }
    }

    setCurrentStep("business");
  };

  const handleSubmitApplication = async () => {
    const result = businessDetailsSchema.safeParse(businessDetails);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.errors.forEach((err) => {
        if (err.path[0]) {
          fieldErrors[err.path[0] as string] = t(err.message);
        }
      });
      setErrors(fieldErrors);
      return;
    }

    setLoading(true);

    try {
      const { data: rpcResult, error } = await (supabase as any).rpc("submit_tenant_application", {
        payload: {
          full_name: contactInfo.fullName,
          email: contactInfo.email,
          phone: contactInfo.phone || null,
          country: contactInfo.country,
          referral_code: contactInfo.referralCode || null,
          company_name: businessDetails.companyName,
          cr_number: businessDetails.crNumber || null,
          vat_number: businessDetails.vatNumber || null,
          cr_document_url: businessDetails.crDocumentUrl || null,
          restaurant_name: businessDetails.restaurantName,
          restaurant_type: businessDetails.restaurantType || null,
          estimated_monthly_revenue: businessDetails.estimatedMonthlyRevenue || null,
          location_count: businessDetails.locationCount,
          plan_id: selectedPlanId || null,
          billing_interval: billingInterval,
          selected_addon_ids: selectedAddonIds,
        },
      });

      if (error) throw error;

      const appId: string = rpcResult?.id;
      const appStatus: string = rpcResult?.status;

      if (appStatus === "approved") {
        toast.error(t("register.emailApproved"));
        navigate("/auth");
        return;
      }

      setApplicationId(appId);
      toast.success(t("register.submitSuccess"));
      // Send applicant straight into the document verification wizard
      navigate(`/application/${appId}?email=${encodeURIComponent(contactInfo.email)}`);
    } catch (error: any) {
      console.error("Error submitting application:", error);
      toast.error(error.message || t("register.submitFailed"));
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => {
    if (currentStep === "addons") {
      setCurrentStep("plan");
    } else if (currentStep === "contact") {
      setCurrentStep("addons");
    } else if (currentStep === "business") {
      setCurrentStep("contact");
    }
  };

  // Progress indicator
  const getProgress = () => {
    switch (currentStep) {
      case "plan": return 20;
      case "addons": return 40;
      case "contact": return 60;
      case "business": return 80;
      case "review": return 100;
      default: return 0;
    }
  };

  // Show review screen if application is submitted
  if (currentStep === "review") {
    return (
      <UnderReviewScreen
        email={contactInfo.email}
        applicationId={applicationId || undefined}
      />
    );
  }

  return (
    <PageTransition className="min-h-screen bg-[#F0F2F5] flex flex-col">
      <RouteSeo
        title={t("register.seoTitle")}
        description={t("register.seoDescription")}
      />
      {/* Sticky Header */}
      <header className="w-full bg-white/80 backdrop-blur-md border-b border-gray-100 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link to="/">
              <MatbexLogo size="md" animate={false} />
            </Link>
            <div className="h-6 w-px bg-gray-200" />
            <span className="text-sm font-medium text-gray-700">{t("register.headerLabel")}</span>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSelector />
            <RegionSelector />
          </div>
        </div>
      </header>

      {/* Progress Bar */}
      <div className="fixed top-16 left-0 right-0 h-1 bg-gray-200 z-50">
        <motion.div
          className="h-full bg-[#00A859]"
          initial={{ width: 0 }}
          animate={{ width: `${getProgress()}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>

      <div className="flex-1 flex items-center justify-center p-4 md:p-8 pt-8">
        <div className="w-full max-w-6xl flex flex-col lg:flex-row gap-6 lg:gap-8">
        <motion.div
          variants={cardVariants}
          initial="hidden"
          animate="visible"
          className="hidden lg:flex lg:w-1/2 bg-white rounded-3xl shadow-sm border border-gray-100 p-8 flex-col"
        >
          <AnimatePresence mode="wait">
            {selectedPlanId && selectedPlanName ? (
              /* Selected Plan Details */
              <motion.div
                key="plan-details"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="flex-1 flex flex-col items-center justify-center"
              >
                {/* Selected Plan Badge */}
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#00A859]/20 bg-white text-[#00A859] text-sm font-medium mb-8">
                  <Sparkles className="w-4 h-4" />
                  {t("register.selectedPlanBadge")}
                </div>

                {/* Plan Icon */}
                <motion.div 
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.1, duration: 0.4 }}
                  className="w-24 h-24 rounded-2xl bg-[#00A859]/5 border border-[#00A859]/10 flex items-center justify-center mb-6"
                >
                  {selectedPlanName.toLowerCase() === 'enterprise' ? (
                    <Crown className="w-12 h-12 text-[#00A859]" />
                  ) : selectedPlanName.toLowerCase() === 'pro' ? (
                    <Rocket className="w-12 h-12 text-[#00A859]" />
                  ) : (
                    <Building2 className="w-12 h-12 text-[#00A859]" />
                  )}
                </motion.div>

                {/* Plan Name */}
                <h2 className="text-2xl font-semibold tracking-tight text-gray-900 capitalize mb-2">
                  {selectedPlanName}
                </h2>

                {/* Price Display */}
                <div className="flex items-baseline gap-1 mb-2">
                  {region.code === "SA" || region.code === "AE" ? (
                    <>
                      <span className="text-5xl font-light text-gray-900">
                        {formatPrice(billingInterval === "annual" ? Math.round(selectedPlanPrice * 12 * 0.83) : selectedPlanPrice, false)}
                      </span>
                      <span className="text-2xl font-light text-gray-900">{region.currencySymbol}</span>
                    </>
                  ) : (
                    <span className="text-5xl font-light text-gray-900">
                      {region.currencySymbol}{formatPrice(billingInterval === "annual" ? Math.round(selectedPlanPrice * 12 * 0.83) : selectedPlanPrice, false)}
                    </span>
                  )}
                  <span className="text-gray-500 text-base ml-1">
                    /{billingInterval === "annual" ? t("register.perYear") : t("register.perMonth")}
                  </span>
                </div>

                {billingInterval === "annual" && (
                  <p className="text-xs text-[#00A859] font-medium mb-8">
                    {t("register.saveAnnual")}
                  </p>
                )}

                {/* Divider */}
                <div className="w-full max-w-xs border-t border-gray-100 my-6" />

                {/* What's Included Section */}
                <div className="w-full max-w-xs">
                  <p className="text-xs uppercase tracking-widest text-gray-400 font-medium mb-5 text-left">
                    {t("register.whatsIncluded")}
                  </p>
                  <div className="space-y-4">
                    {selectedPlanFeatures.map((feature, index) => (
                      <motion.div
                        key={feature}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.2 + index * 0.05 }}
                        className="flex items-center gap-3"
                      >
                        <div className="w-6 h-6 rounded-full bg-[#00A859]/10 flex items-center justify-center flex-shrink-0">
                          <Check className="w-3.5 h-3.5 text-[#00A859]" />
                        </div>
                        <span className="text-sm text-gray-700 font-light">{feature}</span>
                      </motion.div>
                    ))}
                  </div>
                </div>

                {/* Change Plan Button - at bottom */}
                <div className="mt-auto pt-8 w-full max-w-xs">
                  <button
                    onClick={() => setCurrentStep("plan")}
                    className="w-full py-3 rounded-xl text-sm font-medium border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
                  >
                    {t("register.changePlan")}
                  </button>
                </div>
              </motion.div>
            ) : (
              /* Branding Carousel */
              <motion.div
                key="carousel"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
                className="flex-1 flex flex-col"
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
                          style={{ filter: 'hue-rotate(185deg) saturate(1.3)' }}
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
          </AnimatePresence>
        </motion.div>

        {/* Right Card - Form Content */}
        <motion.div
          variants={cardVariants}
          initial="hidden"
          animate="visible"
          transition={{ delay: 0.1 }}
          className="flex-1 lg:w-1/2 bg-white rounded-3xl shadow-sm border border-gray-100 p-8 lg:p-12"
        >
          {/* Header */}
          <div className="space-y-2 mb-8">
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-medium tracking-tight text-gray-900">
                {currentStep === "plan" 
                  ? t("register.selectPlan")
                  : currentStep === "contact" 
                    ? t("register.contactInfo")
                    : t("register.businessDetails")}
              </h1>
              <Link
                to="/auth"
                className="text-sm text-[#00A859] hover:text-[#008a4a] transition-colors font-medium"
              >
                {t("register.signIn")}
              </Link>
            </div>
            <p className="text-gray-500 font-light">
              {currentStep === "plan" 
                ? t("register.selectPlanSubtitle")
                : currentStep === "contact" 
                  ? t("register.contactSubtitle")
                  : t("register.businessSubtitle")}
            </p>
            {currentStep !== "plan" && (
              <button
                onClick={goBack}
                className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors mt-4"
              >
                <ArrowLeft className="w-4 h-4" />
                {t("register.back")}
              </button>
            )}
          </div>

          {/* Form Content */}
          <div className="space-y-6">
            <AnimatePresence mode="wait">
              {currentStep === "plan" && (
                <motion.div
                  key="plan"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  <PlanSelector
                    selectedPlan={selectedPlanId}
                    billingInterval={billingInterval}
                    onPlanSelect={setSelectedPlanId}
                    onIntervalChange={setBillingInterval}
                    onContinue={handlePlanContinue}
                  />
                </motion.div>
              )}

              {currentStep === "addons" && (
                <motion.div
                  key="addons"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  <AddonsStep
                    selectedAddonIds={selectedAddonIds}
                    onChange={setSelectedAddonIds}
                    onContinue={() => setCurrentStep("contact")}
                    onBack={() => setCurrentStep("plan")}
                    billingInterval={billingInterval}
                    basePlanPrice={selectedPlanPrice}
                  />
                </motion.div>
              )}

              {currentStep === "contact" && (
                <motion.div
                  key="contact"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  <ContactInfoStep
                    formData={contactInfo}
                    onChange={handleContactInfoChange}
                    onNext={handleContactNext}
                    loading={loading}
                    errors={errors}
                    selectedPlanPrice={selectedPlanPrice}
                    billingInterval={billingInterval}
                  />
                </motion.div>
              )}

              {currentStep === "business" && (
                <motion.div
                  key="business"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  <BusinessDetailsStep
                    formData={businessDetails}
                    onChange={handleBusinessDetailsChange}
                    onSubmit={handleSubmitApplication}
                    loading={loading}
                    errors={errors}
                    selectedPlanPrice={selectedPlanPrice}
                    billingInterval={billingInterval}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
        </div>
      </div>
    </PageTransition>
  );
}

export default function Register() {
  return (
    <RegionProvider>
      <RegisterContent />
    </RegionProvider>
  );
}
