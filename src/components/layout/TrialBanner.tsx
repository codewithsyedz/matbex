import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ArrowRight, FlaskConical, Lock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useDemoTrial } from "@/hooks/useDemoTrial";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useState } from "react";

export function TrialBanner() {
  const { tenant } = useAuth();
  const navigate = useNavigate();
  const { isDemo, isTrial, daysLeft, isExpired } = useDemoTrial();
  const [activating, setActivating] = useState(false);

  if (!tenant) return null;

  // Show for trial / demo tenants, and for tenants whose trial just expired
  // (status was flipped to "expired" by the expire_trials() scheduled job).
  if (!isTrial && !isDemo && !isExpired) {
    return null;
  }

  const isExpiringSoon = daysLeft !== null && daysLeft <= 3 && !isExpired;

  const handleActivate = async () => {
    setActivating(true);
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
      setActivating(false);
    }
  };

  if (isExpired) {
    return (
      <div className="bg-destructive/10 border-b border-destructive/20 px-4 py-2">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-2 text-destructive">
            <Lock className="h-4 w-4" />
            <span className="text-sm font-medium">
              {isDemo
                ? "Demo expired - POS is read-only. Activate your Matbex account to go live."
                : "Your trial has expired. Upgrade now to continue using all features."}
            </span>
          </div>
          {isDemo ? (
            <Button size="sm" variant="destructive" disabled={activating} onClick={handleActivate}>
              {activating ? "Activating…" : "Activate Account"}
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button size="sm" variant="destructive" onClick={() => navigate("/billing")}>
              Upgrade Now
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`border-b px-4 py-2 ${
        isExpiringSoon
          ? "bg-amber-500/10 border-amber-500/20"
          : "bg-primary/5 border-primary/10"
      }`}
    >
      <div className="flex items-center justify-between max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          {isDemo && (
            <Badge variant="outline" className="gap-1 border-warning/40 bg-warning/10 text-warning">
              <FlaskConical className="h-3 w-3" />
              Demo
            </Badge>
          )}
          {isExpiringSoon && <AlertTriangle className="h-4 w-4 text-amber-500" />}
          <span className="text-sm text-foreground">
            {isExpiringSoon ? (
              <>
                <span className="font-medium text-amber-600 dark:text-amber-400">
                  {isDemo ? "Demo ending soon!" : "Trial ending soon!"}
                </span>{" "}
                {daysLeft === 0
                  ? "Expires today."
                  : `Only ${daysLeft} day${daysLeft === 1 ? "" : "s"} left.`}
              </>
            ) : (
              <>
                {!isDemo && (
                  <Badge variant="secondary" className="mr-2 text-xs">Trial</Badge>
                )}
                {daysLeft} days remaining {isDemo ? "in your demo" : "in your trial"}
              </>
            )}
          </span>
        </div>
        {isDemo ? (
          <Button
            size="sm"
            variant={isExpiringSoon ? "default" : "outline"}
            disabled={activating}
            onClick={handleActivate}
          >
            {activating ? "Activating…" : "Activate Account"}
            <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        ) : (
          <Button
            size="sm"
            variant={isExpiringSoon ? "default" : "outline"}
            onClick={() => navigate("/billing")}
          >
            View Plans
            <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        )}
      </div>
    </div>
  );
}
