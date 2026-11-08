import { PageTransition } from "@/components/PageTransition";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { 
  Code, 
  Key, 
  Zap, 
  Shield, 
  BookOpen,
  Terminal,
  Webhook,
  Database,
  Copy,
  Check
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { useState } from "react";

export function APIFallback() {
  const [copiedEndpoint, setCopiedEndpoint] = useState<string | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedEndpoint(id);
    setTimeout(() => setCopiedEndpoint(null), 2000);
  };

  const features = [
    { icon: Zap, title: "RESTful Design", description: "Clean, predictable endpoints following REST conventions" },
    { icon: Shield, title: "OAuth 2.0 Security", description: "Industry-standard authentication and authorization" },
    { icon: Webhook, title: "Webhooks", description: "Real-time event notifications for all data changes" },
    { icon: Database, title: "Rate Limiting", description: "Generous limits with clear headers and graceful handling" },
  ];

  const endpoints = [
    { method: "GET", path: "/api/v1/sales", description: "Retrieve sales data with filtering and pagination" },
    { method: "POST", path: "/api/v1/inventory", description: "Create or update inventory items" },
    { method: "GET", path: "/api/v1/reports/profit", description: "Generate profit & loss reports" },
    { method: "POST", path: "/api/v1/webhooks", description: "Register webhook endpoints for events" },
  ];

  const codeExample = `// Initialize the Matbex client
import { Matbex } from '@matbex/sdk';

const client = new Matbex({
  apiKey: process.env.MATBEX_API_KEY,
  restaurantId: 'rest_abc123'
});

// Fetch today's sales
const sales = await client.sales.list({
  date: '2024-01-15',
  include: ['transactions', 'breakdown']
});`;

  return (
    <PageTransition>
      <div className="min-h-screen bg-white">
        <LandingHeader overDark={false} />
        
        <main className="pt-24 pb-16">
          <section className="bg-gradient-to-b from-gray-900 to-gray-800 py-20">
            <div className="max-w-4xl mx-auto px-6 text-center">
              <div className="inline-flex items-center gap-2 bg-[#00A859]/20 text-[#00A859] px-4 py-2 rounded-full text-sm font-medium mb-6">
                <Code className="w-4 h-4" />
                Developer API
              </div>
              <h1 className="text-4xl md:text-5xl font-light text-white mb-6">
                Build with Matbex API
              </h1>
              <p className="text-lg leading-relaxed text-gray-300 font-light mb-8 max-w-2xl mx-auto">
                Flexible APIs to bring restaurant operations into your
                applications. Full access to sales, inventory, staff, and reporting data.
              </p>
              <div className="flex gap-4 justify-center">
                <Button className="bg-[#00A859] hover:bg-[#00A859]/90 h-12 px-8">
                  Get API Key
                </Button>
                <Button variant="outline" className="h-12 px-8 border-gray-600 text-white hover:bg-gray-700" asChild>
                  <Link to="/docs">Read Docs</Link>
                </Button>
              </div>
            </div>
          </section>

          <section className="max-w-6xl mx-auto px-6 py-16">
            <div className="text-center mb-12">
              <h2 className="text-2xl font-medium text-gray-900 mb-4">Built for Developers</h2>
              <p className="text-gray-600 font-light max-w-xl mx-auto">
                Everything you need to integrate Matbex into your workflow
              </p>
            </div>
            
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
              {features.map((feature) => (
                <div key={feature.title} className="p-6 rounded-xl border border-gray-200 hover:shadow-lg transition-shadow">
                  <div className="w-12 h-12 bg-[#00A859]/10 rounded-xl flex items-center justify-center mb-4">
                    <feature.icon className="w-6 h-6 text-[#00A859]" />
                  </div>
                  <h3 className="font-medium text-gray-900 mb-2">{feature.title}</h3>
                  <p className="text-sm text-gray-600 font-light">{feature.description}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="bg-gray-50 py-16">
            <div className="max-w-6xl mx-auto px-6">
              <div className="grid lg:grid-cols-2 gap-12 items-center">
                <div>
                  <h2 className="text-2xl font-medium text-gray-900 mb-4">Simple, Intuitive SDK</h2>
                  <p className="text-gray-600 leading-relaxed font-light mb-6">
                    Our official SDK keeps integration straightforward. Available for JavaScript, Python, and PHP.
                  </p>
                  <div className="space-y-4">
                    {["Full TypeScript definitions", "Automatic retry and error handling", "Pagination helpers included", "Webhook signature verification"].map((item) => (
                      <div key={item} className="flex items-center gap-3">
                        <Check className="w-5 h-5 text-[#00A859]" />
                        <span className="text-gray-700">{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
                
                <div className="bg-gray-900 rounded-2xl p-6 overflow-hidden">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-3 h-3 rounded-full bg-red-500" />
                    <div className="w-3 h-3 rounded-full bg-yellow-500" />
                    <div className="w-3 h-3 rounded-full bg-green-500" />
                    <span className="text-gray-400 text-sm ml-2">example.ts</span>
                  </div>
                  <pre className="text-sm text-gray-300 overflow-x-auto">
                    <code>{codeExample}</code>
                  </pre>
                </div>
              </div>
            </div>
          </section>

          <section className="max-w-6xl mx-auto px-6 py-16">
            <div className="text-center mb-12">
              <h2 className="text-2xl font-medium text-gray-900 mb-4">Popular Endpoints</h2>
            </div>
            
            <div className="space-y-4">
              {endpoints.map((endpoint, index) => (
                <div key={index} className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-200">
                  <div className="flex items-center gap-4">
                    <span className={`px-3 py-1 rounded-md text-xs font-mono font-medium ${
                      endpoint.method === 'GET' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                    }`}>
                      {endpoint.method}
                    </span>
                    <code className="text-sm text-gray-900 font-mono">{endpoint.path}</code>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-gray-600 hidden md:block">{endpoint.description}</span>
                    <button onClick={() => copyToClipboard(endpoint.path, endpoint.path)} className="p-2 hover:bg-gray-200 rounded-lg">
                      {copiedEndpoint === endpoint.path ? <Check className="w-4 h-4 text-[#00A859]" /> : <Copy className="w-4 h-4 text-gray-500" />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="bg-gray-900 py-16">
            <div className="max-w-4xl mx-auto px-6 text-center">
              <Key className="w-12 h-12 text-[#00A859] mx-auto mb-4" />
              <h2 className="text-2xl font-medium text-white mb-4">Secure Authentication</h2>
              <p className="text-gray-300 font-light mb-8 max-w-xl mx-auto">
                All API requests are authenticated using API keys with granular permission controls.
              </p>
              <div className="bg-gray-800 rounded-xl p-4 max-w-xl mx-auto">
                <code className="text-[#00A859] text-sm">Authorization: Bearer sk_live_xxxxxxxxxxxxxxxx</code>
              </div>
            </div>
          </section>

          <section className="max-w-4xl mx-auto px-6 py-16 text-center">
            <Terminal className="w-12 h-12 text-[#00A859] mx-auto mb-4" />
            <h2 className="text-2xl font-medium text-gray-900 mb-4">Ready to Start Building?</h2>
            <div className="flex gap-4 justify-center">
              <Button className="bg-[#00A859] hover:bg-[#00A859]/90 h-12 px-8" asChild>
                <Link to="/register">Create Free Account</Link>
              </Button>
              <Button variant="outline" className="h-12 px-8" asChild>
                <Link to="/docs" className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4" /> Full Documentation
                </Link>
              </Button>
            </div>
          </section>
        </main>

        <LandingFooter />
      </div>
    </PageTransition>
  );
}
