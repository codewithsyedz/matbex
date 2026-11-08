import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowRight, User, Mail, Phone, MapPin, Gift, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRegion } from "@/hooks/useRegion";

interface ContactInfoStepProps {
  formData: {
    fullName: string;
    email: string;
    phone: string;
    country: string;
    referralCode: string;
  };
  onChange: (field: string, value: string) => void;
  onNext: () => void;
  loading: boolean;
  errors: Record<string, string>;
  selectedPlanPrice?: number;
  billingInterval?: "monthly" | "annual";
}

const countries = [
  { code: "SA", name: "Saudi Arabia" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "KW", name: "Kuwait" },
  { code: "QA", name: "Qatar" },
  { code: "BH", name: "Bahrain" },
  { code: "OM", name: "Oman" },
  { code: "EG", name: "Egypt" },
  { code: "JO", name: "Jordan" },
  { code: "LB", name: "Lebanon" },
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
];

export function ContactInfoStep({
  formData,
  onChange,
  onNext,
  loading,
  errors,
  selectedPlanPrice = 0,
  billingInterval = "monthly",
}: ContactInfoStepProps) {
  const { t } = useTranslation();
  const { region, formatPrice } = useRegion();
  const displayPrice = billingInterval === "annual" 
    ? Math.round(selectedPlanPrice * 12 * 0.83) 
    : selectedPlanPrice;
  
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-2xl font-medium tracking-tight text-gray-900">
          {t("register.contact.title")}
        </h1>
        <p className="text-gray-500 font-light">
          {t("register.contact.subtitle")}
        </p>
      </div>

      {/* Package Info Card */}
      <div className="p-4 rounded-xl border-2 border-[#00A859]/30 bg-[#00A859]/5">
        <p className="text-xs font-medium text-[#00A859] uppercase tracking-wider mb-1">
          {t("register.contact.packageSelected")}
        </p>
        <p className="text-2xl font-light text-gray-900">
          {region.code === "SA" || region.code === "AE" ? (
            <>{formatPrice(displayPrice, false)} {region.currencySymbol}</>
          ) : (
            <>{region.currencySymbol}{formatPrice(displayPrice, false)}</>
          )}
          <span className="text-sm text-gray-500 font-normal">/{billingInterval === "annual" ? t("register.plans.perYearShort") : t("register.plans.perMonthShort")}</span>
        </p>
      </div>

      {/* Form Fields */}
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="fullName" className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <User className="w-4 h-4 text-gray-400" />
            {t("register.contact.fullName")}
          </Label>
          <Input
            id="fullName"
            value={formData.fullName}
            onChange={(e) => onChange("fullName", e.target.value)}
            placeholder={t("register.contact.fullNamePlaceholder")}
            className={cn(
              "h-12 rounded-xl border-gray-200 focus:border-[#00A859] focus:ring-[#00A859]/20",
              errors.fullName && "border-red-300 focus:border-red-500 focus:ring-red-200"
            )}
          />
          {errors.fullName && (
            <p className="text-xs text-red-500">{errors.fullName}</p>
          )}
        </div>

        {/* Email */}
        <div className="space-y-2">
          <Label htmlFor="email" className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <Mail className="w-4 h-4 text-gray-400" />
            {t("register.contact.workEmail")}
          </Label>
          <Input
            id="email"
            type="email"
            value={formData.email}
            onChange={(e) => onChange("email", e.target.value)}
            placeholder={t("register.contact.emailPlaceholder")}
            className={cn(
              "h-12 rounded-xl border-gray-200 focus:border-[#00A859] focus:ring-[#00A859]/20",
              errors.email && "border-red-300 focus:border-red-500 focus:ring-red-200"
            )}
          />
          {errors.email && (
            <p className="text-xs text-red-500">{errors.email}</p>
          )}
        </div>

        {/* Phone */}
        <div className="space-y-2">
          <Label htmlFor="phone" className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <Phone className="w-4 h-4 text-gray-400" />
            {t("register.contact.phoneNumber")}
          </Label>
          <Input
            id="phone"
            type="tel"
            value={formData.phone}
            onChange={(e) => onChange("phone", e.target.value)}
            placeholder={t("register.contact.phonePlaceholder")}
            className="h-12 rounded-xl border-gray-200 focus:border-[#00A859] focus:ring-[#00A859]/20"
          />
        </div>

        {/* Country */}
        <div className="space-y-2">
          <Label htmlFor="country" className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-gray-400" />
            {t("register.contact.country")}
          </Label>
          <Select value={formData.country} onValueChange={(v) => onChange("country", v)}>
            <SelectTrigger className={cn(
              "h-12 rounded-xl border-gray-200 focus:border-[#00A859] focus:ring-[#00A859]/20",
              errors.country && "border-red-300"
            )}>
              <SelectValue placeholder={t("register.contact.selectCountry")} />
            </SelectTrigger>
            <SelectContent>
              {countries.map((country) => (
                <SelectItem key={country.code} value={country.code}>
                  {country.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.country && (
            <p className="text-xs text-red-500">{errors.country}</p>
          )}
        </div>

        {/* Referral Code */}
        <div className="space-y-2">
          <Label htmlFor="referralCode" className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <Gift className="w-4 h-4 text-gray-400" />
            {t("register.contact.referralCode")}
            <span className="text-xs text-gray-400 font-normal">{t("register.contact.optional")}</span>
          </Label>
          <Input
            id="referralCode"
            value={formData.referralCode}
            onChange={(e) => onChange("referralCode", e.target.value)}
            placeholder={t("register.contact.referralPlaceholder")}
            className="h-12 rounded-xl border-gray-200 focus:border-[#00A859] focus:ring-[#00A859]/20"
          />
        </div>
      </div>

      {/* Continue Button */}
      <button
        onClick={onNext}
        disabled={loading}
        className="w-full py-3.5 rounded-xl text-sm font-medium bg-[#00A859] text-white hover:bg-[#008a4a] transition-all duration-300 flex items-center justify-center gap-2 shadow-lg shadow-[#00A859]/25 disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <>
            {t("register.contact.nextContinue")}
            <ArrowRight className="w-4 h-4" />
          </>
        )}
      </button>
    </motion.div>
  );
}
