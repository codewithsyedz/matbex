import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Hash, Plus, Search, MessageSquarePlus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatChannel, ChatConversation, TeamMember } from "@/hooks/useChat";
import { useAuth } from "@/contexts/AuthContext";
import { UnreadBadge } from "./UnreadBadge";

interface ChatSidebarProps {
  channels: ChatChannel[];
  conversations: ChatConversation[];
  teamMembers: TeamMember[];
  activeChannelId: string | null;
  activeConversationId: string | null;
  unreadCounts: {
    channels: Record<string, number>;
    conversations: Record<string, number>;
  };
  onSelectChannel: (id: string) => void;
  onSelectConversation: (id: string) => void;
  onCreateChannel: (name: string, description?: string) => void;
  onStartConversation: (userId: string) => void;
}

// Avatar color palette based on initials
const avatarColors = [
  "bg-blue-100 text-blue-600",
  "bg-emerald-100 text-emerald-600",
  "bg-orange-100 text-orange-600",
  "bg-purple-100 text-purple-600",
  "bg-pink-100 text-pink-600",
  "bg-amber-100 text-amber-600",
  "bg-teal-100 text-teal-600",
  "bg-rose-100 text-rose-600",
];

function getAvatarColor(name: string | null): string {
  if (!name) return avatarColors[0];
  const charCode = name.charCodeAt(0) + (name.charCodeAt(1) || 0);
  return avatarColors[charCode % avatarColors.length];
}

export function ChatSidebar({
  channels,
  conversations,
  teamMembers,
  activeChannelId,
  activeConversationId,
  unreadCounts,
  onSelectChannel,
  onSelectConversation,
  onCreateChannel,
  onStartConversation,
}: ChatSidebarProps) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<"users" | "channels">("users");
  const [channelDialogOpen, setChannelDialogOpen] = useState(false);
  const [dmDialogOpen, setDmDialogOpen] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelDescription, setNewChannelDescription] = useState("");
  const [memberSearch, setMemberSearch] = useState("");

  const handleCreateChannel = () => {
    if (!newChannelName.trim()) return;
    onCreateChannel(newChannelName, newChannelDescription || undefined);
    setNewChannelName("");
    setNewChannelDescription("");
    setChannelDialogOpen(false);
  };

  const handleStartDM = (userId: string) => {
    onStartConversation(userId);
    setDmDialogOpen(false);
    setMemberSearch("");
  };

  const getConversationName = (conv: ChatConversation) => {
    const otherParticipant = conv.participants?.find(p => p.user_id !== user?.id);
    return otherParticipant?.profile?.full_name || "Unknown";
  };

  const getConversationAvatar = (conv: ChatConversation) => {
    const otherParticipant = conv.participants?.find(p => p.user_id !== user?.id);
    return otherParticipant?.profile?.avatar_url;
  };

  const getInitials = (name: string | null) => {
    if (!name) return "?";
    return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  };

  const filteredMembers = teamMembers.filter(m =>
    m.profile.full_name?.toLowerCase().includes(memberSearch.toLowerCase())
  );

  // Merge team members with their conversation data (if exists)
  const teamMembersWithDM = teamMembers
    .filter(m => m.user_id !== user?.id) // Exclude current user
    .map(member => {
      // Find if there's an existing conversation with this member
      const existingConv = conversations.find(conv => 
        conv.participants?.some(p => p.user_id === member.user_id)
      );
      return {
        id: member.id,
        user_id: member.user_id,
        name: member.profile.full_name || "Unknown",
        avatarUrl: member.profile.avatar_url,
        conversationId: existingConv?.id || null,
        unread: existingConv ? (unreadCounts.conversations[existingConv.id] || 0) : 0,
      };
    });

  const handleMemberClick = (member: typeof teamMembersWithDM[0]) => {
    if (member.conversationId) {
      onSelectConversation(member.conversationId);
    } else {
      handleStartDM(member.user_id);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Tabs */}
      <div className="px-3 pt-3">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "users" | "channels")}>
          <TabsList className="w-full bg-muted/50 p-1 h-auto">
            <TabsTrigger 
              value="users" 
              className="flex-1 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm py-1.5"
            >
              Users
            </TabsTrigger>
            <TabsTrigger 
              value="channels" 
              className="flex-1 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm py-1.5"
            >
              Channels
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <ScrollArea className="flex-1 px-3 py-2">
        {activeTab === "users" ? (
          <div className="space-y-1">
            {/* All Team Members as DM list */}
            {teamMembersWithDM.length > 0 ? (
              <>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 block mb-2">
                  Direct Messages
                </span>
                {teamMembersWithDM.map((member) => (
                  <button
                    key={member.id}
                    onClick={() => handleMemberClick(member)}
                    className={cn(
                      "w-full flex items-center gap-3 p-2.5 rounded-lg transition-all",
                      "hover:bg-muted/70",
                      member.conversationId && activeConversationId === member.conversationId 
                        ? "bg-muted shadow-sm" 
                        : "bg-transparent"
                    )}
                  >
                    <div className="relative">
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={member.avatarUrl || undefined} />
                        <AvatarFallback className={cn("text-sm font-medium", getAvatarColor(member.name))}>
                          {getInitials(member.name)}
                        </AvatarFallback>
                      </Avatar>
                      {/* Online indicator */}
                      <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-background" />
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-sm font-medium truncate">{member.name}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <UnreadBadge count={member.unread} />
                      <MessageSquarePlus className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </button>
                ))}
              </>
            ) : (
              <div className="text-center py-8">
                <p className="text-sm text-muted-foreground">No team members yet</p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {channels.map((channel) => (
              <button
                key={channel.id}
                onClick={() => onSelectChannel(channel.id)}
                className={cn(
                  "w-full flex items-center gap-3 p-2.5 rounded-lg transition-all",
                  "hover:bg-muted/70",
                  activeChannelId === channel.id 
                    ? "bg-muted shadow-sm" 
                    : "bg-transparent"
                )}
              >
                <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                  <Hash className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-medium truncate">{channel.name}</p>
                  {channel.description && (
                    <p className="text-xs text-muted-foreground truncate">{channel.description}</p>
                  )}
                </div>
                <UnreadBadge count={unreadCounts.channels[channel.id] || 0} />
              </button>
            ))}
            {channels.length === 0 && (
              <div className="text-center py-8">
                <p className="text-sm text-muted-foreground">No channels yet</p>
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Add Button */}
      <div className="p-3 border-t">
        {activeTab === "users" ? (
          <Dialog open={dmDialogOpen} onOpenChange={setDmDialogOpen}>
            <DialogTrigger asChild>
              <Button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl h-11">
                <Plus className="h-4 w-4 mr-2" />
                New Message
              </Button>
            </DialogTrigger>
            <DialogContent description="Start a new direct message with a teammate." >
              <DialogHeader>
                <DialogTitle>New Message</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search team members..."
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <ScrollArea className="h-64">
                  <div className="space-y-1">
                    {filteredMembers.map((member) => (
                      <button
                        key={member.id}
                        onClick={() => handleStartDM(member.user_id)}
                        className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted transition-colors"
                      >
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={member.profile.avatar_url || undefined} />
                          <AvatarFallback className={cn("text-sm font-medium", getAvatarColor(member.profile.full_name))}>
                            {getInitials(member.profile.full_name)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm font-medium">{member.profile.full_name || "Unknown"}</span>
                      </button>
                    ))}
                    {filteredMembers.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No team members found
                      </p>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </DialogContent>
          </Dialog>
        ) : (
          <Dialog open={channelDialogOpen} onOpenChange={setChannelDialogOpen}>
            <DialogTrigger asChild>
              <Button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl h-11">
                <Plus className="h-4 w-4 mr-2" />
                Create Channel
              </Button>
            </DialogTrigger>
            <DialogContent description="Create a new chat channel for your team." >
              <DialogHeader>
                <DialogTitle>Create Channel</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="channel-name">Channel Name</Label>
                  <Input
                    id="channel-name"
                    placeholder="e.g., general, kitchen, front-desk"
                    value={newChannelName}
                    onChange={(e) => setNewChannelName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="channel-description">Description (optional)</Label>
                  <Textarea
                    id="channel-description"
                    placeholder="What's this channel about?"
                    value={newChannelDescription}
                    onChange={(e) => setNewChannelDescription(e.target.value)}
                  />
                </div>
                <Button onClick={handleCreateChannel} className="w-full">
                  Create Channel
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </div>
  );
}
