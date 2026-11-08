import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FlaskConical, ArrowRight, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useDemoTrial } from "@/hooks/useDemoTrial";
import { toast } from "sonner";

export function DemoActivateCard() {
  const { tenant } = useAuth();
  const { isDemo, daysLeft, isExpired } = useDemoTrial();
  const [busy, setBusy] = useState(false);

  if (!isDemo) return null;

  const handleActivate = async () => {
    if (!tenant?.id) return;
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("activate-demo-tenant", {
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
    <Card className="mb-6 border-amber-300/60 bg-gradient-to-br from-amber-50 to-white">
      <CardContent className="pt-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning/15 text-warning">
            <FlaskConical className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">
              {isExpired ? "Demo expired" : "Demo Environment"}
            </h3>
            <p className="text-sm text-muted-foreground">
              {isExpired
                ? "POS is read-only. Activate to keep your data and go live."
                : daysLeft !== null
                  ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left in your 14-day trial. Activate any time - no resets, no friction.`
                  : "Activate any time - your data carries over."}
            </p>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
              Production payments, ZATCA invoicing, and exports unlock instantly.
            </p>
          </div>
        </div>
        <Button onClick={handleActivate} disabled={busy} className="shrink-0">
          {busy ? "Activating…" : "Activate your Matbex account"}
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}