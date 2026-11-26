import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useToast } from "@/hooks/use-toast";

export interface CMSPage {
  id: string;
  slug: string;
  title: string;
  meta_title: string | null;
  meta_description: string | null;
  is_published: boolean;
  created_at: string;
  updated_at: string;
  translations?: Record<string, Record<string, any>> | null;
}

export interface CMSPageBlock {
  id: string;
  page_id: string;
  block_type: string;
  sort_order: number;
  is_visible: boolean;
  config: Record<string, any>;
  created_at: string;
  updated_at: string;
  translations?: Record<string, Record<string, any>> | null;
}

export interface PageWithBlocks extends CMSPage {
  blocks: CMSPageBlock[];
}

// Fetch all CMS pages (admin)
export function useCMSPages() {
  return useQuery({
    queryKey: ["cms-pages"],
    queryFn: async () => {
      const { data, error } = await db
        .from("cms_pages")
        .select("*")
        .order("title");
      if (error) throw error;
      return data as CMSPage[];
    },
  });
}

// Fetch single page with blocks by slug
export function useCMSPage(slug: string) {
  return useQuery({
    queryKey: ["cms-page", slug],
    queryFn: async () => {
      const { data: page, error: pageError } = await db
        .from("cms_pages")
        .select("*")
        .eq("slug", slug)
        .maybeSingle();
      
      if (pageError) throw pageError;
      if (!page) return null;

      const { data: blocks, error: blocksError } = await db
        .from("cms_page_blocks")
        .select("*")
        .eq("page_id", page.id)
        .order("sort_order");
      
      if (blocksError) throw blocksError;

      return {
        ...page,
        blocks: blocks || [],
      } as PageWithBlocks;
    },
    enabled: !!slug,
  });
}

// Fetch blocks for a page
export function useCMSPageBlocks(pageId: string) {
  return useQuery({
    queryKey: ["cms-page-blocks", pageId],
    queryFn: async () => {
      const { data, error } = await db
        .from("cms_page_blocks")
        .select("*")
        .eq("page_id", pageId)
        .order("sort_order");
      if (error) throw error;
      return data as CMSPageBlock[];
    },
    enabled: !!pageId,
  });
}

// Update page metadata
export function useUpdateCMSPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<CMSPage> & { id: string }) => {
      const { error } = await db
        .from("cms_pages")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["cms-pages"] });
      queryClient.invalidateQueries({ queryKey: ["cms-page"] });
      toast({ title: "Page updated" });
    },
    onError: (error) => {
      toast({ title: "Error updating page", description: error.message, variant: "destructive" });
    },
  });
}

// Create a new block
export function useCreateCMSBlock() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (block: Omit<CMSPageBlock, "id" | "created_at" | "updated_at">) => {
      const { data, error } = await db
        .from("cms_page_blocks")
        .insert(block)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["cms-page-blocks", variables.page_id] });
      queryClient.invalidateQueries({ queryKey: ["cms-page"] });
      toast({ title: "Block added" });
    },
    onError: (error) => {
      toast({ title: "Error adding block", description: error.message, variant: "destructive" });
    },
  });
}

// Update a block
export function useUpdateCMSBlock() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, page_id, ...updates }: Partial<CMSPageBlock> & { id: string; page_id: string }) => {
      const { error } = await db
        .from("cms_page_blocks")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
      return page_id;
    },
    onSuccess: (pageId) => {
      queryClient.invalidateQueries({ queryKey: ["cms-page-blocks", pageId] });
      queryClient.invalidateQueries({ queryKey: ["cms-page"] });
      toast({ title: "Block updated" });
    },
    onError: (error) => {
      toast({ title: "Error updating block", description: error.message, variant: "destructive" });
    },
  });
}

// Delete a block
export function useDeleteCMSBlock() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, page_id }: { id: string; page_id: string }) => {
      const { error } = await db
        .from("cms_page_blocks")
        .delete()
        .eq("id", id);
      if (error) throw error;
      return page_id;
    },
    onSuccess: (pageId) => {
      queryClient.invalidateQueries({ queryKey: ["cms-page-blocks", pageId] });
      queryClient.invalidateQueries({ queryKey: ["cms-page"] });
      toast({ title: "Block deleted" });
    },
    onError: (error) => {
      toast({ title: "Error deleting block", description: error.message, variant: "destructive" });
    },
  });
}

// Reorder blocks
export function useReorderCMSBlocks() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ blocks, page_id }: { blocks: { id: string; sort_order: number }[]; page_id: string }) => {
      const updates = blocks.map(({ id, sort_order }) =>
        db
          .from("cms_page_blocks")
          .update({ sort_order })
          .eq("id", id)
      );
      await Promise.all(updates);
      return page_id;
    },
    onSuccess: (pageId) => {
      queryClient.invalidateQueries({ queryKey: ["cms-page-blocks", pageId] });
      queryClient.invalidateQueries({ queryKey: ["cms-page"] });
    },
  });
}
