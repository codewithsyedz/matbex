import { useState, useRef } from "react";
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
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Building2,
  FileText,
  Upload,
  Store,
  MapPin,
  DollarSign,
  CheckCircle2,
  X,
  Loader2,
  Send,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useRegion } from "@/hooks/useRegion";
import { OptimizedLottie } from "@/components/performance/OptimizedLottie";

interface BusinessDetailsStepProps {
  formData: {
    companyName: string;
    crNumber: string;
    vatNumber: string;
    crDocumentUrl: string;
    restaurantName: string;
    restaurantType: string;
    estimatedMonthlyRevenue: string;
    locationCount: number;
  };
  onChange: (field: string, value: string | number) => void;
  onSubmit: () => void;
  loading: boolean;
  errors: Record<string, string>;
  selectedPlanPrice?: number;
  billingInterval?: "monthly" | "annual";
}

const restaurantTypeValues = ["fine_dining", "qsr", "cafe", "dark_kitchen", "casual_dining", "buffet"];
const revenueRangeKeys: { value: string; key: string }[] = [
  { value: "0-50k", key: "under" },
  { value: "50k-100k", key: "r1" },
  { value: "100k-250k", key: "r2" },
  { value: "250k-500k", key: "r3" },
  { value: "500k+", key: "over" },
];

export function BusinessDetailsStep({
  formData,
  onChange,
  onSubmit,
  loading,
  errors,
  selectedPlanPrice = 0,
  billingInterval = "monthly",
}: BusinessDetailsStepProps) {
  const { t } = useTranslation();
  const { region } = useRegion();
  const revenueRanges = revenueRangeKeys.map((r) => ({
    value: r.value,
    label: t(`register.business.revenue.${r.key}`, { symbol: region.currencySymbol }),
  }));
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];
    if (!validTypes.includes(file.type)) {
      toast.error(t("register.business.uploadInvalidType"));
      return;
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      toast.error(t("register.business.uploadTooLarge"));
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `cr_${Date.now()}.${fileExt}`;
      const filePath = `applications/${fileName}`;

      // Simulate progress
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => Math.min(prev + 10, 90));
      }, 100);

      const { error } = await supabase.storage
        .from("onboarding-documents")
        .upload(filePath, file);

      clearInterval(progressInterval);

      if (error) throw error;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from("onboarding-documents")
        .getPublicUrl(filePath);

      onChange("crDocumentUrl", urlData.publicUrl);
      setUploadProgress(100);
      toast.success(t("register.business.uploadSuccess"));
    } catch (error: any) {
      console.error("Upload error:", error);
      toast.error(t("register.business.uploadFailed"));
    } finally {
      setUploading(false);
    }
  };

  const removeDocument = () => {
    onChange("crDocumentUrl", "");
    setUploadProgress(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const displayPrice = billingInterval === "annual" 
    ? Math.round(selectedPlanPrice * 12 * 0.83) 
    : selectedPlanPrice;

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-6 max-h-[70vh] overflow-y-auto pr-2"
    >
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-2xl font-medium tracking-tight text-gray-900">
          {t("register.business.title")}
        </h1>
        <p className="text-gray-500 font-light">
          {t("register.business.subtitle")}
        </p>
      </div>

      {/* Form Fields */}
      <div className="space-y-4">
        {/* Company Name */}
        <div className="space-y-2">
          <Label htmlFor="companyName" className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-gray-400" />
            {t("register.business.companyName")}
          </Label>
          <Input
            id="companyName"
            value={formData.companyName}
            onChange={(e) => onChange("companyName", e.target.value)}
            placeholder={t("register.business.companyNamePlaceholder")}
            className={cn(
              "h-12 rounded-xl border-gray-200 focus:border-[#00A859] focus:ring-[#00A859]/20",
              errors.companyName && "border-red-300 focus:border-red-500 focus:ring-red-200"
            )}
          />
          {errors.companyName && (
            <p className="text-xs text-red-500">{errors.companyName}</p>
          )}
        </div>

        {/* CR Number */}
        <div className="space-y-2">
          <Label htmlFor="crNumber" className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <FileText className="w-4 h-4 text-gray-400" />
            {t("register.business.crNumber")}
            <span className="text-xs text-gray-400 font-normal">{t("register.business.optional")}</span>
          </Label>
          <Input
            id="crNumber"
            value={formData.crNumber}
            onChange={(e) => onChange("crNumber", e.target.value)}
            placeholder={t("register.business.crNumberPlaceholder")}
            className="h-12 rounded-xl border-gray-200 focus:border-[#00A859] focus:ring-[#00A859]/20"
          />
        </div>

        {/* VAT Number */}
        <div className="space-y-2">
          <Label htmlFor="vatNumber" className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <FileText className="w-4 h-4 text-gray-400" />
            {t("register.business.vatNumber")}
            <span className="text-xs text-gray-400 font-normal">{t("register.business.optional")}</span>
          </Label>
          <Input
            id="vatNumber"
            value={formData.vatNumber}
            onChange={(e) => onChange("vatNumber", e.target.value)}
            placeholder={t("register.business.vatNumberPlaceholder")}
            className="h-12 rounded-xl border-gray-200 focus:border-[#00A859] focus:ring-[#00A859]/20"
          />
        </div>

        {/* Document Upload */}
        <div className="space-y-2">
          <Label className="text-sm flex items-center gap-2">
            <FileText className="w-3.5 h-3.5" />
            {t("register.business.crDocument")}
          </Label>

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={handleFileUpload}
            className="hidden"
          />

          {formData.crDocumentUrl ? (
            <div className="relative bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">{t("register.business.documentUploaded")}</p>
                <p className="text-xs text-muted-foreground">{t("register.business.documentDesc")}</p>
              </div>
              <button
                type="button"
                onClick={removeDocument}
                className="p-1 hover:bg-red-100 rounded-full transition-colors"
              >
                <X className="w-4 h-4 text-red-500" />
              </button>
            </div>
          ) : (
            <div
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "relative border-2 border-dashed rounded-xl p-8 cursor-pointer transition-all",
                "hover:border-emerald-300 hover:bg-emerald-50/30",
                uploading ? "border-emerald-400 bg-emerald-50/50" : "border-gray-200",
                errors.crDocumentUrl && "border-red-300"
              )}
            >
              {uploading ? (
                <div className="flex flex-col items-center">
                  <div className="w-16 h-16 mb-2">
                    <OptimizedLottie
                      src="https://assets3.lottiefiles.com/packages/lf20_usmfx6bp.json"
                      loop
                      autoplay
                      className="w-full h-full"
                    />
                  </div>
                  <p className="text-sm text-emerald-600 font-medium">
                    {t("register.business.scanning")} {uploadProgress}%
                  </p>
                  <div className="w-full max-w-xs h-1.5 bg-gray-100 rounded-full mt-2 overflow-hidden">
                    <motion.div
                      className="h-full bg-emerald-500 rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center text-center">
                  <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                    <Upload className="w-5 h-5 text-gray-400" />
                  </div>
                  <p className="text-sm font-medium text-gray-700 mb-1">
                    {t("register.business.dragDrop")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("register.business.fileTypes")}
                  </p>
                </div>
              )}
            </div>
          )}
          {errors.crDocumentUrl && (
            <p className="text-xs text-red-500">{errors.crDocumentUrl}</p>
          )}
        </div>

        {/* Restaurant Name */}
        <div className="space-y-2">
          <Label htmlFor="restaurantName" className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <Store className="w-4 h-4 text-gray-400" />
            {t("register.business.restaurantName")}
          </Label>
          <Input
            id="restaurantName"
            value={formData.restaurantName}
            onChange={(e) => onChange("restaurantName", e.target.value)}
            placeholder={t("register.business.restaurantNamePlaceholder")}
            className={cn(
              "h-12 rounded-xl border-gray-200 focus:border-[#00A859] focus:ring-[#00A859]/20",
              errors.restaurantName && "border-red-300 focus:border-red-500 focus:ring-red-200"
            )}
          />
          {errors.restaurantName && (
            <p className="text-xs text-red-500">{errors.restaurantName}</p>
          )}
        </div>

        {/* Restaurant Type */}
        <div className="space-y-2">
          <Label className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <Store className="w-4 h-4 text-gray-400" />
            {t("register.business.restaurantType")}
          </Label>
          <Select
            value={formData.restaurantType}
            onValueChange={(v) => onChange("restaurantType", v)}
          >
            <SelectTrigger className="h-12 rounded-xl border-gray-200 focus:border-[#00A859] focus:ring-[#00A859]/20">
              <SelectValue placeholder={t("register.business.selectType")} />
            </SelectTrigger>
            <SelectContent>
              {restaurantTypeValues.map((v) => (
                <SelectItem key={v} value={v}>
                  {t(`register.business.types.${v}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Estimated Monthly Revenue */}
        <div className="space-y-2">
          <Label className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-gray-400" />
            {t("register.business.estimatedRevenue")}
          </Label>
          <Select
            value={formData.estimatedMonthlyRevenue}
            onValueChange={(v) => onChange("estimatedMonthlyRevenue", v)}
          >
            <SelectTrigger className="h-12 rounded-xl border-gray-200 focus:border-[#00A859] focus:ring-[#00A859]/20">
              <SelectValue placeholder={t("register.business.selectRange")} />
            </SelectTrigger>
            <SelectContent>
              {revenueRanges.map((range) => (
                <SelectItem key={range.value} value={range.value}>
                  {range.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Location Count */}
        <div className="space-y-2">
          <Label className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-gray-400" />
            {t("register.business.locations")}
          </Label>
          <Select
            value={formData.locationCount.toString()}
            onValueChange={(v) => onChange("locationCount", parseInt(v))}
          >
            <SelectTrigger className="h-12 rounded-xl border-gray-200 focus:border-[#00A859] focus:ring-[#00A859]/20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">{t("register.business.locationOptions.single")}</SelectItem>
              <SelectItem value="2">{t("register.business.locationOptions.two")}</SelectItem>
              <SelectItem value="3">{t("register.business.locationOptions.threeFive")}</SelectItem>
              <SelectItem value="6">{t("register.business.locationOptions.sixTen")}</SelectItem>
              <SelectItem value="11">{t("register.business.locationOptions.tenPlus")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Submit Button */}
      <button
        onClick={onSubmit}
        disabled={loading}
        className="w-full py-3.5 rounded-xl text-sm font-medium bg-[#00A859] text-white hover:bg-[#008a4a] transition-all duration-300 flex items-center justify-center gap-2 shadow-lg shadow-[#00A859]/25 disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <>
            <Send className="w-4 h-4" />
            {t("register.business.submitReview")}
          </>
        )}
      </button>

      {/* Note */}
      <p className="text-center text-xs text-gray-400 font-light">
        {t("register.business.reviewNote")}
      </p>
    </motion.div>
  );
}
