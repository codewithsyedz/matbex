import { useEffect, useRef, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useChatNotifications() {
  const { user, restaurant } = useAuth();
  const location = useLocation();
  const notificationPermission = useRef<NotificationPermission>("default");

  // Request notification permission
  useEffect(() => {
    if ("Notification" in window) {
      notificationPermission.current = Notification.permission;
      if (Notification.permission === "default") {
        Notification.requestPermission().then((permission) => {
          notificationPermission.current = permission;
        });
      }
    }
  }, []);

  const showNotification = useCallback((title: string, body: string) => {
    if (notificationPermission.current !== "granted") return;
    if (location.pathname === "/chat") return; // Don't show if on chat page

    const notification = new Notification(title, {
      body,
      icon: "/favicon.png",
      tag: "chat-message",
    });

    notification.onclick = () => {
      window.focus();
      window.location.href = "/chat";
      notification.close();
    };

    // Auto close after 5 seconds
    setTimeout(() => notification.close(), 5000);
  }, [location.pathname]);

  // Subscribe to new messages
  useEffect(() => {
    if (!restaurant?.id || !user?.id) return;

    const channel = supabase
      .channel("chat-notifications")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `restaurant_id=eq.${restaurant.id}`,
        },
        async (payload) => {
          const message = payload.new as any;
          
          // Don't notify for own messages
          if (message.sender_id === user.id) return;

          // Fetch sender profile
          const { data: sender } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("id", message.sender_id)
            .single();

          const senderName = sender?.full_name || "Someone";
          const messagePreview = message.content?.substring(0, 50) || "Sent an attachment";
          
          showNotification(
            `New message from ${senderName}`,
            messagePreview
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [restaurant?.id, user?.id, showNotification]);

  const requestPermission = useCallback(async () => {
    if ("Notification" in window && Notification.permission === "default") {
      const permission = await Notification.requestPermission();
      notificationPermission.current = permission;
      return permission;
    }
    return notificationPermission.current;
  }, []);

  return {
    permission: notificationPermission.current,
    requestPermission,
  };
}
