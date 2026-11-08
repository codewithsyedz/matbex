import { useState } from "react";
import { FloatingChatButton } from "./FloatingChatButton";
import { FloatingChatPanel } from "./FloatingChatPanel";
import { useAuth } from "@/contexts/AuthContext";

export function FloatingChat() {
  const [isOpen, setIsOpen] = useState(false);
  const { hasFeature, loading } = useAuth();

  // Don't render if chat feature is not enabled for this plan/tenant
  if (loading || !hasFeature("chat")) {
    return null;
  }

  return (
    <>
      <FloatingChatPanel isOpen={isOpen} />
      <FloatingChatButton isOpen={isOpen} onClick={() => setIsOpen(!isOpen)} />
    </>
  );
}
