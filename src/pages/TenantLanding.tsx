import { useEffect, useMemo } from "react";
import { toCdnUrl } from "@/lib/imageCdn";
import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ShoppingBag, MapPin, Phone, Clock } from "lucide-react";
import { db } from "@/integrations/db/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSubdomainTenant } from "@/hooks/useSubdomainTenant";

/**
 * Public landing page rendered when a visitor lands on `{slug}.matbex.com`.
 * Reads the tenant's seeded `tenant_pages` row + restaurant info and renders
 * a minimal, fast, conversion-focused page with a single primary CTA: order online.
 */
export default function TenantLanding() {
  const { tenantId, redirectTo, notFound, isLoading } = useSubdomainTenant();

  // Old-slug → new-slug redirect (90-day window)
  useEffect(() => {
    if (redirectTo && typeof window !== "undefined") {
      const host = window.location.host;
      const newHost = host.replace(/^[^.]+/, redirectTo);
      window.location.replace(`${window.location.protocol}//${newHost}${window.location.pathname}`);
    }
  }, [redirectTo]);

  const { data, isLoading: dataLoading } = useQuery({
    queryKey: ["tenant-landing", tenantId],
    enabled: !!tenantId,
    staleTime: 60_000,
    queryFn: async () => {
      if (!tenantId) return null;
      const sb = db as any;
      const [tenantRes, restaurantRes, pageRes, brandingRes] = await Promise.all([
        sb.from("tenants").select("id,name,slug").eq("id", tenantId).maybeSingle(),
        sb.from("restaurants_public").select("id,name,currency,timezone").eq("tenant_id", tenantId).eq("is_primary", true).maybeSingle(),
        sb.from("tenant_pages").select("*").eq("tenant_id", tenantId).eq("page_type", "landing").maybeSingle(),
        sb.from("restaurant_branding").select("*").eq("tenant_id", tenantId).maybeSingle(),
      ]);
      return {
        tenant: tenantRes.data,
        restaurant: restaurantRes.data,
        page: pageRes.data,
        branding: brandingRes.data,
      };
    },
  });

  const restaurantId = data?.restaurant?.id;

  const { data: topItems } = useQuery({
    queryKey: ["tenant-landing-menu", restaurantId],
    enabled: !!restaurantId,
    staleTime: 60_000,
    queryFn: async () => {
      if (!restaurantId) return [];
      const sb = db as any;
      const { data: items } = await sb
        .from("menu_items")
        .select("id,name,image_url,price")
        .eq("restaurant_id", restaurantId)
        .eq("is_available", true)
        .limit(6);
      return (items || []) as Array<{ id: string; name: string; image_url: string | null; price: number | null }>;
    },
  });

  const brandColor = data?.branding?.primary_color || "#00A859";
  const displayName =
    data?.branding?.business_display_name || data?.restaurant?.name || data?.tenant?.name || "";

  const jsonLd = useMemo(() => {
    if (!data?.tenant) return null;
    return {
      "@context": "https://schema.org",
      "@type": "Restaurant",
      name: displayName,
      url: typeof window !== "undefined" ? window.location.origin : "",
    };
  }, [data, displayName]);

  if (isLoading || (tenantId && dataLoading)) {
    return (
      <div className="min-h-screen bg-white p-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <Skeleton className="h-12 w-2/3" />
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (notFound || (!tenantId && !isLoading)) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 text-center">
        <h1 className="text-3xl font-light text-gray-900">Storefront not found</h1>
        <p className="text-gray-500 mt-3 max-w-md">
          This address isn't connected to an active restaurant. If you're the owner,
          check your storefront settings.
        </p>
        <Button asChild variant="outline" className="mt-6">
          <a href="https://www.matbex.com">Visit matbex.com</a>
        </Button>
      </div>
    );
  }

  if (!data?.page?.is_published) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 text-center">
        <h1 className="text-3xl font-light text-gray-900">Coming soon</h1>
        <p className="text-gray-500 mt-3">{displayName} is preparing their online storefront.</p>
      </div>
    );
  }

  const orderHref = restaurantId ? `/order/${restaurantId}` : undefined;

  return (
    <div className="min-h-screen bg-white">
      <Helmet>
        <title>{`${displayName} · Order online`}</title>
        <meta name="description" content={data.page?.meta_description || `Order online from ${displayName} for delivery or pickup.`} />
        <link rel="canonical" href={typeof window !== "undefined" ? window.location.origin + window.location.pathname : ""} />
        {jsonLd && <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>}
      </Helmet>

      {/* Header */}
      <header className="border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {data.branding?.logo_url ? (
              <img src={data.branding.logo_url} alt={displayName} className="h-8 w-8 rounded-md object-contain" />
            ) : (
              <div className="h-8 w-8 rounded-md" style={{ background: brandColor }} />
            )}
            <span className="font-medium tracking-[-0.005em] text-gray-900">{displayName}</span>
          </div>
          {orderHref && (
            <Button asChild className="text-white shadow-none" style={{ background: brandColor }}>
              <Link to={orderHref}>
                <ShoppingBag className="w-4 h-4 mr-2" />
                Order online
              </Link>
            </Button>
          )}
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 py-16 lg:py-24">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="max-w-2xl"
        >
          <h1 className="text-4xl md:text-5xl font-semibold tracking-[-0.01em] text-gray-900 leading-[1.05]">
            {data.page?.hero_title || `Welcome to ${displayName}`}
          </h1>
          <p className="mt-5 text-lg text-gray-600 font-light leading-relaxed">
            {data.page?.hero_subtitle || "Fresh, fast, and made for delivery or pickup."}
          </p>
          {orderHref && (
            <Button asChild size="lg" className="mt-8 text-white h-12 px-6 shadow-none" style={{ background: brandColor }}>
              <Link to={orderHref}>
                <ShoppingBag className="w-4 h-4 mr-2" />
                Start your order
              </Link>
            </Button>
          )}
        </motion.div>
      </section>

      {/* Menu preview */}
      {topItems && topItems.length > 0 && data.page?.show_menu_sync !== false && (
        <section className="max-w-5xl mx-auto px-6 pb-16">
          <div className="flex items-end justify-between mb-6">
            <h2 className="text-2xl font-light tracking-[-0.01em] text-gray-900">Popular right now</h2>
            {orderHref && (
              <Link to={orderHref} className="text-sm font-medium hover:opacity-80" style={{ color: brandColor }}>
                See full menu →
              </Link>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {topItems.map((item: any) => (
              <Link
                key={item.id}
                to={orderHref || "#"}
                className="group rounded-lg border border-gray-100 overflow-hidden hover:border-gray-200 transition-colors"
              >
                <div className="aspect-square bg-gray-50 flex items-center justify-center overflow-hidden">
                  {item.image_url ? (
                    <img
                      src={toCdnUrl(item.image_url) || ""}
                      alt={item.name}
                      loading="lazy"
                      className="w-full h-full object-contain p-4 group-hover:scale-[1.02] transition-transform"
                    />
                  ) : (
                    <ShoppingBag className="w-8 h-8 text-gray-300" />
                  )}
                </div>
                <div className="p-3">
                  <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                  {item.price != null && (
                    <p className="text-sm text-gray-500 tabular-nums mt-0.5">﷼{Number(item.price).toFixed(2)}</p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Quick info row */}
      <section className="border-t border-gray-100">
        <div className="max-w-5xl mx-auto px-6 py-10 grid sm:grid-cols-3 gap-6">
          <InfoCell icon={<Clock className="w-4 h-4" />} label="Hours" value="Open today" />
          <InfoCell icon={<MapPin className="w-4 h-4" />} label="Location" value="View on map" />
          <InfoCell icon={<Phone className="w-4 h-4" />} label="Contact" value="Call restaurant" />
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100">
        <div className="max-w-5xl mx-auto px-6 py-6 flex items-center justify-between text-xs text-gray-600">
          <span>© {new Date().getFullYear()} {displayName}</span>
          <a href="https://www.matbex.com" target="_blank" rel="noopener noreferrer" className="hover:text-gray-900">
            Powered by Matbex
          </a>
        </div>
      </footer>
    </div>
  );
}

function InfoCell({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 text-gray-400">{icon}</div>
      <div>
        <p className="text-[11px] font-medium text-gray-500 uppercase tracking-[0.06em]">{label}</p>
        <p className="text-sm text-gray-900 mt-0.5">{value}</p>
      </div>
    </div>
  );
}