import { LandingHeader } from "@/components/landing/LandingHeader";
import { HeroSection } from "@/components/landing/HeroSection";
import { MissionStatement } from "@/components/landing/MissionStatement";
import { ComplianceBadgesSection } from "@/components/landing/ComplianceBadgesSection";
import { BentoGrid } from "@/components/landing/BentoGrid";
import { ToolsStackSection } from "@/components/landing/ToolsStackSection";
import { FeatureSections } from "@/components/landing/FeatureSections";
import { OnlineOrderingSection } from "@/components/landing/OnlineOrderingSection";
import { VenueTypesSection } from "@/components/landing/VenueTypesSection";
import { TestimonialsCarousel } from "@/components/landing/TestimonialsCarousel";
import { PricingTable } from "@/components/landing/PricingTable";
import { FAQSection } from "@/components/landing/FAQSection";
import { ContactSection } from "@/components/landing/ContactSection";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { StickyMobileCta } from "@/components/landing/StickyMobileCta";
import { PageTransition } from "@/components/PageTransition";
import { Scene } from "@/components/motion/Scene";
import { ScrollProgress } from "@/components/motion/ScrollProgress";
import { LandingPageSEO } from "@/components/seo/LandingPageSEO";
import { RouteSeo } from "@/components/seo/RouteSeo";
import { PwaInstallPrompt } from "@/components/pwa/PwaInstallPrompt";
import { useLandingContent } from "@/hooks/useLandingContent";
import { useLandingStrings } from "@/hooks/useLandingStrings";
import { Helmet } from "react-helmet-async";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import "@/styles/landing-lux.css";

const Landing = () => {
  const { sections } = useLandingContent();
  const { hash } = useLocation();

  // Arriving from another page with #contact (or #pricing) should land on that
  // block once the CMS sections have rendered.
  useEffect(() => {
    if (!hash) return;
    const id = hash.slice(1);
    let frame = 0;
    const timer = window.setTimeout(() => {
      frame = window.requestAnimationFrame(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }, 350);
    return () => {
      window.clearTimeout(timer);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [hash, sections.length]);
  // Load CMS-managed strings (EN+AR) and merge into i18next at runtime.
  useLandingStrings();

  // Map section_key -> component. Sections not in this map are ignored.
  const sectionComponents: Record<string, React.ComponentType> = {
    hero: HeroSection,
    compliance: ComplianceBadgesSection,
    bento: BentoGrid,
    mission: MissionStatement,
    tools: ToolsStackSection,
    features: FeatureSections,
    online_ordering: OnlineOrderingSection,
    venue_types: VenueTypesSection,
    pricing: PricingTable,
    testimonials: TestimonialsCarousel,
    faq: FAQSection,
    contact: ContactSection,
  };

  // Build the render list from CMS: only active sections, ordered by sort_order.
  // Fallback to the default order if CMS hasn't loaded yet.
  const orderedSections = (sections.length > 0
    ? [...sections].sort((a, b) => a.sort_order - b.sort_order)
    : Object.keys(sectionComponents).map((key, i) => ({
        section_key: key,
        is_active: true,
        sort_order: i,
      }))
  ).filter((s) => s.is_active && sectionComponents[s.section_key]);

  // Pricing always comes before the reviews so phone visitors reach the offer
  // without scrolling through the full social-proof block first.
  const pricingIndex = orderedSections.findIndex((s) => s.section_key === "pricing");
  const testimonialsIndex = orderedSections.findIndex((s) => s.section_key === "testimonials");
  if (pricingIndex > -1 && testimonialsIndex > -1 && pricingIndex > testimonialsIndex) {
    const [pricing] = orderedSections.splice(pricingIndex, 1);
    orderedSections.splice(testimonialsIndex, 0, pricing);
  }

  return (
    <PageTransition className="lux min-h-screen bg-background text-foreground">
      <RouteSeo
        title="Matbex | Restaurant OS for COGS, Payroll & Inventory"
        description="Restaurant operating system with real-time COGS tracking, automated payroll, inventory sync, and daily profit monitoring. Start free."
      />
      <Helmet>
        <link rel="alternate" hrefLang="en" href="https://matbex.com/" />
        <link rel="alternate" hrefLang="ar-SA" href="https://matbex.com/ar" />
        <link rel="alternate" hrefLang="x-default" href="https://matbex.com/" />
      </Helmet>
      {/* Dynamic SEO structured data */}
      <LandingPageSEO />
      
      {/* Semantic HTML structure */}
      <ScrollProgress />
      <LandingHeader />
      <main>
        {orderedSections.map((s) => {
          const Component = sectionComponents[s.section_key];
          // The hero owns its own choreography; dense interactive sections
          // (pricing, FAQ, contact) opt out of the scene hand-off.
          if (s.section_key === "hero") return <Component key={s.section_key} />;
          const handoff = !["pricing", "faq", "contact"].includes(s.section_key);
          return (
            <Scene key={s.section_key} handoff={handoff}>
              <Component />
            </Scene>
          );
        })}
      </main>
      <div>
        <LandingFooter />
      </div>
      <StickyMobileCta />
      <PwaInstallPrompt />
    </PageTransition>
  );
};

export default Landing;