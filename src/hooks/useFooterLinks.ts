import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface FooterLink {
  id: string;
  link_key: string;
  link_label: string;
  link_href: string;
  category: "product" | "company" | "resources" | "legal";
  is_enabled: boolean;
  sort_order: number;
}

export function useFooterLinks() {
  return useQuery({
    queryKey: ["footer-links"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("footer_link_settings")
        .select("*")
        .order("category")
        .order("sort_order");

      if (error) throw error;
      return data as FooterLink[];
    },
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });
}

export function useEnabledFooterLinks() {
  return useQuery({
    queryKey: ["footer-links", "enabled"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("footer_link_settings")
        .select("*")
        .eq("is_enabled", true)
        .order("category")
        .order("sort_order");

      if (error) throw error;
      return data as FooterLink[];
    },
    staleTime: 1000 * 60 * 5,
  });
}

export function useToggleFooterLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, is_enabled }: { id: string; is_enabled: boolean }) => {
      const { error } = await supabase
        .from("footer_link_settings")
        .update({ is_enabled })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["footer-links"] });
    },
  });
}

export function useUpdateFooterLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, link_label, link_href }: { id: string; link_label: string; link_href: string }) => {
      const { error } = await supabase
        .from("footer_link_settings")
        .update({ link_label, link_href })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["footer-links"] });
    },
  });
}
