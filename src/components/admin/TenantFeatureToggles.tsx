import { useEffect, useState } from "react";
import { useFeatureCatalog } from "@/hooks/useFeatureCatalog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { db } from "@/integrations/db/client";
import { toast } from "sonner";

interface Props {
  tenantId: string;
  planId: string | null;
}


export function TenantFeatureToggles({ tenantId, planId }: Props) {
  // The shared feature catalogue (platform_features).
  const FEATURE_FLAGS = useFeatureCatalog();
  const [planFlags, setPlanFlags] = useState<Record<string, boolean>>({});
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, planId]);

  const load = async () => {
    setLoading(true);
    try {
      if (planId) {
        const { data: plan } = await db
          .from("plans")
          .select("default_feature_flags")
          .eq("id", planId)
          .maybeSingle();
        const flags = (plan?.default_feature_flags && typeof plan.default_feature_flags === "object" && !Array.isArray(plan.default_feature_flags))
          ? plan.default_feature_flags as Record<string, boolean>
          : {};
        setPlanFlags(flags);
      } else {
        setPlanFlags({});
      }

      const { data: tf } = await db
        .from("tenant_features")
        .select("feature_key, enabled")
        .eq("tenant_id", tenantId);

      const o: Record<string, boolean> = {};
      tf?.forEach((row) => { o[row.feature_key] = row.enabled; });
      setOverrides(o);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load feature flags");
    } finally {
      setLoading(false);
    }
  };

  const effective = (key: string) =>
    overrides[key] ?? planFlags[key] ?? false;

  const handleToggle = async (key: string, enabled: boolean) => {
    setSaving(key);
    try {
      const { error } = await db
        .from("tenant_features")
        .upsert(
          { tenant_id: tenantId, feature_key: key, enabled },
          { onConflict: "tenant_id,feature_key" }
        );
      if (error) throw error;
      setOverrides((prev) => ({ ...prev, [key]: enabled }));
      toast.success(`${enabled ? "Enabled" : "Disabled"} ${key}`);
    } catch (err) {
      console.error(err);
      toast.error("Failed to update feature");
    } finally {
      setSaving(null);
    }
  };

  const handleResetToPlan = async (key: string) => {
    setSaving(key);
    try {
      const { error } = await db
        .from("tenant_features")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("feature_key", key);
      if (error) throw error;
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      toast.success("Reset to plan default");
    } catch (err) {
      console.error(err);
      toast.error("Failed to reset");
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <Card className="border-border/40">
        <CardContent className="pt-6 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">Modules & Features</CardTitle>
        <CardDescription>
          Enable or disable individual modules for this tenant. Overrides take precedence over the plan's defaults.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Separator />
        <div className="space-y-4">
          {FEATURE_FLAGS.map((feature) => {
            const isOverridden = overrides[feature.key] !== undefined;
            const value = effective(feature.key);
            return (
              <div key={feature.key} className="flex items-start justify-between gap-4">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-foreground">{feature.label}</p>
                    {isOverridden && (
                      <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                        Overridden
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{feature.description}</p>
                  <p className="text-[11px] text-muted-foreground/70">
                    Plan default: {planFlags[feature.key] ? "Enabled" : "Disabled"}
                    {isOverridden && (
                      <>
                        {" · "}
                        <button
                          type="button"
                          className="underline hover:text-foreground"
                          onClick={() => handleResetToPlan(feature.key)}
                          disabled={saving === feature.key}
                        >
                          Reset to plan
                        </button>
                      </>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {saving === feature.key && (
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  )}
                  <Switch
                    checked={value}
                    onCheckedChange={(checked) => handleToggle(feature.key, checked)}
                    disabled={saving === feature.key}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}