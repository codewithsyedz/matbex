import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, X, Share, PlusSquare, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePwaInstall, type PwaPlatform } from "@/hooks/usePwaInstall";

interface PlatformContent {
  headline: string;
  body: string;
  cta: string;
  icon: React.ReactNode;
}

const platformContent: Record<PwaPlatform, PlatformContent> = {
  android: {
    headline: "Install Matbex on your phone",
    body: "Add Matbex to your home screen for one-tap access to COGS, payroll, and daily profit — just like a native app.",
    cta: "Install app",
    icon: <Smartphone className="w-5 h-5 text-[#00A859]" />,
  },
  ios: {
    headline: "Add Matbex to your Home Screen",
    body: "Tap the Share button below, then choose 'Add to Home Screen' to launch Matbex like an app.",
    cta: "Got it",
    icon: <Share className="w-5 h-5 text-[#00A859]" />,
  },
  desktop: {
    headline: "Install Matbex on this device",
    body: "Install Matbex as a desktop app for quick access to your restaurant dashboard without opening the browser.",
    cta: "Install app",
    icon: <Download className="w-5 h-5 text-[#00A859]" />,
  },
  unsupported: {
    headline: "Install Matbex",
    body: "Your browser doesn't support direct installation. Bookmark this page or open it on Chrome, Edge, or Safari.",
    cta: "Close",
    icon: <PlusSquare className="w-5 h-5 text-[#00A859]" />,
  },
};

export function PwaInstallPrompt() {
  const { isInstallable, isInstalled, platform, promptInstall, dismiss, isDismissed } =
    usePwaInstall();
  const [showModal, setShowModal] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  // Hide when already installed, recently dismissed, or no install path exists.
  if (isInstalled || isDismissed) return null;

  // On iOS we can still show manual instructions even without beforeinstallprompt.
  const canShow = isInstallable || platform === "ios";
  if (!canShow) return null;

  const content = platformContent[platform];

  const handleOpen = () => setShowModal(true);

  const handleClose = () => {
    setShowModal(false);
    dismiss();
  };

  const handleInstall = async () => {
    if (platform === "ios" || platform === "unsupported") {
      handleClose();
      return;
    }

    setIsInstalling(true);
    try {
      const result = await promptInstall();
      if (result?.outcome === "accepted") {
        setShowModal(false);
      }
    } finally {
      setIsInstalling(false);
    }
  };

  return (
    <>
      {/* Floating banner */}
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:w-[380px] z-50"
      >
        <div className="bg-card/95 text-card-foreground backdrop-blur-md border border-border/80 rounded-2xl shadow-lifted p-4">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
              {content.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">{content.headline}</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                {content.body}
              </p>
              <div className="flex items-center gap-2 mt-3">
                <Button
                  size="sm"
                  className="text-xs font-medium px-4 h-8 rounded-lg shadow-none"
                  onClick={handleOpen}
                >
                  {content.cta}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-foreground text-xs font-medium h-8 px-2"
                  onClick={dismiss}
                >
                  Not now
                </Button>
              </div>
            </div>
            <button
              onClick={dismiss}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              aria-label="Dismiss install prompt"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </motion.div>

      {/* Detail modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              transition={{ duration: 0.2 }}
              className="bg-card text-card-foreground border border-border rounded-2xl shadow-2xl max-w-md w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                    {content.icon}
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">{content.headline}</h3>
                    <p className="text-sm text-muted-foreground">Quick access, no app store needed</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowModal(false)}
                  className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4 mb-6">
                {platform === "ios" ? (
                  <ol className="space-y-3 text-sm text-foreground">
                    <li className="flex gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">
                        1
                      </span>
                      <span>Tap the <strong>Share</strong> button in Safari's toolbar.</span>
                    </li>
                    <li className="flex gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">
                        2
                      </span>
                      <span>Scroll down and tap <strong>Add to Home Screen</strong>.</span>
                    </li>
                    <li className="flex gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">
                        3
                      </span>
                      <span>Tap <strong>Add</strong> in the top right corner.</span>
                    </li>
                  </ol>
                ) : (
                  <>
                    <div className="flex items-start gap-3 text-sm text-foreground">
                      <div className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center flex-shrink-0 mt-0.5">
                        1
                      </div>
                      <span>Tap <strong>Install app</strong> to open your browser's install prompt.</span>
                    </div>
                    <div className="flex items-start gap-3 text-sm text-foreground">
                      <div className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center flex-shrink-0 mt-0.5">
                        2
                      </div>
                      <span>Confirm <strong>Add to Home Screen</strong> or <strong>Install</strong> in the prompt.</span>
                    </div>
                    <div className="flex items-start gap-3 text-sm text-foreground">
                      <div className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center flex-shrink-0 mt-0.5">
                        3
                      </div>
                      <span>Launch Matbex from your home screen like a regular app.</span>
                    </div>
                  </>
                )}
              </div>

              <div className="flex gap-3">
                <Button
                  className="flex-1 h-11 rounded-xl font-medium shadow-none"
                  onClick={handleInstall}
                  disabled={isInstalling}
                >
                  {isInstalling ? "Opening install prompt…" : content.cta}
                </Button>
                <Button
                  variant="outline"
                  className="h-11 px-5 rounded-xl font-medium shadow-none"
                  onClick={() => setShowModal(false)}
                >
                  Cancel
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
