import { ChatSidebar, ChatPanel } from "@/components/chat";
import { useChat } from "@/hooks/useChat";
import { useUnreadCounts } from "@/hooks/useUnreadCounts";
import { useChatNotifications } from "@/hooks/useChatNotifications";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Menu } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LockedFeatureScreen } from "@/components/LockedFeatureScreen";

export default function Chat() {
  const { t } = useTranslation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();
  const { hasFeature, loading } = useAuth();
  
  // Initialize notifications (will request permission and listen for new messages)
  useChatNotifications();
  
  const {
    channels,
    conversations,
    messages,
    teamMembers,
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

  // Show locked screen if chat feature is not enabled
  if (!loading && !hasFeature("chat")) {
    return (
      <>
        <LockedFeatureScreen 
          featureName={t("chat.lockedTitle")}
          description={t("chat.lockedDesc")}
          featureKey="chat"
        />
      </>
    );
  }

  const activeChannel = channels.find(c => c.id === activeChannelId);
  const activeConversation = conversations.find(c => c.id === activeConversationId);

  const handleSelectChannel = (id: string) => {
    setActiveChannelId(id);
    setSidebarOpen(false);
  };

  const handleSelectConversation = (id: string) => {
    setActiveConversationId(id);
    setSidebarOpen(false);
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

  const sidebarContent = (
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
  );

  return (
    <>
      <div className="h-[calc(100vh-4rem)] flex">
        {/* Mobile sidebar */}
        {isMobile ? (
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="absolute top-16 left-4 z-10 md:hidden"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-72">
              {sidebarContent}
            </SheetContent>
          </Sheet>
        ) : (
          sidebarContent
        )}

        {/* Chat panel */}
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
    </>
  );
}
