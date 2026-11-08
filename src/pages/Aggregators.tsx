import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useFeatureFlag } from "@/hooks/useFeatureFlags";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Copy, Loader2 } from "lucide-react";
import { LockedFeatureScreen } from "@/components/LockedFeatureScreen";

type Aggregator = "hungerstation" | "jahez" | "mrsool" | "talabat";

const AGGREGATORS: { id: Aggregator; name: string; color: string }[] = [
  { id: "hungerstation", name: "HungerStation", color: "bg-emerald-500" },
  { id: "jahez", name: "Jahez", color: "bg-rose-500" },
  { id: "mrsool", name: "Mrsool", color: "bg-orange-500" },
  { id: "talabat", name: "Talabat", color: "bg-amber-500" },
];

interface CredRow {
  id?: string;
  restaurant_id: string;
  aggregator: Aggregator;
  store_id: string;
  api_key: string | null;
  webhook_secret: string;
  enabled: boolean;
  auto_accept: boolean;
}

function genSecret() {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function Aggregators() {
  const { user } = useAuth();
  const aggregatorsEnabled = useFeatureFlag("aggregators_enabled");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Aggregator | null>(null);
  const [creds, setCreds] = useState<Record<Aggregator, CredRow>>({} as any);
  const restaurantId = (user as any)?.user_metadata?.restaurant_id ?? null;
  const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const webhookBase = `https://${projectRef}.supabase.co/functions/v1/delivery-webhook`;

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase
        .from("aggregator_credentials")
        .select("*");
      const map = {} as Record<Aggregator, CredRow>;
      AGGREGATORS.forEach((a) => {
        const existing = data?.find((r: any) => r.aggregator === a.id);
        map[a.id] = (existing as CredRow | undefined) ?? {
          restaurant_id: restaurantId ?? "",
          aggregator: a.id,
          store_id: "",
          api_key: "",
          webhook_secret: genSecret(),
          enabled: false,
          auto_accept: false,
        };
      });
      if (mounted) {
        setCreds(map);
        setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [restaurantId]);

  async function save(id: Aggregator) {
    const row = creds[id];
    if (!row.store_id) {
      toast.error("Store ID is required");
      return;
    }
    setSaving(id);
    const { error } = await supabase
      .from("aggregator_credentials")
      .upsert({ ...row, restaurant_id: restaurantId }, { onConflict: "restaurant_id,aggregator" });
    setSaving(null);
    if (error) toast.error(error.message);
    else toast.success(`${id} saved`);
  }

  function copy(value: string) {
    navigator.clipboard.writeText(value);
    toast.success("Copied");
  }

  if (!aggregatorsEnabled) {
    return <LockedFeatureScreen featureName="Delivery Aggregators" />;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div>
        <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">Delivery Aggregators</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Connect HungerStation, Jahez, Mrsool, and Talabat. Orders land in your unified queue.
        </p>
      </div>
      {AGGREGATORS.map((a) => {
        const row = creds[a.id];
        if (!row) return null;
        const url = `${webhookBase}/${a.id}`;
        return (
          <Card key={a.id}>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base font-medium flex items-center gap-3">
                <span className={`inline-block w-2 h-2 rounded-full ${a.color}`} />
                {a.name}
                {row.enabled && <Badge variant="outline" className="ml-2">Active</Badge>}
              </CardTitle>
              <Switch
                checked={row.enabled}
                onCheckedChange={(v) => setCreds((p) => ({ ...p, [a.id]: { ...row, enabled: v } }))}
              />
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <Label>Store ID</Label>
                  <Input
                    value={row.store_id}
                    onChange={(e) => setCreds((p) => ({ ...p, [a.id]: { ...row, store_id: e.target.value } }))}
                    placeholder="Your store ID from the aggregator"
                  />
                </div>
                <div>
                  <Label>API Key (optional)</Label>
                  <Input
                    type="password"
                    value={row.api_key ?? ""}
                    onChange={(e) => setCreds((p) => ({ ...p, [a.id]: { ...row, api_key: e.target.value } }))}
                  />
                </div>
              </div>
              <div>
                <Label>Webhook URL (give this to {a.name})</Label>
                <div className="flex gap-2">
                  <Input readOnly value={url} className="font-mono text-xs" />
                  <Button size="icon" variant="outline" onClick={() => copy(url)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div>
                <Label>Webhook Secret</Label>
                <div className="flex gap-2">
                  <Input readOnly value={row.webhook_secret} className="font-mono text-xs" />
                  <Button size="icon" variant="outline" onClick={() => copy(row.webhook_secret)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setCreds((p) => ({ ...p, [a.id]: { ...row, webhook_secret: genSecret() } }))}
                  >
                    Rotate
                  </Button>
                </div>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Switch
                    checked={row.auto_accept}
                    onCheckedChange={(v) => setCreds((p) => ({ ...p, [a.id]: { ...row, auto_accept: v } }))}
                  />
                  Auto-accept incoming orders
                </label>
                <Button onClick={() => save(a.id)} disabled={saving === a.id}>
                  {saving === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}