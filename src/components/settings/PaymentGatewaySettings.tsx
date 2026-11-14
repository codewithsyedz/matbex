import { useEffect, useState } from "react";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { CreditCard, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PaymentGatewayCredentialsForm } from "./PaymentGatewayCredentialsForm";
import { useDemoTrial } from "@/hooks/useDemoTrial";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FlaskConical } from "lucide-react";

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

type Method = "cash" | "card" | "other";
type Channel = "pos" | "online" | "both";

interface ConfigRow {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  gateway: Gateway;
  enabled: boolean;
  priority: number;
  allowed_methods: Method[];
  channel: Channel;
  refund_enabled: boolean;
  offline_tolerance_minutes: number;
}

const GATEWAY_LABELS: Record<Gateway, string> = {
  hyperpay: "HyperPay (Mada / Visa / Apple Pay)",
  stcpay: "STC Pay",
  paymob: "Paymob",
  moyasar: "Moyasar",
  amazon_ps: "Amazon Payment Services",
  geidea: "Geidea",
  hala: "Hala POS Terminal",
  stripe: "Stripe (Cards / Apple Pay / Google Pay)",
  checkout_com: "Checkout.com (Cards / Apple Pay / STC Pay / Tamara / Tabby)",
};

const GATEWAY_HINTS: Record<Gateway, string> = {
  hyperpay: "Online gateway. Requires HYPERPAY_* secrets.",
  stcpay: "Wallet (KSA). Adapter stub - credentials required.",
  paymob: "Online gateway. Adapter stub - credentials required.",
  moyasar: "Online gateway. Adapter stub - credentials required.",
  amazon_ps: "Online gateway. Adapter stub - credentials required.",
  geidea: "Online gateway. Adapter stub - credentials required.",
  hala: "Standalone card terminal. Manual today; API later.",
  stripe: "Global online gateway. Use your own Stripe secret + publishable keys and webhook secret.",
  checkout_com:
    "Unified gateway for cards (incl. Mada), Apple Pay, STC Pay, Tamara and Tabby. Paste your Checkout.com secret + public keys and processing channel.",
};

const ALL_METHODS: Method[] = ["cash", "card", "other"];

export function PaymentGatewaySettings() {
  const { user, hasRole } = useAuth();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [rows, setRows] = useState<Partial<ConfigRow>[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Gateway | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: profile } = await db
        .from("profiles")
        .select("tenant_id")
        .eq("id", user.id)
        .maybeSingle();
      if (!profile?.tenant_id) {
        setLoading(false);
        return;
      }
      setTenantId(profile.tenant_id);
      const { data: configs } = await db
        .from("payment_gateway_configs")
        .select("*")
        .eq("tenant_id", profile.tenant_id)
        .is("branch_id", null);

      const byGateway = new Map<Gateway, Partial<ConfigRow>>();
      (configs ?? []).forEach((c: any) => byGateway.set(c.gateway, c));
      const seeded: Partial<ConfigRow>[] = (Object.keys(GATEWAY_LABELS) as Gateway[]).map(
        (g) =>
          byGateway.get(g) ?? {
            tenant_id: profile.tenant_id,
            branch_id: null,
            gateway: g,
            enabled: false,
            priority: 100,
            allowed_methods: g === "hala" ? ["card"] : g === "stcpay" ? ["other"] : ["card"],
            channel: g === "hala" ? "pos" : "both",
            refund_enabled: true,
            offline_tolerance_minutes: 5,
          },
      );
      setRows(seeded);
      setLoading(false);
    })();
  }, [user]);

  const updateRow = (gateway: Gateway, patch: Partial<ConfigRow>) => {
    setRows((prev) =>
      prev.map((r) => (r.gateway === gateway ? { ...r, ...patch } : r)),
    );
  };

  const save = async (gateway: Gateway) => {
    if (!tenantId) return;
    const row = rows.find((r) => r.gateway === gateway);
    if (!row) return;
    setSaving(gateway);
    const payload: any = {
      tenant_id: tenantId,
      branch_id: null,
      gateway,
      enabled: !!row.enabled,
      priority: row.priority ?? 100,
      allowed_methods: row.allowed_methods ?? [],
      channel: row.channel ?? "both",
      refund_enabled: row.refund_enabled ?? true,
      offline_tolerance_minutes: row.offline_tolerance_minutes ?? 5,
    };
    const { error } = await db
      .from("payment_gateway_configs")
      .upsert(payload, { onConflict: "tenant_id,branch_id,gateway" });
    setSaving(null);
    if (error) {
      toast.error(`Failed to save ${GATEWAY_LABELS[gateway]}: ${error.message}`);
    } else {
      toast.success(`${GATEWAY_LABELS[gateway]} saved`);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <DemoPaymentsNotice />
      <div className="rounded-lg border bg-card p-5">
        <div className="flex items-start gap-3">
          <CreditCard className="h-5 w-5 text-primary mt-0.5" />
          <div>
            <h3 className="font-medium text-foreground">Payment gateways</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Configure which Saudi payment gateways accept payments at the
              counter or online. Cash and Hala terminal payments work without
              external credentials. Online gateways (HyperPay, STC Pay, etc.)
              require API keys configured in backend secrets.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3">
        {rows.map((row) => {
          const gateway = row.gateway as Gateway;
          return (
            <div
              key={gateway}
              className="rounded-lg border bg-card p-5 space-y-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium text-foreground">
                      {GATEWAY_LABELS[gateway]}
                    </h4>
                    {row.enabled && (
                      <Badge variant="secondary" className="text-xs">
                        Active
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {GATEWAY_HINTS[gateway]}
                  </p>
                </div>
                <Switch
                  checked={!!row.enabled}
                  onCheckedChange={(v) => updateRow(gateway, { enabled: v })}
                />
              </div>

              {row.enabled && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-xs">Priority (lower = preferred)</Label>
                    <Input
                      type="number"
                      min={1}
                      max={999}
                      value={row.priority ?? 100}
                      onChange={(e) =>
                        updateRow(gateway, {
                          priority: Number(e.target.value) || 100,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Channel</Label>
                    <Select
                      value={row.channel ?? "both"}
                      onValueChange={(v) =>
                        updateRow(gateway, { channel: v as Channel })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pos">In-store (POS)</SelectItem>
                        <SelectItem value="online">Online</SelectItem>
                        <SelectItem value="both">Both</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2 sm:col-span-2">
                    <Label className="text-xs">Accepted payment methods</Label>
                    <div className="flex flex-wrap gap-3">
                      {ALL_METHODS.map((m) => {
                        const checked = (row.allowed_methods ?? []).includes(m);
                        return (
                          <label
                            key={m}
                            className="flex items-center gap-2 text-sm cursor-pointer"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(v) => {
                                const current = new Set(row.allowed_methods ?? []);
                                if (v) current.add(m);
                                else current.delete(m);
                                updateRow(gateway, {
                                  allowed_methods: Array.from(current) as Method[],
                                });
                              }}
                            />
                            <span className="capitalize">{m}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex items-center justify-between rounded-md border p-3 sm:col-span-2">
                    <div>
                      <Label className="text-sm">Allow refunds</Label>
                      <p className="text-xs text-muted-foreground">
                        Managers can issue refunds against this gateway.
                      </p>
                    </div>
                    <Switch
                      checked={!!row.refund_enabled}
                      onCheckedChange={(v) =>
                        updateRow(gateway, { refund_enabled: v })
                      }
                    />
                  </div>
                </div>
              )}

              {row.enabled && tenantId && hasRole("owner") && (
                <PaymentGatewayCredentialsForm
                  tenantId={tenantId}
                  gateway={gateway}
                />
              )}

              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => save(gateway)}
                  disabled={saving === gateway}
                >
                  {saving === gateway ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    "Save"
                  )}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DemoPaymentsNotice() {
  const { isDemo, allowRealPayments } = useDemoTrial();
  if (!isDemo && allowRealPayments) return null;
  return (
    <Alert className="border-amber-300/60 bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
      <FlaskConical className="h-4 w-4" />
      <AlertTitle>Sandbox mode</AlertTitle>
      <AlertDescription>
        Live charges are disabled on demo accounts. Saudi gateways (HyperPay, Mada, Apple Pay)
        are visible for evaluation but will not process real transactions until you activate
        your Matbex account.
      </AlertDescription>
    </Alert>
  );
}