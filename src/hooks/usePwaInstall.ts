import { useState, useEffect, useCallback, useRef } from "react";

export type PwaPlatform = "android" | "ios" | "desktop" | "unsupported";

interface PwaInstallState {
  /** True when the browser can show a native install prompt. */
  isInstallable: boolean;
  /** True when the app is already running in standalone / installed mode. */
  isInstalled: boolean;
  /** The detected platform for install instructions. */
  platform: PwaPlatform;
  /** Triggers the native install prompt on supported browsers. */
  promptInstall: () => Promise<{ outcome: "accepted" | "dismissed"; platform?: string } | null>;
  /** Dismisses any active install prompt and remembers the choice briefly. */
  dismiss: () => void;
  /** Whether the user has recently dismissed the prompt. */
  isDismissed: boolean;
}

function detectPlatform(): PwaPlatform {
  const ua = navigator.userAgent.toLowerCase();
  const isIos = /iphone|ipad|ipod/.test(ua);
  const isAndroid = /android/.test(ua);

  if (isIos) return "ios";
  if (isAndroid) return "android";
  return "desktop";
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // @ts-expect-error iOS standalone property
    navigator.standalone === true
  );
}

const DISMISS_KEY = "pwa-install-dismissed-at";
const DISMISS_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export function usePwaInstall(): PwaInstallState {
  const [isInstallable, setIsInstallable] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [platform] = useState<PwaPlatform>(() => detectPlatform());
  const [isDismissed, setIsDismissed] = useState(false);
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    setIsInstalled(isStandalone());

    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || "0");
    if (dismissedAt && Date.now() - dismissedAt < DISMISS_TTL_MS) {
      setIsDismissed(true);
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent the mini-infobar from appearing on mobile.
      e.preventDefault();
      deferredPromptRef.current = e as BeforeInstallPromptEvent;
      setIsInstallable(true);
    };

    const handleAppInstalled = () => {
      deferredPromptRef.current = null;
      setIsInstallable(false);
      setIsInstalled(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    const prompt = deferredPromptRef.current;
    if (!prompt) return null;

    prompt.prompt();
    const result = await prompt.userChoice;

    if (result.outcome === "accepted") {
      deferredPromptRef.current = null;
      setIsInstallable(false);
      setIsInstalled(true);
    }

    return result;
  }, []);

  const dismiss = useCallback(() => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setIsDismissed(true);
  }, []);

  return {
    isInstallable,
    isInstalled,
    platform,
    promptInstall,
    dismiss,
    isDismissed,
  };
}

// Minimal type shim for the non-standard BeforeInstallPromptEvent.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => void;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
}
