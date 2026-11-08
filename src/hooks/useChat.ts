import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export interface ChatChannel {
  id: string;
  restaurant_id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  created_by: string | null;
  created_at: string;
  unread_count?: number;
}

export interface ChatConversation {
  id: string;
  restaurant_id: string;
  created_at: string;
  participants: ConversationParticipant[];
  last_message?: ChatMessage;
  unread_count?: number;
}

export interface ConversationParticipant {
  id: string;
  user_id: string;
  profile?: {
    id: string;
    full_name: string | null;
    avatar_url: string | null;
  };
}

export interface ChatMessage {
  id: string;
  restaurant_id: string;
  channel_id: string | null;
  conversation_id: string | null;
  sender_id: string;
  content: string | null;
  attachment_url: string | null;
  attachment_type: string | null;
  attachment_name: string | null;
  is_edited: boolean;
  created_at: string;
  sender?: {
    id: string;
    full_name: string | null;
    avatar_url: string | null;
  };
  read_receipts?: ReadReceipt[];
}

export interface ReadReceipt {
  id: string;
  message_id: string;
  user_id: string;
  read_at: string;
}

export interface TeamMember {
  id: string;
  user_id: string;
  profile: {
    id: string;
    full_name: string | null;
    avatar_url: string | null;
  };
}

export function useChat() {
  const { user, restaurant } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  // Fetch channels
  const { data: channels = [], isLoading: channelsLoading } = useQuery({
    queryKey: ["chat-channels", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await db
        .from("chat_channels")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .order("is_default", { ascending: false })
        .order("name");
      
      if (error) throw error;
      return data as ChatChannel[];
    },
    enabled: !!restaurant?.id,
  });

  // Fetch conversations
  const { data: conversations = [], isLoading: conversationsLoading } = useQuery({
    queryKey: ["chat-conversations", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id || !user?.id) return [];
      
      const { data: convData, error: convError } = await db
        .from("chat_conversations")
        .select(`
          *,
          chat_conversation_participants!inner(
            id,
            user_id
          )
        `)
        .eq("restaurant_id", restaurant.id);
      
      if (convError) throw convError;
      
      // Filter conversations where user is a participant
      const userConversations = convData.filter(conv => 
        conv.chat_conversation_participants.some((p: any) => p.user_id === user.id)
      );
      
      // Fetch participant profiles
      const enrichedConversations = await Promise.all(
        userConversations.map(async (conv) => {
          const participantIds = conv.chat_conversation_participants.map((p: any) => p.user_id);
          const { data: profiles } = await db
            .from("profiles")
            .select("id, full_name, avatar_url")
            .in("id", participantIds);
          
          const participants = conv.chat_conversation_participants.map((p: any) => ({
            ...p,
            profile: profiles?.find(pr => pr.id === p.user_id),
          }));
          
          return { ...conv, participants };
        })
      );
      
      return enrichedConversations as ChatConversation[];
    },
    enabled: !!restaurant?.id && !!user?.id,
  });

  // Fetch messages for active channel or conversation
  const { data: messages = [], isLoading: messagesLoading } = useQuery({
    queryKey: ["chat-messages", activeChannelId, activeConversationId],
    queryFn: async () => {
      if (!activeChannelId && !activeConversationId) return [];
      
      let query = db
        .from("chat_messages")
        .select("*")
        .order("created_at", { ascending: true });
      
      if (activeChannelId) {
        query = query.eq("channel_id", activeChannelId);
      } else if (activeConversationId) {
        query = query.eq("conversation_id", activeConversationId);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      
      // Fetch sender profiles
      const senderIds = [...new Set(data.map(m => m.sender_id))];
      const { data: profiles } = await db
        .from("profiles")
        .select("id, full_name, avatar_url")
        .in("id", senderIds);
      
      // Fetch read receipts
      const messageIds = data.map(m => m.id);
      const { data: receipts } = await db
        .from("chat_read_receipts")
        .select("*")
        .in("message_id", messageIds);
      
      return data.map(msg => ({
        ...msg,
        sender: profiles?.find(p => p.id === msg.sender_id),
        read_receipts: receipts?.filter(r => r.message_id === msg.id) || [],
      })) as ChatMessage[];
    },
    enabled: !!activeChannelId || !!activeConversationId,
  });

  // Fetch team members for starting new conversations
  const { data: teamMembers = [] } = useQuery({
    queryKey: ["chat-team-members", restaurant?.tenant_id],
    queryFn: async () => {
      if (!restaurant?.tenant_id) return [];
      
      const { data, error } = await db
        .from("user_tenant_roles")
        .select(`
          id,
          user_id,
          profiles:user_id(id, full_name, avatar_url)
        `)
        .eq("tenant_id", restaurant.tenant_id);
      
      if (error) throw error;
      
      return data
        .filter((m: any) => m.user_id !== user?.id && m.profiles)
        .map((m: any) => ({
          id: m.id,
          user_id: m.user_id,
          profile: m.profiles,
        })) as TeamMember[];
    },
    enabled: !!restaurant?.tenant_id,
  });

  // Create channel mutation
  const createChannel = useMutation({
    mutationFn: async ({ name, description }: { name: string; description?: string }) => {
      if (!restaurant?.id || !user?.id) throw new Error("Not authenticated");
      
      const { data, error } = await db
        .from("chat_channels")
        .insert({
          restaurant_id: restaurant.id,
          name,
          description,
          created_by: user.id,
        })
        .select()
        .single();
      
      if (error) throw error;
      
      // Auto-join creator to channel
      await db.from("chat_channel_members").insert({
        channel_id: data.id,
        user_id: user.id,
      });
      
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-channels"] });
      toast({ title: "Channel created" });
    },
    onError: (error) => {
      toast({ title: "Error creating channel", description: error.message, variant: "destructive" });
    },
  });

  // Join channel mutation
  const joinChannel = useMutation({
    mutationFn: async (channelId: string) => {
      if (!user?.id) throw new Error("Not authenticated");
      
      const { error } = await db
        .from("chat_channel_members")
        .insert({ channel_id: channelId, user_id: user.id });
      
      if (error && !error.message.includes("duplicate")) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-channels"] });
    },
  });

  // Create or get existing conversation
  const startConversation = useMutation({
    mutationFn: async (otherUserId: string) => {
      if (!restaurant?.id || !user?.id) throw new Error("Not authenticated");
      
      // Check if conversation already exists
      const { data: existing } = await db
        .from("chat_conversations")
        .select(`
          id,
          chat_conversation_participants(user_id)
        `)
        .eq("restaurant_id", restaurant.id);
      
      const existingConv = existing?.find(conv => {
        const participants = conv.chat_conversation_participants.map((p: any) => p.user_id);
        return participants.length === 2 && 
               participants.includes(user.id) && 
               participants.includes(otherUserId);
      });
      
      if (existingConv) {
        return existingConv;
      }
      
      // Create new conversation
      const { data: newConv, error: convError } = await db
        .from("chat_conversations")
        .insert({ restaurant_id: restaurant.id })
        .select()
        .single();
      
      if (convError) throw convError;
      
      // Add both participants
      await db.from("chat_conversation_participants").insert([
        { conversation_id: newConv.id, user_id: user.id },
        { conversation_id: newConv.id, user_id: otherUserId },
      ]);
      
      return newConv;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["chat-conversations"] });
      setActiveConversationId(data.id);
      setActiveChannelId(null);
    },
  });

  // Send message mutation
  const sendMessage = useMutation({
    mutationFn: async ({ 
      content, 
      attachmentUrl, 
      attachmentType, 
      attachmentName 
    }: { 
      content?: string; 
      attachmentUrl?: string; 
      attachmentType?: string;
      attachmentName?: string;
    }) => {
      if (!restaurant?.id || !user?.id) throw new Error("Not authenticated");
      if (!activeChannelId && !activeConversationId) throw new Error("No active chat");
      
      const { data, error } = await db
        .from("chat_messages")
        .insert({
          restaurant_id: restaurant.id,
          channel_id: activeChannelId,
          conversation_id: activeConversationId,
          sender_id: user.id,
          content,
          attachment_url: attachmentUrl,
          attachment_type: attachmentType,
          attachment_name: attachmentName,
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-messages"] });
    },
    onError: (error) => {
      toast({ title: "Error sending message", description: error.message, variant: "destructive" });
    },
  });

  // Edit message mutation
  const editMessage = useMutation({
    mutationFn: async ({ messageId, content }: { messageId: string; content: string }) => {
      const { data, error } = await db
        .from("chat_messages")
        .update({ content, is_edited: true })
        .eq("id", messageId)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-messages"] });
      toast({ title: "Message updated" });
    },
    onError: (error) => {
      toast({ title: "Error updating message", description: error.message, variant: "destructive" });
    },
  });

  // Delete message mutation
  const deleteMessage = useMutation({
    mutationFn: async (messageId: string) => {
      const { error } = await db
        .from("chat_messages")
        .delete()
        .eq("id", messageId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-messages"] });
      toast({ title: "Message deleted" });
    },
    onError: (error) => {
      toast({ title: "Error deleting message", description: error.message, variant: "destructive" });
    },
  });

  // Mark message as read
  const markAsRead = useCallback(async (messageId: string) => {
    if (!user?.id) return;
    
    await db
      .from("chat_read_receipts")
      .upsert({ message_id: messageId, user_id: user.id }, { onConflict: "message_id,user_id" });
  }, [user?.id]);

  // Upload attachment
  const uploadAttachment = async (file: File) => {
    if (!user?.id) throw new Error("Not authenticated");
    
    const fileExt = file.name.split('.').pop();
    const fileName = `${user.id}/${Date.now()}.${fileExt}`;
    
    const { data, error } = await db.storage
      .from("chat-attachments")
      .upload(fileName, file);

    if (error) throw error;

    // Bucket is private; generate a long-lived signed URL (1 year) for sharing in chat.
    const { data: signed, error: signErr } = await db.storage
      .from("chat-attachments")
      .createSignedUrl(data.path, 60 * 60 * 24 * 365);

    if (signErr) throw signErr;

    return {
      url: signed.signedUrl,
      type: file.type,
      name: file.name,
    };
  };

  // Real-time subscription for messages
  useEffect(() => {
    if (!restaurant?.id) return;
    
    const channel = db
      .channel("chat-messages-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_messages",
          filter: `restaurant_id=eq.${restaurant.id}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["chat-messages"] });
          queryClient.invalidateQueries({ queryKey: ["unread-counts"] });
        }
      )
      .subscribe();
    
    return () => {
      db.removeChannel(channel);
    };
  }, [restaurant?.id, queryClient]);

  return {
    // Data
    channels,
    conversations,
    messages,
    teamMembers,
    
    // Loading states
    channelsLoading,
    conversationsLoading,
    messagesLoading,
    
    // Active chat
    activeChannelId,
    activeConversationId,
    setActiveChannelId: (id: string | null) => {
      setActiveChannelId(id);
      setActiveConversationId(null);
    },
    setActiveConversationId: (id: string | null) => {
      setActiveConversationId(id);
      setActiveChannelId(null);
    },
    
    // Actions
    createChannel,
    joinChannel,
    startConversation,
    sendMessage,
    editMessage,
    deleteMessage,
    markAsRead,
    uploadAttachment,
  };
}
