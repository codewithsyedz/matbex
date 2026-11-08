import { MessageCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useUnreadCounts } from "@/hooks/useUnreadCounts";

interface FloatingChatButtonProps {
  isOpen: boolean;
  onClick: () => void;
}

export function FloatingChatButton({ isOpen, onClick }: FloatingChatButtonProps) {
  const { unreadCounts } = useUnreadCounts();
  const totalUnread = unreadCounts.total;

  return (
    <Button
      onClick={onClick}
      size="icon"
      className={cn(
        "fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full shadow-lg transition-all duration-200",
        "hover:scale-105 active:scale-95",
        isOpen && "rotate-90"
      )}
    >
      {isOpen ? (
        <X className="h-6 w-6" />
      ) : (
        <>
          <MessageCircle className="h-6 w-6" />
          {totalUnread > 0 && (
            <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground">
              {totalUnread > 99 ? "99+" : totalUnread}
            </span>
          )}
        </>
      )}
    </Button>
  );
}
