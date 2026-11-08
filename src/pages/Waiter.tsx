import { lazy, Suspense } from "react";
import { useFeatureFlag } from "@/hooks/useFeatureFlags";
import { LockedFeatureScreen } from "@/components/LockedFeatureScreen";
import { Loader2 } from "lucide-react";

// Waiter App — tablet-first floor staff workflow.
// Reuses the PosTables grid for table selection. Cart and send-to-kitchen
// are handled inside PosTables already; this route is a thin tablet wrapper.
const PosTables = lazy(() => import("@/pages/PosTables"));

export default function Waiter() {
  const enabled = useFeatureFlag("waiter_app_enabled");
  if (!enabled) return <LockedFeatureScreen featureName="Waiter App" />;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/50 backdrop-blur supports-[backdrop-filter]:bg-card/30 sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">Waiter</h1>
            <p className="text-sm text-muted-foreground mt-1">Tap a table to take an order</p>
          </div>
          <div className="text-xs text-muted-foreground hidden sm:block">
            Tablet mode
          </div>
        </div>
      </header>
      <main className="container mx-auto py-4">
        <Suspense fallback={<div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
          <PosTables />
        </Suspense>
      </main>
    </div>
  );
}