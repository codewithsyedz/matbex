import { Helmet } from "react-helmet-async";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { ArrowRight, Check, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SEO_PAGES_BY_SLUG, SITE_ORIGIN, type SeoPage } from "./seoContent";

interface SeoLandingProps {
  slug: string;
}

/**
 * Single template that renders all KSA SEO landing pages.
 * One file → 6 indexable, low-difficulty entry points into the funnel.
 */
export default function SeoLanding({ slug }: SeoLandingProps) {
  const page = SEO_PAGES_BY_SLUG[slug];

  if (!page) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Page not found</p>
      </div>
    );
  }

  const alt = SEO_PAGES_BY_SLUG[page.alternateSlug];
  const canonical = `${SITE_ORIGIN}${page.path}`;

  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: page.faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  const productLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Matbex",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web, iPadOS, Android, Windows",
    description: page.description,
    url: canonical,
    image: `${SITE_ORIGIN}/og-image.png`,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "SAR",
      availability: "https://schema.org/InStock",
      url: canonical,
    },
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: "4.9",
      ratingCount: "150",
      bestRating: "5",
      worstRating: "1",
    },
    areaServed: { "@type": "Country", name: "Saudi Arabia" },
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Matbex", item: SITE_ORIGIN },
      { "@type": "ListItem", position: 2, name: page.heroEyebrow, item: canonical },
    ],
  };

  const pricing = getPricingComparison(page.lang);
  const pricingLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: pricing.title,
    itemListElement: pricing.rows.map((r, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "Product",
        name: r.vendor,
        brand: { "@type": "Brand", name: r.vendor },
        image: `${SITE_ORIGIN}/og-image.png`,
        url: canonical,
        offers: {
          "@type": "Offer",
          price: r.priceValue,
          priceCurrency: "SAR",
          description: r.priceLabel,
          availability: "https://schema.org/InStock",
          url: canonical,
          priceValidUntil: new Date(
            new Date().setFullYear(new Date().getFullYear() + 1),
          )
            .toISOString()
            .split("T")[0],
        },
      },
    })),
  };

  return (
    <div dir={page.dir} lang={page.lang} className="min-h-screen bg-background text-foreground">
      <Helmet>
        <html lang={page.lang} dir={page.dir} />
        <title>{page.title}</title>
        <meta name="description" content={page.description} />
        <link rel="canonical" href={canonical} />
        {alt && (
          <link
            rel="alternate"
            hrefLang={alt.hreflang}
            href={`${SITE_ORIGIN}${alt.path}`}
          />
        )}
        <link rel="alternate" hrefLang={page.hreflang} href={canonical} />
        <link rel="alternate" hrefLang="x-default" href={`${SITE_ORIGIN}/`} />
        <meta property="og:type" content="website" />
        <meta property="og:title" content={page.title} />
        <meta property="og:description" content={page.description} />
        <meta property="og:url" content={canonical} />
        <meta property="og:locale" content={page.lang === "ar" ? "ar_SA" : "en_SA"} />
        <meta property="og:site_name" content="Matbex" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={page.title} />
        <meta name="twitter:description" content={page.description} />
        <script type="application/ld+json">{JSON.stringify(productLd)}</script>
        <script type="application/ld+json">{JSON.stringify(faqLd)}</script>
        <script type="application/ld+json">{JSON.stringify(breadcrumbLd)}</script>
        <script type="application/ld+json">{JSON.stringify(pricingLd)}</script>
      </Helmet>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border/40">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-background" />
        <div className="absolute top-0 right-0 h-[500px] w-[500px] rounded-full bg-primary/10 blur-3xl" />
        <div className="relative max-w-6xl mx-auto px-6 lg:px-8 py-20 lg:py-28">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="max-w-3xl"
          >
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
              <Sparkles className="h-3 w-3" />
              {page.heroEyebrow}
            </div>
            <h1 className="mt-6 text-4xl lg:text-6xl font-light tracking-tight leading-[1.05]">
              {page.heroHeadline}
            </h1>
            <p className="mt-6 text-lg lg:text-xl text-muted-foreground font-light leading-relaxed">
              {page.heroSub}
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Button size="lg" asChild>
                <Link to="/register">
                  {page.primaryCta}
                  <ArrowRight className={`h-4 w-4 ${page.dir === "rtl" ? "mr-2 rotate-180" : "ml-2"}`} />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link to="/investment-tiers">{page.secondaryCta}</Link>
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-6 lg:px-8 py-20 lg:py-28">
        <h2 className="text-3xl lg:text-4xl font-light tracking-tight mb-12">
          {page.lang === "ar" ? "المميزات الرئيسية" : "Key features"}
        </h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {page.features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.3, delay: i * 0.05 }}
              className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-sm p-6 hover:border-primary/40 transition-colors"
            >
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-4">
                <Check className="h-5 w-5" />
              </div>
              <h3 className="text-base font-medium mb-2">{f.title}</h3>
              <p className="text-sm text-muted-foreground font-light leading-relaxed">{f.body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Pricing comparison — SEO */}
      <section className="border-y border-border/40 bg-muted/10">
        <div className="max-w-6xl mx-auto px-6 lg:px-8 py-20 lg:py-24">
          <div className="max-w-2xl mb-10">
            <h2 className="text-3xl lg:text-4xl font-light tracking-tight">
              {pricing.title}
            </h2>
            <p className="mt-4 text-muted-foreground font-light">
              {pricing.subtitle}
            </p>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-border/60 bg-card/40">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-xs uppercase tracking-wider text-muted-foreground">
                  <th className={`p-4 font-medium ${page.dir === "rtl" ? "text-right" : "text-left"}`}>
                    {pricing.cols.vendor}
                  </th>
                  <th className={`p-4 font-medium ${page.dir === "rtl" ? "text-right" : "text-left"}`}>
                    {pricing.cols.price}
                  </th>
                  <th className="p-4 font-medium text-center">{pricing.cols.zatca}</th>
                  <th className="p-4 font-medium text-center">{pricing.cols.accounting}</th>
                  <th className="p-4 font-medium text-center">{pricing.cols.offline}</th>
                  <th className={`p-4 font-medium ${page.dir === "rtl" ? "text-right" : "text-left"} hidden md:table-cell`}>
                    {pricing.cols.notes}
                  </th>
                </tr>
              </thead>
              <tbody>
                {pricing.rows.map((r) => (
                  <tr
                    key={r.vendor}
                    className={`border-b border-border/40 last:border-0 ${
                      r.highlight ? "bg-primary/5" : ""
                    }`}
                  >
                    <td className={`p-4 ${page.dir === "rtl" ? "text-right" : "text-left"}`}>
                      <span className={`font-medium ${r.highlight ? "text-primary" : ""}`}>
                        {r.vendor}
                      </span>
                    </td>
                    <td className={`p-4 ${page.dir === "rtl" ? "text-right" : "text-left"}`}>
                      <div className="font-medium">{r.priceLabel}</div>
                      <div className="text-xs text-muted-foreground font-light">{r.priceNote}</div>
                    </td>
                    <td className="p-4 text-center">
                      <BoolCell value={r.zatca} />
                    </td>
                    <td className="p-4 text-center">
                      <BoolCell value={r.accounting} />
                    </td>
                    <td className="p-4 text-center">
                      <BoolCell value={r.offline} />
                    </td>
                    <td className={`p-4 text-muted-foreground font-light hidden md:table-cell ${page.dir === "rtl" ? "text-right" : "text-left"}`}>
                      {r.notes}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs text-muted-foreground font-light">
            {pricing.disclaimer}
          </p>
          <div className="mt-8">
            <Button asChild>
              <Link to="/investment-tiers">{pricing.cta}</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Proof */}
      <section className="border-y border-border/40 bg-muted/20">
        <div className="max-w-6xl mx-auto px-6 lg:px-8 py-20 lg:py-24">
          <h2 className="text-3xl lg:text-4xl font-light tracking-tight max-w-2xl">
            {page.proofTitle}
          </h2>
          <ul className="mt-10 grid md:grid-cols-2 gap-4">
            {page.proofPoints.map((p) => (
              <li key={p} className="flex gap-3 items-start">
                <Check className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <span className="text-base text-foreground/80 font-light">{p}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-6 lg:px-8 py-20 lg:py-28">
        <h2 className="text-3xl lg:text-4xl font-light tracking-tight text-center mb-12">
          {page.lang === "ar" ? "أسئلة شائعة" : "Frequently asked"}
        </h2>
        <div className="space-y-4">
          {page.faq.map((item, i) => (
            <motion.details
              key={item.q}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.3, delay: i * 0.04 }}
              className="group rounded-xl border border-border/60 bg-card/30 p-5 open:bg-card/60 transition-colors"
            >
              <summary className="cursor-pointer list-none flex justify-between items-center gap-4 font-medium">
                <span>{item.q}</span>
                <span className="text-primary text-xl group-open:rotate-45 transition-transform">+</span>
              </summary>
              <p className="mt-3 text-sm text-muted-foreground font-light leading-relaxed">
                {item.a}
              </p>
            </motion.details>
          ))}
        </div>
      </section>

      {/* CTA footer */}
      <section className="border-t border-border/40">
        {(page.slug === "zatca" || page.slug === "zatca-e-invoicing") && (
          <div className="max-w-4xl mx-auto px-6 lg:px-8 pt-20">
            <h2 className="text-3xl lg:text-4xl font-light tracking-tight text-center mb-10">
              {page.lang === "ar" ? "أدلة متعمّقة في زاتكا" : "Deep-dive ZATCA guides"}
            </h2>
            <div className={`grid sm:grid-cols-2 gap-4 ${page.dir === "rtl" ? "text-right" : "text-left"}`}>
              {(page.lang === "ar"
                ? [
                    { to: "/ar/blog/zatca-phase-2", title: "المرحلة الثانية: الدليل التقني الكامل", desc: "المتطلبات، الجدول الزمني، والتنفيذ خطوة بخطوة." },
                    { to: "/ar/blog/zatca-qr-code", title: "رمز QR في فواتير زاتكا", desc: "صيغة TLV، الفروق بين المرحلتين، وأخطاء الطباعة." },
                    { to: "/ar/blog/zatca-onboarding", title: "تسجيل CSID وربط منصة فاتورة", desc: "ست خطوات لإتمام الربط في أقل من ساعة." },
                    { to: "/ar/blog/zatca-fines", title: "الغرامات وكيف تتجنّبها", desc: "جدول كامل بالعقوبات والأخطاء الأشهر." },
                  ]
                : [
                    { to: "/blog/zatca-phase-2-guide", title: "ZATCA Phase 2 — full technical guide", desc: "Requirements, timeline, and end-to-end implementation." },
                    { to: "/ar/blog/zatca-qr-code", title: "QR code on ZATCA invoices", desc: "TLV payload, phase-one vs phase-two differences." },
                    { to: "/ar/blog/zatca-onboarding", title: "CSID registration & Fatoora linking", desc: "Six steps to go live in under an hour." },
                    { to: "/ar/blog/zatca-fines", title: "ZATCA fines and how to avoid them", desc: "Full penalty table and the most common mistakes." },
                  ]
              ).map((g) => (
                <Link
                  key={g.to}
                  to={g.to}
                  className="block rounded-xl border border-border/60 bg-card/30 hover:bg-card/60 transition-colors p-5"
                >
                  <h3 className="font-medium mb-1">{g.title}</h3>
                  <p className="text-sm text-muted-foreground font-light leading-relaxed">{g.desc}</p>
                </Link>
              ))}
            </div>
          </div>
        )}
        <div className="max-w-4xl mx-auto px-6 lg:px-8 py-20 text-center">
          <h2 className="text-3xl lg:text-4xl font-light tracking-tight">
            {page.lang === "ar" ? "جاهز للبدء؟" : "Ready to get started?"}
          </h2>
          <p className="mt-4 text-muted-foreground font-light">
            {page.lang === "ar"
              ? "ابدأ مجاناً اليوم. بدون بطاقة ائتمان."
              : "Start free today. No credit card required."}
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button size="lg" asChild>
              <Link to="/register">{page.primaryCta}</Link>
            </Button>
            {alt && (
              <Button size="lg" variant="outline" asChild>
                <Link to={alt.path}>
                  {alt.lang === "ar" ? "العربية" : "English"}
                </Link>
              </Button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

/** Per-page wrapper factories so each route lazy-loads cleanly. */
export const createSeoLanding = (slug: string) => () => <SeoLanding slug={slug} />;

/* ─────────────────────────── Pricing comparison ─────────────────────────── */

type PricingRow = {
  vendor: string;
  priceLabel: string;
  priceValue: string;
  priceNote: string;
  zatca: boolean;
  accounting: boolean;
  offline: boolean;
  notes: string;
  highlight?: boolean;
};

type PricingBlock = {
  title: string;
  subtitle: string;
  cols: {
    vendor: string;
    price: string;
    zatca: string;
    accounting: string;
    offline: string;
    notes: string;
  };
  rows: PricingRow[];
  disclaimer: string;
  cta: string;
};

function getPricingComparison(lang: "en" | "ar"): PricingBlock {
  if (lang === "ar") {
    return {
      title: "مقارنة الأسعار — ماتبكس مقابل فودكس وريوا ومرن",
      subtitle:
        "أسعار شفافة لأنظمة كاشير المطاعم في المملكة العربية السعودية. ابدأ من 149 ريال للفرع مع ماتبكس.",
      cols: {
        vendor: "النظام",
        price: "السعر الشهري",
        zatca: "زاتكا 2",
        accounting: "محاسبة مدمجة",
        offline: "وضع بدون إنترنت",
        notes: "ملاحظات",
      },
      rows: [
        {
          vendor: "Matbex",
          priceLabel: "من 149 ريال",
          priceValue: "149",
          priceNote: "خطة مجانية متاحة",
          zatca: true,
          accounting: true,
          offline: true,
          notes: "POS + محاسبة + مخزون + رواتب + زاتكا في نظام واحد.",
          highlight: true,
        },
        {
          vendor: "Foodics",
          priceLabel: "من 423 ريال",
          priceValue: "423",
          priceNote: "شهرياً (باقة Starter)",
          zatca: true,
          accounting: false,
          offline: true,
          notes: "POS قوي لكن المحاسبة تتطلب تكاملاً خارجياً.",
        },
        {
          vendor: "Rewaa",
          priceLabel: "من 275 ريال",
          priceValue: "275",
          priceNote: "لكل فرع / شهرياً",
          zatca: true,
          accounting: false,
          offline: true,
          notes: "موجه أكثر للتجزئة من المطاعم.",
        },
        {
          vendor: "Marn",
          priceLabel: "حسب العرض",
          priceValue: "",
          priceNote: "لا يوجد سعر منشور",
          zatca: true,
          accounting: false,
          offline: true,
          notes: "POS مبسط بدون عمق مالي أو تكاليف فعلية.",
        },
      ],
      disclaimer:
        "الأسعار التقريبية للمنافسين مأخوذة من المواقع الرسمية ووقت آخر تحديث. قد تختلف حسب الخطة وعدد الفروع والملحقات.",
      cta: "اطلع على باقات ماتبكس",
    };
  }
  return {
    title: "Pricing comparison — Matbex vs Foodics, Rewaa, and Marn",
    subtitle:
      "Transparent pricing for restaurant POS in Saudi Arabia. Matbex starts at SAR 149 per branch.",
    cols: {
      vendor: "System",
      price: "Monthly price",
      zatca: "ZATCA Phase 2",
      accounting: "Built-in accounting",
      offline: "Offline mode",
      notes: "Notes",
    },
    rows: [
      {
        vendor: "Matbex",
        priceLabel: "From SAR 149",
        priceValue: "149",
        priceNote: "Per branch / month · ZATCA from SAR 349",
        zatca: true,
        accounting: true,
        offline: true,
        notes: "POS + accounting + inventory + payroll + ZATCA in one stack.",
        highlight: true,
      },
      {
        vendor: "Foodics",
        priceLabel: "From SAR 423",
        priceValue: "423",
        priceNote: "Per month (Starter)",
        zatca: true,
        accounting: false,
        offline: true,
        notes: "Strong POS, but accounting requires a third-party integration.",
      },
      {
        vendor: "Rewaa",
        priceLabel: "From SAR 275",
        priceValue: "275",
        priceNote: "Per branch / month",
        zatca: true,
        accounting: false,
        offline: true,
        notes: "Retail-leaning; lighter on restaurant-specific workflows.",
      },
      {
        vendor: "Marn",
        priceLabel: "Quote only",
        priceValue: "",
        priceNote: "No published price",
        zatca: true,
        accounting: false,
        offline: true,
        notes: "Lean POS without deeper financial or real-cost tracking.",
      },
    ],
    disclaimer:
      "Competitor prices are indicative and sourced from public pricing pages at time of publication. Actual cost varies by plan, branches, and add-ons.",
    cta: "See Matbex plans",
  };
}

function BoolCell({ value }: { value: boolean }) {
  return value ? (
    <Check className="h-4 w-4 text-primary mx-auto" aria-label="Yes" />
  ) : (
    <X className="h-4 w-4 text-muted-foreground/60 mx-auto" aria-label="No" />
  );
}