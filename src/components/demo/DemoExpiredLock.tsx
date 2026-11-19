import { useDemoTrial } from "@/hooks/useDemoTrial";
import { Lock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

/**
 * Renders a non-dismissible overlay locking write-actions on the wrapped
 * page once the demo trial has expired. Reports remain viewable elsewhere.
 */
export function DemoExpiredLock({ children }: { children: React.ReactNode }) {
  const { isDemo, isExpired } = useDemoTrial();
  const { tenant } = useAuth();
  const [busy, setBusy] = useState(false);

  if (!isDemo || !isExpired) return <>{children}</>;

  const activate = async () => {
    if (!tenant?.id) return;
    setBusy(true);
    try {
      const { error } = await db.functions.invoke("activate-demo-tenant", {
        body: { tenant_id: tenant.id },
      });
      if (error) throw error;
      toast.success("Account activated. Welcome to Matbex.");
      window.location.reload();
    } catch (e: any) {
      toast.error(e?.message || "Activation failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <div className="pointer-events-none opacity-40 select-none">{children}</div>
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/70 backdrop-blur-sm">
        <div className="max-w-md rounded-2xl border bg-card p-8 shadow-xl text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <Lock className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-semibold tracking-tight">Demo expired</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Your 14-day Matbex demo is over. POS is now read-only. Activate to keep all your
            data and unlock live payments, exports, and ZATCA invoicing.
          </p>
          <Button className="mt-6 w-full" disabled={busy} onClick={activate}>
            {busy ? "Activating…" : "Activate your Matbex account"}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}