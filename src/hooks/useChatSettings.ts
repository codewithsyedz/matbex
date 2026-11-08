import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export interface ChatSettings {
  id: string;
  tenant_id: string;
  chat_enabled: boolean;
  allow_message_edit: boolean;
  allow_message_delete: boolean;
  edit_window_minutes: number | null;
  delete_window_minutes: number | null;
  created_at: string;
  updated_at: string;
}

export function useChatSettings() {
  const { restaurant } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ["chat-settings", restaurant?.tenant_id],
    queryFn: async () => {
      if (!restaurant?.tenant_id) return null;
      
      const { data, error } = await (db
        .from("chat_settings" as any)
        .select("*")
        .eq("tenant_id", restaurant.tenant_id)
        .maybeSingle() as any);
      
      if (error) throw error;
      
      // If no settings exist, chat is enabled by default (for tenants without explicit settings)
      if (!data) {
        return {
          chat_enabled: true,
          allow_message_edit: true,
          allow_message_delete: true,
          edit_window_minutes: 15,
          delete_window_minutes: 5,
        } as Partial<ChatSettings>;
      }
      
      return data as ChatSettings;
    },
    enabled: !!restaurant?.tenant_id,
  });

  const updateSettings = useMutation({
    mutationFn: async (updates: Partial<ChatSettings>) => {
      if (!restaurant?.tenant_id) throw new Error("No tenant");
      
      // Check if settings exist
      const { data: existing } = await (db
        .from("chat_settings" as any)
        .select("id")
        .eq("tenant_id", restaurant.tenant_id)
        .maybeSingle() as any);
      
      if (existing) {
        const { data, error } = await (db
          .from("chat_settings" as any)
          .update(updates)
          .eq("tenant_id", restaurant.tenant_id)
          .select()
          .single() as any);
        
        if (error) throw error;
        return data;
      } else {
        const { data, error } = await (db
          .from("chat_settings" as any)
          .insert({ tenant_id: restaurant.tenant_id, ...updates })
          .select()
          .single() as any);
        
        if (error) throw error;
        return data;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-settings"] });
      toast({ title: "Chat settings updated" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Error updating settings", 
        description: error.message, 
        variant: "destructive" 
      });
    },
  });

  const canEdit = (messageCreatedAt: string) => {
    if (!settings?.allow_message_edit) return false;
    if (!settings.edit_window_minutes) return true;
    
    const messageTime = new Date(messageCreatedAt).getTime();
    const now = Date.now();
    const windowMs = settings.edit_window_minutes * 60 * 1000;
    
    return (now - messageTime) <= windowMs;
  };

  const canDelete = (messageCreatedAt: string) => {
    if (!settings?.allow_message_delete) return false;
    if (!settings.delete_window_minutes) return true;
    
    const messageTime = new Date(messageCreatedAt).getTime();
    const now = Date.now();
    const windowMs = settings.delete_window_minutes * 60 * 1000;
    
    return (now - messageTime) <= windowMs;
  };

  const isChatEnabled = settings?.chat_enabled !== false;

  return {
    settings,
    isLoading,
    updateSettings,
    canEdit,
    canDelete,
    isChatEnabled,
  };
}
