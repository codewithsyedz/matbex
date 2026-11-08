import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Globe } from "lucide-react";
import { useRegion, SUPPORTED_REGIONS } from "@/hooks/useRegion";

export const RegionSelector = () => {
  const { region, setRegion, isDetecting } = useRegion();
  const [isOpen, setIsOpen] = useState(false);

  if (isDetecting) {
    return (
      <div className="flex items-center gap-1.5 px-3 min-h-11 rounded-full bg-gray-100/80 animate-pulse">
        <Globe className="w-4 h-4 text-gray-400" />
        <div className="w-12 h-4 bg-gray-200 rounded" />
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-3 min-h-11 rounded-full bg-gray-100/80 hover:bg-gray-200/80 transition-colors text-sm font-normal text-gray-700"
        aria-label={`${region.name} (${region.currency})`}
        aria-expanded={isOpen}
      >
        <span className="text-[11px] font-semibold tracking-[0.06em] tabular-nums">
          {region.code.toUpperCase()}
        </span>
        <span className="hidden sm:inline">{region.currency}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-gray-500 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <div 
              className="fixed inset-0 z-40" 
              onClick={() => setIsOpen(false)}
            />
            
            {/* Dropdown */}
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-full mt-2 z-50 min-w-[200px] bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden"
            >
              <div className="py-1">
                {SUPPORTED_REGIONS.map((r) => (
                  <button
                    key={r.code}
                    onClick={() => {
                      setRegion(r.code);
                      setIsOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-3 min-h-11 text-left hover:bg-gray-50 transition-colors ${
                      region.code === r.code ? "bg-[#00A859]/5" : ""
                    }`}
                  >
                    <span className="inline-flex h-6 min-w-8 items-center justify-center rounded border border-current/20 px-1.5 text-[11px] font-semibold tracking-[0.06em]">
                      {r.code.toUpperCase()}
                    </span>
                    <div className="flex-1">
                      <p className={`text-sm font-medium ${region.code === r.code ? "text-[#00713A]" : "text-gray-900"}`}>
                        {r.name}
                      </p>
                      <p className="text-xs text-gray-500">{r.currency} ({r.currencySymbol})</p>
                    </div>
                    {region.code === r.code && (
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
