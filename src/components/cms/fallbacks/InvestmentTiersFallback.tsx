import { PageTransition } from "@/components/PageTransition";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { 
  Building2, 
  Users, 
  Globe, 
  Shield, 
  Zap,
  Phone,
  Check,
  ArrowRight,
  Crown,
  Gem,
  Star
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

export function InvestmentTiersFallback() {
  const tiers = [
    {
      name: "Growth",
      icon: Star,
      price: "Custom",
      description: "For expanding restaurant groups seeking operational excellence",
      color: "blue",
      features: [
        "Up to 10 restaurant locations",
        "Dedicated account manager",
        "Priority support (4-hour SLA)",
        "Custom integrations",
        "Advanced analytics dashboard",
        "Multi-location consolidation",
        "Quarterly business reviews",
        "API access with higher limits",
      ],
      cta: "Contact Sales",
      popular: false,
    },
    {
      name: "Enterprise",
      icon: Crown,
      price: "Custom",
      description: "For large chains requiring enterprise-grade infrastructure",
      color: "emerald",
      features: [
        "Unlimited restaurant locations",
        "Dedicated success team",
        "24/7 priority support (1-hour SLA)",
        "Custom development hours",
        "White-label options",
        "On-premise deployment available",
        "Executive business reviews",
        "Unlimited API access",
        "SSO & advanced security",
        "Custom data retention policies",
      ],
      cta: "Schedule Demo",
      popular: true,
    },
    {
      name: "Strategic Partner",
      icon: Gem,
      price: "Partnership",
      description: "For franchises and investors seeking long-term collaboration",
      color: "purple",
      features: [
        "Everything in Enterprise",
        "Revenue-based pricing options",
        "Equity partnership opportunities",
        "Product roadmap influence",
        "Co-marketing opportunities",
        "Exclusive early feature access",
        "Dedicated engineering support",
        "Custom SLA agreements",
        "Joint go-to-market strategy",
        "Board-level reporting",
      ],
      cta: "Partner With Us",
      popular: false,
    },
  ];

  const benefits = [
    {
      icon: Building2,
      title: "Multi-Location Management",
      description: "Centralized control across all your restaurant locations with real-time data synchronization"
    },
    {
      icon: Users,
      title: "Dedicated Success Team",
      description: "Your personal team of experts ensuring smooth implementation and ongoing optimization"
    },
    {
      icon: Globe,
      title: "Global Infrastructure",
      description: "Enterprise-grade infrastructure with 99.99% uptime and global edge deployment"
    },
    {
      icon: Shield,
      title: "Enterprise Security",
      description: "SOC 2 Type II compliance, SSO integration, and advanced access controls"
    },
    {
      icon: Zap,
      title: "Custom Integrations",
      description: "Direct integration with your existing ERP, POS, and accounting systems"
    },
    {
      icon: Phone,
      title: "24/7 Support",
      description: "Round-the-clock support with guaranteed response times and escalation paths"
    },
  ];

  const colorStyles: Record<string, { bg: string; border: string; icon: string; button: string }> = {
    blue: { 
      bg: "bg-blue-500/5", 
      border: "border-blue-500/20", 
      icon: "text-blue-600",
      button: "bg-blue-600 hover:bg-blue-700"
    },
    emerald: { 
      bg: "bg-[#00A859]/5", 
      border: "border-[#00A859]/20", 
      icon: "text-[#00A859]",
      button: "bg-[#00A859] hover:bg-[#00A859]/90"
    },
    purple: { 
      bg: "bg-purple-500/5", 
      border: "border-purple-500/20", 
      icon: "text-purple-600",
      button: "bg-purple-600 hover:bg-purple-700"
    },
  };

  return (
    <PageTransition>
      <div className="min-h-screen bg-white">
        <LandingHeader overDark={false} />
        
        <main className="pt-24 pb-16">
          {/* Hero Section */}
          <section className="bg-gradient-to-b from-gray-50 to-white py-16">
            <div className="max-w-4xl mx-auto px-6 text-center">
              <div className="inline-flex items-center gap-2 bg-[#00A859]/10 text-[#00A859] px-4 py-2 rounded-full text-sm font-medium mb-6">
                <Crown className="w-4 h-4" />
                Investment Tiers
              </div>
              <h1 className="text-4xl md:text-5xl font-light text-gray-900 mb-6">
                Scale with Confidence
              </h1>
              <p className="text-lg text-gray-600 font-light mb-8 max-w-2xl mx-auto">
                Enterprise-grade solutions for restaurant groups, franchises, and strategic investors. 
                Custom pricing tailored to your growth trajectory.
              </p>
              <div className="flex gap-4 justify-center">
                <Button className="bg-[#00A859] hover:bg-[#00A859]/90 h-12 px-8">
                  Schedule Consultation
                </Button>
                <Button variant="outline" className="h-12 px-8" asChild>
                  <Link to="/#pricing">View Standard Plans</Link>
                </Button>
              </div>
            </div>
          </section>

          {/* Tiers Grid */}
          <section className="max-w-7xl mx-auto px-6 py-16">
            <div className="grid lg:grid-cols-3 gap-8">
              {tiers.map((tier) => {
                const colors = colorStyles[tier.color];
                const Icon = tier.icon;
                
                return (
                  <div 
                    key={tier.name}
                    className={`relative rounded-2xl border-2 p-8 transition-all hover:shadow-xl ${
                      tier.popular 
                        ? 'border-[#00A859] shadow-lg' 
                        : `${colors.border} hover:border-gray-300`
                    }`}
                  >
                    {tier.popular && (
                      <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                        <span className="bg-[#00A859] text-white text-xs font-medium px-4 py-1.5 rounded-full">
                          Most Popular
                        </span>
                      </div>
                    )}
                    
                    <div className={`w-14 h-14 ${colors.bg} rounded-2xl flex items-center justify-center mb-6`}>
                      <Icon className={`w-7 h-7 ${colors.icon}`} />
                    </div>
                    
                    <h3 className="text-2xl font-medium text-gray-900 mb-2">{tier.name}</h3>
                    <p className="text-gray-600 font-light mb-4">{tier.description}</p>
                    
                    <div className="mb-6">
                      <span className="text-3xl font-medium text-gray-900">{tier.price}</span>
                      <span className="text-gray-500 font-light ml-2">pricing</span>
                    </div>
                    
                    <ul className="space-y-3 mb-8">
                      {tier.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-3">
                          <Check className={`w-5 h-5 ${colors.icon} flex-shrink-0 mt-0.5`} />
                          <span className="text-gray-700 font-light text-sm">{feature}</span>
                        </li>
                      ))}
                    </ul>
                    
                    <Button 
                      className={`w-full h-12 text-white ${colors.button}`}
                    >
                      {tier.cta}
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Benefits Grid */}
          <section className="bg-gray-50 py-16">
            <div className="max-w-7xl mx-auto px-6">
              <div className="text-center mb-12">
                <h2 className="text-2xl md:text-3xl font-medium text-gray-900 mb-4">
                  Enterprise Benefits
                </h2>
                <p className="text-gray-600 font-light max-w-xl mx-auto">
                  Everything you need to manage restaurant operations at scale
                </p>
              </div>
              
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {benefits.map((benefit) => (
                  <div 
                    key={benefit.title}
                    className="bg-white p-6 rounded-xl border border-gray-200 hover:shadow-lg transition-shadow"
                  >
                    <div className="w-12 h-12 bg-[#00A859]/10 rounded-xl flex items-center justify-center mb-4">
                      <benefit.icon className="w-6 h-6 text-[#00A859]" />
                    </div>
                    <h3 className="font-medium text-gray-900 mb-2">{benefit.title}</h3>
                    <p className="text-sm text-gray-600 font-light">{benefit.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Case Study Teaser */}
          <section className="max-w-6xl mx-auto px-6 py-16">
            <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-3xl p-8 md:p-12 text-center">
              <div className="inline-flex items-center gap-2 bg-white/10 text-white/80 px-4 py-2 rounded-full text-sm font-medium mb-6">
                <Building2 className="w-4 h-4" />
                Success Story
              </div>
              <h2 className="text-2xl md:text-3xl font-light text-white mb-4">
                "Matbex transformed how we manage our 45 locations"
              </h2>
              <p className="text-gray-300 font-light mb-2 max-w-2xl mx-auto">
                - Regional Director, Major Restaurant Chain
              </p>
              <div className="flex items-center justify-center gap-8 mt-8">
                <div className="text-center">
                  <div className="text-3xl font-medium text-[#00A859]">45</div>
                  <div className="text-sm text-gray-400">Locations</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-medium text-[#00A859]">23%</div>
                  <div className="text-sm text-gray-400">Cost Reduction</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-medium text-[#00A859]">4hrs</div>
                  <div className="text-sm text-gray-400">Saved Daily</div>
                </div>
              </div>
            </div>
          </section>

          {/* CTA Section */}
          <section className="max-w-4xl mx-auto px-6 py-16 text-center">
            <Phone className="w-12 h-12 text-[#00A859] mx-auto mb-4" />
            <h2 className="text-2xl font-medium text-gray-900 mb-4">
              Ready to Transform Your Operations?
            </h2>
            <p className="text-gray-600 font-light mb-8 max-w-xl mx-auto">
              Schedule a personalized demo with our enterprise team to discuss 
              your specific requirements and custom pricing options.
            </p>
            <div className="flex gap-4 justify-center flex-wrap">
              <Button className="bg-[#00A859] hover:bg-[#00A859]/90 h-12 px-8">
                Schedule Demo
              </Button>
              <Button variant="outline" className="h-12 px-8">
                Download Brochure
              </Button>
            </div>
          </section>
        </main>

        <LandingFooter />
      </div>
    </PageTransition>
  );
}
