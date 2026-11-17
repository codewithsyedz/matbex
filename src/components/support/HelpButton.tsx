import { lazy, Suspense, useState } from "react";
import { LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";

// The form (with its selects and dialog) loads on first click, keeping it out of the startup bundle.
const HelpRequestDialog = lazy(() => import("./HelpRequestDialog").then((m) => ({ default: m.HelpRequestDialog })));

/** Header button that opens the help form. */
export function HelpButton() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Help and support" title="Help and support"
        onClick={() => { setLoaded(true); setOpen(true); }}>
        <LifeBuoy className="h-[18px] w-[18px]" />
      </Button>
      {loaded && (
        <Suspense fallback={null}>
          <HelpRequestDialog open={open} onOpenChange={setOpen} />
        </Suspense>
      )}
    </>
  );
}
