import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useToast } from "@/hooks/use-toast";

// Types
export interface LandingHero {
  id: string;
  eyebrow: string;
  headline: string;
  subheadline: string;
  primary_cta_text: string;
  secondary_cta_text: string;
  eyebrow_ar: string | null;
  headline_ar: string | null;
  subheadline_ar: string | null;
  primary_cta_text_ar: string | null;
  secondary_cta_text_ar: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LandingFeature {
  id: string;
  title: string;
  description: string;
  title_ar: string | null;
  description_ar: string | null;
  icon: string;
  size: "small" | "medium" | "large";
  color: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LandingTestimonial {
  id: string;
  quote: string;
  author_name: string;
  author_role: string;
  restaurant_name: string;
  quote_ar: string | null;
  author_name_ar: string | null;
  author_role_ar: string | null;
  restaurant_name_ar: string | null;
  avatar_emoji: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LandingPricingPlan {
  id: string;
  name: string;
  tagline: string;
  monthly_price: number | null;
  annual_price: number | null;
  description: string;
  features: string[];
  cta_text: string;
  is_highlighted: boolean;
  badge_text: string | null;
  name_ar: string | null;
  tagline_ar: string | null;
  description_ar: string | null;
  features_ar: string[];
  cta_text_ar: string | null;
  badge_text_ar: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LandingFAQ {
  id: string;
  question: string;
  answer: string;
  question_ar: string | null;
  answer_ar: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LandingSection {
  id: string;
  section_key: string;
  section_name: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface LandingMission {
  id: string;
  headline_prefix: string;
  headline_bold: string;
  opening_paragraph: string;
  core_mission: string;
  identity_text: string;
  symbolic_statement: string;
  closing_text: string;
  headline_prefix_ar: string | null;
  headline_bold_ar: string | null;
  opening_paragraph_ar: string | null;
  core_mission_ar: string | null;
  identity_text_ar: string | null;
  symbolic_statement_ar: string | null;
  closing_text_ar: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const useLandingContent = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch hero
  const { data: hero, isLoading: heroLoading } = useQuery({
    queryKey: ["landing-hero"],
    queryFn: async () => {
      const { data, error } = await db
        .from("landing_hero")
        .select("*")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as LandingHero | null;
    },
  });

  // Fetch features
  const { data: features = [], isLoading: featuresLoading } = useQuery({
    queryKey: ["landing-features"],
    queryFn: async () => {
      const { data, error } = await db
        .from("landing_features")
        .select("*")
        .order("sort_order");
      if (error) throw error;
      return data as LandingFeature[];
    },
  });

  // Fetch testimonials
  const { data: testimonials = [], isLoading: testimonialsLoading } = useQuery({
    queryKey: ["landing-testimonials"],
    queryFn: async () => {
      const { data, error } = await db
        .from("landing_testimonials")
        .select("*")
        .order("sort_order");
      if (error) throw error;
      return data as LandingTestimonial[];
    },
  });

  // Fetch pricing plans
  const { data: pricingPlans = [], isLoading: pricingLoading } = useQuery({
    queryKey: ["landing-pricing"],
    queryFn: async () => {
      const { data, error } = await db
        .from("landing_pricing_plans")
        .select("*")
        .order("sort_order");
      if (error) throw error;
      return (data as any[]).map((p) => ({
        ...p,
        features: Array.isArray(p.features) ? p.features : [],
        features_ar: Array.isArray(p.features_ar) ? p.features_ar : [],
      })) as LandingPricingPlan[];
    },
  });

  // Fetch FAQ
  const { data: faq = [], isLoading: faqLoading } = useQuery({
    queryKey: ["landing-faq"],
    queryFn: async () => {
      const { data, error } = await db
        .from("landing_faq")
        .select("*")
        .order("sort_order");
      if (error) throw error;
      return data as LandingFAQ[];
    },
  });

  // Fetch sections visibility
  const { data: sections = [], isLoading: sectionsLoading } = useQuery({
    queryKey: ["landing-sections"],
    queryFn: async () => {
      const { data, error } = await db
        .from("landing_sections")
        .select("*")
        .order("sort_order");
      if (error) throw error;
      return data as LandingSection[];
    },
  });

  // Fetch mission statement
  const { data: mission, isLoading: missionLoading } = useQuery({
    queryKey: ["landing-mission"],
    queryFn: async () => {
      const { data, error } = await db
        .from("landing_mission")
        .select("*")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as LandingMission | null;
    },
  });

  // Update hero
  const updateHero = useMutation({
    mutationFn: async (updates: Partial<LandingHero>) => {
      if (!hero?.id) throw new Error("Hero not found");
      const { error } = await db
        .from("landing_hero")
        .update(updates)
        .eq("id", hero.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["landing-hero"] });
      toast({ title: "Hero section updated" });
    },
    onError: (error) => {
      toast({ title: "Error updating hero", description: error.message, variant: "destructive" });
    },
  });

  // Update feature
  const updateFeature = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<LandingFeature> & { id: string }) => {
      const { error } = await db
        .from("landing_features")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["landing-features"] });
      toast({ title: "Feature updated" });
    },
    onError: (error) => {
      toast({ title: "Error updating feature", description: error.message, variant: "destructive" });
    },
  });

  // Create feature
  const createFeature = useMutation({
    mutationFn: async (feature: Omit<LandingFeature, "id" | "created_at" | "updated_at">) => {
      const { error } = await db.from("landing_features").insert(feature);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["landing-features"] });
      toast({ title: "Feature created" });
    },
    onError: (error) => {
      toast({ title: "Error creating feature", description: error.message, variant: "destructive" });
    },
  });

  // Delete feature
  const deleteFeature = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("landing_features").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["landing-features"] });
      toast({ title: "Feature deleted" });
    },
    onError: (error) => {
      toast({ title: "Error deleting feature", description: error.message, variant: "destructive" });
    },
  });

  // Update testimonial
  const updateTestimonial = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<LandingTestimonial> & { id: string }) => {
      const { error } = await db
        .from("landing_testimonials")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["landing-testimonials"] });
      toast({ title: "Testimonial updated" });
    },
    onError: (error) => {
      toast({ title: "Error updating testimonial", description: error.message, variant: "destructive" });
    },
  });

  // Create testimonial
  const createTestimonial = useMutation({
    mutationFn: async (testimonial: Omit<LandingTestimonial, "id" | "created_at" | "updated_at">) => {
      const { error } = await db.from("landing_testimonials").insert(testimonial);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["landing-testimonials"] });
      toast({ title: "Testimonial created" });
    },
    onError: (error) => {
      toast({ title: "Error creating testimonial", description: error.message, variant: "destructive" });
    },
  });

  // Delete testimonial
  const deleteTestimonial = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("landing_testimonials").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["landing-testimonials"] });
      toast({ title: "Testimonial deleted" });
    },
    onError: (error) => {
      toast({ title: "Error deleting testimonial", description: error.message, variant: "destructive" });
    },
  });

  // Update pricing plan
  const updatePricingPlan = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<LandingPricingPlan> & { id: string }) => {
      const { error } = await db
        .from("landing_pricing_plans")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["landing-pricing"] });
      toast({ title: "Pricing plan updated" });
    },
    onError: (error) => {
      toast({ title: "Error updating pricing", description: error.message, variant: "destructive" });
    },
  });

  // Update FAQ
  const updateFAQ = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<LandingFAQ> & { id: string }) => {
      const { error } = await db
        .from("landing_faq")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["landing-faq"] });
      toast({ title: "FAQ updated" });
    },
    onError: (error) => {
      toast({ title: "Error updating FAQ", description: error.message, variant: "destructive" });
    },
  });

  // Create FAQ
  const createFAQ = useMutation({
    mutationFn: async (faqItem: Omit<LandingFAQ, "id" | "created_at" | "updated_at">) => {
      const { error } = await db.from("landing_faq").insert(faqItem);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["landing-faq"] });
      toast({ title: "FAQ item created" });
    },
    onError: (error) => {
      toast({ title: "Error creating FAQ", description: error.message, variant: "destructive" });
    },
  });

  // Delete FAQ
  const deleteFAQ = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("landing_faq").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["landing-faq"] });
      toast({ title: "FAQ item deleted" });
    },
    onError: (error) => {
      toast({ title: "Error deleting FAQ", description: error.message, variant: "destructive" });
    },
  });

  // Update section visibility
  const updateSection = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<LandingSection> & { id: string }) => {
      const { error } = await db
        .from("landing_sections")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["landing-sections"] });
      toast({ title: "Section visibility updated" });
    },
    onError: (error) => {
      toast({ title: "Error updating section", description: error.message, variant: "destructive" });
    },
  });

  // Update mission statement
  const updateMission = useMutation({
    mutationFn: async (updates: Partial<LandingMission>) => {
      if (!mission?.id) throw new Error("Mission not found");
      const { error } = await db
        .from("landing_mission")
        .update(updates)
        .eq("id", mission.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["landing-mission"] });
      toast({ title: "Mission statement updated" });
    },
    onError: (error) => {
      toast({ title: "Error updating mission", description: error.message, variant: "destructive" });
    },
  });

  return {
    hero,
    features,
    testimonials,
    pricingPlans,
    faq,
    sections,
    mission,
    isLoading: heroLoading || featuresLoading || testimonialsLoading || pricingLoading || faqLoading || sectionsLoading || missionLoading,
    updateHero,
    updateFeature,
    createFeature,
    deleteFeature,
    updateTestimonial,
    createTestimonial,
    deleteTestimonial,
    updatePricingPlan,
    updateFAQ,
    createFAQ,
    deleteFAQ,
    updateSection,
    updateMission,
  };
};
