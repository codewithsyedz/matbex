import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Eye, EyeOff, Loader2, CreditCard, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const KEY = "checkout_com_platform";
const MASK = "••••••••";

type Env = "sandbox" | "production";

interface CkoSettings {
  environment: Env;
  secret_key: string;
  public_key: string;
  processing_channel_id: string;
  webhook_secret: string;
}

const empty: CkoSettings = {
  environment: "sandbox",
  secret_key: "",
  public_key: "",
  processing_channel_id: "",
  webhook_secret: "",
};

export function CheckoutComPlatformSettingsCard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [original, setOriginal] = useState<CkoSettings>(empty);
  const [values, setValues] = useState<CkoSettings>(empty);
  const [showSecret, setShowSecret] = useState(false);
  const [showWebhook, setShowWebhook] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("platform_settings" as any)
      .select("value")
      .eq("key", KEY)
      .maybeSingle();
    if (error && error.code !== "PGRST116") {
      toast.error(error.message);
    }
    const v = ((data as any)?.value ?? {}) as Partial<CkoSettings>;
    const stored: CkoSettings = {
      environment: (v.environment as Env) ?? "sandbox",
      secret_key: v.secret_key ?? "",
      public_key: v.public_key ?? "",
      processing_channel_id: v.processing_channel_id ?? "",
      webhook_secret: v.webhook_secret ?? "",
    };
    setOriginal(stored);
    // Mask secrets in the form
    setValues({
      ...stored,
      secret_key: stored.secret_key ? MASK : "",
      webhook_secret: stored.webhook_secret ? MASK : "",
    });
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const next: CkoSettings = {
      environment: values.environment,
      public_key: values.public_key.trim(),
      processing_channel_id: values.processing_channel_id.trim(),
      secret_key:
        values.secret_key === MASK ? original.secret_key : values.secret_key.trim(),
      webhook_secret:
        values.webhook_secret === MASK
          ? original.webhook_secret
          : values.webhook_secret.trim(),
    };
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("platform_settings" as any)
      .upsert(
        {
          key: KEY,
          value: next,
          is_secret: true,
          description: "Platform Checkout.com credentials for SaaS billing",
          updated_by: u.user?.id ?? null,
        },
        { onConflict: "key" },
      );
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setOriginal(next);
    setValues({
      ...next,
      secret_key: next.secret_key ? MASK : "",
      webhook_secret: next.webhook_secret ? MASK : "",
    });
    setShowSecret(false);
    setShowWebhook(false);
    toast.success("Checkout.com platform credentials saved");
  };

  const update = <K extends keyof CkoSettings>(k: K, v: CkoSettings[K]) =>
    setValues((p) => ({ ...p, [k]: v }));

  return (
    <Card className="border-border/40 md:col-span-2">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-primary" />
          <CardTitle className="text-base font-medium">
            Checkout.com (Platform billing)
          </CardTitle>
        </div>
        <CardDescription>
          Credentials used when tenants pay <strong>Matbex</strong> for plans
          and addons via Checkout.com. POS gateway keys are configured by each
          tenant in their own settings.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Environment</Label>
              <Select
                value={values.environment}
                onValueChange={(v) => update("environment", v as Env)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sandbox">Sandbox</SelectItem>
                  <SelectItem value="production">Production</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Processing channel ID</Label>
              <Input
                value={values.processing_channel_id}
                placeholder="pc_…"
                onChange={(e) =>
                  update("processing_channel_id", e.target.value)
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Public key</Label>
              <Input
                value={values.public_key}
                placeholder="pk_sbox_… / pk_…"
                onChange={(e) => update("public_key", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Secret key</Label>
              <div className="relative">
                <Input
                  type={showSecret ? "text" : "password"}
                  value={values.secret_key}
                  placeholder="sk_sbox_… / sk_…"
                  onFocus={() => {
                    if (values.secret_key === MASK) update("secret_key", "");
                  }}
                  onChange={(e) => update("secret_key", e.target.value)}
                  className="pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showSecret ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">Webhook signing key</Label>
              <div className="relative">
                <Input
                  type={showWebhook ? "text" : "password"}
                  value={values.webhook_secret}
                  placeholder="Used to verify cko-signature header"
                  onFocus={() => {
                    if (values.webhook_secret === MASK)
                      update("webhook_secret", "");
                  }}
                  onChange={(e) => update("webhook_secret", e.target.value)}
                  className="pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowWebhook((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showWebhook ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Webhook URL:{" "}
                <code className="text-foreground">
                  https://tlkyubkbbqwmzjaogavb.supabase.co/functions/v1/checkout-com-webhook
                </code>
              </p>
            </div>

            <div className="sm:col-span-2 flex justify-end">
              <Button onClick={handleSave} disabled={saving} size="sm">
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <Save className="h-3.5 w-3.5 mr-1.5" /> Save credentials
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}