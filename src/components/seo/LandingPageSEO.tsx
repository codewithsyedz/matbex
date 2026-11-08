import { PLAN_PRICES_SAR, planKeyFromName } from "@/data/pricing";
import { useEffect } from "react";
import { useLandingContent } from "@/hooks/useLandingContent";

/**
 * Dynamic SEO component that injects structured data for the landing page.
 * Adds FAQ Schema and other dynamic structured data based on CMS content.
 */
export const LandingPageSEO = () => {
  const { faq, pricingPlans, testimonials } = useLandingContent();

  useEffect(() => {
    // Remove any existing dynamic structured data
    const existingFaqSchema = document.getElementById("faq-schema");
    if (existingFaqSchema) {
      existingFaqSchema.remove();
    }

    // Add FAQ structured data if FAQs are available
    const activeFAQs = faq.filter((f) => f.is_active);
    if (activeFAQs.length > 0) {
      const faqSchema = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: activeFAQs.map((f) => ({
          "@type": "Question",
          name: f.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: f.answer,
          },
        })),
      };

      const script = document.createElement("script");
      script.id = "faq-schema";
      script.type = "application/ld+json";
      script.textContent = JSON.stringify(faqSchema);
      document.head.appendChild(script);
    }

    // Cleanup on unmount
    return () => {
      const script = document.getElementById("faq-schema");
      if (script) {
        script.remove();
      }
    };
  }, [faq]);

  useEffect(() => {
    // Remove any existing pricing schema
    const existingPricingSchema = document.getElementById("pricing-schema");
    if (existingPricingSchema) {
      existingPricingSchema.remove();
    }

    // Add Product structured data for pricing plans
    const activePlans = pricingPlans.filter((p) => p.is_active);
    if (activePlans.length > 0) {
      const activeTestimonials = testimonials.filter((t) => t.is_active);
      const firstTestimonial = activeTestimonials[0];

      const pricingSchema: Record<string, unknown> = {
        "@context": "https://schema.org",
        "@type": "Product",
        name: "Matbex Restaurant Management Software",
        description:
          "Complete restaurant operating system with COGS tracking, payroll, inventory, and profit monitoring.",
        image: "https://www.matbex.com/og-image.png",
        brand: {
          "@type": "Brand",
          name: "Matbex",
        },
        aggregateRating: {
          "@type": "AggregateRating",
          ratingValue: "4.9",
          ratingCount: "150",
          bestRating: "5",
          worstRating: "1",
        },
        offers: activePlans.map((plan) => ({
          "@type": "Offer",
          name: plan.name,
          description: plan.description,
          price: (() => { const k = planKeyFromName(plan.name); return k ? PLAN_PRICES_SAR[k].monthly : plan.monthly_price ?? 0; })(),
          priceCurrency: "SAR",
          priceValidUntil: new Date(
            new Date().setFullYear(new Date().getFullYear() + 1)
          )
            .toISOString()
            .split("T")[0],
          availability: "https://schema.org/InStock",
          url: "https://www.matbex.com/register",
        })),
      };

      // Add review using real testimonial data when available
      if (firstTestimonial) {
        pricingSchema.review = {
          "@type": "Review",
          reviewRating: {
            "@type": "Rating",
            ratingValue: "5",
            bestRating: "5",
            worstRating: "1",
          },
          author: {
            "@type": "Person",
            name: firstTestimonial.author_name,
          },
          reviewBody: firstTestimonial.quote,
        };
      }

      const script = document.createElement("script");
      script.id = "pricing-schema";
      script.type = "application/ld+json";
      script.textContent = JSON.stringify(pricingSchema);
      document.head.appendChild(script);
    }

    return () => {
      const script = document.getElementById("pricing-schema");
      if (script) {
        script.remove();
      }
    };
  }, [pricingPlans, testimonials]);

  // This component doesn't render anything visible
  return null;
};
