import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Eye, EyeOff, KeyRound } from "lucide-react";
import { toast } from "sonner";

type Gateway =
  | "hyperpay"
  | "stcpay"
  | "paymob"
  | "moyasar"
  | "amazon_ps"
  | "geidea"
  | "hala"
  | "stripe"
  | "checkout_com";

interface FieldDef {
  key: string;
  label: string;
  type?: "text" | "password" | "select";
  options?: { value: string; label: string }[];
  placeholder?: string;
  hint?: string;
}

const SCHEMAS: Record<Gateway, FieldDef[]> = {
  hyperpay: [
    {
      key: "HYPERPAY_MODE",
      label: "Environment",
      type: "select",
      options: [
        { value: "test", label: "Test (sandbox)" },
        { value: "live", label: "Live (production)" },
      ],
    },
    { key: "HYPERPAY_ACCESS_TOKEN", label: "Access token", type: "password" },
    { key: "HYPERPAY_ENTITY_ID_MADA", label: "Entity ID - Mada" },
    { key: "HYPERPAY_ENTITY_ID_APPLEPAY", label: "Entity ID - Apple Pay" },
    { key: "HYPERPAY_ENTITY_ID_CARD", label: "Entity ID - Visa / Mastercard" },
    {
      key: "HYPERPAY_WEBHOOK_SECRET",
      label: "Webhook decryption key (optional)",
      type: "password",
    },
  ],
  stcpay: [
    {
      key: "STCPAY_MODE",
      label: "Environment",
      type: "select",
      options: [
        { value: "test", label: "Test" },
        { value: "live", label: "Live" },
      ],
    },
    { key: "STCPAY_MERCHANT_ID", label: "Merchant ID" },
    { key: "STCPAY_API_KEY", label: "API key", type: "password" },
  ],
  paymob: [
    {
      key: "PAYMOB_MODE",
      label: "Environment",
      type: "select",
      options: [
        { value: "test", label: "Test" },
        { value: "live", label: "Live" },
      ],
    },
    { key: "PAYMOB_API_KEY", label: "API key", type: "password" },
    { key: "PAYMOB_INTEGRATION_ID", label: "Integration ID" },
    { key: "PAYMOB_HMAC_SECRET", label: "HMAC secret", type: "password" },
  ],
  moyasar: [
    {
      key: "MOYASAR_MODE",
      label: "Environment",
      type: "select",
      options: [
        { value: "test", label: "Test" },
        { value: "live", label: "Live" },
      ],
    },
    { key: "MOYASAR_SECRET_KEY", label: "Secret key", type: "password" },
    { key: "MOYASAR_PUBLISHABLE_KEY", label: "Publishable key" },
  ],
  amazon_ps: [
    {
      key: "AMAZON_PS_MODE",
      label: "Environment",
      type: "select",
      options: [
        { value: "test", label: "Test" },
        { value: "live", label: "Live" },
      ],
    },
    { key: "AMAZON_PS_MERCHANT_IDENTIFIER", label: "Merchant identifier" },
    { key: "AMAZON_PS_ACCESS_CODE", label: "Access code", type: "password" },
    {
      key: "AMAZON_PS_SHA_REQUEST_PHRASE",
      label: "SHA request phrase",
      type: "password",
    },
    {
      key: "AMAZON_PS_SHA_RESPONSE_PHRASE",
      label: "SHA response phrase",
      type: "password",
    },
  ],
  geidea: [
    {
      key: "GEIDEA_MODE",
      label: "Environment",
      type: "select",
      options: [
        { value: "test", label: "Test" },
        { value: "live", label: "Live" },
      ],
    },
    { key: "GEIDEA_MERCHANT_PUBLIC_KEY", label: "Merchant public key" },
    { key: "GEIDEA_API_PASSWORD", label: "API password", type: "password" },
  ],
  hala: [
    {
      key: "HALA_MODE",
      label: "Mode",
      type: "select",
      options: [
        { value: "manual", label: "Manual (charge on device, record here)" },
        { value: "api", label: "API (cloud sync - requires credentials)" },
      ],
      hint: "Manual works today with no credentials. API mode is activated when the merchant ID + API key are provided.",
    },
    { key: "HALA_MERCHANT_ID", label: "Merchant ID (API mode)" },
    { key: "HALA_API_KEY", label: "API key (API mode)", type: "password" },
  ],
  stripe: [
    {
      key: "STRIPE_MODE",
      label: "Environment",
      type: "select",
      options: [
        { value: "test", label: "Test (sandbox)" },
        { value: "live", label: "Live (production)" },
      ],
      hint: "Use test keys (sk_test_… / pk_test_…) while validating, then switch to live.",
    },
    { key: "STRIPE_PUBLISHABLE_KEY", label: "Publishable key", placeholder: "pk_test_…" },
    { key: "STRIPE_SECRET_KEY", label: "Secret key", type: "password", placeholder: "sk_test_…" },
    {
      key: "STRIPE_WEBHOOK_SECRET",
      label: "Webhook signing secret (optional)",
      type: "password",
      placeholder: "whsec_…",
      hint: "Required only if you enable Stripe webhooks for refunds/disputes.",
    },
    {
      key: "STRIPE_ACCOUNT_ID",
      label: "Connected account ID (optional)",
      placeholder: "acct_…",
      hint: "Leave blank unless you charge on behalf of a connected Stripe account.",
    },
  ],
  checkout_com: [
    {
      key: "CKO_ENVIRONMENT",
      label: "Environment",
      type: "select",
      options: [
        { value: "sandbox", label: "Sandbox" },
        { value: "production", label: "Production" },
      ],
      hint: "Use sandbox keys until your Checkout.com account is approved for live.",
    },
    {
      key: "CKO_SECRET_KEY",
      label: "Secret key",
      type: "password",
      placeholder: "sk_sbox_… / sk_…",
    },
    {
      key: "CKO_PUBLIC_KEY",
      label: "Public key",
      placeholder: "pk_sbox_… / pk_…",
    },
    {
      key: "CKO_PROCESSING_CHANNEL_ID",
      label: "Processing channel ID",
      placeholder: "pc_…",
    },
    {
      key: "CKO_WEBHOOK_SECRET",
      label: "Webhook signing key",
      type: "password",
      hint: "Required to verify cko-signature on incoming webhooks.",
    },
  ],
};

const MASK = "••••••••";

export function PaymentGatewayCredentialsForm({
  tenantId,
  gateway,
}: {
  tenantId: string;
  gateway: Gateway;
}) {
  const schema = SCHEMAS[gateway];
  const [values, setValues] = useState<Record<string, string>>({});
  const [originals, setOriginals] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("payment_gateway_credentials")
        .select("credentials")
        .eq("tenant_id", tenantId)
        .eq("gateway", gateway)
        .maybeSingle();
      const stored = (data?.credentials ?? {}) as Record<string, string>;
      // Mask password fields by default
      const initial: Record<string, string> = {};
      schema.forEach((f) => {
        const raw = stored[f.key] ?? "";
        initial[f.key] = f.type === "password" && raw ? MASK : raw;
      });
      setValues(initial);
      setOriginals(stored);
      setLoading(false);
    })();
  }, [tenantId, gateway]);

  const handleSave = async () => {
    setSaving(true);
    const next: Record<string, string> = { ...originals };
    schema.forEach((f) => {
      const v = values[f.key] ?? "";
      // Skip masked password fields - keep original
      if (f.type === "password" && v === MASK) return;
      if (v === "") {
        delete next[f.key];
      } else {
        next[f.key] = v;
      }
    });

    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("payment_gateway_credentials")
      .upsert(
        {
          tenant_id: tenantId,
          gateway,
          credentials: next,
          updated_by: userData.user?.id,
        },
        { onConflict: "tenant_id,gateway" },
      );
    setSaving(false);
    if (error) {
      toast.error(`Failed to save credentials: ${error.message}`);
      return;
    }
    setOriginals(next);
    // Re-mask password fields
    setValues((prev) => {
      const masked = { ...prev };
      schema.forEach((f) => {
        if (f.type === "password" && next[f.key]) masked[f.key] = MASK;
      });
      return masked;
    });
    setRevealed({});
    toast.success("Credentials saved securely");
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading credentials…
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-muted/30 p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
        Credentials
        <span className="text-xs font-normal text-muted-foreground">
          (owner-only, stored encrypted)
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {schema.map((f) => {
          const isPassword = f.type === "password";
          const isRevealed = !!revealed[f.key];
          return (
            <div key={f.key} className="space-y-1.5">
              <Label className="text-xs">{f.label}</Label>
              {f.type === "select" ? (
                <Select
                  value={values[f.key] ?? ""}
                  onValueChange={(v) =>
                    setValues((p) => ({ ...p, [f.key]: v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {f.options?.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="relative">
                  <Input
                    type={isPassword && !isRevealed ? "password" : "text"}
                    value={values[f.key] ?? ""}
                    placeholder={f.placeholder}
                    onChange={(e) =>
                      setValues((p) => ({ ...p, [f.key]: e.target.value }))
                    }
                    onFocus={() => {
                      // Clear the mask when user focuses to type a new value
                      if (isPassword && values[f.key] === MASK) {
                        setValues((p) => ({ ...p, [f.key]: "" }));
                      }
                    }}
                    className={isPassword ? "pr-9" : undefined}
                  />
                  {isPassword && (
                    <button
                      type="button"
                      onClick={() =>
                        setRevealed((p) => ({ ...p, [f.key]: !p[f.key] }))
                      }
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {isRevealed ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                </div>
              )}
              {f.hint && (
                <p className="text-[11px] text-muted-foreground">{f.hint}</p>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex justify-end">
        <Button size="sm" variant="secondary" onClick={handleSave} disabled={saving}>
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            "Save credentials"
          )}
        </Button>
      </div>
    </div>
  );
}