import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { db } from "@/integrations/db/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useFeatureCatalog } from "@/hooks/useFeatureCatalog";
import { planLabel } from "@/lib/billing/planLabel";

interface Ent {
  plan: string | null;
  features: Record<string, { enabled: boolean; source: string; addons: string[] }>;
  flags: Record<string, { enabled: boolean; source: string }>;
  quotas: Record<string, number>;
}

const QUOTA_LABEL: Record<string, string> = {
  users: "Users", owner: "Owners", manager: "Managers", cashier: "Cashiers", branches: "Branches",
  image_uploads: "Image uploads", email_reminders: "Email reminders", inventory_items: "Stock items", device_seats_per_branch: "Devices per branch",
};

function why(source: string, addons: string[], plan: string | null) {
  if (source === "plan") return `in ${planLabel(plan)}`;
  if (source === "addon") return `add-on: ${addons.join(", ")}`;
  if (source === "override") return "set by SuperAdmin for this business";
  if (source === "flag_on") return "rollout flag on for everyone";
  if (source === "flag_on_for_business") return "rollout flag on for this business";
  if (source === "flag_off_for_business") return "rollout flag off for this business";
  if (source === "flag_off") return "rollout flag off";
  if (source.startsWith("flag_needs_")) return `needs ${planLabel(source.slice("flag_needs_".length))}`;
  return `not in ${planLabel(plan)}`;
}

/** SuperAdmin: what this business can use right now, and why — the same map the app and server use. */
export function TenantEntitlementsCard({ tenantId }: { tenantId: string }) {
  const catalog = useFeatureCatalog();
  const q = useQuery({
    queryKey: ["tenant-entitlements", tenantId],
    queryFn: async () => {
      const { data, error } = await db.rpc("tenant_entitlements", { _tenant_id: tenantId });
      if (error) throw error;
      return data as unknown as Ent;
    },
  });

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">Effective access</CardTitle>
        <CardDescription>What this business can use now, and why: its plan, active add-ons and the overrides below.</CardDescription>
      </CardHeader>
      <CardContent>
        {q.isLoading || !catalog.length ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : q.error ? (
          <p className="text-sm text-destructive">{(q.error as Error).message}</p>
        ) : q.data && (
          <div className="grid gap-6 lg:grid-cols-3">
            <ul className="space-y-1.5 text-sm lg:col-span-2 sm:columns-2 sm:gap-6">
              {catalog.map((f) => {
                const e = q.data.features[f.key];
                const on = e?.enabled === true;
                return (
                  <li key={f.key} className="flex break-inside-avoid items-start gap-2">
                    {on ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-label="On" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" aria-label="Off" />}
                    <span>
                      <span className={on ? "" : "text-muted-foreground"}>{f.label}</span>
                      <span className="block text-xs text-muted-foreground">{why(e?.source ?? "not_included", e?.addons ?? [], q.data.plan)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="space-y-4 text-sm">
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Limits</p>
                <ul className="space-y-1">
                  {Object.entries(q.data.quotas).sort().map(([k, v]) => (
                    <li key={k} className="flex justify-between gap-2"><span>{QUOTA_LABEL[k] ?? k}</span><span className="tabular-nums">{v}</span></li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Rollout flags</p>
                <ul className="space-y-1">
                  {Object.entries(q.data.flags ?? {}).sort().map(([k, v]) => (
                    <li key={k} className="flex justify-between gap-2">
                      <span className="font-mono text-xs">{k}</span>
                      <span className={`text-xs ${v.enabled ? "text-primary" : "text-muted-foreground"}`}>{v.enabled ? "on" : "off"} · {why(v.source, [], q.data.plan)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
