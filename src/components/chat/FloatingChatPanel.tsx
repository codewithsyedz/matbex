import { useState } from "react";
import { ChatSidebar } from "./ChatSidebar";
import { ChatPanel } from "./ChatPanel";
import { useChat } from "@/hooks/useChat";
import { useUnreadCounts } from "@/hooks/useUnreadCounts";
import { useChatNotifications } from "@/hooks/useChatNotifications";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface FloatingChatPanelProps {
  isOpen: boolean;
}

export function FloatingChatPanel({ isOpen }: FloatingChatPanelProps) {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const [showSidebar, setShowSidebar] = useState(true);
  
  useChatNotifications();
  
  const {
    channels,
    conversations,
    messages,
    teamMembers,
    channelsLoading,
    conversationsLoading,
    messagesLoading,
    activeChannelId,
    activeConversationId,
    setActiveChannelId,
    setActiveConversationId,
    createChannel,
    startConversation,
    sendMessage,
    editMessage,
    deleteMessage,
    markAsRead,
    uploadAttachment,
  } = useChat();

  const { unreadCounts } = useUnreadCounts();

  const activeChannel = channels.find(c => c.id === activeChannelId);
  const activeConversation = conversations.find(c => c.id === activeConversationId);

  const hasActiveChat = activeChannelId || activeConversationId;

  const handleSelectChannel = (id: string) => {
    setActiveChannelId(id);
    if (isMobile) setShowSidebar(false);
  };

  const handleSelectConversation = (id: string) => {
    setActiveConversationId(id);
    if (isMobile) setShowSidebar(false);
  };

  const handleBack = () => {
    setShowSidebar(true);
    setActiveChannelId(null as any);
    setActiveConversationId(null as any);
  };

  const handleSendMessage = (content: string) => {
    sendMessage.mutate({ content });
  };

  const handleSendAttachment = (
    attachment: { url: string; type: string; name: string },
    content?: string
  ) => {
    sendMessage.mutate({
      content,
      attachmentUrl: attachment.url,
      attachmentType: attachment.type,
      attachmentName: attachment.name,
    });
  };

  const handleEditMessage = (messageId: string, newContent: string) => {
    editMessage.mutate({ messageId, content: newContent });
  };

  const handleDeleteMessage = (messageId: string) => {
    deleteMessage.mutate(messageId);
  };

  if (!isOpen) return null;

  return (
    <div 
      className={cn(
        "fixed z-40 bg-background border rounded-2xl shadow-2xl overflow-hidden",
        "flex flex-col",
        isMobile 
          ? "inset-4 bottom-24" 
          : "bottom-24 right-6 w-[380px] h-[520px]"
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-background">
        {isMobile && hasActiveChat && !showSidebar && (
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <h2 className="font-semibold text-base">Team Chat</h2>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar - always show on desktop, conditional on mobile */}
        {(!isMobile || showSidebar) && (
          <div className={cn(
            "flex-shrink-0",
            isMobile ? "w-full" : "w-full"
          )}>
            <ChatSidebar
              channels={channels}
              conversations={conversations}
              teamMembers={teamMembers}
              activeChannelId={activeChannelId}
              activeConversationId={activeConversationId}
              unreadCounts={unreadCounts}
              onSelectChannel={handleSelectChannel}
              onSelectConversation={handleSelectConversation}
              onCreateChannel={(name, desc) => createChannel.mutate({ name, description: desc })}
              onStartConversation={(userId) => startConversation.mutate(userId)}
            />
          </div>
        )}

        {/* Chat Panel - show when chat is selected on mobile, or active on desktop */}
        {(!isMobile && hasActiveChat) && (
          <div className="fixed z-50 bg-background border rounded-2xl shadow-2xl overflow-hidden bottom-24 right-[410px] w-[380px] h-[520px] flex flex-col">
            <div className="flex items-center gap-2 px-4 py-3 border-b bg-background">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleBack}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <h2 className="font-semibold text-base">
                {activeChannel?.name || (activeConversation && (() => {
                  const other = activeConversation.participants?.find(p => p.user_id !== user?.id);
                  return other?.profile?.full_name || "Chat";
                })())}
              </h2>
            </div>
            <ChatPanel
              channel={activeChannel}
              conversation={activeConversation}
              messages={messages}
              messagesLoading={messagesLoading}
              onSendMessage={handleSendMessage}
              onUploadAttachment={uploadAttachment}
              onSendAttachment={handleSendAttachment}
              onMessageVisible={markAsRead}
              onEditMessage={handleEditMessage}
              onDeleteMessage={handleDeleteMessage}
            />
          </div>
        )}

        {/* Mobile chat panel */}
        {isMobile && !showSidebar && (
          <div className="flex-1 min-w-0">
            <ChatPanel
              channel={activeChannel}
              conversation={activeConversation}
              messages={messages}
              messagesLoading={messagesLoading}
              onSendMessage={handleSendMessage}
              onUploadAttachment={uploadAttachment}
              onSendAttachment={handleSendAttachment}
              onMessageVisible={markAsRead}
              onEditMessage={handleEditMessage}
              onDeleteMessage={handleDeleteMessage}
            />
          </div>
        )}
      </div>
    </div>
  );
}
