import { CMSPageBlock } from "@/hooks/useCMSPages";
import { useTranslation } from "react-i18next";
import { pickLocaleConfig } from "@/lib/cmsLocale";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Link } from "react-router-dom";
import { useSearchParams, useNavigate, useLocation } from "react-router-dom";
import { db } from "@/integrations/db/client";
import { toast } from "sonner";
import { 
  Star, Zap, Shield, Users, Clock, TrendingUp, 
  Check, ArrowRight, Building, Code, Utensils, 
  BarChart3, Package, CreditCard, Globe, Settings,
  Target, Heart, BookOpen, Database, Link as LinkIcon,
  FileText, ChevronRight, MessageSquare, Video, HelpCircle,
  Mail, Search, Calendar, Award, UsersRound, CheckCircle2,
  Activity, Server, Lock, HardDrive, Radio, Download,
  ExternalLink, Tag
} from "lucide-react";
import { useState } from "react";
import { ScreenshotCallout } from "@/components/onboarding/ScreenshotCallout";
import { StepVersionBadge } from "@/components/docs/StepVersionBadge";

const ICON_MAP: Record<string, any> = {
  Star, Zap, Shield, Users, Clock, TrendingUp, Check, ArrowRight,
  Building, Code, Utensils, BarChart3, Package, CreditCard, Globe, Settings,
  Target, Heart, BookOpen, Database, Link: LinkIcon, FileText, ChevronRight,
  MessageSquare, Video, HelpCircle, Mail, Search, Calendar, Award, UsersRound,
  CheckCircle2, Activity, Server, Lock, HardDrive, Radio,
  Download, ExternalLink, Tag,
};

interface CMSBlockRendererProps {
  blocks: CMSPageBlock[];
}

export function CMSBlockRenderer({ blocks }: CMSBlockRendererProps) {
  const { i18n } = useTranslation();
  const locale = (i18n.language || "en").toLowerCase().split("-")[0];
  const visibleBlocks = blocks
    .filter((b) => b.is_visible)
    .map((b) => ({
      ...b,
      config: pickLocaleConfig(b.config, b.translations, locale),
    }));

  return (
    <div className="space-y-0">
      {visibleBlocks.map((block) => (
        <BlockComponent key={block.id} block={block} />
      ))}
    </div>
  );
}

function SmartLink({
  url,
  className,
  children,
}: {
  url: string;
  className?: string;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const location = useLocation();

  const scrollToHash = (hash: string) => {
    const id = hash.replace(/^#/, "");
    if (!id) return;
    requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    // Pure hash on current page
    if (url.startsWith("#")) {
      e.preventDefault();
      window.history.replaceState(null, "", url);
      scrollToHash(url);
      return;
    }
    // path#hash - if same path, just scroll
    const [path, hash] = url.split("#");
    if (hash && path === location.pathname) {
      e.preventDefault();
      window.history.replaceState(null, "", `${path}#${hash}`);
      scrollToHash(`#${hash}`);
      return;
    }
    if (path && !url.startsWith("http")) {
      e.preventDefault();
      navigate(url);
      if (hash) setTimeout(() => scrollToHash(`#${hash}`), 100);
    }
  };

  const isExternal = /^https?:\/\//.test(url);
  if (isExternal) {
    return (
      <a href={url} className={className} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  return (
    <a href={url} className={className} onClick={handleClick}>
      {children}
    </a>
  );
}

function BlockComponent({ block }: { block: CMSPageBlock }) {
  const { config } = block;

  switch (block.block_type) {
    case "hero":
      return <HeroBlock config={config} />;
    case "text":
      return <TextBlock config={config} />;
    case "features":
      return <FeaturesBlock config={config} />;
    case "cta":
      return <CTABlock config={config} />;
    case "pricing":
      return <PricingBlock config={config} />;
    case "faq":
      return <FAQBlock config={config} />;
    case "team":
      return <TeamBlock config={config} />;
    case "stats":
      return <StatsBlock config={config} />;
    case "testimonials":
      return <TestimonialsBlock config={config} />;
    case "image":
      return <ImageBlock config={config} />;
    case "cards":
      return <CardsBlock config={config} />;
    case "status_services":
      return <StatusServicesBlock config={config} />;
    case "uptime_chart":
      return <UptimeChartBlock config={config} />;
    case "incidents":
      return <IncidentsBlock config={config} />;
    case "press_releases":
      return <PressReleasesBlock config={config} />;
    case "media_coverage":
      return <MediaCoverageBlock config={config} />;
    case "brand_assets":
      return <BrandAssetsBlock config={config} />;
    case "company_facts":
      return <CompanyFactsBlock config={config} />;
    case "blog_featured":
      return <BlogFeaturedBlock config={config} />;
    case "blog_grid":
      return <BlogGridBlock config={config} />;
    case "blog_newsletter":
      return <BlogNewsletterBlock config={config} />;
    default:
      return null;
  }
}

function HeroBlock({ config }: { config: Record<string, any> }) {
  const [searchQuery, setSearchQuery] = useState("");
  const isLight = config.variant === "light";
  const BadgeIcon = config.badgeIcon ? ICON_MAP[config.badgeIcon] : (isLight ? MessageSquare : null);
  
  return (
    <section className={`py-24 px-6 ${isLight 
      ? "bg-white" 
      : config.bgGradient || "bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900"
    }`}>
      <div className="max-w-5xl mx-auto text-center">
        {(config.badge || config.eyebrow) && (
          <span className={`inline-flex items-center gap-2 px-4 py-1.5 mb-6 text-sm font-medium rounded-full ${
            isLight 
              ? "bg-primary/10 text-primary" 
              : "bg-primary/10 text-primary uppercase tracking-wider text-xs"
          }`}>
            {BadgeIcon && <BadgeIcon className="w-4 h-4" />}
            {config.badge || config.eyebrow}
          </span>
        )}
        <h1 className={`text-4xl md:text-5xl font-light mb-6 leading-tight ${
          isLight ? "text-gray-900" : "text-white"
        }`}>
          {config.title || config.headline}
        </h1>
        {(config.subtitle || config.subheadline) && (
          <p className={`text-lg md:text-xl mb-8 max-w-2xl mx-auto font-light ${
            isLight ? "text-gray-600" : "text-gray-300"
          }`}>
            {config.subtitle || config.subheadline}
          </p>
        )}
        
        {/* Search bar */}
        {config.showSearch && (
          <div className="flex flex-col sm:flex-row gap-3 max-w-xl mx-auto mb-8">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
              <Input
                type="text"
                placeholder={config.searchPlaceholder || "Search..."}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-12 h-12 bg-gray-100 border-0 rounded-lg text-gray-900 placeholder:text-gray-500"
              />
            </div>
            <Button className="h-12 px-8 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground">
              Search
            </Button>
          </div>
        )}
        
        {/* Support for new button format */}
        {(config.primaryButton || config.secondaryButton) && (
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            {config.primaryButton && (
              <Button size="lg" asChild className="rounded-full bg-primary hover:bg-primary/90 text-primary-foreground px-8">
                <Link to={config.primaryButton.link || "/register"}>
                  {config.primaryButton.text}
                </Link>
              </Button>
            )}
            {config.secondaryButton && (
              <Button size="lg" variant="outline" asChild className="rounded-full border-primary text-primary hover:bg-primary/10 px-8">
                <Link to={config.secondaryButton.link || "#"}>{config.secondaryButton.text}</Link>
              </Button>
            )}
          </div>
        )}
        {/* Legacy button format */}
        {(config.primaryCtaText || config.secondaryCtaText) && (
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            {config.primaryCtaText && (
              <Button size="lg" asChild className="rounded-full bg-primary hover:bg-primary/90 text-primary-foreground px-8">
                <Link to={config.primaryCtaLink || "/register"}>
                  {config.primaryCtaText}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            )}
            {config.secondaryCtaText && (
              <Button size="lg" variant="outline" asChild className="rounded-full border-primary text-primary hover:bg-primary/10 px-8">
                <Link to={config.secondaryCtaLink || "#"}>{config.secondaryCtaText}</Link>
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function renderMarkdown(text: string) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Table detection
    if (line.includes('|') && i + 1 < lines.length && lines[i + 1]?.match(/^\|[\s-|]+\|$/)) {
      const headers = line.split('|').filter(c => c.trim()).map(c => c.trim());
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && !lines[i].startsWith('#')) {
        rows.push(lines[i].split('|').filter(c => c.trim()).map(c => c.trim()));
        i++;
      }
      elements.push(
        <div key={key++} className="my-6 border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                {headers.map((h, hi) => (
                  <th key={hi} className="text-left py-3 px-4 font-medium text-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className="border-b last:border-0">
                  {row.map((cell, ci) => (
                    <td key={ci} className="py-3 px-4 text-muted-foreground">{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Headings
    if (line.startsWith('## ')) {
      elements.push(<h2 key={key++} className="text-2xl font-semibold text-foreground mt-10 mb-4">{line.slice(3)}</h2>);
      i++; continue;
    }
    if (line.startsWith('### ')) {
      elements.push(<h3 key={key++} className="text-xl font-semibold text-foreground mt-8 mb-3">{line.slice(4)}</h3>);
      i++; continue;
    }

    // List items
    if (line.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith('- ')) {
        items.push(lines[i].slice(2));
        i++;
      }
      elements.push(
        <ul key={key++} className="list-disc pl-6 space-y-2 my-4">
          {items.map((item, ii) => (
            <li key={ii} className="text-muted-foreground" dangerouslySetInnerHTML={{
              __html: item
                .replace(/\*\*(.+?)\*\*/g, '<strong class="text-foreground font-medium">$1</strong>')
                .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">$1</a>')
            }} />
          ))}
        </ul>
      );
      continue;
    }

    // Empty lines
    if (line.trim() === '') { i++; continue; }

    // Paragraphs
    elements.push(
      <p key={key++} className="text-muted-foreground leading-relaxed my-4" dangerouslySetInnerHTML={{
        __html: line
          .replace(/\*\*(.+?)\*\*/g, '<strong class="text-foreground font-medium">$1</strong>')
          .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">$1</a>')
      }} />
    );
    i++;
  }
  return elements;
}

function TextBlock({ config }: { config: Record<string, any> }) {
  const maxW = config.maxWidth === "4xl" ? "max-w-4xl" : config.maxWidth === "3xl" ? "max-w-3xl" : "max-w-4xl";
  const body = config.body || config.content || "";

  return (
    <section id={config.anchor || undefined} className="py-16 px-6 bg-background scroll-mt-24">
      <div className={`${maxW} mx-auto ${config.centered ? "text-center" : ""}`}>
        {config.title && (
          <h2 className="text-3xl md:text-4xl font-semibold text-foreground mb-2">{config.title}</h2>
        )}
        {config.subtitle && (
          <p className="text-sm text-muted-foreground mb-10">{config.subtitle}</p>
        )}
        {config.anchor && (
          <div className={`mb-6 flex flex-wrap gap-2 ${config.centered ? "justify-center" : ""}`}>
            <StepVersionBadge anchor={config.anchor} />
          </div>
        )}
        <div className="font-light">
          {renderMarkdown(body)}
        </div>
        {config.anchor && (
          <ScreenshotCallout
            anchor={config.anchor}
            screenshot={config.screenshot}
            caption={config.screenshotCaption}
          />
        )}
      </div>
    </section>
  );
}

function FeaturesBlock({ config }: { config: Record<string, any> }) {
  const items = config.items || [];
  
  return (
    <section className="py-20 px-6 bg-muted/30">
      <div className="max-w-6xl mx-auto">
        {config.title && (
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">{config.title}</h2>
            {config.subtitle && (
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                {config.subtitle}
              </p>
            )}
          </div>
        )}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {items.map((item: any, index: number) => {
            const IconComponent = ICON_MAP[item.icon] || Star;
            return (
              <Card key={index} className="border-0 shadow-sm">
                <CardHeader className="pb-3">
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                    <IconComponent className="h-6 w-6 text-primary" />
                  </div>
                  <CardTitle className="text-base font-medium">{item.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">{item.description}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function CTABlock({ config }: { config: Record<string, any> }) {
  const IconComponent = config.icon ? ICON_MAP[config.icon] : null;
  const isPrimary = config.variant === "primary";
  const isDark = config.variant === "dark";
  
  const sectionBg = isPrimary 
    ? "bg-primary" 
    : isDark 
      ? "bg-[#3a3a3a]" 
      : "bg-gray-50 border-t border-gray-200";
  
  const textColor = (isPrimary || isDark) ? "text-white" : "text-gray-900";
  const subtitleColor = (isPrimary || isDark) ? "text-white/80" : "text-gray-500";
  
  return (
    <section className={`py-20 px-6 ${sectionBg}`}>
      <div className="max-w-4xl mx-auto text-center">
        {IconComponent && (
          <div className="flex justify-center mb-4">
            <IconComponent className={`h-12 w-12 ${(isPrimary || isDark) ? "text-white" : "text-primary"}`} />
          </div>
        )}
        <h2 className={`text-2xl font-medium mb-3 ${textColor}`}>
          {config.title || config.headline}
        </h2>
        {(config.subtitle || config.description) && (
          <p className={`font-light mb-6 max-w-2xl mx-auto ${subtitleColor}`}>
            {config.subtitle || config.description}
          </p>
        )}
        {config.buttonText && (
          <Button 
            asChild 
            variant={isPrimary ? "outline" : "default"}
            className={`rounded-lg px-8 ${
              isPrimary 
                ? "bg-white text-primary hover:bg-white/90 border-white" 
                : "bg-primary hover:bg-primary/90 text-primary-foreground"
            }`}
          >
            <Link to={config.buttonLink || "/register"}>
              {config.buttonText}
            </Link>
          </Button>
        )}
      </div>
    </section>
  );
}

function PricingBlock({ config }: { config: Record<string, any> }) {
  const tiers = config.tiers || [];
  
  return (
    <section className="py-20 px-6 bg-background">
      <div className="max-w-6xl mx-auto">
        {config.title && (
          <h2 className="text-3xl font-bold text-center mb-12">{config.title}</h2>
        )}
        <div className="grid md:grid-cols-3 gap-8">
          {tiers.map((tier: any, index: number) => (
            <Card
              key={index}
              className={`relative ${tier.highlighted ? "border-primary shadow-lg scale-105" : ""}`}
            >
              {tier.badge && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 text-xs font-medium bg-primary text-primary-foreground rounded-full">
                  {tier.badge}
                </span>
              )}
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-medium">{tier.name}</CardTitle>
                <CardDescription>{tier.tagline}</CardDescription>
                <div className="text-3xl font-bold mt-4">
                  ${tier.price}
                  <span className="text-sm font-normal text-muted-foreground">/month</span>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3 mb-6">
                  {(tier.features || []).map((feature: string, i: number) => (
                    <li key={i} className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-primary" />
                      <span className="text-sm">{feature}</span>
                    </li>
                  ))}
                </ul>
                <Button className="w-full" variant={tier.highlighted ? "default" : "outline"}>
                  {tier.ctaText || "Get Started"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

function FAQBlock({ config }: { config: Record<string, any> }) {
  const items = config.items || [];
  
  return (
    <section className="py-20 px-6 bg-muted/30">
      <div className="max-w-3xl mx-auto">
        {config.title && (
          <h2 className="text-3xl font-bold text-center mb-12">{config.title}</h2>
        )}
        <Accordion type="single" collapsible className="space-y-4">
          {items.map((item: any, index: number) => (
            <AccordionItem key={index} value={`faq-${index}`} className="bg-background rounded-lg px-6">
              <AccordionTrigger className="text-left font-medium">
                {item.question}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground">
                {item.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}

function TeamBlock({ config }: { config: Record<string, any> }) {
  const members = config.members || [];
  
  return (
    <section className="py-20 px-6 bg-background">
      <div className="max-w-6xl mx-auto">
        {config.title && (
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">{config.title}</h2>
            {config.subtitle && (
              <p className="text-lg text-muted-foreground">{config.subtitle}</p>
            )}
          </div>
        )}
        <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-8">
          {members.map((member: any, index: number) => (
            <div key={index} className="text-center">
              <div className="w-24 h-24 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center text-3xl">
                {member.image ? (
                  <img src={member.image} alt={member.name} className="w-full h-full rounded-full object-cover" />
                ) : (
                  member.emoji || "👤"
                )}
              </div>
              <h3 className="font-semibold">{member.name}</h3>
              <p className="text-sm text-muted-foreground">{member.role}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function StatsBlock({ config }: { config: Record<string, any> }) {
  const stats = config.stats || [];
  
  return (
    <section className="py-16 px-6 border-b border-gray-100">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {stats.map((stat: any, index: number) => (
            <div key={index} className="text-center">
              <div className="text-4xl font-light text-primary mb-2">{stat.value}</div>
              <div className="text-gray-600 font-light">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TestimonialsBlock({ config }: { config: Record<string, any> }) {
  const items = config.items || [];
  
  return (
    <section className="py-20 px-6 bg-muted/30">
      <div className="max-w-6xl mx-auto">
        {config.title && (
          <h2 className="text-3xl font-bold text-center mb-12">{config.title}</h2>
        )}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {items.map((item: any, index: number) => (
            <Card key={index} className="border-0 shadow-sm">
              <CardContent className="pt-6">
                <p className="text-muted-foreground mb-6 italic">"{item.quote}"</p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-lg">
                    {item.emoji || "👤"}
                  </div>
                  <div>
                    <div className="font-medium">{item.author}</div>
                    <div className="text-sm text-muted-foreground">{item.role}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

function ImageBlock({ config }: { config: Record<string, any> }) {
  if (!config.src) return null;
  
  return (
    <section className="py-12 px-6 bg-background">
      <div className="max-w-6xl mx-auto">
        <img
          src={config.src}
          alt={config.alt || ""}
          className="w-full rounded-lg shadow-lg"
        />
        {config.caption && (
          <p className="text-center text-sm text-muted-foreground mt-4">
            {config.caption}
          </p>
        )}
      </div>
    </section>
  );
}

function CardsBlock({ config }: { config: Record<string, any> }) {
  const cards = config.cards || [];
  const columns = config.columns || 3;
  const style = config.style || "card";
  const isDark = config.variant === "dark";
  
  const gridClass = columns === 2 
    ? "grid md:grid-cols-2 gap-6" 
    : columns === 4 
      ? "grid md:grid-cols-2 lg:grid-cols-4 gap-8"
      : "grid md:grid-cols-2 lg:grid-cols-3 gap-6";
  
  // List style for Popular Articles
  if (style === "list") {
    return (
      <section className={`py-16 px-6 ${isDark ? "bg-gray-100" : "bg-white"}`}>
        <div className="max-w-4xl mx-auto">
          {config.title && (
            <h2 className="text-xl font-medium text-gray-900 text-center mb-8">{config.title}</h2>
          )}
          <div className={gridClass}>
            {cards.map((card: any, index: number) => {
              const IconComponent = ICON_MAP[card.icon] || FileText;
              return (
                <Link 
                  key={index} 
                  to={card.url || "#"}
                  className="flex items-center gap-3 p-4 bg-white rounded-xl border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all"
                >
                  <IconComponent className="h-5 w-5 text-gray-400 flex-shrink-0" />
                  <span className="text-gray-700 text-sm">{card.title}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>
    );
  }

  // Documentation cards with links
  const hasLinks = cards.some((card: any) => card.links && card.links.length > 0);
  
  if (hasLinks) {
    return (
      <section className="py-16 px-6 bg-white">
        <div className="max-w-5xl mx-auto">
          {config.title && (
            <h2 className="text-3xl font-light text-gray-900 text-center mb-12">{config.title}</h2>
          )}
          <div className={gridClass}>
            {cards.map((card: any, index: number) => {
              const IconComponent = ICON_MAP[card.icon] || Star;
              return (
                <div key={index} className="bg-white rounded-xl p-6 border border-gray-200">
                  <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center mb-4">
                    <IconComponent className="h-5 w-5 text-gray-600" />
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">{card.title}</h3>
                  <p className="text-gray-500 text-sm mb-4">{card.description}</p>
                  {card.links && (
                    <ul className="space-y-2">
                      {card.links.map((link: any, linkIndex: number) => (
                        <li key={linkIndex}>
                          <SmartLink
                            url={link.url || "#"}
                            className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                          >
                            <ChevronRight className="h-3 w-3" />
                            {link.text}
                          </SmartLink>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    );
  }
  
  // Default card style
  return (
    <section className="py-20 px-6 bg-gray-50">
      <div className="max-w-6xl mx-auto">
        {config.title && (
          <h2 className="text-3xl font-light text-gray-900 text-center mb-12">{config.title}</h2>
        )}
        <div className={gridClass}>
          {cards.map((card: any, index: number) => {
            const IconComponent = ICON_MAP[card.icon] || Star;
            return (
              <div key={index} className="bg-white rounded-2xl p-6 border border-gray-200">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                  <IconComponent className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-xl font-medium text-gray-900 mb-2">{card.title}</h3>
                <p className="text-gray-600 font-light">{card.description}</p>
                {card.link && (
                  <Link
                    to={card.link}
                    className="inline-flex items-center text-primary mt-4 text-sm font-medium"
                    aria-label={`Learn more about ${card.title}`}
                  >
                    Learn more about {card.title} <ArrowRight className="ml-1 h-3 w-3" aria-hidden="true" />
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function StatusServicesBlock({ config }: { config: Record<string, any> }) {
  const services = config.services || [];
  const IconComponent = config.icon ? ICON_MAP[config.icon] : Activity;
  
  return (
    <section className="py-12 px-6 bg-background">
      <div className="max-w-3xl mx-auto">
        {config.title && (
          <div className="flex items-center gap-2 mb-6">
            <IconComponent className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-medium text-foreground">{config.title}</h2>
          </div>
        )}
        <div className="space-y-3">
          {services.map((service: any, index: number) => {
            const ServiceIcon = service.icon ? ICON_MAP[service.icon] : CheckCircle2;
            const isOperational = service.status === "operational";
            return (
              <div 
                key={index} 
                className="flex items-center justify-between p-4 bg-background border border-border rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <ServiceIcon className={`h-5 w-5 ${isOperational ? "text-primary" : "text-destructive"}`} />
                  <span className="font-medium text-foreground">{service.name}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-muted-foreground">{service.uptime} uptime</span>
                  <span className={`text-sm font-medium px-3 py-1 rounded ${
                    isOperational 
                      ? "text-primary bg-primary/10" 
                      : "text-destructive bg-destructive/10"
                  }`}>
                    {isOperational ? "Operational" : "Issues"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function UptimeChartBlock({ config }: { config: Record<string, any> }) {
  const days = config.days || 90;
  
  return (
    <section className="py-8 px-6 bg-background">
      <div className="max-w-3xl mx-auto">
        <h3 className="text-base font-medium text-foreground mb-4">{config.title || `${days}-Day Uptime`}</h3>
        <div className="p-4 border border-border rounded-lg bg-background">
          <div className="flex gap-[2px]">
            {Array.from({ length: days }).map((_, i) => (
              <div 
                key={i} 
                className="flex-1 h-8 bg-primary rounded-sm"
                title={`Day ${i + 1}: 100% uptime`}
              />
            ))}
          </div>
          <div className="flex justify-between mt-3 text-sm text-muted-foreground">
            <span>{days} days ago</span>
            <span>Today</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function IncidentsBlock({ config }: { config: Record<string, any> }) {
  const incidents = config.incidents || [];
  
  return (
    <section className="py-12 px-6 bg-background">
      <div className="max-w-3xl mx-auto">
        {config.title && (
          <h2 className="text-xl font-medium text-foreground mb-6">{config.title}</h2>
        )}
        <div className="space-y-6">
          {incidents.map((incident: any, index: number) => (
            <div key={index} className="flex gap-4">
              <div className="w-1 rounded-full bg-primary flex-shrink-0" />
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-sm text-muted-foreground">{incident.date}</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                    incident.status === "resolved" 
                      ? "text-primary bg-primary/10" 
                      : incident.status === "investigating"
                        ? "text-amber-600 bg-amber-100"
                        : "text-destructive bg-destructive/10"
                  }`}>
                    {incident.status === "resolved" ? "Resolved" : 
                     incident.status === "investigating" ? "Investigating" : "Ongoing"}
                  </span>
                </div>
                <h3 className="font-medium text-foreground mb-1">{incident.title}</h3>
                <p className="text-sm text-muted-foreground">{incident.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PressReleasesBlock({ config }: { config: Record<string, any> }) {
  const releases = config.releases || [];

  return (
    <section className="py-16 px-6 bg-background">
      <div className="max-w-3xl mx-auto">
        {config.title && (
          <h2 className="text-2xl font-semibold text-foreground mb-8">{config.title}</h2>
        )}
        <div className="divide-y divide-border">
          {releases.map((release: any, index: number) => (
            <div key={index} className="py-6 first:pt-0">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <Calendar className="h-4 w-4" />
                {release.date}
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-1">{release.title}</h3>
              <p className="text-muted-foreground mb-2">{release.description}</p>
              {release.link && (
                <a
                  href={release.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                  aria-label={`Read more: ${release.title}`}
                >
                  Read more about {release.title} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function MediaCoverageBlock({ config }: { config: Record<string, any> }) {
  const articles = config.articles || [];

  return (
    <section className="py-16 px-6 bg-muted/30">
      <div className="max-w-3xl mx-auto">
        {config.title && (
          <h2 className="text-2xl font-semibold text-foreground mb-8">{config.title}</h2>
        )}
        <div className="grid md:grid-cols-2 gap-4">
          {articles.map((article: any, index: number) => (
            <a
              key={index}
              href={article.link || "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="block p-6 bg-background border border-border rounded-xl hover:shadow-md transition-shadow"
            >
              <span className="text-sm font-medium text-primary mb-2 block">{article.source}</span>
              <h3 className="text-foreground font-medium">{article.title}</h3>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

function BrandAssetsBlock({ config }: { config: Record<string, any> }) {
  const assets = config.assets || [];

  const getDownloadUrl = (asset: any) => {
    if (asset.storagePath) {
      return `${import.meta.env.VITE_API_URL}/storage/v1/object/public/press-assets/${asset.storagePath}`;
    }
    return asset.link || "#";
  };

  const handleDownload = (asset: any) => {
    const url = getDownloadUrl(asset);
    if (url === "#") return;
    const a = document.createElement("a");
    a.href = url;
    a.download = asset.fileName || asset.name;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <section className="py-16 px-6 bg-background">
      <div className="max-w-3xl mx-auto">
        {config.title && (
          <h2 className="text-2xl font-semibold text-foreground mb-2">{config.title}</h2>
        )}
        {config.subtitle && (
          <p className="text-muted-foreground mb-8">{config.subtitle}</p>
        )}
        <div className="grid md:grid-cols-2 gap-4">
          {assets.map((asset: any, index: number) => {
            const url = getDownloadUrl(asset);
            const isDisabled = url === "#";
            return (
              <button
                key={index}
                onClick={() => handleDownload(asset)}
                disabled={isDisabled}
                className={`flex items-center justify-between p-4 border border-border rounded-lg text-left transition-colors ${
                  isDisabled 
                    ? "opacity-50 cursor-not-allowed" 
                    : "hover:bg-muted/50 cursor-pointer"
                }`}
              >
                <div>
                  <p className="font-medium text-foreground">{asset.name}</p>
                  <p className="text-sm text-muted-foreground">{asset.format}</p>
                </div>
                <Download className="h-5 w-5 text-muted-foreground" />
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function CompanyFactsBlock({ config }: { config: Record<string, any> }) {
  const about = config.about || {};
  const facts = config.facts || [];

  return (
    <section className="py-16 px-6 bg-muted/30">
      <div className="max-w-3xl mx-auto">
        {config.title && (
          <h2 className="text-2xl font-semibold text-foreground text-center mb-10">{config.title}</h2>
        )}
        <div className="grid md:grid-cols-2 gap-10">
          <div>
            {about.heading && (
              <h3 className="text-lg font-semibold text-foreground mb-3">{about.heading}</h3>
            )}
            {(about.paragraphs || []).map((p: string, i: number) => (
              <p key={i} className="text-muted-foreground mb-3 text-sm leading-relaxed">{p}</p>
            ))}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-3">Key Facts</h3>
            <div className="space-y-2">
              {facts.map((fact: any, index: number) => (
                <div key={index} className="text-sm">
                  <span className="font-medium text-foreground">{fact.label}:</span>{" "}
                  <span className="text-muted-foreground">{fact.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function BlogFeaturedBlock({ config }: { config: Record<string, any> }) {
  const categories = config.categories || [];
  const post = config.post || {};
  const [searchParams, setSearchParams] = useSearchParams();
  const activeCategory = searchParams.get("category") || "All";
  const setActiveCategory = (cat: string) => {
    const next = new URLSearchParams(searchParams);
    if (cat === "All") next.delete("category");
    else next.set("category", cat);
    setSearchParams(next, { replace: true });
    if (typeof window !== "undefined") {
      window.scrollTo({ top: window.scrollY + 320, behavior: "smooth" });
    }
  };
  const matchesFeatured =
    activeCategory === "All" || (post.category || "").toLowerCase() === activeCategory.toLowerCase();

  return (
    <section className="py-8 px-6 bg-background">
      <div className="max-w-5xl mx-auto">
        {/* Category filters */}
        <div className="flex flex-wrap gap-2 mb-8">
          {categories.map((cat: string) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                activeCategory === cat
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Featured post card */}
        {matchesFeatured ? (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="grid md:grid-cols-2 gap-0">
            <div className="p-8 flex flex-col justify-center">
              <div className="flex items-center gap-2 mb-4">
                {post.featured && (
                  <span className="px-2.5 py-1 text-xs font-semibold rounded bg-primary text-primary-foreground">
                    Featured
                  </span>
                )}
                <span className="text-sm text-muted-foreground">{post.category}</span>
              </div>
              <h2 className="text-2xl font-bold text-foreground mb-3">{post.title}</h2>
              <p className="text-muted-foreground mb-4 text-sm leading-relaxed">{post.description}</p>
              <div className="flex items-center gap-3 text-sm text-muted-foreground mb-4">
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  {post.date}
                </span>
                <span>{post.readTime}</span>
              </div>
              <a
                href={post.link || "#"}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
              >
                Read Article <ArrowRight className="h-4 w-4" />
              </a>
            </div>
            <div className="bg-muted/50 min-h-[280px] flex items-center justify-center">
              <div className="w-full h-full bg-gradient-to-br from-muted to-muted/80 rounded-none" />
            </div>
          </div>
        </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            Showing articles in <span className="font-medium text-foreground">{activeCategory}</span>.
          </p>
        )}
      </div>
    </section>
  );
}

function BlogGridBlock({ config }: { config: Record<string, any> }) {
  const articles: any[] = config.articles || [];
  const [searchParams] = useSearchParams();
  const activeCategory = searchParams.get("category") || "All";
  const filtered =
    activeCategory === "All"
      ? articles
      : articles.filter(
          (a) => (a.category || "").toLowerCase() === activeCategory.toLowerCase()
        );
  const pageSize = config.pageSize || 6;
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  return (
    <section className="py-16 px-6 bg-background">
      <div className="max-w-5xl mx-auto">
        {config.title && (
          <h2 className="text-2xl font-semibold text-foreground mb-8">{config.title}</h2>
        )}
        {visible.length === 0 ? (
          <p className="text-center text-muted-foreground py-12">
            No articles in this category yet. Check back soon.
          </p>
        ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {visible.map((article: any, index: number) => {
            const href = article.link && article.link !== "#" ? article.link : null;
            const Wrapper: any = href ? "a" : "div";
            const wrapperProps = href
              ? { href, target: href.startsWith("http") ? "_blank" : undefined, rel: "noopener noreferrer" }
              : {};
            return (
            <Wrapper
              key={index}
              {...wrapperProps}
              className={`group block rounded-xl border border-border bg-card overflow-hidden transition-shadow ${
                href ? "hover:shadow-md cursor-pointer" : "opacity-90"
              }`}
            >
              <div className="h-40 bg-muted/50" />
              <div className="p-5">
                <div className="flex items-center gap-1.5 mb-2">
                  <Tag className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-medium text-primary">{article.category}</span>
                </div>
                <h3 className="font-semibold text-foreground mb-2 group-hover:text-primary transition-colors leading-snug">
                  {article.title}
                </h3>
                <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{article.description}</p>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{article.date}</span>
                  <span>{article.readTime}</span>
                </div>
              </div>
            </Wrapper>
            );
          })}
        </div>
        )}
        {hasMore && (
          <div className="flex justify-center mt-10">
            <button
              onClick={() => setVisibleCount((c) => c + pageSize)}
              className="px-6 py-2.5 rounded-full border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              Load More Articles
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function BlogNewsletterBlock({ config }: { config: Record<string, any> }) {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error("Please enter a valid email address");
      return;
    }
    setSubmitting(true);
    const { error } = await db
      .from("newsletter_subscriptions")
      .insert({ email: trimmed, source: "blog" });
    setSubmitting(false);
    if (error) {
      if ((error as any).code === "23505") {
        toast.success("You're already subscribed - thank you!");
        setEmail("");
        return;
      }
      toast.error("Could not subscribe. Please try again.");
      return;
    }
    toast.success("Subscribed! Watch your inbox for Matbex insights.");
    setEmail("");
  };

  return (
    <section className="py-16 px-6 bg-muted/30 border-t border-border">
      <div className="max-w-xl mx-auto text-center">
        {config.title && (
          <h2 className="text-2xl font-semibold text-foreground mb-3">{config.title}</h2>
        )}
        {config.subtitle && (
          <p className="text-muted-foreground mb-6">{config.subtitle}</p>
        )}
        <form onSubmit={onSubmit} className="flex gap-3 max-w-md mx-auto">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder={config.placeholder || "Enter your email"}
            className="flex-1 px-4 py-2.5 rounded-full border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <button
            type="submit"
            disabled={submitting}
            className="px-6 py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {submitting ? "Submitting…" : config.buttonText || "Subscribe"}
          </button>
        </form>
      </div>
    </section>
  );
}
