import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";

interface UnreadCounts {
  channels: Record<string, number>;
  conversations: Record<string, number>;
  total: number;
}

export function useUnreadCounts() {
  const { user, restaurant } = useAuth();

  const { data: unreadCounts = { channels: {}, conversations: {}, total: 0 }, refetch } = useQuery({
    queryKey: ["unread-counts", restaurant?.id, user?.id],
    queryFn: async (): Promise<UnreadCounts> => {
      if (!restaurant?.id || !user?.id) {
        return { channels: {}, conversations: {}, total: 0 };
      }

      // Get all messages in the restaurant
      const { data: messages, error: messagesError } = await db
        .from("chat_messages")
        .select("id, channel_id, conversation_id, sender_id, created_at")
        .eq("restaurant_id", restaurant.id)
        .neq("sender_id", user.id);

      if (messagesError) throw messagesError;

      // Get user's read receipts
      const messageIds = messages?.map(m => m.id) || [];
      const { data: readReceipts, error: receiptsError } = await db
        .from("chat_read_receipts")
        .select("message_id")
        .eq("user_id", user.id)
        .in("message_id", messageIds);

      if (receiptsError) throw receiptsError;

      const readMessageIds = new Set(readReceipts?.map(r => r.message_id) || []);

      // Get user's conversations (to filter out conversations user is not part of)
      const { data: userConversations } = await db
        .from("chat_conversation_participants")
        .select("conversation_id")
        .eq("user_id", user.id);

      const userConversationIds = new Set(userConversations?.map(c => c.conversation_id) || []);

      // Count unread per channel and conversation
      const channels: Record<string, number> = {};
      const conversations: Record<string, number> = {};
      let total = 0;

      messages?.forEach(msg => {
        if (readMessageIds.has(msg.id)) return;

        if (msg.channel_id) {
          channels[msg.channel_id] = (channels[msg.channel_id] || 0) + 1;
          total++;
        } else if (msg.conversation_id && userConversationIds.has(msg.conversation_id)) {
          conversations[msg.conversation_id] = (conversations[msg.conversation_id] || 0) + 1;
          total++;
        }
      });

      return { channels, conversations, total };
    },
    enabled: !!restaurant?.id && !!user?.id,
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  return { unreadCounts, refetch };
}
