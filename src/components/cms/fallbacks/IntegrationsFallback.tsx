import { PageTransition } from "@/components/PageTransition";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { 
  Truck, 
  CreditCard, 
  Calculator, 
  Smartphone,
  Wifi,
  Package,
  ArrowRight,
  Check
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

export function IntegrationsFallback() {
  const integrations = [
    {
      category: "Delivery Platforms",
      icon: Truck,
      color: "emerald",
      items: [
        { name: "Talabat", description: "Sync orders and track commissions automatically", status: "available" },
        { name: "Deliveroo", description: "Real-time order management and analytics", status: "available" },
        { name: "Careem NOW", description: "Direct delivery integration", status: "coming" },
        { name: "Noon Food", description: "Complete order lifecycle tracking", status: "coming" },
      ]
    },
    {
      category: "Payment Systems",
      icon: CreditCard,
      color: "blue",
      items: [
        { name: "Network International", description: "Card payment processing", status: "available" },
        { name: "Stripe", description: "Online payments and subscriptions", status: "available" },
        { name: "Apple Pay", description: "Contactless payment support", status: "available" },
        { name: "Samsung Pay", description: "Mobile wallet integration", status: "coming" },
      ]
    },
    {
      category: "Accounting Software",
      icon: Calculator,
      color: "purple",
      items: [
        { name: "QuickBooks", description: "Automated journal entries and reconciliation", status: "available" },
        { name: "Xero", description: "Real-time financial sync", status: "available" },
        { name: "Zoho Books", description: "Complete accounting integration", status: "coming" },
        { name: "FreshBooks", description: "Invoice and expense sync", status: "coming" },
      ]
    },
    {
      category: "POS Systems",
      icon: Smartphone,
      color: "amber",
      items: [
        { name: "Foodics", description: "Full menu and sales synchronization", status: "available" },
        { name: "Lightspeed", description: "Real-time inventory updates", status: "available" },
        { name: "Square", description: "Sales and payment tracking", status: "coming" },
        { name: "Toast", description: "Complete restaurant POS integration", status: "coming" },
      ]
    },
    {
      category: "IoT & Hardware",
      icon: Wifi,
      color: "cyan",
      items: [
        { name: "Smart Scales", description: "Automatic inventory weighing", status: "available" },
        { name: "Temperature Sensors", description: "Cold chain monitoring", status: "available" },
        { name: "Receipt Printers", description: "Direct thermal printing", status: "available" },
        { name: "Barcode Scanners", description: "Fast inventory lookup", status: "available" },
      ]
    },
    {
      category: "Supply Chain",
      icon: Package,
      color: "rose",
      items: [
        { name: "Supplier Portals", description: "Automated purchase orders", status: "available" },
        { name: "Inventory Alerts", description: "Low stock notifications", status: "available" },
        { name: "Batch Tracking", description: "Expiry and lot management", status: "available" },
        { name: "Multi-location Sync", description: "Central inventory control", status: "coming" },
      ]
    },
  ];

  const colorStyles: Record<string, { bg: string; icon: string; border: string }> = {
    emerald: { bg: "bg-[#00A859]/10", icon: "text-[#00A859]", border: "border-[#00A859]/20" },
    blue: { bg: "bg-blue-500/10", icon: "text-blue-600", border: "border-blue-500/20" },
    purple: { bg: "bg-purple-500/10", icon: "text-purple-600", border: "border-purple-500/20" },
    amber: { bg: "bg-amber-500/10", icon: "text-amber-600", border: "border-amber-500/20" },
    cyan: { bg: "bg-cyan-500/10", icon: "text-cyan-600", border: "border-cyan-500/20" },
    rose: { bg: "bg-rose-500/10", icon: "text-rose-600", border: "border-rose-500/20" },
  };

  return (
    <PageTransition>
      <div className="min-h-screen bg-white">
        <LandingHeader overDark={false} />
        
        <main className="pt-24 pb-16">
          <section className="bg-gradient-to-b from-gray-50 to-white py-16">
            <div className="max-w-4xl mx-auto px-6 text-center">
              <div className="inline-flex items-center gap-2 bg-[#00A859]/10 text-[#00A859] px-4 py-2 rounded-full text-sm font-medium mb-6">
                <Wifi className="w-4 h-4" />
                Integrations
              </div>
              <h1 className="text-4xl md:text-5xl font-light text-gray-900 mb-6">
                Connect Your Entire Stack
              </h1>
              <p className="text-lg leading-relaxed text-gray-600 font-light mb-8 max-w-2xl mx-auto">
                Matbex connects with the tools you already use. Automate workflows,
                sync data in real time, and skip the manual entry.
              </p>
              <div className="flex gap-4 justify-center">
                <Button className="bg-[#00A859] hover:bg-[#00A859]/90 h-12 px-8" asChild>
                  <Link to="/register">Get Started Free</Link>
                </Button>
                <Button variant="outline" className="h-12 px-8" asChild>
                  <Link to="/docs">View API Docs</Link>
                </Button>
              </div>
            </div>
          </section>

          <section className="max-w-7xl mx-auto px-6 py-16">
            <div className="space-y-16">
              {integrations.map((category) => {
                const colors = colorStyles[category.color];
                const Icon = category.icon;
                
                return (
                  <div key={category.category}>
                    <div className="flex items-center gap-3 mb-8">
                      <div className={`w-10 h-10 ${colors.bg} rounded-xl flex items-center justify-center`}>
                        <Icon className={`w-5 h-5 ${colors.icon}`} />
                      </div>
                      <h2 className="text-2xl font-medium text-gray-900">
                        {category.category}
                      </h2>
                    </div>
                    
                    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
                      {category.items.map((item) => (
                        <div 
                          key={item.name}
                          className={`p-5 rounded-xl border ${colors.border} ${colors.bg} hover:shadow-md transition-shadow`}
                        >
                          <div className="flex items-start justify-between mb-2">
                            <h3 className="font-medium text-gray-900">{item.name}</h3>
                            {item.status === "available" ? (
                              <span className="flex items-center gap-1 text-xs text-[#00A859] bg-[#00A859]/10 px-2 py-0.5 rounded-full">
                                <Check className="w-3 h-3" />
                                Live
                              </span>
                            ) : (
                              <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                                Coming Soon
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-600 font-light">
                            {item.description}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="bg-gray-50 py-16">
            <div className="max-w-4xl mx-auto px-6 text-center">
              <h2 className="text-2xl font-medium text-gray-900 mb-4">
                Need a Custom Integration?
              </h2>
              <p className="text-gray-600 font-light mb-8 max-w-xl mx-auto">
                Our API is built for developers. Build custom integrations or request 
                new partnerships for your specific needs.
              </p>
              <div className="flex gap-4 justify-center">
                <Button variant="outline" className="h-12 px-8" asChild>
                  <Link to="/api" className="flex items-center gap-2">
                    Explore API <ArrowRight className="w-4 h-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </section>
        </main>

        <LandingFooter />
      </div>
    </PageTransition>
  );
}
