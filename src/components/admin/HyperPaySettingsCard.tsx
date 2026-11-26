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
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CreditCard,
  Eye,
  EyeOff,
  Loader2,
  Save,
  CheckCircle2,
} from "lucide-react";
import { db } from "@/integrations/db/client";
import { toast } from "sonner";

const KEY = "hyperpay";
const MASK = "••••••••••••";

type Env = "test" | "live";

interface HpSettings {
  environment: Env;
  access_token: string;
  entity_id_visa_master: string;
  entity_id_mada: string;
  webhook_decryption_key: string;
  currency: string;
}

const empty: HpSettings = {
  environment: "test",
  access_token: "",
  entity_id_visa_master: "",
  entity_id_mada: "",
  webhook_decryption_key: "",
  currency: "SAR",
};

export function HyperPaySettingsCard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [hasWebhookKey, setHasWebhookKey] = useState(false);
  const [values, setValues] = useState<HpSettings>(empty);
  const [showToken, setShowToken] = useState(false);
  const [showWebhookKey, setShowWebhookKey] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await db
      .from("platform_settings" as any)
      .select("value")
      .eq("key", KEY)
      .maybeSingle();
    if (error && error.code !== "PGRST116") {
      toast.error(error.message);
    }
    const v = ((data as any)?.value ?? {}) as Partial<HpSettings>;
    setHasToken(!!v.access_token);
    setHasWebhookKey(!!v.webhook_decryption_key);
    setValues({
      environment: (v.environment as Env) ?? "test",
      access_token: v.access_token ? MASK : "",
      entity_id_visa_master: v.entity_id_visa_master ?? "",
      entity_id_mada: v.entity_id_mada ?? "",
      webhook_decryption_key: v.webhook_decryption_key ? MASK : "",
      currency: v.currency ?? "SAR",
    });
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const payload: Partial<HpSettings> = {
      environment: values.environment,
      entity_id_visa_master: values.entity_id_visa_master.trim(),
      entity_id_mada: values.entity_id_mada.trim(),
      currency: (values.currency || "SAR").trim().toUpperCase(),
    };
    if (values.access_token && values.access_token !== MASK) {
      payload.access_token = values.access_token.trim();
    }
    if (values.webhook_decryption_key && values.webhook_decryption_key !== MASK) {
      payload.webhook_decryption_key = values.webhook_decryption_key.trim();
    }

    const { data: existing } = await db
      .from("platform_settings" as any)
      .select("value")
      .eq("key", KEY)
      .maybeSingle();
    const merged = { ...((existing as any)?.value ?? {}), ...payload };

    const { error } = await db
      .from("platform_settings" as any)
      .upsert(
        {
          key: KEY,
          value: merged,
          is_secret: true,
          description:
            "HyperPay credentials for platform subscription billing (COPYandPay + recurring tokens)",
        },
        { onConflict: "key" },
      );

    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("HyperPay settings saved");
    await load();
  };

  const configured = hasToken && !!values.entity_id_visa_master;

  return (
    <Card className="border-border/40 md:col-span-2">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            <CardTitle className="text-base font-medium">
              HyperPay (Platform Billing)
            </CardTitle>
          </div>
          {configured ? (
            <Badge
              variant="default"
              className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
            >
              <CheckCircle2 className="h-3 w-3 mr-1" /> Configured ·{" "}
              {values.environment === "live" ? "Live" : "Test"}
            </Badge>
          ) : (
            <Badge variant="secondary">Not configured</Badge>
          )}
        </div>
        <CardDescription>
          Credentials used to charge tenants for Pro/Enterprise plans via HyperPay
          COPYandPay and recurring registration tokens.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Environment</Label>
                <Select
                  value={values.environment}
                  onValueChange={(v) =>
                    setValues((s) => ({ ...s, environment: v as Env }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="test">
                      Test (eu-test.oppwa.com)
                    </SelectItem>
                    <SelectItem value="live">Live (eu-prod.oppwa.com)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Switch to Live only after end-to-end testing succeeds.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="hp_currency">Currency</Label>
                <Input
                  id="hp_currency"
                  value={values.currency}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, currency: e.target.value }))
                  }
                  placeholder="SAR"
                  className="font-mono text-xs uppercase"
                  maxLength={3}
                />
                <p className="text-xs text-muted-foreground">
                  ISO 4217 code. SAR for Saudi Riyal.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="hp_entity_visa">Entity ID — Visa/Mastercard</Label>
                <Input
                  id="hp_entity_visa"
                  value={values.entity_id_visa_master}
                  onChange={(e) =>
                    setValues((v) => ({
                      ...v,
                      entity_id_visa_master: e.target.value,
                    }))
                  }
                  placeholder="8a8294174…"
                  className="font-mono text-xs"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="hp_entity_mada">Entity ID — Mada (optional)</Label>
                <Input
                  id="hp_entity_mada"
                  value={values.entity_id_mada}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, entity_id_mada: e.target.value }))
                  }
                  placeholder="8a8294174…"
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  Required to accept Mada cards in KSA.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="hp_token">Access Token (Bearer)</Label>
              <div className="relative">
                <Input
                  id="hp_token"
                  type={showToken ? "text" : "password"}
                  value={values.access_token}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, access_token: e.target.value }))
                  }
                  placeholder={hasToken ? MASK : "OGE4Mjk0…"}
                  className="pr-10 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => setShowToken((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showToken ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Sent as <code className="text-[10px]">Authorization: Bearer …</code>{" "}
                on every server-to-server HyperPay call.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="hp_webhook_key">Webhook Decryption Key (hex)</Label>
              <div className="relative">
                <Input
                  id="hp_webhook_key"
                  type={showWebhookKey ? "text" : "password"}
                  value={values.webhook_decryption_key}
                  onChange={(e) =>
                    setValues((v) => ({
                      ...v,
                      webhook_decryption_key: e.target.value,
                    }))
                  }
                  placeholder={hasWebhookKey ? MASK : "64-char hex string"}
                  className="pr-10 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => setShowWebhookKey((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showWebhookKey ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Symmetric AES key used to decrypt webhook payloads sent by HyperPay.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}