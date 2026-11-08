import { useCMSPage } from "@/hooks/useCMSPages";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { CMSBlockRenderer } from "./CMSBlockRenderer";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { Skeleton } from "@/components/ui/skeleton";
import { RouteSeo } from "@/components/seo/RouteSeo";
import { useTranslation } from "react-i18next";
import { pickLocaleConfig } from "@/lib/cmsLocale";

interface DynamicCMSPageProps {
  slug: string;
  fallback?: React.ReactNode;
  beforeContent?: React.ReactNode;
  afterContent?: React.ReactNode;
  /** Unique fallback SEO title used when the CMS entry has none. */
  seoTitle?: string;
  /** Unique fallback meta/og description (≥ 50 chars) used when the CMS entry has none. */
  seoDescription?: string;
}

export function DynamicCMSPage({ slug, fallback, beforeContent, afterContent, seoTitle, seoDescription }: DynamicCMSPageProps) {
  const { data: page, isLoading, error } = useCMSPage(slug);
  const { i18n } = useTranslation();
  const locale = (i18n.language || "en").toLowerCase().split("-")[0];

  if (isLoading) {
    return (
      <MarketingShell>
        {seoTitle && seoDescription && (
          <RouteSeo title={seoTitle} description={seoDescription} />
        )}
        <LandingHeader />
        <main className="flex-1">
          <div className="py-24 px-6">
            <div className="max-w-4xl mx-auto space-y-8">
              <Skeleton className="h-12 w-3/4 mx-auto" />
              <Skeleton className="h-6 w-1/2 mx-auto" />
              <div className="space-y-4 pt-8">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </div>
          </div>
        </main>
        <LandingFooter />
      </MarketingShell>

    );
  }

  // If no CMS content exists and fallback is provided, render fallback
  if (!page || page.blocks.length === 0) {
    if (fallback) {
      return (
        <>
          {seoTitle && seoDescription && (
            <RouteSeo title={seoTitle} description={seoDescription} />
          )}
          {fallback}
        </>
      );
    }
    
    return (
      <MarketingShell>
        {seoTitle && seoDescription && (
          <RouteSeo title={seoTitle} description={seoDescription} />
        )}
        <LandingHeader />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center py-24 px-6">
            <h1 className="text-4xl font-bold mb-4">Page Not Found</h1>
            <p className="text-muted-foreground">This page doesn't exist or has no content.</p>
          </div>
        </main>
        <LandingFooter />
      </MarketingShell>

    );
  }

  return (
    <MarketingShell>
      <RouteSeo
        title={
          pickLocaleConfig(
            { meta_title: page.meta_title, title: page.title },
            page.translations,
            locale,
          ).meta_title ||
          seoTitle ||
          pickLocaleConfig(
            { title: page.title },
            page.translations,
            locale,
          ).title
        }
        description={
          (() => {
            const cmsDesc = pickLocaleConfig(
              { meta_description: page.meta_description, title: page.title },
              page.translations,
              locale,
            ).meta_description;
            if (cmsDesc && cmsDesc.length >= 50) return cmsDesc;
            if (seoDescription) return seoDescription;
            return cmsDesc || pickLocaleConfig({ title: page.title }, page.translations, locale).title;
          })()
        }
      />
      
      <LandingHeader />
      
      <main className="flex-1">
        {beforeContent}
        <CMSBlockRenderer blocks={page.blocks} />
        {afterContent}
      </main>
      
      <LandingFooter />
    </MarketingShell>
  );
}
