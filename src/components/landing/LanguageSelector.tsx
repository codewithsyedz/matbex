import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Languages } from "lucide-react";
import { useLanguage, SUPPORTED_LANGUAGES } from "@/hooks/useLanguage";
import { useTranslation } from "react-i18next";
import { useNavigate, useLocation } from "react-router-dom";

export const LanguageSelector = () => {
  const { language, setLanguage } = useLanguage();
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Public landing-style routes where switching language should also swap the URL.
  // We keep authed/admin/app routes untouched.
  const PUBLIC_LANDING_PATHS = new Set(["/", "/ar"]);
  const handleSelect = (code: string) => {
    setLanguage(code as any);
    setIsOpen(false);

    const current = location.pathname.replace(/\/+$/, "") || "/";
    if (!PUBLIC_LANDING_PATHS.has(current)) return; // don't redirect inside the app

    if (code === "ar" && current !== "/ar") {
      navigate("/ar" + location.hash);
    } else if (code !== "ar" && current === "/ar") {
      navigate("/" + location.hash);
    }
  };

  const currentLang = SUPPORTED_LANGUAGES.find((l) => l.code === language) || SUPPORTED_LANGUAGES[0];

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-3 min-h-11 rounded-full bg-gray-100/80 hover:bg-gray-200/80 transition-colors text-sm font-normal text-gray-700"
        aria-label={t("settings.language")}
      >
        <Languages className="w-4 h-4" />
        <span className="hidden sm:inline">{currentLang.name}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-gray-500 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />

            {/* Dropdown */}
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 rtl:right-auto rtl:left-0 top-full mt-2 z-50 min-w-[180px] bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden"
            >
              <div className="py-1">
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => handleSelect(lang.code)}
                    className={`w-full flex items-center gap-3 px-4 py-3 min-h-11 text-left rtl:text-right hover:bg-gray-50 transition-colors ${
                      language === lang.code ? "bg-[#00A859]/5" : ""
                    }`}
                  >
                    <span className="text-lg">{lang.flag}</span>
                    <div className="flex-1">
                      <p
                        className={`text-sm font-medium ${
                          language === lang.code ? "text-[#00713A]" : "text-gray-900"
                        }`}
                      >
                        {lang.name}
                      </p>
                    </div>
                    {language === lang.code && (
                      <div className="w-2 h-2 rounded-full bg-[#00A859]" />
                    )}
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
