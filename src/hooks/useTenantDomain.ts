import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface TenantDomain {
  id: string;
  tenant_id: string;
  subdomain: string | null;
  custom_domain: string | null;
  domain_status: string;
  ssl_status: string | null;
  verification_token: string | null;
  dns_verified_at: string | null;
  verification_error?: string | null;
  cf_hostname_id?: string | null;
  last_verified_at?: string | null;
  created_at: string;
  updated_at: string;
}

interface TenantPage {
  id: string;
  tenant_id: string;
  restaurant_id: string | null;
  page_type: string;
  title: string | null;
  meta_description: string | null;
  og_image_url: string | null;
  theme: string;
  hero_image_url: string | null;
  hero_title: string | null;
  hero_subtitle: string | null;
  show_menu_sync: boolean;
  show_hours: boolean;
  show_location: boolean;
  custom_css: string | null;
  is_published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

// Generate a random verification token
const generateVerificationToken = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

export function useTenantDomain() {
  const { tenant, restaurant } = useAuth();
  const tenantId = tenant?.id;
  const restaurantId = restaurant?.id;
  const queryClient = useQueryClient();

  // Fetch tenant domain
  const { data: domain, isLoading: domainLoading } = useQuery({
    queryKey: ["tenant-domain", tenantId],
    queryFn: async () => {
      if (!tenantId) return null;
      const { data, error } = await db
        .from("tenant_domains")
        .select("*")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      
      if (error) throw error;
      return data as TenantDomain | null;
    },
    enabled: !!tenantId,
  });

  // Auto-poll Cloudflare SSL status while a custom domain is verifying or
  // provisioning. Stops automatically once SSL goes active or fails.
  const shouldPollSsl =
    !!domain?.custom_domain &&
    !!domain?.cf_hostname_id &&
    (domain.ssl_status === "provisioning" ||
      domain.ssl_status === "pending" ||
      domain.domain_status === "verifying");

  const sslPoll = useQuery({
    queryKey: ["tenant-domain-ssl-poll", domain?.id],
    queryFn: async () => {
      if (!domain?.id) return null;
      const { data, error } = await db.functions.invoke("poll-domain-ssl", {
        body: { domain_id: domain.id },
      });
      if (error) throw error;
      return data as {
        polled: boolean;
        ssl_status: string | null;
        domain_status?: string;
      } | null;
    },
    enabled: shouldPollSsl,
    refetchInterval: shouldPollSsl ? 15000 : false,
    refetchOnWindowFocus: false,
    staleTime: 0,
  });

  // When the poll reports a state change, refresh the cached domain row.
  useEffect(() => {
    const next = sslPoll.data;
    if (!next || !domain) return;
    const sslChanged = next.ssl_status && next.ssl_status !== domain.ssl_status;
    const statusChanged = next.domain_status && next.domain_status !== domain.domain_status;
    if (sslChanged || statusChanged) {
      queryClient.invalidateQueries({ queryKey: ["tenant-domain", tenantId] });
      if (next.ssl_status === "active" && domain.ssl_status !== "active") {
        toast.success("SSL certificate is now active.");
      }
    }
  }, [sslPoll.data, domain, queryClient, tenantId]);

  // Fetch or auto-create tenant page
  const { data: page, isLoading: pageLoading } = useQuery({
    queryKey: ["tenant-page", tenantId, restaurantId],
    queryFn: async () => {
      if (!tenantId) return null;
      
      // Try to fetch existing page
      const { data: existingPage, error: fetchError } = await db
        .from("tenant_pages")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("page_type", "landing")
        .maybeSingle();
      
      if (fetchError) throw fetchError;
      
      // If page exists, return it
      if (existingPage) {
        return existingPage as TenantPage;
      }
      
      // Auto-create a new landing page for this tenant
      const { data: newPage, error: createError } = await db
        .from("tenant_pages")
        .insert({
          tenant_id: tenantId,
          restaurant_id: restaurantId,
          page_type: "landing",
          title: restaurant?.name || "Welcome",
          theme: "urban-cafe",
          hero_title: `Welcome to ${restaurant?.name || "Our Restaurant"}`,
          hero_subtitle: "Experience the finest cuisine",
        })
        .select()
        .single();
      
      if (createError) {
        console.error("Failed to auto-create page:", createError);
        throw createError;
      }
      
      // Initialize default blocks for the new page
      if (newPage) {
        const defaultBlocks = [
          { page_id: newPage.id, block_type: 'hero', block_order: 0, content: { title: newPage.hero_title, subtitle: newPage.hero_subtitle }, is_visible: true },
          { page_id: newPage.id, block_type: 'menu', block_order: 1, content: { categories: [], show_prices: true, show_images: true, enable_live_sync: true, menu_type: 'all', show_chefs_specials: true }, is_visible: true },
          { page_id: newPage.id, block_type: 'hours', block_order: 2, content: { hours: [
            { day: 'Monday', open: '11:00', close: '22:00' },
            { day: 'Tuesday', open: '11:00', close: '22:00' },
            { day: 'Wednesday', open: '11:00', close: '22:00' },
            { day: 'Thursday', open: '11:00', close: '22:00' },
            { day: 'Friday', open: '11:00', close: '23:00' },
            { day: 'Saturday', open: '10:00', close: '23:00' },
            { day: 'Sunday', open: '10:00', close: '21:00' },
          ] }, is_visible: true },
          { page_id: newPage.id, block_type: 'location', block_order: 3, content: { address: '123 Main Street', phone: '+1 234 567 890' }, is_visible: true },
          { page_id: newPage.id, block_type: 'cta', block_order: 4, content: { heading: 'Ready to Dine?', description: 'Book your table today', button_text: 'Make a Reservation', button_link: '#' }, is_visible: true },
        ];
        
        await db.from("tenant_page_blocks").insert(defaultBlocks);
      }
      
      return newPage as TenantPage;
    },
    enabled: !!tenantId,
  });

  // Check subdomain availability
  const checkSubdomainAvailability = async (subdomain: string): Promise<boolean> => {
    const normalized = subdomain.toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (normalized.length < 3) return false;
    
    const { data, error } = await db
      .from("tenant_domains")
      .select("id")
      .eq("subdomain", normalized)
      .neq("tenant_id", tenantId || "")
      .maybeSingle();
    
    if (error) return false;
    return !data;
  };

  // Create or update subdomain
  const subdomainMutation = useMutation({
    mutationFn: async (subdomain: string) => {
      if (!tenantId) throw new Error("No tenant ID");
      
      const normalized = subdomain.toLowerCase().replace(/[^a-z0-9-]/g, "");
      
      // Check if domain record exists
      if (domain) {
        const { data, error } = await db
          .from("tenant_domains")
          .update({ 
            subdomain: normalized,
            domain_status: "active",
            updated_at: new Date().toISOString()
          })
          .eq("id", domain.id)
          .select()
          .single();
        
        if (error) throw error;
        return data;
      } else {
        const { data, error } = await db
          .from("tenant_domains")
          .insert({
            tenant_id: tenantId,
            subdomain: normalized,
            domain_status: "active",
          })
          .select()
          .single();
        
        if (error) throw error;
        return data;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-domain", tenantId] });
      toast.success("Subdomain configured.");
    },
    onError: (error: Error) => {
      if (error.message.includes("duplicate")) {
        toast.error("This subdomain is already reserved");
      } else {
        toast.error("Failed to configure subdomain");
      }
    },
  });

  // Save custom domain
  const customDomainMutation = useMutation({
    mutationFn: async (customDomainValue: string) => {
      if (!tenantId) throw new Error("No tenant ID");
      
      const normalized = customDomainValue.toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
      const verificationToken = generateVerificationToken();
      
      if (domain) {
        const { data, error } = await db
          .from("tenant_domains")
          .update({ 
            custom_domain: normalized,
            domain_status: "pending",
            ssl_status: "pending",
            verification_token: verificationToken,
            dns_verified_at: null,
            updated_at: new Date().toISOString()
          })
          .eq("id", domain.id)
          .select()
          .single();
        
        if (error) throw error;
        return data;
      } else {
        const { data, error } = await db
          .from("tenant_domains")
          .insert({
            tenant_id: tenantId,
            custom_domain: normalized,
            domain_status: "pending",
            ssl_status: "pending",
            verification_token: verificationToken,
          })
          .select()
          .single();
        
        if (error) throw error;
        return data;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-domain", tenantId] });
      toast.success("Custom domain initialized. Configure DNS to complete.");
    },
    onError: (error: Error) => {
      if (error.message.includes("duplicate")) {
        toast.error("This domain is mapped to another account");
      } else {
        toast.error("Failed to initialize custom domain");
      }
    },
  });

  // Verify domain DNS
  const verifyDomainMutation = useMutation({
    mutationFn: async () => {
      if (!domain?.custom_domain) throw new Error("No custom domain to verify");

      // Optimistically mark as verifying
      await db
        .from("tenant_domains")
        .update({
          domain_status: "verifying",
          updated_at: new Date().toISOString(),
        })
        .eq("id", domain.id);

      const { data, error } = await db.functions.invoke("verify-custom-domain", {
        body: { domain_id: domain.id },
      });

      if (error) throw error;
      if (!data) throw new Error("No response from verification service");
      return data as {
        verified: boolean;
        txt_ok: boolean;
        cname_ok: boolean;
        ssl_status: string | null;
        message: string;
      };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["tenant-domain", tenantId] });
      if (result?.verified) {
        toast.success("Domain verified. SSL certificate provisioning initiated.");
      } else {
        toast.error(result?.message || "DNS verification unsuccessful.");
      }
    },
    onError: (err: Error) => {
      queryClient.invalidateQueries({ queryKey: ["tenant-domain", tenantId] });
      toast.error(err.message || "DNS verification failed.");
    },
  });

  // Remove custom domain
  const removeDomainMutation = useMutation({
    mutationFn: async () => {
      if (!domain) throw new Error("No domain record");
      
      const { data, error } = await db
        .from("tenant_domains")
        .update({ 
          custom_domain: null,
          domain_status: domain.subdomain ? "active" : "pending",
          ssl_status: null,
          verification_token: null,
          dns_verified_at: null,
          updated_at: new Date().toISOString()
        })
        .eq("id", domain.id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-domain", tenantId] });
      toast.success("Custom domain disconnected");
    },
    onError: () => {
      toast.error("Failed to disconnect domain");
    },
  });

  // Create or update page
  const pageMutation = useMutation({
    mutationFn: async (pageData: Partial<TenantPage>) => {
      if (!tenantId) throw new Error("No tenant ID");
      
      if (page) {
        const { data, error } = await db
          .from("tenant_pages")
          .update({ 
            ...pageData,
            updated_at: new Date().toISOString()
          })
          .eq("id", page.id)
          .select()
          .single();
        
        if (error) throw error;
        return data;
      } else {
        const { data, error } = await db
          .from("tenant_pages")
          .insert({
            tenant_id: tenantId,
            restaurant_id: restaurantId,
            page_type: "landing",
            ...pageData,
          })
          .select()
          .single();
        
        if (error) throw error;
        return data;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-page", tenantId, restaurantId] });
      toast.success("Page configuration saved.");
    },
    onError: () => {
      toast.error("Failed to save page configuration");
    },
  });

  // Publish page
  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!page) throw new Error("No page to publish");
      
      const { data, error } = await db
        .from("tenant_pages")
        .update({ 
          is_published: true,
          published_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", page.id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-page", tenantId, restaurantId] });
      toast.success("Your landing page is now live.");
    },
    onError: () => {
      toast.error("Failed to deploy page");
    },
  });

  return {
    domain,
    page,
    isLoading: domainLoading || pageLoading,
    checkSubdomainAvailability,
    saveSubdomain: subdomainMutation.mutate,
    saveCustomDomain: customDomainMutation.mutate,
    verifyDomain: verifyDomainMutation.mutate,
    removeDomain: removeDomainMutation.mutate,
    savePage: pageMutation.mutate,
    publishPage: publishMutation.mutate,
    isSavingSubdomain: subdomainMutation.isPending,
    isSavingDomain: customDomainMutation.isPending,
    isVerifying: verifyDomainMutation.isPending,
    isRemovingDomain: removeDomainMutation.isPending,
    isSavingPage: pageMutation.isPending,
    isPublishing: publishMutation.isPending,
  };
}
