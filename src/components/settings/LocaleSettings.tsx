import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Languages, Globe } from "lucide-react";
import { SUPPORTED_LANGUAGES, useLanguage } from "@/hooks/useLanguage";
import { useRegion, SUPPORTED_REGIONS } from "@/hooks/useRegion";

export function LocaleSettings() {
  const { t } = useTranslation();
  const { language, setLanguage, isRTL } = useLanguage();
  const { region, setRegion } = useRegion();

  return (
    <div className="space-y-6">
      {/* Language Settings */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Languages className="h-5 w-5" />
            {t("settings.language")}
          </CardTitle>
          <CardDescription>
            Choose your preferred language for the interface
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={language}
            onValueChange={(value) => setLanguage(value as "en" | "ar")}
            className="space-y-3"
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <div
                key={lang.code}
                className="flex items-center space-x-3 rtl:space-x-reverse"
              >
                <RadioGroupItem value={lang.code} id={`lang-${lang.code}`} />
                <Label
                  htmlFor={`lang-${lang.code}`}
                  className="flex items-center gap-3 cursor-pointer"
                >
                  <span className="text-lg">{lang.flag}</span>
                  <span>{lang.name}</span>
                  {lang.dir === "rtl" && (
                    <span className="text-xs text-muted-foreground">(RTL)</span>
                  )}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      {/* Region Settings */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Globe className="h-5 w-5" />
            {t("settings.region")}
          </CardTitle>
          <CardDescription>
            Set your region for currency and formatting preferences
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={region.code}
            onValueChange={setRegion}
            className="space-y-3"
          >
            {SUPPORTED_REGIONS.map((r) => (
              <div
                key={r.code}
                className="flex items-center space-x-3 rtl:space-x-reverse"
              >
                <RadioGroupItem value={r.code} id={`region-${r.code}`} />
                <Label
                  htmlFor={`region-${r.code}`}
                  className="flex items-center gap-3 cursor-pointer"
                >
                  <span className="text-lg">{r.flag}</span>
                  <div className="flex flex-col">
                    <span>{r.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {r.currency} ({r.currencySymbol})
                    </span>
                  </div>
                </Label>
              </div>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>
    </div>
  );
}
