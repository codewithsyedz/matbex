import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslation } from "react-i18next";
import demoVideoEn from "@/assets/videos/matbex-demo-detailed-english.mp4.asset.json";
import demoVideoAr from "@/assets/videos/matbex-demo-detailed-arabic.mp4.asset.json";

const EN_VIDEO_URL = (demoVideoEn as { url: string }).url;
const AR_VIDEO_URL = (demoVideoAr as { url: string }).url;

interface VideoDemoModalProps {
  videoUrl?: string | null;
  trigger?: React.ReactNode;
}

export const VideoDemoModal = ({ videoUrl: videoUrlProp, trigger }: VideoDemoModalProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const { t, i18n } = useTranslation();
  const defaultVideoUrl = i18n.language?.startsWith("ar") ? AR_VIDEO_URL : EN_VIDEO_URL;
  const videoUrl = videoUrlProp || defaultVideoUrl;

  const hasVideo = !!videoUrl;

  return (
    <>
      {trigger ? (
        <div onClick={() => setIsOpen(true)}>{trigger}</div>
      ) : (
        <Button
          variant="outline"
          className="h-12 px-6 gap-2 border-gray-300 hover:border-gray-400 bg-white/80 backdrop-blur-sm"
          onClick={() => setIsOpen(true)}
        >
          <Play className="h-4 w-4" />
          {t("landing.videoDemo.watchDemo")}
        </Button>
      )}

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent description={t("landing.videoDemo.dialogTitle")} className="max-w-4xl p-0 overflow-hidden bg-gray-900 border-gray-800">
          <DialogHeader className="sr-only">
            <DialogTitle>{t("landing.videoDemo.dialogTitle")}</DialogTitle>
          </DialogHeader>
          
          <div className="relative aspect-video w-full">
            {hasVideo ? (
              <video
                key={videoUrl}
                src={videoUrl}
                controls
                autoPlay
                className="w-full h-full object-cover"
              >
                {t("landing.videoDemo.browserUnsupported")}
              </video>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-gray-800 to-gray-900 text-white">
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.1 }}
                  className="flex flex-col items-center gap-4"
                >
                  <div className="w-20 h-20 rounded-full bg-white/10 flex items-center justify-center">
                    <Play className="h-10 w-10 text-white/60" />
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-medium text-white/80">{t("landing.videoDemo.comingSoon")}</p>
                    <p className="text-sm text-white/50 mt-1">
                      {t("landing.videoDemo.uploadHint")}
                    </p>
                  </div>
                </motion.div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
