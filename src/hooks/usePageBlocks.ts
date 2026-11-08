import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Json } from "@/integrations/supabase/types";

export type BlockType = 'hero' | 'menu' | 'hours' | 'location' | 'gallery' | 'testimonials' | 'cta' | 'custom';

export interface PageBlock {
  id: string;
  page_id: string;
  block_type: BlockType;
  block_order: number;
  content: Json;
  is_visible: boolean;
  created_at: string;
  updated_at: string;
}

export interface BlockContent {
  // Hero block
  title?: string;
  subtitle?: string;
  image_url?: string;
  lottie_url?: string;
  lottie_preset?: string;
  cta_text?: string;
  cta_link?: string;
  
  // Menu block
  categories?: string[];
  show_prices?: boolean;
  show_images?: boolean;
  menu_type?: 'lunch' | 'dinner' | 'all';
  enable_live_sync?: boolean;
  show_chefs_specials?: boolean;
  
  // Hours block
  hours?: { day: string; open: string; close: string; closed?: boolean }[];
  
  // Location block
  address?: string;
  map_embed_url?: string;
  phone?: string;
  email?: string;
  
  // Gallery block
  images?: { url: string; caption?: string }[];
  layout?: 'grid' | 'masonry' | 'carousel';
  
  // CTA block
  heading?: string;
  description?: string;
  button_text?: string;
  button_link?: string;
  background_color?: string;
  
  // Custom block
  html?: string;
}

interface DefaultBlock {
  block_type: BlockType;
  block_order: number;
  content: Json;
  is_visible: boolean;
}

const DEFAULT_BLOCKS: DefaultBlock[] = [
  { block_type: 'hero', block_order: 0, content: { title: 'Welcome to Our Restaurant', subtitle: 'Experience the finest cuisine' }, is_visible: true },
  { block_type: 'menu', block_order: 1, content: { 
    categories: ['main', 'appetizer', 'dessert'], 
    show_prices: true, 
    show_images: true,
    enable_live_sync: true,
    menu_type: 'all',
    show_chefs_specials: true
  }, is_visible: true },
  { block_type: 'hours', block_order: 2, content: { hours: [
    { day: 'Monday', open: '11:00', close: '22:00' },
    { day: 'Tuesday', open: '11:00', close: '22:00' },
    { day: 'Wednesday', open: '11:00', close: '22:00' },
    { day: 'Thursday', open: '11:00', close: '22:00' },
    { day: 'Friday', open: '11:00', close: '23:00' },
    { day: 'Saturday', open: '10:00', close: '23:00' },
    { day: 'Sunday', open: '10:00', close: '21:00', closed: false },
  ] }, is_visible: true },
  { block_type: 'location', block_order: 3, content: { address: '123 Main Street, City', phone: '+1 234 567 890' }, is_visible: true },
  { block_type: 'cta', block_order: 4, content: { heading: 'Ready to Dine?', description: 'Book your table today', button_text: 'Make a Reservation', button_link: '#' }, is_visible: true },
];

export function usePageBlocks(pageId: string | null | undefined) {
  const { tenant } = useAuth();
  const tenantId = tenant?.id;
  const queryClient = useQueryClient();

  // Fetch blocks for a page
  const { data: blocks, isLoading } = useQuery({
    queryKey: ["page-blocks", pageId],
    queryFn: async () => {
      if (!pageId) return [];
      const { data, error } = await supabase
        .from("tenant_page_blocks")
        .select("*")
        .eq("page_id", pageId)
        .order("block_order", { ascending: true });
      
      if (error) throw error;
      return (data || []) as PageBlock[];
    },
    enabled: !!pageId,
  });

  // Initialize default blocks for a new page
  const initializeBlocksMutation = useMutation({
    mutationFn: async (newPageId: string) => {
      const blocksToCreate = DEFAULT_BLOCKS.map(block => ({
        page_id: newPageId,
        block_type: block.block_type,
        block_order: block.block_order,
        content: block.content,
        is_visible: block.is_visible,
      }));

      const { data, error } = await supabase
        .from("tenant_page_blocks")
        .insert(blocksToCreate)
        .select();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["page-blocks", pageId] });
    },
  });

  // Add a new block
  const addBlockMutation = useMutation({
    mutationFn: async ({ blockType, content }: { blockType: BlockType; content?: BlockContent }) => {
      if (!pageId) throw new Error("No page ID");
      
      const maxOrder = blocks?.reduce((max, b) => Math.max(max, b.block_order), -1) ?? -1;
      
      const { data, error } = await supabase
        .from("tenant_page_blocks")
        .insert({
          page_id: pageId,
          block_type: blockType,
          block_order: maxOrder + 1,
          content: (content || {}) as Json,
          is_visible: true,
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["page-blocks", pageId] });
      toast.success("Block added");
    },
    onError: () => {
      toast.error("Failed to add block");
    },
  });

  // Update a block
  const updateBlockMutation = useMutation({
    mutationFn: async ({ blockId, updates }: { blockId: string; updates: Partial<Omit<PageBlock, 'content'>> & { content?: BlockContent } }) => {
      const updateData: Record<string, unknown> = {
        ...updates,
        updated_at: new Date().toISOString(),
      };
      
      if (updates.content) {
        updateData.content = updates.content as Json;
      }

      const { data, error } = await supabase
        .from("tenant_page_blocks")
        .update(updateData)
        .eq("id", blockId)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["page-blocks", pageId] });
    },
    onError: () => {
      toast.error("Failed to update block");
    },
  });

  // Reorder blocks
  const reorderBlocksMutation = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      const updates = orderedIds.map((id, index) => ({
        id,
        block_order: index,
        updated_at: new Date().toISOString(),
      }));

      // Update each block's order
      for (const update of updates) {
        const { error } = await supabase
          .from("tenant_page_blocks")
          .update({ block_order: update.block_order, updated_at: update.updated_at })
          .eq("id", update.id);
        
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["page-blocks", pageId] });
    },
    onError: () => {
      toast.error("Failed to reorder blocks");
    },
  });

  // Delete a block
  const deleteBlockMutation = useMutation({
    mutationFn: async (blockId: string) => {
      const { error } = await supabase
        .from("tenant_page_blocks")
        .delete()
        .eq("id", blockId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["page-blocks", pageId] });
      toast.success("Block removed");
    },
    onError: () => {
      toast.error("Failed to remove block");
    },
  });

  // Toggle block visibility
  const toggleVisibilityMutation = useMutation({
    mutationFn: async ({ blockId, isVisible }: { blockId: string; isVisible: boolean }) => {
      const { data, error } = await supabase
        .from("tenant_page_blocks")
        .update({ is_visible: isVisible, updated_at: new Date().toISOString() })
        .eq("id", blockId)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["page-blocks", pageId] });
      toast.success(variables.isVisible ? "Block shown" : "Block hidden");
    },
    onError: () => {
      toast.error("Failed to update visibility");
    },
  });

  return {
    blocks: blocks || [],
    isLoading,
    initializeBlocks: initializeBlocksMutation.mutate,
    addBlock: addBlockMutation.mutate,
    updateBlock: updateBlockMutation.mutate,
    reorderBlocks: reorderBlocksMutation.mutate,
    deleteBlock: deleteBlockMutation.mutate,
    toggleVisibility: toggleVisibilityMutation.mutate,
    isAdding: addBlockMutation.isPending,
    isUpdating: updateBlockMutation.isPending,
    isReordering: reorderBlocksMutation.isPending,
    isDeleting: deleteBlockMutation.isPending,
  };
}
