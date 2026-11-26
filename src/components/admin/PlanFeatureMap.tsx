import { Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Minus } from "lucide-react";
import { db } from "@/integrations/db/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFeatureCatalog } from "@/hooks/useFeatureCatalog";
import { planLabel } from "@/lib/billing/planLabel";

/**
 * What each plan includes and which add-ons unlock each feature, from the same data
 * tenant_entitlements() uses — the one place to read "what does Growth include?".
 */
export function PlanFeatureMap() {
  const catalog = useFeatureCatalog();
  const q = useQuery({
    queryKey: ["plan-feature-map"],
    queryFn: async () => {
      const [plans, addons, flags] = await Promise.all([
        db.from("plans").select("name, price, default_feature_flags").eq("is_active", true).order("price"),
        db.from("addons").select("name, included_features").eq("is_active", true).order("sort_order"),
        db.from("feature_flags").select("key, enabled, min_plan, description").order("key"),
      ]);
      if (plans.error) throw plans.error;
      return {
        plans: (plans.data ?? []) as { name: string; price: number; default_feature_flags: Record<string, boolean> | null }[],
        addons: (addons.data ?? []) as { name: string; included_features: string[] | null }[],
        flags: (flags.data ?? []) as { key: string; enabled: boolean; min_plan: string | null; description: string | null }[],
      };
    },
  });

  const groups = [...new Set(catalog.map((f) => f.category))];
  const addonsFor = (key: string) => (q.data?.addons ?? []).filter((a) => Array.isArray(a.included_features) && a.included_features.includes(key)).map((a) => a.name);

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">Feature map</CardTitle>
        <CardDescription>
          What each plan includes, and which add-ons unlock a feature on any plan. A business's own access (with SuperAdmin
          overrides) is on its page, Modules tab.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {q.isLoading || !catalog.length ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : q.data && (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Feature</TableHead>
                  {q.data.plans.map((p) => <TableHead key={p.name} className="text-center">{planLabel(p.name)}</TableHead>)}
                  <TableHead>Add-ons that unlock it</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => (
                  <Fragment key={g}>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableCell colSpan={q.data.plans.length + 2} className="py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g}</TableCell>
                    </TableRow>
                    {catalog.filter((f) => f.category === g).map((f) => (
                      <TableRow key={f.key}>
                        <TableCell>
                          <div className="font-medium">{f.label}</div>
                          <div className="text-xs text-muted-foreground">{f.description}</div>
                        </TableCell>
                        {q.data.plans.map((p) => {
                          const on = p.default_feature_flags?.[f.key] === true;
                          return (
                            <TableCell key={p.name} className="text-center">
                              {on ? <Check className="mx-auto h-4 w-4 text-primary" aria-label="Included" /> : <Minus className="mx-auto h-4 w-4 text-muted-foreground/50" aria-label="Not included" />}
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-sm">{addonsFor(f.key).join(", ") || <span className="text-muted-foreground">—</span>}</TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                ))}
              </TableBody>
            </Table>

            {q.data.flags.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Rollout flags</p>
                <p className="text-xs text-muted-foreground">Switched on platform-wide, from a minimum plan, or for chosen businesses (Feature Flags page).</p>
                <div className="flex flex-wrap gap-2">
                  {q.data.flags.map((f) => (
                    <Badge key={f.key} variant={f.enabled ? "secondary" : "outline"} className="font-mono text-xs" title={f.description ?? undefined}>
                      {f.key} · {f.enabled ? (f.min_plan ? `${planLabel(f.min_plan)} and up` : "everyone") : "off"}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
