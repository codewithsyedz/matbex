import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HELP_ARTICLES_BY_SLUG, SITE_ORIGIN } from "./seoContent";

interface HelpArticlePageProps {
  slug: string;
}

export default function HelpArticlePage({ slug }: HelpArticlePageProps) {
  const article = HELP_ARTICLES_BY_SLUG[slug];

  if (!article) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Page not found</p>
      </div>
    );
  }

  const canonical = `${SITE_ORIGIN}${article.path}`;
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: article.faq.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };

  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.description,
    inLanguage: article.lang,
    mainEntityOfPage: canonical,
    publisher: {
      "@type": "Organization",
      name: "Matbex",
      url: SITE_ORIGIN,
    },
  };

  return (
    <div dir={article.dir} lang={article.lang} className="min-h-screen bg-background text-foreground">
      <Helmet>
        <html lang={article.lang} dir={article.dir} />
        <title>{article.title}</title>
        <meta name="description" content={article.description} />
        <link rel="canonical" href={canonical} />
        <meta property="og:type" content="article" />
        <meta property="og:title" content={article.title} />
        <meta property="og:description" content={article.description} />
        <meta property="og:url" content={canonical} />
        <meta property="og:locale" content="ar_SA" />
        <meta property="og:site_name" content="Matbex" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={article.title} />
        <meta name="twitter:description" content={article.description} />
        <script type="application/ld+json">{JSON.stringify(articleLd)}</script>
        <script type="application/ld+json">{JSON.stringify(faqLd)}</script>
      </Helmet>

      <section className="border-b border-border/40">
        <div className="max-w-4xl mx-auto px-6 lg:px-8 py-16 lg:py-24">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
            <div className="text-sm text-primary font-medium">{article.heroEyebrow}</div>
            <h1 className="mt-4 text-4xl lg:text-5xl font-light tracking-tight leading-tight">{article.heroHeadline}</h1>
            <p className="mt-5 text-lg text-muted-foreground font-light leading-relaxed">{article.heroSub}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild>
                <Link to="/register">ابدأ مجاناً</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/help">
                  <ArrowLeft className="ml-2 h-4 w-4" />
                  مركز المساعدة
                </Link>
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      <main className="max-w-4xl mx-auto px-6 lg:px-8 py-14 lg:py-20 space-y-10">
        {article.sections.map((section, index) => (
          <motion.section
            key={section.title}
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.25, delay: index * 0.04 }}
            className="space-y-4"
          >
            <h2 className="text-2xl lg:text-3xl font-light tracking-tight">{section.title}</h2>
            <div className="space-y-3">
              {section.body.map((paragraph) => (
                <p key={paragraph} className="text-base text-foreground/85 leading-8 font-light">
                  {paragraph}
                </p>
              ))}
            </div>
          </motion.section>
        ))}

        <section className="rounded-xl border border-border/60 bg-card/30 p-6 lg:p-8">
          <h2 className="text-2xl lg:text-3xl font-light tracking-tight">أسئلة شائعة</h2>
          <div className="mt-6 space-y-4">
            {article.faq.map((item) => (
              <div key={item.q} className="flex gap-3 items-start">
                <CheckCircle2 className="h-5 w-5 text-primary mt-1 shrink-0" />
                <div>
                  <h3 className="font-medium">{item.q}</h3>
                  <p className="mt-1 text-sm text-muted-foreground leading-7 font-light">{item.a}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}