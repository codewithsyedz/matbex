import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Globe, Palette, Image, Search, Save, Loader2, Layers } from "lucide-react";
import { SubdomainSetup } from "@/components/web-builder/SubdomainSetup";
import { ThemeSelector } from "@/components/web-builder/ThemeSelector";
import { HeroEditor } from "@/components/web-builder/HeroEditor";
import { SEOSettings } from "@/components/web-builder/SEOSettings";
import { PagePreview } from "@/components/web-builder/PagePreview";
import { BlockEditor } from "@/components/web-builder/blocks/BlockEditor";
import { useTenantDomain } from "@/hooks/useTenantDomain";
import { LockedFeatureScreen } from "@/components/LockedFeatureScreen";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";

export default function WebBuilder() {
  const { t } = useTranslation();
  const { hasFeature, loading: authLoading } = useAuth();
  const { domain, page, isLoading, savePage, publishPage, isSavingPage, isPublishing } = useTenantDomain();

  // Local state for form
  const [theme, setTheme] = useState("urban-cafe");
  const [heroTitle, setHeroTitle] = useState("");
  const [heroSubtitle, setHeroSubtitle] = useState("");
  const [heroImageUrl, setHeroImageUrl] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [hasChanges, setHasChanges] = useState(false);

  // Sync from server data
  useEffect(() => {
    if (page) {
      setTheme(page.theme || "urban-cafe");
      setHeroTitle(page.hero_title || "");
      setHeroSubtitle(page.hero_subtitle || "");
      setHeroImageUrl(page.hero_image_url);
      setTitle(page.title || "");
      setMetaDescription(page.meta_description || "");
    }
  }, [page]);

  // Track changes
  useEffect(() => {
    if (!page) {
      setHasChanges(heroTitle || heroSubtitle || heroImageUrl || title || metaDescription ? true : false);
      return;
    }
    
    const changed = 
      theme !== (page.theme || "urban-cafe") ||
      heroTitle !== (page.hero_title || "") ||
      heroSubtitle !== (page.hero_subtitle || "") ||
      heroImageUrl !== page.hero_image_url ||
      title !== (page.title || "") ||
      metaDescription !== (page.meta_description || "");
    
    setHasChanges(changed);
  }, [theme, heroTitle, heroSubtitle, heroImageUrl, title, metaDescription, page]);

  const handleSave = () => {
    savePage({
      theme,
      hero_title: heroTitle,
      hero_subtitle: heroSubtitle,
      hero_image_url: heroImageUrl,
      title,
      meta_description: metaDescription,
    });
    setHasChanges(false);
  };

  // Check feature access
  if (authLoading) {
    return (
      <>
        <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-96 w-full" />
        </div>
      </>
    );
  }

  if (!hasFeature("web_builder")) {
    return (
      <>
        <LockedFeatureScreen
          featureName="Web Builder"
          description="Create a beautiful landing page for your restaurant with custom domain support."
          featureKey="web_builder"
        />
      </>
    );
  }

  if (isLoading) {
    return (
      <>
        <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
          <Skeleton className="h-10 w-48" />
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <Skeleton className="h-48 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
            <Skeleton className="h-96 w-full" />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
        {/* Header */}
        <header className="fade-slide-in mb-6 flex items-center justify-between min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">
              {t("app.webBuilder.title")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t("app.webBuilder.subtitle")}
            </p>
          </div>
          <Button
            onClick={handleSave}
            disabled={!hasChanges || isSavingPage}
          >
            {isSavingPage ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t("app.webBuilder.saving")}
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                {t("app.webBuilder.saveChanges")}
              </>
            )}
          </Button>
        </header>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Editor Panel */}
          <div className="lg:col-span-2">
            <Tabs defaultValue="blocks" className="w-full">
              <TabsList className="w-full justify-start mb-6 flex-wrap h-auto gap-1 bg-transparent p-0">
                <TabsTrigger value="blocks" className="gap-2 data-[state=active]:bg-accent">
                  <Layers className="h-4 w-4" />
                  <span className="hidden sm:inline">{t("app.webBuilder.tabs.blocks")}</span>
                </TabsTrigger>
                <TabsTrigger value="domain" className="gap-2 data-[state=active]:bg-accent">
                  <Globe className="h-4 w-4" />
                  <span className="hidden sm:inline">{t("app.webBuilder.tabs.domain")}</span>
                </TabsTrigger>
                <TabsTrigger value="theme" className="gap-2 data-[state=active]:bg-accent">
                  <Palette className="h-4 w-4" />
                  <span className="hidden sm:inline">{t("app.webBuilder.tabs.theme")}</span>
                </TabsTrigger>
                <TabsTrigger value="hero" className="gap-2 data-[state=active]:bg-accent">
                  <Image className="h-4 w-4" />
                  <span className="hidden sm:inline">{t("app.webBuilder.tabs.hero")}</span>
                </TabsTrigger>
                <TabsTrigger value="seo" className="gap-2 data-[state=active]:bg-accent">
                  <Search className="h-4 w-4" />
                  <span className="hidden sm:inline">{t("app.webBuilder.tabs.seo")}</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="blocks" className="fade-slide-in">
                <BlockEditor pageId={page?.id} />
              </TabsContent>

              <TabsContent value="domain" className="fade-slide-in">
                <SubdomainSetup />
              </TabsContent>

              <TabsContent value="theme" className="fade-slide-in">
                <ThemeSelector value={theme} onChange={setTheme} />
              </TabsContent>

              <TabsContent value="hero" className="fade-slide-in">
                <HeroEditor
                  heroTitle={heroTitle}
                  heroSubtitle={heroSubtitle}
                  heroImageUrl={heroImageUrl}
                  onTitleChange={setHeroTitle}
                  onSubtitleChange={setHeroSubtitle}
                  onImageChange={setHeroImageUrl}
                />
              </TabsContent>

              <TabsContent value="seo" className="fade-slide-in">
                <SEOSettings
                  title={title}
                  metaDescription={metaDescription}
                  onTitleChange={setTitle}
                  onMetaDescriptionChange={setMetaDescription}
                />
              </TabsContent>
            </Tabs>
          </div>

          {/* Preview Panel */}
          <div>
            <PagePreview
              subdomain={domain?.subdomain || null}
              customDomain={domain?.custom_domain || null}
              domainStatus={domain?.domain_status}
              theme={theme}
              heroTitle={heroTitle}
              heroSubtitle={heroSubtitle}
              heroImageUrl={heroImageUrl}
              isPublished={page?.is_published || false}
              isPublishing={isPublishing}
              onPublish={publishPage}
            />
          </div>
        </div>
      </div>
    </>
  );
}
