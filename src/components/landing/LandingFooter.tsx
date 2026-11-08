import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLocaleText } from "@/hooks/useLocaleText";
import { MatbexLogo } from "@/components/brand/MatbexLogo";
import { SaudiMadeBadge } from "@/components/landing/SaudiMadeBadge";
import { useEnabledFooterLinks, FooterLink } from "@/hooks/useFooterLinks";
import { Skeleton } from "@/components/ui/skeleton";
import { useLanguage } from "@/hooks/useLanguage";
import { CONTACT } from "@/data/contact";
import { Mail, MapPin, Phone } from "lucide-react";

export const LandingFooter = () => {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const homePath = language === "ar" ? "/ar" : "/";
  const tt = useLocaleText();
  const { data: links, isLoading } = useEnabledFooterLinks();

  const groupedLinks = links?.reduce((acc, link) => {
    if (!acc[link.category]) acc[link.category] = [];
    acc[link.category].push(link);
    return acc;
  }, {} as Record<string, FooterLink[]>) || {};

  const renderLinks = (category: string) => {
    const categoryLinks = groupedLinks[category] || [];
    
    if (isLoading) {
      return (
        <ul className="space-y-1">
          {[1, 2, 3].map((i) => (
            <li key={i}>
              <Skeleton className="h-4 w-20" />
            </li>
          ))}
        </ul>
      );
    }

    if (categoryLinks.length === 0) return null;

    return (
      <ul className="space-y-1">
        {categoryLinks.map((link) => (
          <li key={link.id}>
            <Link
              to={link.link_href}
              className="inline-flex items-center min-h-11 min-w-11 text-sm text-gray-500 hover:text-gray-900 transition-colors font-light"
            >
              {tt(`landing.footer.links.${link.link_key}`, link.link_label)}
            </Link>
          </li>
        ))}
      </ul>
    );
  };

  const hasCategory = (category: string) => {
    if (isLoading) return true;
    return (groupedLinks[category] || []).length > 0;
  };

  return (
    <footer className="bg-white border-t border-gray-200">
      <div className="max-w-7xl mx-auto px-6 lg:px-8 py-10">
        <div className="flex flex-col gap-8">
          {/* Main Row: Logo left, Links right */}
          <div className="flex flex-col md:flex-row md:justify-between gap-8">
            {/* Brand */}
            <div className="md:w-1/3">
              <Link to={homePath} className="inline-flex items-center min-h-11 mb-3">
                <MatbexLogo size="md" animate={false} variant="dark" />
              </Link>
              <p className="text-sm text-gray-600 leading-relaxed max-w-xs">
                {t("landing.footer.tagline")}
              </p>
              <div className="mt-4">
                <SaudiMadeBadge variant="full" />
              </div>
              <ul className="mt-4 space-y-1.5">
                <li>
                  <a
                    href={`mailto:${CONTACT.email}`}
                    className="inline-flex items-center gap-2 min-h-11 text-sm text-gray-600 hover:text-gray-900 transition-colors font-light"
                  >
                    <Mail className="w-3.5 h-3.5 text-[#00A859]" aria-hidden />
                    {CONTACT.email}
                  </a>
                </li>
                {CONTACT.phone && (
                  <li>
                    <a
                      href={`tel:${CONTACT.phone.replace(/\s+/g, "")}`}
                      className="inline-flex items-center gap-2 min-h-11 text-sm text-gray-600 hover:text-gray-900 transition-colors font-light"
                    >
                      <Phone className="w-3.5 h-3.5 text-[#00A859]" aria-hidden />
                      {CONTACT.phone}
                    </a>
                  </li>
                )}
                <li>
                  <span className="inline-flex items-center gap-2 min-h-11 text-sm text-gray-600 font-light">
                    <MapPin className="w-3.5 h-3.5 text-[#00A859]" aria-hidden />
                    {CONTACT.address}
                  </span>
                </li>
              </ul>
            </div>

            {/* Link Columns */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 md:w-2/3 md:justify-items-end">
              {hasCategory("product") && (
                <div>
                  <p className="text-xs font-semibold text-foreground uppercase tracking-wider mb-4">{t("landing.footer.product")}</p>
                  {renderLinks("product")}
                </div>
              )}
              {hasCategory("company") && (
                <div>
                  <p className="text-xs font-semibold text-foreground uppercase tracking-wider mb-4">{t("landing.footer.company")}</p>
                  {renderLinks("company")}
                </div>
              )}
              {hasCategory("resources") && (
                <div>
                  <p className="text-xs font-semibold text-foreground uppercase tracking-wider mb-4">{t("landing.footer.resources")}</p>
                  {renderLinks("resources")}
                </div>
              )}
              {hasCategory("legal") && (
                <div>
                  <p className="text-xs font-semibold text-foreground uppercase tracking-wider mb-4">{t("landing.footer.legal")}</p>
                  {renderLinks("legal")}
                </div>
              )}
            </div>
          </div>

          {/* Bottom Bar */}
          <div className="pt-6 border-t border-gray-200 w-full flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
            <p className="text-xs text-gray-600">
              {t("landing.footer.copyright")}
            </p>
            <p className="text-xs text-gray-600">
              {t("landing.footer.subBrand")}
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
};
