import { useEffect, useRef } from "react";
import { format, isToday, isYesterday } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ChatMessage as ChatMessageType } from "@/hooks/useChat";
import { useAuth } from "@/contexts/AuthContext";
import { useChatSettings } from "@/hooks/useChatSettings";
import { ChatMessage } from "./ChatMessage";

interface ChatMessageListProps {
  messages: ChatMessageType[];
  onMessageVisible?: (messageId: string) => void;
  onEditMessage?: (messageId: string, newContent: string) => void;
  onDeleteMessage?: (messageId: string) => void;
}

export function ChatMessageList({ 
  messages, 
  onMessageVisible,
  onEditMessage,
  onDeleteMessage,
}: ChatMessageListProps) {
  const { user } = useAuth();
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { canEdit, canDelete } = useChatSettings();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Mark messages as read when visible
  useEffect(() => {
    if (!onMessageVisible || !user?.id) return;
    
    const unreadMessages = messages.filter(
      m => m.sender_id !== user.id && !m.read_receipts?.some(r => r.user_id === user.id)
    );
    
    unreadMessages.forEach(m => onMessageVisible(m.id));
  }, [messages, onMessageVisible, user?.id]);

  const groupMessagesByDate = (msgs: ChatMessageType[]) => {
    const groups: { date: string; messages: ChatMessageType[] }[] = [];
    
    msgs.forEach(msg => {
      const msgDate = new Date(msg.created_at);
      let dateLabel: string;
      
      if (isToday(msgDate)) {
        dateLabel = "Today";
      } else if (isYesterday(msgDate)) {
        dateLabel = "Yesterday";
      } else {
        dateLabel = format(msgDate, "MMMM d, yyyy");
      }
      
      const existingGroup = groups.find(g => g.date === dateLabel);
      if (existingGroup) {
        existingGroup.messages.push(msg);
      } else {
        groups.push({ date: dateLabel, messages: [msg] });
      }
    });
    
    return groups;
  };

  const messageGroups = groupMessagesByDate(messages);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <p>No messages yet. Start the conversation!</p>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1 p-4" ref={scrollRef}>
      <div className="space-y-6">
        {messageGroups.map((group) => (
          <div key={group.date}>
            <div className="flex items-center gap-4 my-4">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground font-medium">{group.date}</span>
              <div className="flex-1 h-px bg-border" />
            </div>
            
            <div className="space-y-4">
              {group.messages.map((msg, idx) => {
                const showAvatar = idx === 0 || 
                  group.messages[idx - 1]?.sender_id !== msg.sender_id;
                const isOwn = msg.sender_id === user?.id;
                
                return (
                  <ChatMessage
                    key={msg.id}
                    message={msg}
                    showAvatar={showAvatar}
                    canEdit={isOwn && canEdit(msg.created_at)}
                    canDelete={isOwn && canDelete(msg.created_at)}
                    onEdit={onEditMessage || (() => {})}
                    onDelete={onDeleteMessage || (() => {})}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div ref={bottomRef} />
    </ScrollArea>
  );
}
