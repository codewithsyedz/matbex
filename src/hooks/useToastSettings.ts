import { useContext } from "react";
import { AuthContext } from "@/contexts/AuthContext";

export type ToastPosition = 
  | "top-left" 
  | "top-center" 
  | "top-right" 
  | "bottom-left" 
  | "bottom-center" 
  | "bottom-right";

export const TOAST_POSITIONS: { value: ToastPosition; label: string }[] = [
  { value: "top-left", label: "Top Left" },
  { value: "top-center", label: "Top Center" },
  { value: "top-right", label: "Top Right" },
  { value: "bottom-left", label: "Bottom Left" },
  { value: "bottom-center", label: "Bottom Center" },
  { value: "bottom-right", label: "Bottom Right" },
];

export function useToastSettings() {
  // Use useContext directly to avoid throwing error when outside AuthProvider
  const context = useContext(AuthContext);
  
  // If no context (outside AuthProvider), return default
  const toastPosition: ToastPosition = 
    (context?.restaurant?.toast_position as ToastPosition) || "top-center";

  return {
    toastPosition,
  };
}
