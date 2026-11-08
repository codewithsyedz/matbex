import { useState } from "react";
import { format, isToday, isYesterday } from "date-fns";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Check, CheckCheck, FileIcon, MoreVertical, Pencil, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatMessage as ChatMessageType } from "@/hooks/useChat";
import { useAuth } from "@/contexts/AuthContext";

interface ChatMessageProps {
  message: ChatMessageType;
  showAvatar: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: (messageId: string, newContent: string) => void;
  onDelete: (messageId: string) => void;
}

export function ChatMessage({
  message,
  showAvatar,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
}: ChatMessageProps) {
  const { user } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content || "");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const isOwn = message.sender_id === user?.id;

  const formatMessageDate = (dateStr: string) => {
    const date = new Date(dateStr);
    if (isToday(date)) return format(date, "h:mm a");
    if (isYesterday(date)) return `Yesterday ${format(date, "h:mm a")}`;
    return format(date, "MMM d, h:mm a");
  };

  const getInitials = (name: string | null) => {
    if (!name) return "?";
    return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  };

  const handleSaveEdit = () => {
    if (editContent.trim() && editContent !== message.content) {
      onEdit(message.id, editContent.trim());
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditContent(message.content || "");
    setIsEditing(false);
  };

  const handleConfirmDelete = () => {
    onDelete(message.id);
    setShowDeleteDialog(false);
  };

  const renderAttachment = () => {
    if (!message.attachment_url) return null;

    const isImage = message.attachment_type?.startsWith("image/");

    if (isImage) {
      return (
        <a
          href={message.attachment_url}
          target="_blank"
          rel="noopener noreferrer"
          className="block mt-2 max-w-xs"
        >
          <img
            src={message.attachment_url}
            alt={message.attachment_name || "Attachment"}
            className="rounded-lg max-h-48 object-cover"
          />
        </a>
      );
    }

    return (
      <a
        href={message.attachment_url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 mt-2 p-2 bg-muted rounded-lg hover:bg-muted/80 transition-colors max-w-xs"
      >
        <FileIcon className="h-5 w-5 text-muted-foreground" />
        <span className="text-sm truncate">{message.attachment_name || "Download file"}</span>
      </a>
    );
  };

  return (
    <>
      <div className={cn("flex gap-3 group", isOwn && "flex-row-reverse")}>
        {showAvatar ? (
          <Avatar className="h-8 w-8 mt-0.5">
            <AvatarImage src={message.sender?.avatar_url || undefined} />
            <AvatarFallback>{getInitials(message.sender?.full_name)}</AvatarFallback>
          </Avatar>
        ) : (
          <div className="w-8" />
        )}

        <div className={cn("max-w-[70%] relative", isOwn && "items-end")}>
          {showAvatar && (
            <div className={cn("flex items-baseline gap-2 mb-1", isOwn && "flex-row-reverse")}>
              <span className="text-sm font-medium">
                {isOwn ? "You" : message.sender?.full_name || "Unknown"}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatMessageDate(message.created_at)}
              </span>
              {message.is_edited && (
                <span className="text-xs text-muted-foreground">(edited)</span>
              )}
            </div>
          )}

          <div className="flex items-start gap-1">
            {isOwn && (canEdit || canDelete) && !isEditing && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <MoreVertical className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canEdit && message.content && (
                    <DropdownMenuItem onClick={() => setIsEditing(true)}>
                      <Pencil className="h-4 w-4 mr-2" />
                      Edit
                    </DropdownMenuItem>
                  )}
                  {canDelete && (
                    <DropdownMenuItem
                      onClick={() => setShowDeleteDialog(true)}
                      className="text-destructive"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <div
              className={cn(
                "rounded-2xl px-4 py-2",
                isOwn
                  ? "bg-primary text-primary-foreground rounded-tr-sm"
                  : "bg-muted rounded-tl-sm"
              )}
            >
              {isEditing ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="h-8 min-w-[200px] bg-background text-foreground"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveEdit();
                      if (e.key === "Escape") handleCancelEdit();
                    }}
                  />
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleSaveEdit}>
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleCancelEdit}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <>
                  {message.content && (
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  )}
                  {renderAttachment()}
                </>
              )}
            </div>
          </div>

          {isOwn && message.read_receipts && message.read_receipts.length > 0 && (
            <div className="flex justify-end mt-1">
              <Tooltip>
                <TooltipTrigger>
                  <CheckCheck className="h-3.5 w-3.5 text-primary" />
                </TooltipTrigger>
                <TooltipContent>
                  Read by {message.read_receipts.length}{" "}
                  {message.read_receipts.length === 1 ? "person" : "people"}
                </TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete message?</AlertDialogTitle>
            <AlertDialogDescription>
              This message will be permanently deleted. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
