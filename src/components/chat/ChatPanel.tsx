import { Hash, MessageCircle } from "lucide-react";
import { ChatMessageList } from "./ChatMessageList";
import { ChatInput } from "./ChatInput";
import type { ChatChannel, ChatConversation, ChatMessage } from "@/hooks/useChat";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";

interface ChatPanelProps {
  channel?: ChatChannel;
  conversation?: ChatConversation;
  messages: ChatMessage[];
  messagesLoading: boolean;
  onSendMessage: (content: string) => void;
  onUploadAttachment: (file: File) => Promise<{ url: string; type: string; name: string }>;
  onSendAttachment: (attachment: { url: string; type: string; name: string }, content?: string) => void;
  onMessageVisible: (messageId: string) => void;
  onEditMessage: (messageId: string, newContent: string) => void;
  onDeleteMessage: (messageId: string) => void;
}

export function ChatPanel({
  channel,
  conversation,
  messages,
  messagesLoading,
  onSendMessage,
  onUploadAttachment,
  onSendAttachment,
  onMessageVisible,
  onEditMessage,
  onDeleteMessage,
}: ChatPanelProps) {
  const { user } = useAuth();

  const getConversationName = () => {
    if (!conversation) return "";
    const otherParticipant = conversation.participants?.find(p => p.user_id !== user?.id);
    return otherParticipant?.profile?.full_name || "Unknown";
  };

  if (!channel && !conversation) {
    return (
      <div className="flex-1 flex items-center justify-center bg-muted/20">
        <div className="text-center">
          <MessageCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium">Select a chat</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Choose a channel or conversation to start messaging
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="border-b px-4 py-3 flex items-center gap-2">
        {channel ? (
          <>
            <Hash className="h-5 w-5 text-muted-foreground" />
            <div>
              <h2 className="font-semibold">{channel.name}</h2>
              {channel.description && (
                <p className="text-xs text-muted-foreground">{channel.description}</p>
              )}
            </div>
          </>
        ) : (
          <>
            <MessageCircle className="h-5 w-5 text-muted-foreground" />
            <h2 className="font-semibold">{getConversationName()}</h2>
          </>
        )}
      </div>

      {messagesLoading ? (
        <div className="flex-1 p-4 space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex gap-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-16 w-64" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <ChatMessageList 
          messages={messages} 
          onMessageVisible={onMessageVisible}
          onEditMessage={onEditMessage}
          onDeleteMessage={onDeleteMessage}
        />
      )}

      <ChatInput
        onSendMessage={onSendMessage}
        onUploadAttachment={onUploadAttachment}
        onSendAttachment={onSendAttachment}
        disabled={messagesLoading}
      />
    </div>
  );
}
